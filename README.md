# AI Facts Studio V1.0.4

Local-first studio for turning checked Indonesian research into reusable, animated 2D vertical videos. V1.0.4 validates approved Gemini narration through AAC MP4 render, records audio provenance/integrity, and rejects silent/clipped expected narration. Prior reusable illustration, caption, quota, and cleanup safeguards remain. Rendering uses no AI calls; Gemini TTS only runs after explicit action. The app defaults to `127.0.0.1`; drafts, audio, jobs, and MP4s stay local except text sent to Gemini.

## Requirements

- Node.js 22.13+
- FFmpeg and ffprobe on `PATH`
- Internet for first dependency install and Remotion Chromium download

Remotion 4.0.466 is pinned: its Windows Rspack binding loads here; 4.0.538's did not. Patched `ws`, `esbuild`, `postcss`, and Zod versions are locked via npm overrides. SQLite uses Node's built-in `node:sqlite` (experimental in Node 22). AI Voice uses official Gemini Developer API, Free Tier model allowlist only; billing is never created or enabled by app. Gemini Free Tier may use content to improve Google products. Verify project has no billing link before enabling.

## Run

```sh
npm ci
copy .env.example .env   # Windows; optional
npm run dev
```

Open <http://127.0.0.1:5173> and follow five steps: **Materi & Storyboard** → **Narasi** → **Review & Subtitle** → **Preview Video** → **Render & Download**. Preview Video is interactive and uses no production render job/quota. **Settings → AI Generation** selects Development (manual ChatGPT/OpenCode prompt + JSON import) or configured Production (Gemini Text). This mode is stored separately from `NODE_ENV` and TTS; generators are not implemented yet. AI Voice remains a separate explicit path: load voices → optional **Test Voice** → **Preview Narasi Lengkap** → listen → **Gunakan Audio Ini**. Local render creates H.264, 1080×1920, 30 fps; approved narration is AAC. Without audio, confirmation is required before silent render. Renderer verifies codec, dimensions, duration, file size, SHA-256, and renderer version. Project deletion removes its upload, snapshots, and MP4s through a retryable cleanup queue; shared content-addressed audio cache remains.

Engine renders supplied Research Package scenes/compositions; it does **not** turn arbitrary titles into researched storyboards or topic-specific illustrations. Compose new topics from reusable nodes/diagrams or author their composition manually.

The first render may download Chromium. `npm run build && npm start` serves production UI/API on `http://127.0.0.1:3001`.

## Test and standalone render

```sh
npm test
npm run smoke:api
npm run smoke:tts
npm run smoke:render
npm run smoke:samples
npm run smoke:samples-audio
npm run test:visual
npm run typecheck
npm run build
npm run render -- samples/mountain-formation.json
npm run render -- samples/lightning-charge.json
npm run render -- samples/kenapa-air-laut-asin.json
npm audit
```

Standalone render writes `renders/<title>.mp4` and a `.manifest.json`; existing output is never overwritten. Set `RENDER_OUTPUT_DIR` to render into a separate folder. Final V1.0.4 review artifacts: silent MP4s in `renders/v1.0.4-review/final-silent/`, mock-tone MP4s/reports in `renders/v1.0.4-review/final-mock-audio-clean/`, and Gemini preview in `renders/v1.0.4-review/gemini-live/`. The app's database is `data/ai-facts-studio.sqlite`; uploaded audio is in `public/audio/`. These generated files are git-ignored.

Legacy Research Package v1.0 still imports and upgrades to v1.1. New jobs use renderer V2; old immutable snapshots use frozen renderer V1. Manifests record renderer version.

### Opt-in live Gemini tests

Confirm Google AI Studio project has no billing link first; API cannot verify that. `.env` must contain `GEMINI_API_KEY` and `GEMINI_TTS_FREE_TIER_ONLY=true`. Test Voice live check sends one short example, only on cache miss:

```powershell
$env:GEMINI_TTS_LIVE_TEST = "1"
$env:GEMINI_TTS_LIVE_NO_BILLING_CONFIRMED = "I_HAVE_VERIFIED_NO_BILLING"
npm run smoke:gemini-live
Remove-Item Env:GEMINI_TTS_LIVE_TEST
Remove-Item Env:GEMINI_TTS_LIVE_NO_BILLING_CONFIRMED
```

Full-narration acceptance is separate. It sends at most one preview synthesis, creates one local project, then pauses for human listening and **Gunakan Audio Ini** approval in UI. `continue` creates/reuses a snapshot for Player review but does not render. Only after user inspects video preview:

```powershell
$env:GEMINI_TTS_LIVE_E2E = "1"
$env:GEMINI_TTS_LIVE_NO_BILLING_CONFIRMED = "I_HAVE_VERIFIED_NO_BILLING"
npm run smoke:gemini-e2e -- preview mountain-formation
# Listen to renders/v1.0.4-review/gemini-live/narration-preview.mp3 in local UI, approve audio, then inspect Player preview.
npm run smoke:gemini-e2e -- continue
$env:GEMINI_TTS_LIVE_E2E_VIDEO_REVIEWED = "I_REVIEWED_VIDEO_PREVIEW"
npm run smoke:gemini-e2e -- render
Remove-Item Env:GEMINI_TTS_LIVE_E2E
Remove-Item Env:GEMINI_TTS_LIVE_NO_BILLING_CONFIRMED
Remove-Item Env:GEMINI_TTS_LIVE_E2E_VIDEO_REVIEWED
```

Choose one of `mountain-formation`, `lightning-charge`, or `kenapa-air-laut-asin`. Live test uses production local DB/TTS/video quotas and does not reset them. `render` needs user-approved audio, current V2 snapshot, and explicit Player-review confirmation. Key, billing linkage, and narration text are never included in manifests; non-silent checks do not prove spoken words, so listening remains required.

## Workflow

`.github/workflows/render-video.yml` renders a **trusted JSON file already committed to the repository** from Actions → Render trusted research package → Run workflow. It uploads MP4 and manifest as a 7-day artifact. Repo must have Actions enabled; private repos consume plan quota. Do not commit private voice-over to a public repository.

Cloud dispatch/status/download are not connected to the local UI. Workflow does not accept JSON/audio uploads or use a GitHub token. Workflow was not dispatched during V1.0.2 audit because GitHub CLI was unavailable. Setup/details: [`docs/GITHUB_ACTIONS_SETUP.md`](docs/GITHUB_ACTIONS_SETUP.md).

## Docs

- [Architecture and security](docs/ARCHITECTURE.md)
- [Research package schema](docs/RESEARCH_PACKAGE_SCHEMA.md)
- [Video pipeline](docs/VIDEO_PIPELINE.md)
- [Dynamic Motion Graphics Engine](docs/DYNAMIC_MOTION_GRAPHICS_ENGINE.md)
- [Template and asset guide](docs/TEMPLATE_AND_ASSET_GUIDE.md)
- [AI Voice / TTS setup](docs/TTS_SETUP.md)
- [AI Generation settings](docs/AI_GENERATION_SETUP.md)
- [GitHub Actions setup](docs/GITHUB_ACTIONS_SETUP.md)
- [OpenCode integration](docs/OPENCODE_INTEGRATION.md)
- [User guide](docs/USER_GUIDE.md)
- [Testing and limitations](docs/TESTING_AND_LIMITATIONS.md)
- [Implementation status](docs/IMPLEMENTATION_STATUS.md)
