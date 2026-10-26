# 2D Visual Storyboard

Pipeline: Research → Storyboard → Visual Review → Preview → Render. Local deterministic composer remains automatic path; it uses curated vector/shape scenes and no image-generation API.

## Composer and review

`src/domain/visual-composer.ts` maps scene text, focus, allowlisted objects, relations, art direction, and shared-world assets to compositions. Shared objects give context but do not imply scene-specific relations. Manual/approved composition is preserved; replacement requires confirmation. Render thumbnails and MP4 share `VisualCompositionView` and deterministic layer/node motion.

Statuses:

- `ready_for_review`: structural/visual heuristics pass; scene remains unapproved until user approves it.
- `needs_review`: composition exists but human inspection or edits are required.
- `needs_visual_authoring`: required concept/relationship lacks adequate supported art.

Approval fingerprints cover artwork, copy, object/relation plan, source/status, and motion. Edits invalidate approval; API rejects stale fingerprints. Quality gate checks renderer-transformed bounds at midpoint, safe area, text overlap, density, visible concepts/relations, upload ownership, and approval integrity. It is deterministic heuristic, not proof of scientific accuracy or aesthetic quality.

## Optional semantic planner

AI planning runs only after clicking **Plan Semantik dengan AI Text**. Development uses selected authorized OpenCode model; Production uses configured Gemini Text model. There is no automatic provider/model fallback. Request returns schema-validated semantic JSON and caches by exact input/provider/model. Composer stays local; AI emits no code or image and no paid image endpoint is enabled. Plan composition type is advisory; mismatches are surfaced for review. Planner has not been live-provider tested in this run.

## User illustration uploads

Project-specific PNG, JPEG, and WebP only; SVG is rejected. Limit: 10 MB, 64–8192 px each side, 40 MP. Backend checks raster signature, MIME match, dimensions, SHA-256 and project references. Files use content-hash names in `public/visual-assets`; renders verify hashes. Shared files remain until last project reference is removed. Uploaded art needs explicit human concept-fit confirmation and separate scene approval; it never auto-approves. Header/dimension parsing does not fully decode image pixels, so malformed encodings may fail later in browser/render.

## POC review artifacts — 26 Oct 2026

- Five-scene sea-salt and five-scene Earth protection Storyboards; both quality gates report `ready_for_review`, zero issues, zero approved scenes.
- Full-resolution silent H.264/AAC review MP4s, manifests, scene stills, contact sheets, motion previews, and generic-card before/after: `artifacts/visual-poc-review-2026-10-26/`.
- UI Storyboard screenshots and motion-preview screenshot: `artifacts/visual-review-2026-10-26/ui/`.
- 86 golden renderer frames: `artifacts/visual-review-2026-10-26/visual-regression/`; baselines in `scripts/visual-goldens.json`.

Rebuild POC with `npm run poc:illustrations`; set `ILLUSTRATION_POC_DIR` to a new path because script refuses to overwrite artifacts. See `docs/TESTING_AND_LIMITATIONS.md` for checks and remaining limits.
