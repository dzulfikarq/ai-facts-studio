# Testing and limitations — V1.0.3

Verified 24 Oct 2026 on Windows x64, Node `v22.22.1`, npm `10.9.4`, FFmpeg/ffprobe `9.0.2`. Baseline HEAD `6e608d8`; visual-quality changes are worktree edits.

## Results

| Command | Result |
|---|---|
| `npm test` | PASS — 5 packages, caption/composition bounds, salt topic acceptance, motion, TTS guards, quota. |
| `npm run typecheck` | PASS. |
| `npm run smoke:api` | PASS — API/storage/cleanup/quota; Gemini configured=false. |
| `npm run smoke:tts` | PASS — mocked Test Voice/full preview/approval; 3.05 sec H.264 + audible AAC. Mock is tone, not speech. |
| `npm run smoke:render` | PASS on rerun — V2 and legacy V1, H.264 + AAC, 360×640. First run had transient Chromium target-close error. |
| `npm run test:visual` | PASS — 39 frames at 270×480; templates, presets, cues, lightning, sea-salt, transitions. Before/after art checked in `renders/visual-regression/v1.0.3/` and `renders/visual-regression/v1.0.3-quality/`. |
| `npm run smoke:samples` | PASS — Mountain 56.04 sec / 10,501,425 bytes / SHA-256 `6401934e7be69f5bb9970607ebd0a11454ecc4f00a0dc4b2197d41b7ee4815f2`; Lightning 24.04 sec / 4,666,109 bytes / SHA-256 `e6cc318188960eb1d5aaab230b723d91eed4928ddfc1e7ec5bf4a2384c77adee`; Sea Salt 32.04 sec / 10,084,209 bytes / SHA-256 `d488d8896df4a736173db8af298a62a97583dcf6de152266e5936eb6a4f0adf3`. All 1080×1920 H.264. |
| `npm run build` | PASS; Zod annotation + 594.52 KB chunk warnings. |
| `npm audit` | PASS — 0 vulnerabilities. |

MP4s, manifests, and 14 full-resolution review frames saved under `renders/v1.0.3-final/`. MP4s contain silent AAC (`-91 dB` mean/max), no narration. Prior V1.0.3 output size → final: Mountain 9,140,730 → 10,501,425 bytes; Lightning 3,653,478 → 4,666,109 bytes. Resolution/duration unchanged.

## Limits

- No arbitrary-title research/storyboard/illustration generation. App renders supplied scenes/compositions; Sea Salt is a manually authored acceptance package demonstrating reusable generic icons/diagrams.
- Gemini unavailable in environment; no live speech-quality/full-narration listening test. Mock tests mux/approval only.
- Captions are phrase/scene timing estimates, not word-aligned. SFX have no playback/mixing. Visual goldens target local Windows/Chrome/font rasterization.
- Cleanup retry fault injection and GitHub Actions dispatch remain untested.
