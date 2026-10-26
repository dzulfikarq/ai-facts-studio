# Testing and limitations — V1.0.4

Baseline matrix verified 24 Oct 2026 on Windows x64, Node `v22.22.1`, npm `10.9.4`, FFmpeg/ffprobe `9.0.2`. V1/V2 OpenCode worktree changes rechecked 26 Oct with `npm test`, `npm run typecheck`, `npm run build`, and API smoke. HEAD `e230bab`; generation and OpenCode integration remain uncommitted. Samples/golden-frame suites retain baseline results.

## Automated results

| Command | Result |
|---|---|
| `npm test` | PASS — migration/schema/audio, renderer-aware safe-area geometry, raster signature/dimensions, semantic-plan schema/cache, OpenCode ID deduplication, AI quota/provider checks, storyboard gates, motion and TTS regressions. |
| `npm run typecheck` | PASS. |
| `npm run smoke:api` | PASS — prior API coverage plus raster upload/MIME spoof rejection, project ownership checks, static serving, persistence, approval gate, and reference cleanup. No live planner call. |
| `npm run smoke:tts` | PASS — mode switch/restart leaves TTS preview, approval, and rendered job intact; mock preview/cache/approval, old upload preservation, settings/script edits, snapshot immutability, AAC checks. Tone fixture, not speech. |
| `npm run smoke:render` | PASS — legacy V1 and V2 H.264/AAC with snapshot SHA validation. |
| `npm run smoke:samples` | PASS — all 3 acceptance packages, silent-expected AAC, H.264 1080×1920, 56.04/24.04/32.04 sec. |
| `npm run smoke:samples-audio` | PASS — all 3 acceptance packages with `mock-fixture` sine audio; non-silent AAC, mean −24.1 dB, safe peak and aligned duration. Not speech. |
| `npm run test:visual` | PASS — 86 golden frames: templates, presets, cues, lightning, seven mountain scenes, five salt scenes, five Earth scenes, transitions. Baseline refreshed after visual review. |
| `npm run smoke:visual-storyboard` | PASS — browser review, five-scene topics, motion preview, persistence/reopen, stale-approval rejection. Duplicate OpenCode model IDs are deduplicated; no React key warnings. |
| `npm run build` | PASS; existing Zod annotation and 741.30 kB client-chunk warnings. |
| `npm audit` | PASS — 0 vulnerabilities. |

Review MP4s/manifests/ffprobe/audio reports: `renders/v1.0.4-review/final-silent/` and `renders/v1.0.4-review/mock-audio-qa-final/`. The latter contains test tones explicitly tagged `mock-fixture`.

## Live provider result

One authorized live full-narration preview generated through Gemini Free Tier, cache miss: Mountain, Achernar, MP3 43.2 sec, SHA-256 `9bd0c65688a73c72135beaa72bee8e5dd64d4580a99135390f5071ee0a497bb6`, mean −17.3 dB, peak −1.9 dB. User listened and approved in UI; approval timestamp persisted. Files: `renders/v1.0.4-review/gemini-live/`. Billing-free status is operator-attested, not API-verifiable.

Full live MP4 is **blocked by quota**, not passed: production video quota is 1/1, next slot `2026-10-25T06:07:43.578Z`. `continue` verified persisted approval, then stopped before snapshot/job. No quota reset, render, or repeat synthesis. After reset, review Player preview and explicitly authorize `render`. Automated levels do not prove spoken content correctness.

## Illustration POC — 26 Oct 2026

Latest output: `artifacts/visual-poc-review-2026-10-26/`. Five-scene sea-salt and five-scene Earth Storyboards; both gate reports have zero issues and `approvedScenes: 0`. Includes full-resolution silent 1080×1920 review MP4s/manifests, per-scene stills, contact sheets, motion previews, and legacy generic-card before/after. UI screenshots: `artifacts/visual-review-2026-10-26/ui/`. Renderer regression frames: `artifacts/visual-review-2026-10-26/visual-regression/`.

Visual review: salt scenes show ocean ions, rain weathering, mountain→river→sea mineral flow, evaporation, and bounded salinity. Earth scenes distinguish Sun/Earth, atmosphere, ozone/UV absorption, magnetosphere/charged-particle deflection, then summarize separate protection mechanisms. Preview and Remotion renders share composition renderer. POC outputs are silent; they prove visual/motion rendering, not narration. Gate readiness does not grant approval or prove science/aesthetic quality. Uploaded images require human fit confirmation and separate approval. AI semantic planner schema/cache are unit-tested; no live planner request was made.

## Remaining limits

- Model drafts/plans are not fact-checked. No source URL retrieval/grounding occurs; claims stay unverified unless manually reviewed. Local visual library has limited keyword coverage; semantic planner is text-only and does not generate art.
- Caption timing remains phrase-level estimated, not word-level alignment.
- Non-silent/AAC checks do not verify transcript, pronunciation, or naturalness; human listening is required.
- TTS provider errors/caches/quotas are tested with mock; live preview and approval pass, but final MP4 mux remains blocked by production job quota.
- Live configured endpoint `127.0.0.1:4096` reported OpenCode V2 `2.1.4`; authenticated `/api/model` returned 493 models, including enabled `openai/gpt-6-luna`. `/global/health` was HTTP 200 HTML without `WWW-Authenticate`; protected API returned 401 without credentials. Separate `opencode service status` endpoint `127.0.0.1:28894` rejected configured credentials and was not selected automatically. V2 sidecar kept built-in providers, excluded reported non-builtin plugins, and returned model catalog. One AI Facts Studio request using exact `openai/gpt-6-luna` returned HTTP 200 with five scenes and a validated Research Package. Session, sidecar, and temp cleanup succeeded; no model fallback or Gemini call. Human claim review remains required.
- Research/Storyboard Production and Visual Director have not been tested against live Gemini; Production status does not verify key/model access. Source URLs are user-supplied candidates; app neither fetches nor independently fact-checks them. Local illustration library covers curated concepts only; unsupported topics require manual composition authoring and human review. Procedural compositions still require visual/scientific review. Raster upload checks signatures/metadata but does not fully decode pixels; SVG is unsupported.
- Responsive Create Video screenshots under `renders/ui-refinement/` use mocked connected OpenCode status; no prompt/model request was sent. Live browser keyboard/accessibility review remains manual.
- Cleanup failure injection and GitHub Actions dispatch remain untested.
