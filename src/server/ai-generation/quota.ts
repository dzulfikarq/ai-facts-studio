import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { FREE_TIER_TEXT_MODELS, type AiGenerationMode, type AiGenerationSettings, type AiGenerationTask } from "./provider";

type QuotaDatabase = Pick<DatabaseSync, "exec" | "prepare">;

export class AiGenerationRequestError extends Error {
  constructor(message: string, public readonly code: string, public readonly httpStatus: number, public readonly nextAllowedAt: string | null = null) {
    super(message);
    this.name = "AiGenerationRequestError";
  }
}

export function reserveAiGenerationRequest(db: QuotaDatabase, mode: AiGenerationMode, settings: AiGenerationSettings["providers"]["production"], task: AiGenerationTask, now = Date.now()) {
  if (mode !== "production") throw new AiGenerationRequestError("Development memakai prompt manual; aplikasi tidak akan memanggil Gemini.", "manual-mode", 409);
  if (!settings.configured || !settings.model || !settings.freeTierOnly || !(FREE_TIER_TEXT_MODELS as readonly string[]).includes(settings.model)) {
    throw new AiGenerationRequestError(settings.disabledReason ?? "Gemini Text Free Tier configuration tidak valid; tidak ada paid-model fallback.", "not-configured", 503);
  }

  const since = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const used = (db.prepare("SELECT COUNT(*) AS count FROM ai_generation_attempts WHERE requested_at > ?").get(since) as { count: number }).count;
    if (used >= settings.dailyLimit) {
      const oldest = db.prepare("SELECT requested_at FROM ai_generation_attempts WHERE requested_at > ? ORDER BY requested_at LIMIT 1").get(since) as { requested_at: string } | undefined;
      const nextAllowedAt = oldest ? new Date(Date.parse(oldest.requested_at) + 24 * 60 * 60 * 1000).toISOString() : null;
      throw new AiGenerationRequestError(`Batas ${settings.dailyLimit} request AI Text per 24 jam tercapai. Tidak ada retry atau paid-model fallback otomatis.`, "daily-limit", 429, nextAllowedAt);
    }
    const id = randomUUID();
    const requestedAt = new Date(now).toISOString();
    db.prepare("INSERT INTO ai_generation_attempts (id, requested_at, task, provider, model, state) VALUES (?, ?, ?, ?, ?, 'started')")
      .run(id, requestedAt, task, settings.id, settings.model);
    db.exec("COMMIT");
    return { id, requestedAt, provider: settings.id, model: settings.model };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* Transaction may already be closed. */ }
    throw error;
  }
}

export function finishAiGenerationRequest(db: QuotaDatabase, id: string, result: { state: "succeeded" | "failed"; errorCode?: string }) {
  db.prepare("UPDATE ai_generation_attempts SET state = ?, error_code = ? WHERE id = ? AND state = 'started'")
    .run(result.state, result.errorCode ?? null, id);
}
