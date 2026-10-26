import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseResearchPackage } from "../domain/research";
import { buildVisualStoryboard, visualApprovalFingerprint, visualStoryboardSchema, type VisualStoryboard, type VisualStoryboardScene } from "../domain/visual-storyboard";
import { aiGenerationSchema } from "./ai-generation/provider";
import { visualAssetSchema, type VisualAsset } from "../domain/visual-assets";

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
    root TEXT NOT NULL CHECK (root IN ('audio', 'jobs', 'renders', 'visual-assets')),
    relative_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    PRIMARY KEY (root, relative_path)
  );
`);

const cleanupTable = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'file_cleanup_queue'").get() as { sql?: string } | undefined;
if (cleanupTable?.sql && !cleanupTable.sql.includes("'visual-assets'")) {
  db.exec(`
    BEGIN IMMEDIATE;
    ALTER TABLE file_cleanup_queue RENAME TO file_cleanup_queue_legacy;
    CREATE TABLE file_cleanup_queue (
      root TEXT NOT NULL CHECK (root IN ('audio', 'jobs', 'renders', 'visual-assets')),
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

const aiGenerationColumns = db.prepare("PRAGMA table_info(ai_generation_attempts)").all() as Array<{ name: string }>;
if (!aiGenerationColumns.some((column) => column.name === "input_tokens")) db.exec("ALTER TABLE ai_generation_attempts ADD COLUMN input_tokens INTEGER");
if (!aiGenerationColumns.some((column) => column.name === "output_tokens")) db.exec("ALTER TABLE ai_generation_attempts ADD COLUMN output_tokens INTEGER");
if (!aiGenerationColumns.some((column) => column.name === "total_tokens")) db.exec("ALTER TABLE ai_generation_attempts ADD COLUMN total_tokens INTEGER");
db.exec("CREATE INDEX IF NOT EXISTS ai_generation_attempts_provider_model_requested_idx ON ai_generation_attempts(provider, model, requested_at)");

const jobColumns = db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
if (!jobColumns.some((column) => column.name === "renderer_version")) db.exec("ALTER TABLE jobs ADD COLUMN renderer_version INTEGER NOT NULL DEFAULT 1");

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
  researchPackage: import("../domain/research").ResearchPackage;
  visualStoryboard: VisualStoryboard;
  visualAssets: VisualAsset[];
  audio: StoredAudio | null;
  pendingTts: { cacheKey: string; scriptSha256: string } | null;
  researchReviewStatus: "needs-review" | "verified-by-author";
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
  const normalizedResearch = parseResearchPackage(project.researchPackage);
  if (normalizedResearch.success) project.researchPackage = normalizedResearch.data;
  const rawStoryboard = project.visualStoryboard as unknown as { scenes?: Array<Record<string, unknown>> };
  if (Array.isArray(rawStoryboard?.scenes)) project.visualStoryboard = {
    ...(project.visualStoryboard as unknown as Record<string, unknown>),
    scenes: rawStoryboard.scenes.map((scene) => {
      if (scene.authoringStatus !== "ready") return scene;
      const migrated = { ...scene, authoringStatus: "ready_for_review" };
      if (scene.approved === true && typeof scene.approvedFingerprint === "string") {
        const old = { ...migrated, authoringStatus: "ready" } as unknown as VisualStoryboardScene;
        if (visualApprovalFingerprint(old) === scene.approvedFingerprint) {
          (migrated as Record<string, unknown>).approvedFingerprint = visualApprovalFingerprint(migrated as unknown as VisualStoryboardScene);
        }
      }
      return migrated;
    }),
  } as unknown as VisualStoryboard;
  const savedStoryboard = visualStoryboardSchema.safeParse(project.visualStoryboard);
  project.visualStoryboard = normalizedResearch.success && savedStoryboard.success
    && savedStoryboard.data.scenes.length === normalizedResearch.data.scenes.length
    && savedStoryboard.data.scenes.every((scene, index) => scene.sceneId === normalizedResearch.data.scenes[index]?.id && scene.durationSec === Math.round(((normalizedResearch.data.scenes[index]?.endSec ?? 0) - (normalizedResearch.data.scenes[index]?.startSec ?? 0)) * 1000) / 1000)
    ? savedStoryboard.data
    : normalizedResearch.success ? buildVisualStoryboard(normalizedResearch.data) : project.visualStoryboard;
  project.pendingTts ??= null;
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
