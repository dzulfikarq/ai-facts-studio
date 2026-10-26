# OpenCode integration

Development AI Research/Storyboard supports OpenCode V1 and V2. It uses only `OPENCODE_SERVER_URL` from the server environment, accepts HTTP loopback (`127.0.0.1`/`::1`), and sends configured Basic credentials only to that URL. It does not scan ports, switch servers, pair automatically, or store pairing codes.

## Protocol and status

The backend identifies V2 from authenticated `GET /api/info` and validates the V2 server identity. It reads the V2 catalog and isolation state from `/api/model`, `/api/provider`, `/api/mcp`, and `/api/config`. V1 has no `/api/info`; the backend validates the documented `/global/health` JSON version, then confirms credentials against authenticated `/provider` and `/config` requests. V1 uses `/session`, `/session/:id/message`, `/session/:id/abort`, and session `DELETE`; V2 uses `/api/session`, `/api/session/:id/generate`, `/api/session/:id/interrupt`, and session `DELETE`.

`/global/health` HTTP 200 is not authentication evidence: V2 can return Web UI HTML there without `WWW-Authenticate`. Authentication state comes from protected API responses. UI distinguishes server unreachable, authentication failed, unsupported API version, model unavailable, and connected. Model selection stays exact; generation rechecks it and never falls back. Remote model billing and data policies still apply.

## Isolated generation

Only explicit Generate starts a short-lived `opencode serve` sidecar. Backend detects CLI major version and uses a temporary location. V1 sidecar uses `OPENCODE_PURE=true`; V2 reads plugin runtime IDs from the authenticated server, keeps built-in provider plugins, and excludes each non-builtin plugin in an inline config overlay. V2 also disables sharing, clears MCP servers, and denies all permissions globally, for Plan, and for the session. Both disable project config, recheck the exact selected model, and delete the session and temp directory after request. If V2 plugin metadata cannot be verified, generation fails closed. Cancel and 120-second timeout interrupt the session and stop the sidecar.

Status fails closed when the configured server reports active MCP servers or global instructions. App API keys (including `GEMINI_API_KEY`) are not passed to the sidecar; OpenCode config/auth paths remain available for the selected provider. Only prompt text enters the generation request. Returned content still passes the app's Research Package validation and requires human review; no source retrieval or independent fact-check occurs.

## Live endpoint evidence

On 26 Oct 2026, configured loopback endpoint `127.0.0.1:4096` authenticated as OpenCode `2.1.4` through V2 `/api/info` and returned 493 models, including authorized `openai/gpt-6-luna`. `/global/health` returned HTTP 200 HTML without an auth challenge, while protected V2 APIs returned 401 without credentials. A V2 sidecar retained built-in providers, excluded reported non-builtin plugin IDs, and exposed the selected model. One AI Facts Studio API request with exact model `openai/gpt-6-luna` returned HTTP 200, five scenes, and a validated Research Package; session, sidecar, and temp directory cleanup succeeded. No fallback was used. `opencode service status` reported a separate Windows service on `127.0.0.1:28894`; configured credentials were rejected there, so the app does not switch to it automatically.

Official references: [V1 server API/auth](https://opencode.ai/docs/server/), [V2 HTTP API and OpenAPI](https://opencode.ai/v2/docs/api), and [V2 web pairing/service](https://opencode.ai/v2/docs/cli/web). V2 API is documented as experimental.

OpenCode does not run during import, editing, preview, TTS, or render. Local deterministic Art Director composes supported concepts before preview; Remotion consumes validated composition data and does not generate artwork during render. Unsupported concepts need manual authoring.
