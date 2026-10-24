# AI Generation settings

## Modes

**Development** is the default and is stored in the local SQLite settings table. Use the Settings prompt with ChatGPT or OpenCode outside the app, review the result, then import Research Package JSON through **Create video**. Settings, imports, and navigation do not send text to Gemini. Existing AI Voice TTS remains a separate explicit workflow.

**Production** selects the future Gemini Developer API text provider. It can be saved only when backend configuration is locally valid. It uses `GEMINI_API_KEY` from the server environment, but text model, Free Tier guard, and rolling quota are separate from Gemini TTS. The key is never accepted by a route or returned to browser code.

AI Generation Mode is not `NODE_ENV`, Vite mode, or deployment mode. The selected mode persists across restart and does not edit projects, storyboards, audio approval, snapshots, or renders. Settings endpoints are loopback-only.

## Production configuration

In server-only `.env`, set:

```dotenv
GEMINI_API_KEY=your-server-side-key
GEMINI_TEXT_MODEL=gemini-3.5-flash-lite
GEMINI_TEXT_FREE_TIER_ONLY=true
AI_GENERATION_DAILY_REQUEST_LIMIT=10
```

`GEMINI_TEXT_MODEL` defaults to `gemini-3.5-flash-lite` and must match the text Free Tier allowlist shown in Settings: `gemini-3.8-flash` or `gemini-3.5-flash-lite`. Google's [model catalog](https://ai.google.dev/gemini-api/docs/models) lists both IDs; [pricing](https://ai.google.dev/gemini-api/docs/pricing) marks Standard input/output Free Tier as free of charge. `gemini-3.8-flash-lite` is not a valid model ID and is not in this allowlist. `GEMINI_TTS_MODEL` remains a separate audio model and is never used for text. `GEMINI_TEXT_FREE_TIER_ONLY=true` is an operator attestation, not billing detection; Google billing linkage cannot be queried through this API. Keep the Google project unlinked from billing. Invalid/missing config and quota exhaustion fail closed; there is no paid-model or provider fallback.

The Settings page only reads local configuration and quota state. It does not call `models.get`, list models, validate the key with Google, or synthesize/generate content. `Configured` means local key/guard/model/quota configuration passed; it does not prove that Google accepts the key/model.

## Request limits and provider contract

`ai_generation_attempts` records timestamp, task, provider, model, and outcome metadata—never prompt text or keys. `reserveAiGenerationRequest()` atomically enforces the configured rolling 24-hour app limit before a future Production request. Existing TTS quota remains in `tts_attempts` and does not share this counter.

`src/server/ai-generation/provider.ts` defines provider request/result and task contracts for `research`, `storyboard`, and `visual-director`. No automatic generator or Gemini text adapter is implemented in this phase; API reports `generationAvailable: false`. Future endpoints must reserve quota, use selected allowlisted model only, and return explicit provider errors without fallback.

## Errors

- **Production unavailable:** Settings shows precise missing key, Free Tier guard, model, or request-limit reason. Production mode cannot be selected until configuration passes.
- **Mode invalid / remote settings access:** backend rejects invalid values and non-loopback Settings requests.
- **No generator available:** configured Production mode is only provider setup; Research/Storyboard/Visual Director generation remains unavailable until separately implemented.
