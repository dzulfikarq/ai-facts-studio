# AI Facts Studio V1.0.1

Local-first studio for turning checked Indonesian research into reusable, animated 2D vertical videos. V1.0.1 stabilizes project deletion, quota accounting, and cleanup recovery. Template rendering uses no AI calls. Optional AI Voice sends a sample or script to configured Gemini TTS only after explicit user action. The app defaults to `127.0.0.1`; drafts, audio, jobs, and local MP4s stay on the device except text explicitly sent to Gemini.

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

Open <http://127.0.0.1:5173>. Import `samples/mountain-formation.json`, edit storyboard, choose **Generate dengan AI Voice** or **Upload audio sendiri**. AI path: **Test Voice** → **Preview Narasi Lengkap** → listen → **Gunakan Audio Ini** → **Generate preview** → **Render MP4 lokal**. Local render creates H.264, 1080×1920, 30 fps; approved narration is AAC. Without audio, custom confirmation asks before silent render. Renderer verifies codec, dimensions, duration, file size, and SHA-256. Project deletion removes its upload, snapshots, and MP4s through a retryable cleanup queue; shared content-addressed audio cache remains.

The first render may download Chromium. `npm run build && npm start` serves production UI/API on `http://127.0.0.1:3001`.

## Test and standalone render

```sh
npm test
npm run smoke:api
npm run smoke:tts
npm run smoke:render
npm run typecheck
npm run build
npm run render -- samples/mountain-formation.json
npm audit
```

Standalone render writes `renders/<title>.mp4` and a `.manifest.json`. The app's database is `data/ai-facts-studio.sqlite`; uploaded audio is in `public/audio/`. These generated files are git-ignored.

Optional live Gemini check sends one short built-in Indonesian sample and consumes one synthesis request on a cache miss. Run only after confirming project billing state yourself; app cannot detect billing links:

```powershell
$env:GEMINI_TTS_LIVE_TEST = "1"
npm run smoke:gemini-live
Remove-Item Env:GEMINI_TTS_LIVE_TEST
```

Live Gemini check is separate from mock E2E. It does not create a project, attach audio, or test full-narration approval/render.

## Workflow

`.github/workflows/render-video.yml` renders a **trusted JSON file already committed to the repository** from Actions → Render trusted research package → Run workflow. It uploads MP4 and manifest as a 7-day artifact. Repo must have Actions enabled; private repos consume plan quota. Do not commit private voice-over to a public repository.

Cloud dispatch/status/download are not connected to the local UI. Workflow does not accept JSON/audio uploads or use a GitHub token. Workflow was not dispatched during V1.0.1 audit because GitHub CLI was unavailable. Setup/details: [`docs/GITHUB_ACTIONS_SETUP.md`](docs/GITHUB_ACTIONS_SETUP.md).

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
