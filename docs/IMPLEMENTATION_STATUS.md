# Implementation status

Status reflects executed checks as of 24 Oct 2026.

| Phase | State | Evidence / scope |
|---|---|---|
| 0 Audit/foundation | Implemented / tested locally | Repo had only PRD and Master Prompt; Node 22.22, npm 10.9, FFmpeg/ffprobe 9.0.2; no legacy research package. Vite + Express selected because Remotion SSR docs disallow its bundler in Next.js. |
| 1 Import/storyboard | Implemented / tested locally | Strict Zod v1.0 contract, three samples, Node `node:sqlite` store, import/editor. API smoke covers import, idempotency, audio upload/probe/remove, immutable audio copy, and daily limit. |
| 2 Animation/preview/audio | Implemented / tested locally | Seven-scene animated SVG mountain template, Player, upload/probe, official Gemini SDK adapter, Free-Tier-only model allowlist, cached Test Voice, full narration preview + explicit approval, estimated sync, FFmpeg normalization, immutable job audio. TTS/cache/stale-preview rejection/approval/render E2E passed with test mock (synthetic tone); Gemini reports unconfigured here, so real API not live-tested. Full mountain render: 56.04s, H.264 + silent AAC, 1080×1920, 6,513,583 bytes, SHA-256 `13ae92c00376c080a021c04df7f8fce5c82307ba4f34099a9d7665a03f970426`. |
| 3 GitHub cloud render | Partial / not live-tested | Manual workflow renders committed package only. No app dispatch/status/download or private audio transport; no GitHub run executed. |
| 4 Stabilization | Core local path tested | `npm test`, `npm run smoke:api`, `npm run smoke:tts`, `npm run typecheck`, `npm run build`, `npm run smoke:render`, full `npm run render`, `npm audit` (0 vulnerabilities). Build succeeds with Vite chunk-size (>500 KB) and Zod annotation warnings. OpenCode custom scene deferred P1. |

## Main files

- `src/domain/research.ts`, `src/domain/timeline.ts`, `src/domain/voice-timing.ts`: contract, cues/templates, timeline allowance and estimated TTS sync.
- `src/video/`: Remotion composition and deterministic SVG scenes.
- `src/server/`: loopback API, SQLite store, Gemini TTS adapter, Free Tier guard, cache/limits, audio validation, immutable snapshot/job/render flow.
- `src/client/`: dashboard, import/editor, preview, audio, render/review UI.
- `scripts/render-core.ts`, `scripts/render.ts`, `scripts/tts-smoke.ts`: renderer, output verification, mocked TTS E2E.
- `.github/workflows/render-video.yml`: trusted committed-package workflow.
- `samples/`: mountain, space, animal examples.

## Blockers/next

1. Manually run Actions workflow in configured repository; build secure snapshot/audio dispatch + authenticated artifact download before calling cloud end-to-end complete.
2. Add persistent remote-run status recovery, cancellation, audio retention controls, and optional provider integrations only as needed.
