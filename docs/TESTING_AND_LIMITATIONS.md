# Testing and limitations — V1.0.4

Baseline matrix verified 24 Oct 2026 on Windows x64, Node `v22.22.1`, npm `10.9.4`, FFmpeg/ffprobe `9.0.2`. Baseline HEAD `54b343f`; Smart Asset Library, rainbow sample, Smart Hybrid workflow, OpenCode changes, and related evidence remain local/uncommitted. Final serial visual-regression run matched all 86 existing hashes; no golden baseline update needed.

## Automated results

| Command | Result |
|---|---|
| `npm test` | PASS — 7 sample packages, SQLite Asset Library/Tabler FTS and SVG sanitization, license allowlist, SSRF IP blocks, renderer-aware safe-area geometry, raster signature/dimensions, Smart Hybrid reusable object/relation score and conservative raster fallback, scene-aware AI Vector prompt/cache, semantic-plan schema/cache, mocked HF catalog/provider, consent/rate/quota handling, river/mineral and ozone/UV prompts, storyboard gates, motion and TTS regressions. |
| `npm run typecheck` | PASS. |
| `npm run smoke:api` | PASS — raster upload/MIME spoof rejection, ownership and approval guards, bounded Tabler search/sanitized SVG import/MIT attribution, reusable-scene save/search/attach, Smart Hybrid batch idempotency/progress/reopen/approval preservation, credits CSV, unselected Openverse import rejection, static serving, persistence, and reference cleanup. No live planner call. |
| `npm run smoke:tts` | PASS — mode switch/restart leaves TTS preview, approval, and rendered job intact; mock preview/cache/approval, old upload preservation, settings/script edits, snapshot immutability, AAC checks. Tone fixture, not speech. |
| `npm run smoke:render` | PASS — V3, previous V2 (without semantic motion fields), and legacy V1 H.264/AAC with snapshot SHA validation. |
| `npm run smoke:samples` | PASS — all 3 acceptance packages, silent-expected AAC, H.264 1080×1920, 56.04/24.04/32.04 sec. |
| `npm run smoke:samples-audio` | PASS — all 3 acceptance packages with `mock-fixture` sine audio; non-silent AAC, mean −24.1 dB, safe peak and aligned duration. Not speech. |
| `npm run test:visual` | PASS — 86 existing golden hashes matched: templates, presets, cues, lightning, seven mountain scenes, five salt scenes, five Earth scenes, transitions. |
| `npm run smoke:visual-storyboard` | PASS — Smart Hybrid UI and lifecycle; persisted Motion Director cancel/retry; keyboard frame seek; 390px Motion Preview bounds; synthetic raster review, approval, snapshot protection, and Remotion MP4/frame. Evidence output uses isolated `artifacts/motion-director-poc/ui-*` directory. |
| `npm run smoke:ai-image` | PASS — test-only fetch interceptor mocks HF catalog and one image response; missing consent makes no generation request, confirmed request persists local hashed asset/metadata, reuses across projects, applies without old approval, and renders same local file to 360×640 H.264. Fixture is synthetic FFmpeg color/shapes, not educational art; no live HF call. |
| `npm run build` | PASS; existing Zod annotation and 828.53 kB client-chunk warnings. |
| `npm audit` | PASS — 0 vulnerabilities. |

Review MP4s/manifests/ffprobe/audio reports: `renders/v1.0.4-review/final-silent/` and `renders/v1.0.4-review/mock-audio-qa-final/`. The latter contains test tones explicitly tagged `mock-fixture`.

## Live provider result

One authorized live full-narration preview generated through Gemini Free Tier, cache miss: Mountain, Achernar, MP3 43.2 sec, SHA-256 `9bd0c65688a73c72135beaa72bee8e5dd64d4580a99135390f5071ee0a497bb6`, mean −17.3 dB, peak −1.9 dB. User listened and approved in UI; approval timestamp persisted. Files: `renders/v1.0.4-review/gemini-live/`. Billing-free status is operator-attested, not API-verifiable.

Full live MP4 is **blocked by quota**, not passed: production video quota is 1/1, next slot `2026-10-25T06:07:43.578Z`. `continue` verified persisted approval, then stopped before snapshot/job. No quota reset, render, or repeat synthesis. After reset, review Player preview and explicitly authorize `render`. Automated levels do not prove spoken content correctness.

## Illustration PoCs and Phase 2 evidence — 26–27 Oct 2026

Latest output: `artifacts/visual-poc-review-2026-10-26/`. Five-scene sea-salt and five-scene Earth Storyboards; both gate reports have zero issues and `approvedScenes: 0`. Includes full-resolution silent 1080×1920 review MP4s/manifests, per-scene stills, contact sheets, motion previews, and legacy generic-card before/after. UI screenshots: `artifacts/visual-review-2026-10-26/ui/`. Renderer regression frames: `artifacts/visual-review-2026-10-26/visual-regression/`.

Visual review: salt scenes show ocean ions, rain weathering, mountain→river→sea mineral flow, evaporation, and bounded salinity. Earth scenes distinguish Sun/Earth, atmosphere, ozone/UV absorption, magnetosphere/charged-particle deflection, then summarize separate protection mechanisms. Preview and Remotion renders share composition renderer. POC outputs are silent; they prove visual/motion rendering, not narration. Gate readiness does not grant approval or prove science/aesthetic quality. Uploaded images require human fit confirmation and separate approval. AI semantic planner schema/cache are unit-tested; no live planner request was made.

AI Vector prism proof: `artifacts/ai-vector-prism-poc-2026-10-26T15-39-54-916Z/`; seven spectrum rays are specified and storyboard/Remotion hashes match. Gate is `needs_review`, not approved. Phase 2 raster workflow artifacts: `artifacts/visual-storyboard-phase2/`. Browser smoke used an FFmpeg `testsrc2` fixture, labeled **not AI**, to verify upload/optimization, cross-project reuse, approval, snapshot SHA protection, Motion Preview and MP4 rendering. Smart Asset Library API smoke verifies Tabler SVG sanitization/import and attribution, reusable-scene lifecycle, credits export, and reference-safe cleanup. Openverse live search returned two actual records for `river to ocean illustration`, but both were unrelated vehicle/boat drawings. Latest screenshot rendered one thumbnail; the other stayed blank (one earlier browser run logged thumbnail-proxy HTTP 502), while a follow-up backend fetch validated WebP for both cached URLs. No Openverse item was selected or imported; relevant-image/license/reuse/render acceptance remains unverified. New rainbow package `samples/bagaimana-pelangi-terbentuk.json` has five NWS-cited hand-authored vector scenes showing water droplets, sunlight, refraction, one internal reflection, spectrum, and viewing geometry—no prism/icon substitution. Storyboard preview and 360×640 H.264 smoke MP4/frame are in `artifacts/visual-storyboard-phase2/rainbow-water-droplet-*`; scenes remain unapproved. No externally generated AI raster was supplied, so AI Image generation/import PoC remains unproven. Current image-provider registry is empty; no paid image API was invoked.

## Hybrid AI Image V1 status — 27 Oct 2026

The Phase 2 note above predates the new adapter and is historical. Current `npm test` mocks the official-Hub model mapping and provider response. `npm run smoke:ai-image` intercepts all Hugging Face traffic and proves per-image consent, exactly one provider request, local content-addressed persistence, cross-project reuse, explicit storyboard apply, approval invalidation, and Remotion render from the same file. FFmpeg color/shape fixture is synthetic, **not AI output or educational artwork**; smoke deletes its temporary render. River-to-sea mineral transport and ozone-to-UV filtering prompts are tested, but suitable AI-generated illustrations for either scene remain unproven.

Live image generation was not run. No HF token/operator authorization or reliable account price/balance data was available; no paid image call or fallback occurred. Provider remains disabled unless server has `HF_TOKEN`, `HF_IMAGE_GENERATION_ENABLED=true`, and `HF_IMAGE_ALLOW_PAID=true`; each image additionally needs custom UI cost confirmation. Price, remaining credits/quota, and generated-output license cannot be independently verified.

## Smart Hybrid batch acceptance — 27 Oct 2026

- Latest sea-salt evidence: `artifacts/visual-storyboard-phase2/smart-hybrid-acceptance-2026-10-27T06-14-32-614Z/`. Rainbow evidence: `...T06-15-14-025Z/`. Each contains persisted job report, final storyboard JSON, five extracted scene frames, contact sheet, silent review MP4, and render manifest.
- Both real sample projects finished `completed`: 5/5 scenes processed, 5 `ready_for_review`, 0 `needs_attention`, 0 failed, 0 approved. Their local artwork already passed authoring; jobs returned `source: preserved`, and before/after compositions and approval fingerprints matched. This proves safe batch orchestration and render handoff, **not** fresh Smart Hybrid selection or newly generated art.
- Sea salt uses existing local curated/library compositions; rainbow uses hand-authored vector/drop-scene sample art. Visual inspection of contact sheets confirms each topic's intended scene sequence. H.264/AAC outputs use renderer V2, 378×672, 32.04 sec; AAC is silent (`silent-expected`). Not production-resolution/narration acceptance. All ten scenes require separate human approval.
- UI screenshots: `artifacts/visual-storyboard-phase2/smart-hybrid-unified-workflow.png`, `smart-hybrid-batch-progress.png`, `smart-hybrid-needs-attention.png`, `smart-hybrid-selective-retry.png`, `smart-hybrid-batch-reopened.png`, `smart-hybrid-source-picker-mobile.png`. Unsupported-topic fixture stays Needs Attention after retry; no irrelevant visual is forced. API smoke covers duplicate request replay, request-hash conflict, and preserving an approved scene.

## Remaining limits

- Model drafts/plans are not fact-checked. No source URL retrieval/grounding occurs; claims stay unverified unless manually reviewed. Local visual library has limited keyword coverage; semantic planner is text-only and does not generate art.
- Caption timing remains phrase-level estimated, not word-level alignment.
- Non-silent/AAC checks do not verify transcript, pronunciation, or naturalness; human listening is required.
- TTS provider errors/caches/quotas are tested with mock; live preview and approval pass, but final MP4 mux remains blocked by production job quota.
- Live configured endpoint `127.0.0.1:4096` reported OpenCode V2 `2.1.4`; authenticated `/api/model` returned 493 models, including enabled `openai/gpt-6-luna`. `/global/health` was HTTP 200 HTML without `WWW-Authenticate`; protected API returned 401 without credentials. Separate `opencode service status` endpoint `127.0.0.1:28894` rejected configured credentials and was not selected automatically. V2 sidecar kept built-in providers, excluded reported non-builtin plugins, and returned model catalog. One AI Facts Studio request using exact `openai/gpt-6-luna` returned HTTP 200 with five scenes and a validated Research Package. Session, sidecar, and temp cleanup succeeded; no model fallback or Gemini call. Human claim review remains required.
- Research/Storyboard Production and Visual Director have not been tested against live Gemini; Production status does not verify key/model access. Source URLs are user-supplied candidates; app neither fetches nor independently fact-checks them. Local illustration library covers curated concepts only; unsupported topics require manual composition authoring and human review. Procedural compositions still require visual/scientific review. AI Image requires external generation and manual import; AI provenance is user-supplied, not verified. Raster upload uses FFprobe/FFmpeg decoding/optimization; SVG is unsupported.
- Responsive Create Video screenshots under `renders/ui-refinement/` use mocked connected OpenCode status; no prompt/model request was sent. Live browser keyboard/accessibility review remains manual.
- Cleanup failure injection and GitHub Actions dispatch remain untested.

## Automatic Motion Director V1 verification — 27 Oct 2026

- `npm test`, `npm run typecheck`, `npm run build`, `npm run smoke:api`, `npm run smoke:render`, and `npm run smoke:visual-storyboard` pass with Motion Director changes. Build retains Zod annotation/chunk-size warnings; no dependency was added.
- `npm run test:visual` passes all 86 existing golden frames against previous renderer-V2 baseline without changing golden hashes.
- API tests prove persisted batch completion/replay/hash conflict, research-package action persistence, stale-approval rejection, and immutable renderer-v3 snapshot contents after project edits. Browser/API smoke proves cancellation reaches terminal state, selective retry completes, job status survives reopen, and native range input seeks by keyboard within 390px bounds.
- `npm run poc:motion` produced sea-salt and Earth protection action-plan JSON, renderer-v3 silent H.264/AAC MP4s, manifests, per-action start/middle/end frame sequences, and contact sheets in `artifacts/motion-director-poc/2026-10-27T07-33-06-248Z/`. Browser desktop/mobile Motion Preview screenshots are under `artifacts/motion-director-poc/ui-2026-10-27T07-30-00/`.
- Verified concepts: rain fall, mineral flow along river geometry, water vapor rise while salt ions stay static, UV approach plus partial transmission, and charged-particle deflection without UV motion. Timing remains approximate; no word-level audio alignment. UV art does not identify wavelength per ray, so UV-B/UV-C absorption proportions are not simulated. Raster internals remain indivisible.
- PoC renders are silent review-scale 378×672, not production resolution or narration acceptance. Scenes remain unapproved; visual quality/scientific accuracy still need human review.
