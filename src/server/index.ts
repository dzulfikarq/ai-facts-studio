import "./load-env";
import express from "express";
import multer from "multer";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { openverseLicenseIds, reusableSceneInputSchema } from "../domain/asset-library";
import { aiGenerationInputSchema } from "../domain/ai-generation";
import { canStartNewJob } from "../domain/timeline";
import { parseResearchPackage, researchWarnings } from "../domain/research";
import { applyVisualStoryboard, buildVisualStoryboard, compositionForVisualScene, retimeVisualStoryboard, visualStoryboardQualityGate, visualStoryboardSchema, type VisualStoryboard } from "../domain/visual-storyboard";
import type { VisualPreparationJob, VisualPreparationScene } from "../domain/visual-preparation";
import type { MotionPreparationJob, MotionPreparationScene } from "../domain/motion-preparation";
import { motionIntensitySchema, planSceneMotion } from "../domain/motion-director";
import { trustedImageAssets } from "../domain/visual-composition";
import { visualAssetSchema, type VisualAsset, type VisualLibraryEntry } from "../domain/visual-assets";
import { sceneMediaSchema, type SceneMedia } from "../domain/scene-media";
import { estimateSceneTimings, narrationScript } from "../domain/voice-timing";
import { invalidateBundleCache, renderSnapshot, type RenderSnapshot } from "../../scripts/render-core";
import { LEGACY_RENDERER_VERSION, RENDERER_VERSION } from "../video/renderer-version";
import { dataDir, db, jobForClient, projectFromRow, type JobRow, type StoredAudio, type StoredProject } from "./database";
import { generateAiResearchStoryboard, AiGenerationOutputError } from "./ai-generation/generate";
import { generateVisualSemanticPlan, visualPlannerInputSchema } from "./ai-generation/visual-planner";
import { generateAiVectorIllustration } from "./ai-generation/vector-illustrator";
import { GeminiTextGenerationError, GeminiTextGenerationProvider } from "./ai-generation/gemini-text-provider";
import { getOpenCodeProviderStatus, OpenCodeGenerationError, OpenCodeTextGenerationProvider } from "./ai-generation/opencode-provider";
import { AiGenerationRequestError } from "./ai-generation/quota";
import { getAiGenerationSettings, isLoopbackAddress, readAiGenerationMode, writeAiGenerationMode } from "./ai-generation/provider";
import { DEFAULT_HF_IMAGE_MODEL, HF_IMAGE_RESOLUTIONS, HuggingFaceImageError, HuggingFaceInferenceImageProvider, discoverHuggingFaceImageModels, huggingFaceImageConfiguration } from "./ai-generation/huggingface-image";
import { validateAndOptimizeRasterImage } from "./visual-asset-processing";
import { validateAndNormalizeSceneMedia, verifyStoredSceneMedia } from "./scene-media-processing";
import { validateRasterImage } from "../domain/visual-assets";
import { prepareSmartVisual, type ReusableCandidate } from "./visual-orchestrator";
import { assetFtsExpression, backfillVisualAssetCatalog, fetchOpenverseThumbnail, indexTablerIcons, sanitizedTablerSvg, searchOpenverse, searchTablerIcons, upsertVisualAssetCatalog, downloadOpenverseImage } from "./asset-library";
import { createSpeechProvider, SpeechProviderError, ttsCacheKey, type SpeechAudio, type SpeechVoice, type SpeechVoiceCatalog } from "./tts/provider";

const execFileAsync = promisify(execFile);
const app = express();
const root = process.cwd();
const audioDir = path.resolve(root, "public/audio");
const visualAssetDir = path.resolve(root, "public/visual-assets");
const sceneMediaDir = path.resolve(root, "public/scene-media");
const jobDir = path.join(dataDir, "jobs");
const renderDir = path.resolve(root, "renders");
const samplePath = path.resolve(root, "samples/mountain-formation.json");
const volcanoSamplePath = path.resolve(root, "samples/volcano-formation.json");
const cleanupRoots = { audio: audioDir, jobs: jobDir, renders: renderDir, "visual-assets": visualAssetDir, "scene-media": sceneMediaDir };
type CleanupRoot = keyof typeof cleanupRoots;
const maxUploadMb = Math.max(1, Number(process.env.MAX_UPLOAD_MB ?? 100));
const dailyLimit = Math.max(1, Number(process.env.DAILY_JOB_LIMIT ?? 1));
const ttsDailyLimit = Math.max(1, Number(process.env.GEMINI_TTS_DAILY_REQUEST_LIMIT ?? 10));
const maxTtsCharacters = 6000;
let activeRenderJob: string | null = null;
let activeJobCreation = false;
let activeAiGeneration = false;
let activeAiGenerationPhase: "idle" | "connecting" | "generating" | "validating" | "repairing" = "idle";
let activeAiImageGeneration = false;
let activeVisualPreparation = false;
let activeMotionPreparation = false;
type AiImageStatus = "Not Configured" | "Ready" | "Generating" | "Rate Limited" | "Quota Exhausted" | "Failed";
let aiImageRuntime: { status: AiImageStatus; message: string | null; retryAt: string | null } = { status: "Not Configured", message: null, retryAt: null };
let aiImageModelCache: { models: Awaited<ReturnType<typeof discoverHuggingFaceImageModels>>; expiresAt: number } | null = null;
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
const illustrationUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, done) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)) return done(new Error("Unggah PNG, JPEG, atau WebP. SVG tidak didukung."));
    done(null, true);
  },
});
const illustrationBatchUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 11 * 1024 * 1024, files: 30, fields: 1, parts: 31, fieldSize: 1024 * 1024 },
  fileFilter: (_request, _file, done) => done(null, true),
});
const sceneMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, done) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if ((file.mimetype === "video/mp4" && extension === ".mp4") || (file.mimetype === "image/gif" && extension === ".gif")) return done(null, true);
    done(new Error("Pilih MP4 atau GIF animasi dengan MIME dan ekstensi yang cocok."));
  },
});

await mkdir(audioDir, { recursive: true });
await mkdir(visualAssetDir, { recursive: true });
await mkdir(sceneMediaDir, { recursive: true });
await mkdir(jobDir, { recursive: true });
await mkdir(renderDir, { recursive: true });
indexTablerIcons(db);
backfillVisualAssetCatalog(db, (asset) => path.join(visualAssetDir, asset.file));
app.use(express.json({ limit: "1mb" }));

function projectRow(id: string) {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as { id: string; data_json: string; created_at: string; updated_at: string } | undefined;
}

function snapshotForProject(project: StoredProject): RenderSnapshot {
  if (project.visualStoryboardError) throw new Error(project.visualStoryboardError);
  const extension = project.audio ? path.extname(project.audio.file) : "";
  const referencedAssetIds = new Set(project.visualStoryboard.scenes.flatMap((scene) => compositionForVisualScene(project.visualStoryboard, scene).layers
    .flatMap((layer) => layer.nodes.flatMap((node) => node.type === "group" ? node.children : [node]))
    .flatMap((node) => node.type === "image" && node.asset.startsWith("upload-") ? [node.asset] : [])));
  return {
    research: applyVisualStoryboard(project.researchPackage, project.visualStoryboard),
    visualAssets: project.visualAssets.filter((asset) => referencedAssetIds.has(asset.id)),
    sceneMedia: project.visualStoryboard.scenes.flatMap((scene) => scene.sceneMedia ? [scene.sceneMedia] : []),
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

function factReviewContent(research: StoredProject["researchPackage"]) {
  return JSON.stringify({
    title: research.title,
    category: research.category,
    narration: research.narration,
    references: research.references,
    scenes: research.scenes.map((scene) => ({ narrationText: scene.narrationText, onScreenText: scene.onScreenText, referenceIds: scene.referenceIds })),
  });
}

function snapshotContentMatchesProject(snapshotPath: string, project: StoredProject) {
  const resolved = path.resolve(snapshotPath);
  if (!resolved.startsWith(`${jobDir}${path.sep}`)) return false;
  try {
    const snapshot = JSON.parse(readFileSync(resolved, "utf8")) as RenderSnapshot;
    const oldResearch = parseResearchPackage(snapshot.research);
    const currentResearch = parseResearchPackage(project.researchPackage);
    const currentVisualResearch = parseResearchPackage(applyVisualStoryboard(project.researchPackage, project.visualStoryboard));
    if (!oldResearch.success || !currentResearch.success || !currentVisualResearch.success) return false;
    const audioContent = (audio: RenderSnapshot["audio"]) => audio ? { file: audio.file, durationSec: audio.durationSec, timingMode: audio.timingMode ?? "scaled" } : null;
     const oldContent = { research: oldResearch.data, audio: audioContent(snapshot.audio), assets: (snapshot.visualAssets ?? []).map((asset) => [asset.file, asset.sha256]) };
     const audio = audioContent(snapshotForProject(project).audio);
      const assets = (snapshotForProject(project).visualAssets ?? []).map((asset) => [asset.file, asset.sha256]);
     return [currentResearch.data, currentVisualResearch.data].some((research) => JSON.stringify(oldContent) === JSON.stringify({ research, audio, assets }));
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
  const latestJobContentCurrent = Boolean(latest && !project.visualStoryboardError && (
    latest.source_sha256 === createHash("sha256").update(JSON.stringify(snapshotForProject(project))).digest("hex")
    || snapshotContentMatchesProject(latest.snapshot_path, project)
  ));
  const latestJobCurrent = Boolean(latest && latestJobContentCurrent && latest.renderer_version === RENDERER_VERSION);
  const pendingTts = pendingAsset && existsSync(path.resolve(root, "public", pendingAsset.file))
    ? { ...project.pendingTts!, audioUrl: `/${pendingAsset.file}`, durationSec: pendingAsset.duration_sec, bytes: pendingAsset.bytes, voiceName: pendingAsset.voice_name, locale: pendingAsset.locale, style: pendingAsset.style, speakingRate: pendingAsset.speaking_rate, generatedAt: pendingAsset.created_at }
    : null;
  const preparationRow = db.prepare("SELECT data_json FROM visual_preparation_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").get(id) as { data_json: string } | undefined;
  let visualPreparation: VisualPreparationJob | null = null;
  try { if (preparationRow) visualPreparation = JSON.parse(preparationRow.data_json) as VisualPreparationJob; } catch { /* malformed progress is not project data */ }
  const motionPreparationRow = db.prepare("SELECT data_json FROM motion_preparation_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").get(id) as { data_json: string } | undefined;
  let motionPreparation: MotionPreparationJob | null = null;
  try { if (motionPreparationRow) motionPreparation = JSON.parse(motionPreparationRow.data_json) as MotionPreparationJob; } catch { /* malformed progress is not project data */ }
  return { ...project, pendingTts, pendingTtsMatchesNarration: project.pendingTts?.scriptSha256 === currentScriptSha, audioMatchesNarration, latestJobCurrent, latestJobContentCurrent, latestJob: jobForClient(latest), visualPreparation, motionPreparation };
}

function saveProject(id: string, project: StoredProject) {
  const now = new Date().toISOString();
  const { visualStoryboardError: _validationError, ...persisted } = project;
  db.prepare("UPDATE projects SET title = ?, data_json = ?, updated_at = ? WHERE id = ?")
    .run(project.researchPackage.title, JSON.stringify(persisted), now, id);
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

function invalidStoryboardResponse(response: express.Response, project: StoredProject) {
  if (!project.visualStoryboardError) return false;
  apiError(response, 409, project.visualStoryboardError, { code: "invalid-visual-storyboard" });
  return true;
}

app.use("/api/projects/:id", (request, response, next) => {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS" || request.method === "DELETE" && request.path === "/") return next();
  const row = projectRow(String(request.params.id));
  if (!row) return next();
  const project = projectFromRow(row);
  if (project.visualStoryboardError) return invalidStoryboardResponse(response, project);
  next();
});

function missingVisualAssetReferences(storyboard: ReturnType<typeof buildVisualStoryboard>, assets: readonly VisualAsset[]) {
  const available = new Set(assets.map((asset) => asset.id));
  return [
    ...storyboard.styleLock.referenceAssetIds.filter((assetId) => !available.has(assetId)),
    ...storyboard.scenes.flatMap((scene) => compositionForVisualScene(storyboard, scene).layers.flatMap((layer) => layer.nodes.flatMap((node) => {
    const candidates = node.type === "group" ? node.children : [node];
    return candidates.flatMap((candidate) => candidate.type === "image" && candidate.asset.startsWith("upload-") && !available.has(candidate.asset) ? [candidate.asset] : []);
    }))),
  ];
}

function writeVisualPreparationJob(job: VisualPreparationJob, insert = false, requestSha256 = "") {
  job.processed = job.scenes.filter((scene) => scene.status !== "pending" && scene.status !== "preparing").length;
  job.readyForReview = job.scenes.filter((scene) => scene.status === "ready_for_review").length;
  job.needsAttention = job.scenes.filter((scene) => scene.status === "needs_attention").length;
  job.failed = job.scenes.filter((scene) => scene.status === "failed").length;
  job.approved = job.scenes.filter((scene) => scene.status === "approved").length;
  job.updatedAt = new Date().toISOString();
  if (job.scenes.every((scene) => scene.status !== "pending" && scene.status !== "preparing")) {
    job.status = job.failed === job.total && job.total > 0 ? "failed" : job.failed ? "partial_failure" : "completed";
    job.currentSceneId = null;
  }
  const sql = insert
    ? "INSERT INTO visual_preparation_jobs (id, project_id, request_id, request_sha256, status, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    : "UPDATE visual_preparation_jobs SET status = ?, data_json = ?, updated_at = ? WHERE id = ?";
  if (insert) db.prepare(sql).run(job.id, job.projectId, job.requestId, requestSha256, job.status, JSON.stringify(job), job.createdAt, job.updatedAt);
  else db.prepare(sql).run(job.status, JSON.stringify(job), job.updatedAt, job.id);
}

function writeMotionPreparationJob(job: MotionPreparationJob, insert = false, requestSha256 = "") {
  job.processed = job.scenes.filter((scene) => !["pending", "preparing"].includes(scene.status)).length;
  job.readyForReview = job.scenes.filter((scene) => scene.status === "ready_for_review").length;
  job.preserved = job.scenes.filter((scene) => scene.status === "preserved").length;
  job.needsAttention = job.scenes.filter((scene) => scene.status === "needs_attention").length;
  job.failed = job.scenes.filter((scene) => scene.status === "failed").length;
  job.updatedAt = new Date().toISOString();
  if (job.scenes.every((scene) => !["pending", "preparing"].includes(scene.status))) {
    job.status = job.cancelRequested ? "cancelled" : job.failed === job.total && job.total > 0 ? "failed" : job.failed ? "partial_failure" : "completed";
    job.currentSceneId = null;
  }
  if (insert) {
    db.prepare("INSERT INTO motion_preparation_jobs (id, project_id, request_id, request_sha256, status, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(job.id, job.projectId, job.requestId, requestSha256, job.status, JSON.stringify(job), job.createdAt, job.updatedAt);
  } else {
    db.prepare("UPDATE motion_preparation_jobs SET status = ?, data_json = ?, updated_at = ? WHERE id = ?")
      .run(job.status, JSON.stringify(job), job.updatedAt, job.id);
  }
}

async function runMotionPreparation(job: MotionPreparationJob) {
  if (activeMotionPreparation) return;
  activeMotionPreparation = true;
  activeProjectTasks.add(job.projectId);
  try {
    // Let the 202 response flush so an immediate cancel request can reach the worker before its first scene.
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    for (const state of job.scenes) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const latestJob = db.prepare("SELECT data_json FROM motion_preparation_jobs WHERE id = ?").get(job.id) as { data_json: string } | undefined;
      if (latestJob && (JSON.parse(latestJob.data_json) as MotionPreparationJob).cancelRequested) job.cancelRequested = true;
      if (job.cancelRequested) break;
      if (state.status !== "pending") continue;
      state.status = "preparing";
      state.message = "Menentukan gerak dari narasi dan objek visual yang benar-benar tersedia.";
      job.currentSceneId = state.sceneId;
      writeMotionPreparationJob(job);
      try {
        const row = projectRow(job.projectId);
        if (!row) throw new Error("Project tidak ditemukan.");
        const project = projectFromRow(row);
        const sceneIndex = project.visualStoryboard.scenes.findIndex((scene) => scene.sceneId === state.sceneId);
        if (sceneIndex < 0) throw new Error("Scene tidak ditemukan di Visual Storyboard.");
        const scene = project.visualStoryboard.scenes[sceneIndex]!;
        if (scene.approved || scene.motionStatus === "static" || scene.motionStatus === "ready_for_review" && scene.motionActions.length > 0) {
          state.status = "preserved";
          state.message = "Motion plan yang sudah direview/approved dipertahankan; batch tidak menimpanya.";
          writeMotionPreparationJob(job);
          continue;
        }
        const currentResearch = applyVisualStoryboard(project.researchPackage, project.visualStoryboard);
        const gate = visualStoryboardQualityGate(currentResearch, project.visualStoryboard, project.visualAssets);
        const sceneIssues = gate.scenes[scene.sceneId] ?? [];
        if (scene.authoringStatus === "needs_visual_authoring" || sceneIssues.length > 0) {
          state.status = "needs_attention";
          state.message = sceneIssues[0] ?? "Komposisi belum cukup valid untuk motion planning.";
          writeMotionPreparationJob(job);
          continue;
        }
        const motion = planSceneMotion({ ...scene, composition: compositionForVisualScene(project.visualStoryboard, scene) }, job.intensity);
        const nextScene = { ...scene, ...motion, approved: false, approvedFingerprint: null };
        project.visualStoryboard = { ...project.visualStoryboard, scenes: project.visualStoryboard.scenes.map((item, index) => index === sceneIndex ? nextScene : item) };
        const merged = parseResearchPackage(applyVisualStoryboard(project.researchPackage, project.visualStoryboard));
        if (!merged.success) throw new Error("Motion Plan tidak cocok dengan Research Package.");
        project.researchPackage = merged.data;
        const savedStoryboard = visualStoryboardSchema.safeParse(project.visualStoryboard);
        if (!savedStoryboard.success) throw new Error(savedStoryboard.error.issues[0]?.message ?? "Motion Plan tidak valid.");
        project.visualStoryboard = savedStoryboard.data;
        state.status = "ready_for_review";
        state.message = motion.motionActions.length ? "Motion Plan deterministik dibuat; timing approximate, review sebelum approve." : "Komposisi cocok sebagai scene statis; tidak ada objek aman untuk digerakkan.";
        withTransaction(() => {
          saveProject(job.projectId, project);
          writeMotionPreparationJob(job);
        });
        invalidateBundleCache();
      } catch (error) {
        state.status = "failed";
        state.message = error instanceof Error ? error.message : "Motion preparation gagal.";
        writeMotionPreparationJob(job);
      }
    }
    if (job.cancelRequested) {
      for (const scene of job.scenes) if (["pending", "preparing"].includes(scene.status)) {
        scene.status = "cancelled";
        scene.message = "Dibatalkan pengguna; scene belum diproses.";
      }
    }
    writeMotionPreparationJob(job);
  } finally {
    activeProjectTasks.delete(job.projectId);
    activeMotionPreparation = false;
  }
}

function protectedVisualScene(scene: VisualStoryboard["scenes"][number], storyboard: VisualStoryboard) {
  const hasImage = compositionForVisualScene(storyboard, scene).layers.some((layer) => layer.nodes.some((node) => node.type === "image" || node.type === "group" && node.children.some((child) => child.type === "image")));
  return scene.approved || scene.authoringConfirmed || scene.compositionSource === "manual" || scene.compositionSource === "ai-vector" || hasImage;
}

function reusableVisualCandidates(scene: VisualStoryboard["scenes"][number]) {
  const match = assetFtsExpression(`${scene.visualSummary} ${scene.narrationText} ${scene.objects.map((object) => `${object.objectId} ${object.label}`).join(" ")}`);
  const rows = match
    ? db.prepare("SELECT id, data_json FROM reusable_scene_compositions WHERE id IN (SELECT id FROM reusable_scene_compositions_fts WHERE reusable_scene_compositions_fts MATCH ?) ORDER BY usage_count DESC, updated_at DESC LIMIT 40").all(match)
    : db.prepare("SELECT id, data_json FROM reusable_scene_compositions ORDER BY usage_count DESC, updated_at DESC LIMIT 40").all();
  return (rows as Array<{ id: string; data_json: string }>).flatMap((row) => {
    try {
      const value = JSON.parse(row.data_json) as Record<string, unknown>;
      const parsed = reusableSceneInputSchema.safeParse({
        name: value.name, tags: value.tags, concepts: value.concepts, styleId: value.styleId, layout: value.layout,
        compositionType: value.compositionType, composition: value.composition, palette: value.palette,
        motionIntent: value.motionIntent, motionSummary: value.motionSummary, motionPlan: value.motionPlan,
        objects: value.objects, relationships: value.relationships, visualFocus: value.visualFocus,
        assetIds: value.assetIds, thumbnailDataUrl: value.thumbnailDataUrl, provenance: value.provenance,
      });
      return parsed.success ? [{ ...parsed.data, id: row.id }] : [];
    } catch { return []; }
  });
}

async function trustedCatalogAsset(assetId: string) {
  const row = db.prepare("SELECT metadata_json, available_local FROM visual_asset_catalog WHERE asset_id = ?").get(assetId) as { metadata_json: string; available_local: number } | undefined;
  if (!row || !row.available_local) return null;
  try {
    const parsed = visualAssetSchema.safeParse(JSON.parse(row.metadata_json));
    if (!parsed.success) return null;
    const file = path.resolve(visualAssetDir, parsed.data.file);
    if (path.dirname(file) !== visualAssetDir || !existsSync(file) || await sha256File(file) !== parsed.data.sha256) return null;
    return parsed.data;
  } catch { return null; }
}

async function visualResourcesForScene(scene: VisualStoryboard["scenes"][number], project: StoredProject, trustedAssetCache: Map<string, Promise<VisualAsset | null>>) {
  const reusableScenes = reusableVisualCandidates(scene);
  const match = assetFtsExpression(`${scene.visualSummary} ${scene.narrationText} ${scene.objects.map((object) => `${object.objectId} ${object.label}`).join(" ")}`);
  const catalogRows = match
    ? db.prepare(`SELECT metadata_json FROM visual_asset_catalog WHERE asset_type = 'illustration' AND available_local = 1 AND asset_id IN (SELECT asset_id FROM visual_asset_catalog_fts WHERE visual_asset_catalog_fts MATCH ?) ORDER BY created_at DESC LIMIT 24`).all(match) as Array<{ metadata_json: string }>
    : [];
  const assetIds = new Set([
    ...project.visualAssets.map((asset) => asset.id),
    ...reusableScenes.flatMap((item) => item.assetIds),
    ...catalogRows.flatMap((item) => {
      try { return [visualAssetSchema.parse(JSON.parse(item.metadata_json)).id]; } catch { return []; }
    }),
  ]);
  const assets = (await Promise.all([...assetIds].map((assetId) => {
    let cached = trustedAssetCache.get(assetId);
    if (!cached) { cached = trustedCatalogAsset(assetId); trustedAssetCache.set(assetId, cached); }
    return cached;
  }))).filter((asset): asset is VisualAsset => asset !== null);
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  return { reusableScenes: reusableScenes.filter((item) => item.assetIds.every((id) => assetMap.has(id))), assets, assetMap };
}

async function prepareVisualSceneSafely(scene: VisualStoryboard["scenes"][number], storyboard: VisualStoryboard, project: StoredProject, trustedAssetCache: Map<string, Promise<VisualAsset | null>>) {
  const resources = await visualResourcesForScene(scene, project, trustedAssetCache);
  const sceneWithEffectiveComposition = { ...scene, composition: compositionForVisualScene(storyboard, scene) };
  let reusableScenes = resources.reusableScenes;
  let assets = resources.assets;
  for (let attempt = 0; attempt <= resources.assets.length; attempt++) {
    const result = prepareSmartVisual({ scene: sceneWithEffectiveComposition, storyboard, reusableScenes, assets });
    const invalid = result.assetIds.filter((id) => !resources.assetMap.has(id));
    if (!invalid.length) return { result, assets: resources.assetMap };
    assets = assets.filter((asset) => !invalid.includes(asset.id));
    reusableScenes = reusableScenes.filter((candidate) => candidate.assetIds.every((id) => !invalid.includes(id)));
  }
  return { result: prepareSmartVisual({ scene: sceneWithEffectiveComposition, storyboard, reusableScenes: [], assets: [] }), assets: resources.assetMap };
}

async function runVisualPreparation(job: VisualPreparationJob) {
  if (activeVisualPreparation) return;
  activeVisualPreparation = true;
  activeProjectTasks.add(job.projectId);
  const trustedAssetCache = new Map<string, Promise<VisualAsset | null>>();
  try {
    for (const state of job.scenes) {
      if (state.status !== "pending") continue;
      state.status = "preparing";
      state.message = "Objek, hubungan, gaya, dan aset lokal sedang diperiksa.";
      job.currentSceneId = state.sceneId;
      writeVisualPreparationJob(job);
      try {
        const row = projectRow(job.projectId);
        if (!row) throw new Error("Project tidak ditemukan.");
        const project = projectFromRow(row);
        const index = project.visualStoryboard.scenes.findIndex((scene) => scene.sceneId === state.sceneId);
        if (index < 0) throw new Error("Scene tidak ditemukan lagi di Visual Storyboard.");
        const scene = project.visualStoryboard.scenes[index]!;
        if (protectedVisualScene(scene, project.visualStoryboard)) {
          state.status = scene.approved ? "approved" : scene.authoringStatus === "needs_visual_authoring" ? "needs_attention" : "ready_for_review";
          state.source = "preserved";
          state.message = "Ilustrasi terpilih/manual dipertahankan; perubahan otomatis tidak menimpanya.";
          state.recommendations = ["Gunakan Ubah Ilustrasi untuk mengganti setelah konfirmasi."];
          writeVisualPreparationJob(job);
          continue;
        }
        if (scene.authoringStatus !== "needs_visual_authoring") {
          state.status = "needs_attention";
          state.source = "preserved";
          state.message = "Ilustrasi sudah tersedia; Smart Hybrid mempertahankannya untuk review manusia.";
          state.recommendations = ["Buka Preview dan approve, atau pilih sumber baru secara eksplisit."];
          writeVisualPreparationJob(job);
          continue;
        }

        const { result, assets } = await prepareVisualSceneSafely(scene, project.visualStoryboard, project, trustedAssetCache);
        const nextScene = result.composition ? {
          ...scene,
          composition: result.composition,
          compositionOverride: project.visualStoryboard.visualWorld ? result.composition : undefined,
          ...(result.compositionType ? { compositionType: result.compositionType } : {}),
          ...(result.layout ? { layout: result.layout } : {}),
          ...(result.compositionSource ? { compositionSource: result.compositionSource } : {}),
          ...(result.illustrationSource ? { illustrationSource: result.illustrationSource } : {}),
          ...(result.objects ? { objects: result.objects } : {}),
          ...(result.relationships ? { relationships: result.relationships } : {}),
          ...(result.visualFocus !== undefined ? { visualFocus: result.visualFocus } : {}),
          ...(result.illustrationIntent ? { illustrationIntent: result.illustrationIntent } : {}),
          ...(result.motionIntent ? { motionIntent: result.motionIntent } : {}),
          ...(result.motionSummary ? { motionSummary: result.motionSummary } : {}),
          missingVisuals: result.missingVisuals,
          warnings: result.warnings,
          authoringStatus: result.status,
          authoringConfirmed: false,
          approved: false,
          approvedFingerprint: null,
        } : {
          ...scene,
          missingVisuals: result.missingVisuals,
          warnings: result.warnings,
          authoringStatus: "needs_visual_authoring" as const,
          authoringConfirmed: false,
          approved: false,
          approvedFingerprint: null,
        };
        project.visualStoryboard = { ...project.visualStoryboard, scenes: project.visualStoryboard.scenes.map((item, itemIndex) => itemIndex === index ? nextScene : item) };
        for (const assetId of result.assetIds) {
          const asset = assets.get(assetId);
          if (!asset) throw new Error(`Aset ${assetId} tidak lolos verifikasi lokal.`);
          if (!project.visualAssets.some((item) => item.id === assetId)) project.visualAssets.push(asset);
        }
        const merged = parseResearchPackage(applyVisualStoryboard(project.researchPackage, project.visualStoryboard));
        if (!merged.success) throw new Error("Komposisi hasil Smart Hybrid tidak cocok dengan Research Package.");
        project.researchPackage = merged.data;
        const gate = visualStoryboardQualityGate(project.researchPackage, project.visualStoryboard, project.visualAssets);
        const hasGateIssues = (gate.scenes[state.sceneId]?.length ?? 0) > 0;
        state.source = result.source === "needs-authoring" ? undefined : result.source;
        state.status = nextScene.authoringStatus === "needs_visual_authoring" || hasGateIssues ? "needs_attention" : "ready_for_review";
        state.message = state.status === "needs_attention" ? result.warnings[0] ?? "Perlu perbaikan sebelum review." : "Ilustrasi disiapkan; review visual dan approve tetap diperlukan.";
        state.recommendations = state.status === "needs_attention" ? ["AI Vector bila OpenCode Development siap", "Pilih ilustrasi/reusable scene", "AI Image hanya setelah izin biaya", "Upload ilustrasi sendiri"] : [];
        withTransaction(() => {
          saveProject(job.projectId, project);
          writeVisualPreparationJob(job);
        });
        invalidateBundleCache();
      } catch (error) {
        state.status = "failed";
        state.message = error instanceof Error ? error.message : "Persiapan scene gagal.";
        state.recommendations = ["Coba Perbaiki Scene Bermasalah; scene lain tetap diproses."];
        writeVisualPreparationJob(job);
      }
    }
    writeVisualPreparationJob(job);
  } finally {
    activeProjectTasks.delete(job.projectId);
    activeVisualPreparation = false;
  }
}

function illustrationUploadMiddleware(request: express.Request, response: express.Response, next: express.NextFunction) {
  illustrationUpload.single("illustration")(request, response, (error) => {
    if (!error) return next();
    const status = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    apiError(response, status, error instanceof Error ? error.message : "Ilustrasi gagal diunggah.", { code: "invalid-illustration-upload" });
  });
}

function illustrationBatchUploadMiddleware(request: express.Request, response: express.Response, next: express.NextFunction) {
  illustrationBatchUpload.array("illustrations", 30)(request, response, (error) => {
    if (!error) return next();
    const status = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    apiError(response, status, error instanceof Error ? error.message : "Batch ilustrasi gagal diunggah.", { code: "invalid-illustration-upload" });
  });
}

function sceneMediaUploadMiddleware(request: express.Request, response: express.Response, next: express.NextFunction) {
  sceneMediaUpload.single("media")(request, response, (error) => {
    if (!error) return next();
    const status = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    apiError(response, status, error instanceof Error ? error.message : "Klip gagal diunggah.", { code: "invalid-scene-media-upload" });
  });
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function sceneMediaIntegrityError(media: SceneMedia) {
  const parsed = sceneMediaSchema.safeParse(media);
  if (!parsed.success) return "Metadata scene media tidak valid.";
  try {
    for (const [file, checksum] of [[media.file, media.sha256], [media.posterFile, media.posterSha256]] as const) {
      const filePath = path.resolve(sceneMediaDir, file);
      if (path.dirname(filePath) !== sceneMediaDir || !existsSync(filePath)) return `File scene media ${file} tidak tersedia.`;
      const expectedBytes = file === media.file ? media.bytes : media.posterBytes;
      if ((await stat(filePath)).size !== expectedBytes) return `Ukuran scene media ${file} tidak cocok dengan metadata.`;
      if (await sha256File(filePath) !== checksum) return `Hash scene media ${file} berubah.`;
    }
    await verifyStoredSceneMedia(path.join(sceneMediaDir, media.file), media);
    return null;
  } catch (error) { return error instanceof Error ? `Scene media tidak dapat dibaca: ${error.message}` : "Metadata video tersimpan tidak valid."; }
}

function queueFileCleanup(rootName: CleanupRoot, targetPath: string) {
  const base = cleanupRoots[rootName];
  const target = path.resolve(targetPath);
  const relativePath = path.relative(base, target);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)
    || rootName === "audio" && path.dirname(target) !== audioDir
    || rootName === "visual-assets" && (path.dirname(target) !== visualAssetDir || !/^[a-f0-9]{64}\.(png|jpg|webp|svg)$/.test(path.basename(target)))
    || rootName === "scene-media" && (path.dirname(target) !== sceneMediaDir || !/^[a-f0-9]{64}\.(mp4|jpg)$/.test(path.basename(target)))) {
    throw new Error("Cleanup path keluar dari direktori yang diizinkan.");
  }
  db.prepare("INSERT OR IGNORE INTO file_cleanup_queue (root, relative_path, created_at) VALUES (?, ?, ?)")
    .run(rootName, relativePath, new Date().toISOString());
}

function projectReferencesVisualAsset(file: string, excludingProjectId?: string) {
  const rows = db.prepare(excludingProjectId ? "SELECT id, data_json FROM projects WHERE id <> ?" : "SELECT id, data_json FROM projects")
    .all(...(excludingProjectId ? [excludingProjectId] : [])) as Array<{ id: string; data_json: string }>;
  return rows.some((row) => {
    try { return (JSON.parse(row.data_json) as StoredProject).visualAssets?.some((asset) => asset.file === file); }
    catch { return false; }
  });
}

function projectReferencesSceneMedia(file: string, excludingProjectId?: string) {
  const rows = db.prepare(excludingProjectId ? "SELECT id, data_json FROM projects WHERE id <> ?" : "SELECT id, data_json FROM projects")
    .all(...(excludingProjectId ? [excludingProjectId] : [])) as Array<{ id: string; data_json: string }>;
  return rows.some((row) => {
    try { return (JSON.parse(row.data_json) as StoredProject).visualStoryboard.scenes.some((scene) => scene.sceneMedia && [scene.sceneMedia.file, scene.sceneMedia.posterFile].includes(file)); }
    catch { return false; }
  });
}

function snapshotReferencesSceneMedia(file: string) {
  const rows = db.prepare("SELECT snapshot_path FROM jobs").all() as Array<{ snapshot_path: string }>;
  return rows.some((row) => {
    const snapshotPath = path.resolve(row.snapshot_path);
    if (!snapshotPath.startsWith(`${jobDir}${path.sep}`)) return false;
    try {
      const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as RenderSnapshot;
      return snapshot.sceneMedia?.some((media) => media.file === file || media.posterFile === file)
        || snapshot.research.scenes.some((scene) => scene.sceneMedia && [scene.sceneMedia.file, scene.sceneMedia.posterFile].includes(file));
    } catch { return false; }
  });
}

function snapshotReferencesVisualAsset(file: string) {
  const rows = db.prepare("SELECT snapshot_path FROM jobs").all() as Array<{ snapshot_path: string }>;
  return rows.some((row) => {
    const snapshotPath = path.resolve(row.snapshot_path);
    if (!snapshotPath.startsWith(`${jobDir}${path.sep}`)) return false;
    try { return (JSON.parse(readFileSync(snapshotPath, "utf8")) as RenderSnapshot).visualAssets?.some((asset) => asset.file === file) ?? false; }
    catch { return false; }
  });
}

function reusableSceneReferencesVisualAsset(file: string) {
  const rows = db.prepare("SELECT data_json FROM reusable_scene_compositions").all() as Array<{ data_json: string }>;
  return rows.some((row) => {
    try { return (JSON.parse(row.data_json) as { assetIds?: string[] }).assetIds?.some((id) => id === `upload-${file}`) ?? false; }
    catch { return false; }
  });
}

function visualAssetReferencedByStoryboard(storyboard: VisualStoryboard, assetId: string) {
  const compositions = [storyboard.visualWorld?.composition, ...storyboard.scenes.flatMap((scene) => [scene.composition, scene.compositionOverride])].filter((composition): composition is NonNullable<typeof composition> => Boolean(composition));
  return storyboard.styleLock.referenceAssetIds.includes(assetId) || compositions.some((composition) => composition.layers.some((layer) => layer.nodes.some((node) => {
    const candidates = node.type === "group" ? node.children : [node];
    return candidates.some((candidate) => candidate.type === "image" && candidate.asset === assetId);
  })));
}

function getVisualAssetLibrary(): VisualLibraryEntry[] {
  const projects = db.prepare("SELECT id, data_json FROM projects ORDER BY updated_at DESC").all() as Array<{ id: string; data_json: string }>;
  const assets = new Map<string, VisualAsset & { projectIds: string[]; previewUrl: string; localAvailable: boolean; referenceCount: number }>();
  for (const row of projects) {
    let stored: StoredProject;
    try { stored = JSON.parse(row.data_json) as StoredProject; } catch { continue; }
    for (const candidate of Array.isArray(stored.visualAssets) ? stored.visualAssets : []) {
      const parsed = visualAssetSchema.safeParse(candidate);
      if (!parsed.success) continue;
      const existing = assets.get(parsed.data.id);
      if (existing) existing.projectIds = [...new Set([...existing.projectIds, row.id])];
      else assets.set(parsed.data.id, { ...parsed.data, projectIds: [row.id], previewUrl: `/visual-assets/${parsed.data.file}`, localAvailable: existsSync(path.join(visualAssetDir, parsed.data.file)), referenceCount: 0 });
    }
  }
  const builtIns = trustedImageAssets.map((id) => ({
    id, name: `${id[0]!.toUpperCase()}${id.slice(1)} · built-in`, source: "built-in" as const,
    format: "svg" as const, width: 512, height: 512, style: "clean-flat-2d", license: "AI Facts Studio built-in asset",
    semanticTags: [id], projectIds: [] as [], previewUrl: `/assets/${id}.svg`, localAvailable: true, referenceCount: 0,
  }));
  return [...builtIns, ...[...assets.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))];
}

function visualAssetUsageIndex() {
  const usages = new Map<string, { projectIds: Set<string>; count: number }>();
  const add = (assetId: string, projectId: string, count = 1) => {
    const entry = usages.get(assetId) ?? { projectIds: new Set<string>(), count: 0 };
    entry.projectIds.add(projectId);
    entry.count += count;
    usages.set(assetId, entry);
  };
  const rows = db.prepare("SELECT id, data_json FROM projects").all() as Array<{ id: string; data_json: string }>;
  for (const row of rows) {
    try {
      const project = JSON.parse(row.data_json) as StoredProject;
      for (const asset of project.visualAssets ?? []) add(asset.id, row.id, 0);
      for (const assetId of project.visualStoryboard?.styleLock?.referenceAssetIds ?? []) add(assetId, row.id);
      for (const scene of project.visualStoryboard.scenes) for (const layer of compositionForVisualScene(project.visualStoryboard, scene).layers) for (const node of layer.nodes) {
        const nodes = node.type === "group" ? node.children : [node];
        for (const candidate of nodes) if (candidate.type === "image" && candidate.asset.startsWith("upload-")) add(candidate.asset, row.id);
      }
    } catch { /* ignore malformed legacy row */ }
  }
  const reusable = db.prepare("SELECT id, data_json FROM reusable_scene_compositions").all() as Array<{ id: string; data_json: string }>;
  for (const row of reusable) {
    try { for (const assetId of (JSON.parse(row.data_json) as { assetIds?: string[] }).assetIds ?? []) add(assetId, `reusable:${row.id}`); }
    catch { /* keep malformed reusable metadata out of counts */ }
  }
  return usages;
}

function searchVisualAssetCatalog(query: string, filters: Record<string, string>, page: number, pageSize: number) {
  const match = assetFtsExpression(query);
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  for (const key of ["category", "assetType", "style", "provider", "license"] as const) {
    const value = filters[key];
    if (!value) continue;
    const column = key === "assetType" ? "asset_type" : key;
    conditions.push(`${column} = ?`);
    values.push(value);
  }
  if (match) { conditions.push("asset_id IN (SELECT asset_id FROM visual_asset_catalog_fts WHERE visual_asset_catalog_fts MATCH ?)"); values.push(match); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM visual_asset_catalog ${where}`).get(...values) as { count: number }).count;
  const rows = db.prepare(`SELECT metadata_json, available_local FROM visual_asset_catalog ${where} ORDER BY created_at DESC, asset_id LIMIT ? OFFSET ?`)
    .all(...values, pageSize, (page - 1) * pageSize) as Array<{ metadata_json: string; available_local: number }>;
  const usage = visualAssetUsageIndex();
  const assets = rows.flatMap(({ metadata_json, available_local }) => {
    try {
      const asset = visualAssetSchema.parse(JSON.parse(metadata_json));
      const refs = usage.get(asset.id);
      return [{ ...asset, projectIds: [...(refs?.projectIds ?? [])].filter((id) => !id.startsWith("reusable:")), previewUrl: `/visual-assets/${asset.file}`, localAvailable: Boolean(available_local) && existsSync(path.join(visualAssetDir, asset.file)), referenceCount: refs?.count ?? 0 }];
    } catch { return []; }
  });
  const facets = Object.fromEntries(["category", "asset_type", "style", "provider", "license"].map((column) => [column, (db.prepare(`SELECT DISTINCT ${column} AS value FROM visual_asset_catalog ORDER BY ${column}`).all() as Array<{ value: string }>).map((row) => row.value)]));
  return { assets, total, page, pageSize, pageCount: Math.ceil(total / pageSize), facets };
}

async function writeVisualAssetFile(asset: VisualAsset, bytes: Buffer) {
  const expectedHash = createHash("sha256").update(bytes).digest("hex");
  if (expectedHash !== asset.sha256 || asset.file !== `${expectedHash}.${asset.format === "jpeg" ? "jpg" : asset.format}`) throw new Error("Hash file visual tidak cocok dengan metadata.");
  const destination = path.join(visualAssetDir, asset.file);
  try { await writeFile(destination, bytes, { flag: "wx" }); return true; }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST") || await sha256File(destination) !== expectedHash) throw error;
    return false;
  }
}

async function writeSceneMediaFile(media: SceneMedia, bytes: Buffer, poster: Buffer) {
  const entries = [
    { file: media.file, checksum: media.sha256, bytes, maxBytes: 150 * 1024 * 1024 },
    { file: media.posterFile, checksum: media.posterSha256, bytes: poster, maxBytes: 2 * 1024 * 1024 },
  ];
  const created: string[] = [];
  try {
    for (const entry of entries) {
      if (createHash("sha256").update(entry.bytes).digest("hex") !== entry.checksum || entry.bytes.length > entry.maxBytes) throw new Error("Hash atau ukuran file scene media tidak cocok dengan metadata.");
      const destination = path.join(sceneMediaDir, entry.file);
      try { await writeFile(destination, entry.bytes, { flag: "wx" }); created.push(entry.file); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST") || await sha256File(destination) !== entry.checksum) throw error;
      }
    }
  } catch (error) {
    await Promise.all(created.map((file) => rm(path.join(sceneMediaDir, file), { force: true })));
    throw error;
  }
  return created;
}

async function createTrimmedSceneMediaPoster(media: SceneMedia) {
  const workingDir = await mkdtemp(path.join(os.tmpdir(), "ai-facts-scene-poster-"));
  try {
    const outputPath = path.join(workingDir, "poster.jpg");
    const lastFrameSec = Math.max(media.trimInSec, media.trimOutSec - 1 / media.frameRate);
    await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", path.join(sceneMediaDir, media.file), "-ss", lastFrameSec.toFixed(6), "-map", "0:v:0", "-frames:v", "1", "-q:v", "3", "-pix_fmt", "yuvj420p", "-threads", "1", "-f", "image2", "-y", outputPath], { timeout: 30_000, maxBuffer: 1024 * 1024 });
    const bytes = await readFile(outputPath);
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error("Poster frame hasil trim tidak valid.");
    const checksum = createHash("sha256").update(bytes).digest("hex");
    return { file: `${checksum}.jpg`, sha256: checksum, bytes: bytes.length, buffer: bytes };
  } finally { await rm(workingDir, { recursive: true, force: true }); }
}

async function writeSceneMediaPosterFile(file: string, checksum: string, bytes: Buffer) {
  if (!/^[a-f0-9]{64}\.jpg$/.test(file) || file !== `${checksum}.jpg` || bytes.length > 2 * 1024 * 1024 || createHash("sha256").update(bytes).digest("hex") !== checksum) {
    throw new Error("Hash atau ukuran poster scene media tidak valid.");
  }
  const destination = path.join(sceneMediaDir, file);
  try { await writeFile(destination, bytes, { flag: "wx" }); }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST") || await sha256File(destination) !== checksum) throw error;
  }
}

async function persistVisualAsset(projectId: string, asset: VisualAsset, bytes: Buffer) {
  const createdFile = await writeVisualAssetFile(asset, bytes);
  const destination = path.join(visualAssetDir, asset.file);
  try {
    const row = projectRow(projectId);
    if (!row) throw new Error("Project tidak ditemukan.");
    const project = projectFromRow(row);
    const existingIndex = project.visualAssets.findIndex((item) => item.id === asset.id);
    if (existingIndex >= 0) project.visualAssets[existingIndex] = asset;
    else project.visualAssets.push(asset);
    saveProject(projectId, project);
    upsertVisualAssetCatalog(db, asset);
    invalidateBundleCache();
    return { project: getProject(projectId), asset };
  } catch (error) {
    if (createdFile) {
      const referenced = projectReferencesVisualAsset(asset.file) || snapshotReferencesVisualAsset(asset.file) || reusableSceneReferencesVisualAsset(asset.file);
      if (!referenced) await rm(destination, { force: true });
    }
    throw error;
  }
}

async function prepareVisualAssetUpload(file: Express.Multer.File, metadata: Record<string, unknown>) {
  if (file.size > 10 * 1024 * 1024) throw new Error("File melebihi batas 10 MB; kompres atau ekspor ulang gambar.");
  const processed = await validateAndOptimizeRasterImage(file.buffer, file.mimetype);
  const image = processed.image;
  const sha256 = createHash("sha256").update(processed.buffer).digest("hex");
  const assetFile = `${sha256}.${image.extension}`;
  const name = typeof metadata.name === "string" && metadata.name.trim()
    ? metadata.name.trim().slice(0, 120)
    : path.basename(file.originalname, path.extname(file.originalname)).slice(0, 120) || "Ilustrasi pengguna";
  const listField = (value: unknown, max: number, maxLength: number) => {
    const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
    return [...new Set(values.map((item) => String(item).trim()).filter(Boolean).map((item) => item.slice(0, maxLength)))].slice(0, max);
  };
  const source = metadata.source === "ai-generated" ? "ai-generated" : "user-upload";
  const prompt = typeof metadata.prompt === "string" ? metadata.prompt.trim().slice(0, 4000) : "";
  const provider = typeof metadata.provider === "string" && metadata.provider.trim() ? metadata.provider.trim().slice(0, 120) : "external-manual-import";
  const model = typeof metadata.model === "string" && metadata.model.trim() ? metadata.model.trim().slice(0, 120) : undefined;
  const asset = visualAssetSchema.parse({
    id: `upload-${assetFile}`, name, visualCategory: "user-illustration", assetType: "illustration",
    semanticTags: listField(metadata.semanticTags, 20, 60), supportedConcepts: listField(metadata.supportedConcepts, 12, 80),
    role: source === "ai-generated" ? "Ilustrasi AI eksternal yang diimpor manual; kecocokan menunggu review manusia." : "Ilustrasi pengguna; kecocokan menunggu review manusia.",
    format: image.format, aspectRatio: image.width / image.height, source,
    license: typeof metadata.license === "string" && metadata.license.trim() ? metadata.license.trim().slice(0, 160) : "User-provided; license/provenance not specified",
    style: typeof metadata.style === "string" && metadata.style.trim() ? metadata.style.trim().slice(0, 120) : "clean-flat-2d",
    ...(source === "ai-generated" ? { prompt, provider, ...(model ? { model } : {}) } : {}),
    originalName: path.basename(file.originalname).slice(0, 255) || "illustration-upload",
    originalMimeType: file.mimetype,
    originalBytes: file.size,
    originalSha256: createHash("sha256").update(file.buffer).digest("hex"),
    ...(provider.toLocaleLowerCase("en-US").includes("google flow") ? { usageMetadata: "Google Flow output reported by user; imported manually; provider origin not independently verified." } : {}),
    sha256, bytes: processed.buffer.length, width: image.width, height: image.height, file: assetFile,
  });
  return { asset, buffer: processed.buffer, optimized: processed.optimized, originalBytes: processed.originalBytes };
}

async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, action: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await action(items[index]!, index);
    }
  }));
  return results;
}

async function availableHfImageModels(forceRefresh = false) {
  if (!forceRefresh && aiImageModelCache && aiImageModelCache.expiresAt > Date.now()) return aiImageModelCache.models;
  const models = await discoverHuggingFaceImageModels();
  aiImageModelCache = { models, expiresAt: Date.now() + 5 * 60_000 };
  return models;
}

async function aiImageProviderCatalog() {
  const config = huggingFaceImageConfiguration();
  const provider = {
    id: "huggingface-inference",
    displayName: "Hugging Face Inference Providers · hf-inference",
    models: [] as Array<{ id: string; license: string | null }>,
    selectedModel: config.model || DEFAULT_HF_IMAGE_MODEL,
    supportedAspectRatios: ["9:16"],
    resolutions: [...HF_IMAGE_RESOLUTIONS],
    estimatedCost: null,
    costDisclosure: "Harga, kredit tersisa, dan kuota akun tidak dapat diverifikasi aplikasi; setiap request dapat dikenai biaya.",
  };
  if (!config.configured) return {
    status: "Not Configured" as AiImageStatus, configured: false, providers: [provider],
    message: !config.token ? "HF_TOKEN belum diatur di server." : !config.enabled ? "AI Image disabled. Set HF_IMAGE_GENERATION_ENABLED=true untuk opt-in operator." : "Set HF_IMAGE_ALLOW_PAID=true hanya jika operator mengizinkan kemungkinan biaya; saldo tidak dapat diverifikasi.",
    retryAt: null,
  };
  let models: typeof provider.models;
  try { models = await availableHfImageModels(); }
  catch (error) {
    aiImageRuntime = { status: "Failed", message: error instanceof Error ? error.message : "Katalog Hugging Face gagal diperiksa.", retryAt: null };
    return { status: aiImageRuntime.status, configured: false, providers: [provider], message: aiImageRuntime.message, retryAt: null };
  }
  provider.models = models;
  if (activeAiImageGeneration) return { status: "Generating" as AiImageStatus, configured: models.length > 0, providers: [provider], message: "Satu gambar sedang dibuat; request tambahan ditolak.", retryAt: null };
  if (aiImageRuntime.status === "Rate Limited" && aiImageRuntime.retryAt && Date.parse(aiImageRuntime.retryAt) <= Date.now()) {
    aiImageRuntime = { status: "Ready", message: null, retryAt: null };
  }
  if (aiImageRuntime.status === "Rate Limited" || aiImageRuntime.status === "Quota Exhausted" || aiImageRuntime.status === "Failed") {
    return { status: aiImageRuntime.status, configured: models.length > 0, providers: [provider], message: aiImageRuntime.message, retryAt: aiImageRuntime.retryAt };
  }
  if (!models.length) return { status: "Failed" as AiImageStatus, configured: false, providers: [provider], message: "Tidak ada model text-to-image live pada hf-inference.", retryAt: null };
  aiImageRuntime = { status: "Ready", message: null, retryAt: null };
  return { status: "Ready" as AiImageStatus, configured: true, providers: [provider], message: "Model diverifikasi live pada Hub. Harga dan saldo akun tidak diketahui; generation dapat dikenai biaya.", retryAt: null };
}

let cleanupRun: Promise<number> | null = null;

function processFileCleanupQueue(): Promise<number> {
  if (cleanupRun) return cleanupRun;
  cleanupRun = runFileCleanupQueue().finally(() => { cleanupRun = null; });
  return cleanupRun;
}

async function runFileCleanupQueue() {
  const queue = db.prepare("SELECT root, relative_path FROM file_cleanup_queue ORDER BY CASE root WHEN 'jobs' THEN 0 ELSE 1 END, created_at").all() as Array<{ root: string; relative_path: string }>;
  for (const item of queue) {
    const base = cleanupRoots[item.root as CleanupRoot];
    const target = base ? path.resolve(base, item.relative_path) : "";
    const relative = base ? path.relative(base, target) : "";
    if (!base || !relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
       || item.root === "audio" && path.dirname(target) !== audioDir
       || item.root === "visual-assets" && (path.dirname(target) !== visualAssetDir || !/^[a-f0-9]{64}\.(png|jpg|webp|svg)$/.test(path.basename(target)))
       || item.root === "scene-media" && (path.dirname(target) !== sceneMediaDir || !/^[a-f0-9]{64}\.(mp4|jpg)$/.test(path.basename(target)))) {
      db.prepare("UPDATE file_cleanup_queue SET attempt_count = attempt_count + 1, last_error = ? WHERE root = ? AND relative_path = ?")
        .run("Cleanup path invalid/outside allowed root.", item.root, item.relative_path);
      continue;
    }
    try {
      if (item.root === "visual-assets" && projectReferencesVisualAsset(path.basename(target))) {
        db.prepare("DELETE FROM file_cleanup_queue WHERE root = ? AND relative_path = ?").run(item.root, item.relative_path);
        continue;
      }
      if (item.root === "visual-assets" && snapshotReferencesVisualAsset(path.basename(target))) {
        db.prepare("UPDATE file_cleanup_queue SET attempt_count = attempt_count + 1, last_error = ? WHERE root = ? AND relative_path = ?")
          .run("Asset masih dirujuk snapshot render.", item.root, item.relative_path);
        continue;
      }
      if (item.root === "visual-assets" && reusableSceneReferencesVisualAsset(path.basename(target))) {
        db.prepare("UPDATE file_cleanup_queue SET attempt_count = attempt_count + 1, last_error = ? WHERE root = ? AND relative_path = ?")
          .run("Asset masih dirujuk reusable scene.", item.root, item.relative_path);
        continue;
      }
      if (item.root === "scene-media" && projectReferencesSceneMedia(path.basename(target))) {
        db.prepare("DELETE FROM file_cleanup_queue WHERE root = ? AND relative_path = ?").run(item.root, item.relative_path);
        continue;
      }
      if (item.root === "scene-media" && snapshotReferencesSceneMedia(path.basename(target))) {
        db.prepare("UPDATE file_cleanup_queue SET attempt_count = attempt_count + 1, last_error = ? WHERE root = ? AND relative_path = ?")
          .run("Scene media masih dirujuk snapshot render.", item.root, item.relative_path);
        continue;
      }
      await rm(target, { recursive: true, force: true });
      if (item.root === "visual-assets") db.prepare("UPDATE visual_asset_catalog SET available_local = 0 WHERE asset_id = ?").run(`upload-${path.basename(target)}`);
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
  const generationMode = readAiGenerationMode(db);
  const recent = db.prepare("SELECT created_at FROM video_job_requests WHERE created_at > ? ORDER BY created_at ASC")
    .all(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) as Array<{ created_at: string }>;
  const allowance = canStartNewJob(recent.map((row) => row.created_at), Date.now(), dailyLimit);
  response.json({ ffmpegAvailable, githubWorkflowAvailable: existsSync(path.resolve(root, ".github/workflows/render-video.yml")), generationMode, dailyLimit, jobsUsed: recent.length, nextAllowedAt: generationMode === "production" ? allowance.nextAllowedAt : null });
});

const aiGenerationModeSchema = z.object({ mode: z.enum(["development", "production"]) }).strict();
const aiGenerationRequestSchema = z.object({ input: aiGenerationInputSchema, model: z.string().trim().min(1).max(300).optional() }).strict();
const visualPlannerRequestSchema = z.object({ model: z.string().trim().min(1).max(300).optional() }).strict();
const localSettingsOnly = (request: express.Request, response: express.Response) => {
  if (isLoopbackAddress(request.socket.remoteAddress)) return true;
  apiError(response, 403, "AI Generation Settings hanya bisa dibaca dan diubah dari perangkat lokal.", { code: "local-only" });
  return false;
};

const sameOriginRequest = (request: express.Request, response: express.Response) => {
  const origin = request.get("origin");
  let parsedOrigin: URL;
  try { parsedOrigin = new URL(origin ?? ""); }
  catch { apiError(response, 403, "Request AI harus berasal dari origin aplikasi lokal.", { code: "invalid-origin" }); return false; }
  const originHost = parsedOrigin.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const requestHost = request.get("host")?.toLowerCase();
  const frontendPort = Number(process.env.VITE_PORT ?? 5173);
  const originPort = Number(parsedOrigin.port || (parsedOrigin.protocol === "https:" ? 443 : 80));
  const backendHost = process.env.HOST ?? "127.0.0.1";
  const backendAuthorityHost = backendHost.includes(":") && !backendHost.startsWith("[") ? `[${backendHost}]` : backendHost;
  const backendPort = Number(process.env.PORT ?? 3001);
  const viteProxyRequest = request.get("x-ai-facts-studio-vite-proxy") === "vite"
    && Number.isInteger(frontendPort) && frontendPort > 0 && frontendPort <= 65535
    && originPort === frontendPort
    && requestHost === `${backendAuthorityHost}:${backendPort}`.toLowerCase();
  const sameHost = parsedOrigin.host.toLowerCase() === requestHost;
  if (!["http:", "https:"].includes(parsedOrigin.protocol) || !["127.0.0.1", "::1", "localhost"].includes(originHost) || (!sameHost && !viteProxyRequest)) {
    apiError(response, 403, "Request AI harus berasal dari origin aplikasi lokal.", { code: "invalid-origin" });
    return false;
  }
  return true;
};

app.get("/api/settings/ai-generation", async (request, response) => {
  if (!localSettingsOnly(request, response)) return;
  response.json(getAiGenerationSettings(db, process.env, Date.now(), await getOpenCodeProviderStatus()));
});

app.put("/api/settings/ai-generation", async (request, response) => {
  if (!localSettingsOnly(request, response)) return;
  const parsed = aiGenerationModeSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "AI Generation Mode harus Development atau Production.", { code: "invalid-ai-generation-mode", issues: parsed.error.issues });
  const settings = getAiGenerationSettings(db);
  if (parsed.data.mode === "production" && !settings.providers.production.configured) {
    return apiError(response, 409, settings.providers.production.disabledReason ?? "Production belum dikonfigurasi.", { code: "ai-generation-unconfigured" });
  }
  writeAiGenerationMode(db, parsed.data.mode);
  response.json(getAiGenerationSettings(db, process.env, Date.now(), await getOpenCodeProviderStatus()));
});

app.post("/api/ai-generation", async (request, response) => {
  if (!localSettingsOnly(request, response)) return;
  if (!sameOriginRequest(request, response)) return;
  if (activeAiGeneration) return apiError(response, 409, "AI generation sedang berjalan. Tunggu sampai selesai.", { code: "generation-in-progress" });
  const parsed = aiGenerationRequestSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "Input topik atau URL sumber tidak valid.", { code: "invalid-ai-generation-input", issues: parsed.error.issues });
  const mode = readAiGenerationMode(db);
  let provider: GeminiTextGenerationProvider | OpenCodeTextGenerationProvider;
  let production = null as ReturnType<typeof getAiGenerationSettings>["providers"]["production"] | null;
  if (mode === "development") {
    const openCode = new OpenCodeTextGenerationProvider(parsed.data.model ?? "");
    const status = await openCode.status();
    if (!status.configured) return apiError(response, 503, status.disabledReason ?? "OpenCode lokal belum tersedia.", { code: "opencode-unavailable" });
    if (!parsed.data.model || !status.models.some((model) => model.id === parsed.data.model)) return apiError(response, 400, "Pilih model yang terhubung di OpenCode.", { code: "opencode-model-required" });
    provider = openCode;
  } else {
    const settings = getAiGenerationSettings(db).providers.production;
    if (!settings.configured || !settings.model) return apiError(response, 503, settings.disabledReason ?? "Gemini Text belum dikonfigurasi.", { code: "not-configured" });
    production = settings;
    provider = new GeminiTextGenerationProvider(settings.model, process.env.GEMINI_API_KEY?.trim() ?? "");
  }

  if (activeAiGeneration) return apiError(response, 409, "AI generation sedang berjalan. Tunggu sampai selesai.", { code: "generation-in-progress" });
  activeAiGeneration = true;
  activeAiGenerationPhase = "connecting";
  const generationController = new AbortController();
  const abortGeneration = () => generationController.abort();
  request.once("aborted", abortGeneration);
  response.once("close", () => { if (!response.writableEnded) abortGeneration(); });
  try {
    const draft = await generateAiResearchStoryboard(db, mode, production, parsed.data.input, provider, {
      signal: generationController.signal,
      onPhase: (phase) => { activeAiGenerationPhase = phase; },
    });
    response.json(draft);
  } catch (error) {
    if (error instanceof AiGenerationOutputError) return apiError(response, 422, error.message, { code: "ai-output-invalid", issues: error.issues });
     if (error instanceof AiGenerationRequestError) return apiError(response, error.httpStatus, error.message, { code: error.code, nextAllowedAt: error.nextAllowedAt, quotaType: error.quotaType });
     if (error instanceof GeminiTextGenerationError) return apiError(response, error.httpStatus, error.message, { code: error.code, quotaType: error.quotaType, retryAt: error.retryAt });
    if (error instanceof OpenCodeGenerationError) return apiError(response, error.httpStatus, error.message, { code: error.code });
    if (generationController.signal.aborted) return apiError(response, 499, "Generation dibatalkan.", { code: "cancelled" });
    console.error("AI Generation failed:", error instanceof Error ? error.message : "Unknown provider error");
    apiError(response, 502, "AI Research/Storyboard gagal dibuat. Periksa konfigurasi atau coba lagi.", { code: "ai-generation-failed" });
  } finally {
    request.off("aborted", abortGeneration);
    activeAiGeneration = false;
    activeAiGenerationPhase = "idle";
  }
});

app.post("/api/projects/:id/scenes/:sceneId/visual-plan", async (request, response) => {
  if (!localSettingsOnly(request, response) || !sameOriginRequest(request, response)) return;
  if (activeAiGeneration) return apiError(response, 409, "AI generation sedang berjalan. Tunggu sampai selesai.", { code: "generation-in-progress" });
  const requestData = visualPlannerRequestSchema.safeParse(request.body ?? {});
  if (!requestData.success) return apiError(response, 400, "Pilihan model visual planner tidak valid.", { code: "invalid-visual-planner-input", issues: requestData.error.issues });
  const row = projectRow(String(request.params.id));
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  const project = projectFromRow(row);
  const scene = project.visualStoryboard.scenes.find((item) => item.sceneId === String(request.params.sceneId));
  if (!scene) return apiError(response, 404, "Scene Visual Storyboard tidak ditemukan.");
  const inputResult = visualPlannerInputSchema.safeParse({ headline: scene.headline, narration: scene.narrationText, visualDescription: scene.visualSummary });
  if (!inputResult.success) return apiError(response, 400, "Copy scene belum memenuhi kontrak visual planner.", { issues: inputResult.error.issues });

  const mode = readAiGenerationMode(db);
  let provider: GeminiTextGenerationProvider | OpenCodeTextGenerationProvider;
  let production = null as ReturnType<typeof getAiGenerationSettings>["providers"]["production"] | null;
  if (mode === "development") {
    const openCode = new OpenCodeTextGenerationProvider(requestData.data.model ?? "");
    const status = await openCode.status();
    if (!status.configured) return apiError(response, 503, status.disabledReason ?? "OpenCode lokal belum tersedia.", { code: "opencode-unavailable" });
    if (!requestData.data.model || !status.models.some((item) => item.id === requestData.data.model)) return apiError(response, 400, "Pilih model OpenCode terhubung untuk visual planning.", { code: "opencode-model-required" });
    provider = openCode;
  } else {
    const settings = getAiGenerationSettings(db).providers.production;
    if (!settings.configured || !settings.model) return apiError(response, 503, settings.disabledReason ?? "Gemini Text belum dikonfigurasi.", { code: "not-configured" });
    production = settings;
    provider = new GeminiTextGenerationProvider(settings.model, process.env.GEMINI_API_KEY?.trim() ?? "");
  }

  activeAiGeneration = true;
  activeAiGenerationPhase = "connecting";
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.once("aborted", abort);
  response.once("close", () => { if (!response.writableEnded) abort(); });
  try {
    const result = await generateVisualSemanticPlan(db, mode, production, provider, inputResult.data, {
      signal: controller.signal,
      onPhase: (phase) => { activeAiGenerationPhase = phase; },
    });
    response.json(result);
  } catch (error) {
    if (error instanceof AiGenerationRequestError) return apiError(response, error.httpStatus, error.message, { code: error.code, nextAllowedAt: error.nextAllowedAt, quotaType: error.quotaType });
    if (error instanceof GeminiTextGenerationError) return apiError(response, error.httpStatus, error.message, { code: error.code, quotaType: error.quotaType, retryAt: error.retryAt });
    if (error instanceof OpenCodeGenerationError) return apiError(response, error.httpStatus, error.message, { code: error.code });
    if (controller.signal.aborted) return apiError(response, 499, "Visual planning dibatalkan.", { code: "cancelled" });
    apiError(response, 422, error instanceof Error ? error.message : "Visual planner output tidak valid.", { code: "visual-plan-invalid" });
  } finally {
    request.off("aborted", abort);
    activeAiGeneration = false;
    activeAiGenerationPhase = "idle";
  }
});

app.post("/api/projects/:id/scenes/:sceneId/visual-vector", async (request, response) => {
  if (!localSettingsOnly(request, response) || !sameOriginRequest(request, response)) return;
  if (activeAiGeneration) return apiError(response, 409, "AI generation sedang berjalan. Tunggu sampai selesai.", { code: "generation-in-progress" });
  const requestData = visualPlannerRequestSchema.safeParse(request.body ?? {});
  if (!requestData.success) return apiError(response, 400, "Pilihan model AI Vector tidak valid.", { code: "invalid-ai-vector-input", issues: requestData.error.issues });
  const row = projectRow(String(request.params.id));
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  if (activeProjectTasks.has(String(request.params.id)) || activeRenderJob || activeJobCreation) return apiError(response, 409, "Project sedang dipersiapkan atau dirender.", { code: "project-busy" });
  const project = projectFromRow(row);
  const scene = project.visualStoryboard.scenes.find((item) => item.sceneId === String(request.params.sceneId));
  if (!scene) return apiError(response, 404, "Scene Visual Storyboard tidak ditemukan.");
  const inputResult = visualPlannerInputSchema.safeParse({
    headline: scene.headline, narration: scene.narrationText, visualDescription: scene.visualSummary,
    artDirection: { styleId: project.visualStoryboard.styleId, palette: project.visualStoryboard.palette },
    visualPlan: { focus: scene.visualFocus, objects: scene.objects.map((item) => item.objectId), relationships: scene.relationships },
  });
  if (!inputResult.success) return apiError(response, 400, "Copy scene belum memenuhi kontrak AI Vector.", { issues: inputResult.error.issues });
  if (readAiGenerationMode(db) !== "development") return apiError(response, 409, "AI Vector PoC membutuhkan OpenCode Development mode.", { code: "opencode-mode-required" });

  const openCode = new OpenCodeTextGenerationProvider(requestData.data.model ?? "");
  const status = await openCode.status();
  if (!status.configured) return apiError(response, 503, status.disabledReason ?? "OpenCode lokal belum tersedia.", { code: "opencode-unavailable" });
  if (!requestData.data.model || !status.models.some((model) => model.id === requestData.data.model)) {
    return apiError(response, 400, "Pilih model OpenCode terhubung untuk AI Vector.", { code: "opencode-model-required" });
  }

  activeAiGeneration = true;
  activeAiGenerationPhase = "connecting";
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.once("aborted", abort);
  response.once("close", () => { if (!response.writableEnded) abort(); });
  try {
    const result = await generateAiVectorIllustration(db, openCode, inputResult.data, {
      signal: controller.signal,
      onPhase: (phase) => { activeAiGenerationPhase = phase; },
    });
    response.json(result);
  } catch (error) {
    if (error instanceof OpenCodeGenerationError) return apiError(response, error.httpStatus, error.message, { code: error.code });
    if (controller.signal.aborted) return apiError(response, 499, "AI Vector generation dibatalkan.", { code: "cancelled" });
    apiError(response, 422, error instanceof Error ? error.message : "AI Vector output tidak valid.", { code: "ai-vector-invalid" });
  } finally {
    request.off("aborted", abort);
    activeAiGeneration = false;
    activeAiGenerationPhase = "idle";
  }
});

app.get("/api/ai-generation/status", (request, response) => {
  if (!localSettingsOnly(request, response)) return;
  response.json({ active: activeAiGeneration, phase: activeAiGenerationPhase });
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

app.get("/api/sample", async (request, response) => {
  const topic = request.query.topic;
  if (topic !== undefined && topic !== "volcano-formation") return response.status(404).json({ error: "Sample tidak ditemukan." });
  const sourcePath = topic === "volcano-formation" ? volcanoSamplePath : samplePath;
  response.json(JSON.parse(await readFile(sourcePath, "utf8")));
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

app.get("/api/projects/:id/scene-media-health", async (request, response) => {
  const row = projectRow(request.params.id);
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  const project = projectFromRow(row);
  if (project.visualStoryboardError) return response.json({ errors: {} });
  const results = await Promise.all(project.visualStoryboard.scenes.map(async (scene) => scene.sceneMedia
    ? [scene.sceneId, await sceneMediaIntegrityError(scene.sceneMedia)] as const
    : null));
  const errors: Record<string, string> = {};
  for (const result of results) if (result?.[1]) errors[result[0]] = result[1];
  response.json({ errors });
});

app.post("/api/projects", (request, response) => {
  const parsed = parseResearchPackage(request.body?.researchPackage);
  if (!parsed.success) return apiError(response, 400, "Research package tidak valid.", { issues: parsed.error.issues });
  const rawRequestId = request.body?.requestId;
  const requestIdResult = rawRequestId === undefined ? null : z.string().uuid().safeParse(rawRequestId);
  if (requestIdResult && !requestIdResult.success) return apiError(response, 400, "Request ID idempotency tidak valid.", { code: "invalid-request-id" });
  const requestId = requestIdResult?.success ? requestIdResult.data : null;
  const researchSha256 = createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");
  const now = new Date().toISOString();
  const stored: StoredProject = { researchPackage: parsed.data, visualStoryboard: buildVisualStoryboard(parsed.data), visualAssets: [], audio: null, pendingTts: null, narrationMode: "unset", researchReviewStatus: "needs-review" };
  const create = () => {
    const id = randomUUID();
    db.prepare("INSERT INTO projects (id, title, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, parsed.data.title, JSON.stringify(stored), now, now);
    if (requestId) db.prepare("INSERT INTO project_create_requests (request_id, project_id, research_sha256, created_at) VALUES (?, ?, ?, ?)")
      .run(requestId, id, researchSha256, now);
    return { id, replay: false, conflict: false };
  };
  const created = requestId ? withTransaction(() => {
    const existing = db.prepare("SELECT project_id, research_sha256 FROM project_create_requests WHERE request_id = ?").get(requestId) as { project_id: string; research_sha256: string } | undefined;
    if (!existing) return create();
    return { id: existing.project_id, replay: existing.research_sha256 === researchSha256, conflict: existing.research_sha256 !== researchSha256 };
  }) : create();
  if (created.conflict) return apiError(response, 409, "Request ID sudah dipakai untuk Research Package berbeda.", { code: "idempotency-conflict" });
  response.status(created.replay ? 200 : 201).json(getProject(created.id));
});

app.put("/api/projects/:id", async (request, response) => {
  const row = projectRow(request.params.id);
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  if (activeProjectTasks.has(String(request.params.id)) || activeRenderJob || activeJobCreation) return apiError(response, 409, "Project sedang dipersiapkan atau dirender.", { code: "project-busy" });
  const parsed = parseResearchPackage(request.body?.researchPackage);
  if (!parsed.success) return apiError(response, 400, "Research package tidak valid.", { issues: parsed.error.issues });
  const narrationMode = request.body && Object.hasOwn(request.body, "narrationMode")
    ? z.enum(["unset", "audio", "manual"]).safeParse(request.body.narrationMode)
    : null;
  if (narrationMode && !narrationMode.success) return apiError(response, 400, "Pilihan mode narasi tidak valid.", { code: "invalid-narration-mode" });
  const project = projectFromRow(row);
  if (invalidStoryboardResponse(response, project)) return;
  const previousSceneMediaFiles = new Set(project.visualStoryboard.scenes.flatMap((scene) => scene.sceneMedia ? [scene.sceneMedia.file, scene.sceneMedia.posterFile] : []));
  let storyboardResult: ReturnType<typeof visualStoryboardSchema.safeParse>;
  if (request.body?.visualStoryboard === undefined) {
    try {
      const sameSceneIds = project.researchPackage.scenes.length === parsed.data.scenes.length
        && project.researchPackage.scenes.every((scene, index) => scene.id === parsed.data.scenes[index]?.id);
      const timingChanged = sameSceneIds && project.researchPackage.scenes.some((scene, index) => scene.startSec !== parsed.data.scenes[index]?.startSec || scene.endSec !== parsed.data.scenes[index]?.endSec);
      const priorBoard = timingChanged ? retimeVisualStoryboard(project.visualStoryboard, project.researchPackage, parsed.data) : project.visualStoryboard;
      storyboardResult = visualStoryboardSchema.safeParse(buildVisualStoryboard(parsed.data, priorBoard));
    } catch (error) {
      return apiError(response, 400, "Visual Storyboard tidak dapat disinkronkan tanpa kehilangan data.", { code: "visual-storyboard-retime-failed", message: error instanceof Error ? error.message : "Data timing tidak valid." });
    }
  } else storyboardResult = visualStoryboardSchema.safeParse(request.body.visualStoryboard);
  if (!storyboardResult.success) return apiError(response, 400, "Visual Storyboard tidak valid.", { code: "invalid-visual-storyboard", issues: storyboardResult.error.issues });
  if (storyboardResult.data.scenes.length !== parsed.data.scenes.length || storyboardResult.data.scenes.some((scene, index) => scene.sceneId !== parsed.data.scenes[index]?.id || scene.durationSec !== Math.round(((parsed.data.scenes[index]?.endSec ?? 0) - (parsed.data.scenes[index]?.startSec ?? 0)) * 1000) / 1000)) {
    return apiError(response, 400, "Scene Visual Storyboard harus cocok dengan Research Package.", { code: "visual-storyboard-scene-mismatch" });
  }
  let storyboard = storyboardResult.data;
  for (const scene of storyboard.scenes) if (scene.sceneMedia) {
    const media = scene.sceneMedia;
    const error = await sceneMediaIntegrityError(media);
    if (error) return apiError(response, 409, error, { code: "scene-media-integrity-failed", sceneId: scene.sceneId });
    if (media.posterTrimOutSec !== media.trimOutSec) {
      try {
        const poster = await createTrimmedSceneMediaPoster(media);
        await writeSceneMediaPosterFile(poster.file, poster.sha256, poster.buffer);
        const updatedMedia: SceneMedia = { ...media, posterFile: poster.file, posterSha256: poster.sha256, posterBytes: poster.bytes, posterTrimOutSec: media.trimOutSec };
        storyboard = { ...storyboard, scenes: storyboard.scenes.map((item) => item.sceneId === scene.sceneId ? { ...item, sceneMedia: updatedMedia } : item) };
      } catch (error) {
        return apiError(response, 422, error instanceof Error ? error.message : "Poster untuk trim scene media gagal dibuat.", { code: "scene-media-poster-failed", sceneId: scene.sceneId });
      }
    }
  }
  const missingAssets = missingVisualAssetReferences(storyboard, project.visualAssets);
  if (missingAssets.length) return apiError(response, 400, "Visual Storyboard merujuk aset yang tidak dimiliki project ini.", { code: "visual-asset-not-found", assets: [...new Set(missingAssets)] });
  const storyboardResearch = parseResearchPackage(applyVisualStoryboard(parsed.data, storyboard));
  if (!storyboardResearch.success) return apiError(response, 400, "Visual Storyboard menghasilkan Research Package tidak valid.", { code: "invalid-visual-storyboard-research", issues: storyboardResearch.error.issues });
  const factsChanged = factReviewContent(project.researchPackage) !== factReviewContent(storyboardResearch.data);
  project.researchPackage = storyboardResearch.data;
  project.visualStoryboard = storyboard;
  if (narrationMode?.success) project.narrationMode = narrationMode.data;
  if (factsChanged) project.researchReviewStatus = "needs-review";
  if (project.pendingTts && project.pendingTts.scriptSha256 !== createHash("sha256").update(narrationScript(parsed.data)).digest("hex")) project.pendingTts = null;
  const nextSceneMediaFiles = new Set(storyboard.scenes.flatMap((scene) => scene.sceneMedia ? [scene.sceneMedia.file, scene.sceneMedia.posterFile] : []));
  withTransaction(() => {
    saveProject(row.id, project);
    for (const file of previousSceneMediaFiles) if (!nextSceneMediaFiles.has(file)) queueFileCleanup("scene-media", path.join(sceneMediaDir, file));
  });
  await tryProcessFileCleanupQueue();
  response.json(getProject(row.id));
});

app.get("/api/projects/:id/visual-preparation", (request, response) => {
  const id = String(request.params.id);
  if (!projectRow(id)) return apiError(response, 404, "Project tidak ditemukan.");
  const row = db.prepare("SELECT data_json FROM visual_preparation_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").get(id) as { data_json: string } | undefined;
  try { response.json({ job: row ? JSON.parse(row.data_json) as VisualPreparationJob : null }); }
  catch { apiError(response, 500, "Status persiapan visual tidak dapat dibaca."); }
});

app.post("/api/projects/:id/visual-preparation", (request, response) => {
  if (!localSettingsOnly(request, response) || !sameOriginRequest(request, response)) return;
  const id = String(request.params.id);
  const row = projectRow(id);
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  const input = z.object({ requestId: z.string().uuid(), sceneIds: z.array(z.string().trim().min(1).max(100)).max(30).optional() }).strict().safeParse(request.body);
  if (!input.success) return apiError(response, 400, "Permintaan persiapan visual tidak valid.", { code: "invalid-visual-preparation", issues: input.error.issues });
  const requestSha256 = createHash("sha256").update(JSON.stringify({ sceneIds: input.data.sceneIds ? [...new Set(input.data.sceneIds)].sort() : null })).digest("hex");
  const sameRequest = db.prepare("SELECT data_json, request_sha256 FROM visual_preparation_jobs WHERE project_id = ? AND request_id = ?").get(id, input.data.requestId) as { data_json: string; request_sha256: string } | undefined;
  if (sameRequest) {
    if (sameRequest.request_sha256 && sameRequest.request_sha256 !== requestSha256) return apiError(response, 409, "Request ID sudah dipakai untuk pilihan scene berbeda.", { code: "idempotency-conflict" });
    return response.status(200).json({ job: JSON.parse(sameRequest.data_json), replay: true });
  }
  const active = db.prepare("SELECT data_json FROM visual_preparation_jobs WHERE project_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1").get(id) as { data_json: string } | undefined;
  if (active) return response.status(202).json({ job: JSON.parse(active.data_json), replay: true });
  if (activeVisualPreparation || activeMotionPreparation) return apiError(response, 409, "Satu batch visual/motion sedang berjalan. Tunggu sampai selesai.", { code: "visual-preparation-busy" });
  if (activeRenderJob || activeJobCreation || activeProjectTasks.has(id)) return apiError(response, 409, "Project sedang dipersiapkan atau dirender.", { code: "project-busy" });
  const project = projectFromRow(row);
  const requested = input.data.sceneIds ? new Set(input.data.sceneIds) : null;
  if (requested && [...requested].some((sceneId) => !project.visualStoryboard.scenes.some((scene) => scene.sceneId === sceneId))) {
    return apiError(response, 400, "Pilihan scene tidak ada di project.", { code: "visual-preparation-scene-not-found" });
  }
  const research = applyVisualStoryboard(project.researchPackage, project.visualStoryboard);
  const gate = visualStoryboardQualityGate(research, project.visualStoryboard, project.visualAssets);
  const now = new Date().toISOString();
  const scenes: VisualPreparationScene[] = project.visualStoryboard.scenes.map((scene) => {
    if (scene.approved) return { sceneId: scene.sceneId, status: "approved", source: "preserved", message: "Approval dipertahankan; tidak ada generasi ulang." };
    if (protectedVisualScene(scene, project.visualStoryboard)) return {
      sceneId: scene.sceneId, status: scene.authoringStatus === "needs_visual_authoring" ? "needs_attention" : "ready_for_review",
      source: "preserved", message: "Ilustrasi manual/terpilih dipertahankan; tidak ditimpa batch.",
    };
    if (scene.authoringStatus === "needs_visual_authoring" && (!requested || requested.has(scene.sceneId))) {
      return { sceneId: scene.sceneId, status: "pending", message: "Menunggu Smart Hybrid." };
    }
    if (scene.authoringStatus === "needs_visual_authoring") return {
      sceneId: scene.sceneId, status: "needs_attention", message: "Belum diproses oleh permintaan ini.",
      recommendations: ["Pilih Perbaiki Scene Bermasalah untuk mencoba lagi."],
    };
    return {
      sceneId: scene.sceneId,
      status: (gate.scenes[scene.sceneId]?.length ?? 0) ? "needs_attention" : "ready_for_review",
      source: "preserved", message: "Ilustrasi yang tersedia dipertahankan untuk review manusia.",
    };
  });
  const job: VisualPreparationJob = {
    id: randomUUID(), projectId: id, requestId: input.data.requestId, status: "running", total: scenes.length, processed: 0,
    currentSceneId: null, readyForReview: 0, needsAttention: 0, failed: 0, approved: 0, scenes, createdAt: now, updatedAt: now,
  };
  withTransaction(() => writeVisualPreparationJob(job, true, requestSha256));
  activeProjectTasks.add(id);
  void runVisualPreparation(job).catch((error) => {
    for (const scene of job.scenes) if (scene.status === "pending" || scene.status === "preparing") {
      scene.status = "failed";
      scene.message = error instanceof Error ? error.message : "Batch persiapan visual gagal.";
    }
    job.status = "failed";
    job.currentSceneId = null;
    writeVisualPreparationJob(job);
    activeProjectTasks.delete(id);
    activeVisualPreparation = false;
  });
  response.status(202).json({ job, replay: false });
});

app.get("/api/projects/:id/motion-preparation", (request, response) => {
  const id = String(request.params.id);
  if (!projectRow(id)) return apiError(response, 404, "Project tidak ditemukan.");
  const row = db.prepare("SELECT data_json FROM motion_preparation_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").get(id) as { data_json: string } | undefined;
  try { response.json({ job: row ? JSON.parse(row.data_json) as MotionPreparationJob : null }); }
  catch { apiError(response, 500, "Status persiapan motion tidak dapat dibaca."); }
});

app.post("/api/projects/:id/motion-preparation", (request, response) => {
  if (!localSettingsOnly(request, response) || !sameOriginRequest(request, response)) return;
  const id = String(request.params.id);
  const row = projectRow(id);
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  const input = z.object({ requestId: z.string().uuid(), intensity: motionIntensitySchema.default("balanced"), sceneIds: z.array(z.string().trim().min(1).max(100)).max(30).optional() }).strict().safeParse(request.body);
  if (!input.success) return apiError(response, 400, "Permintaan Motion Director tidak valid.", { code: "invalid-motion-preparation", issues: input.error.issues });
  const sceneIds = input.data.sceneIds ? [...new Set(input.data.sceneIds)].sort() : null;
  const requestSha256 = createHash("sha256").update(JSON.stringify({ intensity: input.data.intensity, sceneIds })).digest("hex");
  const sameRequest = db.prepare("SELECT data_json, request_sha256 FROM motion_preparation_jobs WHERE project_id = ? AND request_id = ?").get(id, input.data.requestId) as { data_json: string; request_sha256: string } | undefined;
  if (sameRequest) {
    if (sameRequest.request_sha256 !== requestSha256) return apiError(response, 409, "Request ID sudah dipakai untuk pilihan motion berbeda.", { code: "idempotency-conflict" });
    return response.status(200).json({ job: JSON.parse(sameRequest.data_json), replay: true });
  }
  const active = db.prepare("SELECT data_json FROM motion_preparation_jobs WHERE project_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1").get(id) as { data_json: string } | undefined;
  if (active) return response.status(202).json({ job: JSON.parse(active.data_json), replay: true });
  if (activeMotionPreparation || activeVisualPreparation || activeRenderJob || activeJobCreation || activeProjectTasks.has(id)) return apiError(response, 409, "Project sedang dipersiapkan atau dirender.", { code: "project-busy" });
  const project = projectFromRow(row);
  const requested = sceneIds ? new Set(sceneIds) : null;
  if (requested && [...requested].some((sceneId) => !project.visualStoryboard.scenes.some((scene) => scene.sceneId === sceneId))) {
    return apiError(response, 400, "Pilihan scene tidak ada di project.", { code: "motion-scene-not-found" });
  }
  const research = applyVisualStoryboard(project.researchPackage, project.visualStoryboard);
  const gate = visualStoryboardQualityGate(research, project.visualStoryboard, project.visualAssets);
  const scenes: MotionPreparationScene[] = project.visualStoryboard.scenes.map((scene) => {
    if (scene.approved || scene.motionStatus === "static" || scene.motionActions.length && scene.motionStatus !== "not_prepared") return { sceneId: scene.sceneId, status: "preserved", message: "Motion plan yang sudah ada dipertahankan oleh batch." };
    if (requested && !requested.has(scene.sceneId)) return { sceneId: scene.sceneId, status: "preserved", message: "Scene tidak dipilih dalam permintaan ini." };
    const issues = gate.scenes[scene.sceneId] ?? [];
    if (scene.authoringStatus === "needs_visual_authoring" || issues.length) return { sceneId: scene.sceneId, status: "needs_attention", message: issues[0] ?? "Komposisi belum valid untuk Motion Director." };
    return { sceneId: scene.sceneId, status: "pending", message: "Menunggu Motion Director deterministik." };
  });
  const now = new Date().toISOString();
  const job: MotionPreparationJob = {
    id: randomUUID(), projectId: id, requestId: input.data.requestId, status: "running", intensity: input.data.intensity,
    total: scenes.length, processed: 0, currentSceneId: null, readyForReview: 0, preserved: 0, needsAttention: 0, failed: 0,
    scenes, createdAt: now, updatedAt: now,
  };
  withTransaction(() => writeMotionPreparationJob(job, true, requestSha256));
  activeProjectTasks.add(id);
  void runMotionPreparation(job).catch((error) => {
    for (const scene of job.scenes) if (["pending", "preparing"].includes(scene.status)) {
      scene.status = "failed";
      scene.message = error instanceof Error ? error.message : "Motion batch gagal.";
    }
    job.status = "failed";
    job.currentSceneId = null;
    writeMotionPreparationJob(job);
    activeProjectTasks.delete(id);
    activeMotionPreparation = false;
  });
  response.status(202).json({ job, replay: false });
});

app.post("/api/projects/:id/motion-preparation/:jobId/cancel", (request, response) => {
  if (!localSettingsOnly(request, response) || !sameOriginRequest(request, response)) return;
  const id = String(request.params.id);
  const jobId = String(request.params.jobId);
  const row = db.prepare("SELECT data_json FROM motion_preparation_jobs WHERE id = ? AND project_id = ?").get(jobId, id) as { data_json: string } | undefined;
  if (!row) return apiError(response, 404, "Motion preparation job tidak ditemukan.");
  const job = JSON.parse(row.data_json) as MotionPreparationJob;
  if (job.status !== "running") return response.json({ job });
  job.cancelRequested = true;
  writeMotionPreparationJob(job);
  response.status(202).json({ job });
});

app.get("/api/visual-assets/library", (_request, response) => {
  const page = Math.max(1, Math.min(100_000, Number(_request.query.page) || 1));
  const pageSize = Math.max(1, Math.min(36, Number(_request.query.pageSize) || 18));
  const value = (key: string, max = 120) => typeof _request.query[key] === "string" ? String(_request.query[key]).trim().slice(0, max) : "";
  response.json(searchVisualAssetCatalog(value("q", 200), {
    category: value("category"), assetType: value("type"), style: value("style"), provider: value("provider"), license: value("license"),
  }, page, pageSize));
});

app.get("/api/reusable-scenes", (request, response) => {
  const query = typeof request.query.q === "string" ? request.query.q.trim().slice(0, 200) : "";
  const style = typeof request.query.style === "string" ? request.query.style.slice(0, 80) : "";
  const layout = typeof request.query.layout === "string" ? request.query.layout.slice(0, 80) : "";
  const page = Math.max(1, Math.min(100_000, Number(request.query.page) || 1));
  const pageSize = Math.max(1, Math.min(24, Number(request.query.pageSize) || 12));
  const match = assetFtsExpression(query);
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  if (style) { conditions.push("style_id = ?"); values.push(style); }
  if (layout) { conditions.push("layout = ?"); values.push(layout); }
  if (match) { conditions.push("id IN (SELECT id FROM reusable_scene_compositions_fts WHERE reusable_scene_compositions_fts MATCH ?)"); values.push(match); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM reusable_scene_compositions ${where}`).get(...values) as { count: number }).count;
  const scenes = db.prepare(`SELECT data_json, version, usage_count, created_at, updated_at FROM reusable_scene_compositions ${where} ORDER BY usage_count DESC, updated_at DESC LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize)
    .flatMap((row) => {
      try {
        const stored = row as { data_json: string; version: number; usage_count: number; created_at: string; updated_at: string };
        return [{ ...JSON.parse(stored.data_json), version: stored.version, usageCount: stored.usage_count, createdAt: stored.created_at, updatedAt: stored.updated_at }];
      } catch { return []; }
    });
  const facets = {
    styles: (db.prepare("SELECT DISTINCT style_id AS value FROM reusable_scene_compositions ORDER BY style_id").all() as Array<{ value: string }>).map((row) => row.value),
    layouts: (db.prepare("SELECT DISTINCT layout AS value FROM reusable_scene_compositions ORDER BY layout").all() as Array<{ value: string }>).map((row) => row.value),
  };
  response.json({ scenes, total, page, pageSize, pageCount: Math.ceil(total / pageSize), facets });
});

app.post("/api/projects/:id/reusable-scenes", async (request, response) => {
  const projectId = String(request.params.id);
  const row = projectRow(projectId);
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  const parsed = reusableSceneInputSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "Reusable scene tidak valid.", { code: "invalid-reusable-scene", issues: parsed.error.issues });
  const project = projectFromRow(row);
  const usedAssetIds = [...new Set(parsed.data.composition.layers.flatMap((layer) => layer.nodes.flatMap((node) => node.type === "group" ? node.children : [node])).flatMap((node) => node.type === "image" && node.asset.startsWith("upload-") ? [node.asset] : []))].sort();
  if (JSON.stringify(usedAssetIds) !== JSON.stringify([...new Set(parsed.data.assetIds)].sort())) return apiError(response, 400, "Asset references tidak cocok dengan composition JSON.", { code: "reusable-scene-assets-mismatch" });
  for (const assetId of usedAssetIds) {
    const asset = project.visualAssets.find((item) => item.id === assetId);
    if (!asset || !existsSync(path.join(visualAssetDir, asset.file)) || await sha256File(path.join(visualAssetDir, asset.file)) !== asset.sha256) return apiError(response, 400, "Reusable scene merujuk aset lokal yang tidak tersedia atau hash-nya berubah.", { code: "reusable-scene-asset-unavailable", assetId });
  }
  let thumbnail: Buffer;
  try {
    thumbnail = Buffer.from(parsed.data.thumbnailDataUrl.slice("data:image/png;base64,".length), "base64");
    if (`data:image/png;base64,${thumbnail.toString("base64")}` !== parsed.data.thumbnailDataUrl) throw new Error("PNG thumbnail encoding tidak canonical.");
    validateRasterImage(thumbnail);
  } catch (error) { return apiError(response, 400, error instanceof Error ? error.message : "Thumbnail PNG tidak valid.", { code: "invalid-reusable-scene-thumbnail" }); }
  const id = randomUUID();
  const now = new Date().toISOString();
  const scene = { ...parsed.data, assetIds: usedAssetIds, id, version: 1, usageCount: 0, createdAt: now, updatedAt: now };
  withTransaction(() => {
    db.prepare(`INSERT INTO reusable_scene_compositions (id, name, style_id, layout, tags_json, concepts_json, composition_json, data_json, thumbnail_data_url, version, usage_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`)
      .run(id, scene.name, scene.styleId, scene.layout, JSON.stringify(scene.tags), JSON.stringify(scene.concepts), JSON.stringify(scene.composition), JSON.stringify(scene), scene.thumbnailDataUrl, now, now);
    db.prepare("INSERT INTO reusable_scene_compositions_fts (id, name, tags, concepts) VALUES (?, ?, ?, ?)")
      .run(id, scene.name, scene.tags.join(" "), scene.concepts.join(" "));
  });
  response.status(201).json(scene);
});

app.post("/api/projects/:id/reusable-scenes/:sceneId/attach", async (request, response) => {
  const projectId = String(request.params.id);
  const sceneId = String(request.params.sceneId);
  const row = projectRow(projectId);
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  if (activeRenderJob || activeJobCreation || activeProjectTasks.has(projectId)) return apiError(response, 409, "Reusable scene tidak dapat dipakai saat render atau snapshot berjalan.");
  const stored = db.prepare("SELECT data_json FROM reusable_scene_compositions WHERE id = ?").get(sceneId) as { data_json: string } | undefined;
  if (!stored) return apiError(response, 404, "Reusable scene tidak ditemukan.");
  let scene: ReturnType<typeof reusableSceneInputSchema.parse> & { id: string; version: number; usageCount: number; createdAt: string; updatedAt: string };
  try {
    const saved = JSON.parse(stored.data_json) as typeof scene;
    const input = reusableSceneInputSchema.parse({
      name: saved.name, tags: saved.tags, concepts: saved.concepts, styleId: saved.styleId, layout: saved.layout, compositionType: saved.compositionType,
      composition: saved.composition, palette: saved.palette, motionIntent: saved.motionIntent, motionSummary: saved.motionSummary, motionPlan: saved.motionPlan,
      objects: saved.objects, relationships: saved.relationships, visualFocus: saved.visualFocus, assetIds: saved.assetIds,
      thumbnailDataUrl: saved.thumbnailDataUrl, provenance: saved.provenance,
    });
    scene = { ...input, id: saved.id, version: saved.version, usageCount: saved.usageCount, createdAt: saved.createdAt, updatedAt: saved.updatedAt };
  }
  catch { return apiError(response, 500, "Reusable scene tersimpan tidak valid."); }
  activeProjectTasks.add(projectId);
  try {
    const currentRow = projectRow(projectId);
    if (!currentRow) return apiError(response, 404, "Project tidak ditemukan.");
    const project = projectFromRow(currentRow);
    const missing: string[] = [];
    for (const assetId of scene.assetIds) {
      const catalog = db.prepare("SELECT metadata_json FROM visual_asset_catalog WHERE asset_id = ?").get(assetId) as { metadata_json: string } | undefined;
      if (!catalog) { missing.push(assetId); continue; }
      const asset = visualAssetSchema.safeParse(JSON.parse(catalog.metadata_json));
      if (!asset.success || !existsSync(path.join(visualAssetDir, asset.data.file)) || await sha256File(path.join(visualAssetDir, asset.data.file)) !== asset.data.sha256) { missing.push(assetId); continue; }
      if (!project.visualAssets.some((item) => item.id === assetId)) project.visualAssets.push(asset.data);
    }
    if (missing.length) return apiError(response, 409, "Sebagian aset reusable scene tidak tersedia lokal.", { code: "reusable-scene-assets-unavailable", assets: missing });
    saveProject(projectId, project);
    db.prepare("UPDATE reusable_scene_compositions SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), sceneId);
    invalidateBundleCache();
    response.json({ project: getProject(projectId), scene });
  } finally { activeProjectTasks.delete(projectId); }
});

app.delete("/api/reusable-scenes/:sceneId", async (request, response) => {
  const id = String(request.params.sceneId);
  const stored = db.prepare("SELECT data_json FROM reusable_scene_compositions WHERE id = ?").get(id) as { data_json: string } | undefined;
  if (!stored) return apiError(response, 404, "Reusable scene tidak ditemukan.");
  let assetIds: string[] = [];
  try { assetIds = (JSON.parse(stored.data_json) as { assetIds?: string[] }).assetIds ?? []; } catch { /* malformed record has no trusted file references */ }
  withTransaction(() => {
    db.prepare("DELETE FROM reusable_scene_compositions WHERE id = ?").run(id);
    db.prepare("DELETE FROM reusable_scene_compositions_fts WHERE id = ?").run(id);
    for (const assetId of assetIds) {
      const file = assetId.replace(/^upload-/, "");
      if (!projectReferencesVisualAsset(file) && !snapshotReferencesVisualAsset(file)) queueFileCleanup("visual-assets", path.join(visualAssetDir, file));
    }
  });
  const cleanupPending = await tryProcessFileCleanupQueue();
  response.json({ deleted: true, cleanupPending });
});

app.get("/api/asset-packs/tabler", (request, response) => {
  const page = Math.max(1, Math.min(100_000, Number(request.query.page) || 1));
  const pageSize = Math.max(1, Math.min(36, Number(request.query.pageSize) || 24));
  const query = typeof request.query.q === "string" ? request.query.q.trim().slice(0, 120) : "";
  const category = typeof request.query.category === "string" ? request.query.category.slice(0, 80) : "";
  response.json(searchTablerIcons(db, query, category, page, pageSize));
});

app.get("/api/asset-packs/tabler/icons/:iconId.svg", (request, response) => {
  try {
    const svg = sanitizedTablerSvg(String(request.params.iconId));
    response.type("image/svg+xml").set("X-Content-Type-Options", "nosniff").set("Cache-Control", "public, max-age=86400, immutable").send(svg);
  } catch { apiError(response, 404, "Ikon Tabler tidak tersedia."); }
});

app.get("/api/openverse/images", async (request, response) => {
  const query = typeof request.query.q === "string" ? request.query.q.trim().slice(0, 200) : "";
  const license = typeof request.query.license === "string" ? request.query.license.slice(0, 80) : openverseLicenseIds.join(",");
  const page = Math.max(1, Math.min(10_000, Number(request.query.page) || 1));
  const pageSize = Math.max(1, Math.min(24, Number(request.query.pageSize) || 18));
  try { response.json(await searchOpenverse(query, license, page, pageSize)); }
  catch (error) { apiError(response, 502, error instanceof Error ? error.message : "Openverse search gagal.", { code: "openverse-search-failed" }); }
});

app.get("/api/openverse/thumbnail", async (request, response) => {
  const url = typeof request.query.url === "string" ? request.query.url.slice(0, 2000) : "";
  try {
    const thumbnail = await fetchOpenverseThumbnail(url);
    response.type(thumbnail.mimeType).set("X-Content-Type-Options", "nosniff").set("Cache-Control", "public, max-age=3600")
      .set("Content-Security-Policy", "default-src 'none'; sandbox").send(thumbnail.buffer);
  } catch (error) { apiError(response, 502, error instanceof Error ? error.message : "Thumbnail Openverse gagal dimuat.", { code: "openverse-thumbnail-failed" }); }
});

app.get("/api/projects/:id/visual-assets/credits.csv", (request, response) => {
  const project = getProject(String(request.params.id));
  if (!project) return apiError(response, 404, "Project tidak ditemukan.");
  const referenced = new Set(project.visualStoryboard.scenes.flatMap((scene: VisualStoryboard["scenes"][number]) => compositionForVisualScene(project.visualStoryboard, scene).layers.flatMap((layer) => layer.nodes.flatMap((node) => node.type === "group" ? node.children : [node])).flatMap((node) => node.type === "image" && node.asset.startsWith("upload-") ? [node.asset] : [])));
  const rows = (project.visualAssets as VisualAsset[]).filter((asset) => referenced.has(asset.id)).map((asset) => [asset.name, asset.creator ?? "", asset.attribution ?? "", asset.license, asset.licenseUrl ?? "", asset.sourceUrl ?? "", asset.provider ?? ""]);
  const csv = [ ["Asset", "Creator", "Attribution", "License", "License URL", "Source URL", "Provider"], ...rows ]
    .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  response.type("text/csv").set("Content-Disposition", "attachment; filename=visual-asset-credits.csv").send(`\ufeff${csv}`);
});

app.get("/api/ai-image/providers", async (_request, response) => {
  response.json(await aiImageProviderCatalog());
});

app.post("/api/projects/:id/scenes/:sceneId/ai-image/generate", async (request, response) => {
  const projectId = String(request.params.id);
  const row = projectRow(projectId);
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  if (activeRenderJob || activeJobCreation || activeProjectTasks.has(projectId)) return apiError(response, 409, "AI Image tidak dapat berjalan saat render atau perubahan project lain berlangsung.", { code: "project-busy" });
  if (activeAiImageGeneration) return apiError(response, 409, "Satu AI Image generation sedang berlangsung.", { code: "generation-in-progress" });
  const config = huggingFaceImageConfiguration();
  if (!config.configured) return apiError(response, 503, "AI Image provider belum dikonfigurasi dan diizinkan operator.", { code: "ai-image-not-configured" });
  if (aiImageRuntime.status === "Rate Limited" && aiImageRuntime.retryAt && Date.parse(aiImageRuntime.retryAt) > Date.now()) {
    return apiError(response, 429, aiImageRuntime.message ?? "Hugging Face rate limited.", { code: "ai-image-rate-limited", retryAt: aiImageRuntime.retryAt });
  }
  if (aiImageRuntime.status === "Quota Exhausted") return apiError(response, 402, aiImageRuntime.message ?? "Hugging Face quota exhausted.", { code: "ai-image-quota-exhausted" });
  const input = z.object({
    provider: z.literal("huggingface-inference"),
    model: z.string().trim().min(3).max(120),
    prompt: z.string().trim().min(20).max(12000),
    resolution: z.enum(HF_IMAGE_RESOLUTIONS),
    confirmed: z.literal(true),
    costAcknowledged: z.literal(true),
  }).strict().safeParse(request.body);
  if (!input.success) return apiError(response, 400, "AI Image request tidak valid atau konfirmasi biaya tidak ada.", { code: "invalid-ai-image-request", issues: input.error.issues });
  const project = projectFromRow(row);
  const scene = project.visualStoryboard.scenes.find((item) => item.sceneId === String(request.params.sceneId));
  if (!scene) return apiError(response, 404, "Scene Visual Storyboard tidak ditemukan.");
  activeAiImageGeneration = true;
  aiImageRuntime = { status: "Generating", message: "Satu gambar sedang dibuat.", retryAt: null };
  activeProjectTasks.add(projectId);
  try {
    const availableModels = await availableHfImageModels(true);
    const model = availableModels.find((item) => item.id === input.data.model);
    if (!model) {
      const message = "Model tidak terdaftar live pada hf-inference; pilih model yang tersedia lalu coba lagi.";
      aiImageRuntime = { status: "Failed", message, retryAt: null };
      return apiError(response, 409, message, { code: "ai-image-model-unavailable" });
    }
    const provider = new HuggingFaceInferenceImageProvider(config.token);
    const generated = await provider.generate({
      model: model.id, prompt: input.data.prompt, resolution: input.data.resolution,
      userConfirmed: input.data.confirmed, costAcknowledged: input.data.costAcknowledged,
    });
    const processed = await validateAndOptimizeRasterImage(Buffer.from(generated.bytes), generated.mimeType);
    const now = new Date().toISOString();
    const sha256 = createHash("sha256").update(processed.buffer).digest("hex");
    const file = `${sha256}.${processed.image.extension}`;
    const repositoryLicense = model.license ? `Model repository license tag: ${model.license}; generated-output license is not confirmed.` : "Generated-output license was not provided; review provider and model terms.";
    const asset = visualAssetSchema.parse({
      id: `upload-${file}`, name: `AI Image · ${scene.headline}`.slice(0, 120), visualCategory: "user-illustration", assetType: "illustration",
      semanticTags: scene.objects.map((object) => object.label).slice(0, 20), supportedConcepts: [scene.visualSummary, scene.illustrationIntent].map((value) => value.slice(0, 80)).slice(0, 12),
      role: "AI-generated educational illustration; semantic fit and crop require human review.", format: processed.image.format,
      aspectRatio: processed.image.width / processed.image.height, source: "ai-generated",
      provider: "Hugging Face Inference Providers · hf-inference", prompt: input.data.prompt, model: model.id,
      license: repositoryLicense, licenseUrl: `https://huggingface.co/${model.id}`,
      usageMetadata: JSON.stringify({ providerResponseHeaders: generated.usageMetadata ?? {}, price: "not provided", remainingBalance: "not provided", generatedOutputLicense: "not provided" }).slice(0, 950),
      style: project.visualStoryboard.styleId, createdAt: now, sha256, bytes: processed.buffer.length,
      width: processed.image.width, height: processed.image.height, file,
    });
    const persisted = await persistVisualAsset(projectId, asset, processed.buffer);
    aiImageRuntime = { status: "Ready", message: null, retryAt: null };
    response.status(201).json({ ...persisted, optimized: processed.optimized, originalBytes: processed.originalBytes, status: "Ready" });
  } catch (error) {
    if (error instanceof HuggingFaceImageError) {
      const status = error.code === "ai-image-rate-limited" ? "Rate Limited" : error.code === "ai-image-quota-exhausted" ? "Quota Exhausted" : "Failed";
      const retryAt = status === "Rate Limited" ? new Date(Date.now() + (error.retryAfterMs ?? 60_000)).toISOString() : null;
      aiImageRuntime = { status, message: error.message, retryAt };
      const httpStatus = status === "Rate Limited" ? 429 : status === "Quota Exhausted" ? 402 : error.code === "ai-image-model-unavailable" ? 409 : 502;
      return apiError(response, httpStatus, error.message, { code: error.code, retryAt });
    }
    aiImageRuntime = { status: "Failed", message: error instanceof Error ? error.message : "AI Image gagal diproses.", retryAt: null };
    apiError(response, 502, aiImageRuntime.message ?? "AI Image gagal diproses.", { code: "ai-image-provider-failed" });
  } finally {
    activeAiImageGeneration = false;
    activeProjectTasks.delete(projectId);
  }
});

app.post("/api/projects/:id/visual-assets/:assetId/attach", async (request, response) => {
  const projectId = String(request.params.id);
  const assetId = String(request.params.assetId);
  const row = projectRow(projectId);
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  if (!/^upload-[a-f0-9]{64}\.(png|jpg|webp|svg)$/.test(assetId)) return apiError(response, 400, "ID aset library tidak valid.");
  if (activeRenderJob || activeJobCreation || activeProjectTasks.has(projectId)) return apiError(response, 409, "Aset tidak dapat diubah saat render atau snapshot berjalan.");
  const catalogAsset = db.prepare("SELECT metadata_json FROM visual_asset_catalog WHERE asset_id = ?").get(assetId) as { metadata_json: string } | undefined;
  let storedAsset: VisualAsset;
  try {
    if (catalogAsset) storedAsset = visualAssetSchema.parse(JSON.parse(catalogAsset.metadata_json));
    else {
      const asset = getVisualAssetLibrary().find((item) => item.id === assetId);
      if (!asset || asset.source === "built-in") return apiError(response, 404, "Aset tidak tersedia di library.");
      const { projectIds: _projectIds, previewUrl: _previewUrl, localAvailable: _localAvailable, referenceCount: _referenceCount, ...assetData } = asset;
      storedAsset = visualAssetSchema.parse(assetData);
    }
  } catch { return apiError(response, 404, "Metadata aset tidak valid."); }
  activeProjectTasks.add(projectId);
  try {
    const assetPath = path.resolve(visualAssetDir, storedAsset.file);
    if (path.dirname(assetPath) !== visualAssetDir || !existsSync(assetPath) || await sha256File(assetPath) !== storedAsset.sha256) {
      return apiError(response, 409, "File aset library hilang atau hash berubah.", { code: "visual-asset-integrity-failed" });
    }
    const currentRow = projectRow(projectId);
    if (!currentRow) return apiError(response, 404, "Project tidak ditemukan.");
    const project = projectFromRow(currentRow);
    if (!project.visualAssets.some((item) => item.id === storedAsset.id)) project.visualAssets.push(storedAsset);
    saveProject(projectId, project);
    upsertVisualAssetCatalog(db, storedAsset);
    invalidateBundleCache();
    response.json({ project: getProject(projectId), asset: storedAsset });
  } finally { activeProjectTasks.delete(projectId); }
});

app.post("/api/projects/:id/visual-assets", illustrationUploadMiddleware, async (request, response) => {
  const id = String(request.params.id);
  const row = projectRow(id);
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  if (!request.file) return apiError(response, 400, "File ilustrasi tidak ditemukan.", { code: "missing-illustration" });
  if (activeRenderJob || activeProjectTasks.has(id)) return apiError(response, 409, "Aset tidak dapat diubah saat render atau snapshot berjalan.");
  activeProjectTasks.add(id);
  let createdFile = false;
  let asset: VisualAsset | undefined;
  try {
    const processed = await prepareVisualAssetUpload(request.file, request.body ?? {});
    asset = processed.asset;
    createdFile = await writeVisualAssetFile(asset, processed.buffer);
    const current = projectFromRow(row);
    if (!current.visualAssets.some((item) => item.id === asset!.id)) current.visualAssets.push(asset);
    saveProject(id, current);
    upsertVisualAssetCatalog(db, asset);
    invalidateBundleCache();
    response.status(201).json({ project: getProject(id), asset, optimized: processed.optimized, originalBytes: processed.originalBytes });
  } catch (error) {
    if (createdFile && asset) {
      const referenced = (db.prepare("SELECT data_json FROM projects").all() as Array<{ data_json: string }>).some((item) => {
        try { return (JSON.parse(item.data_json) as StoredProject).visualAssets?.some((candidate) => candidate.id === asset!.id); } catch { return false; }
      });
      if (!referenced) await rm(path.join(visualAssetDir, asset.file), { force: true });
    }
    apiError(response, 400, error instanceof Error ? error.message : "Ilustrasi gagal divalidasi.", { code: "invalid-illustration" });
  } finally { activeProjectTasks.delete(id); }
});

app.post("/api/projects/:id/scenes/:sceneId/media", sceneMediaUploadMiddleware, async (request, response) => {
  const projectId = String(request.params.id);
  const sceneId = String(request.params.sceneId);
  const row = projectRow(projectId);
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  if (!projectFromRow(row).visualStoryboard.scenes.some((scene) => scene.sceneId === sceneId)) return apiError(response, 404, "Scene tidak ditemukan.");
  if (!request.file) return apiError(response, 400, "File MP4/GIF tidak ditemukan.", { code: "missing-scene-media" });
  if (activeRenderJob || activeJobCreation || activeProjectTasks.has(projectId)) return apiError(response, 409, "Project sedang dipersiapkan atau dirender.", { code: "project-busy" });
  activeProjectTasks.add(projectId);
  try {
    const processed = await validateAndNormalizeSceneMedia(request.file.buffer, request.file.mimetype, request.file.originalname);
    await writeSceneMediaFile(processed.media, processed.buffer, processed.poster);
    invalidateBundleCache();
    response.status(201).json({ media: processed.media });
  } catch (error) {
    apiError(response, 400, error instanceof Error ? error.message : "Klip tidak valid atau gagal dinormalisasi.", { code: "invalid-scene-media" });
  } finally { activeProjectTasks.delete(projectId); }
});

app.post("/api/projects/:id/visual-assets/batch", illustrationBatchUploadMiddleware, async (request, response) => {
  const id = String(request.params.id);
  const files = Array.isArray(request.files) ? request.files : [];
  if (!files.length) return apiError(response, 400, "File ilustrasi tidak ditemukan.", { code: "missing-illustration" });
  let metadata: Record<string, unknown>[];
  try {
    const payload = typeof request.body?.metadata === "string" ? JSON.parse(request.body.metadata) as unknown : null;
    if (!Array.isArray(payload) || payload.length !== files.length || payload.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
      return apiError(response, 400, "Metadata batch harus cocok dengan urutan dan jumlah file.", { code: "invalid-illustration-batch" });
    }
    metadata = payload as Record<string, unknown>[];
  } catch {
    return apiError(response, 400, "Metadata batch tidak valid.", { code: "invalid-illustration-batch" });
  }
  if (!projectRow(id)) return apiError(response, 404, "Project tidak ditemukan.");
  if (activeRenderJob || activeJobCreation || activeProjectTasks.has(id)) return apiError(response, 409, "Aset tidak dapat diubah saat render atau snapshot berjalan.");
  activeProjectTasks.add(id);
  try {
    const processed = await mapConcurrent(files, 3, async (file, index) => {
      try { return { index, fileName: file.originalname, upload: await prepareVisualAssetUpload(file, metadata[index]!) }; }
      catch (error) { return { index, fileName: file.originalname, error: error instanceof Error ? error.message : "Ilustrasi gagal divalidasi." }; }
    });
    const prepared: Array<{ index: number; fileName: string; upload: Awaited<ReturnType<typeof prepareVisualAssetUpload>>; createdFile: boolean }> = [];
    const results: Array<{ index: number; asset: VisualAsset; optimized: boolean; originalBytes: number }> = [];
    const failures: Array<{ index: number; fileName: string; message: string }> = [];
    for (const entry of processed) {
      if ("error" in entry) { failures.push({ index: entry.index, fileName: entry.fileName, message: entry.error ?? "Ilustrasi gagal divalidasi." }); continue; }
      try {
        const createdFile = await writeVisualAssetFile(entry.upload.asset, entry.upload.buffer);
        prepared.push({ ...entry, createdFile });
      } catch (error) {
        failures.push({ index: entry.index, fileName: entry.fileName, message: error instanceof Error ? error.message : "Ilustrasi gagal disimpan." });
      }
    }
    if (prepared.length) {
      try {
        const currentRow = projectRow(id);
        if (!currentRow) throw new Error("Project tidak ditemukan.");
        const current = projectFromRow(currentRow);
        for (const entry of prepared) {
          const assetIndex = current.visualAssets.findIndex((asset) => asset.id === entry.upload.asset.id);
          if (assetIndex < 0) current.visualAssets.push(entry.upload.asset);
          else current.visualAssets[assetIndex] = entry.upload.asset;
        }
        withTransaction(() => {
          saveProject(id, current);
          for (const entry of prepared) upsertVisualAssetCatalog(db, entry.upload.asset);
        });
        invalidateBundleCache();
        for (const entry of prepared) results.push({ index: entry.index, asset: entry.upload.asset, optimized: entry.upload.optimized, originalBytes: entry.upload.originalBytes });
      } catch (error) {
        for (const entry of prepared) failures.push({ index: entry.index, fileName: entry.fileName, message: error instanceof Error ? error.message : "Batch ilustrasi gagal disimpan." });
        for (const file of new Set(prepared.flatMap((entry) => entry.createdFile ? [entry.upload.asset.file] : []))) {
          const referenced = projectReferencesVisualAsset(file) || snapshotReferencesVisualAsset(file) || reusableSceneReferencesVisualAsset(file);
          if (!referenced) await rm(path.join(visualAssetDir, file), { force: true });
        }
      }
    }
    response.status(201).json({ project: getProject(id), results, failures });
  } finally { activeProjectTasks.delete(id); }
});

app.post("/api/projects/:id/asset-packs/tabler/:iconId/import", async (request, response) => {
  const projectId = String(request.params.id);
  const iconId = String(request.params.iconId);
  const row = projectRow(projectId);
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  if (activeRenderJob || activeJobCreation || activeProjectTasks.has(projectId)) return apiError(response, 409, "Aset tidak dapat diubah saat render atau snapshot berjalan.");
  const indexed = db.prepare("SELECT category, tags, package_version FROM asset_pack_icons WHERE pack = 'tabler-outline' AND icon_id = ?").get(iconId) as { category: string; tags: string; package_version: string } | undefined;
  if (!indexed) return apiError(response, 404, "Ikon Tabler tidak tersedia di pack lokal.");
  activeProjectTasks.add(projectId);
  try {
    const svg = Buffer.from(sanitizedTablerSvg(iconId), "utf8");
    const sha256 = createHash("sha256").update(svg).digest("hex");
    const file = `${sha256}.svg`;
    const tags = JSON.parse(indexed.tags) as string[];
    const asset = visualAssetSchema.parse({
      id: `upload-${file}`, name: iconId.replaceAll("-", " "), visualCategory: "tabler-icon", assetType: "icon-object",
      semanticTags: [...new Set([iconId.replaceAll("-", " "), ...tags])].slice(0, 20), supportedConcepts: tags.slice(0, 12),
      role: `Tabler outline icon · category ${indexed.category}; icon bukan ilustrasi scene lengkap.`, format: "svg", aspectRatio: 1,
      source: "tabler-pack", provider: `@tabler/icons ${indexed.package_version}`, license: "MIT License", licenseUrl: "https://github.com/tabler/tabler-icons/blob/main/LICENSE",
      attribution: `Tabler Icons, Copyright (c) 2020-2026 Paweł Kuna. MIT License. Package @tabler/icons ${indexed.package_version}; full notice: /licenses/TABLER-ICONS-MIT.txt`, sourceUrl: `https://tabler.io/icons/${iconId}`,
      style: "tabler-outline", sha256, bytes: svg.length, width: 24, height: 24, file,
    });
    response.status(201).json(await persistVisualAsset(projectId, asset, svg));
  } catch (error) { apiError(response, 400, error instanceof Error ? error.message : "Tabler icon gagal diimpor.", { code: "tabler-import-failed" }); }
  finally { activeProjectTasks.delete(projectId); }
});

app.post("/api/projects/:id/openverse/:imageId/import", async (request, response) => {
  const projectId = String(request.params.id);
  const imageId = String(request.params.imageId);
  const row = projectRow(projectId);
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  if (activeRenderJob || activeJobCreation || activeProjectTasks.has(projectId)) return apiError(response, 409, "Aset tidak dapat diubah saat render atau snapshot berjalan.");
  activeProjectTasks.add(projectId);
  try {
    const downloaded = await downloadOpenverseImage(imageId);
    const processed = await validateAndOptimizeRasterImage(downloaded.buffer, downloaded.mimeType);
    const sha256 = createHash("sha256").update(processed.buffer).digest("hex");
    const file = `${sha256}.${processed.image.extension}`;
    const list = (value: unknown, fallback: string[], maxItems: number, maxChars: number) => {
      const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : fallback;
      return [...new Set(items.map((item) => String(item).trim()).filter(Boolean).map((item) => item.slice(0, maxChars)))].slice(0, maxItems);
    };
    const image = downloaded.image;
    const licenseNames: Record<string, string> = { cc0: "CC0", pdm: "Public Domain Mark", by: "CC BY", "by-sa": "CC BY-SA" };
    const licenseLabel = `${licenseNames[image.license] ?? image.license.toUpperCase()} ${image.licenseVersion}`.trim();
    const asset = visualAssetSchema.parse({
      id: `upload-${file}`, name: typeof request.body?.name === "string" ? request.body.name.trim().slice(0, 120) : image.title.slice(0, 120),
      visualCategory: "openverse-illustration", assetType: "illustration",
      semanticTags: list(request.body?.semanticTags, [image.title], 20, 60), supportedConcepts: list(request.body?.supportedConcepts, [image.title], 12, 80),
      role: "Openverse illustration; local copy, licensed metadata retained, semantic fit requires human review.",
      format: processed.image.format, aspectRatio: processed.image.width / processed.image.height, source: "openverse",
      provider: `Openverse · ${image.provider || image.source}`, creator: image.creator,
      attribution: image.attribution || `${image.title} by ${image.creator} (${licenseLabel}); ${image.landingUrl}`,
      sourceUrl: image.landingUrl, licenseUrl: image.licenseUrl, license: licenseLabel,
      style: typeof request.body?.style === "string" ? request.body.style.trim().slice(0, 120) || "openverse-illustration" : "openverse-illustration",
      sha256, bytes: processed.buffer.length, width: processed.image.width, height: processed.image.height, file,
    });
    response.status(201).json({ ...(await persistVisualAsset(projectId, asset, processed.buffer)), optimized: processed.optimized, originalBytes: processed.originalBytes, externalImage: image });
  } catch (error) { apiError(response, 502, error instanceof Error ? error.message : "Openverse asset import gagal.", { code: "openverse-import-failed" }); }
  finally { activeProjectTasks.delete(projectId); }
});

app.delete("/api/projects/:id/visual-assets/:assetId", async (request, response) => {
  const id = String(request.params.id);
  const assetId = String(request.params.assetId);
  const row = projectRow(id);
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  if (activeRenderJob || activeJobCreation || activeProjectTasks.has(id)) return apiError(response, 409, "Aset tidak dapat dilepas saat render atau snapshot berjalan.");
  const project = projectFromRow(row);
  const asset = project.visualAssets.find((item) => item.id === assetId);
  if (!asset) return apiError(response, 404, "Aset tidak ditemukan di project.");
  if (visualAssetReferencedByStoryboard(project.visualStoryboard, asset.id)) return apiError(response, 409, "Aset masih digunakan scene atau Style Lock. Lepas referensi sebelum menghapus aset.", { code: "visual-asset-in-use" });
  if (snapshotReferencesVisualAsset(asset.file)) return apiError(response, 409, "Aset masih dirujuk snapshot render; hapus project/snapshot terkait sebelum melepas aset.", { code: "visual-asset-snapshot-in-use" });
  project.visualAssets = project.visualAssets.filter((item) => item.id !== assetId);
  try {
    withTransaction(() => {
      saveProject(id, project);
      if (!projectReferencesVisualAsset(asset.file, id)) queueFileCleanup("visual-assets", path.join(visualAssetDir, asset.file));
    });
    invalidateBundleCache();
    const cleanupPending = await tryProcessFileCleanupQueue();
    response.json({ project: getProject(id), cleanupPending });
  } catch {
    apiError(response, 500, "Aset tidak dapat dilepas dengan aman.");
  }
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
    if (project.visualStoryboardError) {
      await removeOrQueueCleanup("audio", request.file.path);
      return apiError(response, 409, project.visualStoryboardError, { code: "invalid-visual-storyboard" });
    }
    const previousUpload = project.audio?.source === "upload" ? path.resolve(root, "public", project.audio.file) : null;
    const previousResearch = project.researchPackage;
    const nextResearch = estimateSceneTimings(previousResearch, durationSec);
    project.visualStoryboard = retimeVisualStoryboard(project.visualStoryboard, previousResearch, nextResearch);
    project.researchPackage = nextResearch;
    project.audio = {
      file: `audio/${request.file.filename}`,
      name: request.file.originalname.slice(0, 200),
      durationSec,
      bytes: request.file.size,
      sha256,
      source: "upload",
      timingMode: "estimated",
    };
    project.narrationMode = "audio";
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
  project.narrationMode = "unset";
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
  const sceneMediaFiles = new Set(project.visualStoryboard.scenes.flatMap((scene) => scene.sceneMedia ? [scene.sceneMedia.file, scene.sceneMedia.posterFile] : []));
  const uploadPath = project.audio?.source === "upload" ? path.resolve(root, "public", project.audio.file) : null;
  const safeUploadPath = uploadPath && path.dirname(uploadPath) === audioDir ? uploadPath : null;
  withTransaction(() => {
    if (safeUploadPath) queueFileCleanup("audio", safeUploadPath);
    for (const asset of project.visualAssets) if (!projectReferencesVisualAsset(asset.file, id)) queueFileCleanup("visual-assets", path.join(visualAssetDir, asset.file));
    for (const file of sceneMediaFiles) queueFileCleanup("scene-media", path.join(sceneMediaDir, file));
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

async function attachTtsAudio(projectId: string, asset: TtsAssetRow, scriptSha256: string, timingDecision: "retime" | "keep-timeline") {
  const row = projectRow(projectId);
  if (!row) throw new SpeechProviderError("Project tidak ditemukan.", "project-not-found", 404);
  const project = projectFromRow(row);
  if (project.visualStoryboardError) throw new SpeechProviderError(project.visualStoryboardError, "invalid-visual-storyboard", 409);
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
  if (timingDecision === "retime") {
    const previousResearch = project.researchPackage;
    const nextResearch = estimateSceneTimings(previousResearch, asset.duration_sec, asset.words_per_minute, asset.speaking_rate);
    project.visualStoryboard = retimeVisualStoryboard(project.visualStoryboard, previousResearch, nextResearch);
    project.researchPackage = nextResearch;
  }
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
  project.narrationMode = "audio";
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
  if (invalidStoryboardResponse(response, project)) return;
  if (!project.pendingTts) return apiError(response, 409, "Belum ada pratinjau narasi untuk digunakan.", { code: "no-pending-tts" });
  const asset = db.prepare("SELECT * FROM tts_assets WHERE cache_key = ?").get(project.pendingTts.cacheKey) as TtsAssetRow | undefined;
  if (!asset) return apiError(response, 410, "Audio preview tidak ditemukan. Buat pratinjau baru.", { code: "audio-not-found" });
  const currentDurationSec = project.audio?.durationSec ?? project.researchPackage.targetDurationSec;
  const durationChanged = Math.abs(currentDurationSec - asset.duration_sec) >= 0.01;
  const parsedDecision = z.enum(["retime", "keep-timeline"]).optional().safeParse(request.body?.timingDecision);
  if (!parsedDecision.success) return apiError(response, 400, "Pilihan timing narasi tidak valid.", { code: "invalid-tts-timing-decision" });
  if (durationChanged && !parsedDecision.data) return apiError(response, 409, "Pilih cara menangani perubahan durasi sebelum menyetujui audio.", {
    code: "tts-duration-decision-required", previousDurationSec: currentDurationSec, nextDurationSec: asset.duration_sec,
  });
  activeProjectTasks.add(id);
  try {
    response.json(await attachTtsAudio(row.id, asset, project.pendingTts.scriptSha256, parsedDecision.data ?? "retime"));
  } catch (error) { sendTtsError(response, error); }
  finally { activeProjectTasks.delete(id); }
});

app.post("/api/projects/:id/generate", async (request, response) => {
  const projectId = String(request.params.id);
  const row = projectRow(projectId);
  if (!row) return apiError(response, 404, "Project tidak ditemukan.");
  if (activeProjectTasks.has(projectId)) return apiError(response, 409, "Project sedang memproses audio atau snapshot.");
  const project = projectFromRow(row);
  const visualGate = visualStoryboardQualityGate(project.researchPackage, project.visualStoryboard, project.visualAssets);
  if (!visualGate.ready || project.visualStoryboard.scenes.some((scene) => !scene.approved)) {
    return apiError(response, 409, "Visual Storyboard perlu lolos review dan approval sebelum motion/render.", {
      code: "visual-storyboard-not-approved", issues: visualGate.issues,
      unapprovedScenes: project.visualStoryboard.scenes.filter((scene) => !scene.approved).map((scene) => scene.sceneNumber),
    });
  }
  if (project.audio?.source === "tts" && project.audio.tts?.scriptSha256 !== createHash("sha256").update(narrationScript(project.researchPackage)).digest("hex")) {
    return apiError(response, 409, "Naskah berubah setelah AI Voice dibuat. Generate ulang audio atau pilih upload manual.", { code: "tts-audio-stale" });
  }
  const snapshot = snapshotForProject(project);
  for (const asset of snapshot.visualAssets ?? []) {
    const assetPath = path.resolve(visualAssetDir, asset.file);
    if (path.dirname(assetPath) !== visualAssetDir || !existsSync(assetPath) || await sha256File(assetPath) !== asset.sha256) {
      return apiError(response, 409, `Aset visual ${asset.name} hilang atau hash berubah; pilih ulang/unggah lagi sebelum membuat snapshot.`, { code: "visual-asset-integrity-failed", assetId: asset.id });
    }
  }
  for (const media of snapshot.sceneMedia ?? []) {
    const error = await sceneMediaIntegrityError(media);
    if (error) return apiError(response, 409, error, { code: "scene-media-integrity-failed" });
  }
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

  if (readAiGenerationMode(db) === "production") {
    const recent = db.prepare("SELECT created_at FROM video_job_requests WHERE created_at > ? ORDER BY created_at ASC")
      .all(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) as Array<{ created_at: string }>;
    const allowance = canStartNewJob(recent.map((item) => item.created_at), Date.now(), dailyLimit);
    if (!allowance.allowed) return apiError(response, 429, "Batas job video baru untuk 24 jam tercapai.", { nextAllowedAt: allowance.nextAllowedAt });
  }
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
app.use("/visual-assets", express.static(visualAssetDir, { immutable: true, maxAge: "1y" }));
app.use("/scene-media", express.static(sceneMediaDir, { immutable: true, maxAge: "1y" }));

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
app.listen(port, host, () => {
  console.log(`AI Facts Studio API: http://${host}:${port}`);
  void (async () => {
    const rows = db.prepare("SELECT data_json FROM visual_preparation_jobs WHERE status = 'running' ORDER BY created_at").all() as Array<{ data_json: string }>;
    for (const row of rows) {
      try {
        const job = JSON.parse(row.data_json) as VisualPreparationJob;
        for (const scene of job.scenes) if (scene.status === "preparing") scene.status = "pending";
        job.currentSceneId = null;
        job.status = "running";
        writeVisualPreparationJob(job);
        await runVisualPreparation(job);
      } catch (error) { console.error("Visual preparation recovery failed:", error instanceof Error ? error.message : "unknown error"); }
    }
    const motionRows = db.prepare("SELECT data_json FROM motion_preparation_jobs WHERE status = 'running' ORDER BY created_at").all() as Array<{ data_json: string }>;
    for (const row of motionRows) {
      try {
        const job = JSON.parse(row.data_json) as MotionPreparationJob;
        for (const scene of job.scenes) if (scene.status === "preparing") scene.status = "pending";
        job.currentSceneId = null;
        job.status = "running";
        writeMotionPreparationJob(job);
        await runMotionPreparation(job);
      } catch (error) { console.error("Motion preparation recovery failed:", error instanceof Error ? error.message : "unknown error"); }
    }
  })();
});
