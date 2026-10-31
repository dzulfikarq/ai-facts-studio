# AI Facts Studio V1.0.4 — implementation status

Baseline HEAD `54b343f` includes V1.0.4, AI Research/Storyboard, and workspace redesign. Current Smart Asset Library, rainbow sample, OpenCode changes, and related evidence remain uncommitted. Baseline matrix verified 24 Oct 2026; V1/V2 provider, API, and live OpenCode checks rerun 26 Oct on Windows x64, Node `v22.22.1`, npm `10.9.4`, FFmpeg/ffprobe `9.0.2`.

## Implemented

- Gemini preview remains pending until explicit **Gunakan Audio Ini**. Prior upload stays active until approval; script edits invalidate pending preview and stale TTS audio cannot create a current snapshot.
- Approval persists voice/settings, script/audio SHA, source, and approval timestamp. Immutable snapshots carry approved audio provenance and verify source SHA before render.
- FFmpeg `volumedetect` and ffprobe validate expected AAC, audio/video duration, non-silence, and peak headroom. Silent/too-quiet or clipped narration, duration mismatch, or changed source audio fails render. Silent output requires explicit UI/API confirmation.
- Manifest records renderer/video/audio codec, dimensions/duration, video/audio hashes, source/provider/model/cache/script identity, voice/settings/approval timestamp, mean/peak level, and audio-validation result. No API key or narration text included.
- UI distinguishes pending preview, approved audio, stale snapshot, rendering/success/failure, and video without narration; TTS rolling quota is visible. Render never starts automatically after TTS.
- Workspace follows six gated steps: Materi & Storyboard, Narasi, Video Editor, Review, Preview Video, and Render & Download. One Video Editor exposes Visual, Gerak, Klip, Teks, Transisi, and Audio tabs. Legacy Visual Storyboard/Edit Video routes and stored step aliases resolve to Video Editor. Progress resumes per project but cannot skip incomplete approval/review gates.
- Interactive Player uses current draft and approved audio without creating snapshot/job or consuming video quota. Explicit final render is only snapshot/job entry point. Preview review is tied to storyboard/audio fingerprint; edits invalidate it.
- Research edits invalidate author verification. Gemini voice catalog loads only after explicit user action; TTS is not triggered by navigation.
- AI Generation Settings persists Development/Production separately from `NODE_ENV`, deployment, and TTS; user selects mode manually, with no auto fallback. Development uses existing authenticated OpenCode V1/V2 isolation. Production reads backend `.env` without exposing key, keeps explicit Free Tier attestation, and monitors per-model local RPM/RPD/observed TPM using request/token records. Operator can set optional project limits from AI Studio; official remaining quota is never fabricated. Gemini 429 reports metric/retry time when Google supplies them. TTS and render quotas remain separate. Source URLs remain user-provided.
- Optional Hugging Face Inference Providers adapter is disabled by default; requires server `HF_TOKEN`, `HF_IMAGE_GENERATION_ENABLED=true`, `HF_IMAGE_ALLOW_PAID=true`, live `hf-inference` model verification, and per-image custom cost confirmation. Prompt/settings are editable; each confirmed request creates one local content-addressed candidate, then user previews and explicitly applies with safe `contain` default or `cover`. Cost/credit balance and generated-output license remain unverifiable. AI Vector remains explicit OpenCode authoring, separate from image APIs. Local deterministic illustration library supports curated compositions and flags unknown concepts for authoring. Optional scene-level AI semantic plans use selected text model only after explicit click; validated plans are cached and consumed by local composer.
- PNG/JPEG/WebP assets are content-addressed and reusable across project metadata associations. Upload checks signature/MIME, decoded dimensions, hash, and project ownership; FFmpeg may optimize to WebP. Snapshot/render hashes and scene/snapshot reference checks protect shared files. SVG unsupported; human concept-fit/provenance confirmation and separate approval required. Storyboard status `ready_for_review` never auto-approves.
- Gemini Text allowlist rechecked against Google's official catalog/pricing: `gemini-3.8-flash` retained, `gemini-3.5-flash-lite` default; invalid `gemini-3.8-flash-lite` removed. Gemini TTS model/allowlist unchanged. Blank inherited Gemini Text environment values now fall back to non-empty `.env` values; non-empty process values win and Free Tier guard is never auto-enabled.
- Live full-narration command is opt-in and staged: one preview request → user listen/approval → snapshot/Player review → explicit render confirmation. Standard tests do not invoke it.

## Automated validation

| Check | Result |
|---|---|
| `npm test` | PASS — 8 sample packages, SQLite asset/Tabler FTS, sanitized SVG, Openverse allowlist and SSRF IP checks, migration/schema/audio, renderer-aware safe area, raster validation, route/workflow aliases and six-step guards, Smart Hybrid reusable-object/relation scoring and conservative raster fallback, mocked HF catalog/provider, consent/rate/quota mapping, river/ozone prompts, AI Vector scene prompt/cache, planner cache, storyboard gates, motion/TTS regressions. |
| `npm run typecheck` | PASS. |
| `npm run smoke:api` | PASS — raster upload/MIME spoof rejection, ownership/approval guards, Tabler metadata search/import/MIT attribution, reusable-scene lifecycle, Smart Hybrid batch idempotency/progress/reopen/approval preservation, credits CSV, unselected Openverse import rejection, static serving, persistence, and reference cleanup. No live planner request. |
| `npm run smoke:tts` | PASS — Development/Production preference persists across restart without changing pending audio, approval, or rendered job; mock TTS covers active-upload preservation, settings/script edits, immutable snapshot, AAC validation. Mock is sine tone, not speech. |
| `npm run smoke:render` | PASS — V1/V2 H.264/AAC and snapshot audio integrity. |
| `npm run smoke:samples` | PASS — Mountain, Lightning, Sea Salt silent MP4s, H.264 1080×1920, 56.04/24.04/32.04 sec. Reports tag `silent-expected`. |
| `npm run smoke:samples-audio` | PASS — all 3 samples render with FFmpeg sine fixture marked `mock-fixture` (not speech), AAC mean −24.1 dB, clipping/duration validated. |
| `npm run test:visual` | PASS — 86 existing golden hashes matched: templates, presets, cues, lightning, seven mountain scenes, five salt scenes, five Earth scenes, transitions. |
| `npm run smoke:visual-storyboard` | PASS — Smart Hybrid unified UI/progress/selective retry/reopen, Needs Attention fallback, accessible 390px source dialog; sea-salt and rainbow batch jobs process 5/5 already-ready scenes without changing artwork; contact sheets, per-scene stills, silent H.264/AAC review MP4s, renderer V2. Also verifies Earth/sea-salt/rainbow screens, reusable river scene, Tabler import, Openverse search (irrelevant results; no import), synthetic raster (not AI), approval, snapshot protection, Motion Preview, persistence, and stale-approval rejection. |
| `npm run smoke:video-editor` | PASS — six-step routing/history and legacy aliases, six Inspector tabs, desktop/mobile widths, visual repair/approval, Motion Beats, transitions, preview, and MP4 fixture render. |
| `npm run smoke:scene-media` | PASS — MP4/GIF playback and final render; trim, transition, and overlay edits preserve visual approval. |
| `npm run smoke:ai-image` | PASS — all Hugging Face traffic intercepted; missing consent reaches no image request, one confirmed mock image persists/hash-validates, reuses cross-project, applies without old approval, and renders same local file in 360×640 Remotion MP4. Synthetic FFmpeg fixture, not educational AI art; no live/paid call. |
| `npm run build` | PASS; existing Zod annotation and 936.27 kB client-chunk warnings. |
| `npm audit` | PASS — 0 vulnerabilities. |

Review artifacts: silent outputs + ffprobe/audio reports in `renders/v1.0.4-review/final-silent/`; latest fixture-audio outputs in `renders/v1.0.4-review/mock-audio-qa-final/`. Fixture audio is tone, not speech.

## Live Gemini status — incomplete production acceptance

- Key available, allowlisted model and Free Tier guard active. Operator confirmed no billing link; billing linkage cannot be independently queried by the API.
- **Live full-narration preview PASS:** one cache-miss request for Mountain via `gemini-developer-api`, model `gemini-3.8-flash-lite-tts`, voice Achernar / `id-ID`. Real MP3: 43.2 sec, 692,012 bytes, SHA-256 `9bd0c65688a73c72135beaa72bee8e5dd64d4580a99135390f5071ee0a497bb6`, mean −17.3 dB, peak −1.9 dB. Saved under `renders/v1.0.4-review/gemini-live/`; no key or script text in report.
- User listened and approved preview in UI; approval timestamp persisted at `2026-10-24T14:32:46.155Z`. `continue` re-read and verified approval, cache key, script/audio SHA, voice/settings, then stopped before snapshot because quota is full.
- **Final live MP4 BLOCKED:** production video quota is 1/1 used; next slot `2026-10-25T06:07:43.578Z`. No quota reset, snapshot/job/render, or second synthesis. After quota opens, run `continue`, inspect Player preview, then `render` with explicit review confirmation.
- Preview listening/approval is user-confirmed. Final MP4 listening review remains after mux. `smoke:gemini-live` Test Voice was not run to avoid an extra live synthesis.

## Phase 2 illustration evidence — 27 Oct 2026

- AI Vector prism PoC: `artifacts/ai-vector-prism-poc-2026-10-26T15-39-54-916Z/`; white light, triangular prism, seven spectrum rays; Storyboard/Remotion hashes match; status remains `needs_review`.
- Raster integration evidence: `artifacts/visual-storyboard-phase2/`; synthetic FFmpeg test pattern explicitly marked **not AI**. Proves prompt builder, validated import/optimization, cross-project reuse, human review/approval, immutable snapshot protection, Motion Preview, and MP4 frame.
- Phase 2 predated AI Image adapter; no external AI-generated raster was supplied in that phase. See current mock verification below.

## Hybrid AI Image V1 verification — 27 Oct 2026

- `npm test` mocks official Hub model mappings and provider image/error responses. `npm run smoke:ai-image` intercepts all Hugging Face network requests and verifies per-image consent, one generation request, local SHA-256 asset persistence and metadata, cross-project attach without regeneration, explicit storyboard apply, approval invalidation, and Remotion render from the same local file.
- Mock image uses FFmpeg color/shapes only. It proves transport/persistence/reuse/render integration, **not image quality or educational accuracy**. River-to-sea mineral and ozone-to-UV prompts are asserted in tests; no AI-generated science illustration was produced.
- Live image generation was not run. Provider remains disabled unless configured and per-call confirmed. HF price/balance/remaining credits and generated-output license cannot be verified; no paid request or fallback occurred.

## Smart Asset Library and rainbow acceptance — 27 Oct 2026

- Smart Asset Library V1 uses existing SQLite/FTS and `public/visual-assets`; supports filtered/paginated local search, pinned Tabler `3.49.0` metadata/sanitized SVG import with MIT notice, reusable-scene save/search/copy, local reference counts, credits CSV, and selectable image fit/position. No new runtime dependency beyond pinned Tabler package.
- Automated API test covers Tabler search/import, reusable scene save/attach/source immutability, credits, and cleanup. Openverse selection is fail-closed to active search results; import re-fetches and checks license, DNS/SSRF, size, MIME/signature, and decoded raster before local copy.
- Openverse was live-searched: API returned two records for `river to ocean illustration`, but both were unrelated vehicle/boat drawings. Latest screenshot rendered one thumbnail while the other stayed blank (an earlier browser run saw thumbnail-proxy HTTP 502); direct follow-up fetch returned validated WebP for both cached records. No result was selected/imported. **Relevant illustration acceptance remains blocked**; no image-quality, attribution, or Openverse MP4 claim is made.
- `samples/bagaimana-pelangi-terbentuk.json` adds five NWS-cited, manually authored vector scenes. Rain droplets—not a prism or standalone icon—show refraction, one internal reflection, color separation, and observer/sun/rain geometry. Browser preview and local 360×640 H.264 MP4/frame captured; all five scenes stay unapproved.

## Smart Hybrid workflow acceptance — 27 Oct 2026

- Unified **Siapkan Ilustrasi → Review → Approve → Render** UI now has durable per-project SQLite batch jobs, serial processing, request-hash idempotency, restart recovery, persisted progress, selective retry, per-scene outcomes, and re-open status. Manual/approved/confirmed/AI Vector/image scenes and already-ready scenes are never overwritten by a batch. Unsupported concepts remain Needs Attention; no forced fallback.
- Smart Hybrid prefers structured reusable-scene matches (objects, visible relationships, art style/palette, provenance, local asset availability/license), then high-confidence object illustration only when no process relationship is required, then the local composer. Weak semantic or license match is rejected. AI Vector is still explicit and receives scene/plan/art-direction context. AI Image is never auto-invoked.
- Browser smoke proves progress, selective retry, reopening, unknown-concept Needs Attention, and responsive accessible source dialog. Screenshots: `artifacts/visual-storyboard-phase2/smart-hybrid-unified-workflow.png`, `smart-hybrid-batch-progress.png`, `smart-hybrid-needs-attention.png`, `smart-hybrid-selective-retry.png`, `smart-hybrid-batch-reopened.png`, `smart-hybrid-source-picker-mobile.png`.
- Sea-salt job: 5/5 processed, 5 ready for review, 0 attention/failure/approved. Rainbow job: same. Both had suitable existing local art; batch preserved every composition and approval fingerprint—**no new Smart Hybrid illustration was generated**. Latest verified visual evidence and manifests: `artifacts/visual-storyboard-phase2/smart-hybrid-acceptance-2026-10-27T06-14-32-614Z/` and `...T06-15-14-025Z/`. Each contains storyboard/job JSON, five scene frames, contact sheet, and silent H.264/AAC renderer-V2 review MP4 (378×672, 32.04 sec). All scenes remain unapproved; rainbow art is manually authored; MP4s are silent, not narration acceptance.
- Live AI Image is not validated: no token, explicit paid-use authorization, or dependable account balance/price data. Synthetic FFmpeg raster tests are transport/render fixtures only. Current Openverse live results for river-to-ocean remained irrelevant; no image selected.

## Limits

- OpenCode V2 `2.1.4` live status returned 493 models, including authorized `openai/gpt-6-luna`. One explicit AI Facts Studio request with that exact model returned a validated five-scene storyboard; isolated session/process/temp cleanup succeeded. No fallback or Gemini call. Claims still require human review.
- Gemini can draft Research/Storyboard from free-form topics; user review remains mandatory. Local Art Director maps supported concepts to reusable compositions; vocabulary coverage is limited and visual/scientific review remains manual.
- Captions are phrase/scene estimates, not word-aligned. Audio loudness/clipping checks do not perform speech recognition.
- SFX playback/mixing remains absent. Golden hashes target local Windows/Chrome/font rasterization; cleanup fault injection and GitHub Actions dispatch remain untested.
