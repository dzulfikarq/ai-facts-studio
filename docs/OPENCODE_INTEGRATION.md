# OpenCode integration

Development AI Research/Storyboard can send one explicit generation request to an authenticated local OpenCode HTTP server. OpenCode is not an app dependency; app uses Node `fetch` against its REST API and does not spawn `opencode` CLI.

The backend only accepts HTTP loopback URLs (`127.0.0.1`/`::1`) and requires OpenCode Basic auth configured via server environment. It lists only active models from connected providers. User selects exact model; no provider/model fallback. Provider-side billing and data policy still apply if selected model is remote.

Each request creates a temporary directory context and a dedicated research-only agent. Temp config sets selected model for primary/small/background agents, disables sharing, denies all tools and permissions, and the message also sends `tools: { "*": false }`. Only prompt text is sent. Status fails closed when OpenCode plugins, enabled MCP servers, or global instructions are configured. Cancel/120-second timeout aborts the session; session and temp directory are deleted after request.

App generation endpoint requires loopback and same-origin request. Provider status exposes no credentials. See [`AI_GENERATION_SETUP.md`](AI_GENERATION_SETUP.md) for setup and manual Advanced fallback.

OpenCode integration does not run during import, editing, preview, TTS, or render. The renderer uses supplied Research Package scenes and deterministic templates; it does not generate topic-specific artwork.
