# Gemini AI Voice / TTS

## Provider and model

AI Voice uses Google's official [`@google/genai`](https://github.com/googleapis/js-genai) SDK and Gemini Developer API `interactions.create`; no Azure, Vertex AI, Edge TTS, unofficial endpoints, paid-model fallback, or billing API. Default `GEMINI_TTS_MODEL=gemini-3.8-flash-lite-tts`. Google's [current model catalog](https://ai.google.dev/gemini-api/docs/models#audio_models) lists Gemini 3.8 Flash-Lite TTS as a stable TTS model. Current [pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash-lite-tts) lists Free Tier input/output as **Free of charge**. `gemini-3.8-flash-tts` is the second model in this app's Free-Tier allowlist. If configured model is unavailable to the API key/project, generation stops; app never changes model automatically.

## Free Tier-only safeguard

1. Create/select a **Google AI Studio Free Tier project with no billing account linked**. Create an API key restricted to Gemini API. Google upgrades Free usage tier when billing is linked; app never calls billing/setup APIs.
2. Copy `.env.example` to `.env` and set `GEMINI_API_KEY`, `GEMINI_TTS_MODEL=gemini-3.8-flash-lite-tts`, and `GEMINI_TTS_FREE_TIER_ONLY=true`; restart app.
3. App fails closed unless API key exists, Free Tier confirmation is true, and model is in allowlist. SDK is initialized explicitly with Gemini Developer API (`enterprise:false`, `vertexai:false`); no code enables/link billing.

**Critical limitation:** Gemini API key does not report whether Google project has billing linked. `GEMINI_TTS_FREE_TIER_ONLY=true` is explicit operator confirmation, not a billing-state detector. If user links billing outside app, Google may place project in paid tier for same model. To ensure no charges, keep billing unlinked and monitor project/tier in AI Studio. API still stops on Free Tier quota/rate limit; never falls back to paid model/provider. Some model errors are reported as unavailable; user must configure another allowlisted Free Tier model deliberately.

Gemini Free Tier currently marks input/output free of charge, but rate limits are per project/model, may change, and Free Tier content may be used by Google to improve products. Avoid confidential scripts. Check official [pricing](https://ai.google.dev/gemini-api/docs/pricing), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [key security](https://ai.google.dev/gemini-api/docs/api-key), and [Terms](https://ai.google.dev/gemini-api/terms). App-local caps: 3 synthesis calls per identical text/config key (sample or full script) and 10 synthesis calls per rolling 24h; cache hits excluded. Model/voice lookup are separate metadata requests and may count toward Google API rate limits. `.env` is git-ignored; key never reaches browser/SQLite/logs.

## Voices, language, style, speed

When user opens **Generate dengan AI Voice**, app calls official `ai.voices.list()` for **prebuilt** voices; options/genders reflect provider metadata when available. If lookup fails or project is unconfigured, official prebuilt names appear as fallback and are clearly marked unverified. Default locale `id-ID` (Bahasa Indonesia). TTS model also receives `speech_config.language`; no translation is performed. Voice list is cached in server memory for 15 minutes.

Scene script is exact ordered concatenation of Research Package `narrationText` fields, not freeform browser input. Style presets map to Gemini `speech_metadata.style`. Pace slider sends qualitative instruction (slow/steady/brisk); Gemini TTS pace is prompt-guided, not exact playback-rate multiplier. `speech_metadata` keeps delivery directions separate from verbatim transcript.

## Audio/cache/render

Gemini single-speaker TTS returns a WAV. FFmpeg normalizes it with `loudnorm`, down/up-samples to 48 kHz mono, and writes MP3; ffprobe validates codec, duration (≤120 sec), bytes (≤25 MB), and SHA-256 before caching. Only approved full narration attaches to project audio. TTS timing estimate weights scene words, punctuation/pauses, then calibrates to actual ffprobe duration. Scene start/end become editable absolute estimates; no word-level forced alignment is claimed.

Cache key = model/provider + sample/full-text SHA-256 + locale + voice + style + pace. **Test Voice** synthesizes a short locale-specific sample and can be played before storyboard text is sent. **Preview Narasi Lengkap** synthesizes the exact scene script but keeps it pending; selected audio changes only after user chooses **Gunakan Audio Ini**. Cache hit avoids SDK synthesis; **Regenerate preview** explicitly bypasses cache. Test Voice and full narration share caps of 3 synthesis attempts per identical text/config and 10 per rolling 24h. TTS metadata/audio persist in SQLite and `public/audio/tts/`. Generate video job copies approved audio to content-addressed `public/audio/jobs/`, immutable for later render attempts. TTS does not consume one-job-per-24h allowance. Manual **Upload audio sendiri** remains available if API key/quota/model fails.

## Edge TTS assessment

Not integrated. Community Edge TTS implementation relies on an undocumented endpoint/protocol; no documented Free Tier quota/permission verified. Gemini implementation uses the documented Developer API and documented Free Tier model IDs only.

## Tests and troubleshooting

- `npm test`: Free Tier/model guard, SDK request config, voice/style/rate, cache key and scene estimate.
- `npm run smoke:tts`: test-only mock, Test Voice/cache, unapproved full preview, explicit approval, regenerate/retry cap, FFmpeg WAV→MP3 normalization, ffprobe, immutable snapshot, Remotion MP4 and non-silent AAC. Mock output is a sine tone, **not generated speech**.
- Real Gemini request not live-tested here; no `GEMINI_API_KEY` was supplied. `/api/tts/status` reports unconfigured. Configure key/project as above before trying real speech.
- **Free Tier disabled:** set `GEMINI_TTS_FREE_TIER_ONLY=true` only after confirming no billing linked.
- **Model not available / 404:** inspect current AI Studio model access, then change `GEMINI_TTS_MODEL` to another allowlisted Free Tier ID. No automatic fallback.
- **429 quota:** wait for quota reset or use manual upload. App won't upgrade project or swap model.
- **Voice missing:** select a locale that appears in provider's dynamic prebuilt voice list.
- **Audio invalid:** check FFmpeg/ffprobe on `PATH`; generated WAV is normalized locally before caching.

Cleanup: stop app and remove `data/`, `public/audio/`, and `renders/` to delete local TTS cache/audio.
