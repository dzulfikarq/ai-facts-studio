# Testing and limitations — V1.0.4

Verified 24 Oct 2026 on Windows x64, Node `v22.22.1`, npm `10.9.4`, FFmpeg/ffprobe `9.0.2`. Baseline HEAD `ddd92c5`; V1.0.4 worktree changes are uncommitted.

## Automated results

| Command | Result |
|---|---|
| `npm test` | PASS — migration, schema/audio thresholds, acceptance samples, renderer/cues, Gemini guards/quota, workflow gates, and draft/audio preview-review invalidation. |
| `npm run typecheck` | PASS. |
| `npm run smoke:api` | PASS — local UI/API, V1 DB migration, upload/cleanup, author-review invalidation on research edits, snapshot SHA, silent-render confirmation, quota persistence. Gemini disabled in isolated test DB. |
| `npm run smoke:tts` | PASS — mock preview/cache/approval, old upload retained until approval, settings/script edits, restart persistence, snapshot immutability, AAC loudness/duration/peak. Tone fixture, not speech. |
| `npm run smoke:render` | PASS — legacy V1 and V2 H.264/AAC with audio snapshot SHA validation. |
| `npm run smoke:samples` | PASS — all 3 acceptance packages, silent-expected AAC, H.264 1080×1920, 56.04/24.04/32.04 sec. |
| `npm run smoke:samples-audio` | PASS — all 3 acceptance packages with `mock-fixture` sine audio; non-silent AAC, mean −24.1 dB, safe peak and aligned duration. Not speech. |
| `npm run test:visual` | PASS — 39 golden frames. Before/after illustration areas reviewed under `renders/visual-regression/v1.0.3/` and `renders/visual-regression/v1.0.3-quality/`. |
| `npm run build` | PASS; existing Zod annotation and bundle-size warnings. |
| `npm audit` | PASS — 0 vulnerabilities. |

Review MP4s/manifests/ffprobe/audio reports: `renders/v1.0.4-review/final-silent/` and `renders/v1.0.4-review/mock-audio-qa-final/`. The latter contains test tones explicitly tagged `mock-fixture`.

## Live provider result

One authorized live full-narration preview generated through Gemini Free Tier, cache miss: Mountain, Achernar, MP3 43.2 sec, SHA-256 `9bd0c65688a73c72135beaa72bee8e5dd64d4580a99135390f5071ee0a497bb6`, mean −17.3 dB, peak −1.9 dB. User listened and approved in UI; approval timestamp persisted. Files: `renders/v1.0.4-review/gemini-live/`. Billing-free status is operator-attested, not API-verifiable.

Full live MP4 is **blocked by quota**, not passed: production video quota is 1/1, next slot `2026-10-25T06:07:43.578Z`. `continue` verified persisted approval, then stopped before snapshot/job. No quota reset, render, or repeat synthesis. After reset, review Player preview and explicitly authorize `render`. Automated levels do not prove spoken content correctness.

## Remaining limits

- No automatic research/storyboard/illustration generation from arbitrary titles.
- Caption timing remains phrase-level estimated, not word-level alignment.
- Non-silent/AAC checks do not verify transcript, pronunciation, or naturalness; human listening is required.
- TTS provider errors/caches/quotas are tested with mock; live preview and approval pass, but final MP4 mux remains blocked by production job quota.
- Wizard logic is unit/API tested; responsive and keyboard behavior still needs manual browser review.
- Cleanup failure injection and GitHub Actions dispatch remain untested.
