# AI Facts Studio — Git Workflow & Commit Standards

**Status:** Repository-wide policy for coding agents and human contributors

**Applies to:** All changes in `ai-facts-studio`, including UI, Remotion, AI integration, assets, backend, tests, and documentation.

## 1. Objectives

Maintain a Git history that is easy to review, understand, debug, revert, and present as project progress. **Meaningful changes and verifiable results matter more than the number of commits.**

## 2. Authorization and safety

- A user-requested implementation task permits **local commits of completed, verified units of that task**, unless the current instruction says *do not commit*.
- **Never push** unless the user explicitly authorizes a push for the current operation or scope. Committing locally and pushing remotely are separate operations.
- Do not open pull requests, merge, force push, rewrite remote history, change default branches, create tags/releases, or publish artifacts unless explicitly authorized.
- Never assume approval to push merely because a previous conversation expressed a preference for frequent commits.
- Preserve uncommitted work already present before the task. Do not silently discard, stage, or commit someone else's changes.
- Never run `git reset --hard`, `git clean -fd`, destructive checkout, `git push --force`, or rebase of published commits without explicit authorization.
- If the working tree contains unrelated edits or unexpected conflicts, isolate your changes and report the obstacle instead of overwriting them.

## 3. Read standard every time

Before **each** `git commit` and **each** authorized `git push`:

1. Read or re-check this document, even if another commit or push was already done in this session.
2. Review the current branch, working tree, and staged diff.
3. Run the applicable checklist below.
4. Verify that no secret, unintended asset, or unrelated change is included.
5. Stop and report uncertainty rather than taking a destructive or remote action.

`AGENTS.md` must point to this file. OpenCode's project configuration may also load this file through `instructions`.

## 4. Atomic commits

A commit should represent **one coherent and independently understandable unit of work**, ideally leaving the repository in a usable state.

Good examples during Video Editor development:

- Fix per-scene image updates that overwrite shared artwork.
- Fix Google Flow batch import assignment and error reporting.
- Add collapsible scene inspector.
- Add regression tests protecting per-scene image isolation.
- Update documentation for the implemented behavior.

A single complex change may touch many files and still be one atomic commit. Conversely, splitting one inseparable fix into several broken commits only to increase count is discouraged.

Use explicit staging for intended files or hunks (`git add <paths>` or `git add -p`). Inspect staged changes before committing. **Avoid blanket staging** such as `git add -A` / `git add .` when unrelated files may exist.

## 5. Conventional Commits

Format:

```text
<type>(<optional-scope>): <concise imperative summary>
```

Recommended types:

| Type | Use for |
|---|---|
| `feat` | New user-facing functionality |
| `fix` | Correcting a defect or regression |
| `refactor` | Code restructuring without changing externally observable behavior |
| `perf` | Measurable performance improvements |
| `style` | Formatting / presentation-only changes (no behavior change) |
| `test` | Tests or test fixtures |
| `docs` | Documentation updates |
| `build` | Build tools or dependency configuration |
| `ci` | CI pipeline changes |
| `chore` | Maintenance not covered above |

Useful scopes (optional): `editor`, `flow`, `visual`, `motion`, `render`, `tts`, `api`, `assets`, `tests`, `docs`.

Examples:

```text
fix(editor): isolate imported artwork per scene
fix(flow): handle ambiguous batch file assignments
feat(editor): add collapsible inspector panel
test(visual): cover shared world scene overrides
docs(git): document atomic commit workflow
```

Write short, specific subject lines (preferably <= 72 characters). Use a body when motivation, tradeoffs, migration, or breaking changes are not obvious. For an incompatible behavior/API change, use `!` and/or a `BREAKING CHANGE:` footer as appropriate.

Do not make empty, cosmetic-only, redundant, or arbitrarily fragmented commits to inflate activity.

## 6. Branch strategy

- Inspect the existing branch and repository conventions first.
- For substantial new work, prefer a descriptive feature/fix branch when this fits the user's workflow, e.g. `fix/scene-import-isolation` or `feat/visual-editor`.
- Do not silently change branches if doing so would disturb existing user work; communicate when branch changes are necessary.
- Do not merge to `main` or push remote branches without the required authorization.

## 7. Verification before commit

Choose checks related to the changed code. For significant implementation milestones and before delivery, the baseline is:

```bash
npm run typecheck
npm test
npm run build
```

Where relevant, run targeted smoke checks exposed by the repository:

```bash
npm run smoke:api
npm run smoke:video-editor
npm run smoke:render
```

Some smoke tests may require a running local server, fixture, or media dependencies. Document what was run, what was skipped, and why. Do not use paid AI APIs, real image generation, or external publishing in automated tests without explicit user authorization.

For a **visual/video** change, passing automated checks alone is insufficient. Inspect actual editor behavior, representative frames, or a sample MP4 when feasible; distinguish fixture output from production-quality visuals.

If a commit is limited to docs or isolated config, smaller appropriate checks may suffice. For every commit, the repository should remain coherent; do not commit known-breaking intermediate steps as if they were complete.

## 8. Files and credentials

Before staging or pushing, verify that no unintended sensitive or generated content is included:

- Never commit `.env`, API keys, access tokens, OAuth credentials, billing details, or private account data.
- Do not add local databases, user-uploaded private files, build caches, `node_modules`, logs, render outputs, or large MP4 files unless specifically authorized and justified.
- Check additions for credential-like strings and inspect the diff; do not rely solely on `.gitignore`.
- Do not delete or rewrite tracked assets, project data, or migration history outside the task scope.

## 9. Pre-commit checklist

1. `git status --short` and `git branch --show-current`: confirm branch and existing changes.
2. `git diff --check`: check whitespace/conflict mistakes in working changes.
3. Stage only task-related files/hunks.
4. `git diff --cached --stat` and `git diff --cached`: review exact staged content.
5. Ensure the commit is a coherent unit, with no unrelated or sensitive changes.
6. Run relevant tests; record failures and skips accurately.
7. Choose a meaningful Conventional Commit message.
8. Commit locally, then inspect `git status --short` and `git log -1 --oneline`.
9. Report the local commit SHA and test results as appropriate.

Do not claim success if `git commit` fails, hooks reject it, or tests fail.

## 10. Pre-push checklist (only after explicit authorization)

1. Re-read this document and reconfirm which branch and remote the user authorized.
2. `git status --short`; identify uncommitted local work and ensure push content is intended.
3. Check upstream/divergence (e.g., `git status -sb`, `git log --oneline --decorate -n 10`, `git remote -v`).
4. Confirm the outbound commits are the intended ones; inspect diff if the destination is shared or sensitive.
5. Verify applicable checks have passed and that no secrets or unintended files exist in the pushed commits.
6. Use ordinary, non-force push to the authorized branch/upstream only.
7. Report the actual pushed branch, destination, commit range, and outcome. If rejected, report and stop; do not force push or rewrite history on your own.

## 11. Final agent report

At task completion, summarize:

- What actually changed and which issues were resolved.
- Local commits, in order: short SHA + Conventional Commit message.
- Test/typecheck/build/smoke/visual evidence, including failures and skips.
- Remaining bugs, incomplete work, and any manual steps.
- Whether work is committed, uncommitted, pushed, or **not pushed**.

**Default delivery:** local commits only, **no automatic push**.

## 12. Maintenance

Update this document only when the team's Git process genuinely changes. Keep the shorter `AGENTS.md` rule in sync. Apply the most restrictive valid user instruction for the current task, especially when the user requests no commit or no push.

References:
- OpenCode project instructions: https://dev.opencode.ai/v2/docs/instructions/
- Conventional Commits 1.0.0: https://www.conventionalcommits.org/en/v1.0.0/
