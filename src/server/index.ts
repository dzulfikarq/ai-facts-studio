import "dotenv/config";
import express from "express";
import multer from "multer";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { canStartNewJob } from "../domain/timeline";
import { parseResearchPackage, researchWarnings } from "../domain/research";
import { estimateSceneTimings, narrationScript } from "../domain/voice-timing";
import { invalidateBundleCache, renderSnapshot, type RenderSnapshot } from "../../scripts/render-core";
import { LEGACY_RENDERER_VERSION, RENDERER_VERSION } from "../video/renderer-version";
import { dataDir, db, jobForClient, projectFromRow, type JobRow, type StoredAudio, type StoredProject } from "./database";
import { getAiGenerationSettings, isLoopbackAddress, writeAiGenerationMode } from "./ai-generation/provider";
import { createSpeechProvider, SpeechProviderError, ttsCacheKey, type SpeechAudio, type SpeechVoice, type SpeechVoiceCatalog } from "./tts/provider";

const execFileAsync = promisify(execFile);
const app = express();
const root = process.cwd();
const audioDir = path.resolve(root, "public/audio");
const jobDir = path.join(dataDir, "jobs");
const renderDir = path.resolve(root, "renders");
const samplePath = path.resolve(root, "samples/mountain-formation.json");
const cleanupRoots = { audio: audioDir, jobs: jobDir, renders: renderDir };
type CleanupRoot = keyof typeof cleanupRoots;
const maxUploadMb = Math.max(1, Number(process.env.MAX_UPLOAD_MB ?? 100));
const dailyLimit = Math.max(1, Number(process.env.DAILY_JOB_LIMIT ?? 1));
const ttsDailyLimit = Math.max(1, Number(process.env.GEMINI_TTS_DAILY_REQUEST_LIMIT ?? 10));
const maxTtsCharacters = 6000;
let activeRenderJob: string | null = null;
let activeJobCreation = false;
const activeTtsKeys = new Set<string>();
const activeProjectTasks = new Set<string>();
const speechProvider = await createSpeechProvider();
const audioUpload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, done) => done(null, audioDir),
    filename: (_request, file, done) => {
      const extension = path.extname(file.originalname).toLowerCase();
      done(null, `${randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, done) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (![".mp3", ".wav", ".m4a"].includes(extension)) return done(new Error("Unggah MP3, WAV, atau M4A."));
    done(null, true);
  },
});

await mkdir(audioDir, { recursive: true });
await mkdir(jobDir, { recursive: true });
await mkdir(renderDir, { recursive: true });
app.use(express.json({ limit: "1mb" }));

function projectRow(id: string) {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as { id: string; data_json: string; created_at: string; updated_at: string } | undefined;
}

function snapshotForProject(project: StoredProject): RenderSnapshot {
  const extension = project.audio ? path.extname(project.audio.file) : "";
  return {
    research: project.researchPackage,
    rendererVersion: RENDERER_VERSION,
    audio: project.audio ? {
      file: `audio/jobs/${project.audio.sha256}${extension}`,
      durationSec: project.audio.durationSec,
      timingMode: project.audio.timingMode,
      source: project.audio.source,
      sha256: project.audio.sha256,
      tts: project.audio.tts ? {
        provider: project.audio.tts.provider,
        model: project.audio.tts.model,
        cacheKey: project.audio.tts.cacheKey,
        scriptSha256: project.audio.tts.scriptSha256,
        locale: project.audio.tts.locale,
        voiceId: project.audio.tts.voiceId,
        voiceName: project.audio.tts.voiceName,
        style: project.audio.tts.style,
        speakingRate: project.audio.tts.speakingRate,
        approvedAt: project.audio.tts.approvedAt,
        alignment: project.audio.tts.alignment,
      } : undefined,
    } : null,
  };
}

function snapshotContentMatchesProject(snapshotPath: string, project: StoredProject) {
  const resolved = path.resolve(snapshotPath);
  if (!resolved.startsWith(`${jobDir}${path.sep}`)) return false;
  try {
    const snapshot = JSON.parse(readFileSync(resolved, "utf8")) as RenderSnapshot;
    const oldResearch = parseResearchPackage(snapshot.research);
    const currentResearch = parseResearchPackage(project.researchPackage);
    if (!oldResearch.success || !currentResearch.success) return false;
    const audioContent = (audio: RenderSnapshot["audio"]) => audio ? { file: audio.file, durationSec: audio.durationSec, timingMode: audio.timingMode ?? "scaled" } : null;
    const oldContent = { research: oldResearch.data, audio: audioContent(snapshot.audio) };
    const currentContent = { research: currentResearch.data, audio: audioContent(snapshotForProject(project).audio) };
    return JSON.stringify(oldContent) === JSON.stringify(currentContent);
  } catch { return false; }
}

function getProject(id: string) {
  const row = projectRow(id);
  if (!row) return null;
  const project = projectFromRow(row);
  const pendingAsset = project.pendingTts
    ? db.prepare("SELECT * FROM tts_assets WHERE cache_key = ?").get(project.pendingTts.cacheKey) as TtsAssetRow | undefined
    : undefined;
  const latest = db.prepare("SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").get(id) as JobRow | undefined;
  const currentScriptSha = createHash("sha256").update(narrationScript(project.researchPackage)).digest("hex");
  const audioMatchesNarration = project.audio?.source === "tts"
    ? project.audio.tts?.scriptSha256 === currentScriptSha
    : true;
  const latestJobContentCurrent = Boolean(latest && (
    latest.source_sha256 === createHash("sha256").update(JSON.stringify(snapshotForProject(project))).digest("hex")
    || snapshotContentMatchesProject(latest.snapshot_path, project)
  ));
  const latestJobCurrent = Boolean(latest && latestJobContentCurrent && latest.renderer_version === RENDERER_VERSION);
  const pendingTts = pendingAsset && existsSync(path.resolve(root, "public", pendingAsset.file))
    ? { ...project.pendingTts!, audioUrl: `/${pendingAsset.file}`, durationSec: pendingAsset.duration_sec, bytes: pendingAsset.bytes, voiceName: pendingAsset.voice_name, locale: pendingAsset.locale, style: pendingAsset.style, speakingRate: pendingAsset.speaking_rate, generatedAt: pendingAsset.created_at }
    : null;
  return { ...project, pendingTts, pendingTtsMatchesNarration: project.pendingTts?.scriptSha256 === currentScriptSha, audioMatchesNarration, latestJobCurrent, latestJobContentCurrent, latestJob: jobForClient(latest) };
}

function saveProject(id: string, project: StoredProject) {
  const now = new Date().toISOString();
  db.prepare("UPDATE projects SET title = ?, data_json = ?, updated_at = ? WHERE id = ?")
    .run(project.researchPackage.title, JSON.stringify(project), now, id);
}

function withTransaction<T>(action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* BEGIN/COMMIT may already have failed */ }
    throw error;
  }
}

function apiError(response: express.Response, status: number, message: string, extra: object = {}) {
  response.status(status).json({ error: message, ...extra });
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function queueFileCleanup(rootName: CleanupRoot, targetPath: string) {
  const base = cleanupRoots[rootName];
  const target = path.resolve(targetPath);
  const relativePath = path.relative(base, target);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath) || rootName === "audio" && path.dirname(target) !== audioDir) {
    throw new Error("Cleanup path keluar dari direktori yang diizinkan.");
  }
  db.prepare("INSERT OR IGNORE INTO file_cleanup_queue (root, relative_path, created_at) VALUES (?, ?, ?)")
    .run(rootName, relativePath, new Date().toISOString());
}

let cleanupRun: Promise<number> | null = null;

function processFileCleanupQueue(): Promise<number> {
  if (cleanupRun) return cleanupRun;
  cleanupRun = runFileCleanupQueue().finally(() => { cleanupRun = null; });
  return cleanupRun;
}

async function runFileCleanupQueue() {
  const queue = db.prepare("SELECT root, relative_path FROM file_cleanup_queue ORDER BY created_at").all() as Array<{ root: string; relative_path: string }>;
  for (const item of queue) {
    const base = cleanupRoots[item.root as CleanupRoot];
    const target = base ? path.resolve(base, item.relative_path) : "";
    const relative = base ? path.relative(base, target) : "";
    if (!base || !relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || item.root === "audio" && path.dirname(target) !== audioDir) {
      db.prepare("UPDATE file_cleanup_queue SET attempt_count = attempt_count + 1, last_error = ? WHERE root = ? AND relative_path = ?")
        .run("Cleanup path invalid/outside allowed root.", item.root, item.relative_path);
      continue;
    }
    try {
      await rm(target, { recursive: true, force: true });
      db.prepare("DELETE FROM file_cleanup_queue WHERE root = ? AND relative_path = ?").run(item.root, item.relative_path);
    } catch (error) {
      db.prepare("UPDATE file_cleanup_queue SET attempt_count = attempt_count + 1, last_error = ? WHERE root = ? AND relative_path = ?")
        .run(error instanceof Error ? error.message.slice(0, 500) : "Cleanup gagal.", item.root, item.relative_path);
    }
  }
  return (db.prepare("SELECT COUNT(*) AS count FROM file_cleanup_queue").get() as { count: number }).count;
}

async function tryProcessFileCleanupQueue(): Promise<number | null> {
  try { return await processFileCleanupQueue(); }
  catch (error) {
    console.error("Cleanup queue processing failed:", error instanceof Error ? error.message : "unknown error");
    return null;
  }
}

async function removeOrQueueCleanup(rootName: CleanupRoot, targetPath: string) {
  try { await rm(targetPath, { recursive: true, force: true }); }
  catch {
    try { queueFileCleanup(rootName, targetPath); await processFileCleanupQueue(); }
    catch (error) { console.error("File cleanup failed and could not be queued:", error instanceof Error ? error.message : "unknown error"); }
  }
}

app.get("/api/status", async (_request, response) => {
  let ffmpegAvailable = false;
  try {
    await execFileAsync("ffmpeg", ["-version"], { timeout: 5000 });
    ffmpegAvailable = true;
  } catch { /* status only; render reports actionable error */ }
  const recent = db.prepare("SELECT created_at FROM video_job_requests WHERE created_at > ? ORDER BY created_at ASC")
    .all(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) as Array<{ created_at: string }>;
  const allowance = canStartNewJob(recent.map((row) => row.created_at), Date.now(), dailyLimit);
  response.json({ ffmpegAvailable, githubWorkflowAvailable: existsSync(path.resolve(root, ".github/workflows/render-video.yml")), dailyLimit, jobsUsed: recent.length, nextAllowedAt: allowance.nextAllowedAt });
});

const aiGenerationModeSchema = z.object({ mode: z.enum(["development", "production"]) }).strict();
const localSettingsOnly = (request: express.Request, response: express.Response) => {
  if (isLoopbackAddress(request.socket.remoteAddress)) return true;
  apiError(response, 403, "AI Generation Settings hanya bisa dibaca dan diubah dari perangkat lokal.", { code: "local-only" });
  return false;
};

app.get("/api/settings/ai-generation", (request, response) => {
  if (!localSettingsOnly(request, response)) return;
  response.json(getAiGenerationSettings(db));
});

app.put("/api/settings/ai-generation", (request, response) => {
  if (!localSettingsOnly(request, response)) return;
  const parsed = aiGenerationModeSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "AI Generation Mode harus Development atau Production.", { code: "invalid-ai-generation-mode", issues: parsed.error.issues });
  const settings = getAiGenerationSettings(db);
  if (parsed.data.mode === "production" && !settings.providers.production.configured) {
    return apiError(response, 409, settings.providers.production.disabledReason ?? "Production belum dikonfigurasi.", { code: "ai-generation-unconfigured" });
  }
  writeAiGenerationMode(db, parsed.data.mode);
  response.json(getAiGenerationSettings(db));
});

app.get("/api/tts/status", (_request, response) => {
  response.json({ provider: speechProvider.id, providerName: speechProvider.displayName, model: speechProvider.model, freeTierOnly: speechProvider.freeTierOnly, configured: speechProvider.configured, disabledReason: speechProvider.disabledReason, ...ttsQuotaStatus() });
});

function ttsQuotaStatus() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const requestsUsed = (db.prepare("SELECT COUNT(*) AS count FROM tts_attempts WHERE requested_at > ?").get(since) as { count: number }).count;
  return { dailyLimit: ttsDailyLimit, requestsUsed, requestsRemaining: Math.max(0, ttsDailyLimit - requestsUsed) };
}

app.get("/api/tts/voices", async (request, response) => {
  const localeValue = request.query.locale;
  const locale = typeof localeValue === "string" ? localeValue : "id-ID";
  if (!/^[a-z]{2}-[A-Z]{2}$/.test(locale)) return apiError(response, 400, "Locale harus berbentuk xx-XX.");
  try {
    const catalog = await speechProvider.listVoices(locale);
    response.json({
      provider: speechProvider.id,
      providerName: speechProvider.displayName,
      model: speechProvider.model,
      freeTierOnly: speechProvider.freeTierOnly,
      configured: speechProvider.configured,
      locales: catalog.locales,
      voices: catalog.voices,
      catalogSource: catalog.source,
      catalogWarning: catalog.warning,
      ...ttsQuotaStatus(),
      message: speechProvider.configured ? undefined : speechProvider.disabledReason,
    });
  } catch (error) {
    if (error instanceof SpeechProviderError) return apiError(response, error.httpStatus, error.message, { code: error.code });
    apiError(response, 502, "Daftar voice TTS gagal dimuat.");
  }
});

app.get("/api/sample", async (_request, response) => {
  response.json(JSON.parse(await readFile(samplePath, "utf8")));
});

app.get("/api/docs/github-actions", async (_request, response) => {
  response.type("text/markdown").send(await readFile(path.resolve(root, "docs/GITHUB_ACTIONS_SETUP.md"), "utf8"));
});

app.get("/api/docs/tts", async (_request, response) => {
  response.type("text/markdown").send(await readFile(path.resolve(root, "docs/TTS_SETUP.md"), "utf8"));
});

app.get("/api/projects", (_request, response) => {
  const rows = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as Array<{ id: string; data_json: string; created_at: string; updated_at: string }>;
  response.json(rows.map((row) => getProject(row.id)));
});

app.get("/api/projects/:id", (request, response) => {
  const project = getProject(request.params.id);
  if (!project) return apiError(response, 404, "Project tidak ditemukan.");
  response.json(project);
});

app.post("/api/projects", (request, response) => {
  const parsed = parseResearchPackage(request.body?.researchPackage);
  if (!parsed.success) return apiError(response, 400, "Research package tidak valid.", { issues: parsed.error.issues });
  const id = randomUUID();
  const now = new Date().toISOString();
  const stored: StoredProject = { researchPackage: parsed.data, audio: null, pendingTts: null, researchReviewStatus: "needs-review" };
  db.prepare("INSERT INTO projects (id, title, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, parsed.data.title, JSON.stringify(stored), now, now);
  response.status(201).json(getProject(id));
});

app.put("/api/projects/:id", (request, response) => {
  const row = projectRow(request.params.id);
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  const parsed = parseResearchPackage(request.body?.researchPackage);
  if (!parsed.success) return apiError(response, 400, "Research package tidak valid.", { issues: parsed.error.issues });
  const project = projectFromRow(row);
  project.researchPackage = parsed.data;
  project.researchReviewStatus = "needs-review";
  if (project.pendingTts && project.pendingTts.scriptSha256 !== createHash("sha256").update(narrationScript(parsed.data)).digest("hex")) project.pendingTts = null;
  saveProject(row.id, project);
  response.json(getProject(row.id));
});

app.post("/api/projects/:id/audio", audioUpload.single("audio"), async (request, response) => {
  const id = String(request.params.id);
  if (!projectRow(id)) {
    if (request.file) await removeOrQueueCleanup("audio", request.file.path);
    return apiError(response, 404, "Project tidak ditemukan.");
  }
  if (!request.file) return apiError(response, 400, "File audio tidak ditemukan.");
  if (activeRenderJob) {
    await removeOrQueueCleanup("audio", request.file.path);
    return apiError(response, 409, "Audio tidak dapat diubah saat render berjalan.");
  }
  if (activeProjectTasks.has(id)) {
    await removeOrQueueCleanup("audio", request.file.path);
    return apiError(response, 409, "Project sedang memproses audio atau snapshot.");
  }
  activeProjectTasks.add(id);
  let audioCommitted = false;
  try {
    const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", request.file.path], { timeout: 20_000, maxBuffer: 1024 * 1024 });
    const probe = JSON.parse(stdout) as { streams?: Array<{ codec_type: string }>; format?: { duration?: string } };
    const durationSec = Number(probe.format?.duration ?? 0);
    if (!probe.streams?.some((stream) => stream.codec_type === "audio") || !Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 120) {
      throw new Error("File audio tidak terbaca atau durasinya di luar batas 1–120 detik.");
    }
    const sha256 = await sha256File(request.file.path);
    if (activeRenderJob) {
      await removeOrQueueCleanup("audio", request.file.path);
      return apiError(response, 409, "Audio tidak dapat diubah saat render berjalan.");
    }
    const row = projectRow(id);
    if (!row) {
      await removeOrQueueCleanup("audio", request.file.path);
      return apiError(response, 404, "Project tidak ditemukan.");
    }
    const project = projectFromRow(row);
    const previousUpload = project.audio?.source === "upload" ? path.resolve(root, "public", project.audio.file) : null;
    project.audio = {
      file: `audio/${request.file.filename}`,
      name: request.file.originalname.slice(0, 200),
      durationSec,
      bytes: request.file.size,
      sha256,
      source: "upload",
      timingMode: "scaled",
    };
    withTransaction(() => {
      saveProject(row.id, project);
      if (previousUpload && path.dirname(previousUpload) === audioDir) queueFileCleanup("audio", previousUpload);
    });
    audioCommitted = true;
    invalidateBundleCache();
    const cleanupPending = await tryProcessFileCleanupQueue();
    response.status(201).json({ ...getProject(row.id), cleanupPending });
  } catch (error) {
    if (audioCommitted) {
      const cleanupPending = await tryProcessFileCleanupQueue();
      const saved = projectRow(id);
      if (saved && !response.headersSent) return response.status(201).json({ ...getProject(id), cleanupPending });
    } else {
      await removeOrQueueCleanup("audio", request.file.path);
    }
    if (response.headersSent) return;
    apiError(response, error instanceof Error && error.message.startsWith("File audio") ? 400 : 500, error instanceof Error && error.message.startsWith("File audio") ? error.message : "Audio gagal divalidasi atau disimpan.");
  } finally {
    activeProjectTasks.delete(id);
  }
});

app.delete("/api/projects/:id/audio", async (request, response) => {
  if (activeRenderJob) return apiError(response, 409, "Audio tidak dapat diubah saat render berjalan.");
  const id = String(request.params.id);
  if (activeProjectTasks.has(id)) return apiError(response, 409, "Project sedang memproses audio atau snapshot.");
  const row = projectRow(id);
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  activeProjectTasks.add(id);
  const project = projectFromRow(row);
  const previousUpload = project.audio?.source === "upload" ? path.resolve(root, "public", project.audio.file) : null;
  project.audio = null;
  try {
    withTransaction(() => {
      saveProject(row.id, project);
      if (previousUpload && path.dirname(previousUpload) === audioDir) queueFileCleanup("audio", previousUpload);
    });
    invalidateBundleCache();
    const cleanupPending = await tryProcessFileCleanupQueue();
    response.json({ ...getProject(row.id), cleanupPending });
  } catch (error) {
    apiError(response, 500, "Audio tidak dapat dilepas dengan aman.");
  } finally {
    activeProjectTasks.delete(id);
  }
});

app.delete("/api/projects/:id", async (request, response) => {
  const id = String(request.params.id);
  const row = projectRow(id);
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  const jobs = db.prepare("SELECT id FROM jobs WHERE project_id = ?").all(id) as Array<{ id: string }>;
  if (activeRenderJob && jobs.some((job) => job.id === activeRenderJob)) return apiError(response, 409, "Project tidak dapat dihapus saat render berjalan.");
  if (activeProjectTasks.has(id)) return apiError(response, 409, "Project sedang memproses audio atau snapshot.");

  const project = projectFromRow(row);
  const uploadPath = project.audio?.source === "upload" ? path.resolve(root, "public", project.audio.file) : null;
  const safeUploadPath = uploadPath && path.dirname(uploadPath) === audioDir ? uploadPath : null;
  withTransaction(() => {
    if (safeUploadPath) queueFileCleanup("audio", safeUploadPath);
    for (const job of jobs) {
      queueFileCleanup("jobs", path.join(jobDir, job.id));
      queueFileCleanup("renders", path.join(renderDir, job.id));
    }
    db.prepare("DELETE FROM render_attempts WHERE job_id IN (SELECT id FROM jobs WHERE project_id = ?)").run(id);
    db.prepare("DELETE FROM jobs WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  });
  invalidateBundleCache();
  const cleanupPending = await tryProcessFileCleanupQueue();
  response.json({ deleted: true, cleanupPending });
});

const ttsSettingsSchema = z.object({
  locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),
  voiceId: z.string().min(1).max(160),
  style: z.enum(["neutral", "warm", "energetic", "calm", "documentary"]).default("documentary"),
  speakingRate: z.number().min(0.7).max(1.3),
}).strict();
const ttsRequestSchema = ttsSettingsSchema.extend({ regenerate: z.boolean().default(false) }).strict();

type TtsAssetRow = {
  cache_key: string;
  script_sha256: string;
  provider: string;
  model: string;
  locale: string;
  voice_id: string;
  voice_name: string;
  gender: string;
  voice_availability: "api" | "fallback";
  speaking_rate: number;
  style: string;
  file: string;
  duration_sec: number;
  bytes: number;
  audio_sha256: string;
  words_per_minute: number;
  created_at: string;
};

async function probeTtsAudio(buffer: Buffer) {
  if (!buffer.length || buffer.length > 25 * 1024 * 1024) throw new Error("Ukuran audio TTS kosong atau melebihi 25 MB.");
  const temporaryPath = path.join(audioDir, `${randomUUID()}.probe.mp3`);
  await writeFile(temporaryPath, buffer, { flag: "wx" });
  try {
    const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", temporaryPath], { timeout: 20_000, maxBuffer: 1024 * 1024 });
    const probe = JSON.parse(stdout) as { streams?: Array<{ codec_type: string; codec_name: string }>; format?: { duration?: string } };
    const audioStream = probe.streams?.find((stream) => stream.codec_type === "audio");
    const durationSec = Number(probe.format?.duration ?? 0);
    if (!audioStream || audioStream.codec_name !== "mp3" || !Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 120) {
      throw new Error("Audio TTS tidak valid: butuh MP3 berdurasi 0–120 detik.");
    }
    const { stderr } = await execFileAsync("ffmpeg", ["-hide_banner", "-nostats", "-i", temporaryPath, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"], { timeout: 60_000, maxBuffer: 1024 * 1024 });
    const mean = stderr.match(/mean_volume:\s*(-?[\d.]+|-inf)\s+dB/);
    const peak = stderr.match(/max_volume:\s*(-?[\d.]+|-inf)\s+dB/);
    const meanVolumeDb = mean?.[1] && mean[1] !== "-inf" ? Number(mean[1]) : Number.NEGATIVE_INFINITY;
    const maxVolumeDb = peak?.[1] && peak[1] !== "-inf" ? Number(peak[1]) : Number.NEGATIVE_INFINITY;
    if (meanVolumeDb <= -45) throw new Error("Audio TTS senyap atau terlalu pelan (mean ≤ -45 dB).");
    if (maxVolumeDb >= -0.1) throw new Error("Audio TTS berpotensi clipping (peak ≥ -0.1 dBFS).");
    return { durationSec, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") };
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function normalizeGeminiAudio(input: SpeechAudio) {
  const mimeType = input.mimeType.split(";")[0]!.trim().toLowerCase();
  if (mimeType !== "audio/wav") throw new SpeechProviderError(`Gemini mengembalikan format audio tak didukung (${mimeType}).`, "invalid-audio", 502);
  if (!input.data.length || input.data.length > 25 * 1024 * 1024) throw new SpeechProviderError("Gemini WAV kosong atau melewati batas 25 MB.", "invalid-audio", 502);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "facts-gemini-tts-"));
  const wavPath = path.join(tempDir, "input.wav");
  const mp3Path = path.join(tempDir, "normalized.mp3");
  try {
    await writeFile(wavPath, input.data, { flag: "wx" });
    await execFileAsync("ffmpeg", [
      "-y", "-v", "error", "-i", wavPath, "-map", "0:a:0", "-vn",
      "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", "-ac", "1",
      "-c:a", "libmp3lame", "-b:a", "128k", mp3Path,
    ], { timeout: 60_000, maxBuffer: 1024 * 1024 });
    const data = await readFile(mp3Path);
    return { data, ...(await probeTtsAudio(data)) };
  } catch (error) {
    if (error instanceof SpeechProviderError) throw error;
    throw new Error("FFmpeg gagal menormalisasi audio Gemini.");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

type TtsSettings = z.infer<typeof ttsSettingsSchema>;

const testVoiceSamples: Record<string, string> = {
  "id-ID": "Halo, ini contoh suara AI Facts Studio. Dengarkan nada dan kejelasannya sebelum membuat narasi lengkap.",
  "en-US": "Hello, this is a short AI Facts Studio voice sample. Listen to its tone and clarity before creating your full narration.",
  "en-GB": "Hello, this is a short AI Facts Studio voice sample. Listen to its tone and clarity before creating your full narration.",
  "es-ES": "Hola, esta es una muestra de voz de AI Facts Studio. Escucha el tono y la claridad antes de crear la narración completa.",
  "fr-FR": "Bonjour, voici un exemple de voix AI Facts Studio. Écoutez le ton et la clarté avant de créer votre narration complète.",
  "de-DE": "Hallo, dies ist eine kurze AI Facts Studio Sprachprobe. Achte auf Klang und Klarheit, bevor du die vollständige Erzählung erstellst.",
  "ja-JP": "こんにちは。これはAI Facts Studioの音声サンプルです。ナレーションを作成する前に、声の調子と明瞭さをお確かめください。",
  "ko-KR": "안녕하세요. AI Facts Studio 음성 샘플입니다. 전체 내레이션을 만들기 전에 목소리의 톤과 선명도를 확인해 보세요.",
  "zh-CN": "你好，这是 AI Facts Studio 的语音示例。生成完整旁白前，请先试听声音的语气和清晰度。",
  "hi-IN": "नमस्ते, यह AI Facts Studio की आवाज़ का नमूना है। पूरा वर्णन बनाने से पहले इसका स्वर और स्पष्टता सुनें।",
  "pt-BR": "Olá, esta é uma amostra de voz do AI Facts Studio. Ouça o tom e a clareza antes de criar a narração completa.",
  "it-IT": "Ciao, questo è un esempio di voce AI Facts Studio. Ascolta tono e chiarezza prima di creare la narrazione completa.",
  "ar-EG": "مرحبًا، هذا نموذج صوتي من AI Facts Studio. استمع إلى نبرة الصوت ووضوحه قبل إنشاء السرد الكامل.",
  "vi-VN": "Xin chào, đây là giọng đọc mẫu của AI Facts Studio. Hãy nghe ngữ điệu và độ rõ trước khi tạo lời thuyết minh đầy đủ.",
  "th-TH": "สวัสดี นี่คือตัวอย่างเสียงจาก AI Facts Studio ลองฟังน้ำเสียงและความชัดเจนก่อนสร้างบทบรรยายฉบับเต็ม",
  "ru-RU": "Здравствуйте, это короткий пример голоса AI Facts Studio. Оцените интонацию и чёткость перед созданием полной озвучки.",
  "ms-MY": "Helo, ini contoh suara AI Facts Studio. Dengar nada dan kejelasannya sebelum menghasilkan narasi penuh.",
  "jv-ID": "Halo, iki tuladha swara AI Facts Studio. Rungokna intonasi lan cethane swara sadurunge nggawe narasi lengkap.",
};

function voiceFromAsset(asset: TtsAssetRow): SpeechVoice {
  return { id: asset.voice_id, name: asset.voice_name, locale: asset.locale, localeName: asset.locale, gender: asset.gender, description: "Cached Gemini voice", wordsPerMinute: asset.words_per_minute, availability: asset.voice_availability };
}

async function createTtsAsset(text: string, settings: TtsSettings, regenerate = false) {
  const scriptSha256 = createHash("sha256").update(text).digest("hex");
  const cacheKey = ttsCacheKey({ provider: speechProvider.id, model: speechProvider.model, scriptSha256, ...settings });
  const getCached = () => db.prepare("SELECT * FROM tts_assets WHERE cache_key = ?").get(cacheKey) as TtsAssetRow | undefined;
  let cached = getCached();
  if (cached && existsSync(path.resolve(root, "public", cached.file)) && !regenerate) {
    return { asset: cached, voice: voiceFromAsset(cached), cacheHit: true, scriptSha256 };
  }
  if (cached && !existsSync(path.resolve(root, "public", cached.file))) {
    db.prepare("DELETE FROM tts_assets WHERE cache_key = ?").run(cacheKey);
    cached = undefined;
  }
  if (!speechProvider.configured) throw new SpeechProviderError(speechProvider.disabledReason ?? "Gemini Free Tier tidak tersedia. Upload audio sendiri tetap tersedia.", "not-configured", 503);
  if (activeTtsKeys.has(cacheKey)) throw new SpeechProviderError("Generate audio untuk pilihan ini sedang berjalan.", "duplicate-request", 409);
  const catalog = await speechProvider.listVoices(settings.locale);
  if (activeTtsKeys.has(cacheKey)) throw new SpeechProviderError("Generate audio untuk pilihan ini sedang berjalan.", "duplicate-request", 409);
  const voice = catalog.voices.find((item) => item.id === settings.voiceId);
  if (!voice) throw new SpeechProviderError("Voice tidak tersedia untuk bahasa yang dipilih. Muat ulang daftar voice.", "voice-unavailable", 400);

  const nowMs = Date.now();
  const dayAgo = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const globalAttempts = (db.prepare("SELECT COUNT(*) AS count FROM tts_attempts WHERE requested_at > ?").get(dayAgo) as { count: number }).count;
  const keyAttempts = (db.prepare("SELECT COUNT(*) AS count FROM tts_attempts WHERE cache_key = ? AND requested_at > ?").get(cacheKey, dayAgo) as { count: number }).count;
  if (globalAttempts >= ttsDailyLimit) throw new SpeechProviderError(`Batas ${ttsDailyLimit} panggilan TTS per 24 jam tercapai.`, "daily-tts-limit", 429);
  if (keyAttempts >= 3) throw new SpeechProviderError("Batas tiga percobaan untuk naskah/voice ini per 24 jam tercapai.", "tts-retry-limit", 429);

  activeTtsKeys.add(cacheKey);
  const attemptId = randomUUID();
  let attemptRecorded = false;
  try {
    db.prepare("INSERT INTO tts_attempts (id, cache_key, requested_at, state) VALUES (?, ?, ?, ?)").run(attemptId, cacheKey, new Date().toISOString(), "started");
    attemptRecorded = true;
    const generated = await speechProvider.synthesize({ text, ...settings });
    const media = await normalizeGeminiAudio(generated);
    const audioFile = `audio/tts/${media.sha256}.mp3`;
    const audioPath = path.resolve(root, "public", audioFile);
    await mkdir(path.dirname(audioPath), { recursive: true });
    if (!existsSync(audioPath)) {
      const temporaryPath = `${audioPath}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, media.data, { flag: "wx" });
      await rename(temporaryPath, audioPath);
    }
    const createdAt = new Date().toISOString();
    db.prepare(`INSERT INTO tts_assets (cache_key, script_sha256, provider, model, locale, voice_id, voice_name, gender, voice_availability, speaking_rate, style, file, duration_sec, bytes, audio_sha256, words_per_minute, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET provider=excluded.provider, model=excluded.model, locale=excluded.locale, voice_id=excluded.voice_id, voice_name=excluded.voice_name, gender=excluded.gender, voice_availability=excluded.voice_availability, speaking_rate=excluded.speaking_rate, style=excluded.style, file=excluded.file, duration_sec=excluded.duration_sec, bytes=excluded.bytes, audio_sha256=excluded.audio_sha256, words_per_minute=excluded.words_per_minute, created_at=excluded.created_at`)
      .run(cacheKey, scriptSha256, speechProvider.id, speechProvider.model, settings.locale, voice.id, voice.name, voice.gender, voice.availability, settings.speakingRate, settings.style, audioFile, media.durationSec, media.bytes, media.sha256, voice.wordsPerMinute, createdAt);
    db.prepare("UPDATE tts_attempts SET state = ? WHERE id = ?").run("completed", attemptId);
    return { asset: getCached()!, voice, cacheHit: false, scriptSha256 };
  } catch (error) {
    const code = error instanceof SpeechProviderError ? error.code : error instanceof Error && /audio|ffmpeg/i.test(error.message) ? "invalid-audio" : "synthesis-failed";
    if (attemptRecorded) db.prepare("UPDATE tts_attempts SET state = ?, error_code = ? WHERE id = ?").run("failed", code, attemptId);
    throw error;
  } finally {
    activeTtsKeys.delete(cacheKey);
  }
}

function sendTtsError(response: express.Response, error: unknown) {
  if (error instanceof SpeechProviderError) return apiError(response, error.httpStatus, error.message, { code: error.code });
  if (error instanceof Error && /audio|ffmpeg/i.test(error.message)) return apiError(response, 502, error.message, { code: "invalid-audio" });
  return apiError(response, 502, "Gemini TTS gagal. Periksa Free Tier, kuota, koneksi, dan FFmpeg. Audio terpilih sebelumnya tetap dipakai.", { code: "synthesis-failed" });
}

function ttsPreview(asset: TtsAssetRow, scriptSha256: string) {
  return { cacheKey: asset.cache_key, scriptSha256, audioUrl: `/${asset.file}`, durationSec: asset.duration_sec, bytes: asset.bytes, voiceName: asset.voice_name, locale: asset.locale, style: asset.style, speakingRate: asset.speaking_rate, generatedAt: asset.created_at };
}

app.post("/api/tts/test-voice", async (request, response) => {
  const parsed = ttsSettingsSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "Pilihan Test Voice tidak valid.", { issues: parsed.error.issues });
  const text = testVoiceSamples[parsed.data.locale] ?? testVoiceSamples["en-US"]!;
  try {
    const result = await createTtsAsset(text, parsed.data);
    response.json({ preview: { ...ttsPreview(result.asset, result.scriptSha256), text }, cacheHit: result.cacheHit });
  } catch (error) { sendTtsError(response, error); }
});

async function attachTtsAudio(projectId: string, asset: TtsAssetRow, scriptSha256: string) {
  const row = projectRow(projectId);
  if (!row) throw new SpeechProviderError("Project tidak ditemukan.", "project-not-found", 404);
  const project = projectFromRow(row);
  if (project.pendingTts?.cacheKey !== asset.cache_key || project.pendingTts.scriptSha256 !== scriptSha256) {
    throw new SpeechProviderError("Preview berubah sebelum disetujui. Periksa preview terbaru.", "preview-changed", 409);
  }
  if (createHash("sha256").update(narrationScript(project.researchPackage)).digest("hex") !== scriptSha256) {
    throw new SpeechProviderError("Naskah berubah setelah preview dibuat. Buat pratinjau baru sebelum memakai audio.", "script-changed", 409);
  }
  const ttsAudioPath = path.resolve(root, "public", asset.file);
  if (!existsSync(ttsAudioPath)) throw new SpeechProviderError("Audio preview tidak ditemukan. Buat ulang pratinjau.", "audio-not-found", 410);
  if (await sha256File(ttsAudioPath) !== asset.audio_sha256) throw new SpeechProviderError("Audio preview rusak atau berubah. Buat ulang pratinjau.", "audio-integrity-failed", 409);
  const previousUpload = project.audio?.source === "upload" ? path.resolve(root, "public", project.audio.file) : null;
  project.researchPackage = estimateSceneTimings(project.researchPackage, asset.duration_sec, asset.words_per_minute, asset.speaking_rate);
  const audio: StoredAudio = {
    file: asset.file,
    name: `AI Voice · ${asset.voice_name}`,
    durationSec: asset.duration_sec,
    bytes: asset.bytes,
    sha256: asset.audio_sha256,
    source: "tts",
    timingMode: "estimated",
    tts: {
      provider: asset.provider,
      model: asset.model,
      cacheKey: asset.cache_key,
      scriptSha256,
      locale: asset.locale,
      voiceId: asset.voice_id,
      voiceName: asset.voice_name,
      gender: asset.gender,
      voiceAvailability: asset.voice_availability,
      speakingRate: asset.speaking_rate,
      style: asset.style,
      generatedAt: asset.created_at,
      approvedAt: new Date().toISOString(),
      alignment: "estimated",
    },
  };
  project.pendingTts = null;
  project.audio = audio;
  withTransaction(() => {
    saveProject(projectId, project);
    if (previousUpload && path.dirname(previousUpload) === audioDir) queueFileCleanup("audio", previousUpload);
  });
  invalidateBundleCache();
  const cleanupPending = await tryProcessFileCleanupQueue();
  return { project: getProject(projectId), audio, cleanupPending, alignment: "estimated" as const };
}

app.post("/api/projects/:id/tts", async (request, response) => {
  const parsed = ttsRequestSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "Pilihan TTS tidak valid.", { issues: parsed.error.issues });
  const id = String(request.params.id);
  if (activeProjectTasks.has(id)) return apiError(response, 409, "Project sedang memproses audio atau snapshot.");
  const row = projectRow(id);
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  const project = projectFromRow(row);
  const script = narrationScript(project.researchPackage);
  if (!script) return apiError(response, 400, "Naskah kosong. Isi narrationText pada storyboard terlebih dahulu.");
  if (script.length > maxTtsCharacters) return apiError(response, 413, `Naskah melebihi batas ${maxTtsCharacters} karakter TTS.`);
  activeProjectTasks.add(id);
  try {
    const result = await createTtsAsset(script, parsed.data, parsed.data.regenerate);
    const currentRow = projectRow(row.id);
    if (!currentRow) throw new SpeechProviderError("Project tidak ditemukan.", "project-not-found", 404);
    const currentProject = projectFromRow(currentRow);
    if (createHash("sha256").update(narrationScript(currentProject.researchPackage)).digest("hex") !== result.scriptSha256) {
      throw new SpeechProviderError("Naskah berubah saat audio dibuat. Simpan storyboard lalu buat preview baru.", "script-changed", 409);
    }
    currentProject.pendingTts = { cacheKey: result.asset.cache_key, scriptSha256: result.scriptSha256 };
    saveProject(row.id, currentProject);
    response.json({ project: getProject(row.id), preview: ttsPreview(result.asset, result.scriptSha256), cacheHit: result.cacheHit });
  } catch (error) { sendTtsError(response, error); }
  finally { activeProjectTasks.delete(id); }
});

app.post("/api/projects/:id/tts/approve", async (request, response) => {
  if (activeRenderJob) return apiError(response, 409, "Audio tidak dapat diubah saat render berjalan.");
  const id = String(request.params.id);
  if (activeProjectTasks.has(id)) return apiError(response, 409, "Project sedang memproses audio atau snapshot.");
  const row = projectRow(id);
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  const project = projectFromRow(row);
  if (!project.pendingTts) return apiError(response, 409, "Belum ada pratinjau narasi untuk digunakan.", { code: "no-pending-tts" });
  const asset = db.prepare("SELECT * FROM tts_assets WHERE cache_key = ?").get(project.pendingTts.cacheKey) as TtsAssetRow | undefined;
  if (!asset) return apiError(response, 410, "Audio preview tidak ditemukan. Buat pratinjau baru.", { code: "audio-not-found" });
  activeProjectTasks.add(id);
  try {
    response.json(await attachTtsAudio(row.id, asset, project.pendingTts.scriptSha256));
  } catch (error) { sendTtsError(response, error); }
  finally { activeProjectTasks.delete(id); }
});

app.post("/api/projects/:id/generate", async (request, response) => {
  const projectId = String(request.params.id);
  const row = projectRow(projectId);
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  if (activeProjectTasks.has(projectId)) return apiError(response, 409, "Project sedang memproses audio atau snapshot.");
  const project = projectFromRow(row);
  if (project.audio?.source === "tts" && project.audio.tts?.scriptSha256 !== createHash("sha256").update(narrationScript(project.researchPackage)).digest("hex")) {
    return apiError(response, 409, "Naskah berubah setelah AI Voice dibuat. Generate ulang audio atau pilih upload manual.", { code: "tts-audio-stale" });
  }
  const snapshot = snapshotForProject(project);
  const source = JSON.stringify(snapshot);
  const sourceSha = createHash("sha256").update(source).digest("hex");
  const existing = db.prepare("SELECT * FROM jobs WHERE project_id = ? AND source_sha256 = ?").get(row.id, sourceSha) as JobRow | undefined;
  if (existing) return response.json({ job: jobForClient(existing), warnings: researchWarnings(project.researchPackage) });
  if (project.audio) {
    const approvedAudioPath = path.resolve(root, "public", project.audio.file);
    if (!existsSync(approvedAudioPath) || await sha256File(approvedAudioPath) !== project.audio.sha256) {
      return apiError(response, 409, "Audio yang dipilih hilang atau SHA-256 berubah. Pilih/unggah audio lagi sebelum membuat snapshot.", { code: "audio-integrity-failed" });
    }
  }

  const recent = db.prepare("SELECT created_at FROM video_job_requests WHERE created_at > ? ORDER BY created_at ASC")
    .all(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) as Array<{ created_at: string }>;
  const allowance = canStartNewJob(recent.map((item) => item.created_at), Date.now(), dailyLimit);
  if (!allowance.allowed) return apiError(response, 429, "Batas job video baru untuk 24 jam tercapai.", { nextAllowedAt: allowance.nextAllowedAt });
  if (activeJobCreation) return apiError(response, 409, "Pembuatan snapshot lain sedang berjalan.");

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const folder = path.join(jobDir, id);
  activeProjectTasks.add(projectId);
  activeJobCreation = true;
  try {
    await mkdir(folder, { recursive: true });
    if (project.audio) {
      const jobAudioPath = path.resolve(root, "public", snapshot.audio!.file);
      await mkdir(path.dirname(jobAudioPath), { recursive: true });
      if (!existsSync(jobAudioPath)) await copyFile(path.resolve(root, "public", project.audio.file), jobAudioPath);
      invalidateBundleCache();
    }
    const temporaryPath = path.join(folder, "snapshot.tmp");
    const snapshotPath = path.join(folder, "snapshot.json");
    await writeFile(temporaryPath, source, { flag: "wx" });
    await rename(temporaryPath, snapshotPath);
    const latestRow = projectRow(projectId);
    if (!latestRow) {
      await removeOrQueueCleanup("jobs", folder);
      return apiError(response, 404, "Project tidak ditemukan.");
    }
    const latestProject = projectFromRow(latestRow);
    const latestSourceSha = createHash("sha256").update(JSON.stringify(snapshotForProject(latestProject))).digest("hex");
    if (latestSourceSha !== sourceSha) {
      await removeOrQueueCleanup("jobs", folder);
      return apiError(response, 409, "Project berubah saat preview dibuat. Simpan perubahan lalu ulangi Generate preview.", { code: "project-changed" });
    }
    withTransaction(() => {
      db.prepare("INSERT INTO jobs (id, project_id, source_sha256, snapshot_path, state, created_at, updated_at, renderer_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, row.id, sourceSha, snapshotPath, "preview-ready", createdAt, createdAt, RENDERER_VERSION);
      db.prepare("INSERT INTO video_job_requests (id, created_at) VALUES (?, ?)").run(id, createdAt);
    });
  } catch (error) {
    try { await rm(folder, { recursive: true, force: true }); }
    catch {
      try { queueFileCleanup("jobs", folder); await processFileCleanupQueue(); }
      catch (cleanupError) { console.error("Uncommitted snapshot cleanup could not be queued:", cleanupError instanceof Error ? cleanupError.message : "unknown error"); }
    }
    return apiError(response, 500, "Snapshot job gagal disimpan; batas job harian tidak terpakai.");
  } finally {
    activeProjectTasks.delete(projectId);
    activeJobCreation = false;
  }
  response.status(201).json({ job: jobForClient(db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow), warnings: researchWarnings(project.researchPackage) });
});

app.get("/api/jobs/:id", (request, response) => {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(request.params.id) as JobRow | undefined;
  if (!job) return apiError(response, 404, "Job tidak ditemukan.");
  response.json(jobForClient(job));
});

app.post("/api/jobs/:id/render", async (request, response) => {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(request.params.id) as JobRow | undefined;
  if (!job) return apiError(response, 404, "Job tidak ditemukan.");
  let snapshot: RenderSnapshot;
  try { snapshot = JSON.parse(readFileSync(job.snapshot_path, "utf8")) as RenderSnapshot; }
  catch { return apiError(response, 500, "Snapshot render tidak dapat dibaca."); }
  if (!snapshot.audio && request.body?.allowSilent !== true) return apiError(response, 409, "Snapshot ini tidak memiliki narasi. Konfirmasi render tanpa narasi secara eksplisit.", { code: "silent-render-confirmation-required" });
  if (activeRenderJob) return apiError(response, 409, "Render lain sedang berjalan di perangkat ini.");
  if (job.attempt_count >= 3) return apiError(response, 429, "Batas tiga percobaan render untuk job ini tercapai.");

  const attempt = job.attempt_count + 1;
  const now = new Date().toISOString();
  const attemptId = randomUUID();
  db.prepare("INSERT INTO render_attempts (id, job_id, attempt, state, requested_at) VALUES (?, ?, ?, ?, ?)")
    .run(attemptId, job.id, attempt, "rendering", now);
  db.prepare("UPDATE jobs SET state = ?, updated_at = ?, error = NULL, progress = 0, attempt_count = ? WHERE id = ?")
    .run("rendering", now, attempt, job.id);
  activeRenderJob = job.id;
  response.status(202).json(jobForClient(db.prepare("SELECT * FROM jobs WHERE id = ?").get(job.id) as JobRow));

  void (async () => {
    const outputPath = path.join(renderDir, job.id, `attempt-${attempt}.mp4`);
    try {
      const snapshot = JSON.parse(await readFile(job.snapshot_path, "utf8")) as RenderSnapshot;
      const manifest = await renderSnapshot(snapshot, outputPath, (progress) => {
        db.prepare("UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ?").run(progress, new Date().toISOString(), job.id);
      });
      const finish = new Date().toISOString();
      db.prepare("UPDATE jobs SET state = ?, updated_at = ?, progress = 100, output_path = ?, manifest_json = ? WHERE id = ?")
        .run("rendered", finish, outputPath, JSON.stringify(manifest), job.id);
      db.prepare("UPDATE render_attempts SET state = ?, finished_at = ?, manifest_json = ? WHERE id = ?")
        .run("rendered", finish, JSON.stringify(manifest), attemptId);
    } catch (error) {
      const message = error instanceof Error && ["Render tidak menghasilkan", "Audio validation gagal:", "Audio snapshot"].some((prefix) => error.message.startsWith(prefix))
        ? error.message
        : "Render gagal. Pastikan FFmpeg/ffprobe tersedia, audio valid, dan Chromium Remotion dapat dijalankan.";
      const finish = new Date().toISOString();
      db.prepare("UPDATE jobs SET state = ?, updated_at = ?, error = ? WHERE id = ?").run("failed", finish, message, job.id);
      db.prepare("UPDATE render_attempts SET state = ?, finished_at = ?, error = ? WHERE id = ?").run("failed", finish, message, attemptId);
      try { await rm(outputPath, { force: true }); }
      catch {
        try { queueFileCleanup("renders", outputPath); void processFileCleanupQueue().catch((cleanupError) => console.error("Render output cleanup retry failed:", cleanupError instanceof Error ? cleanupError.message : "unknown error")); }
        catch (cleanupError) { console.error("Render output cleanup could not be queued:", cleanupError instanceof Error ? cleanupError.message : "unknown error"); }
      }
    } finally {
      activeRenderJob = null;
    }
  })();
});

app.get("/api/jobs/:id/download", (request, response) => {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(request.params.id) as JobRow | undefined;
  if (!job?.output_path) return apiError(response, 404, "MP4 belum tersedia.");
  const output = path.resolve(job.output_path);
  if (!output.startsWith(`${renderDir}${path.sep}`)) return apiError(response, 400, "Lokasi output tidak valid.");
  response.download(output, `${job.id}.mp4`);
});

app.post("/api/projects/:id/review", (request, response) => {
  const row = projectRow(request.params.id);
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  const review = request.body?.status;
  if (review !== "needs-review" && review !== "verified-by-author") return apiError(response, 400, "Status review tidak valid.");
  const project = projectFromRow(row);
  project.researchReviewStatus = review;
  saveProject(row.id, project);
  response.json(getProject(row.id));
});

// Serve uploads created after `vite build` too, not only assets copied at build time.
app.use("/audio", express.static(audioDir));

if (existsSync(path.resolve(root, "dist/index.html"))) {
  app.use(express.static(path.resolve(root, "dist")));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/")) return next();
    response.sendFile(path.resolve(root, "dist/index.html"));
  });
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return apiError(response, 413, `Ukuran audio melebihi batas ${maxUploadMb} MB.`);
  }
  if (error instanceof Error && error.message.startsWith("Unggah")) return apiError(response, 400, error.message);
  console.error("Request gagal:", error instanceof Error ? error.message : "unknown error");
  apiError(response, 500, "Terjadi kesalahan lokal. Periksa log server.");
});

const pendingCleanup = await tryProcessFileCleanupQueue();
if (pendingCleanup === null) console.warn("File cleanup queue could not be checked; will retry every 60 seconds.");
else if (pendingCleanup) console.warn(`File cleanup pending: ${pendingCleanup}; will retry every 60 seconds.`);
const cleanupRetryTimer = setInterval(() => {
  void processFileCleanupQueue().catch((error) => console.error("Cleanup queue retry failed:", error instanceof Error ? error.message : "unknown error"));
}, 60_000);
cleanupRetryTimer.unref();

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3001);
app.listen(port, host, () => console.log(`AI Facts Studio API: http://${host}:${port}`));
