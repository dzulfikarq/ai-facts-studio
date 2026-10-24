# Add a template or visual asset

V2 rendering uses structured SVG data and a typed registry; keep templates deterministic and independent of network/AI services.

Composition layers are depth-sorted groups. Explicit `group` nodes support one level of child leaf nodes; child coordinates use the 1080×1920 local canvas and scale into group bounds.

## Add a template

1. Add stable ID to `templateIds` in `src/domain/research.ts`.
2. Add a distinct `case` to `defaultVisualComposition()` in `src/domain/visual-defaults.ts`. Compose allowlisted Shapes, Paths, Text, Icons, Images, or Diagrams in named depth layers. Do not infer objects from `visualDescription`.
3. Add explicit renderer entry in `src/video/renderer-registry.tsx` with label, capabilities, default composition, and component. Registry must remain exhaustive; do not add a generic visual fallback.
4. Add/adjust a sample Research Package and its source references. Add it to `scripts/visual-regression.ts` coverage where relevant.
5. Run `npm test`, `npm run typecheck`, `npm run build`, `npm run test:visual`, and sample render. Review generated PNGs before updating committed hashes in `scripts/visual-goldens.json`.

## Add an asset

1. Prefer `Icon`/`Shape`/`Path` primitives. For raster/vector files, add a small local file under `public/assets/`; never fetch at render time.
2. Record provenance/license in this guide. `cloud.svg`, `lightning.svg`, and `sun.svg` are original in-repository SVGs authored for V1.0.2; no third-party asset is bundled.
3. Add stable asset ID to `trustedImageAssets` in `src/domain/visual-composition.ts`, map it to exact local filename in `src/video/visual-primitives.tsx`, then reference ID from package JSON. Do not accept paths, URLs, SVG markup, or user-controlled filenames.
4. Add golden-frame coverage and inspect output for clipping, contrast, and safe-area fit.

## Existing registry

`mountain-reveal`, `plate-collision`, `folding-uplift`, `himalaya`, `volcano`, `infographic`, `space-orbit`, and `animal-habitat` each have separate default composition and registry entry. Reusable SVG rendering is shared through primitives; old V1 renderer stays versioned for old job snapshots.
