# AI Facts Studio V1.0.3

Local-first studio for turning checked Indonesian research into reusable, animated 2D vertical videos. V1.0.3 improves reusable illustrations with auto-framing, depth shadows, stronger camera/layer motion, richer water-cycle/process diagrams, and adds phrase captions plus `Kenapa Air Laut Asin?` acceptance package. Rendering uses no AI calls. Optional AI Voice sends a sample or script to configured Gemini TTS only after explicit user action. The app defaults to `127.0.0.1`; drafts, audio, jobs, and local MP4s stay on the device except text explicitly sent to Gemini.

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

Open <http://127.0.0.1:5173>. Import `samples/mountain-formation.json`, `samples/lightning-charge.json`, or `samples/kenapa-air-laut-asin.json`, edit storyboard/composition, choose visual preset, then preview/render. AI path: **Test Voice** → **Preview Narasi Lengkap** → listen → **Gunakan Audio Ini** → **Generate preview** → **Render MP4 lokal**. Local render creates H.264, 1080×1920, 30 fps; approved narration is AAC. Without audio, custom confirmation asks before silent render. Renderer verifies codec, dimensions, duration, file size, SHA-256, and renderer version. Project deletion removes its upload, snapshots, and MP4s through a retryable cleanup queue; shared content-addressed audio cache remains.

Engine renders supplied Research Package scenes/compositions; it does **not** turn arbitrary titles into researched storyboards or topic-specific illustrations. Compose new topics from reusable nodes/diagrams or author their composition manually.

The first render may download Chromium. `npm run build && npm start` serves production UI/API on `http://127.0.0.1:3001`.

## Test and standalone render

```sh
npm test
npm run smoke:api
npm run smoke:tts
npm run smoke:render
npm run smoke:samples
npm run test:visual
npm run typecheck
npm run build
npm run render -- samples/mountain-formation.json
npm run render -- samples/lightning-charge.json
npm run render -- samples/kenapa-air-laut-asin.json
npm audit
```

Standalone render writes `renders/<title>.mp4` and a `.manifest.json`; existing output is never overwritten. Set `RENDER_OUTPUT_DIR` to render into a separate folder. `npm run smoke:samples` normally cleans temporary outputs; set `SAMPLE_RENDER_OUTPUT_DIR=renders/v1.0.3-final` to retain all three MP4s/manifests for manual review. The app's database is `data/ai-facts-studio.sqlite`; uploaded audio is in `public/audio/`. These generated files are git-ignored.

Legacy Research Package v1.0 still imports and upgrades to v1.1. New jobs use renderer V2; old immutable snapshots use frozen renderer V1. Manifests record renderer version.

Optional live Gemini check sends one short built-in Indonesian sample and consumes one synthesis request on a cache miss. Run only after confirming project billing state yourself; app cannot detect billing links:

```powershell
$env:GEMINI_TTS_LIVE_TEST = "1"
npm run smoke:gemini-live
Remove-Item Env:GEMINI_TTS_LIVE_TEST
```

Live Gemini check is separate from mock E2E. It does not create a project, attach audio, or test full-narration approval/render.

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
- [GitHub Actions setup](docs/GITHUB_ACTIONS_SETUP.md)
- [OpenCode integration](docs/OPENCODE_INTEGRATION.md)
- [User guide](docs/USER_GUIDE.md)
- [Testing and limitations](docs/TESTING_AND_LIMITATIONS.md)
- [Implementation status](docs/IMPLEMENTATION_STATUS.md)
