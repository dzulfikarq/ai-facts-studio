import type { DatabaseSync } from "node:sqlite";

export const aiGenerationSchema = `
  CREATE TABLE IF NOT EXISTS ai_generation_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mode TEXT NOT NULL CHECK (mode IN ('development', 'production')),
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ai_generation_attempts (
    id TEXT PRIMARY KEY,
    requested_at TEXT NOT NULL,
    task TEXT NOT NULL CHECK (task IN ('research', 'storyboard', 'visual-director')),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('started', 'succeeded', 'failed')),
    error_code TEXT
  );
  CREATE INDEX IF NOT EXISTS ai_generation_attempts_requested_idx ON ai_generation_attempts(requested_at);
`;

export const DEFAULT_TEXT_MODEL = "gemini-3.5-flash-lite";
export const FREE_TIER_TEXT_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite"] as const;
export type AiGenerationMode = "development" | "production";
export type AiGenerationTask = "research" | "storyboard" | "visual-director";
export type AiGenerationOutputFormat = "text" | "research-package-v1.1-json";

export type AiGenerationRequest = {
  task: AiGenerationTask;
  prompt: string;
  outputFormat: AiGenerationOutputFormat;
  maxOutputTokens?: number;
};

export type AiGenerationResult = {
  text: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
};

export interface AiGenerationProvider {
  readonly id: string;
  readonly displayName: string;
  readonly model: string;
  generate(request: AiGenerationRequest): Promise<AiGenerationResult>;
}

type SettingsDatabase = Pick<DatabaseSync, "prepare">;
export type ProductionProviderStatus = {
  id: "gemini-developer-api";
  displayName: string;
  model: string | null;
  allowedModels: readonly string[];
  configured: boolean;
  disabledReason: string | null;
  freeTierOnly: boolean;
  dailyLimit: number;
  requestsUsed: number;
  requestsRemaining: number;
};

export type AiGenerationSettings = {
  mode: AiGenerationMode;
  providers: {
    development: { id: "manual-prompt"; displayName: string; configured: true };
    production: ProductionProviderStatus;
  };
  generationAvailable: false;
};

export function readAiGenerationMode(db: SettingsDatabase): AiGenerationMode {
  const row = db.prepare("SELECT mode FROM ai_generation_settings WHERE id = 1").get() as { mode?: string } | undefined;
  return row?.mode === "production" ? "production" : "development";
}

export function writeAiGenerationMode(db: SettingsDatabase, mode: AiGenerationMode, now = new Date().toISOString()) {
  db.prepare("INSERT INTO ai_generation_settings (id, mode, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at")
    .run(mode, now);
}

export function getProductionProviderStatus(env: NodeJS.ProcessEnv = process.env, requestsUsed = 0): ProductionProviderStatus {
  const apiKeyConfigured = Boolean(env.GEMINI_API_KEY?.trim());
  const model = env.GEMINI_TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL;
  const freeTierOnly = env.GEMINI_TEXT_FREE_TIER_ONLY === "true";
  const rawDailyLimit = env.AI_GENERATION_DAILY_REQUEST_LIMIT ?? "10";
  const dailyLimit = Number(rawDailyLimit);
  const validDailyLimit = Number.isInteger(dailyLimit) && dailyLimit >= 1 && dailyLimit <= 1000;
  const modelIsAllowlisted = (FREE_TIER_TEXT_MODELS as readonly string[]).includes(model);
  const disabledReason = !apiKeyConfigured
    ? "GEMINI_API_KEY belum dikonfigurasi di backend."
    : !freeTierOnly
      ? "Gemini Text terkunci. Verifikasi project Free Tier tanpa billing, lalu set GEMINI_TEXT_FREE_TIER_ONLY=true."
      : !modelIsAllowlisted
        ? `Model teks '${model}' tidak ada di allowlist Free Tier; fallback berbayar tidak tersedia.`
        : !validDailyLimit
          ? "AI_GENERATION_DAILY_REQUEST_LIMIT harus integer 1–1000."
          : null;
  const safeLimit = validDailyLimit ? dailyLimit : 0;
  return {
    id: "gemini-developer-api",
    displayName: "Google Gemini Developer API · Text",
    model: model || null,
    allowedModels: FREE_TIER_TEXT_MODELS,
    configured: disabledReason === null,
    disabledReason,
    freeTierOnly,
    dailyLimit: safeLimit,
    requestsUsed,
    requestsRemaining: Math.max(0, safeLimit - requestsUsed),
  };
}

export function getAiGenerationSettings(db: SettingsDatabase, env: NodeJS.ProcessEnv = process.env, now = Date.now()): AiGenerationSettings {
  const since = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const requestsUsed = (db.prepare("SELECT COUNT(*) AS count FROM ai_generation_attempts WHERE requested_at > ?").get(since) as { count: number }).count;
  return {
    mode: readAiGenerationMode(db),
    providers: {
      development: { id: "manual-prompt", displayName: "ChatGPT / OpenCode · manual prompt + JSON import", configured: true },
      production: getProductionProviderStatus(env, requestsUsed),
    },
    generationAvailable: false,
  };
}

export function isLoopbackAddress(address?: string | null) {
  const normalized = address?.toLowerCase().replace(/^::ffff:/, "");
  return normalized === "127.0.0.1" || normalized === "::1";
}
