# User guide

## Seven-step workspace

Start `npm run dev`; open `http://127.0.0.1:5173`. Choose **Create video**, import JSON or choose a sample. Research Package v1.0 auto-upgrades to v1.1.

1. **Materi & Storyboard:** edit title, scene text/narration, references, category, and visual preset. Save occurs when continuing; leaving with unsaved edits prompts to save. Research edits invalidate author verification and Preview review.
2. **Narasi:** upload MP3/WAV/M4A (≤100 MB, ≤120 sec), explicitly choose manual timing, or load Gemini's voice catalog and choose language/voice/style/pace. Voice catalog does not load on workspace open. **Test Voice** sends only sample text. **Preview Narasi Lengkap** sends storyboard narration; listen, then explicitly choose **Gunakan Audio Ini**. If TTS changes duration, choose **Retiming**, **Keep timeline**, or **Cancel**. Retiming adjusts scene spans by narration weight while preserving stable IDs and visual edits; Keep timeline preserves authored boundaries. Pending audio never replaces active audio before approval. TTS quota is separate from video-job allowance.
3. **Visual Storyboard:** import Google Flow stills/clips or use other supported visual sources. Review and approve each scene separately. Quality Gate issues do not block entry to Edit Video, but approval/readiness remain required before Review, Preview, and Render.
4. **Edit Video:** adjust scene duration and manual timing, Motion Direction, Cut/Crossfade/Slide/Wipe transitions, Motion Beats, title/subtitle/branding overlays, and preview. New scenes start with no motion effects and Cut. Motion Direction and timing controls live here, not in Materials or Visual Storyboard.
5. **Review & Subtitle:** inspect source links, warnings, timeline, and phrase captions. Verify claims/URLs yourself, then mark material reviewed. Edits to research reset this verification.
6. **Preview Video:** Remotion Player shows the current draft and active audio interactively. It creates no snapshot/render job and uses no production video quota. Play it, then mark it reviewed; storyboard/audio changes invalidate that review.
7. **Render & Download:** explicit action creates/reuses immutable snapshot and starts local MP4 render. Quota/status, progress, manifest, and download appear here. Without audio, confirm **Render tanpa narasi**. Template preview/render makes zero AI calls.

Workspace URL stores project, step, and selected scene. Visual Storyboard uses `/projects/:id?step=visual`; Edit Video uses `/projects/:id/editor`. Browser Back/Forward preserves route history and unsaved-change confirmations.

UI typography uses Plus Jakarta Sans consistently, including technical editors; Segoe UI/Arial act as fallbacks when Google Fonts is unavailable.

## AI Generation settings

Open **Settings → AI Generation**. Choose **Development** or **Production** manually; no automatic mode or provider fallback exists. Development checks authenticated OpenCode server/model status. Its compact summary shows connection, API version, connected provider count, and model count. Expand any provider to search its models; all groups start collapsed. In **Create video → Generate with AI**, select a connected OpenCode model and click **Generate Research & Storyboard**; this sends topic/instructions/optional URLs to local OpenCode. OpenCode uses isolated temp directory and tools disabled. Selected provider may still charge according to its own account; no model fallback occurs. Manual prompt/paste remains under **Advanced**. **Production** generates a structured draft only after explicit click and when backend Gemini key, text model, Free Tier guard, and quota are configured. Settings shows local per-model RPM/RPD/TPM monitoring and operator-configured project caps; Google’s actual remaining quota is not exposed. Secrets live in server environment, never browser. Mode persists separately from deployment mode and TTS.

In **Create video → Generate with AI**, enter topic, language, target, style, optional instructions, and optionally user-provided source URLs. Review generated summary, fact/interpretation labels, uncertainty, scenes, timings, templates, and visual direction. Local deterministic Art Director maps curated concepts to reusable 2D compositions; descriptions guide mapping but do not generate arbitrary art. Unsupported scenes need manual authoring. App does not fetch or independently verify citations. It accepts only user-supplied source candidates, marks claims unverified, and adds a URL to Research Package only after you manually check and confirm it. Correct any issues, mark review complete, then click **Create Project**. Saved drafts persist in browser storage; Project creation uses idempotency key to avoid double-submit duplicates.

Details: [`AI_GENERATION_SETUP.md`](AI_GENERATION_SETUP.md).

Local deterministic Art Director maps supported visual concepts to reusable 2D scene compositions; unsupported concepts require manual authoring. Review every thumbnail and motion preview for relevance and scientific accuracy before approval.

## Render/download

FFmpeg/Remotion renders 1080×1920 at 30 fps; UI reports progress. Approved narration is muxed as AAC; silent, clipped, low-level, or duration-mismatched expected audio is reported distinctly. Manifest includes audio origin/hash, codec, duration, measured mean/peak, renderer version, and video SHA-256. Non-silent checks do not verify spoken wording; listen to the downloaded result. There is no auto-publish.

Development mode allows unlimited local snapshot jobs; all jobs remain in history. Production mode allows one new changed-snapshot job per rolling 24h by default (`DAILY_JOB_LIMIT`). Switching modes does not reset history, so Development jobs count when Production resumes. Same snapshot reuses its job; retry/rerender same job allowed, max three render attempts. Draft edits do not use allowance. New V2 renderer snapshot differs from existing V1 snapshot and may use a Production slot; old V1 snapshot remains renderable as V1.

## Video library

Use **×** next to a project in Video Library or Recent Projects, then confirm in the custom dialog. Project, snapshots, render outputs, and its uploaded audio are removed. Shared content-addressed TTS/job audio caches remain; deleting a project does not reset the rolling video-job allowance. If filesystem cleanup is temporarily blocked, app queues it and retries automatically.

## Troubleshooting

- **FFmpeg unavailable:** install FFmpeg and ffprobe, restart app, confirm both resolve from terminal PATH.
- **First render stalls/download error:** allow Remotion Chromium download; check network, free disk, and Windows antivirus policy.
- **Invalid JSON:** use schema v1.0 or v1.1; inspect field-path errors, template/asset/cue allowlists, layer bounds, source IDs, and scene timing.
- **Audio rejected:** check file readability with ffprobe, supported extension, 1–120 sec duration, upload cap.
- **Daily limit:** wait for shown UTC-derived local time; re-render same job does not use a new slot.
- **AI Voice unavailable:** configure Gemini key/Free Tier guard server-side per [`TTS_SETUP.md`](TTS_SETUP.md), or upload your recording. No paid-model fallback occurs automatically.
- **GitHub cloud render:** manual Actions workflow only renders a committed package. Setup/limitations: [`GITHUB_ACTIONS_SETUP.md`](GITHUB_ACTIONS_SETUP.md).

Delete local content by stopping app and removing `data/`, `public/audio/` files, and `renders/`.
