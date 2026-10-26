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
    error_code TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER
  );
  CREATE INDEX IF NOT EXISTS ai_generation_attempts_requested_idx ON ai_generation_attempts(requested_at);
  CREATE INDEX IF NOT EXISTS ai_generation_attempts_provider_model_requested_idx ON ai_generation_attempts(provider, model, requested_at);
  CREATE TABLE IF NOT EXISTS visual_plan_cache (
    cache_key TEXT PRIMARY KEY,
    plan_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;

export const DEFAULT_TEXT_MODEL = "gemini-3.5-flash-lite";
export const FREE_TIER_TEXT_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite"] as const;
export type AiGenerationMode = "development" | "production";
export type AiGenerationTask = "research" | "storyboard" | "visual-director";
export type AiGenerationOutputFormat = "text" | "research-package-v1.1-json" | "ai-research-storyboard-v1" | "visual-semantic-plan-v1";

export type AiGenerationRequest = {
  task: AiGenerationTask;
  prompt: string;
  outputFormat: AiGenerationOutputFormat;
  responseSchema?: unknown;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  onPhase?: (phase: "generating") => void;
};

export type AiGenerationResult = {
  text: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
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
  apiKeyConfigured: boolean;
  freeTierOnly: boolean;
  dailyLimit: number;
  requestsUsed: number;
  requestsRemaining: number;
  projectLimits: { rpm: number | null; rpd: number | null; tpm: number | null };
  quotaMonitoring: GeminiTextQuotaMonitoring;
};

export type GeminiQuotaType = "RPM" | "RPD" | "TPM" | "APP_RPD" | "UNKNOWN";
export type GeminiQuotaWindow = { used: number | null; limit: number | null; estimatedRemaining: number | null; cooldownUntil: string | null };
export type GeminiTextQuotaMonitoring = {
  usageSource: "local-records";
  limitSource: "operator-configured-ai-studio";
  model: string | null;
  rpm: GeminiQuotaWindow;
  rpd: GeminiQuotaWindow;
  tpm: GeminiQuotaWindow;
};

export type AiGenerationSettings = {
  mode: AiGenerationMode;
  providers: {
    development: {
      id: "opencode-local";
      displayName: string;
      configured: boolean;
      connected: boolean;
      state: "server-unreachable" | "authentication-failed" | "unsupported-api-version" | "model-unavailable" | "connected";
      apiVersion: "v1" | "v2" | null;
      version: string | null;
      models: Array<{ id: string; providerID: string; modelID: string; name: string }>;
      disabledReason: string | null;
    };
    production: ProductionProviderStatus;
  };
  generationAvailable: boolean;
};

export type DevelopmentProviderStatus = AiGenerationSettings["providers"]["development"];

export function readAiGenerationMode(db: SettingsDatabase): AiGenerationMode {
  const row = db.prepare("SELECT mode FROM ai_generation_settings WHERE id = 1").get() as { mode?: string } | undefined;
  return row?.mode === "production" ? "production" : "development";
}

export function writeAiGenerationMode(db: SettingsDatabase, mode: AiGenerationMode, now = new Date().toISOString()) {
  db.prepare("INSERT INTO ai_generation_settings (id, mode, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at")
    .run(mode, now);
}

function optionalQuotaLimit(value: string | undefined) {
  if (!value?.trim()) return { limit: null, valid: true };
  const limit = Number(value.trim());
  return { limit: Number.isSafeInteger(limit) && limit > 0 ? limit : null, valid: Number.isSafeInteger(limit) && limit > 0 };
}

function emptyQuotaWindow(limit: number | null, used: number | null) {
  return { used, limit, estimatedRemaining: limit === null || used === null ? null : Math.max(0, limit - used), cooldownUntil: null };
}

export function getProductionProviderStatus(env: NodeJS.ProcessEnv = process.env, requestsUsed = 0, quotaMonitoring?: GeminiTextQuotaMonitoring): ProductionProviderStatus {
  const apiKeyConfigured = Boolean(env.GEMINI_API_KEY?.trim());
  const model = env.GEMINI_TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL;
  const freeTierOnly = env.GEMINI_TEXT_FREE_TIER_ONLY === "true";
  const rawDailyLimit = env.AI_GENERATION_DAILY_REQUEST_LIMIT ?? "10";
  const dailyLimit = Number(rawDailyLimit);
  const validDailyLimit = Number.isInteger(dailyLimit) && dailyLimit >= 1 && dailyLimit <= 1000;
  const modelIsAllowlisted = (FREE_TIER_TEXT_MODELS as readonly string[]).includes(model);
  const rpm = optionalQuotaLimit(env.GEMINI_TEXT_RPM_LIMIT);
  const rpd = optionalQuotaLimit(env.GEMINI_TEXT_RPD_LIMIT);
  const tpm = optionalQuotaLimit(env.GEMINI_TEXT_TPM_LIMIT);
  const projectLimits = { rpm: rpm.limit, rpd: rpd.limit, tpm: tpm.limit };
  const emptyMonitoring: GeminiTextQuotaMonitoring = {
    usageSource: "local-records", limitSource: "operator-configured-ai-studio", model,
    rpm: emptyQuotaWindow(rpm.limit, 0), rpd: emptyQuotaWindow(rpd.limit, 0), tpm: emptyQuotaWindow(tpm.limit, null),
  };
  const disabledReason = !apiKeyConfigured
    ? "GEMINI_API_KEY belum dikonfigurasi di backend."
    : !freeTierOnly
      ? "Gemini Text terkunci. Verifikasi project Free Tier tanpa billing, lalu set GEMINI_TEXT_FREE_TIER_ONLY=true."
      : !modelIsAllowlisted
        ? `Model teks '${model}' tidak ada di allowlist Free Tier; fallback berbayar tidak tersedia.`
        : !validDailyLimit
          ? "AI_GENERATION_DAILY_REQUEST_LIMIT harus integer 1–1000."
          : !rpm.valid || !rpd.valid || !tpm.valid
            ? "GEMINI_TEXT_RPM_LIMIT, GEMINI_TEXT_RPD_LIMIT, dan GEMINI_TEXT_TPM_LIMIT harus kosong atau integer positif."
            : null;
  const safeLimit = validDailyLimit ? dailyLimit : 0;
  return {
    id: "gemini-developer-api",
    displayName: "Google Gemini Developer API · Text",
    model: model || null,
    allowedModels: FREE_TIER_TEXT_MODELS,
    configured: disabledReason === null,
    disabledReason,
    apiKeyConfigured,
    freeTierOnly,
    dailyLimit: safeLimit,
    requestsUsed,
    requestsRemaining: Math.max(0, safeLimit - requestsUsed),
    projectLimits,
    quotaMonitoring: quotaMonitoring ?? emptyMonitoring,
  };
}

type QuotaUsageDatabase = Pick<DatabaseSync, "prepare">;
type QuotaUsageRow = { requested_at: string; total_tokens: number | null };

function resetAfter(requestedAt: string, windowMs: number) {
  const time = Date.parse(requestedAt);
  return Number.isFinite(time) ? new Date(time + windowMs).toISOString() : null;
}

function requestWindow(rows: QuotaUsageRow[], limit: number | null, windowMs: number): GeminiQuotaWindow {
  let cooldownUntil: string | null = null;
  if (limit !== null && rows.length >= limit) {
    for (let index = 0; index < rows.length; index++) {
      if (rows.length - index - 1 < limit) { cooldownUntil = resetAfter(rows[index]!.requested_at, windowMs); break; }
    }
  }
  return { used: rows.length, limit, estimatedRemaining: limit === null ? null : Math.max(0, limit - rows.length), cooldownUntil };
}

function tokenWindow(rows: QuotaUsageRow[], limit: number | null, windowMs: number): GeminiQuotaWindow {
  const tokenRows = rows.filter((row) => Number.isSafeInteger(row.total_tokens) && (row.total_tokens ?? -1) >= 0);
  if (!tokenRows.length) return emptyQuotaWindow(limit, null);
  const used = tokenRows.reduce((sum, row) => Math.min(Number.MAX_SAFE_INTEGER, sum + (row.total_tokens ?? 0)), 0);
  let cooldownUntil: string | null = null;
  if (limit !== null && used >= limit) {
    let remaining = used;
    for (const row of tokenRows) {
      remaining -= row.total_tokens ?? 0;
      if (remaining < limit) { cooldownUntil = resetAfter(row.requested_at, windowMs); break; }
    }
  }
  return { used, limit, estimatedRemaining: limit === null ? null : Math.max(0, limit - used), cooldownUntil };
}

export function getGeminiTextQuotaMonitoring(db: QuotaUsageDatabase, model: string | null, projectLimits: ProductionProviderStatus["projectLimits"], now = Date.now()): GeminiTextQuotaMonitoring {
  const sinceDay = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const sinceMinute = new Date(now - 60 * 1000).toISOString();
  const rows = model
    ? db.prepare("SELECT requested_at, total_tokens FROM ai_generation_attempts WHERE provider = ? AND model = ? AND requested_at > ? ORDER BY requested_at")
      .all("gemini-developer-api", model, sinceDay) as QuotaUsageRow[]
    : [];
  const minuteRows = rows.filter((row) => row.requested_at > sinceMinute);
  return {
    usageSource: "local-records",
    limitSource: "operator-configured-ai-studio",
    model,
    rpm: requestWindow(minuteRows, projectLimits.rpm, 60 * 1000),
    rpd: requestWindow(rows, projectLimits.rpd, 24 * 60 * 60 * 1000),
    tpm: tokenWindow(minuteRows, projectLimits.tpm, 60 * 1000),
  };
}

export function getAiGenerationSettings(db: SettingsDatabase, env: NodeJS.ProcessEnv = process.env, now = Date.now(), development?: DevelopmentProviderStatus): AiGenerationSettings {
  const since = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const requestsUsed = (db.prepare("SELECT COUNT(*) AS count FROM ai_generation_attempts WHERE requested_at > ?").get(since) as { count: number }).count;
  const mode = readAiGenerationMode(db);
  const providerStatus = getProductionProviderStatus(env, requestsUsed);
  const quotaMonitoring = getGeminiTextQuotaMonitoring(db, providerStatus.model, providerStatus.projectLimits, now);
  const production = { ...providerStatus, quotaMonitoring };
  return {
    mode,
    providers: {
      development: development ?? {
        id: "opencode-local", displayName: "OpenCode · local", configured: false, connected: false,
        state: "server-unreachable", apiVersion: null,
        version: null, models: [], disabledReason: "Status OpenCode belum diperiksa. Manual prompt tetap tersedia.",
      },
      production,
    },
    generationAvailable: mode === "development" || production.configured,
  };
}

export function isLoopbackAddress(address?: string | null) {
  const normalized = address?.toLowerCase().replace(/^::ffff:/, "");
  return normalized === "127.0.0.1" || normalized === "::1";
}
