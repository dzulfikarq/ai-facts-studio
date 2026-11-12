import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseResearchPackage } from "../domain/research";
import { buildVisualStoryboard, legacyMotionApprovalFingerprint, retimeVisualStoryboard, visualApprovalFingerprint, visualStoryboardSchema, type VisualStoryboard, type VisualStoryboardScene } from "../domain/visual-storyboard";
import { aiGenerationSchema } from "./ai-generation/provider";
import { visualAssetSchema, type VisualAsset } from "../domain/visual-assets";
import { outroSelectionSchema } from "../domain/outro";
import type { ManualProjectBrief } from "../domain/manual-project";

export type ProjectCreationMode = "manual" | "ai-generated" | "imported" | "sample" | "legacy";

export const dataDir = path.resolve(process.env.DATA_DIR ?? "data");
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, "ai-facts-studio.sqlite"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS project_create_requests (
    request_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    research_sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    source_sha256 TEXT NOT NULL,
    snapshot_path TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    error TEXT,
    progress INTEGER NOT NULL DEFAULT 0,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    output_path TEXT,
    manifest_json TEXT,
    renderer_version INTEGER NOT NULL DEFAULT 1,
    UNIQUE(project_id, source_sha256)
  );
  CREATE INDEX IF NOT EXISTS jobs_created_at_idx ON jobs(created_at);
  CREATE TABLE IF NOT EXISTS outro_assets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    file TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    poster_file TEXT NOT NULL,
    poster_sha256 TEXT NOT NULL,
    poster_bytes INTEGER NOT NULL,
    duration_sec REAL NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    video_codec TEXT NOT NULL,
    audio_codec TEXT,
    frame_rate REAL NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS outro_assets_single_default_idx ON outro_assets(is_default) WHERE is_default = 1 AND archived = 0;
  CREATE INDEX IF NOT EXISTS outro_assets_created_idx ON outro_assets(archived, created_at DESC);
  CREATE TABLE IF NOT EXISTS visual_asset_catalog (
    asset_id TEXT PRIMARY KEY,
    metadata_json TEXT NOT NULL,
    asset_type TEXT NOT NULL,
    category TEXT NOT NULL,
    source TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT '',
    style TEXT NOT NULL,
    format TEXT NOT NULL,
    license TEXT NOT NULL,
    available_local INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS visual_asset_catalog_filters_idx ON visual_asset_catalog(category, asset_type, style, provider, license, created_at);
  CREATE VIRTUAL TABLE IF NOT EXISTS visual_asset_catalog_fts USING fts5(asset_id UNINDEXED, name, tags, concepts, creator, tokenize='unicode61 remove_diacritics 2');
  CREATE TABLE IF NOT EXISTS asset_pack_icons (
    pack TEXT NOT NULL,
    icon_id TEXT NOT NULL,
    category TEXT NOT NULL,
    tags TEXT NOT NULL,
    package_version TEXT NOT NULL,
    PRIMARY KEY(pack, icon_id)
  );
  CREATE INDEX IF NOT EXISTS asset_pack_icons_category_idx ON asset_pack_icons(pack, category, icon_id);
  CREATE VIRTUAL TABLE IF NOT EXISTS asset_pack_icons_fts USING fts5(icon_id UNINDEXED, category, tags, tokenize='unicode61 remove_diacritics 2');
  CREATE TABLE IF NOT EXISTS reusable_scene_compositions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    style_id TEXT NOT NULL,
    layout TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    concepts_json TEXT NOT NULL,
    composition_json TEXT NOT NULL,
    data_json TEXT NOT NULL,
    thumbnail_data_url TEXT NOT NULL,
    version INTEGER NOT NULL,
    usage_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS reusable_scene_filters_idx ON reusable_scene_compositions(style_id, layout, updated_at);
  CREATE VIRTUAL TABLE IF NOT EXISTS reusable_scene_compositions_fts USING fts5(id UNINDEXED, name, tags, concepts, tokenize='unicode61 remove_diacritics 2');
  CREATE TABLE IF NOT EXISTS visual_preparation_jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    request_sha256 TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, request_id)
  );
  CREATE INDEX IF NOT EXISTS visual_preparation_jobs_project_idx ON visual_preparation_jobs(project_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS motion_preparation_jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    request_sha256 TEXT NOT NULL,
    status TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, request_id)
  );
  CREATE INDEX IF NOT EXISTS motion_preparation_jobs_project_idx ON motion_preparation_jobs(project_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS render_attempts (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id),
    attempt INTEGER NOT NULL,
    state TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    finished_at TEXT,
    error TEXT,
    manifest_json TEXT
  );
  CREATE TABLE IF NOT EXISTS tts_assets (
    cache_key TEXT PRIMARY KEY,
    script_sha256 TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT 'legacy',
    locale TEXT NOT NULL,
    voice_id TEXT NOT NULL,
    voice_name TEXT NOT NULL,
    gender TEXT NOT NULL,
    voice_availability TEXT NOT NULL DEFAULT 'api',
    speaking_rate REAL NOT NULL,
    style TEXT NOT NULL DEFAULT 'neutral',
    file TEXT NOT NULL,
    duration_sec REAL NOT NULL,
    bytes INTEGER NOT NULL,
    audio_sha256 TEXT NOT NULL,
    words_per_minute INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tts_attempts (
    id TEXT PRIMARY KEY,
    cache_key TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    state TEXT NOT NULL,
    error_code TEXT
  );
  CREATE INDEX IF NOT EXISTS tts_attempts_recent_idx ON tts_attempts(cache_key, requested_at);
  CREATE TABLE IF NOT EXISTS video_job_requests (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS video_job_requests_created_at_idx ON video_job_requests(created_at);
  CREATE TABLE IF NOT EXISTS file_cleanup_queue (
    root TEXT NOT NULL CHECK (root IN ('audio', 'jobs', 'renders', 'visual-assets', 'scene-media', 'outros')),
    relative_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    PRIMARY KEY (root, relative_path)
  );
`);

const cleanupTable = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'file_cleanup_queue'").get() as { sql?: string } | undefined;
if (cleanupTable?.sql && (!cleanupTable.sql.includes("'visual-assets'") || !cleanupTable.sql.includes("'scene-media'") || !cleanupTable.sql.includes("'outros'"))) {
  db.exec(`
    BEGIN IMMEDIATE;
    ALTER TABLE file_cleanup_queue RENAME TO file_cleanup_queue_legacy;
    CREATE TABLE file_cleanup_queue (
      root TEXT NOT NULL CHECK (root IN ('audio', 'jobs', 'renders', 'visual-assets', 'scene-media', 'outros')),
      relative_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      PRIMARY KEY (root, relative_path)
    );
    INSERT INTO file_cleanup_queue SELECT * FROM file_cleanup_queue_legacy;
    DROP TABLE file_cleanup_queue_legacy;
    COMMIT;
  `);
}

db.exec("INSERT OR IGNORE INTO video_job_requests (id, created_at) SELECT id, created_at FROM jobs");
db.exec(aiGenerationSchema);

const visualCatalogColumns = db.prepare("PRAGMA table_info(visual_asset_catalog)").all() as Array<{ name: string }>;
if (!visualCatalogColumns.some((column) => column.name === "available_local")) db.exec("ALTER TABLE visual_asset_catalog ADD COLUMN available_local INTEGER NOT NULL DEFAULT 1");

const aiGenerationColumns = db.prepare("PRAGMA table_info(ai_generation_attempts)").all() as Array<{ name: string }>;
if (!aiGenerationColumns.some((column) => column.name === "input_tokens")) db.exec("ALTER TABLE ai_generation_attempts ADD COLUMN input_tokens INTEGER");
if (!aiGenerationColumns.some((column) => column.name === "output_tokens")) db.exec("ALTER TABLE ai_generation_attempts ADD COLUMN output_tokens INTEGER");
if (!aiGenerationColumns.some((column) => column.name === "total_tokens")) db.exec("ALTER TABLE ai_generation_attempts ADD COLUMN total_tokens INTEGER");
db.exec("CREATE INDEX IF NOT EXISTS ai_generation_attempts_provider_model_requested_idx ON ai_generation_attempts(provider, model, requested_at)");

const jobColumns = db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
if (!jobColumns.some((column) => column.name === "renderer_version")) db.exec("ALTER TABLE jobs ADD COLUMN renderer_version INTEGER NOT NULL DEFAULT 1");

const preparationColumns = db.prepare("PRAGMA table_info(visual_preparation_jobs)").all() as Array<{ name: string }>;
if (!preparationColumns.some((column) => column.name === "request_sha256")) db.exec("ALTER TABLE visual_preparation_jobs ADD COLUMN request_sha256 TEXT NOT NULL DEFAULT ''");

const ttsColumns = db.prepare("PRAGMA table_info(tts_assets)").all() as Array<{ name: string }>;
if (!ttsColumns.some((column) => column.name === "model")) db.exec("ALTER TABLE tts_assets ADD COLUMN model TEXT NOT NULL DEFAULT 'legacy'");
if (!ttsColumns.some((column) => column.name === "style")) db.exec("ALTER TABLE tts_assets ADD COLUMN style TEXT NOT NULL DEFAULT 'neutral'");
if (!ttsColumns.some((column) => column.name === "voice_availability")) db.exec("ALTER TABLE tts_assets ADD COLUMN voice_availability TEXT NOT NULL DEFAULT 'api'");

export type TtsAudioMetadata = {
  provider: string;
  model: string;
  cacheKey: string;
  scriptSha256: string;
  locale: string;
  voiceId: string;
  voiceName: string;
  gender: string;
  voiceAvailability: "api" | "fallback";
  speakingRate: number;
  style: string;
  generatedAt: string;
  approvedAt?: string;
  alignment: "estimated";
};

export type StoredAudio = {
  file: string;
  name: string;
  durationSec: number;
  bytes: number;
  sha256: string;
  source: "upload" | "tts";
  timingMode: "scaled" | "estimated";
  tts?: TtsAudioMetadata;
};

export type StoredProject = {
  creationMode?: ProjectCreationMode;
  creationBrief?: ManualProjectBrief;
  researchPackage: import("../domain/research").ResearchPackage;
  visualStoryboard: VisualStoryboard;
  visualAssets: VisualAsset[];
  audio: StoredAudio | null;
  pendingTts: { cacheKey: string; scriptSha256: string } | null;
  researchReviewStatus: "needs-review" | "verified-by-author";
  narrationMode?: "unset" | "audio" | "manual";
  outro?: import("../domain/outro").OutroSelection | null;
  outroError?: string;
  visualStoryboardError?: string;
};

export type JobRow = {
  id: string;
  project_id: string;
  source_sha256: string;
  snapshot_path: string;
  state: string;
  created_at: string;
  updated_at: string;
  error: string | null;
  progress: number;
  attempt_count: number;
  output_path: string | null;
  manifest_json: string | null;
  renderer_version: number;
};

export function projectFromRow(row: { id: string; data_json: string; created_at: string; updated_at: string }) {
  const project = JSON.parse(row.data_json) as StoredProject;
  if (!project.creationMode || !["manual", "ai-generated", "imported", "sample", "legacy"].includes(project.creationMode)) project.creationMode = "legacy";
  const normalizedResearch = parseResearchPackage(project.researchPackage);
  if (normalizedResearch.success) project.researchPackage = normalizedResearch.data;
  const originalStoryboard = project.visualStoryboard === undefined ? undefined : structuredClone(project.visualStoryboard);
  const rawStoryboard = project.visualStoryboard as unknown as { scenes?: Array<Record<string, unknown>> };
  if (Array.isArray(rawStoryboard?.scenes)) project.visualStoryboard = {
    ...(project.visualStoryboard as unknown as Record<string, unknown>),
    scenes: rawStoryboard.scenes.map((scene) => {
      if (scene.authoringStatus !== "ready") return scene;
      const migrated = { ...scene, authoringStatus: "ready_for_review", motionIntensity: scene.motionIntensity ?? "balanced", motionTiming: scene.motionTiming ?? "approximate", motionStatus: scene.motionStatus ?? "not_prepared", motionActions: scene.motionActions ?? [] };
      if (scene.approved === true && typeof scene.approvedFingerprint === "string") {
        const old = { ...migrated, authoringStatus: "ready" } as unknown as VisualStoryboardScene;
        if (legacyMotionApprovalFingerprint(old) === scene.approvedFingerprint) {
          (migrated as Record<string, unknown>).approvedFingerprint = visualApprovalFingerprint(migrated as unknown as VisualStoryboardScene);
        }
      }
      return migrated;
    }),
  } as unknown as VisualStoryboard;
  const savedStoryboard = visualStoryboardSchema.safeParse(project.visualStoryboard);
  delete project.visualStoryboardError;
  if (project.visualStoryboard === undefined && normalizedResearch.success) {
    project.visualStoryboard = buildVisualStoryboard(normalizedResearch.data);
  } else if (!normalizedResearch.success) {
    project.visualStoryboardError = "Research Package tidak valid; Visual Storyboard asli dipertahankan dan tidak dapat disinkronkan.";
    project.visualStoryboard = originalStoryboard as VisualStoryboard;
  } else {
    const matchesSceneIds = (scenes: readonly { sceneId: string }[]) => scenes.length === normalizedResearch.data.scenes.length
      && scenes.every((scene, index) => scene.sceneId === normalizedResearch.data.scenes[index]?.id);
    if (savedStoryboard.success && matchesSceneIds(savedStoryboard.data.scenes)) {
      const normalizedBoard = {
        ...savedStoryboard.data,
        scenes: savedStoryboard.data.scenes.map((scene) => scene.approved && scene.approvedFingerprint === legacyMotionApprovalFingerprint(scene)
          ? { ...scene, approvedFingerprint: visualApprovalFingerprint(scene) } : scene),
      };
      try {
        project.visualStoryboard = normalizedBoard.scenes.every((scene, index) => scene.durationSec === Math.round(((normalizedResearch.data.scenes[index]?.endSec ?? 0) - (normalizedResearch.data.scenes[index]?.startSec ?? 0)) * 1000) / 1000)
          ? normalizedBoard
          : retimeVisualStoryboard(normalizedBoard, {
            ...normalizedResearch.data,
            scenes: normalizedBoard.scenes.map((visual, index) => {
              const source = normalizedResearch.data.scenes[index]!;
              const duration = Number(visual.durationSec);
              return { ...source, startSec: 0, endSec: Number.isFinite(duration) && duration > 0 ? duration : source.endSec };
            }),
          } as typeof normalizedResearch.data, normalizedResearch.data);
      } catch (error) {
        project.visualStoryboard = originalStoryboard as VisualStoryboard;
        project.visualStoryboardError = `Visual Storyboard tidak dapat disinkronkan dengan aman (${error instanceof Error ? error.message : "data tidak valid"}). Data asli dipertahankan; unduh backup sebelum perbaikan.`;
      }
    } else {
      project.visualStoryboard = originalStoryboard as VisualStoryboard;
      const detail = savedStoryboard.success ? "Scene ID atau urutan tidak cocok dengan Research Package." : savedStoryboard.error.issues[0]?.message ?? "skema tidak valid.";
      project.visualStoryboardError = `Visual Storyboard tidak valid (${detail}). Data asli dipertahankan; unduh backup sebelum perbaikan.`;
    }
  }
  project.pendingTts ??= null;
  if (project.outro === undefined || project.outro === null) project.outro = null;
  else {
    const savedOutro = outroSelectionSchema.safeParse(project.outro);
    if (savedOutro.success) project.outro = savedOutro.data;
    else {
      project.outroError = "Konfigurasi outro project tidak valid; tidak ada outro pengganti yang dipilih.";
      project.outro = null;
    }
  }
  project.narrationMode ??= project.audio ? "audio" : "unset";
  project.visualAssets = Array.isArray(project.visualAssets) ? project.visualAssets.flatMap((asset) => {
    const parsed = visualAssetSchema.safeParse(asset);
    return parsed.success ? [parsed.data] : [];
  }) : [];
  if (project.audio) {
    project.audio.source ??= "upload";
    project.audio.timingMode ??= "scaled";
    if (project.audio.tts) {
      project.audio.tts.model ??= "legacy";
      project.audio.tts.style ??= "neutral";
      project.audio.tts.voiceAvailability ??= "api";
    }
  }
  return { id: row.id, ...project, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function jobForClient(row: JobRow | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    error: row.error,
    progress: row.progress,
    attemptCount: row.attempt_count,
    manifest: row.manifest_json ? JSON.parse(row.manifest_json) : null,
    rendererVersion: row.renderer_version,
    downloadUrl: row.output_path ? `/api/jobs/${row.id}/download` : null,
  };
}
