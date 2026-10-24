# AI Facts Studio V1.0.3 — implementation status

Baseline HEAD: `b622550` (`feat: v1.1`); V1.0.3 changes remain in the worktree. Verified 24 Oct 2026 on Windows x64: Node `v22.22.1`, npm `10.9.4`, FFmpeg/ffprobe `9.0.2`.

## Implemented

- V2 captions show one larger phrase at a time with two-line wrapping, contrast stroke, title-term emphasis, and short fade/translate transitions. Deterministic estimates split by punctuation/length and avoid ending on common connectors; narration edits clear stale manual timing.
- Research Package v1.1 supports optional validated manual `captionSegments`; v1.0 imports/migrates unchanged. Scene editor can edit phrase text, emphasis, timing, or restore automatic segments.
- Product/package version is `1.0.3`; renderer compatibility stays V1/V2. Old immutable V1 snapshots and V1.0 research imports remain supported.
- Sample smoke can retain review output via `SAMPLE_RENDER_OUTPUT_DIR`; standalone render still refuses overwrite.

## Verified

| Check | Result |
|---|---|
| `npm test` | PASS — 4 packages, schema migration/safety, captions including long input and connector boundaries, registry/cue determinism, Gemini guard, cache/timing/quota checks. |
| `npm run typecheck` | PASS. |
| `npm run smoke:api` | PASS — production UI/API, import/idempotency, upload/delete cleanup, shared audio retention, quota, locale fallback. Gemini configured=false. |
| `npm run smoke:tts` | PASS — mock Test Voice/full preview/approval/stale rejection; H.264 + audible AAC, 3.05 sec. Mock is tone, not speech. |
| `npm run smoke:render` | PASS — renderer V2 and legacy V1, 360×640 H.264 + AAC. |
| `npm run test:visual` | PASS — 35 golden frames: eight templates, three presets, nine cues, lightning scenes, transitions. Reviewed frame PNGs under `renders/visual-regression/v1.0.3/`. |
| `npm run smoke:samples` | PASS — Mountain V2: 56.04 sec, 1080×1920 H.264, 9,140,730 bytes, SHA-256 `76c5b942135ed22d03691608371069de4827562c6226a69b67b154ebf019ae64`; Lightning V2: 24.04 sec, 1080×1920 H.264, 3,653,478 bytes, SHA-256 `54f2dcaabd206fcac8e4d22d06ca710dc7786176ecf11d4016036c9da4e68953`. |
| `npm run build` | PASS; existing Zod annotation warnings and 589.77 KB JS chunk warning remain. |
| `npm audit` | PASS — 0 vulnerabilities. |

Full MP4s/manifests and 10 extracted review frames are in ignored `renders/v1.0.3-review/`. Both samples have silent AAC tracks (measured mean/max `-91.0 dB`), no narration; visual review checked every scene. Compared with V1.0.2, duration/resolution stayed fixed; caption changed from static full-scene block to larger, emphasized phrase-by-phrase display. Mountain grew 7,740,096 → 9,140,730 bytes (+18.1%); Lightning 3,088,933 → 3,653,478 bytes (+18.3%).

## Limits

- Captions use phrase-level deterministic timing, not word-level TTS alignment.
- Gemini was not configured (`Gemini configured=false`); no live speech generation/listening/full-narration test. Mock AAC check verifies muxing only.
- `visualDescription` remains editorial; visuals use authored SVG compositions. SFX cues remain metadata without playback/mixing.
- Visual hashes are local Windows/Chrome/font-specific. Cleanup retry fault injection and GitHub Actions dispatch remain untested.
