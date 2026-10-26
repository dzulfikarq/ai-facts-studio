# Dynamic Motion Graphics Engine V1.0.4

## Goal

Render reusable, deterministic 2D graphics from validated, authored Research Package compositions. No AI/video API call is used during preview/render. Same input, renderer version, and frame produce same scene state. V2 frames foreground art into illustration area while keeping low-depth backdrops and title/caption UI fixed; layered shadows and preset camera drift add depth on the 9:16 canvas.

## Renderer architecture

- `src/domain/visual-composition.ts`: strict Zod nodes, canvas bounds, color tokens, trusted asset IDs, diagram kinds, and cue-plan contracts.
- `src/domain/visual-defaults.ts`: authored composition and cue defaults for all eight template IDs; used by v1.0 migration.
- `src/video/renderer-registry.tsx`: exhaustive template registry with renderer component, label, capabilities, and explicit default-composition factory. Unknown IDs fail instead of showing generic art.
- `src/video/visual-primitives.tsx`: SVG Shape, Path, Text, Icon, Image, Diagram, Group/layer rendering.
- `src/video/style-config.ts`: palette, typography, spacing, safe-area, and backdrop tokens for each visual preset.
- `src/video/motion.ts`: frame-index cue evaluation and deterministic transform composition.
- `src/video/video.tsx`: V2 scene selection, transitions, captions, progress, and audio.
- `src/video/legacy-video.tsx` / `legacy-artwork.tsx`: frozen V1 renderer compatibility.

## Composition data

Each v1.1 scene includes `visualComposition`:

```json
{
  "background": "canvas",
  "layers": [
    {
      "id": "foreground",
      "depth": 0.8,
      "nodes": [
        { "type": "shape", "shape": "ellipse", "x": 420, "y": 720, "width": 240, "height": 240, "fill": "accent" },
        { "type": "text", "x": 220, "y": 1000, "width": 640, "height": 90, "text": "VISUAL LABEL", "color": "text", "fontSize": 40 }
      ]
    }
  ]
}
```

Supported nodes: `shape` (rect/ellipse/circle/line/polygon), SVG `path`, `text`, allowlisted `icon` (`rock`, `river`, `crystal` among others), allowlisted local `image`, `diagram` (`water-cycle`, generic 2–4-step `process-flow`), and nested `group`. Node frames include x/y/width/height/rotation/opacity/z-index; schema rejects path markup/code, arbitrary URLs, unknown assets, duplicate layers, and rotated bounds outside 1080×1920. Group children use canonical canvas coordinates scaled into group bounds; outer canvas clips. `visualDescription` remains human guidance only; it is never parsed or passed to code generation.

V1.0 packages pass strict old-schema validation, then upgrade to v1.1 in memory: template ID supplies structured defaults, motion cue strings get default plans, and original editorial text/references/timing remain intact. Existing SQLite projects normalize on read and persist v1.1 when next saved.

## Presets and cue combinations

| Preset | Rendered distinction |
|---|---|
| `flat-2d-storytelling` | Light flat palette, layered landscape primitives, low-amplitude depth drift. |
| `animated-infographic` | Light grid/backdrop, diagram panels/labels/connectors, staggered layer entrance. |
| `cinematic-parallax` | Dark palette, star field/light overlay, depth camera drift and gradual zoom. |

Color tokens (`canvas`, `surface`, `primary`, `accent`, `text`, `muted`, `snow`, `danger`) resolve through selected preset; explicit `#RRGGBB` remains fixed.

`motionPlan` has one entry per ordered `motionCue`: `{cue,targetLayer,delayFrames,durationFrames,easing}`. Targets are `all`, `scene`, or a layer ID. Motion uses Remotion frame, `interpolate`, and bounded `spring`; plans execute in array order, translations sum, scale factors multiply/clamp, alpha multiplies, and reveal clips its layer. Pan/zoom/parallax/slide/pulse now use larger bounded trajectories; presets add camera drift and zoom. `cut` is immediate and takes precedence over `dissolve`; `dissolve` cross-fades prior artwork for configured frames. Repeated compatible cues compound deterministically.

The scene editor exposes checkboxes for cue selection and JSON editors for composition/cue timing. `visualDescription` remains editorial text and can guide local deterministic Art Director mappings; it is never rendered as SVG/markup.

V2 captions show one phrase at a time, wrap to at most two lines, use preset contrast/stroke, and gently fade/translate at phrase boundaries. Auto phrases split on punctuation, 6-word/48-character bounds, then merge up to 72 characters; common connectors move off phrase endings. Duration uses word/punctuation weights inside scene progress. Matching `onScreenText` terms receive accent emphasis. Authors can manually edit v1.1 `captionSegments` text, emphasis, and contiguous 0–1 progress ranges per scene. No word timestamps are inferred.

## Versioning and tests

New V2 jobs store `rendererVersion: 2` in immutable snapshot, SQLite job row, and manifest. Old snapshots without version default to V1 and still render via the preserved legacy component. V2 preview and render share `VersionedVideo`. Audio path/hash stays immutable; daily quota policy is unchanged.

Run `npm test`, `npm run smoke:render`, `npm run smoke:samples`, and `npm run test:visual`. Visual test renders 86 PNG frames at 270×480 and compares hashes to `scripts/visual-goldens.json`. It includes all templates, presets, cue behavior, staggered entrance, lightning, seven mountain scenes, five salt scenes, five Earth scenes, and transitions. Before/after/contact sheets were inspected before golden refresh. Hash baseline is local Windows/Chrome-specific and may differ on another platform/font rasterizer.

SFX remains partial: `sfxCues` is metadata only, with no local licensed library, cue timeline, mixing, ducking, or playback.

Renderer consumes supplied compositions; it does not research topics or generate art. AI Generation drafts Research/Storyboard; local Art Director maps curated concepts to reusable landscapes, cutaways, and diagrams. Unsupported topics require manual composition authoring. Sea-salt and Earth examples are checked-in content rendered through shared composition components; science and visual fit still need human review.
