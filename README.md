# AI Facts Studio

Local-first studio for turning checked Indonesian research into reusable, animated 2D vertical videos. Template rendering uses no AI calls. Optional AI Voice sends script to configured Gemini TTS Free Tier only after explicit user action. The app runs on `127.0.0.1`; drafts, audio, jobs, and local MP4s stay on the device except text explicitly sent to Gemini.

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

Open <http://127.0.0.1:5173>. Import `samples/mountain-formation.json`, edit storyboard, choose **Generate dengan AI Voice** (after Gemini Free Tier setup) or **Upload audio sendiri**, click **Generate preview**, then **Render MP4 lokal**. Local render creates H.264, 1080×1920, 30 fps; attached narration is AAC. Without audio, app asks before rendering a silent video. Renderer verifies codec, dimensions, duration, file size, and SHA-256.

The first render may download Chromium. `npm run build && npm start` serves production UI/API on `http://127.0.0.1:3001`.

## Test and standalone render

```sh
npm test
npm run smoke:api
npm run smoke:tts
npm run typecheck
npm run build
npm run smoke:render
npm run render -- samples/mountain-formation.json
```

Standalone render writes `renders/<title>.mp4` and a `.manifest.json`. The app's database is `data/ai-facts-studio.sqlite`; uploaded audio is in `public/audio/`. These generated files are git-ignored.

## Workflow

`.github/workflows/render-video.yml` renders a **trusted JSON file already committed to the repository** from Actions → Render trusted research package → Run workflow. It uploads MP4 and manifest as a 7-day artifact. Repo must have Actions enabled; private repos consume plan quota. Do not commit private voice-over to a public repository.

Cloud dispatch/status/download are not connected to the local UI. Workflow does not accept JSON/audio uploads, does not use a GitHub token, and is not live-tested here. Setup details: [`docs/GITHUB_ACTIONS_SETUP.md`](docs/GITHUB_ACTIONS_SETUP.md).

## Docs

- [Architecture and security](docs/ARCHITECTURE.md)
- [Research package schema](docs/RESEARCH_PACKAGE_SCHEMA.md)
- [Video pipeline](docs/VIDEO_PIPELINE.md)
- [AI Voice / TTS setup](docs/TTS_SETUP.md)
- [GitHub Actions setup](docs/GITHUB_ACTIONS_SETUP.md)
- [OpenCode integration](docs/OPENCODE_INTEGRATION.md)
- [User guide](docs/USER_GUIDE.md)
- [Testing and limitations](docs/TESTING_AND_LIMITATIONS.md)
- [Implementation status](docs/IMPLEMENTATION_STATUS.md)
