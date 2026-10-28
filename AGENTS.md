# AI Facts Studio — Project Agent Rules

## Frontend agent rules (preserved from existing repository)

Before modifying frontend code:

1. Read `design.md` and follow its current tokens and interaction standards.
2. Reuse existing global UI patterns before adding components or dependencies.
3. Support Light, Dark, and System themes; keep theme state separate from video data/rendering.
4. Verify responsive behavior and accessibility, including keyboard focus and reduced motion.
5. Preserve existing business logic, API contracts, workflow guards, approvals, quality gates, and renderer behavior.
6. Update `design.md` when shipped UI standards change.
7. Run relevant checks (`npm run typecheck`, `npm test`, `npm run build`) before declaring frontend work complete.
8. Use `docs/UI_UX_STANDARDS.md` as the implementation checklist; keep `design.md` canonical.
9. Keep page, project, workspace step, and selected scene URL-backed through `src/client/routes.ts`; preserve history confirmations and `src/client/workflow.ts` guards.
10. Use shared Purple/theme/typography/control tokens from `src/client/redesign.css`; verify documented desktop/mobile widths and report any unavailable visual verification.

## Git, commit, and push rules (repository-wide)

**Mandatory standard:** `docs/GIT_WORKFLOW.md`.

- **Before every `git commit` and every `git push`, read or re-check `docs/GIT_WORKFLOW.md` and follow its applicable checklist.** Do not assume a previous task's review is sufficient.
- Use meaningful **atomic commits** with **Conventional Commits**. Separate independently coherent fixes, features, tests, and documentation when safe and useful; do not split commits artificially to increase the count.
- For user-authorized implementation tasks, local commits may be made as coherent milestones pass relevant verification, unless the user explicitly requests no commits or a different policy.
- **Never push automatically.** Push only when the user explicitly authorizes it for the current operation or scope. A past general preference for more commits is not push authorization.
- Never stage unrelated pre-existing modifications, user data, secret files, generated videos, or temporary artifacts. Do not use `git add -A` or `git add .` indiscriminately.
- Do not run destructive Git operations (force push, `reset --hard`, `clean -fd`, rewriting shared history) without explicit authorization.
- If checks fail, fix issues or report the blockers. Do not disguise failing checks or claim success without verification.
- After committing, report each SHA, message, scope of changes, and tests run. After an explicitly authorized push, report branch and remote destination.
- Update documentation **after** the implementation and its verification, reflecting actual behavior, not planned features.

If existing project rules conflict, preserve the more restrictive safety rule and ask the user before taking an irreversible or remote action.
