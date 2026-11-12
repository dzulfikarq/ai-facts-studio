# AI Facts Studio — Tabler Purple Design System

Single source of truth for frontend appearance and interaction standards. This document describes shipped behavior; update it with UI standards changes.

## 1. Design philosophy

AI Facts Studio adapts the clean hierarchy, compact controls, horizontal navigation, and restrained surfaces of the [Tabler Admin Template](https://tabler.io/admin-template/preview) for a video-creation workflow. References: [Tabler repository](https://github.com/tabler/tabler) and [Tabler documentation](https://docs.tabler.io). Purple marks primary actions and active navigation; neutral surfaces carry content; semantic colors communicate real status. No Bootstrap/Tabler CSS or JavaScript is imported. Project data and workflow state outrank decoration.

## 2. Design tokens

Tokens live in `src/client/redesign.css`. Values below are current implementation values.

### Brand, surfaces, and text

| Token | Light Purple | Dark Purple | Use |
|---|---|---|---|
| `--background` | `#F8F7FC` | `#13111C` | App canvas |
| `--surface` | `#FFFFFF` | `#1D1929` | Panels and controls |
| `--surface-raised` | `#FFFFFF` | `#252033` | Elevated surfaces/dialog |
| `--surface-muted` | `#F4F1FA` | `#201B2D` | Inputs and secondary panels |
| `--card-surface` | `#FFFFFF` | `#252033` | Card layer |
| `--primary` | `#7048E8` | `#8B5CF6` | Brand and selected accents |
| `--primary-hover` | `#5936C8` | `#A783FF` | Brand hover accent |
| `--primary-text` | `#5936C8` | `#B99BFF` | Accessible text on selected surfaces |
| `--primary-action` | `#7048E8` | `#7048E8` | Primary button fill |
| `--primary-action-hover` | `#5936C8` | `#5936C8` | Primary button hover |
| `--text-on-primary` | `#FFFFFF` | `#FFFFFF` | Primary action label |
| `--text-primary` | `#24213A` | `#F5F3FF` | Main text |
| `--text-secondary` | `#6F6B83` | `#B6B0C9` | Supporting text |
| `--border` | `#E9E5F1` | `#392F4D` | Subtle borders |
| `--border-strong` | `#D8D2E5` | `#514267` | Form and control borders |
| `--focus` | `#7048E8` | `#B99BFF` | Keyboard focus ring |

Dark primary action fill is intentionally darker than brand token `--primary`, keeping white button text above WCAG AA contrast. Supporting text was also adjusted from palette baseline for readability.

### Semantic colors

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `--success` / `--success-soft` | `#28734F` / `#EAF5EE` | `#8CD5A8` / `#1E352B` | Completed, approved |
| `--warning` / `--warning-soft` | `#8A5A0A` / `#FFF4DB` | `#F0C36B` / `#3B3020` | Needs attention, pending |
| `--danger` / `--danger-soft` | `#B42332` / `#FFF0F0` | `#FF929B` / `#40262D` | Error or destructive state |
| `--danger-action` | `#B42332` | `#9E2938` | Destructive button fill |
| `--info` | `#52617A` | `#B6C4E0` | Neutral secondary information |

### Shape, spacing, and elevation

| Tokens | Values |
|---|---|
| Radius | `--radius-sm: 8px`, `--radius-md: 12px`, `--radius-lg: 16px`, `--radius-pill: 999px` |
| Spacing | `--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`, `--space-6: 24px`, `--space-8: 32px` |
| Shadows | `--shadow-sm`, `--shadow-md`; soft, low-contrast elevation |
| Focus | 3px visible ring; 2px offset where applicable |

### Typography and controls

| Token | Value | Use |
|---|---:|---|
| `--font-size-page` | 30px | Page title reference; responsive titles use 28–32px |
| `--font-size-section` | 19px | Section headings |
| `--font-size-card` | 16px | Card and panel headings |
| `--font-size-body` | 14px | Body copy |
| `--font-size-control` | 14px | Form values and control labels |
| `--font-size-label` | 13px | Form labels |
| `--font-size-meta` | 12px | Supporting copy and status metadata |
| `--control-small/default/large` | 36/42/48px | Button and control heights; icon-only buttons use 44px hit areas |
| `--icon-compact/standard/prominent` | 16/18/20px | Lucide controls and emphasis |

Plus Jakarta Sans is shared across app UI. Monospace is reserved for code, JSON, and numeric editor data. Dense editor timeline ticks may remain 10px where available width is constrained; never use that scale for instructions or form content.

### Contrast

Core text/action pairs measured against current surfaces meet WCAG AA: light primary text on canvas 14.55:1; light secondary on white 5.11:1; light white-on-primary action 5.55:1; dark primary text on canvas 17.02:1; dark secondary on card 8.21:1; dark selected text on selected surface 5.64:1; dark white-on-primary action 5.55:1. Recheck contrast when changing tokens. These measurements do not certify every content-specific status or generated visual.

## 3. Theme system

- Preferences: `light`, `dark`, `system`; default `system`.
- Preference key: `ai-facts-studio:theme` in `localStorage`.
- `index.html` bootstrap script resolves and applies theme before React paints, setting `data-theme` and `data-theme-preference` on `<html>`.
- `src/client/theme-system.tsx` owns `useThemePreference`, `ThemeSwitcher`, and `AppearanceSettings`.
- `useThemePreference` applies changes without reload. System mode subscribes to `matchMedia("(prefers-color-scheme: dark)")` and removes its listener on cleanup.
- CSS themes are semantic variables in `src/client/redesign.css`; native controls follow `color-scheme`.
- Theme state is independent from research `visualPreset`, storyboard art direction, and Remotion. Theme changes do not mutate video data or render output.
- Quick switcher is in top navigation. Settings → Appearance offers same three choices.

```tsx
const [theme, setTheme] = useThemePreference();
<ThemeSwitcher preference={theme} onChange={setTheme} />
```

## 4. Typography and icons

- Font: Plus Jakarta Sans, loaded in `index.html`, with Segoe UI/Arial fallback. Use monospace only for code/JSON and numeric timeline data.
- Hierarchy: page headings 28–32px; section headings 19px; card headings 16px; body/controls 14px; labels 13px; metadata 12px. Dense timeline ticks may use 10px; do not shrink instructions or form content.
- Icons: `lucide-react`; use 16px compact, 18px standard, 20px prominent. Decorative icons use `aria-hidden`; icon-only controls need accessible labels and 44px hit areas.

## 5. Layout and navigation

- **Horizontal top navigation:** AI Facts Studio brand, Beranda, Buat Video, theme switcher, and Pengaturan appear on every route, including workspace. Settings stays rightmost so shared content edge aligns to its control. Labels collapse on narrow screens; accessible names remain. No global sidebar or fake account avatar. Workspace save stays available in its editor/workflow context.
- **Shared page alignment:** Every `.page.layout-container` uses equal horizontal gutters (`clamp(18px, 4vw, 56px)`), matching topbar's outer padding. Editor panels and workflow steps share those edges; no control-measured asymmetric insets.
- **Project Saya:** dashboard and project library are one page. Project search filters local project data. Cards use actual title, category, scene count, update date, job status, and available duration. Missing thumbnails use a neutral surface/icon placeholder, not gradient artwork or fabricated project data. Initial project loading uses non-animated skeleton cards until the API responds.
- **Create Video:** two mode cards offer **Generate with AI** and **Buat Manual**; AI stays first/default. Inputs remain mounted while switching modes. Manual asks for title, language, target duration, delivery style, and extra instructions; source URLs stay under Advanced. Both modes share the per-project Outro selector. JSON import stays under Advanced and sample flow remains available. Manual creation calls the existing project API only, stores origin/brief metadata, and opens Materials. Because Research Package requires a non-empty scene and narration, a new manual project starts with one clearly unfinished placeholder; it has no fabricated facts, and user-entered sources stay unverified. No audio, Flow assets, or approvals are created. Double submit reuses an idempotency key. Dashboard badges identify Manual and AI origins; older records normalize to `legacy` without content rewrite.
- **Workspace:** the same global navigation remains visible. Editable project title, save state/action, and six workflow steps remain available. Video Editor keeps one scene rail, 9:16 canvas, toolbar, timeline, and Inspector; only active Inspector tab content is mounted. No global sidebar.
- **Settings:** `/settings` opens General; `?section=` selects Appearance, AI Generation, Outro Library, or Preferences. Desktop uses a two-column settings layout with purple active indicator; navigation collapses to a compact grid on mobile. General shows live project/tool availability; Preferences summarizes the actual theme and new-project outro defaults without duplicating controls. Appearance uses Light/Dark/System choice cards. Outro Library retains upload, preview, rename, default, and confirmed delete actions, with explicit empty state and default-use banner. Theme, AI Generation mode, and local media remain separate.
- **URL state:** `/`, `/create`, `/settings`, and `/settings?section=...` identify top-level pages and Settings section. Browser Back/Forward and refresh restore the active section. `/projects/:id/editor` identifies Video Editor; other workspace steps use `?step=...`, and `?scene=...` restores selected scene. Legacy `?step=visual`, `?step=editor`, `/editor`, and stored `visual`/`editor` steps resolve to Video Editor without rewriting project data. Invalid steps fall back to Materials; invalid scene IDs fall back to first scene. Direct project URLs load persisted project data and apply existing workflow guards.
- **History and unsaved work:** app navigation writes browser history. Back/Forward uses guarded route transitions; canceling a guarded transition restores the prior history position without adding duplicate entries. Workspace drafts prompt to save before leaving, Create AI/manual drafts prompt before discard, and browser unload uses native unsaved-change protection.

## 6. Global component standards

Reusable visual patterns are CSS-backed and shared in `src/client/redesign.css`, `styles.css`, `workflow.css`, `workspace-refinement.css`, `tts.css`, and `visual-storyboard.css`. Reuse existing patterns before creating wrappers or feature-specific lookalikes.

| Pattern | Current implementation | Standard |
|---|---|---|
| Button | `.button` with `.button-primary`, `.button-light`/`.button-secondary`, `.button-outline`, `.button-ghost`, `.button-destructive` | Primary for main action; light for secondary; small/default/large sizes use existing classes/tokens; native `disabled`; visible focus; 42px default minimum |
| Icon button | `.topbar-icon`, `.project-card-delete`, `.icon-button` | 44px hit area; accessible label; destructive color only for destructive action |
| Input / textarea / select | Native controls with global app styles | Visible label, helper/error text, 42px default minimum where feature layout allows, focus ring |
| Checkbox / range | Native inputs | Accent uses primary token; keep native keyboard behavior |
| Mode choices | `.create-mode-switch`, `.audio-source-tabs` | Selected state clear; use native button pressed state and keyboard focus |
| Card | `.project-card`, `.workspace-step-panel`, `.ai-provider-card`, etc. | Surface token, subtle border, consistent radius, low shadow |
| Badge | `.status-chip`, `.settings-status-pill`, workflow status | Status derives from actual app state; use semantic status color |
| Dropdown / tooltip | Native `select`, theme `<details>`, native `title` | Prefer platform keyboard behavior; no custom menu or tooltip wrapper without need |
| Toast | `.toast[role="status"]` | Shared app message, dismissible, concise result/error feedback |
| Alert | `.workflow-alert` and feature-specific alert classes | `role="alert"` for urgent errors; do not hide validation or gate warnings |
| Loading / skeleton | `.confirm-spinner`, `.project-card-skeleton` | Use only for a real pending operation; skeleton is static and replaced by API data |
| Progress | Native `<progress>`, `.progress-track`, Google Flow batch progress | Reflect actual backend/request progress; never invent progress |
| Empty state | `.project-empty` | Explain current state and offer relevant next action |

Visual patterns are shared through CSS tokens/classes rather than wrapper components. Native `title` is the only tooltip pattern; there is no custom tooltip or standalone dropdown-menu component. Add one only when a shipped interaction needs more than native behavior. Existing feature-specific forms and review panels remain in their current components.

## 7. Dialog and confirmation standards

`ConfirmationDialog` in `src/client/main.tsx` is the shared confirmation overlay; native feature `<dialog>` elements use the same surface, border, backdrop, focus, and responsive tokens from `src/client/redesign.css`.

- Anatomy: contextual Lucide icon, title, description, optional content/error, cancel, confirm; tones are primary, warning, and destructive.
- Warning/destructive confirmations use `role="alertdialog"`; destructive action is red. Normal confirmations use `role="dialog"` and purple action.
- Trap Tab/Shift+Tab within visible enabled controls; focus returns to trigger on close; Escape and backdrop cancel when safe.
- Async `onConfirm` keeps dialog open, sets `aria-busy`, prevents duplicate submit/cancel/dismiss, shows pending feedback, and surfaces failure for retry.
- Use async confirmation for operations such as saving or deleting when user should see pending/failure in dialog. Keep important risk wording intact.
- Never use `window.confirm()` or `window.alert()` for application actions.

```tsx
await askConfirmation({
  title: "Simpan draft sebelum keluar?",
  message: "Perubahan belum tersimpan.",
  confirmLabel: "Simpan draft",
  onConfirm: async () => {
    if (!await saveProject()) throw new Error("Draft belum tersimpan.");
  },
});
```

## 8. Workspace UX standards

`src/client/workflow.ts` exposes six ordered steps: **Materi & Storyboard → Narasi → Video Editor → Review → Preview Video → Render & Download**. Keep page, project, step, and selected scene URL-backed. `/projects/:id/editor` is canonical Video Editor route; legacy `visual` and `editor` step aliases map there.

1. **Materi & Storyboard:** edit research, copy, references, and metadata; add scenes at end with a 5-second draft (maximum 30 scenes / 120 seconds), reorder scenes with stable IDs and preserved per-scene durations/references, or delete scenes after explicit confirmation. Reorder reflows timeline positions; deletion closes the timing gap while retaining remaining scene IDs, authored visual state, and approvals. References can be added/edited/deleted; new references have no `checkedAt` and display as unreviewed. Save state remains explicit. AI and Manual creation both open this step; Manual starts with its unfinished placeholder and no approvals.
2. **Narasi:** upload/preview audio or explicitly choose manual timing. Every scene needs completed narration before TTS or audio upload; placeholder copy is excluded from voice scripts and server rejects incomplete drafts. Pending AI voice stays separate from active audio until approval.
3. **Video Editor:** one editor mounts scene list, shared Remotion preview/timeline, and Inspector. Inspector tabs are Visual, Gerak, Klip, Teks, Transisi, Audio. Keep prompt creation in Visual, Motion Direction/Beats in Gerak, clip timing in Klip, overlays/captions in Teks, inter-scene transitions in Transisi, and narration monitoring in Audio. **Allow entry when Quality Gate has issues or approvals remain pending** so users can repair/edit; save is required before advancing. Visual approval and quality checks still gate Review, Preview, and Render.
4. **Review:** show source and scene warnings, timing, caption phrases, and manual fact-review state; subtitle editing remains in Video Editor.
5. **Preview Video:** interactive 9:16 preview; playback/review state is required before render and does not create a production render job.
6. **Render & Download:** show actual readiness, job state/progress/errors, audio validation, and available MP4 download.

Workflow status is derived from current project/save/review/job state. UI redesign must not weaken save, visual approval, audio match/approval, review, preview, snapshot, quality, or render checks. Editing narration timing offers retime, keep authored timeline, or cancel; retiming preserves scene IDs and authored visual state while scaling/clamping scene-relative Motion Beats.

### Outro Library

- Settings → **Outro Library** stores user-uploaded MP4s locally; no sample MP4 is bundled. Uploads normalize to local H.264/30 fps media with poster and verified hash/metadata. Library supports rename, browser preview, one default, and safe delete/archive. Empty state offers first upload; a banner identifies default behavior for new projects.
- Create Video starts with current library default or explicit **Tanpa Outro**. Project stores its own selected asset and settings; changing library default never mutates existing projects.
- Video Editor → **Pengaturan Video** owns outro selection, enablement, trim, and opt-in original audio, separate from scene Inspector. Outro is its own timeline segment after scenes; Remotion preview and V6 render use same media and trim, without scene overlays.
- Missing or changed media surfaces an error; never silently substitute another outro or still. Delete archives assets referenced by projects or immutable snapshots; cleanup waits until references are gone.
- Library cards reflow responsively; Create Video controls stack at 620px. Native file/select/video/dialog controls, labelled settings tabs, visible focus, reduced-motion support, and Light/Dark/System tokens remain required.

### Video Editor V2

- One `VideoEditorV2` mount serves the Video Editor step. `VisualStoryboard` remains authored state; `applyVisualStoryboard()` feeds the existing Research Package and Remotion composition. Legacy route/step aliases do not migrate or rewrite project records.
- Desktop layout is scene rail → 9:16 Remotion canvas, with Inspector collapsed by default. Selecting a scene opens Inspector; its toolbar toggle and close button collapse/reopen it without changing selection. When open, Inspector content scrolls internally and sticky footer keeps scene approval available. At narrow widths, Inspector opens as a bounded overlay; scene rail and timeline scroll horizontally rather than overflowing the viewport.
- Scene selection, playback, scene-boundary seeking, and timeline seeking use the same `@remotion/player` instance. Paused scene selection starts one second into the scene to show authored artwork after its initial fade; whole-video playback and final render retain frame-zero timing. Imported video clips have a separate timeline track keyed by stable scene ID; Motion Beats remain independently stored.
- Inspector tabs are **Visual**, **Gerak**, **Klip**, **Teks**, **Transisi**, **Audio**. Visual owns sources/import, Google Flow prompt/style lock, fit/crop, composition, quality issues, and scene approval; HF controls appear only after explicit AI Image API selection. Gerak owns Motion Direction and Motion Beats; Klip owns scene duration, trim, loop/freeze, and audio-sync timing; Teks owns captions and overlay toggles; Transisi owns Cut/Crossfade/Slide/Wipe; Audio monitors active narration and links back to Narasi. Approval controls appear only in Visual. Tabs retain selected scene/playhead, support keyboard arrow/Home/End navigation, and mount only active panel content.
- Raster position, aspect-preserving resize, fit, position, scale, and reset update existing `VisualComposition` image node. Image is one object; no internal bitmap subject/layer editing is implied. Keyboard arrows nudge selected image; pointer drag/resize uses the Remotion SVG viewBox coordinate transform.
- Inspector typography uses a clear compact scale: selected-scene title 15px, section headings 15px, labels/supporting copy 12px, form text 13px. Keep 14px content spacing and 40px minimum Google Flow action targets; preserve scroll, focus, and theme behavior.
- Procedural geometry remains visible as a draft and is not labelled as the main illustration. Scenes without imported raster or AI Vector show **Perlu Ilustrasi**; the editor blocks explicit approval for these drafts. Imported artwork still requires review and separate approval.
- Editor preview and export use `VersionedVideo` and the same scene composition, video clips, captions, transitions, and audio props. Editor-only selection handles/callbacks are optional props and are absent in review/render snapshots. Vite proxies `/audio`, `/visual-assets`, and `/scene-media` to the local API so dev preview reads the same persisted files as rendering.
- Optional **Visual World** stores one shared base composition and a semantic manifest for every stable layer ID. Visual Inspector lists each layer ID and semantic role; procedural sample worlds are labelled drafts, not final artwork. `compositionOverride` lets only targeted scenes render distinct art while retaining the shared base for other scenes. **Gunakan untuk Semua Scene** is explicit and confirms its impact; affected approvals reset, Motion Beats stay persisted, and missing targets become Quality Gate repair issues. Per-scene and batch imports never detach or broadcast over the shared base. Raster art remains one image layer; semantic roles do not imply automatic bitmap segmentation.
- The Video Editor **Gerak** tab edits per-scene Motion Direction and projects persisted `MotionAction` records as separate **Motion Beats**. Timeline clips select/seek to beats and drag or arrow-nudge start time; scene-relative duration, description, target layer/role, easing, and overlay style update the existing storyboard action. Selecting a path exposes canvas handles; pointer drag and arrow keys edit bounded 1080×1920 points. SVG overlay paths and particles render deterministically through Remotion in preview/export; editing handles exist only in the editor. Timing remains approximate without word alignment.
- The volcano process fixture carries reservoir fill, conduit magma, eruption plume, lava, and deposits across its six shared-world scenes. Motion overlays fade after each beat; camera drift spans the sequence. Rendered review files are silent procedural fixtures, not approved Flow artwork or production narration.
- Google Flow is the primary manual visual path: new scenes default to animation prompts; existing storyboard records without a saved mode keep still-image behavior. Saved prompts, Style Lock, preview-first import, batch/prompt packs, and stable scene IDs all use the existing project workflow. Still images remain composition image nodes. Video clips are separate scene media; importing one replaces active scene artwork without deleting its composition or Motion Beats. Motion Beats are not automatically layered over clips. No Flow API or automated generation runs on open, preview, motion, or render.
- New AI scenes start with no added motion effect and `Cut`; imported manual/legacy packages retain authored motion configuration. Video Editor owns Motion Direction/Beats, scene duration, clip trim/loop/freeze, title/subtitle/branding, narration monitoring, and Cut/Crossfade/Slide/Wipe transitions. Transition preview uses the shared Remotion Player and selected incoming scene plus its predecessor.
- TTS duration changes offer **Retiming**, **Keep timeline**, or **Cancel**. Retiming preserves stable scene IDs, media, compositions, Shared VisualWorld, Motion Beats, edits, and approval history; Motion Beats scale/clamp to each new scene span. Keep timeline preserves authored boundaries.
- Save goes through existing project persistence. Artwork/copy/Motion Beat changes mark affected scenes unapproved and recalculate fingerprints; transition, trim, scene duration, and title/subtitle overlay edits preserve artwork approval. Immutable snapshots and referenced files retain existing protections. Renderer V6 is current; renderer versions 1–5 remain supported. Theme preference remains app-shell state, separate from video/render data.
- Visual approval and Quality Gate block progression to Review/Preview/Render, not entry to Video Editor. Six-step workflow remains URL/history-backed.

Known V2 limits: Video Editor has no scene reorder/duplicate controls; scene ordering and add/delete stay in Materi & Storyboard. No undo/redo, independent headline typography/position editor, audio mixing, or independent raster-subject layers. Art quality still depends on selected/local artwork: existing mountain sample retains its procedural illustration, and editor UI alone does not make it production-quality. AI Image remains opt-in and needs configured provider/user consent.

### Illustration authoring and Asset Library

- Scene source controls distinguish Google Flow, Asset Library, Upload Gambar, AI Vector, and AI Image API (Advanced); each scene remembers its selection across scene changes and reload. Source choice never changes Development/Production mode. Procedural geometry is a visible draft, not a substitute for main illustration.
- AI Image uses a Hugging Face adapter only when explicitly selected and `HF_TOKEN`, `HF_IMAGE_GENERATION_ENABLED=true`, and `HF_IMAGE_ALLOW_PAID=true` are configured server-side. Unconfigured state gives one setup message; no empty Model selector or inactive Generate button. Configured model/resolution, editable prompt, status, and unknown-cost disclosure stay in Advanced. Shared confirmation required for each one-image request; store and preview local candidate before explicit apply. Google Flow manual workflow does not need `HF_TOKEN`.
- Never claim image generation is free: account balance, remaining credits, and per-image billing are unavailable to this app. Storyboard opening never generates; renderer never calls providers.
- Import controls accept PNG/JPEG/WebP, show editable license/provenance, and retain prompt/provider/model metadata when user marks source as externally AI-generated. That label records user-provided provenance; it does not verify origin.
- Smart Asset Library uses native `<dialog>`, semantic tabs, native search/select controls, and shared surface/button/focus tokens. Search results are paginated; online requests happen only after explicit search/selection. Cross-project reuse links the same content-addressed file; no duplicate copy. Deletion stays blocked while any scene, reusable template, or immutable render snapshot references asset.
- Openverse imports allow CC0, Public Domain Mark, CC BY, and CC BY-SA only; selection is re-fetched and license-checked before a local raster copy. Never bulk-download, render from remote URLs, or claim license/relevance is independently verified.
- Tabler icons are generated from pinned local metadata and sanitized path nodes; preserve the package MIT notice. Icons are supplementary objects, not substitutes for complete educational illustrations.
- Reusable-scene templates copy composition/layout/motion/asset references, not source scene title or narration. Every destination scene still needs semantic review and fresh approval.
- Asset Library modal reflows at 900/620/360px, uses visible `:focus-visible` rings and native keyboard behavior, and suppresses nonessential motion under `prefers-reduced-motion`. Theme comes from root Light/Dark/System preference; never tie it to video data.
- Raster thumbnails, preview, and Remotion use same composition and fit/position data. Human semantic/crop/provenance confirmation and separate scene approval remain required.
- Keep source picker and metadata form wrapped on narrow screens; preserve keyboard-operable native file input/dialog, visible focus, reduced-motion support, and Light/Dark/System themes.
- Visual Storyboard exposes one **Siapkan Semua Ilustrasi** batch and per-scene **Ubah Ilustrasi** source chooser. Show Ready for Review / Needs Attention / Approved separately; persist batch progress across refresh/reopen and offer selective retry. Manual, approved, selected-image, and already-ready art stay untouched unless user confirms replacement.
- Smart Hybrid order is structured reusable scene → relevant local illustration → local composer. Require object/process, style/palette, local availability, and known license fit; if fit fails, keep Needs Attention with explicit alternatives. Never call AI Image automatically. Every result still needs human review and separate approval.
- Native source dialog uses labelled heading, moves keyboard focus inside, fits 390px viewport, retains visible focus, and honors reduced motion/theme tokens. Keep workflow progress and scene data separate from theme/video rendering.

### Google Flow manual visual workflow

- Google Flow is an external workstation at `https://flow.google.com/`. AI Facts Studio builds and stores prompts; users generate/import manually. Still mode accepts PNG/JPEG/WebP; animation mode accepts MP4/GIF. No Flow API, browser automation, scraping, or render-time generation is used.
- Style Lock, per-scene prompt/status, stable scene token, recommended filename, and local reference asset IDs live in the existing SQLite-backed `VisualStoryboard` JSON. Reference images remain local; users upload them to Flow manually when useful. Prompt-only/Style Lock edits do not change rendered output or scene approval fingerprint.
- New scenes default to animated-video mode; parsing older storyboard data without mode fields defaults to still-image. Prompt mode is saved per scene and does not change active visual until media is imported. Prompt packs export Markdown/JSON and honor each scene's mode. Still prompts request one premium 2D editorial educational illustration; animation prompts request one moving visual process. Both specify portrait 9:16, no generated text/panels, scene meaning, scientific constraints, Style Lock, safe space, and optional previous-scene style guidance. Prompt consistency is approximate, not guaranteed.
- Scene token derives from `sceneId`, not order/headline. Filename includes current scene number/slug plus token. Batch matching prioritizes stable token, exact recommended filename, unambiguous scene number, then unique headline slug; duplicates, mismatches, and multiple files targeting one scene require manual review. Only unique, non-skipped assignments apply.
- Single import previews before apply. Batch review shows filename, preview, match/error/duplicate hints, assignment and skip controls; animated and still files must use separate batches. Invalid or oversized rows can be skipped without blocking valid files. Only unique, non-skipped assignments upload. Existing target approval replacement requires confirmation. Batch sends groups of up to three files per request, matching server validation concurrency and bounding multipart memory. Server retains per-file partial success. Successful files leave retry list; retry sends only remaining rows. Dialog reports actual upload percentage/completed-file count, then indeterminate validation/optimization progress; requests time out after 120 seconds with a retryable error. Still imports use raster signature validation, optimization, content-addressed image assets, and Remotion image nodes. Video imports probe source metadata, verify MP4/GIF streams, normalize locally to H.264/30 fps MP4, extract a poster, and bind content-addressed files by stable scene ID. Uploaded provenance is user-reported, not independently verified.
- Google Flow portrait imports use a 1080×1920 full-frame image node with proportional `cover` crop; no stretching. Per-scene overrides, asset references, preview thumbnails, immutable render snapshots, and Remotion render all resolve through the same effective-composition rule: scene override → Shared VisualWorld → legacy scene composition.
- Imported raster is one image layer for transform, fit/crop, motion, preview, and render. Video uses independent trim, fit/crop position, short-clip loop/freeze, and opt-in audio controls; audio is off by default. Freeze posters follow trim-out. A video clip replaces the active visual during preview/render while preserving composition and Motion Beats in project data; Motion Beats are not overlaid automatically. Headlines/subtitles remain separate. Renderer V6 supports snapshots V1–V5. Immutable snapshots, file hash/metadata checks, approvals, and quality gates remain active.
- Render stack is background → primary visual → overlay SVG. Isolated stacking keeps title/subtitle/branding above moving media and outside visual transforms/transitions. Title and subtitles default on; branding defaults off for new packages. Explicit saved overlay preferences remain unchanged; readability shading only renders when related overlays are enabled.
- Scene audio must be explicitly enabled. Enabled clip audio is normalized to AAC and validated as media audio (separate from narration loudness/script validation); render status asks users to listen for content and sync. No audio mixing controls are provided.
- Watch Folder is deferred. User-selected folder permissions, complete-write detection, duplicate tracking, and safe cross-platform monitoring are not established; explicit batch import is the supported path.
- POC exports live under `artifacts/google-flow-poc/`. Browser/API smoke fixtures are local synthetic or supplied images, not generated by Google Flow and not quality evidence for final educational artwork.

### Motion Direction and Motion Beat

- `ResearchPackage.scenes[].motionPlan` is canonical per-scene Motion Direction state; `motionCues` stays synchronized as its legacy cue list. `applyVisualStoryboard()` preserves plans across navigation, save/reload, and artwork updates, retargeting a removed layer to the whole scene rather than discarding its timing. Optional direction/intensity fields keep older packages valid; legacy packages with both Cut and Dissolve normalize to Cut, matching prior renderer precedence.
- Video Editor → Gerak exposes Fade In, Slide, Scale, Pan, Zoom, Parallax, Reveal, and Pulse. New AI scenes default to no added effects and Cut; manual/legacy packages retain authored motion. Compatible effects may combine. Controls show relevant direction/intensity fields, target, delay, duration, and easing. `Hapus semua efek` clears motion effects while preserving the scene transition.
- Video Editor → Transisi exposes one incoming-scene transition: Cut, Crossfade, Slide, or Wipe. Controls include delay, duration, direction, and easing where relevant. `Pratinjau transisi · 2 scene` uses the shared Remotion Player and keeps outgoing/incoming scene pair selected during playback. Preview and MP4 use the same `VersionedVideo` renderer and persisted `motionPlan`.
- Video Editor → Gerak `Pratinjau Efek` seeks and plays the selected scene through the same Remotion Player. Playback frame, selected scene, and timeline remain synchronized; button can replay.
- Static compositions apply effects to selected Remotion layers; imported raster is one layer. GIF/MP4 applies compatible effects to the entire clip, never to objects inside flattened media. Motion Beat is separate overlay/process state and is not automatically overlaid on animated clips; existing beats remain persisted.
- Materials → Storyboard has no duplicate Motion Direction cue editor or motion-plan JSON editor; canonical settings stay in Video Editor → Gerak.
- Motion Beat intensity uses a labelled native select (Subtle/Balanced/Expressive); Balanced is default. Per-scene beat plans expose action type, target, duration, approximate/aligned timing, and manual Approve state. Preset Motion Beat remains separate from Motion Direction.
- Motion preview uses a native range input to seek deterministic Remotion frames. Keep it keyboard-operable, responsive, visibly focused, and explicit that approximate timing is not word-level audio alignment.
- Motion Beat clips use the existing timeline track and theme tokens, stay horizontally scrollable on narrow screens, expose accessible names/focus, and open the matching inspector. Canvas path points support pointer and keyboard editing; reduced-motion CSS only suppresses nonessential editor UI transitions, not authored video playback/render output.
- All-scene motion preparation shows durable progress, preserved scenes, partial failures, cancel, and selective retry. Opening a project, previewing, and rendering make no AI request.

## 9. Responsive guidelines

- Base layout supports 320px minimum; target mobile range includes 360–430px. Outro Library cards auto-fit available width; Create Video outro controls stack below 620px.
- Main redesign breakpoints: 1050px (project grid 3→2 columns; settings stack), 950px (workflow stepper becomes horizontally scrollable), 700px (compact topbar and scrollable workflow), 520px (single-column project cards, icon-only top actions, compact editor/dialog). Page content uses equal gutters matching topbar on every route. The Video Editor scene rail and timeline scroll internally; toolbar/transport wrap on mobile.
- Existing feature breakpoints also apply: 950px workflow stepper becomes horizontally scrollable; 820px workspace/editor columns collapse; 560px tight form and stepper refinements.
- Project cards use 3 columns on wide desktop, 2 on tablet, 1 on narrow mobile.
- Workspace stepper scrolls horizontally instead of compressing labels. Editor and preview stack vertically at tablet widths; 9:16 preview ratio stays fixed.
- Dialog is viewport-bounded, wraps actions on mobile, and keeps touch-sized buttons.
- Check 1440px, 1280px, 1024px, 768px, 390px, 360px, and 320px after layout changes; prevent page-level horizontal overflow. The 320px pass is a narrow-shell check, not the primary target viewport.

## 10. Accessibility guidelines

- Target WCAG AA for text, controls, selected states, and focus. Contrast ratios in §2 cover core palette pairs; manually inspect semantic and feature states.
- Use semantic HTML, explicit labels, accessible names for icon-only controls, and actual state in `aria-pressed`, `aria-current`, or status labels.
- All actions must be keyboard reachable with `:focus-visible` styles. Dialog behavior is specified in §7.
- Async status uses status/alert semantics and actionable error text.
- `prefers-reduced-motion: reduce` removes non-essential animation and smooth transitions.
- Preserve native form controls and their keyboard semantics where practical.

## 11. Developer implementation guidelines

- Tabler Purple tokens, shared navigation/component patterns, and theme-specific overrides: `src/client/redesign.css`.
- Theme hook, switcher, and appearance control: `src/client/theme-system.tsx`.
- Pre-paint theme bootstrap and font metadata: `index.html`.
- App shell, pages, shared toast/dialog, workspace content: `src/client/main.tsx`.
- Workflow state/guards: `src/client/workflow.ts`; step labels: `src/client/WorkflowStepper.tsx`.
- Feature styling: existing CSS files imported from `main.tsx`; add shared visual rules to `redesign.css`, not per-page hardcoded palette values.
- For new UI, use `var(--background)`, `var(--surface)`, `var(--text-primary)`, `var(--text-secondary)`, `var(--border)`, action/status/focus tokens, plus existing button/card/alert classes.
- Use `useThemePreference()` from the root app; never create a second theme store or couple UI theme to video data.
- Add confirmations through `askConfirmation`; use async `onConfirm` for work that needs pending/error feedback.
- Keep API calls, research schemas, TTS, workflow guards, quality gates, and renderer behavior unchanged unless explicitly requested.

```css
.feature-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
}
```

Anti-patterns: hardcoded brand colors, fake user/project data, icon-only buttons without names, ad-hoc confirmation overlays, `window.confirm`/`alert`, theme changes that mutate project state, artificial backend progress, or replacing workflow/renderer checks with presentation-only state.

## 12. Rules for future features

1. Read and follow `design.md` for all frontend work.
2. Reuse existing patterns before adding a new component or dependency.
3. Use semantic tokens instead of hardcoding colors.
4. New components must support Light and Dark themes.
5. Do not style duplicate buttons, inputs, or dialogs independently without a clear reason.
6. Never use native browser confirmation for app actions.
7. Keep spacing, typography, and Lucide icon sizing consistent.
8. Make every UI responsive and keyboard accessible; include visible focus and reduced-motion support.
9. Update this document with any shipped UI standard change.
10. Consider all pages, themes, and workflows before changing shared design rules.
