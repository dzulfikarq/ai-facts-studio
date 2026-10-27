# AI Facts Studio UI/UX Design System

Single source of truth for frontend appearance and interaction standards. This document describes shipped behavior; update it with UI standards changes.

## 1. Design philosophy

AI Facts Studio is a Modern AI Creative Studio: quiet, minimal, cinematic, and focused on creating or continuing a video. Purple identifies primary actions; neutral surfaces carry most content; semantic colors communicate status. Project data and workflow state stay more prominent than decorative metrics. Shared tokens and interaction patterns keep pages coherent.

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

- Font: Plus Jakarta Sans, loaded in `index.html`, with Segoe UI/Arial fallback.
- Hierarchy: page headings 30–40px; workspace/section headings 16–22px; body 13–15px; helper/status text 11–13px. Use weight 400–750 and readable line-height; avoid dense all-caps body copy.
- Icons: `lucide-react`; use 16–18px for controls and 22–28px for larger empty states. Decorative icons use `aria-hidden`; icon-only controls need accessible labels.

## 5. Layout and navigation

- **Top navigation:** AI Facts Studio brand, Beranda, theme switcher, Settings, and primary Buat Video action. No fake account avatar. On narrow screens labels collapse but accessible names remain.
- **Shared page alignment:** Every top-level `.page` uses `.layout-container`, bounded by Beranda's left edge and Pengaturan's right edge. Workspace keeps invisible brand and primary-action slots so Project Saya back and Settings occupy same anchors. No guessed content `max-width`; compact header keeps controls and content from overflowing.
- **Project Saya:** dashboard and project library are one page. Project search filters local project data. Cards use actual title, category, scene count, update date, job status, and available duration. Missing thumbnails use a neutral branded placeholder, not fabricated project art.
- **Create Video:** Generate with AI is selected and first; JSON import and sample flow remain available. Generation stays click-triggered; drafts can be reviewed before project creation.
- **Workspace:** contextual back button, editable project title, save state/action, and workflow stepper. Scene list/editor stays contextual to Storyboard. No global sidebar.
- **Settings:** appearance preference plus existing AI provider configuration. Theme and AI Generation mode remain separate.

## 6. Global component standards

Reusable visual patterns are CSS-backed and shared in `src/client/redesign.css`, `styles.css`, `workflow.css`, `workspace-refinement.css`, `tts.css`, and `visual-storyboard.css`. Reuse existing patterns before creating wrappers or feature-specific lookalikes.

| Pattern | Current implementation | Standard |
|---|---|---|
| Button | `.button`, `.button-primary`, `.button-light` | Primary for main action; light for secondary; native `disabled`; visible focus |
| Icon button | `.topbar-icon`, `.project-card-delete` | 38–42px hit area; accessible label; destructive color only for destructive action |
| Input / textarea / select | Native controls with global app styles | Visible label, helper/error text, 46px target where feature layout allows, focus ring |
| Checkbox / range | Native inputs | Accent uses primary token; keep native keyboard behavior |
| Tabs | `.create-mode-switch`, `.audio-source-tabs` | Selected state clear; retain existing role/pressed semantics |
| Card | `.project-card`, `.workspace-step-panel`, `.ai-provider-card`, etc. | Surface token, subtle border, consistent radius, low shadow |
| Badge | `.status-chip`, `.settings-status-pill`, workflow status | Status derives from actual app state; use semantic status color |
| Dropdown | Native `select`; theme switch uses native `<details>` | Prefer platform keyboard behavior; no custom menu without need |
| Toast | `.toast[role="status"]` | Shared app message, dismissible, concise result/error feedback |
| Alert | `.workflow-alert` and feature-specific alert classes | `role="alert"` for urgent errors; do not hide validation or gate warnings |
| Loading / progress | Existing busy labels, `.visual-spinner`, `.confirm-spinner`, `.progress-track` | Reflect real async state/backend progress; never invent progress |
| Empty state | `.project-empty` | Explain current state and offer relevant next action |

No global tooltip, skeleton, or standalone dropdown-menu component exists yet. Do not document or depend on one; add only when a shipped interaction needs it. Existing feature-specific forms and review panels remain in their current components.

## 7. Dialog and confirmation standards

`ConfirmationDialog` in `src/client/main.tsx` is the shared confirmation overlay.

- Anatomy: context icon, title, risk description, optional async error, cancel, confirm; tones are primary, warning, and destructive.
- Warning/destructive confirmations use `role="alertdialog"`; destructive action is red. Normal confirmations use `role="dialog"` and purple action.
- Trap Tab/Shift+Tab within enabled controls; focus returns to trigger on close; Escape and backdrop cancel when safe.
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

Current source of truth `src/client/workflow.ts` exposes **six guarded steps**, because this branch has a separate Visual Storyboard approval stage. Preserve all six status calculations and guards; do not silently fold away the visual quality gate.

1. **Materi & Storyboard:** edit research, scenes, sources, copy, timing, and metadata; save state remains explicit.
2. **Video Editor (Visual Storyboard step):** edit scene art, text, transforms, motion, preview, and per-scene approval. Editor remains accessible when Quality Gate has issues.
3. **Narasi:** AI voice candidate remains separate from active audio until approval; upload and preview controls remain available.
4. **Review & Subtitle:** show source and scene warnings, timing, phrase segments, and manual fact-review state.
5. **Preview Motion:** interactive 9:16 preview; playback/review state is required before render and does not create a production render job.
6. **Render & Download:** show actual readiness, job state/progress/errors, audio validation, and available MP4 download.

Workflow status is derived from current project/save/review/job state. UI redesign must not weaken save, visual approval, audio match/approval, review, preview, snapshot, quality, or render checks.

### Video Editor V2

- The existing `visual` workflow step hosts the editor; no parallel scene store, route, or project schema was added. `VisualStoryboard` remains authored state; `applyVisualStoryboard()` feeds the existing Research Package and Remotion composition.
- Desktop layout is scene rail → 9:16 Remotion canvas, with Inspector collapsed by default. Selecting a scene opens Inspector; its toolbar toggle and close button collapse/reopen it without changing selection. When open, Inspector content scrolls internally and sticky footer keeps scene approval available. At narrow widths, Inspector opens as a bounded overlay; scene rail and timeline scroll horizontally rather than overflowing the viewport.
- Scene selection, playback, scene-boundary seeking, and timeline seeking use the same `@remotion/player` instance. Paused scene selection starts one second into the scene to show authored artwork after its initial fade; whole-video playback and final render retain frame-zero timing.
- Visual/Text/Motion/Audio tabs expose existing supported settings. Visual Inspector persists a per-scene illustration workflow (`Google Flow`, `Asset Library`, `Upload Gambar`, `AI Vector`, or `AI Image API`) in the existing storyboard JSON; missing legacy preferences default to Google Flow. HF controls only appear after explicit AI Image API selection. Raster position, aspect-preserving resize, fit, position, scale, and reset update the existing `VisualComposition` image node. Image is one object; no internal bitmap subject/layer editing is implied. Keyboard arrows nudge selected image; pointer drag/resize uses the Remotion SVG viewBox coordinate transform.
- Inspector typography uses a clear compact scale: selected-scene title 15px, section headings 15px, labels/supporting copy 12px, form text 13px. Keep 14px content spacing and 40px minimum Google Flow action targets; preserve scroll, focus, and theme behavior.
- Procedural geometry remains visible as a draft and is not labelled as the main illustration. Scenes without imported raster or AI Vector show **Perlu Ilustrasi**; the editor blocks explicit approval for these drafts. Imported artwork still requires review and separate approval.
- Editor preview and export use `VersionedVideo` and the same scene composition, captions, transitions, and audio props. Editor-only selection handles/callbacks are optional props and are absent in review/render snapshots. Vite proxies `/audio` and `/visual-assets` to the local API so dev preview reads the same persisted files as rendering.
- Optional **Visual World** stores one shared base composition and a semantic manifest for every stable layer ID. Visual Inspector lists each layer ID and semantic role; procedural sample worlds are labelled drafts, not final artwork. `compositionOverride` lets only targeted scenes render distinct art while retaining the shared base for other scenes. **Gunakan untuk Semua Scene** is explicit and confirms its impact; affected approvals reset, Motion Beats stay persisted, and missing targets become Quality Gate repair issues. Per-scene and batch imports never detach or broadcast over the shared base. Raster art remains one image layer; semantic roles do not imply automatic bitmap segmentation.
- The Motion tab projects persisted `MotionAction` records as editable **Motion Beats**. Timeline clips select/seek to beats and drag or arrow-nudge start time; scene-relative duration, description, target layer/role, easing, and overlay style update the existing storyboard action. Selecting a path exposes canvas handles; pointer drag and arrow keys edit bounded 1080×1920 points. SVG overlay paths and particles render deterministically through Remotion in preview/export; editing handles exist only in the editor. Timing remains approximate without word alignment.
- The volcano process fixture carries reservoir fill, conduit magma, eruption plume, lava, and deposits across its six shared-world scenes. Motion overlays fade after each beat; camera drift spans the sequence. Rendered review files are silent procedural fixtures, not approved Flow artwork or production narration.
- Google Flow is the primary manual illustration path: concise scene actions, saved prompt in a collapsed editor, preview-first single import, project prompt pack/Style Lock under Advanced, and **Import Semua Ilustrasi** in Scene List. Upload, Asset Library, reusable scenes, AI Vector, Smart Hybrid, and AI Image call existing project APIs. No AI request runs on open, preview, motion, or render; one AI Image candidate requires explicit shared confirmation and stays unapplied until user selects it.
- Save goes through existing project persistence. Editing scene fields marks only that scene unapproved and recalculates its approval fingerprint; immutable snapshots and referenced files retain existing protections. Theme preference remains app-shell state, separate from video/render data.
- Visual Storyboard keeps all existing workflow guards and approvals. Quality Gate can block approval/export, never opening the editor. The old six-step workflow remains the persisted navigation model.

Known V2 limits: no scene reorder/duplicate/delete (timeline/audio migration required); no undo/redo; no independent headline typography/position editor; no audio mixing; no independent raster-subject layers. Art quality still depends on selected/local artwork: existing mountain sample retains its procedural illustration, and editor UI alone does not make it production-quality. AI Image remains opt-in and needs configured provider/user consent.

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

### Google Flow manual illustration workflow

- Google Flow is an external workstation at `https://flow.google.com/`. AI Facts Studio builds and stores prompts, then accepts user-downloaded PNG/JPEG/WebP files. No Flow API, browser automation, scraping, or render-time generation is used.
- Style Lock, per-scene prompt/status, stable scene token, recommended filename, and local reference asset IDs live in the existing SQLite-backed `VisualStoryboard` JSON. Reference images remain local; users upload them to Flow manually when useful. Prompt-only/Style Lock edits do not change rendered output or scene approval fingerprint.
- Prompt pack exports Markdown/JSON. Prompts request one premium 2D editorial educational illustration per scene, portrait 9:16, no text/panels, and include project/scene meaning, semantic relations, environment, scientific constraints, Style Lock, safe space, and optional previous-scene style guidance. Prompt consistency is approximate, not guaranteed.
- Scene token derives from `sceneId`, not order/headline. Filename includes current scene number/slug plus token. Batch matching prioritizes stable token, exact recommended filename, unambiguous scene number, then unique headline slug; duplicates, mismatches, and multiple files targeting one scene require manual review. Only unique, non-skipped assignments apply.
- Single import previews before apply. Batch review shows filename, thumbnail, match/error/duplicate hints, assignment and skip controls; invalid or oversized rows can be skipped without blocking valid files. Only unique, non-skipped assignments upload. Existing target approval replacement requires confirmation. Batch sends files in one request; server validates/optimizes up to three concurrently and retains per-file partial success. Successful files leave retry list and stay in Asset Library; retry sends only remaining rows. Dialog reports actual request-byte upload percentage, then switches to indeterminate progress during server validation/optimization instead of inventing a completion estimate. Upload reuses raster signature validation, optimization, content-addressed project asset storage and Remotion image nodes; original filename/MIME/size/hash and user-reported provider/prompt metadata are retained. Provenance is not independently verified.
- Google Flow portrait imports use a 1080×1920 full-frame image node with proportional `cover` crop; no stretching. Per-scene overrides, asset references, preview thumbnails, immutable render snapshots, and Remotion render all resolve through the same effective-composition rule: scene override → Shared VisualWorld → legacy scene composition.
- Imported raster is one image layer for transform, fit/crop, motion, preview, and render. Headline/subtitles remain separately rendered; overlays remain separate. Replacing artwork invalidates its scene approval; immutable snapshots, asset-reference checks, and quality gates remain active.
- Watch Folder is deferred. User-selected folder permissions, complete-write detection, duplicate tracking, and safe cross-platform monitoring are not established; explicit batch import is the supported path.
- POC exports live under `artifacts/google-flow-poc/`. Browser/API smoke fixtures are local synthetic or supplied images, not generated by Google Flow and not quality evidence for final educational artwork.

### Motion Director review

- Motion intensity uses one labelled native select (Subtle/Balanced/Expressive); Balanced is default. Per-scene plans expose action type, target, duration, approximate/aligned timing, and manual Approve state.
- Motion preview uses a native range input to seek deterministic Remotion frames. Keep it keyboard-operable, responsive, visibly focused, and explicit that approximate timing is not word-level audio alignment.
- Motion Beat clips use the existing timeline track and theme tokens, stay horizontally scrollable on narrow screens, expose accessible names/focus, and open the matching inspector. Canvas path points support pointer and keyboard editing; reduced-motion CSS only suppresses nonessential editor UI transitions, not authored video playback/render output.
- All-scene motion preparation shows durable progress, preserved scenes, partial failures, cancel, and selective retry. Opening a project, previewing, and rendering make no AI request.
- Raster artwork is one visual layer: preview may apply whole-image transforms/available overlays only; never imply that depicted objects have independent layers.

## 9. Responsive guidelines

- Base layout supports 320px minimum; target mobile range includes 360–430px.
- Main redesign breakpoints: 1050px (project grid 3→2 columns; settings stack), 700px (compact topbar and scrollable workflow), 520px (single-column project cards, icon-only top actions, compact editor/dialog). Page content follows measured header control edges; topbar reserves brand and primary-action slots across routes, with primary action before Settings on narrow screens.
- Existing feature breakpoints also apply: 950px workflow stepper becomes horizontally scrollable; 820px workspace/editor columns collapse; 560px tight form and stepper refinements.
- Project cards use 3 columns on wide desktop, 2 on tablet, 1 on narrow mobile.
- Workspace stepper scrolls horizontally instead of compressing labels. Editor and preview stack vertically at tablet widths; 9:16 preview ratio stays fixed.
- Dialog is viewport-bounded, wraps actions on mobile, and keeps touch-sized buttons.
- Check 360px, 390px, 430px, tablet, and desktop after layout changes.

## 10. Accessibility guidelines

- Target WCAG AA for text, controls, selected states, and focus. Contrast ratios in §2 cover core palette pairs; manually inspect semantic and feature states.
- Use semantic HTML, explicit labels, accessible names for icon-only controls, and actual state in `aria-pressed`, `aria-current`, or status labels.
- All actions must be keyboard reachable with `:focus-visible` styles. Dialog behavior is specified in §7.
- Async status uses status/alert semantics and actionable error text.
- `prefers-reduced-motion: reduce` removes non-essential animation and smooth transitions.
- Preserve native form controls and their keyboard semantics where practical.

## 11. Developer implementation guidelines

- Theme tokens and theme-specific overrides: `src/client/redesign.css`.
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
