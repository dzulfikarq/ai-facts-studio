# AI Facts Studio V1.0.3 — implementation status

Baseline HEAD `6e608d8` (`feat: refine captions for v1.0.3`); current visual-quality work is uncommitted. Verified 24 Oct 2026 on Windows x64: Node `v22.22.1`, npm `10.9.4`, FFmpeg/ffprobe `9.0.2`.

## Implemented

- V2 foreground compositions auto-frame into the illustration region; low-depth backdrops remain fixed. Layer drop shadows, camera drift/zoom, and stronger bounded pan/slide/parallax/zoom/pulse/reveal improve scale and depth. UI safe areas and 9:16 frame remain fixed.
- Added reusable `rock`, `river`, `crystal` icons and `process-flow` / richer `water-cycle` diagrams. Existing phrase caption/manual timing/emphasis behavior retained.
- Added `samples/kenapa-air-laut-asin.json`: four authored scenes cover rock weathering, mineral transport by rivers, evaporation, and water cycle. Uses generic icon/diagram primitives, not title-specific runtime branching.
- Renderer version remains V2; V1 compatibility, TTS, quota, database, and approval path are unchanged.

## Verified

| Check | Result |
|---|---|
| `npm test` | PASS — 5 packages, V1.0→1.1 migration, caption/visual schema, salt acceptance scene/composition, reusable process-flow bounds, cues/TTS/quota checks. |
| `npm run typecheck` | PASS. |
| `npm run smoke:api` | PASS — import/idempotency, upload/delete cleanup, shared audio, quota. Gemini configured=false. |
| `npm run smoke:tts` | PASS — mock preview/approval and H.264 + audible AAC, 3.05 sec. Mock is tone, not speech. |
| `npm run smoke:render` | PASS on rerun — V2 + legacy V1, H.264/AAC, 360×640. One first run hit transient Chromium `Target closed`; rerun passed. |
| `npm run test:visual` | PASS — 39 PNG frames: 8 templates, 3 presets, 9 cues, lightning + sea-salt scenes, transitions. Before/after illustration areas reviewed; golden hashes updated afterward. |
| `npm run smoke:samples` | PASS — Mountain 56.04 sec, 10,501,425 bytes, SHA-256 `6401934e7be69f5bb9970607ebd0a11454ecc4f00a0dc4b2197d41b7ee4815f2`; Lightning 24.04 sec, 4,666,109 bytes, SHA-256 `e6cc318188960eb1d5aaab230b723d91eed4928ddfc1e7ec5bf4a2384c77adee`; Sea Salt 32.04 sec, 10,084,209 bytes, SHA-256 `d488d8896df4a736173db8af298a62a97583dcf6de152266e5936eb6a4f0adf3`. All 1080×1920 H.264 V2. |
| `npm run build` | PASS; existing Zod annotation warnings and 594.52 KB JS chunk warning. |
| `npm audit` | PASS — 0 vulnerabilities. |

Final MP4s/manifests and 14 full-resolution scene frames are in ignored `renders/v1.0.3-final/`. Samples have silent AAC tracks (`-91 dB` mean/max), no narration. Compared with prior V1.0.3 outputs, dimensions/durations stayed fixed; Mountain illustration was reframed/larger (+14.9% bytes), Lightning gained framing/depth (+27.7% bytes). The fourth visual sample adds a new topic package.

## Limits

- This is a Research Package renderer, not free-title generation. It does **not** research an arbitrary topic, draft storyboard/scenes, or generate topic-specific art automatically. Sea-salt storyboard/composition was manually authored using reusable nodes/diagrams.
- Captions are phrase/scene-timed estimates, not word-aligned. Gemini was not configured (`configured=false`); no live narration/listening test. Mock TTS checks approval/muxing, not speech quality.
- `visualDescription` stays editorial; SFX remain metadata without licensed playback/mixing. Golden hashes are local Windows/Chrome/font-specific.
