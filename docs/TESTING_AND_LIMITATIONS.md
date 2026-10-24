# Testing and limitations — V1.0.1

Verification performed 24 Oct 2026 on Windows x64. Commands below describe checks actually executed in this audit.
Environment: Node `v22.22.1`, npm `10.9.4`, FFmpeg/ffprobe `9.0.2`.

## Results

| Command | Outcome |
|---|---|
| `npm test` | PASS — package validation, timing, Gemini guard/request mapping, cache key, quota logic. |
| `npm run smoke:api` | PASS — temporary SQLite API, import/idempotency, ffprobe upload, delete cleanup, shared audio retention, rolling quota persists after delete. |
| `npm run smoke:tts` | PASS — mock-only Test Voice/full preview/cache/approval/stale rejection/render protection; MP4 H.264 + audible AAC, 3.05 sec. Mock output is a sine tone, **not speech**. |
| `npm run smoke:render` | PASS — 2 sec, 360×640, H.264 + AAC; SHA-256 `54c8c3e1901a18cddfd80555af4f32984e77d52679f23235fd0ba60d5d710d87`. |
| `npm run typecheck` | PASS. |
| `npm run build` | PASS; Zod comment-annotation and >500 KB JS chunk warnings remain. |
| `npm audit` | PASS — 0 vulnerabilities. |
| `GEMINI_TTS_LIVE_TEST=1 npm run smoke:gemini-live` | PASS — one live Test Voice synthesis. Provider `gemini-developer-api`; model `gemini-3.8-flash-lite-tts`; live catalog; voice `achernar`; requested locale `id-ID`; 9.68 sec; 155,948 bytes; MP3; cache miss. ffprobe and playback URL checked; no human listening/voice-quality review. No project created/audio attached. One synthesis attempt recorded in configured `DATA_DIR`. |

`npm run render -- samples/mountain-formation.json` was **not** rerun in this audit. Earlier V1.0 evidence: 56.042667 sec, 1080×1920, H.264 + silent AAC, 6,513,583 bytes.

## Keep mock and live evidence separate

- `npm run smoke:tts` uses test-only mock provider; output is synthetic tone. It verifies approval, snapshot, and render mechanics—not Gemini speech quality.
- Live command is opt-in; it requires `GEMINI_TTS_LIVE_TEST=1`, a configured key, and `GEMINI_TTS_FREE_TIER_ONLY=true`. It uses built-in sample only, no project/full narration, and consumes quota on cache miss.
- This audit live-tested catalog + Test Voice + MP3 normalization/ffprobe. It did **not** live-test full narration, approval, or Gemini-backed video rendering.
- `GEMINI_TTS_FREE_TIER_ONLY=true` is a user assertion. API cannot discover linked billing; no claim of zero charges or project billing state.

## Cleanup and concurrency

Deletion transaction removes project/job/render-attempt rows and writes upload/snapshot/MP4 cleanup entries atomically. Queue retries on startup and every 60 sec; shared content-addressed job/TTS audio stays cached. API smoke verifies normal cleanup and shared-audio retention. Locked-file/permission failure and timer retry were **not** fault-injected, so cleanup-retry failure path is code-reviewed, not runtime proven.

Legacy job rows still present are copied into rolling-usage history at startup. Jobs/projects deleted before this migration have no recoverable usage timestamp.

## GitHub Actions

Workflow was reviewed but not manually dispatched: `gh` CLI unavailable here. No run ID, artifact, or cloud-render evidence was collected. Workflow remains limited to committed JSON and does not invoke local project/audio transport. See [`GITHUB_ACTIONS_SETUP.md`](GITHUB_ACTIONS_SETUP.md).

## Renderer limits

`visualPreset`, `visualDescription`, and `motionCues` currently do not control output; `sfxCues` has no playback path. Some template IDs alias default artwork. See field matrix and V1.1 recommendations in [`VIDEO_PIPELINE.md`](VIDEO_PIPELINE.md).

Other limits: captions are per-scene, not word-aligned; caches have no retention UI; no GitHub dispatch/download integration; app defaults to loopback but `HOST` can override it—keep it on `127.0.0.1`. Gemini key remains server-only and must never enter browser/config bundle.
