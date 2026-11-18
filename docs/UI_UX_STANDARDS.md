# UI/UX implementation standards

`design.md` is canonical source for current tokens and shipped interaction behavior. This document is its short implementation checklist.

## Visual system

- Adapt Tabler's compact Purple global sidebar. Keep Dashboard, AI Facts, Story Series, Video Queue, Completed, and Settings consistent across routes. Story Series page contains its saved-draft and library panels; do not duplicate them as sidebar links. Mark unavailable Help & Support disabled, not as a dead link. Show accurate active state; collapse to a horizontally scrollable nav on narrow screens. Footer quota must reflect live render limits, not imply AI credits. Keep Plus Jakarta Sans, semantic status colors, and Light/Dark/System themes.
- Use tokens in `src/client/redesign.css`; do not add page-specific brand colors or parallel theme state.
- Typography: page titles 28–32px, section headings 19px, card headings 16px, body and controls 14px, labels 13px, metadata 12px. Dense editor timeline ticks may use 10px.
- Use shared `.button` variants/sizes, form, card, alert, dialog, and focus patterns. Standard controls are at least 42px; icon-only targets are 44px.
- Keep Plus Jakarta Sans for UI; reserve monospace for code/JSON and numeric editor data.

## Navigation and workflow

- URL identifies top-level page, Settings section, project, workspace step, and selected scene. Parse/serialize routes in `src/client/routes.ts`; use `main.tsx` navigation helpers rather than direct history changes.
- Browser Back/Forward must preserve existing save/discard confirmations and `workflow.ts` reachability guards.
- Invalid steps/scenes/projects must resolve safely. Legacy `visual`, `editor`, and `/editor` links map to one Video Editor. Video Editor remains reachable after Narasi with quality issues/pending visual approval; approval and quality gates still block Review, Preview, and Render.
- Protect unsaved workspace/Create drafts on app navigation and page unload.

## Responsive and accessible behavior

- Keep one full-width page container and shared left/right gutter (`--page-gutter`) aligned with topbar on every route, including workspace and Video Editor. Keep current-page context, theme control, and topbar height consistent across routes at each breakpoint. Page titles and supporting copy use shared type scale; Story Series banner adds no extra top inset or eyebrow typography override. Verify global sidebar and page layouts at 1440, 1280, 1024, 768, 390, 375, 360, and 320px without page-level horizontal overflow; Story Series also verifies 1672×941 mockup comparison. Keep six Inspector tabs reachable in a 3×2 grid and timelines internally scrollable on narrow screens.
- Story Series hero keeps title, description, decorative clapperboard, and Generate/Import switch inside one lavender responsive banner. Align hero copy/actions with Generate form card's left edge; keep illustration visible and uncropped on mobile. Separate production estimate metric cards with visible gap. Support Light/Dark/System.
- Create Video uses same compact segmented AI/Manual switch as Story Series, then form-first 55/45 columns; stack options after form at ≤900px. Keep shared animation style, Outro selector, and import/manual Advanced workflows in their designated columns. Use registry data and symbolic icons, not fabricated style artwork. Verify no overflow at 1440, 1024, 768, 375, and 320px.
- Keep keyboard access, visible `:focus-visible` rings, accessible names, semantic status, native control behavior, and reduced-motion support.
- Preserve Light, Dark, and System appearance on every page and dialog. Theme changes must not affect project or renderer data.
- Settings section links must support direct URLs, refresh, and Back/Forward. Appearance offers Light/Dark/System cards. Outro Library/Create/Video Editor controls must preserve these themes, keyboard operation, focus visibility, and reduced motion; verify library/Create layout at documented widths.
- Video scene controls must keep trim, fit/crop, loop/freeze, and opt-in audio keyboard-accessible; clip audio stays off by default and separate from narration approval.
- One Video Editor owns Visual, Gerak, Klip, Teks, Transisi, and Audio Inspector tabs. Keep prompt creation in Visual, transitions in Transisi, and approval controls in Visual. New scenes default to no added effects and Cut. Transition, trim, scene duration, and overlay edits preserve artwork approval; artwork/copy/Motion Beat changes invalidate affected approval.
- Inspector tabs support keyboard focus/navigation, retain selected scene and playhead, and mount only active panel. Keep Flow clip audio opt-in and separate from narration approval; Audio tab monitors and links back to Narasi.
- Animation Style Gallery uses stable IDs, shared Create draft state across AI/Manual modes, and symbolic-icon preset cards without preview media or dialog. Video Editor style changes must not auto-regenerate prompts or mutate media/approval; stale animated prompts need an explicit scene or batch regenerate action.
- Dashboard `queue`/`completed` filters and Story Series/Generate from Story routes remain URL-backed. Keep dashboard form left and persisted drafts, actual series progress, and live estimates right on desktop; stack form before summaries on mobile. Preserve unsaved form values across Generate/Import mode switches; empty-state action must return to Generate and focus story text. Sidebar links must target real routes or page sections. Preserve source text separately; gate analysis, plan approval, Story Bible approval, selected-episode generation, and production import. Validate JSON and preview every generated Google Flow scene prompt before import; apply the selected animation preset consistently across scenes and keep authored direction separate. Style-lock regeneration also previews each prompt before apply. Keep fiction separate from factual citation review while preserving narration, Story Bible, scene IDs, media, manual approvals, and quality gates. Story Bible, continuation, reference images, Flow context, episode handoff, budget warnings, and explicit replacement actions must honor shared Light/Dark/System tokens, keyboard focus, and responsive layouts.

## Verification

- Run `npm run typecheck`, `npm test`, and `npm run build` for frontend changes.
- Run relevant API/editor/render smoke checks. For visual changes, inspect representative browser layouts or frames when environment permits; report unavailable visual evidence plainly.
- Do not use paid AI APIs, external publishing, or real image generation in automated checks without explicit authorization.
