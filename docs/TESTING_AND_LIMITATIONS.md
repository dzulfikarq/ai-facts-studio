# Testing and limitations — V1.0.3

Verified 24 Oct 2026 on Windows x64, Node `v22.22.1`, npm `10.9.4`, FFmpeg/ffprobe `9.0.2`. Baseline HEAD `b622550`; V1.0.3 edits are uncommitted worktree changes.

## Results

| Command | Result |
|---|---|
| `npm test` | PASS — migration, validation, caption schema/generation edge cases, registry, cues, Gemini guard, quota. |
| `npm run typecheck` | PASS. |
| `npm run smoke:api` | PASS — import, upload/delete, cleanup, shared cache, quota persistence. Gemini configured=false. |
| `npm run smoke:tts` | PASS — mocked Test Voice/full narration preview/approval; 3.05 sec H.264 + audible AAC. Mock audio is tone, not speech. |
| `npm run smoke:render` | PASS — V2 and legacy V1, H.264 + AAC at 360×640. |
| `npm run test:visual` | PASS — 35 golden frames at 270×480; templates, presets, cues, captions, lightning, transitions. Reviewed PNGs in ignored `renders/visual-regression/v1.0.3/`. |
| `npm run smoke:samples` | PASS — Mountain 56.04 sec / 9,140,730 bytes / SHA-256 `76c5b942135ed22d03691608371069de4827562c6226a69b67b154ebf019ae64`; Lightning 24.04 sec / 3,653,478 bytes / SHA-256 `54f2dcaabd206fcac8e4d22d06ca710dc7786176ecf11d4016036c9da4e68953`; both 1080×1920 H.264. |
| `npm run build` | PASS; Zod annotation and 589.77 KB chunk warnings. |
| `npm audit` | PASS — 0 vulnerabilities. |

Sample MP4s/manifests and 10 extracted PNGs saved at `renders/v1.0.3-review/`; frames cover every Mountain/Lightning scene. Both MP4s contain silent AAC (`-91.0 dB` mean/max), no narration. Compared with V1.0.2, duration/resolution stayed fixed while captions changed from a static scene block to larger phrase-by-phrase display; file sizes rose 18.1%/18.3%. `SAMPLE_RENDER_OUTPUT_DIR` lets `npm run smoke:samples` retain outputs; existing MP4/manifest paths are protected from overwrite.

## Audio and remaining limits

- Live Gemini was not run: local smoke reported `Gemini configured=false`. No live speech-quality or full-narration listening review.
- Mock TTS validates approval, timing, codec, and muxing only; it does not establish speech quality or Gemini billing status.
- Caption timing is deterministic per phrase/scene, not word-aligned. Long display text can be ellipsized.
- `visualDescription` remains editorial; graphics are authored SVG compositions. SFX metadata has no playback/mixing/ducking.
- Golden hashes target local Windows/Chrome/font rasterization. Cleanup failure/retry fault injection and GitHub Actions dispatch were not tested.
