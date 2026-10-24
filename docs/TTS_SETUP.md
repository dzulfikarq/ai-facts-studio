# Gemini AI Voice / TTS — V1.0.4

## Provider and model

AI Voice uses Google's official [`@google/genai`](https://github.com/googleapis/js-genai) SDK and Gemini Developer API `interactions.create`; no Azure, Vertex AI, Edge TTS, unofficial endpoints, paid-model fallback, or billing API. Default `GEMINI_TTS_MODEL=gemini-3.8-flash-lite-tts`. Google's [current model catalog](https://ai.google.dev/gemini-api/docs/models#audio_models) lists Gemini 3.8 Flash-Lite TTS as a stable TTS model. Current [pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash-lite-tts) lists Free Tier input/output as **Free of charge**. `gemini-3.8-flash-tts` is the second model in this app's Free-Tier allowlist. If configured model is unavailable to the API key/project, generation stops; app never changes model automatically.

AI Generation Text has separate `GEMINI_TEXT_MODEL`, `GEMINI_TEXT_FREE_TIER_ONLY`, model allowlist, and request quota. It may share server-side `GEMINI_API_KEY`; it never reuses the TTS model or TTS quota. Setup: [`AI_GENERATION_SETUP.md`](AI_GENERATION_SETUP.md).

## Free Tier-only safeguard

1. Create/select a **Google AI Studio Free Tier project with no billing account linked**. Create an API key restricted to Gemini API. Google upgrades Free usage tier when billing is linked; app never calls billing/setup APIs.
2. Copy `.env.example` to `.env` and set `GEMINI_API_KEY`, `GEMINI_TTS_MODEL=gemini-3.8-flash-lite-tts`, and `GEMINI_TTS_FREE_TIER_ONLY=true`; restart app.
3. App fails closed unless API key exists, Free Tier confirmation is true, and model is in allowlist. SDK is initialized explicitly with Gemini Developer API (`enterprise:false`, `vertexai:false`); no code enables/link billing.

**Critical limitation:** Gemini API key does not report whether Google project has billing linked. `GEMINI_TTS_FREE_TIER_ONLY=true` is explicit operator confirmation, not a billing-state detector. If user links billing outside app, Google may place project in paid tier for same model. To ensure no charges, keep billing unlinked and monitor project/tier in AI Studio. API still stops on Free Tier quota/rate limit; never falls back to paid model/provider. Some model errors are reported as unavailable; user must configure another allowlisted Free Tier model deliberately.

Gemini Free Tier currently marks input/output free of charge, but rate limits are per project/model, may change, and Free Tier content may be used by Google to improve products. Avoid confidential scripts. Check official [pricing](https://ai.google.dev/gemini-api/docs/pricing), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [key security](https://ai.google.dev/gemini-api/docs/api-key), and [Terms](https://ai.google.dev/gemini-api/terms). App-local caps: 3 synthesis calls per identical text/config key (sample or full script) and 10 synthesis calls per rolling 24h; cache hits excluded. Model/voice lookup are separate metadata requests and may count toward Google API rate limits. `.env` is git-ignored; key never reaches browser/SQLite/logs.

## Voices, language, style, speed

The **Muat daftar voice** action calls official `ai.voices.list()` for **all prebuilt** voices; catalog is not fetched when workspace opens. Current implementation does not filter catalog by selected locale. Options/genders reflect provider metadata when available; voice language metadata is informational, not per-project availability proof. If lookup fails or project is unconfigured, official prebuilt names appear as fallback and are clearly marked unverified. Default locale `id-ID` (Bahasa Indonesia) is sent separately as `speech_config.language`; no translation is performed. Voice list is cached in server memory for 15 minutes.

Scene script is exact ordered concatenation of Research Package `narrationText` fields, not freeform browser input. Style presets map to Gemini `speech_metadata.style`. Pace slider sends qualitative instruction (slow/steady/brisk); Gemini TTS pace is prompt-guided, not exact playback-rate multiplier. `speech_metadata` keeps delivery directions separate from verbatim transcript.

## Audio/cache/render

Gemini single-speaker TTS returns a WAV. FFmpeg normalizes it with `loudnorm`, down/up-samples to 48 kHz mono, and writes MP3; ffprobe plus `volumedetect` validate codec, duration (≤120 sec), bytes (≤25 MB), SHA-256, non-silence, and peak headroom before caching. Only approved full narration attaches to project audio. Approval persists voice/settings, source/script/audio hashes, and approval timestamp. Immutable job snapshots copy the approved audio and verify its SHA before render. Final AAC duration, level, and clipping are checked; silent/too-quiet expected narration or peak clipping fails the render. TTS timing estimate weights scene words, punctuation/pauses, then calibrates to actual ffprobe duration. Scene start/end remain editable estimates; no word-level forced alignment is claimed.

Cache key = model/provider + sample/full-text SHA-256 + locale + voice + style + pace. **Test Voice** synthesizes a short locale-specific sample and can be played before storyboard text is sent. **Preview Narasi Lengkap** synthesizes the exact scene script but keeps it pending; selected audio changes only after user chooses **Gunakan Audio Ini**. Cache hit avoids SDK synthesis; **Regenerate preview** explicitly bypasses cache. Test Voice and full narration share caps of 3 synthesis attempts per identical text/config and 10 per rolling 24h. TTS metadata/audio persist in SQLite and `public/audio/tts/`. Generate video job copies approved audio to content-addressed `public/audio/jobs/`, immutable for later render attempts. TTS does not consume one-job-per-24h allowance. Manual **Upload audio sendiri** remains available if API key/quota/model fails.

## Edge TTS assessment

Not integrated. Community Edge TTS implementation relies on an undocumented endpoint/protocol; no documented Free Tier quota/permission verified. Gemini implementation uses the documented Developer API and documented Free Tier model IDs only.

## Tests and troubleshooting

- `npm test`: Free Tier/model guard, SDK request config, voice/style/rate, cache key, audio validation bounds, and scene estimate.
- `npm run smoke:tts`: isolated mock integration; upload remains active until approval, settings/script invalidation, API restarts, immutable snapshot, AAC loudness/duration/peak validation. Mock is a sine tone, **not speech**.
- `npm run smoke:samples-audio`: H.264/AAC checks for all three topic samples with FFmpeg sine fixtures marked `mock-fixture`; not Gemini and not speech.
- `npm run smoke:gemini-live`: explicit one-request live Test Voice check, if uncached. Requires `GEMINI_TTS_LIVE_TEST=1`, configured key, Free Tier guard, and manual no-billing confirmation. Cache hit performs no synthesis.
- `npm run smoke:gemini-e2e -- preview <sample>`: explicit full-narration Gemini preview. Requires `GEMINI_TTS_LIVE_E2E=1`, key, `GEMINI_TTS_FREE_TIER_ONLY=true`, and `GEMINI_TTS_LIVE_NO_BILLING_CONFIRMED=I_HAVE_VERIFIED_NO_BILLING` after checking Google AI Studio billing manually. Sends one POST only; no automatic retry or forced cache bypass. Saves MP3 and pauses for human listening.
- Listen in local UI and click **Gunakan Audio Ini**. Then run `npm run smoke:gemini-e2e -- continue`; it checks persisted approval/quota and creates or reuses the immutable V2 snapshot, then pauses for Player preview review. Only after inspecting that video, set `GEMINI_TTS_LIVE_E2E_VIDEO_REVIEWED=I_REVIEWED_VIDEO_PREVIEW` and run `npm run smoke:gemini-e2e -- render`. Render step validates H.264/AAC, dimensions, duration, non-silence, clipping, source and hashes. It never approves, synthesizes, or renders automatically from TTS completion.

### Historical live provider evidence — V1.0.1 audit, 24 Oct 2026

One live Test Voice synthesis passed: `gemini-developer-api`, model `gemini-3.8-flash-lite-tts`, live catalog source `api`, voice `achernar`, requested locale `id-ID`, 9.68 sec, 155,948 bytes, normalized MP3, cache miss. ffprobe verified MP3/duration and the audio URL returned successfully; no human listening or voice-quality assessment was performed. Endpoint did not create a project or attach audio. This live sample consumed one local TTS synthesis attempt and is cached in configured `DATA_DIR`.

Historical Test Voice evidence is not full-narration evidence. V1.0.4 full narration preview passed once (cache miss) and was user-approved: Mountain / Achernar, 43.2 sec MP3, SHA-256 `9bd0c65688a73c72135beaa72bee8e5dd64d4580a99135390f5071ee0a497bb6`, mean −17.3 dB, peak −1.9 dB. Final Gemini MP4 is blocked by production video quota 1/1 until `2026-10-25T06:07:43.578Z`; no quota reset or second synthesis. Billing linkage is not queryable by API; no-billing confirmation is operator attestation only. See [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).

### Troubleshooting

- **Free Tier disabled:** set `GEMINI_TTS_FREE_TIER_ONLY=true` only after confirming no billing linked.
- **Model not available / 404:** inspect current AI Studio model access, then change `GEMINI_TTS_MODEL` to another allowlisted Free Tier ID. No automatic fallback.
- **429 quota:** wait for quota reset or use manual upload. App won't upgrade project or swap model.
- **Voice unavailable:** refresh catalog and choose a live-listed prebuilt voice. Fallback names are unverified; selected locale is sent separately and does not filter the voice list.
- **Audio invalid:** check FFmpeg/ffprobe on `PATH`; generated WAV is normalized locally before caching.
- **Final audio rejected:** render requires aligned AAC, audible level, and safe peaks. Listen to preview, adjust or re-upload audio, then create a new snapshot.

Cleanup: stop app and remove `data/`, `public/audio/`, and `renders/` to delete local TTS cache/audio.
