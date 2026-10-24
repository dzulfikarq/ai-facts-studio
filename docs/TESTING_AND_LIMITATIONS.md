# Testing and limitations

## Automated checks

`npm test`: schema safety, timing, cache-key behavior, mocked Gemini SDK/voice/style/rate mapping and rolling 24h cap. `npm run smoke:api`: temporary SQLite server, import/idempotency, ffprobe upload and video daily cap. `npm run smoke:tts`: mock Test Voice/cache → unapproved full preview → stale-preview rejection → explicit approval → regenerate/retry cap → immutable job snapshot → FFmpeg normalize → full-size MP4 render and non-silent AAC probe. `npm run typecheck`: strict TS. `npm run build`: typecheck + production Vite build. `npm run smoke:render`: short Remotion H.264/AAC render. `npm run render -- samples/mountain-formation.json`: full 56s 1080×1920 render.

Executed locally on Node 22.22.1, FFmpeg/ffprobe 9.0.2, Windows x64. TTS mock end-to-end rendered 3.05s H.264/AAC MP4 and `volumedetect` confirmed non-silent audio. Mock audio is a sine tone, not speech; `/api/tts/status` reports Gemini unconfigured, so no live-provider request occurred. Short video smoke passed at 2.0s / 360×640 / H.264 + AAC. Full mountain render passed at 56.042667s / 1080×1920 / H.264 + AAC silent track; output 6,513,583 bytes with SHA-256 `13ae92c00376c080a021c04df7f8fce5c82307ba4f34099a9d7665a03f970426`. `npm audit` reported 0 vulnerabilities. `npm run build` succeeded with a >500 KB JS chunk warning and Zod comment annotation warnings.

## Implemented and tested locally

Schema/timing functions, local API/import/editor/preview, manual upload/probe, immutable snapshots, Gemini TTS adapter, Free Tier guard/model allowlist, cached Test Voice, full narration preview/approval, estimated scene sync and local render path are implemented. TTS E2E runs against test-only mock provider; real Gemini API is not live-tested because no Gemini key was supplied. Mock output is a sine tone, **not speech**. Actual full mountain MP4 and short audio MP4 are rendered and ffprobe-verified. Test/build outcomes are tracked in [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).

## Mocked / not live-tested

No live Gemini request, forced alignment, GitHub API dispatch/status/artifact retrieval, OpenCode custom-scene, or cloud round-trip. GitHub workflow file exists but has not run against GitHub credentials. Gemini Free Tier project billing linkage cannot be read via API key; verify no billing account linked in AI Studio. No Google billing is created or enabled by code. No screenshot/manual cross-browser test recorded unless status document says otherwise.

## Limits

One local renderer process; max 3 attempts/job; one new video snapshot/24h default. TTS max 3 requests per exact text/config and 10 requests/24h default; Test Voice and full previews share limits, cache hits do not count. No cancellation while Remotion render is in progress, no persistent cancellation signal, no audio cleanup UI/retention scheduler. Preview is browser Player (not an encoded low-res file). Captions use per-scene estimates, not word alignment. Free-tier script/audio data may be used by Google to improve products. If project billing is linked externally, Gemini can use paid tier despite the app's Free-Tier model guard; keep billing unlinked. Sample facts/sources require human review. Remotion license terms may change; confirm eligibility before production use.
