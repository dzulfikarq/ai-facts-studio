# AI Facts Studio V1.0.1 — implementation status

Audit baseline: repository HEAD `8e0bbdc`; stabilization worktree. Verification executed 24 Oct 2026 on Windows x64.
Environment: Node `v22.22.1`, npm `10.9.4`, FFmpeg/ffprobe `9.0.2`.

## Implemented

- Local-first React/Vite + Express + SQLite application; API defaults to `127.0.0.1`. Gemini key stays server-side.
- Research Package v1.0 validation, manual audio upload, deterministic Remotion templates, immutable job snapshots, local H.264/AAC render.
- Gemini Free-Tier model guard, prebuilt voice catalog/fallback, cached Test Voice, full-narration preview and explicit audio approval.
- Project deletion uses one SQLite transaction for project/jobs/render attempts and a durable cleanup queue for uploads, snapshots, and MP4 directories. Cleanup retries on startup and every 60 seconds. Shared content-addressed `audio/jobs` and `audio/tts` caches are retained on project deletion.
- Rolling video-job usage is stored separately from projects/jobs, so deleting a project cannot restore quota. Migration backfills still-present legacy jobs; usage from projects deleted before V1.0.1 is unrecoverable.

## Tested in V1.0.1 audit

| Check | Result / evidence |
|---|---|
| `npm test` | PASS — schema, timing, Gemini SDK request/guard, cache key, rolling limit. |
| `npm run smoke:api` | PASS — production UI/API, import/idempotency, upload/probe, project/job/snapshot/MP4 cleanup, shared audio retention, usage quota remains after deletion. |
| `npm run smoke:tts` | PASS — mock Test Voice/cache, full preview, stale-preview rejection, explicit approval, active-render deletion guard, estimated timing, H.264 + audible AAC MP4 (3.05 sec). Mock audio is a sine tone, not speech. |
| `npm run smoke:render` | PASS — 2 sec, 360×640, H.264 + AAC; SHA-256 `54c8c3e1901a18cddfd80555af4f32984e77d52679f23235fd0ba60d5d710d87`. |
| `npm run typecheck` | PASS. |
| `npm run build` | PASS. Vite emits existing Zod annotation warnings and JS chunk warning (>500 KB; 552.81 KB). |
| `npm audit` | PASS — 0 vulnerabilities. |
| Live Gemini Test Voice | PASS — one uncached live synthesis; details in [`TTS_SETUP.md`](TTS_SETUP.md). Did not create project or attach audio. |

Cleanup queue drain after normal deletion was tested. OS-level locked-file/permission-failure injection and timer retry were not performed; retry-on-failure path is implemented but not fault-injection tested.

## Partially tested

- Gemini live evidence covers catalog lookup, one short Indonesian Test Voice request, WAV→MP3 normalization, playback URL, and ffprobe only. Full-narration live synthesis, user approval, and live-Gemini-backed render were **not** tested; those complete-path checks use mock provider.
- `GEMINI_TTS_FREE_TIER_ONLY=true` is an operator guard, not a Google billing detector. API cannot verify whether project billing is linked; no claim of zero billing is made.
- GitHub workflow was reviewed but not manually dispatched. `gh` CLI unavailable; no Actions run/artifact evidence from this audit.
- UI code builds; no browser-driven visual/accessibility test was performed.

## Deferred / known limits

- `visualPreset`, `visualDescription`, and `motionCues` are accepted/editor-visible but do not change renderer output. `sfxCues` is schema-only; no SFX asset/playback path.
- Several template IDs share one artwork branch; see [`VIDEO_PIPELINE.md`](VIDEO_PIPELINE.md).
- No GitHub dispatch/status/download path, forced word alignment, cleanup/cache retention policy, or live full-narration proof.
- Full 56-second mountain render was verified in earlier V1.0 work (56.042667 sec, 1080×1920, H.264 + silent AAC, 6,513,583 bytes, SHA-256 `13ae92c00376c080a021c04df7f8fce5c82307ba4f34099a9d7665a03f970426`); not rerun in this audit.

## V1.1 technical direction

Make preset/template/motion behavior deterministic and explicit: renderer registry per template ID, typed visual preset configs, allowlisted cue-to-keyframe mapping, then licensed/timed SFX. Keep imported descriptions declarative, never evaluate markup/code. Add frame-level golden tests before expanding templates. Details in [`VIDEO_PIPELINE.md`](VIDEO_PIPELINE.md).
