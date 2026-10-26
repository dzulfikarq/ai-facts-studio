const geminiTextEnvironmentKeys = [
  "GEMINI_API_KEY",
  "GEMINI_TEXT_MODEL",
  "GEMINI_TEXT_FREE_TIER_ONLY",
  "GEMINI_TEXT_RPM_LIMIT",
  "GEMINI_TEXT_RPD_LIMIT",
  "GEMINI_TEXT_TPM_LIMIT",
  "AI_GENERATION_DAILY_REQUEST_LIMIT",
] as const;

export function fillEmptyGeminiTextEnvironment(env: NodeJS.ProcessEnv, dotenvValues: Record<string, string>) {
  for (const key of geminiTextEnvironmentKeys) {
    if (!env[key]?.trim() && dotenvValues[key]?.trim()) env[key] = dotenvValues[key];
  }
}
