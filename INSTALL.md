# How to apply these files

1. Give the ZIP or the three files to OpenCode in the **AI Facts Studio repository**.
2. Ask OpenCode to **merge** the supplied `AGENTS.md` additions with the local `AGENTS.md`; never overwrite changes from the local worktree.
3. Add `docs/GIT_WORKFLOW.md`.
4. If `opencode.json` already exists locally, **merge** its `instructions` array to include `docs/GIT_WORKFLOW.md`, preserving other configuration. Otherwise add the supplied file.
5. Review changes, then make a meaningful local commit such as `docs(git): add repository commit and push standards`.
6. Do not push unless explicitly authorized.

OpenCode loads root `AGENTS.md` in project sessions and configured instruction files through `opencode.json`.
