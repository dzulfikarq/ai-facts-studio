# Architecture

## Choices

- React + TypeScript + Vite for local UI; Express for loopback API.
- Remotion 4 for SVG composition, browser preview, and programmatic rendering; FFmpeg/ffprobe for H.264/AAC encoding and media inspection.
- Node's built-in `node:sqlite` for local project/job/attempt state; Zod 4 validates imported JSON. Node 22 marks SQLite API experimental.
- Next.js was not selected: Remotion's current SSR documentation says `@remotion/bundler` cannot be used in Next.js. A Vite composition bundle is the documented server-rendering route. Remotion 4.0.466 is pinned because its Windows Rspack binding loads here; 4.0.538's binding did not. npm overrides select patched versions of its vulnerable transitive packages.
- Plain CSS replaces Tailwind for one local screen; fonts use local system fallbacks. No remote image/font dependency.

## Data flow

`JSON import → Zod validation → SQLite project → optional Test Voice/full Gemini TTS preview → explicit audio approval → FFmpeg WAV normalization + ffprobe → estimated scene timing → immutable audio snapshot → Remotion Player preview → Remotion renderer → H.264/AAC MP4`.

API defaults to `127.0.0.1` (port 3001); Vite dev UI binds to `127.0.0.1:5173`. Production UI and API share port 3001. Projects, jobs, rolling job-usage events, TTS cache metadata/attempts, and retryable file-cleanup entries persist in SQLite; snapshots under `data/jobs/`; uploaded/TTS assets under `public/audio/tts/` and `public/audio/`; immutable content-addressed job audio under `public/audio/jobs/`; outputs under `renders/`.

## Boundaries

- Research package is untrusted data. Strict allowlists cover categories, scene templates, motion/SFX cues, URL schemes, lengths, IDs, sequence, and timing. No imported field is evaluated as code or passed to a shell.
- Manual audio upload accepts MP3/WAV/M4A, caps size, assigns random filename, and probes media via argument-array `ffprobe`. Each immutable job snapshot references content-addressed audio copy, so replacing project audio cannot break prior job retries. API defaults to loopback; do not set `HOST` to a public interface.
- Project deletion removes project/job/attempt rows in one SQLite transaction and queues unique upload/snapshot/render paths in that same transaction. Cleanup retries at startup and every 60 seconds; failed cleanup remains visible to the caller. Content-addressed `audio/jobs` and `audio/tts` are shared caches and are retained on project deletion. Job-usage events survive project/job deletion so deleting a project cannot reset rolling job quota.
- AI Voice uses the official Gemini Developer API SDK and Free-Tier-only model allowlist only after explicit user click. `GEMINI_API_KEY` stays in server environment, never browser/SQLite/logs. No Vertex/paid-model fallback or billing API. Gemini project billing status is not queryable through this API key; operator must keep billing unlinked.
- TTS cache key hashes sample/full text + provider + locale + voice + style + rate. Test Voice and full narration share TTS request quota, separate from video-job quota. Full narration stays pending until explicit approval; cache assets and voice metadata persist locally.
- Render command gets server-created snapshot and fixed output path. No GitHub credential is stored.
- Import never fetches source URLs. Author must review claims and references; no auto-publish.
- A job snapshot stays immutable. Changed content hashes to a new job; same snapshot returns existing job. New jobs limited to one per rolling 24 hours by default; same-job renders capped at three attempts.

## Cloud boundary

GitHub workflow checks out trusted repository content and renders a committed JSON package. Local UI does not dispatch jobs, upload snapshots/audio, poll runs, or retrieve artifacts. No public backend/webhook exists. See workflow status and limitations docs.
