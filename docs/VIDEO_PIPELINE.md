# Video pipeline — Dynamic Motion Graphics Engine V1.0.3

## V2 composition and render path

`Research Package import → strict v1.0→v1.1 migration → visualComposition + motionPlan validation → typed template registry → preset tokens + Remotion frame motion → shared VersionedVideo → Player / MP4 → H.264 + AAC → ffprobe manifest`.

- `src/video/renderer-registry.tsx`: exhaustive `templateId` registry; missing template renderer throws rather than selecting generic art.
- `src/video/visual-primitives.tsx`: safe SVG primitives, icons, local trusted images, groups/layers, diagrams.
- `src/video/style-config.ts`: distinct palette, typography, safe area, and backdrop configs for three presets.
- `src/video/motion.ts`: deterministic per-frame cue calculation.
- `src/video/video.tsx`: scene timeline, transitions, title/caption layout, preset backdrop, narration audio.
- `src/video/legacy-video.tsx` + `legacy-artwork.tsx`: frozen V1 renderer path.

Canvas fixed at 1080×1920 / 30 fps. Browser Player and V2 MP4 use same `VersionedVideo` component. Local render writes H.264 and optional AAC, then verifies codec, dimensions, duration, bytes, SHA-256, and renderer version.

`renderSnapshot()` bundles trusted Remotion code, selects the versioned composition and renders the immutable snapshot. Standalone `scripts/render.ts` refuses to overwrite an existing MP4/manifest; set `RENDER_OUTPUT_DIR` for a separate destination. Project jobs use unique attempt paths.

## Research Package and composition

Research Package v1.0 is accepted and upgraded on parse to v1.1. Migration preserves existing fields, adds template-derived `visualComposition` defaults and a default `motionPlan`; source files need not be rewritten. Existing DB projects are normalized on read and persist v1.1 on next save.

`visualComposition` is typed JSON: background, ordered depth layers, and allowlisted nodes (`shape`, `path`, `text`, reusable `icon`, trusted local `image`, `diagram`, `group`). Node frames, colors, SVG path data, IDs, assets, dimensions, and animation plans are validated. Foreground art is auto-framed independently from low-depth backdrops; per-layer shadows and camera drift improve depth. Rendering uses React/SVG; imported text/path data is never evaluated as JS or markup. `visualDescription` remains human editorial direction and is **not** interpreted as a generated composition.

| Research field | V1.0.3 behavior |
|---|---|
| `visualPreset` | Real palette, backdrop, typography scale, and composition treatment. |
| `visualComposition` | Actual renderer input; editor can change validated JSON per scene. Foreground art is framed separately from backdrops. |
| `motionCues` + `motionPlan` | Frame-based, composable cues. Plan defines target layer, delay, duration, easing. |
| `templateId` | Explicit registry renderer and distinct template defaults. |
| `visualDescription` | Editorial-only text; does not create objects. |
| `sfxCues` | Metadata only; no SFX playback in this version. |
| `title`, `category`, `onScreenText`, `narrationText` | Video title/category/scene title/caption and TTS script fields. V2 captions split into short phrases; top-level `narration` remains unused by TTS. |
| `captionSegments` | Optional manual phrase text/highlights and contiguous 0–1 scene timing; absent field gets bounded deterministic phrase estimates. |
| reusable diagrams | `process-flow` (2–4 authored steps) and `water-cycle`; visual content remains package-authored. |
| `startSec`, `endSec`, `targetDurationSec` | Scene sequence/timing. Attached audio duration overrides total; estimated TTS timings remain editable. |
| `language` | Package metadata; TTS locale remains separately selected in Voice UI. |
| `references` | Validation/review metadata; not drawn into video. |

### Template registry

All IDs have explicit defaults and registry entries: `mountain-reveal`, `plate-collision`, `folding-uplift`, `himalaya`, `volcano`, `infographic`, `space-orbit`, `animal-habitat`. Templates share renderer primitives, not one fallback illustration. `infographic` supplies diagram-focused default composition; users may replace/extend scene composition without changing renderer code.

### Motion cue contract

Default cue timings (30 fps): `fadeIn` 24f/spring, `slide` 24f/ease-in-out, `scale` 24f/spring, `pan` 24f/linear, `zoom` 24f/ease-in-out, `parallax` 24f/ease-in-out, `reveal` 24f/spring, `pulse` 36f/linear, `cut` immediate, `dissolve` 18f/ease-in-out. V1.1 `motionPlan` can target `all`, `scene`, or a named layer. Plans run in array order: translations sum, scales multiply/clamp, opacity multiplies, reveal takes the most restrictive clip. If both transition cues exist, `cut` wins; `dissolve` cross-fades previous artwork. Same package + renderer version + frame yields deterministic motion.

### Trusted visual assets

`public/assets/{cloud,lightning,sun}.svg` are original local SVGs authored for this repository. Image nodes accept asset IDs only; renderer maps IDs to those files. Icons and diagrams are inline SVG primitives. No network fetch or external asset download occurs during render. See [`DYNAMIC_MOTION_GRAPHICS_ENGINE.md`](DYNAMIC_MOTION_GRAPHICS_ENGINE.md) and [`TEMPLATE_AND_ASSET_GUIDE.md`](TEMPLATE_AND_ASSET_GUIDE.md).

## Renderer version and old jobs

New snapshots store `rendererVersion: 2`; job row and MP4 manifest record same version. `src/video/root.tsx` dispatches V1 to frozen legacy components and V2 to motion registry. A V1 snapshot without version metadata defaults to renderer 1 and remains renderable; when content is unchanged, project UI can render that V1 snapshot or explicitly create a V2 snapshot. Changed content marks it stale. Immutable audio file references remain unchanged. V1.0.3 does not silently reinterpret old snapshots as V2.

## Validation and visual regression

`npm test` checks v1.0 migration, strict composition/asset/caption validation, renderer registration, process-flow constraints, and cue functions. `npm run test:visual` renders 39 PNG frames at 270×480: eight template middles, three presets at start/middle/end, staggered entrance, lightning and sea-salt scenes, cue/no-cue frames, and transition before/start/mid/end. SHA-256 baselines live in `scripts/visual-goldens.json`; PNG review artifacts go to ignored `renders/visual-regression/v1.0.3-quality/`. Before/after illustration area was inspected before golden refresh; other OS/browser/font output may differ. `npm run smoke:render` additionally renders V2 and versionless V1 MP4s.

## Limits / next

SFX cues are not played or mixed; no licensed SFX library/timing/ducking engine yet. V1.0.3 visual descriptions stay editorial; author visual objects via structured JSON or template defaults. Caption timing is deterministic phrase-level estimate, not word-level TTS alignment; very long display text may be ellipsized.

Free-title limitation: app renders provided scenes/compositions; it does not research facts, author storyboards, or generate topic-specific illustrations automatically. The sea-salt acceptance sample is manually authored using reusable visual nodes/diagrams.
