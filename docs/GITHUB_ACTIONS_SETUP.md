# GitHub Actions render setup

## Implemented path

`.github/workflows/render-video.yml` supports manual `workflow_dispatch`, checks out current trusted repository ref, installs pinned dependencies, runs `npm test`, validates a committed package path against repository boundaries, renders H.264 MP4, and uploads MP4 + JSON manifest artifact (7-day retention). Workflow permissions are `contents: read`; checkout credential persistence is disabled. No app token/secret is used by the workflow itself.

1. Push project to GitHub; use private repo if package content is sensitive.
2. Enable Actions. Check repository/org policy and available Actions minutes/storage for plan.
3. Open **Actions → Render trusted research package → Run workflow**. Use default sample or path to another committed `.json`.
4. Download artifact on completed run; inspect video and manifest. The workflow package has no voice-over unless you intentionally commit audio and add a trusted audio path to renderer yourself.

## V1.0.1 verification status

Workflow was statically reviewed but not dispatched during this audit: GitHub CLI (`gh`) is unavailable in the environment, so no workflow run/artifact evidence could be collected. Keep this path classified as **not live-tested**; do not describe cloud rendering or round-trip as verified.

Local app does not call GitHub API, configure owner/repo, create run IDs, poll status, download artifacts, or transport local project/audio. Workflow only renders committed JSON; generated MP4 is an Actions artifact, not returned to app. It does not run `npm run build`, API/TTS/render smoke tests, or `npm audit`; those checks ran locally instead. Workflow was not promoted or changed during V1.0.1 stabilization.

Artifacts are access-controlled according to repository visibility/access and retained seven days; they are not encrypted by this app. Avoid public repos for private research/voice-over. Actions use quotas and retention limits; no unlimited/free claim. If adding automated dispatch later, use a server-side fine-grained token with minimum workflow permissions, trusted refs, authenticated snapshot transfer, bounded polling, and explicit artifact access controls. Never put token in browser/localStorage or workflow inputs.
