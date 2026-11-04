# Local Nginx setup for AI Facts Studio

Local development only: `http://factstudio.me` resolves to `127.0.0.1` through Windows hosts. No public DNS, firewall, service, or autostart changes. OpenCode remains at `127.0.0.1:4096` and is not proxied.

## Layout and routing

- `config/nginx/ai-facts-studio.conf` is repository template; setup copies it to `C:\etc\nginx\conf\sites-enabled\ai-facts-studio.conf`.
- Existing `nginx.conf` includes `sites-enabled/*.conf`; setup does not edit it or other site files.
- FactStudio listener is `127.0.0.1:80`, shared with other loopback-only virtual hosts. Keep `server_name factstudio.me` distinct. Do not add `bind` to this listener: an existing loopback site already uses that option, and Nginx rejects duplicate `bind` options.
- `/` and Vite HMR/WebSocket → `127.0.0.1:5173`.
- `/api/`, `/audio/`, `/visual-assets/`, `/scene-media/`, `/outros/` → `127.0.0.1:3001`; API prefix stays intact.
- Access restricted to loopback; 120 MB request limit covers Express media uploads up to 100 MB. Upload/read/send timeouts allow long local transfers and render requests.
- `Host` and forwarding headers pass through. AI Generation accepts `http://factstudio.me` only when Host matches; Express still requires a loopback socket. Vite allows only the explicit custom host.

`npm run dev` remains unchanged and continues binding Vite and Express to loopback.

## One-time setup

Run setup from **Administrator PowerShell**; script does not self-elevate. It checks port 80, detects conflicting hosts entries, backs up Nginx `conf` and hosts before changes, installs the site file, adds one hosts line if needed, runs `nginx -t`, then starts or reloads Nginx. Other site files are never overwritten; replacing FactStudio's own config requires explicit opt-in.

```powershell
Set-Location E:\MyProjects\ai-facts-studio
.\scripts\local-factstudio.ps1 -Action setup
```

Backups live under `C:\etc\nginx\backups\local-factstudio-*`. Current machine backup before first install: `C:\etc\nginx\backups\local-factstudio-20261104-093832-937`. A later backup before the loopback-listener adjustment: `C:\etc\nginx\backups\local-factstudio-20261104-095021-337`.

If the live FactStudio site file differs from the repository template, setup refuses to overwrite it. Review first; pass `-UpdateSiteConfig` only when replacement is intended. Setup takes another full backup before replacement.

## Start and operate

After Windows restart, use a normal PowerShell window:

```powershell
Set-Location E:\MyProjects\ai-facts-studio
.\scripts\local-factstudio.ps1 -Action dev
```

`dev` starts Nginx if this script-managed instance is stopped, launches `npm run dev` in a separate PowerShell window only when both app ports are free, checks app health, and opens `http://factstudio.me`. It refuses to duplicate an app on occupied but unhealthy ports. If app is already healthy, it reuses it.

```powershell
.\scripts\local-factstudio.ps1 -Action status
.\scripts\local-factstudio.ps1 -Action start
.\scripts\local-factstudio.ps1 -Action reload
.\scripts\local-factstudio.ps1 -Action stop
```

Start/reload run `nginx -t` with explicit prefix `C:/etc/nginx/`. Script checks PID file and process tree, refuses unmanaged/multiple Nginx masters, never force-kills processes, and never installs a Windows service. `stop` stops all Nginx-hosted sites, not only FactStudio.

## Troubleshooting

- **`factstudio.me` resolves incorrectly:** inspect hosts for duplicate/conflicting entries. Setup refuses non-loopback mappings. After correcting only the FactStudio line, run `ipconfig /flushdns`.
- **Port 80 conflict:** do not change another site's port. Inspect `Get-NetTCPConnection -State Listen -LocalPort 80`; free the conflict or coordinate the existing listener, then rerun setup.
- **`502 Bad Gateway`:** check `-Action status`, then confirm Vite `127.0.0.1:5173` and Express `127.0.0.1:3001` are healthy. Never change `.env` binds to `0.0.0.0` for this proxy.
- **Upload too large:** Nginx allows 120 MB; scene media endpoint allows 100 MB. Check request size and Express's `MAX_UPLOAD_MB` for audio/Outro uploads.
- **AI Generation unavailable:** check `http://factstudio.me/api/settings/ai-generation`; Development provider must report OpenCode connected at its existing local URL. Do not proxy port 4096 or expose credentials.
- **HMR fails:** load app through `http://factstudio.me`, not a different hostname. Check `nginx -t`, reload, then inspect Nginx `logs/error.log` and the Vite window.
- **Other local vhost returns 502:** Nginx site files were preserved; check that site's own upstream is running. FactStudio setup does not start or reconfigure other applications.

## Rollback

Rollback only FactStudio entries; do not restore whole `hosts` or `conf` directories if they changed after backup.

1. Remove `C:\etc\nginx\conf\sites-enabled\ai-facts-studio.conf`.
2. Edit `C:\Windows\System32\drivers\etc\hosts` as Administrator and remove only `127.0.0.1 factstudio.me # AI Facts Studio local`.
3. Run `ipconfig /flushdns`.
4. If Nginx is running, validate and reload remaining sites with `.\scripts\local-factstudio.ps1 -Action reload`; otherwise start Nginx if other local vhosts need it.

To restore a full backup, inspect it first and copy only files known to be part of this setup. Avoid replacing newer unrelated site configuration or hosts entries.

## Verification performed

- Nginx 1.26.2 `-t` passed with the explicit prefix; hosts resolved `factstudio.me` to `127.0.0.1`.
- Domain returned AI Facts Studio; `/api/status` and AI settings worked. OpenCode reported connected. No generation request or paid API call was made.
- Vite HMR WebSocket handshake passed through Nginx using Vite's `vite-hmr` protocol.
- Chromium loaded and refreshed a project editor deep link with selected scene intact.
- Temporary MP4 and GIF uploaded through the domain, normalized, and served with HTTP byte-range playback; temporary Outro upload/playback also passed. Test project/assets were cleaned up.
- Existing `nginx.conf`, `core-api.conf`, `ms-core.conf`, `ms-core-ui.conf`, and concurrently-added `clipperai.conf` hashes matched backups. No independent second device was available; FactStudio server block binds only `127.0.0.1:80`.
- `clipperai.me` upstream `127.0.0.1:3000` was unavailable during one check and returned 502; its Nginx config was not changed.
