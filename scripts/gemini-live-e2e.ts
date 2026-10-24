import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FREE_TIER_TTS_MODELS, ttsCacheKey } from "../src/server/tts/provider";
import { narrationScript } from "../src/domain/voice-timing";
import { parseResearchPackage } from "../src/domain/research";

const execFileAsync = promisify(execFile);
const requestedPhase = process.argv[2];
const renderRequested = requestedPhase === "render";
const phase = renderRequested ? "continue" : requestedPhase;
const samples = ["mountain-formation", "lightning-charge", "kenapa-air-laut-asin"] as const;
type SampleName = typeof samples[number];
const outputDir = path.resolve(process.env.GEMINI_TTS_LIVE_REVIEW_DIR ?? "renders/v1.0.4-review/gemini-live");
const statePath = path.join(outputDir, "live-state.json");

if (!(["preview", "continue"] as string[]).includes(phase ?? "")) throw new Error("Usage: npm run smoke:gemini-e2e -- preview <mountain-formation|lightning-charge|kenapa-air-laut-asin> OR continue");
if (process.env.GEMINI_TTS_LIVE_E2E !== "1") throw new Error("Set GEMINI_TTS_LIVE_E2E=1 to opt in to full-narration Gemini E2E.");
if (!process.env.GEMINI_API_KEY?.trim()) throw new Error("BLOCKED — LIVE KEY UNAVAILABLE: GEMINI_API_KEY is not configured.");
if (process.env.GEMINI_TTS_FREE_TIER_ONLY !== "true") throw new Error("Live E2E blocked: GEMINI_TTS_FREE_TIER_ONLY must be true.");
if (process.env.GEMINI_TTS_LIVE_NO_BILLING_CONFIRMED !== "I_HAVE_VERIFIED_NO_BILLING") throw new Error("Live E2E blocked: verify the selected Google AI Studio project has no linked billing, then set GEMINI_TTS_LIVE_NO_BILLING_CONFIRMED=I_HAVE_VERIFIED_NO_BILLING.");

async function allocatePort() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

let baseUrl = "";
let server: ReturnType<typeof spawn> | undefined;

async function stopServer() {
  if (!server) return;
  if (server.exitCode === null && server.signalCode === null) server.kill();
  await new Promise<void>((resolve) => {
    if (server!.exitCode !== null || server!.signalCode !== null) return resolve();
    server!.once("exit", () => resolve());
    setTimeout(resolve, 3000);
  });
}

async function connectApi() {
  const configuredPort = Number(process.env.PORT ?? 3001);
  const existingUrl = `http://127.0.0.1:${configuredPort}`;
  try {
    if ((await fetch(`${existingUrl}/api/tts/status`, { signal: AbortSignal.timeout(1000) })).ok) {
      baseUrl = existingUrl;
      return;
    }
  } catch { /* No app server is listening; start loopback-only API below. */ }
  const port = await allocatePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "development", TTS_MOCK_PROVIDER: "0", HOST: "127.0.0.1", PORT: String(port) },
    stdio: "ignore",
  });
  await waitForServer();
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${baseUrl}/api/status`)).ok) return; }
    catch { /* local API is starting */ }
    if (server && (server.exitCode !== null || server.signalCode !== null)) throw new Error(`Local API exited before startup (${server.exitCode ?? server.signalCode}).`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Local API did not start within 15 seconds.");
}

async function api<T>(route: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${route}`, init);
  const body = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error ?? `Local API returned HTTP ${response.status}.`);
  return body;
}

async function sha256(data: Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

async function inspectNarration(filePath: string) {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  const probe = JSON.parse(stdout) as { streams?: Array<{ codec_type: string; codec_name: string; duration?: string }>; format?: { duration?: string } };
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
  if (!audio || audio.codec_name !== "mp3") throw new Error("Gemini preview must be normalized MP3 audio.");
  const { stderr } = await execFileAsync("ffmpeg", ["-hide_banner", "-nostats", "-i", filePath, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"], { timeout: 60_000, maxBuffer: 1024 * 1024 });
  const mean = stderr.match(/mean_volume:\s*(-?[\d.]+|-inf)\s+dB/);
  const peak = stderr.match(/max_volume:\s*(-?[\d.]+|-inf)\s+dB/);
  const meanVolumeDb = mean?.[1] && mean[1] !== "-inf" ? Number(mean[1]) : null;
  const maxVolumeDb = peak?.[1] && peak[1] !== "-inf" ? Number(peak[1]) : null;
  if (meanVolumeDb === null || meanVolumeDb <= -45) throw new Error("Gemini preview is silent or too quiet; do not approve it.");
  if (maxVolumeDb === null || maxVolumeDb >= -0.1) throw new Error("Gemini preview peak indicates possible clipping; do not approve it.");
  return { codec: audio.codec_name, durationSec: Number(probe.format?.duration ?? audio.duration ?? 0), meanVolumeDb, maxVolumeDb, ffprobe: probe };
}

async function persistState(state: Record<string, unknown>, create = false) {
  await writeFile(statePath, JSON.stringify(state, null, 2), create ? { flag: "wx" } : undefined);
}

try {
  await connectApi();
  const ttsStatus = await api<{ provider: string; model: string; freeTierOnly: boolean; configured: boolean; dailyLimit: number; requestsUsed: number; requestsRemaining: number }>("/api/tts/status");
  const appStatus = await api<{ ffmpegAvailable: boolean; dailyLimit: number; jobsUsed: number; nextAllowedAt: string | null }>("/api/status");
  assert.equal(ttsStatus.provider, "gemini-developer-api", "live E2E must use the official Gemini adapter");
  assert.equal(ttsStatus.configured, true, "Gemini API key, allowlisted model, and Free Tier guard must be active");
  assert.equal(ttsStatus.freeTierOnly, true);
  assert.ok((FREE_TIER_TTS_MODELS as readonly string[]).includes(ttsStatus.model), "configured model must remain on the Free Tier allowlist");
  assert.equal(appStatus.ffmpegAvailable, true, "FFmpeg is required for normalization and media checks");

  if (phase === "preview") {
    const sampleName = process.argv[3] as SampleName | undefined;
    if (!sampleName || !samples.includes(sampleName)) throw new Error(`Choose one supported sample: ${samples.join(", " )}.`);
    await mkdir(outputDir, { recursive: true });
    const previewPath = path.join(outputDir, "narration-preview.mp3");
    if ([statePath, previewPath, path.join(outputDir, "narration-preview.ffprobe.json"), path.join(outputDir, "narration-preview-report.json")].some(existsSync)) throw new Error(`Live E2E artifacts already exist in ${path.relative(process.cwd(), outputDir)}; continue that run rather than synthesizing again.`);
    if (ttsStatus.requestsRemaining < 1) throw new Error(`BLOCKED — TTS quota exhausted (${ttsStatus.requestsUsed}/${ttsStatus.dailyLimit}); no synthesis sent.`);

    const parsed = parseResearchPackage(JSON.parse(await readFile(path.resolve("samples", `${sampleName}.json`), "utf8")));
    if (!parsed.success) throw new Error(`Sample ${sampleName} failed Research Package validation.`);
    const research = parsed.data;
    const script = narrationScript(research);
    const voices = await api<{ catalogSource: string; voices: Array<{ id: string; name: string; availability: string }> }>(`/api/tts/voices?locale=${encodeURIComponent(research.language)}`);
    if (voices.catalogSource !== "api") throw new Error("BLOCKED — live Gemini voice catalog unavailable; fallback names are not live evidence.");
    const selectedVoice = voices.voices.find((voice) => voice.id === "Kore" && voice.availability === "api") ?? voices.voices.find((voice) => voice.availability === "api");
    if (!selectedVoice) throw new Error("BLOCKED — Gemini returned no live prebuilt voice for the sample locale.");
    const settings = { locale: research.language, voiceId: selectedVoice.id, style: "documentary", speakingRate: 1 };
    const scriptSha256 = createHash("sha256").update(script).digest("hex");
    const cacheKey = ttsCacheKey({ provider: ttsStatus.provider, model: ttsStatus.model, scriptSha256, ...settings });
    const project = await api<{ id: string }>("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: research }) });
    const state: Record<string, unknown> = {
      version: 1, phase: "synthesis-started", sampleName, projectId: project.id, cacheKey, scriptSha256,
      provider: ttsStatus.provider, model: ttsStatus.model, settings, voiceName: selectedVoice.name,
      videoJobsUsedAtPreview: appStatus.jobsUsed, videoJobDailyLimit: appStatus.dailyLimit, nextVideoJobAt: appStatus.nextAllowedAt,
      startedAt: new Date().toISOString(), ttsEndpointRequestCount: 1, liveSynthesisCount: null,
    };
    await persistState(state, true);
    const ttsBody = await api<{ project: { audio: unknown; pendingTts: { cacheKey: string; scriptSha256: string; audioUrl: string; durationSec: number; bytes: number; voiceName: string; locale: string; style: string; speakingRate: number } | null; pendingTtsMatchesNarration: boolean }; preview: { cacheKey: string; scriptSha256: string; audioUrl: string; durationSec: number; bytes: number; voiceName: string; locale: string; style: string; speakingRate: number }; cacheHit: boolean }>(`/api/projects/${project.id}/tts`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(settings), signal: AbortSignal.timeout(300_000),
    });
    assert.equal(ttsBody.project.audio, null, "full narration must remain pending until user approval");
    assert.equal(ttsBody.project.pendingTtsMatchesNarration, true);
    assert.equal(ttsBody.project.pendingTts?.cacheKey, cacheKey);
    assert.equal(ttsBody.preview.scriptSha256, scriptSha256);
    assert.equal(ttsBody.preview.voiceName, selectedVoice.name);
    assert.equal(ttsBody.preview.locale, settings.locale);
    assert.equal(ttsBody.preview.style, settings.style);
    assert.equal(ttsBody.preview.speakingRate, settings.speakingRate);

    const previewBytes = Buffer.from(await (await fetch(`${baseUrl}${ttsBody.preview.audioUrl}`)).arrayBuffer());
    const previewSha256 = await sha256(previewBytes);
    await writeFile(previewPath, previewBytes, { flag: "wx" });
    const audioReport = await inspectNarration(previewPath);
    const { ffprobe, ...audioMetrics } = audioReport;
    await writeFile(path.join(outputDir, "narration-preview.ffprobe.json"), JSON.stringify(ffprobe, null, 2), { flag: "wx" });
    const previewReport = {
      origin: "gemini-developer-api", model: ttsStatus.model, voice: selectedVoice.name, ...settings,
      durationSec: audioMetrics.durationSec, bytes: previewBytes.length, sha256: previewSha256,
      meanVolumeDb: audioMetrics.meanVolumeDb, maxVolumeDb: audioMetrics.maxVolumeDb,
      cacheHit: ttsBody.cacheHit, audioSignal: "non-silent-and-unclipped", humanListeningReview: "pending",
      note: "ffprobe/volumedetect verify media only; they do not prove spoken wording or pronunciation.",
    };
    await writeFile(path.join(outputDir, "narration-preview-report.json"), JSON.stringify(previewReport, null, 2), { flag: "wx" });
    await persistState({ ...state, phase: "awaiting-user-approval", cacheHit: ttsBody.cacheHit, liveSynthesisCount: ttsBody.cacheHit ? 0 : 1, previewPath, previewSha256, previewDurationSec: audioMetrics.durationSec, previewBytes: previewBytes.length, generatedAt: new Date().toISOString() });
    console.log(JSON.stringify({
      status: "LIVE_PREVIEW_READY — AWAITING USER LISTENING AND APPROVAL",
      provider: ttsStatus.provider, model: ttsStatus.model, sample: sampleName, projectId: project.id,
      voice: selectedVoice.name, durationSec: audioMetrics.durationSec, audioSha256: previewSha256, cacheHit: ttsBody.cacheHit,
      videoQuota: `${appStatus.jobsUsed}/${appStatus.dailyLimit} used`, nextVideoJobAt: appStatus.nextAllowedAt,
      previewMp3: path.relative(process.cwd(), previewPath),
      next: appStatus.jobsUsed >= appStatus.dailyLimit
        ? `Listen in local UI and approve only if narration is correct. Video quota full; after ${appStatus.nextAllowedAt}, run continue to make snapshot, inspect Player, then explicitly run render. No extra synthesis is needed.`
        : "Open local UI, listen and approve audio, run continue to make snapshot, inspect Player, then confirm video review and run render. No second synthesis is sent.",
    }, null, 2));
  }

  if (phase === "continue") {
  const state = JSON.parse(await readFile(statePath, "utf8")) as { phase: string; sampleName: SampleName; projectId: string; cacheKey: string; scriptSha256: string; previewSha256: string; previewDurationSec: number; previewPath: string; cacheHit: boolean; provider: string; model: string; settings: { locale: string; voiceId: string; style: string; speakingRate: number }; jobId?: string };
  if (state.phase === "complete") {
    console.log(`Live E2E already completed: ${path.relative(process.cwd(), outputDir)}. No API request was repeated.`);
  } else {
  if (renderRequested ? !["awaiting-video-review", "render-started"].includes(state.phase) : !["awaiting-user-approval", "audio-approved", "awaiting-video-review"].includes(state.phase)) {
    throw new Error(`Live E2E is in phase '${state.phase}'. No synthesis retry is automatic; inspect ${path.relative(process.cwd(), statePath)}.`);
  }
  const project = await api<any>(`/api/projects/${state.projectId}`);
  if (project.audio?.source !== "tts" || project.audio.tts?.cacheKey !== state.cacheKey || project.audio.tts?.scriptSha256 !== state.scriptSha256) {
    throw new Error(`WAITING FOR USER APPROVAL: listen to ${path.relative(process.cwd(), state.previewPath)}, open project ${state.projectId} in the UI, then explicitly click Gunakan Audio Ini. Continue never approves audio automatically.`);
  }
  if (!project.audioMatchesNarration || !project.audio.tts.approvedAt) throw new Error("Approved Gemini audio is stale or has no persisted approval timestamp.");
  assert.equal(project.audio.tts.provider, state.provider);
  assert.equal(project.audio.tts.model, state.model);
  assert.equal(project.audio.tts.locale, state.settings.locale);
  assert.equal(project.audio.tts.voiceId, state.settings.voiceId);
  assert.equal(project.audio.tts.style, state.settings.style);
  assert.equal(project.audio.tts.speakingRate, state.settings.speakingRate);
  if (project.audio.sha256 !== state.previewSha256) throw new Error("Approved audio SHA-256 differs from the listened preview.");
  const audioApprovedAt = project.audio.tts.approvedAt as string;
  await persistState({ ...state, phase: "audio-approved", audioApprovedAt, userApprovalMethod: "Gunakan Audio Ini in local UI" });
  const previewReportPath = path.join(outputDir, "narration-preview-report.json");
  const previewReport = JSON.parse(await readFile(previewReportPath, "utf8")) as Record<string, unknown>;
  await writeFile(previewReportPath, JSON.stringify({ ...previewReport, userApproved: true, audioApprovedAt, humanListeningReview: "user confirms preview listened and approved in local UI" }, null, 2));

  let job: any;
  if (renderRequested) {
    if (!state.jobId || !project.latestJobCurrent || project.latestJob?.id !== state.jobId) throw new Error("Video preview snapshot is missing or stale. Run continue to create a fresh preview, review it, then render.");
    job = await api<any>(`/api/jobs/${state.jobId}`);
  } else {
    job = project.latestJobCurrent ? project.latestJob : null;
    if (!job) {
      const currentStatus = await api<{ dailyLimit: number; jobsUsed: number; nextAllowedAt: string | null }>("/api/status");
      if (currentStatus.jobsUsed >= currentStatus.dailyLimit) throw new Error(`BLOCKED — production video quota exhausted (${currentStatus.jobsUsed}/${currentStatus.dailyLimit}); approved audio and project remain saved.`);
      const generated = await api<{ job: any }>(`/api/projects/${state.projectId}/generate`, { method: "POST" });
      job = generated.job;
    }
  }
  if (!job) throw new Error("Snapshot job was not created.");
  if (job.rendererVersion !== 2) throw new Error("Live E2E requires a V2 snapshot; no V1 snapshot will be upgraded implicitly.");
  if (!renderRequested) {
    await persistState({ ...state, phase: "awaiting-video-review", jobId: job.id, snapshotCreatedAt: new Date().toISOString() });
    console.log(JSON.stringify({
      status: "VIDEO PREVIEW READY — AWAITING USER REVIEW",
      sample: state.sampleName, projectId: state.projectId, jobId: job.id,
      next: "Open this project in local UI, inspect Player preview/timeline/captions, then set GEMINI_TTS_LIVE_E2E_VIDEO_REVIEWED=I_REVIEWED_VIDEO_PREVIEW and run smoke:gemini-e2e -- render. No render starts automatically.",
    }, null, 2));
  } else {
    if (process.env.GEMINI_TTS_LIVE_E2E_VIDEO_REVIEWED !== "I_REVIEWED_VIDEO_PREVIEW") throw new Error("Render blocked: inspect the V2 Player preview in UI, then set GEMINI_TTS_LIVE_E2E_VIDEO_REVIEWED=I_REVIEWED_VIDEO_PREVIEW.");
  if (job.state === "failed") throw new Error(`Render job ${job.id} already failed; retry explicitly from UI after reviewing error: ${job.error ?? "unknown error"}`);
  if (job.state === "preview-ready") {
    if (job.attemptCount >= 3) throw new Error("Render attempt limit reached; no automatic retry performed.");
    await persistState({ ...state, phase: "render-started", jobId: job.id, renderStartedAt: new Date().toISOString() });
    const start = await fetch(`${baseUrl}/api/jobs/${job.id}/render`, { method: "POST" });
    if (!start.ok && start.status !== 409) throw new Error(`Render did not start (HTTP ${start.status}).`);
  }
  let completed: any = job;
  for (let attempt = 0; attempt < 900; attempt++) {
    completed = await api<any>(`/api/jobs/${job.id}`);
    if (completed.state !== "rendering") break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (completed.state !== "rendered") throw new Error(`Live render did not pass: ${completed.error ?? completed.state}. Job remains available for explicit recovery.`);
  const manifest = completed.manifest;
  assert.equal(manifest.videoCodec, "h264");
  assert.equal(manifest.audioCodec, "aac");
  assert.equal(manifest.width, 1080);
  assert.equal(manifest.height, 1920);
  assert.equal(manifest.audioValidation, "pass", manifest.audioLevelWarning ?? "approved narration must be non-silent and unclipped");
  assert.equal(manifest.audioSource, "tts");
  assert.equal(manifest.audioProvider, "gemini-developer-api");
  assert.equal(manifest.audioModel, ttsStatus.model);
  assert.equal(manifest.audioVoiceId, project.audio.tts.voiceId);
  assert.equal(manifest.audioStyle, project.audio.tts.style);
  assert.equal(manifest.audioSpeakingRate, project.audio.tts.speakingRate);
  assert.equal(manifest.audioScriptSha256, state.scriptSha256);
  assert.equal(manifest.audioSha256, state.previewSha256);
  assert.equal(manifest.audioApprovedAt, project.audio.tts.approvedAt);
  assert.ok(Math.abs(manifest.audioDurationSec - manifest.durationSec) < 0.25, "AAC and video durations should align");

  const mp4Path = path.join(outputDir, `${state.sampleName}.gemini-live.mp4`);
  const mp4Response = await fetch(`${baseUrl}${completed.downloadUrl}`);
  if (!mp4Response.ok) throw new Error(`Rendered MP4 download failed (HTTP ${mp4Response.status}).`);
  const mp4 = Buffer.from(await mp4Response.arrayBuffer());
  const mp4Sha256 = await sha256(mp4);
  assert.equal(mp4Sha256, manifest.sha256, "downloaded MP4 hash must match renderer manifest");
  await writeFile(mp4Path, mp4, { flag: "wx" });
  const ffprobePath = path.join(outputDir, `${state.sampleName}.ffprobe.json`);
  const { stdout: ffprobeOutput } = await execFileAsync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", mp4Path], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  const ffprobe = JSON.parse(ffprobeOutput);
  await writeFile(ffprobePath, JSON.stringify(ffprobe, null, 2), { flag: "wx" });
  await writeFile(path.join(outputDir, `${state.sampleName}.manifest.json`), JSON.stringify({ ...manifest, humanListeningReview: "operator approved preview; semantic accuracy still requires listening review" }, null, 2), { flag: "wx" });
  await writeFile(path.join(outputDir, `${state.sampleName}.audio-validation.json`), JSON.stringify({
    source: "Gemini live TTS", provider: manifest.audioProvider, model: manifest.audioModel,
    voice: manifest.audioVoice, voiceId: manifest.audioVoiceId, locale: manifest.audioLocale, style: manifest.audioStyle, speakingRate: manifest.audioSpeakingRate, approvedAt: manifest.audioApprovedAt,
    scriptSha256: manifest.audioScriptSha256, audioSha256: manifest.audioSha256,
    audioDurationSec: manifest.audioDurationSec, videoDurationSec: manifest.durationSec,
    meanVolumeDb: manifest.audioMeanVolumeDb, maxVolumeDb: manifest.audioMaxVolumeDb,
    validation: manifest.audioValidation, humanListeningReview: "still required for final content/wording verification",
  }, null, 2), { flag: "wx" });
  await persistState({ ...state, phase: "complete", jobId: job.id, outputPath: mp4Path, outputSha256: mp4Sha256, completedAt: new Date().toISOString() });
  console.log(JSON.stringify({
    status: "PASS — Gemini-approved narration rendered and validated",
    synthesis: state.cacheHit ? "cached live Gemini asset; no new synthesis in this step" : "one live full-narration synthesis",
    sample: state.sampleName, projectId: state.projectId, jobId: job.id,
    provider: manifest.audioProvider, model: manifest.audioModel, voice: manifest.audioVoice,
    mp4: path.relative(process.cwd(), mp4Path), bytes: mp4.length, sha256: mp4Sha256,
    durationSec: manifest.durationSec, audioMeanVolumeDb: manifest.audioMeanVolumeDb, audioMaxVolumeDb: manifest.audioMaxVolumeDb,
    audioValidation: manifest.audioValidation, humanListeningReview: "operator approval recorded; spoken wording still needs final listening review",
  }, null, 2));
  }
  }
  }
} finally {
  await stopServer();
}
