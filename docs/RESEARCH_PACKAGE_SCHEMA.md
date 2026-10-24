# Research package JSON v1.0

App accepts strict schema version `1.0`; unknown root/scene/reference keys are errors, never silently discarded. No legacy JSON files existed in the audited repo, so no legacy adapter could be mapped. Convert older fields explicitly and keep source text in the matching fields before import.

## Required fields

Root: `schemaVersion`, `id`, `title`, `category`, `visualPreset`, `language`, `targetDurationSec`, `aspectRatio` (`9:16`), `narration`, `references`, `scenes`.

Reference: unique `id`, `title`, `publisher`, HTTP(S) `url`, ISO `checkedAt`, optional ISO `publishedAt`.

Scene: unique `id`, increasing positive `order`, non-overlapping `startSec`/`endSec`, `narrationText`, `onScreenText`, allowlisted `templateId`, `visualDescription`, allowlisted `motionCues`, allowlisted `sfxCues`, `referenceIds` that exist in root `references`.

Schema acceptance does not mean every field currently changes rendered output. V1.0.1 field-to-renderer wiring is documented in [`VIDEO_PIPELINE.md`](VIDEO_PIPELINE.md).

Limits: 1–120 sec, 1–30 scenes, at most 50 references, 2,000 chars per narration segment, 120 chars on-screen text. URLs must be `http://` or `https://`. Timeline cannot overlap; scenes cannot exceed target duration. Motion cues: `fadeIn`, `slide`, `scale`, `pan`, `zoom`, `parallax`, `reveal`, `pulse`, `cut`, `dissolve`. Templates: `mountain-reveal`, `plate-collision`, `folding-uplift`, `himalaya`, `volcano`, `infographic`, `space-orbit`, `animal-habitat`.

## Example and validation

Full seven-scene package: [`../samples/mountain-formation.json`](../samples/mountain-formation.json). Other valid packages: `samples/space-orbit.json` and `samples/animal-habitat.json`.

Create page accepts a `.json` file up to 1 MB or editable JSON text. Zod errors include field paths; no URL fetch or factual verification occurs. Packages with no references or scenes without reference IDs can be imported only if schema permits scene references empty, but UI warns; author review remains required. On-screen/narration text is rendered as escaped React/SVG text, never interpreted as markup.

When audio is attached, scene timestamps scale proportionally to probed audio duration. This does not imply word-level alignment; captions remain scene-level estimates.
