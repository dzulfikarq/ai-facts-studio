# 2D Visual Storyboard

Workflow: Materi & Storyboard → Narasi → Video Editor → Review → Preview Video → Render & Download. One `VideoEditorV2` contains Visual, Gerak, Klip, Teks, Transisi, and Audio Inspector tabs. Video Editor remains accessible while visual quality issues or approvals are pending; Review/Preview/Render remain guarded. Local deterministic composer remains automatic path; it uses curated vector/shape scenes and no image-generation API. Scene illustration source is independent of Development/Production mode. Legacy `?step=visual`, `?step=editor`, and `/editor` links resolve to Video Editor without rewriting project data.

## Composer and review

`src/domain/visual-composer.ts` maps scene text, focus, allowlisted objects, relations, art direction, and shared-world assets to compositions. Shared objects give context but do not imply scene-specific relations. Manual/approved composition is preserved; replacement requires confirmation. Render thumbnails and MP4 share `VisualCompositionView` and deterministic layer/node motion.

Statuses:

- `ready_for_review`: structural/visual heuristics pass; scene remains unapproved until user approves it.
- `needs_review`: composition exists but human inspection or edits are required.
- `needs_visual_authoring`: required concept/relationship lacks adequate supported art.

Approval fingerprints cover artwork, copy, object/relation plan, source/status, Motion Beats, and imported-media appearance. Material artwork/copy/Motion Beat changes invalidate approval; clip trim/loop/audio, scene timing, transitions, and title/subtitle overlays preserve artwork approval. API rejects stale fingerprints. Quality gate checks renderer-transformed bounds at midpoint, safe area, text overlap, density, visible concepts/relations, upload ownership, and approval integrity. It is deterministic heuristic, not proof of scientific accuracy or aesthetic quality.

## Automatic 2D Motion Director V1

- Motion plans are deterministic local rules over scene narration, visible object relationships, duration, and actual composition nodes. Preview, batch preparation, and Remotion rendering make no AI/provider request.
- V1 supports Subtle/Balanced/Expressive intensity, typed transform/path/draw/particle/reveal actions, bounded keyframes/particles, safe-canvas node references, and scene-duration validation. Scene timing is approximate because word-level audio alignment is unavailable.
- Each scene can be prepared or reviewed separately; persisted all-scene jobs report progress, preserve approved/existing plans, stop on cancel, and retry selected failed/cancelled scenes. Motion changes invalidate approval fingerprints. Historical pre-Motion approvals migrate without false invalidation; immutable snapshots keep old plans and renderer versions.
- Remotion renderer V5 applies declarative actions to SVG layers. Renderer V1–V4 snapshots keep compatible render paths. Preview seek uses native keyboard-accessible range input; no autoplay or external generation.
- Rain falls onto land, mineral particles follow existing river paths, and evaporation animates water vapor only—salt ions stay still. UV shows approach to ozone plus one partial-transmission path; artwork has no wavelength-specific ray identity, so UV-B/UV-C proportions are not simulated. Magnetosphere curves charged particles, never UV. Raster artwork moves only as a whole image; internal objects cannot be separated.
- Automated checks cover target/timing/bounds, deterministic frame positions, raster constraints, stale approval, legacy renderer compatibility, API persistence/idempotency/cancel/retry, immutable motion snapshots, keyboard seeking, and mobile dialog bounds.
- Render evidence (silent H.264/AAC review MP4, manifests, action plans, sampled frame sequences/contact sheets, limitations): `artifacts/motion-director-poc/2026-10-27T07-33-06-248Z/`. Browser Motion Preview screenshots: `artifacts/motion-director-poc/ui-2026-10-27T07-30-00/motion-director-preview.png` and `motion-director-preview-mobile.png`. Renders use reduced review scale (378×672), not production resolution.

## Optional semantic planner

AI planning runs only after clicking **Plan Semantik dengan AI Text**. Development uses selected authorized OpenCode model; Production uses configured Gemini Text model. There is no automatic provider/model fallback. Request returns schema-validated semantic JSON and caches by exact input/provider/model. Composer stays local; AI emits no code or image and no paid image endpoint is enabled. Plan composition type is advisory; mismatches are surfaced for review. Planner has not been live-provider tested in this run.

## Illustration sources and optional AI Image V1

- **AI Vector** remains explicit OpenCode authoring; it returns validated vector composition data and never calls an image endpoint.
- **AI Image** uses a modular Hugging Face Inference Providers adapter pinned to `hf-inference`. It is disabled by default. Server requires `HF_TOKEN`, `HF_IMAGE_GENERATION_ENABLED=true`, and separate `HF_IMAGE_ALLOW_PAID=true`; no token/configuration is exposed to browser. The selected model must appear live for `text-to-image` in the official Hub mapping before one request. No `auto` provider or fallback.
- Hub candidate checked 27 Oct 2026: `stabilityai/stable-diffusion-3-medium-diffusers` was live on `hf-inference`. Candidate is not a quality guarantee; runtime refreshes and validates the model catalog. UI lets user pick live model and 9:16 size (576×1024 or 720×1280).
- Statuses: **Not Configured**, **Ready**, **Generating**, **Rate Limited**, **Quota Exhausted**, **Failed**. HF does not expose account balance/per-image price through this app; pricing, credits, and quota remain unknown. UI warns that request may bill. Per-image custom confirmation is mandatory, server requires `confirmed` and `costAcknowledged`, and request makes one image only.
- AI Image panel uses scene narration, visual direction/focus, object roles, explicit relationships/direction, project style/palette, and safe 9:16 composition. Prompt is editable. Current adapter is text-only: prior-scene consistency uses textual style guidance, not an attached reference image.
- Flow: **Generate Illustration** → explicit cost confirmation → generate and persist local content-addressed asset → preview local candidate → **Gunakan Ilustrasi**. Generation never auto-applies. Applying replaces composition, invalidates approval, and keeps headline/subtitle as Remotion overlays. Full-frame 9:16 fit supports `contain` (default, no crop) and `cover` (review crop). Human semantic/crop/provenance confirmation and separate scene approval remain mandatory.
- Image, SHA-256, prompt, provider/model, timestamp, dimensions, source, repository license tag/model URL, and available response usage/rate headers are retained. Hub response does not certify generated-output license, price, remaining balance, or actual usage; these limits are recorded. Assets enter the existing library and can be reused without generation.
- **Upload Image** and **Asset Library** accept/reuse local raster assets. Library association is cross-project and content-addressed; attaching stores canonical metadata on destination project without copying bytes. Render uses local asset paths only and verifies file hash; no AI request runs during render.
- PNG/JPEG/WebP results are signature/MIME checked, decoded with FFprobe/FFmpeg, dimension-checked, and optionally optimized to WebP. Assets remain protected while referenced by a scene or immutable snapshot.

With no configuration, prompt copy and manual image import remain available; no image generation call occurs.

## User illustration uploads

Project-specific PNG, JPEG, and WebP only; SVG is rejected. Limit: 10 MB, 64–8192 px each side, 40 MP. Backend checks raster signature, MIME match, decoded dimensions, SHA-256 and project references, then can optimize with FFmpeg. Files use content-hash names in `public/visual-assets`; renders verify hashes. Shared files remain until last project/snapshot reference is removed. Uploaded art needs explicit human concept-fit confirmation and separate scene approval; it never auto-approves.

## Smart Asset Library V1

- Local raster assets use the existing SQLite catalog and FTS index; search supports category/type/style/provider/license filters, bounded pagination, local-file availability, project associations, and reference counts. Credits export is CSV for assets referenced by the current storyboard.
- **Asset Packs** searches pinned `@tabler/icons@3.49.0` metadata (tags/category) and imports only a selected local icon. SVG is generated from the package's path-node JSON, allowlisted, and stored as local content-addressed data. Full MIT notice: `public/licenses/TABLER-ICONS-MIT.txt`. Icons supplement, not replace, a complete educational illustration.
- **Reusable Scenes** stores SQLite composition snapshots with scene art/layout/palette/motion/tags/concepts and asset references; source title/narration are excluded. Attach copies the composition into the destination scene, links referenced local assets, increments usage count, and leaves saved template unchanged. Destination review and approval remain independent.
- **Openverse** is opt-in: user presses Search, selects one result, then server re-fetches details and checks current search selection, HTTPS/public DNS, allowlisted license, raster MIME/signature, size, and decode before saving a local copy. CC0, Public Domain Mark, CC BY, and CC BY-SA only; NC/ND/unknown are excluded. Render never uses remote URLs. `CC BY-SA` adaptation/share-alike and all creator/license claims still need human verification. Credits CSV includes creator, attribution, license, license URL, source URL, and provider.
- Import operations are blocked during render/snapshot creation. Approval fingerprints, stale-approval rejection, immutable render snapshots, content hashes, and reference-safe cleanup remain in force. Placement offers background/hero/layer plus fit and position; default reusable-scene discovery is local and makes no AI request.

## Smart Hybrid preparation batch

- **Siapkan Semua Ilustrasi** runs a persisted, serial project job. SQLite stores request hash, status, progress, per-scene outcome, and timestamps. Repeated request IDs replay the same job; changed selection with reused ID conflicts. Running scenes resume after server restart. Refresh/reopen loads latest job; one scene failure does not discard other results. **Perbaiki Scene Bermasalah** retries only unresolved eligible scenes.
- Scene selection order: structured reusable composition with matching objects, visible relationships, style/palette, local referenced files, provenance, and known license; then local raster only for object-focused scenes without required process relationships; then deterministic local composer. Candidate must meet relevance thresholds. Tabler icons and weak/unknown-license or missing files are not auto-selected. Unsupported semantics stay **Needs Attention** with manual source options.
- Only `needs_visual_authoring` scenes are auto-composed. Ready scenes, approved/manual/confirmed art, AI Vector, and selected image compositions are preserved. Smart Hybrid does not call AI Vector or AI Image. AI Vector remains explicit OpenCode authoring with scene, object/relationship plan, and art direction; AI Image remains disabled by default and needs explicit per-image cost consent.
- Batch output is `ready_for_review`, never approved. Human semantic/crop/provenance review and separate approval stay mandatory. Render and preview remain local/deterministic and never call AI.
- Browser/API smoke covers batch idempotency and hash conflict, approval preservation, persisted reopen, progress, selective retry, an unsupported scene remaining Needs Attention, and the 390px accessible source chooser. Screenshots: `artifacts/visual-storyboard-phase2/smart-hybrid-unified-workflow.png`, `smart-hybrid-batch-progress.png`, `smart-hybrid-needs-attention.png`, `smart-hybrid-selective-retry.png`, `smart-hybrid-batch-reopened.png`, and `smart-hybrid-source-picker-mobile.png`.

### Sea-salt and rainbow batch evidence — 27 Oct 2026

- Latest Smart Hybrid acceptance output: `artifacts/visual-storyboard-phase2/smart-hybrid-acceptance-2026-10-27T06-02-29-068Z/` (sea salt) and `...T06-03-08-682Z/` (rainbow). Each job processed 5/5 scenes, ended `completed`, kept all 5 `ready_for_review`, 0 Needs Attention, 0 failed, and 0 approved. Before/after composition and approval fingerprints match: these topics already had adequate art, so Smart Hybrid preserved it rather than regenerate.
- Sea-salt storyboard uses existing local curated/library compositions; rainbow storyboard uses the five hand-authored droplet/rain/sun vector scenes from the sample. This is not new AI art or proof of Smart Hybrid selecting replacements. Latest verified output: `artifacts/visual-storyboard-phase2/smart-hybrid-acceptance-2026-10-27T06-14-32-614Z/` and `...T06-15-14-025Z/`. Contact sheets are `sea-salt-contact-sheet.png` and `rainbow-contact-sheet.png`; silent review renders are `sea-salt-review-silent.mp4` and `rainbow-review-silent.mp4` (H.264/AAC, 378×672, 32.04 sec, renderer V2). Each folder also contains per-scene frames, storyboard JSON, job JSON, and render manifest.
- Visual inspection confirms sea-salt scenes depict dissolved ions, weathering, mountain→river→ocean mineral transport, evaporation, and salinity; rainbow scenes depict sunlight, raindrop refraction/internal reflection, separated colors, and viewing geometry. Rainbow scenes are authored examples, not AI output. All ten scenes remain unapproved. MP4s intentionally have silent AAC; they are visual review evidence, not narration acceptance.
- Live AI Image remains unrun: no token, explicit operator cost approval, or verified price/balance. Existing prism AI Vector PoC is separate and does not prove AI Vector quality for these topics. See `docs/TESTING_AND_LIMITATIONS.md` for remaining limits.

### Phase 2 verification status — 27 Oct 2026

- API smoke verifies bounded Tabler search, safe SVG preview/import, MIT attribution, reusable-scene save/search/attach without source mutation, credits CSV, and cleanup after final references disappear.
- The browser smoke performed a real Openverse search for `river to ocean illustration` and received two real records, but both results described vehicles/boats rather than a relevant educational illustration. Latest screenshot rendered one thumbnail; the second stayed blank (an earlier browser run logged HTTP 502). A follow-up backend fetch validated WebP for both cached URLs. Therefore metadata search works, but reliable UI preview and suitable-image import acceptance are **not passed**. No external image was imported or claimed as educational art.
- No Openverse asset was selected; license/attribution/local storage/reuse/MP4 acceptance remains unverified until operator chooses a relevant result and reviews its terms.
- Evidence: `artifacts/visual-storyboard-phase2/asset-library-cross-project.png`, `asset-pack-tabler-icons.png`, `reusable-scenes-river.png`, and `openverse-search.png`. Asset-library cross-project screenshot uses an explicitly synthetic FFmpeg test raster, not AI art.
- New topic sample `samples/bagaimana-pelangi-terbentuk.json` cites National Weather Service Flagstaff. Five hand-authored vector scenes depict sunlight, rain droplets, refraction, one internal reflection, wavelength separation, and viewing geometry; they use droplet diagrams, not a prism/icon as proof of an atmospheric rainbow. Unit/API/browser smoke confirms schema, visual gate readiness, local preview, and 360×640 H.264 MP4/frame at `artifacts/visual-storyboard-phase2/rainbow-water-droplet-*`. Scenes remain unapproved; visuals are authored test compositions, not an externally imported image.

## PoC and Phase 2 evidence — 26–27 Oct 2026

- Five-scene sea-salt and five-scene Earth protection Storyboards; both quality gates report `ready_for_review`, zero issues, zero approved scenes.
- Full-resolution silent H.264/AAC review MP4s, manifests, scene stills, contact sheets, motion previews, and generic-card before/after: `artifacts/visual-poc-review-2026-10-26/`.
- UI Storyboard screenshots and motion-preview screenshot: `artifacts/visual-review-2026-10-26/ui/`.
- 86 golden renderer frames: `artifacts/visual-review-2026-10-26/visual-regression/`; baselines in `scripts/visual-goldens.json`.

- AI Vector prism PoC: `artifacts/ai-vector-prism-poc-2026-10-26T15-39-54-916Z/`; spec covers white light, triangular prism, and seven spectrum rays. Storyboard/Remotion composition hashes match; gate remains `needs_review` (not approved).
- Raster integration smoke evidence: `artifacts/visual-storyboard-phase2/`. Includes prompt builder, Asset Library cross-project reuse, scene review, Remotion Motion Preview, synthetic-raster MP4/frame, and manifest. Fixture uses FFmpeg `testsrc2`, explicitly **not AI-generated**. Smart Asset Library adds Tabler/reusable-scene/Openverse screenshots described above.
- Rainbow topic evidence: `rainbow-water-droplet-storyboard.png`, `rainbow-water-droplet-scene-preview.png`, `rainbow-water-droplet-smoke.mp4`, and `rainbow-water-droplet-remotion-frame.png`. Hand-authored vector demonstration only; no scene is auto-approved.
- No externally generated AI raster was supplied. Therefore this validates manual import/render/library workflow, not an AI Image-generation PoC or AI-generated-image screenshot.

## Hybrid AI Image V1 verification — 27 Oct 2026

- `npm test` mocks live-Hub model mappings and HF image responses; verifies provider pinning, server Authorization header, dimensions, missing-consent rejection, rate-limit and quota status mapping, river/mineral relations, and ozone/UV absorption prompt.
- `npm run smoke:ai-image` starts API with a test-only fetch interceptor. It verifies one consented mock request, no request without consent, local content-addressed persistence and metadata, cross-project asset attachment without regeneration, explicit apply with stale approval cleared, and 360×640 Remotion MP4 using persisted local file. FFmpeg color/shape PNG is a transport/render fixture only, **not generated educational art**; test temp output is removed.
- `npm run smoke:visual-storyboard` verifies default `Not Configured`, empty live-model list and disabled Generate button, manual prompt/import, local raster preview/snapshot/render, and existing Asset Library workflows.
- Live generation was **not run**. Token/operator paid-use authorization and account billing/remaining balance were unavailable; no image charge or fallback occurred. River and ozone prompts are tested, while science-ready AI-generated images for those scenes remain unproven.

Rebuild POC with `npm run poc:illustrations`; set `ILLUSTRATION_POC_DIR` to a new path because script refuses to overwrite artifacts. See `docs/TESTING_AND_LIMITATIONS.md` for checks and remaining limits.
