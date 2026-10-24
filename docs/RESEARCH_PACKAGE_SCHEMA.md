# Research Package JSON v1.0 / v1.1

Importer remains strict. Existing v1.0 files are validated using their original field set, then auto-upgraded in memory to v1.1. Unknown v1.0 keys still fail; old sample/project data is not discarded. New v1.1 scenes require structured `visualComposition` and one `motionPlan` entry per `motionCue`; `captionSegments` is optional.

## Root fields (both versions)

`schemaVersion`, `id`, `title`, `category`, `visualPreset`, `language`, `targetDurationSec`, `aspectRatio` (`9:16`), `narration`, `references`, `scenes`.

Reference: unique `id`, `title`, `publisher`, HTTP(S) `url`, ISO `checkedAt`, optional ISO `publishedAt`.

Scene: unique `id`, increasing positive `order`, non-overlapping `startSec`/`endSec`, `narrationText`, `onScreenText`, allowlisted `templateId`, `visualDescription`, allowlisted `motionCues`, allowlisted `sfxCues`, and existing `referenceIds`.

## V1.1 visual fields

`visualDescription` stays free text for human direction; renderer never treats it as commands or generates objects from it.

`visualComposition` declares `background` color token/hex and ordered `layers` (`id`, depth 0–1, nodes). Safe nodes:

- `shape`: rect, ellipse, circle, line, polygon
- `path`: bounded SVG path-data grammar; no markup or URL
- `text`: escaped string, font token, size, align, weight
- `icon`: internal allowlisted icon ID
- `image`: trusted local asset ID only (`cloud`, `lightning`, `sun`)
- `diagram`: allowlisted diagram kind (`charge-separation`, `orbit`, geological/volcano/water-cycle)
- `group`: bounded layer group with up to 24 leaf children (no recursive group nesting)

Frames include x/y/width/height, optional rotation/opacity/z-index. Schema bounds rotated node frames to 1080×1920 and validates path, color, layer ID, node count, and asset IDs. Group children use canonical canvas coordinates scaled into the group frame. Renderer clips to canvas; no `eval`, JS, imported JSX, arbitrary SVG markup, remote image fetch, or user-selected file path.

`motionPlan` stores `{cue,targetLayer,delayFrames,durationFrames,easing}`. It must align one-to-one and in order with `motionCues`. Target is `all`, `scene`, or an existing layer ID; easing allowlist: `linear`, `easeIn`, `easeOut`, `easeInOut`, `spring`.

Optional `captionSegments` stores `{text,startProgress,endProgress,emphasis?}` (up to 30 entries). Progress is fraction 0–1 within scene; segments must be contiguous from 0 to 1. Without custom entries, renderer derives bounded deterministic phrases from `narrationText` and can highlight words repeated in `onScreenText`. This is phrase timing estimate, not word-level audio alignment.

## Limits and migration

1–120 sec; 1–30 scenes; up to 50 references; 2,000 chars per narration segment; 120 chars on-screen text; up to 12 composition layers, 32 nodes/layer, 8 cues/scene. Templates: `mountain-reveal`, `plate-collision`, `folding-uplift`, `himalaya`, `volcano`, `infographic`, `space-orbit`, `animal-habitat`.

V1.0 migration uses `templateId` to add authored default compositions and derives default cue plans. Existing `visualDescription`, claims, references, timing, and scene text remain unchanged. DB projects normalize on read; they persist v1.1 on next save. Old immutable V1 render snapshots have their own V1 renderer compatibility path.

Examples: [`mountain-formation.json`](../samples/mountain-formation.json) and [`lightning-charge.json`](../samples/lightning-charge.json). V1.0 samples remain supported. No URL fetch/factual verification occurs; author review remains required. Renderer wiring and known nonvisual metadata fields: [`VIDEO_PIPELINE.md`](VIDEO_PIPELINE.md).
