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

OpenCode models must already be configured and authorized there. The app lists non-deprecated models under connected providers; user must select one. It never changes provider/model or falls back. OpenCode's selected provider may be remote and charge under its own account; “local” describes the OpenCode server only.

The app supports OpenCode V1 and V2, identifies API version from authenticated responses, and bounds catalog reads. `/global/health` HTTP 200 alone never proves authentication; it may return Web UI HTML without `WWW-Authenticate`. On explicit Generate only, backend starts a short-lived loopback `opencode serve` sidecar with `OPENCODE_DISABLE_PROJECT_CONFIG=true`. V1 uses `OPENCODE_PURE=true`; V2 preserves built-in provider plugins while excluding non-builtin plugin IDs from an inline config overlay, denies all permissions, disables sharing, and clears MCP servers. Sidecar rechecks the exact selected model, uses the same OpenCode config/auth store, creates a temp location, uses built-in `plan` agent, and sends only prompt text. Active MCP servers or global instructions fail closed. App API-key variables (including `GEMINI_API_KEY`) are not copied. Cancel/120-second timeout interrupts session; session, sidecar, and temp directory are cleaned up. The app never scans ports or reuses one-time pairing codes. Its API requires same-origin browser requests and loopback clients. See [protocol, auth, and live endpoint evidence](OPENCODE_INTEGRATION.md); no OpenCode SDK dependency is added.

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

The backend reads `.env` at startup. A blank inherited Gemini Text environment value is filled from non-empty `.env`; non-empty process environment values still win. This handles shells/service managers that export `GEMINI_API_KEY=` while preserving explicit Free Tier guard values. The guard is never enabled by the app: set `GEMINI_TEXT_FREE_TIER_ONLY=true` only after verifying project billing state yourself.

Optional `GEMINI_TEXT_RPM_LIMIT`, `GEMINI_TEXT_RPD_LIMIT`, and `GEMINI_TEXT_TPM_LIMIT` configure per-model project caps. Copy values from the selected model's limits in Google AI Studio; leave unknown limits blank. These caps gate local requests. Usage counts come from this app's recorded Gemini Text attempts in rolling 60-second/24-hour windows; TPM uses Google response token metadata when available and can overshoot on an in-flight request because actual usage arrives after response. App's separate `AI_GENERATION_DAILY_REQUEST_LIMIT` remains a local safety cap. Google does not expose authoritative remaining quota here, so UI shows only local counts/estimated local slots and never claims official remaining quota.

The Settings page checks local OpenCode status/models; it does not call Gemini or validate the Gemini key with Google. **Generate with AI** only sends after explicit click. Production `Configured` means local key/guard/model/quota configuration passed; it does not prove that Google accepts the key/model.

Gemini response uses JSON response schema. One bounded repair request is allowed for schema/Research Package validation errors; provider/network errors are not retried. Each provider request (including repair) consumes one rolling quota slot. Invalid Research Package output is not silently edited; UI shows validation paths.

## Research sources and review

Generator response schema contains research summary, fact/interpretation classifications, uncertainties, narration, and scenes; schema does not allow model-created references. Optional source URLs come from user input only. URL context is not fetched and no Google Search grounding tool is enabled; therefore all generated claims remain unverified, even when related user URLs exist. App only associates exact matching user-provided URLs. User must open/check each candidate in Review before it is added to the Research Package. No independent fact-check is claimed.

Production and Development results both pass local Research Package schema validation/migration before project creation. Valid output auto-creates one project and opens Materi & Storyboard; invalid output remains in Generate with validation errors. Manual prompt/paste uses same flow. Project creation uses Research Package ID as persistent idempotency key, so retry/double-submit does not duplicate an unchanged result. AI claims remain unverified; source URLs are not fetched or independently verified. New AI scenes default to Cut without added Motion Direction effects. TTS approval, audio data, renderer snapshots, and existing project jobs are untouched; generation never starts TTS or MP4 render.

## Request limits and provider contract

`ai_generation_attempts` records timestamp, task, provider, model, outcome, and optional token counts—never prompt text or keys. `reserveAiGenerationRequest()` atomically enforces the rolling 24-hour app safety cap plus configured per-model RPM/RPD and observed TPM limits for each Production provider request, including validation repair. Google HTTP 429 responses report recognized RPM/RPD/TPM type and retry time when Google includes `RetryInfo`; no OpenCode fallback occurs. Development OpenCode has no app quota; provider-side limits/billing still apply. Gemini TTS uses separate tables/limits; video rendering uses separate job quota.

`src/server/ai-generation/provider.ts` defines provider request/result and task contracts for `research`, `storyboard`, and `visual-director`. Production combines Research and Storyboard in one request plus optional validation repair. The scene-level Visual Director is an optional text-only semantic planner: explicit click, selected Development OpenCode model or configured Production Gemini model, strict JSON schema, exact-input/provider/model cache. It does not generate code or images and has no image API. Local deterministic Art Director consumes plan objects/relations/focus and maps curated concepts to reusable compositions; unsupported concepts need manual authoring. Composition-type suggestion remains advisory and mismatch is shown for human review.

## Errors

- **OpenCode status:** Settings distinguishes unreachable server, failed authentication, unsupported API version, unavailable model, and connected server. Check configured loopback URL and Basic credentials; HTTP 200 from `/global/health` is not auth evidence. V1/V2 sidecars isolate plugins and tools; active MCP/global instructions fail closed.
- **Production unavailable:** Settings shows missing key, Free Tier guard, model, or request-limit reason. Production mode cannot be selected until configuration passes.
- **Mode invalid / remote settings access:** backend rejects invalid values and non-loopback Settings requests.
- **Production configured but request fails:** local status cannot test Google key/model access without a user-triggered request. Read provider error; no paid-model fallback or provider-error retry.
- **OpenCode connected but request fails:** confirm selected model remains connected and authorized. Request is cancelled/cleaned up on Cancel or timeout; no alternate model is tried.
