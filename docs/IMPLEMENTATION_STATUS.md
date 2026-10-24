# AI Facts Studio V1.0.2 — implementation status

Baseline: HEAD `0f5a1be`; V1.0.2 worktree. Verification on 24 Oct 2026, Windows x64: Node `v22.22.1`, npm `10.9.4`, FFmpeg/ffprobe `9.0.2`.

## Implemented

- Research Package v1.0 auto-upgrades to v1.1 structured composition and motion plans. Existing projects normalize on read; legacy source files stay unchanged until saved.
- Typed registry explicitly maps all eight template IDs. V2 supports safe Shapes, SVG paths, Text, Icons, trusted local Images, Diagrams, and Groups/layers; three presets, safe-area design tokens, cue-driven transitions, and frame-based motion.
- V1 renderer retained. Snapshots/jobs/manifests store renderer version; old versionless snapshots route to V1, new jobs use V2. Daily quota and immutable audio are unchanged.
- Lightning sample is separate Research Package v1.1 with cloud/charge-separation/bolt composition; render does not call AI.
- Gemini TTS approval, SQLite, cleanup queue, loopback defaults, and project storage maintained.

## Tested in this worktree

| Check | Result / evidence |
|---|---|
| `npm test` | PASS — 4 packages, v1.0→1.1 migration, composition validation, registry, cue math, existing TTS/quota checks. |
| `npm run smoke:api` | PASS — v1.0 project import + legacy SQLite/job renderer-version migration, upload/delete cleanup, shared audio, quota persistence, V2 snapshot. |
| `npm run smoke:tts` | PASS — mock Test Voice/approval/stale rejection/render; H.264 + audible AAC. Mock is a tone, not speech. |
| `npm run smoke:render` | PASS — renderer V2 and legacy V1 path, H.264 + AAC, 360×640. |
| `npm run test:visual` | PASS — 35 PNG golden frames: 8 templates, 3 presets, staggered entrance, all lightning scenes, 9 cues, dissolve before/start/mid/end. |
| `npm run smoke:samples` | PASS — mountain V2: 56.04 sec, 1080×1920 H.264, 7,740,096 bytes, SHA-256 `187fdd9e98c5464aa6e2d4f74e16719066d91b86e6962a65a5ce1261e60ddfcc`; lightning V2: 24.04 sec, 1080×1920 H.264, 3,088,933 bytes, SHA-256 `7c62c0cc209c7696a51433126a598aeb57e1d81a43f672f4d79c1095e2f3a3a9`. |
| `npm run typecheck` | PASS. |
| `npm run build` | PASS; Zod annotation warnings and 585.50 KB JS chunk warning remain. |
| `npm audit` | PASS — 0 vulnerabilities. |

## Partially tested

- Live Gemini Test Voice evidence from prior V1.0.1 audit remains relevant because TTS provider was unchanged; it was not repeated for V1.0.2. No live full narration/approval/render or human listening review.
- Golden hashes reviewed on local Windows/Chrome; other OS/browser/font output may differ.
- Cleanup queue success path passed. Locked-file/permission fault and timed retry were not fault-injected.
- GitHub Actions not dispatched (`gh` unavailable); no workflow/artifact evidence.
- Gemini billing link cannot be verified by API. Backend remains loopback-default; API key stays server-side.

## Partial / deferred

- `visualDescription` remains editorial text, not generated artwork. `sfxCues` has no playback path, licensed library, timing, mixing, or ducking.
- Current visuals are authored SVG compositions; no external stock-image library. Long captions/title may ellipsize; TTS timing remains per-scene estimate.
- No cloud dispatch/download, cleanup retention UI, or cross-platform visual golden baselines.
- Legacy job usage deleted before V1.0.1 cannot be reconstructed; still-present jobs backfill quota history.

## V1.1 recommendation

Build reviewed template-specific diagrams and more library primitives, add cue presets/layer controls, then licensed SFX with timing/mix tests. Keep compositions declarative and deterministic; keep AI out of render path. See [`DYNAMIC_MOTION_GRAPHICS_ENGINE.md`](DYNAMIC_MOTION_GRAPHICS_ENGINE.md).
