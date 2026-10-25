# AI Generation settings

## Modes

**Development** is the default and is stored in the local SQLite settings table. In **Create video → Generate with AI**, select an authorized OpenCode model and explicitly click Generate. Advanced keeps manual prompt/paste JSON fallback. No Gemini Text call occurs in Development. Existing AI Voice TTS remains separate.

**Production** sends one explicit Research + Storyboard request to Gemini Developer API from backend. It can be selected only when backend configuration is locally valid. It uses `GEMINI_API_KEY` from server environment, but text model, Free Tier guard, and rolling request quota are separate from Gemini TTS. Key is never accepted by a route or returned to browser code.

AI Generation Mode is not `NODE_ENV`, Vite mode, or deployment mode. The selected mode persists across restart and does not edit projects, storyboards, audio approval, snapshots, or renders. Settings endpoints are loopback-only.

## Development: authenticated local OpenCode

Run a dedicated OpenCode server on loopback with Basic authentication:

```powershell
$env:OPENCODE_SERVER_PASSWORD = "use-a-local-secret"
opencode serve --hostname 127.0.0.1 --port 4096
```

Configure the same credentials in the app's server-only `.env`:

```dotenv
OPENCODE_SERVER_URL=http://127.0.0.1:4096
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=use-a-local-secret
```

OpenCode models must already be configured and authorized there. The app lists only active models under connected providers; user must select one. It never changes provider/model or falls back. OpenCode's selected provider may be remote and charge under its own account; “local” describes the OpenCode server only.

Each generation rechecks server health, auth, model availability, and config. It creates a temp-directory OpenCode context, configures a dedicated research-only agent with the selected model, disables sharing and all tools/permissions, and sends only prompt text. Plugins, enabled MCP servers, and global instructions cause fail-closed status. Cancel/120-second timeout aborts session; session and temp directory are deleted. App API requires a same-origin browser request and loopback client. No OpenCode SDK dependency or CLI subprocess is used.

OpenCode quick setup: [Server](https://opencode.ai/docs/server/), [Models](https://opencode.ai/docs/models/), [Permissions](https://opencode.ai/docs/permissions/), [Agents](https://opencode.ai/docs/agents/).

## Production configuration

In server-only `.env`, set:

```dotenv
GEMINI_API_KEY=your-server-side-key
GEMINI_TEXT_MODEL=gemini-3.5-flash-lite
GEMINI_TEXT_FREE_TIER_ONLY=true
AI_GENERATION_DAILY_REQUEST_LIMIT=10
```

`GEMINI_TEXT_MODEL` defaults to `gemini-3.5-flash-lite` and must match the text Free Tier allowlist shown in Settings: `gemini-3.8-flash` or `gemini-3.5-flash-lite`. Google's [model catalog](https://ai.google.dev/gemini-api/docs/models) lists both IDs; [pricing](https://ai.google.dev/gemini-api/docs/pricing) marks Standard input/output Free Tier as free of charge. `gemini-3.8-flash-lite` is not a valid model ID and is not in this allowlist. `GEMINI_TTS_MODEL` remains a separate audio model and is never used for text. `GEMINI_TEXT_FREE_TIER_ONLY=true` is an operator attestation, not billing detection; Google billing linkage cannot be queried through this API. Keep the Google project unlinked from billing. Invalid/missing config and quota exhaustion fail closed; there is no paid-model or provider fallback.

The Settings page checks local OpenCode status/models; it does not call Gemini or validate the Gemini key with Google. **Generate with AI** only sends after explicit click. Production `Configured` means local key/guard/model/quota configuration passed; it does not prove that Google accepts the key/model.

Gemini response uses JSON response schema. One bounded repair request is allowed for schema/Research Package validation errors; provider/network errors are not retried. Each provider request (including repair) consumes one rolling quota slot. Invalid Research Package output is not silently edited; UI shows validation paths.

## Research sources and review

Generator response schema contains research summary, fact/interpretation classifications, uncertainties, narration, and scenes; schema does not allow model-created references. Optional source URLs come from user input only. URL context is not fetched and no Google Search grounding tool is enabled; therefore all generated claims remain unverified, even when related user URLs exist. App only associates exact matching user-provided URLs. User must open/check each candidate in Review before it is added to the Research Package. No independent fact-check is claimed.

Production and Development results both pass local Research Package schema validation/migration before review. The review allows title/category/preset, scene text/narration/visual direction/template/motion/timing, source confirmation and scene-source links, scene add/remove, target duration, save draft, and explicit Create Project. Creation uses persistent request idempotency so retry/double-submit does not duplicate an unchanged AI draft. Draft/input persist in browser local storage until cleared. TTS approval, audio data, renderer snapshots and existing project jobs are untouched; generation never starts TTS or MP4 render.

## Request limits and provider contract

`ai_generation_attempts` records timestamp, task, provider, model, and outcome metadata—never prompt text or keys. `reserveAiGenerationRequest()` atomically enforces the configured rolling 24-hour app limit for each Production provider request, including validation repair. Development OpenCode has no app quota; provider-side limits/billing still apply. Existing TTS quota remains in `tts_attempts` and does not share this counter.

`src/server/ai-generation/provider.ts` defines provider request/result and task contracts for `research`, `storyboard`, and `visual-director`. Production currently combines Research and Storyboard in one request plus optional validation repair. A separate Visual Director that autonomously creates topic-specific structured artwork is not implemented; `visualDescription` remains editorial guidance.

## Errors

- **OpenCode unavailable:** check loopback URL, server Basic username/password, connected model authorization, and that plugins/MCP/global instructions are disabled for generation.
- **Production unavailable:** Settings shows missing key, Free Tier guard, model, or request-limit reason. Production mode cannot be selected until configuration passes.
- **Mode invalid / remote settings access:** backend rejects invalid values and non-loopback Settings requests.
- **Production configured but request fails:** local status cannot test Google key/model access without a user-triggered request. Read provider error; no paid-model fallback or provider-error retry.
- **OpenCode connected but request fails:** confirm selected model remains connected and authorized. Request is cancelled/cleaned up on Cancel or timeout; no alternate model is tried.
