# Testing and limitations — V1.0.2

Verified 24 Oct 2026 on Windows x64, Node `v22.22.1`, npm `10.9.4`, FFmpeg/ffprobe `9.0.2`.

## Current worktree results

| Command | Result |
|---|---|
| `npm test` | PASS — migration, schema safety/bounds, template registry, cue math, TTS guard, quota. |
| `npm run smoke:api` | PASS — v1.0 project + old SQLite job migration, audio upload/delete, cleanup queue, shared cache retention, daily quota persists after delete. |
| `npm run smoke:tts` | PASS — mock Test Voice/full narration preview/approval/stale rejection; MP4 H.264 + audible AAC. Mock output is synthetic tone, **not speech**. |
| `npm run smoke:render` | PASS — V2 and legacy V1 renderer, H.264 + AAC, 360×640. |
| `npm run test:visual` | PASS — 35 PNG goldens at 270×480; templates/presets/staggered entrance/cues/lightning/transitions. |
| `npm run smoke:samples` | PASS — Mountain 56.04 sec, 1080×1920 H.264, SHA-256 `187fdd9e98c5464aa6e2d4f74e16719066d91b86e6962a65a5ce1261e60ddfcc`; Lightning 24.04 sec, 1080×1920 H.264, SHA-256 `7c62c0cc209c7696a51433126a598aeb57e1d81a43f672f4d79c1095e2f3a3a9`. |
| `npm run typecheck` | PASS. |
| `npm run build` | PASS; two Zod annotation warnings and 585.50 KB JS chunk warning. |
| `npm audit` | PASS — 0 vulnerabilities. |

Sample smoke runs `scripts/render.ts` in separate processes with temporary output, preserving existing files under `renders/`. Standalone render refuses to overwrite MP4/manifest unless a different `RENDER_OUTPUT_DIR` is chosen. Mountain output: 56.04 sec / 7,740,096 bytes; lightning output: 24.04 sec / 3,088,933 bytes. Both outputs ffprobe-verified.

## Visual regression

Golden hashes are tracked in `scripts/visual-goldens.json`; rendered PNG review frames are written to ignored `renders/visual-regression/v1.0.2/`. Cases include all eight default templates, three presets at start/middle/end, lightning composition scenes, each visual motion cue, and dissolve transition before/start/mid/end. Baselines are local Windows/Chrome renders, not cross-platform pixel equality. Review PNGs before updating hashes.

## Gemini and audio

- `npm run smoke:tts` uses mock provider and tests mechanics only. It does not test speech quality.
- A live Gemini Test Voice request was verified in preceding V1.0.1 audit; provider code is unchanged and no live request was repeated for V1.0.2. No live full narration/approval/render or human listening review.
- API cannot detect linked billing. `GEMINI_TTS_FREE_TIER_ONLY=true` is operator assertion, not billing proof; no zero-charge claim.
- TTS alignment is per-scene estimated, not word-level. Free-tier data handling follows Google policy.

## Partial / deferred

- Cleanup queue normal drain passed; locked-file/permission failure and automatic retry were not fault-injected.
- GitHub Actions workflow was reviewed but not dispatched because `gh` is unavailable. No cloud artifact evidence; workflow unchanged.
- `visualDescription` remains editorial. `sfxCues` has no licensed sound library/playback/mixing/ducking. Some assets remain stylized primitives; long captions can ellipsize.
- No browser/screen-reader/accessibility review. API defaults loopback; keep `HOST=127.0.0.1`. Gemini API key stays backend-only.
