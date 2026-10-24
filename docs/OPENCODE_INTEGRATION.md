# OpenCode integration

OpenCode is a coding agent, not runtime dependency. No OpenCode CLI/model calls occur in import, editing, preview, or render paths. Happy path uses deterministic scene templates and needs no AI token.

Custom-scene generation is deferred (PRD P1). If added: explicit opt-in, dynamically inspect configured providers/models, max two calls/job, no automatic paid fallback, temporary sandbox without credentials, generated code held for human review and never auto-executed/imported. Current app has no CLI status page or custom-scene action.
