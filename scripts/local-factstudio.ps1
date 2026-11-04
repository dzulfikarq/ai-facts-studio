[CmdletBinding()]
param(
  [ValidateSet("setup", "start", "stop", "reload", "status", "dev", "open")]
  [string]$Action = "dev",
  [switch]$UpdateSiteConfig
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$nginxRoot = "C:\etc\nginx"
$nginxExe = Join-Path $nginxRoot "nginx.exe"
$nginxPrefix = "C:/etc/nginx/"
$nginxConfig = Join-Path $nginxRoot "conf\nginx.conf"
$sitesDir = Join-Path $nginxRoot "conf\sites-enabled"
$siteConfig = Join-Path $sitesDir "ai-facts-studio.conf"
$template = Join-Path $repoRoot "config\nginx\ai-facts-studio.conf"
$pidFile = Join-Path $nginxRoot "logs\nginx.pid"
$hostsFile = "C:\Windows\System32\drivers\etc\hosts"
$domain = "factstudio.me"

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run setup from Administrator PowerShell; hosts file needs elevated access."
  }
}

function Invoke-Nginx([string[]]$NginxArgs) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $nginxExe -p $nginxPrefix -c "conf/nginx.conf" @NginxArgs 2>&1
    $exitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  $output | ForEach-Object { Write-Host $_ }
  if ($exitCode -ne 0) { throw "nginx.exe failed ($exitCode): $($NginxArgs -join ' ')" }
}

function Get-NginxState {
  $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'nginx.exe'" -ErrorAction SilentlyContinue)
  if ($processes.Count -eq 0) {
    if (Test-Path $pidFile) { Remove-Item -LiteralPath $pidFile -Force }
    return [pscustomobject]@{ Running = $false; Pid = $null }
  }

  if (-not (Test-Path $pidFile)) { throw "Nginx process exists without expected PID file. Refusing to signal an unmanaged instance." }
  $recordedPid = (Get-Content -LiteralPath $pidFile -Raw).Trim()
  if ($recordedPid -notmatch '^\d+$' -or $processes.ProcessId -notcontains [int]$recordedPid) {
    throw "Nginx is running from another prefix or PID file. Refusing to start a duplicate or signal it."
  }
  $otherMasters = @($processes | Where-Object { $_.ProcessId -ne [int]$recordedPid -and $_.ParentProcessId -ne [int]$recordedPid })
  if ($otherMasters.Count -gt 0) { throw "Multiple Nginx master processes detected. Refusing to start, reload, or stop them automatically." }
  return [pscustomobject]@{ Running = $true; Pid = [int]$recordedPid }
}

function Get-PortListeners([int]$Port) {
  return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Test-AppHealth {
  try {
    $frontend = Invoke-WebRequest -Uri "http://127.0.0.1:5173/" -TimeoutSec 3 -UseBasicParsing
    $backend = Invoke-RestMethod -Uri "http://127.0.0.1:3001/api/status" -TimeoutSec 3
    $backendFields = @($backend.PSObject.Properties.Name)
    return (
      $frontend.StatusCode -eq 200 -and
      $frontend.Content.Contains("<title>AI Facts Studio</title>") -and
      $backend.generationMode -in @("development", "production") -and
      $backendFields -contains "ffmpegAvailable"
    )
  } catch { return $false }
}

function Start-Nginx {
  $state = Get-NginxState
  if ($state.Running) {
    Write-Host "Nginx already running (PID $($state.Pid)); no duplicate started."
    return
  }
  $listeners = Get-PortListeners 80
  if ($listeners.Count -gt 0) {
    $owners = @($listeners.OwningProcess | Sort-Object -Unique | ForEach-Object {
      $process = Get-Process -Id $_ -ErrorAction SilentlyContinue
      if ($process) { "$($process.ProcessName) (PID $($_))" } else { "PID $_" }
    }) -join ", "
    throw "TCP port 80 is already occupied by $owners. No Nginx process started."
  }
  Invoke-Nginx -NginxArgs @("-t")
  Start-Process -FilePath $nginxExe -WorkingDirectory $nginxRoot -WindowStyle Hidden -ArgumentList @("-p", $nginxPrefix, "-c", "conf/nginx.conf") | Out-Null
  $managedProcessFound = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    $processes = @(Get-Process -Name nginx -ErrorAction SilentlyContinue)
    if (Test-Path $pidFile) {
      $recordedPid = (Get-Content -LiteralPath $pidFile -Raw).Trim()
      if ($recordedPid -match '^\d+$' -and $processes.Id -contains [int]$recordedPid) { $managedProcessFound = $true; break }
    }
  }
  if (-not $managedProcessFound) { throw "Nginx did not create its expected PID in 10 seconds. Check C:\etc\nginx\logs\error.log." }
  $state = Get-NginxState
  if (-not $state.Running) { throw "Nginx start returned without a managed master process." }
  Write-Host "Nginx started (PID $($state.Pid))."
}

function Setup-LocalDomain {
  Assert-Administrator
  if (-not (Test-Path $nginxExe) -or -not (Test-Path $nginxConfig) -or -not (Test-Path $sitesDir) -or -not (Test-Path $hostsFile)) {
    throw "Expected Nginx or Windows hosts path is missing. No changes made."
  }
  if (-not (Test-Path $template)) { throw "Nginx template missing: $template" }
  if ((Get-Content -LiteralPath $nginxConfig -Raw) -notmatch '(?im)^\s*include\s+C:/etc/nginx/conf/sites-enabled/\*\.conf\s*;') {
    throw "nginx.conf no longer includes C:/etc/nginx/conf/sites-enabled/*.conf. No changes made."
  }

  $state = Get-NginxState
  $appPorts = @(Get-PortListeners 3001) + @(Get-PortListeners 5173)
  if ($appPorts.Count -gt 0 -and -not (Test-AppHealth)) {
    throw "Port 3001 or 5173 is occupied by an unhealthy/unrecognized service. No setup changes made."
  }
  if (-not $state.Running) {
    $listeners = Get-PortListeners 80
    if ($listeners.Count -gt 0) {
      $owners = @($listeners.OwningProcess | Sort-Object -Unique | ForEach-Object {
        $process = Get-Process -Id $_ -ErrorAction SilentlyContinue
        if ($process) { "$($process.ProcessName) (PID $($_))" } else { "PID $_" }
      }) -join ", "
      throw "TCP port 80 is already occupied by $owners. No setup changes made."
    }
  }

  $hostsRows = @()
  foreach ($line in [IO.File]::ReadAllLines($hostsFile)) {
    $entry = ($line -split "#", 2)[0].Trim()
    if (-not $entry) { continue }
    $parts = $entry -split '\s+'
    if ($parts.Count -gt 1 -and $parts[1..($parts.Count - 1)] -contains $domain) {
      $hostsRows += [pscustomobject]@{ Address = $parts[0]; Line = $line }
    }
  }
  $conflict = @($hostsRows | Where-Object { $_.Address -ne "127.0.0.1" })
  if ($conflict.Count -gt 0) { throw "Conflicting $domain hosts mapping found: $($conflict.Line -join '; '). No changes made." }
  $needsHostsEntry = $hostsRows.Count -eq 0

  $siteExists = Test-Path $siteConfig
  $siteDiffers = $siteExists -and (Get-FileHash -LiteralPath $siteConfig).Hash -ne (Get-FileHash -LiteralPath $template).Hash
  if ($siteDiffers -and -not $UpdateSiteConfig) {
    throw "$siteConfig differs from repository template. Review it, then rerun setup with -UpdateSiteConfig to back up and replace it."
  }
  $needsSite = -not $siteExists -or $siteDiffers
  $backupPath = $null
  if ($needsSite -or $needsHostsEntry) {
    $backupPath = Join-Path (Join-Path $nginxRoot "backups") ("local-factstudio-" + (Get-Date -Format "yyyyMMdd-HHmmss-fff"))
    New-Item -ItemType Directory -Path (Join-Path $backupPath "conf") -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $nginxRoot "conf") -Force | Copy-Item -Destination (Join-Path $backupPath "conf") -Recurse -Force
    Copy-Item -LiteralPath $hostsFile -Destination (Join-Path $backupPath "hosts")
    Write-Host "Backup created: $backupPath"
  }

  if ($needsSite) { Copy-Item -LiteralPath $template -Destination $siteConfig }
  try {
    Invoke-Nginx -NginxArgs @("-t")
  } catch {
    if ($siteDiffers -and $backupPath) {
      Copy-Item -LiteralPath (Join-Path $backupPath "conf\sites-enabled\ai-facts-studio.conf") -Destination $siteConfig -Force
    } elseif ($needsSite -and (Test-Path $siteConfig)) { Remove-Item -LiteralPath $siteConfig -Force }
    throw
  }

  if ($needsHostsEntry) {
    $contents = [IO.File]::ReadAllText($hostsFile)
    $newline = if ($contents.Length -gt 0 -and -not $contents.EndsWith("`n")) { "`r`n" } else { "" }
    [IO.File]::AppendAllText($hostsFile, "${newline}127.0.0.1 factstudio.me # AI Facts Studio local`r`n", [Text.Encoding]::ASCII)
    $flushOutput = & "$env:SystemRoot\System32\ipconfig.exe" /flushdns 2>&1
    $flushOutput | ForEach-Object { Write-Host $_ }
  }

  $addresses = @([Net.Dns]::GetHostAddresses($domain) | ForEach-Object { $_.IPAddressToString })
  if ($addresses -notcontains "127.0.0.1") { throw "$domain did not resolve to 127.0.0.1. Check hosts file and DNS cache." }
  if ($state.Running) {
    Invoke-Nginx -NginxArgs @("-s", "reload")
    $state = Get-NginxState
    Write-Host "Nginx configuration reloaded."
  } else {
    Start-Nginx
  }
  Write-Host "Setup complete: http://$domain"
}

switch ($Action) {
  "setup" { Setup-LocalDomain }
  "start" { Start-Nginx }
  "stop" {
    $state = Get-NginxState
    if (-not $state.Running) { Write-Host "Nginx already stopped."; break }
    Invoke-Nginx -NginxArgs @("-s", "quit")
    for ($i = 0; $i -lt 20 -and (Get-Process -Name nginx -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
    if (Get-Process -Name nginx -ErrorAction SilentlyContinue) { throw "Nginx did not stop within 10 seconds; no process was force-killed." }
    Write-Host "Nginx stopped."
  }
  "reload" {
    $state = Get-NginxState
    if (-not $state.Running) { throw "Nginx is stopped. Run -Action start first." }
    Invoke-Nginx -NginxArgs @("-t")
    Invoke-Nginx -NginxArgs @("-s", "reload")
    $state = Get-NginxState
    Write-Host "Nginx reloaded (PID $($state.Pid))."
  }
  "status" {
    $state = Get-NginxState
    $addresses = try { @([Net.Dns]::GetHostAddresses($domain) | ForEach-Object { $_.IPAddressToString }) -join ", " } catch { "unresolved" }
    [pscustomobject]@{
      Nginx = if ($state.Running) { "running (PID $($state.Pid))" } else { "stopped" }
      Domain = $addresses
      App = if (Test-AppHealth) { "healthy (127.0.0.1:5173 + :3001)" } else { "not healthy/not running" }
      OpenCode = "127.0.0.1:4096 (not proxied)"
    } | Format-List
  }
  "dev" {
    Start-Nginx
    if (-not (Test-AppHealth)) {
      $appListeners = @(Get-PortListeners 3001) + @(Get-PortListeners 5173)
      if ($appListeners.Count -gt 0) { throw "Port 3001 or 5173 is occupied but AI Facts Studio health check failed. Refusing to launch a duplicate app." }
      $command = "Set-Location -LiteralPath `"$repoRoot`"; npm run dev"
      Start-Process -FilePath "powershell.exe" -WorkingDirectory $repoRoot -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $command) | Out-Null
      $ready = $false
      for ($i = 0; $i -lt 90; $i++) {
        Start-Sleep -Seconds 1
        if (Test-AppHealth) { $ready = $true; break }
      }
      if (-not $ready) { throw "AI Facts Studio did not become healthy in 90 seconds. Check the separate dev PowerShell window." }
    } else {
      Write-Host "AI Facts Studio already healthy; no duplicate app started."
    }
    Start-Process "http://factstudio.me"
  }
  "open" { Start-Process "http://factstudio.me" }
}
