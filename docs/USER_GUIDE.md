# User guide

## Create and preview

1. Start `npm run dev`; open `http://127.0.0.1:5173`.
2. Choose **Create video**, import JSON or choose sample. Sample is seven 2D mountain scenes.
3. Edit title, scene on-screen text, narration/caption, visual description, timing, category, and preset. Click **Simpan perubahan**.
4. Inspect source count and warnings; verify claims/URLs yourself.
5. Choose audio source. **Upload audio sendiri** accepts MP3/WAV/M4A (≤100 MB, ≤120 sec); ffprobe measures duration. For **Generate dengan AI Voice**, configure Gemini Free Tier, choose language/voice/style/pace, then click **Test Voice** to hear short sample. Test sends sample text only; storyboard narration is not sent yet.
6. Click **Preview Narasi Lengkap**, listen to generated narration, then explicitly choose **Gunakan Audio Ini**. Until approval, existing selected audio stays active and unchanged. A matching cached preview is reused; **Regenerate preview** makes a new provider request. Test Voice and full narration share TTS quota, separate from video-job allowance. Approval adjusts estimated scene timing to actual audio duration; edit timings if needed.
7. Click **Generate preview**. This creates immutable snapshot including content-addressed audio copy; player previews same motion composition. Template path makes zero AI calls.

## Render/review

1. Click **Render MP4 lokal**. Without audio, confirm silent render. FFmpeg/Remotion renders 1080×1920 at 30 fps; UI reports real renderer progress. TTS narration is muxed into MP4 as AAC.
2. When verification passes, use **Unduh MP4**. Check manifest summary and watch output.
3. Review facts and license; mark reviewed or needs review. There is no auto-publish.

One new changed-snapshot job per rolling 24h by default. Same snapshot reuses job; retry/rerender same job allowed, max three render attempts. Draft edits do not use allowance.

## Video library

Use **×** next to a project in Video Library or Recent Projects, then confirm in the custom dialog. Project, snapshots, render outputs, and its uploaded audio are removed. Shared content-addressed TTS/job audio caches remain; deleting a project does not reset the rolling video-job allowance. If filesystem cleanup is temporarily blocked, app queues it and retries automatically.

## Troubleshooting

- **FFmpeg unavailable:** install FFmpeg and ffprobe, restart app, confirm both resolve from terminal PATH.
- **First render stalls/download error:** allow Remotion Chromium download; check network, free disk, and Windows antivirus policy.
- **Invalid JSON:** use schema v1.0; inspect field-path errors, cue/template allowlists, source IDs, scene timing.
- **Audio rejected:** check file readability with ffprobe, supported extension, 1–120 sec duration, upload cap.
- **Daily limit:** wait for shown UTC-derived local time; re-render same job does not use a new slot.
- **AI Voice unavailable:** configure Gemini key/Free Tier guard server-side per [`TTS_SETUP.md`](TTS_SETUP.md), or upload your recording. No paid-model fallback occurs automatically.
- **GitHub cloud render:** manual Actions workflow only renders a committed package. Setup/limitations: [`GITHUB_ACTIONS_SETUP.md`](GITHUB_ACTIONS_SETUP.md).

Delete local content by stopping app and removing `data/`, `public/audio/` files, and `renders/`.
