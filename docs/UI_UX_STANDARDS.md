# UI/UX implementation standards

`design.md` is canonical source for current tokens and shipped interaction behavior. This document is its short implementation checklist.

## Visual system

- Adapt Tabler's restrained hierarchy and horizontal navigation; keep Plus Jakarta Sans, Purple primary actions, semantic status colors, and Light/Dark/System themes.
- Use tokens in `src/client/redesign.css`; do not add page-specific brand colors or parallel theme state.
- Typography: page titles 28–32px, section headings 19px, card headings 16px, body and controls 14px, labels 13px, metadata 12px. Dense editor timeline ticks may use 10px.
- Use shared `.button` variants/sizes, form, card, alert, dialog, and focus patterns. Standard controls are at least 42px; icon-only targets are 44px.
- Keep Plus Jakarta Sans for UI; reserve monospace for code/JSON and numeric editor data.

## Navigation and workflow

- URL identifies top-level page, project, workspace step, and selected scene. Parse/serialize routes in `src/client/routes.ts`; use `main.tsx` navigation helpers rather than direct history changes.
- Browser Back/Forward must preserve existing save/discard confirmations and `workflow.ts` reachability guards.
- Invalid steps/scenes/projects must resolve safely. URL state must not bypass approvals, quality gates, render checks, or project persistence.
- Protect unsaved workspace/Create drafts on app navigation and page unload.

## Responsive and accessible behavior

- Keep left/right page gutters equal and aligned to topbar outer padding. Verify 1440, 1280, 1024, 768, 390, 360, and 320px without page-level horizontal overflow; fill desktop editor step tabs across row and keep them/timelines internally scrollable on narrow screens.
- Keep keyboard access, visible `:focus-visible` rings, accessible names, semantic status, native control behavior, and reduced-motion support.
- Preserve Light, Dark, and System appearance on every page and dialog. Theme changes must not affect project or renderer data.
- Video scene controls must keep trim, fit/crop, loop/freeze, and opt-in audio keyboard-accessible; clip audio stays off by default and separate from narration approval.

## Verification

- Run `npm run typecheck`, `npm test`, and `npm run build` for frontend changes.
- Run relevant API/editor/render smoke checks. For visual changes, inspect representative browser layouts or frames when environment permits; report unavailable visual evidence plainly.
- Do not use paid AI APIs, external publishing, or real image generation in automated checks without explicit authorization.
