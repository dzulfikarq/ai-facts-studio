import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { aiGeneratedContentSchema, buildAiGenerationDraft, buildDevelopmentPrompt, buildProductionResearchPrompt, type AiGenerationDraft, type AiGenerationInput } from "../../domain/ai-generation";
import { finishAiGenerationRequest, reserveAiGenerationRequest } from "./quota";
import type { AiGenerationMode, AiGenerationProvider, AiGenerationResult, ProductionProviderStatus } from "./provider";

type GenerationDatabase = Pick<DatabaseSync, "exec" | "prepare">;
type ValidationIssue = { path: string; message: string };

export class AiGenerationOutputError extends Error {
  constructor(message: string, public readonly issues: ValidationIssue[]) {
    super(message);
    this.name = "AiGenerationOutputError";
  }
}

function parseGeneratedContent(text: string) {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { return { success: false as const, issues: [{ path: "output", message: "Output bukan JSON valid." }] }; }
  const parsed = aiGeneratedContentSchema.safeParse(value);
  if (!parsed.success) return { success: false as const, issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) };
  return { success: true as const, content: parsed.data };
}

export async function generateAiResearchStoryboard(
  db: GenerationDatabase,
  mode: AiGenerationMode,
  production: ProductionProviderStatus | null,
  input: AiGenerationInput,
  provider: AiGenerationProvider,
  options: { signal?: AbortSignal; onPhase?: (phase: "connecting" | "generating" | "validating" | "repairing") => void } = {},
): Promise<AiGenerationDraft> {
  const responseSchema = z.toJSONSchema(aiGeneratedContentSchema, { target: "draft-07" }) as Record<string, unknown>;
  delete responseSchema.$schema;
  let previousIssues: ValidationIssue[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    if (options.signal?.aborted) throw options.signal.reason;
    const reservation = mode === "production"
      ? reserveAiGenerationRequest(db, mode, production!, "research", Date.now())
      : null;
    let generated: AiGenerationResult;
    try {
      options.onPhase?.("connecting");
      generated = await provider.generate({
        task: "research",
        prompt: mode === "development"
          ? buildDevelopmentPrompt(input, previousIssues.map((issue) => `${issue.path}: ${issue.message}`))
          : buildProductionResearchPrompt(input, previousIssues.map((issue) => `${issue.path}: ${issue.message}`)),
        outputFormat: "ai-research-storyboard-v1",
        responseSchema,
        maxOutputTokens: 8192,
        signal: options.signal,
        onPhase: () => options.onPhase?.("generating"),
      });
    } catch (error) {
      if (reservation) finishAiGenerationRequest(db, reservation.id, { state: "failed", errorCode: error instanceof Error && "code" in error ? String(error.code) : "provider-error" });
      throw error;
    }

    const tokenUsage = { inputTokens: generated.inputTokens, outputTokens: generated.outputTokens, totalTokens: generated.totalTokens };
    if (options.signal?.aborted) {
      if (reservation) finishAiGenerationRequest(db, reservation.id, { state: "failed", errorCode: "cancelled", ...tokenUsage });
      throw options.signal.reason;
    }
    options.onPhase?.("validating");
    const parsed = parseGeneratedContent(generated.text);
    if (!parsed.success) {
      previousIssues = parsed.issues;
      if (reservation) finishAiGenerationRequest(db, reservation.id, { state: "failed", errorCode: "invalid-structured-output", ...tokenUsage });
      if (attempt === 0) { options.onPhase?.("repairing"); continue; }
      throw new AiGenerationOutputError("Output AI belum memenuhi schema setelah satu perbaikan.", previousIssues);
    }

    try {
      const providerId = mode === "production" ? "gemini-developer-api" : provider.id === "opencode-local" ? "opencode-local" : "manual-prompt";
      const draft = buildAiGenerationDraft(input, parsed.content, randomUUID(), mode, providerId, generated.model);
      if (reservation) finishAiGenerationRequest(db, reservation.id, { state: "succeeded", ...tokenUsage });
      return draft;
    } catch (error) {
      previousIssues = [{ path: "researchPackage", message: error instanceof Error ? error.message : "Research Package tidak valid." }];
      if (reservation) finishAiGenerationRequest(db, reservation.id, { state: "failed", errorCode: "invalid-research-package", ...tokenUsage });
      if (attempt === 0) { options.onPhase?.("repairing"); continue; }
      throw new AiGenerationOutputError("Research Package hasil AI belum valid setelah satu perbaikan.", previousIssues);
    }
  }

  throw new Error("Unreachable AI generation retry state.");
}
