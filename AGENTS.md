# Frontend agent rules

Before modifying frontend code:

1. Read `design.md` and follow its current tokens and interaction standards.
2. Reuse existing global UI patterns before adding components or dependencies.
3. Support Light, Dark, and System themes; keep theme state separate from video data/rendering.
4. Verify responsive behavior and accessibility, including keyboard focus and reduced motion.
5. Preserve existing business logic, API contracts, workflow guards, approvals, quality gates, and renderer behavior.
6. Update `design.md` when shipped UI standards change.
7. Run relevant checks (`npm run typecheck`, `npm test`, `npm run build`) before declaring frontend work complete.
