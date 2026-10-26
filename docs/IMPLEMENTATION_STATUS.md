# AI Facts Studio V1.0.4 — implementation status

Baseline HEAD `e230bab` includes V1.0.4 and corrected AI Generation Settings. Research/Storyboard and OpenCode changes remain uncommitted. Baseline matrix verified 24 Oct 2026; V1/V2 provider, API, and live OpenCode checks rerun 26 Oct on Windows x64, Node `v22.22.1`, npm `10.9.4`, FFmpeg/ffprobe `9.0.2`.

## Implemented

- Gemini preview remains pending until explicit **Gunakan Audio Ini**. Prior upload stays active until approval; script edits invalidate pending preview and stale TTS audio cannot create a current snapshot.
- Approval persists voice/settings, script/audio SHA, source, and approval timestamp. Immutable snapshots carry approved audio provenance and verify source SHA before render.
- FFmpeg `volumedetect` and ffprobe validate expected AAC, audio/video duration, non-silence, and peak headroom. Silent/too-quiet or clipped narration, duration mismatch, or changed source audio fails render. Silent output requires explicit UI/API confirmation.
- Manifest records renderer/video/audio codec, dimensions/duration, video/audio hashes, source/provider/model/cache/script identity, voice/settings/approval timestamp, mean/peak level, and audio-validation result. No API key or narration text included.
- UI distinguishes pending preview, approved audio, stale snapshot, rendering/success/failure, and video without narration; TTS rolling quota is visible. Render never starts automatically after TTS.
- Workspace follows six gated steps: Materi & Storyboard, Visual Storyboard, Narasi, Review & Subtitle, Preview Motion, and Render & Download. Progress resumes per project but cannot skip incomplete review gates.
- Interactive Player uses current draft and approved audio without creating snapshot/job or consuming video quota. Explicit final render is only snapshot/job entry point. Preview review is tied to storyboard/audio fingerprint; edits invalidate it.
- Research edits invalidate author verification. Gemini voice catalog loads only after explicit user action; TTS is not triggered by navigation.
- AI Generation Settings persists Development/Production separately from `NODE_ENV`, deployment, and TTS; user selects mode manually, with no auto fallback. Development uses existing authenticated OpenCode V1/V2 isolation. Production reads backend `.env` without exposing key, keeps explicit Free Tier attestation, and monitors per-model local RPM/RPD/observed TPM using request/token records. Operator can set optional project limits from AI Studio; official remaining quota is never fabricated. Gemini 429 reports metric/retry time when Google supplies them. TTS and render quotas remain separate. Source URLs remain user-provided. Model-generated art remains unavailable; local deterministic illustration library supports curated compositions and flags unknown concepts for authoring. Optional scene-level AI semantic plans use selected text model only after explicit click; validated plans are cached and consumed by local composer.
- User illustrations are project-scoped PNG/JPEG/WebP with signature/MIME/size/dimension/hash checks, ownership validation, hash verification at render, and reference-aware cleanup. SVG unsupported; human fit confirmation and separate approval required. Storyboard status `ready_for_review` never auto-approves.
- Gemini Text allowlist rechecked against Google's official catalog/pricing: `gemini-3.8-flash` retained, `gemini-3.5-flash-lite` default; invalid `gemini-3.8-flash-lite` removed. Gemini TTS model/allowlist unchanged. Blank inherited Gemini Text environment values now fall back to non-empty `.env` values; non-empty process values win and Free Tier guard is never auto-enabled.
- Live full-narration command is opt-in and staged: one preview request → user listen/approval → snapshot/Player review → explicit render confirmation. Standard tests do not invoke it.

## Automated validation

| Check | Result |
|---|---|
| `npm test` | PASS — migration/schema/audio, renderer-aware safe area, raster signature/dimensions, semantic-plan schema/cache, OpenCode ID deduplication, AI quota/provider checks, storyboard gates, motion and TTS regressions. |
| `npm run typecheck` | PASS. |
| `npm run smoke:api` | PASS — prior API checks plus raster upload/MIME spoof rejection, project ownership, static serving, persistence, approval gate, and reference cleanup. No live planner request. |
| `npm run smoke:tts` | PASS — Development/Production preference persists across restart without changing pending audio, approval, or rendered job; mock TTS covers active-upload preservation, settings/script edits, immutable snapshot, AAC validation. Mock is sine tone, not speech. |
| `npm run smoke:render` | PASS — V1/V2 H.264/AAC and snapshot audio integrity. |
| `npm run smoke:samples` | PASS — Mountain, Lightning, Sea Salt silent MP4s, H.264 1080×1920, 56.04/24.04/32.04 sec. Reports tag `silent-expected`. |
| `npm run smoke:samples-audio` | PASS — all 3 samples render with FFmpeg sine fixture marked `mock-fixture` (not speech), AAC mean −24.1 dB, clipping/duration validated. |
| `npm run test:visual` | PASS — 86 golden frames: templates, presets, cues, lightning, seven mountain scenes, five salt scenes, five Earth scenes, transitions. |
| `npm run smoke:visual-storyboard` | PASS — browser review/motion preview, persistence/reopen, stale-approval rejection; no duplicate-key warnings. |
| `npm run build` | PASS; existing Zod annotation and bundle-size warnings. |
| `npm audit` | PASS — 0 vulnerabilities. |

Review artifacts: silent outputs + ffprobe/audio reports in `renders/v1.0.4-review/final-silent/`; latest fixture-audio outputs in `renders/v1.0.4-review/mock-audio-qa-final/`. Fixture audio is tone, not speech.

## Live Gemini status — incomplete production acceptance

- Key available, allowlisted model and Free Tier guard active. Operator confirmed no billing link; billing linkage cannot be independently queried by the API.
- **Live full-narration preview PASS:** one cache-miss request for Mountain via `gemini-developer-api`, model `gemini-3.8-flash-lite-tts`, voice Achernar / `id-ID`. Real MP3: 43.2 sec, 692,012 bytes, SHA-256 `9bd0c65688a73c72135beaa72bee8e5dd64d4580a99135390f5071ee0a497bb6`, mean −17.3 dB, peak −1.9 dB. Saved under `renders/v1.0.4-review/gemini-live/`; no key or script text in report.
- User listened and approved preview in UI; approval timestamp persisted at `2026-10-24T14:32:46.155Z`. `continue` re-read and verified approval, cache key, script/audio SHA, voice/settings, then stopped before snapshot because quota is full.
- **Final live MP4 BLOCKED:** production video quota is 1/1 used; next slot `2026-10-25T06:07:43.578Z`. No quota reset, snapshot/job/render, or second synthesis. After quota opens, run `continue`, inspect Player preview, then `render` with explicit review confirmation.
- Preview listening/approval is user-confirmed. Final MP4 listening review remains after mux. `smoke:gemini-live` Test Voice was not run to avoid an extra live synthesis.

## Limits

- OpenCode V2 `2.1.4` live status returned 493 models, including authorized `openai/gpt-6-luna`. One explicit AI Facts Studio request with that exact model returned a validated five-scene storyboard; isolated session/process/temp cleanup succeeded. No fallback or Gemini call. Claims still require human review.
- Gemini can draft Research/Storyboard from free-form topics; user review remains mandatory. Local Art Director maps supported concepts to reusable compositions; vocabulary coverage is limited and visual/scientific review remains manual.
- Captions are phrase/scene estimates, not word-aligned. Audio loudness/clipping checks do not perform speech recognition.
- SFX playback/mixing remains absent. Golden hashes target local Windows/Chrome/font rasterization; cleanup fault injection and GitHub Actions dispatch remain untested.
