import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canStartNewJob, durationInFrames, sceneTimes } from "../src/domain/timeline";
import { estimateSceneTimings, narrationScript } from "../src/domain/voice-timing";
import { parseResearchPackage } from "../src/domain/research";
import { ApiError } from "@google/genai";
import { GeminiSpeechProvider, type GeminiSdkClient } from "../src/server/tts/gemini-provider";
import { DEFAULT_TTS_MODEL, FREE_TIER_TTS_MODELS, GEMINI_TTS_LOCALES, ttsCacheKey } from "../src/server/tts/provider";

const samples = ["mountain-formation", "space-orbit", "animal-habitat"];
const parsedSamples = [];
for (const name of samples) {
  const raw = JSON.parse(await readFile(`samples/${name}.json`, "utf8")) as unknown;
  const parsed = parseResearchPackage(raw);
  assert.equal(parsed.success, true, `${name} should pass schema`);
  if (parsed.success) parsedSamples.push(parsed.data);
}

const mountain = parsedSamples[0]!;
const badUrl = structuredClone(mountain);
badUrl.references[0]!.url = "javascript:alert(1)";
assert.equal(parseResearchPackage(badUrl).success, false, "unsafe URL must fail");

const overlap = structuredClone(mountain);
overlap.scenes[1]!.startSec = overlap.scenes[0]!.endSec - 0.5;
assert.equal(parseResearchPackage(overlap).success, false, "overlapping scenes must fail");

const badCue = structuredClone(mountain);
badCue.scenes[0]!.motionCues = ["execute" as typeof badCue.scenes[number]["motionCues"][number]];
assert.equal(parseResearchPackage(badCue).success, false, "unknown cues must fail");

const badTemplate = structuredClone(mountain);
badTemplate.scenes[0]!.templateId = "custom-js" as typeof badTemplate.scenes[number]["templateId"];
assert.equal(parseResearchPackage(badTemplate).success, false, "unknown templates must fail");

const noReference = structuredClone(mountain);
noReference.scenes[0]!.referenceIds = ["missing-source"];
assert.equal(parseResearchPackage(noReference).success, false, "unknown reference ID must fail");

const now = Date.parse("2026-10-24T12:00:00.000Z");
const atLimit = canStartNewJob([new Date(now - 1000).toISOString()], now, 1);
assert.equal(atLimit.allowed, false, "one recent job should consume default slot");
assert.equal(atLimit.nextAllowedAt, new Date(now - 1000 + 24 * 60 * 60 * 1000).toISOString());
assert.equal(canStartNewJob([new Date(now - 24 * 60 * 60 * 1000).toISOString()], now, 1).allowed, true, "job at 24h cutoff should no longer consume slot");

assert.equal(durationInFrames(mountain), 56 * 30);
assert.equal(durationInFrames(mountain, 43.5), 43.5 * 30);
assert.equal(sceneTimes(mountain, mountain.scenes[1]!, 43.5).endSec, 15 * (43.5 / 56));

const script = narrationScript(mountain);
assert.equal(script, mountain.scenes.map((scene) => scene.narrationText.trim()).join("\n\n"));
assert.ok(!script.includes(mountain.narration), "scene voice script comes from scene narration fields");
const synced = estimateSceneTimings(mountain, 43.27, 150, 1.1);
assert.equal(synced.targetDurationSec, 44);
assert.equal(synced.scenes[0]!.startSec, 0);
assert.equal(synced.scenes.at(-1)!.endSec, 43.27);
assert.ok(synced.scenes.every((scene, index) => scene.endSec > scene.startSec && (index === 0 || scene.startSec === synced.scenes[index - 1]!.endSec)));
assert.equal(sceneTimes(synced, synced.scenes[2]!, 43.27, "estimated").startSec, synced.scenes[2]!.startSec);

assert.equal(DEFAULT_TTS_MODEL, "gemini-3.8-flash-lite-tts");
assert.equal(GEMINI_TTS_LOCALES[0]!.locale, "id-ID", "default voice catalog locale should be Bahasa Indonesia");
const cacheBase = { provider: "gemini-developer-api", model: FREE_TIER_TTS_MODELS[0], scriptSha256: "abc", locale: "id-ID", voiceId: "Kore", style: "documentary", speakingRate: 1 };
assert.equal(ttsCacheKey(cacheBase), ttsCacheKey({ ...cacheBase }));
assert.notEqual(ttsCacheKey(cacheBase), ttsCacheKey({ ...cacheBase, speakingRate: 1.1 }));
assert.notEqual(ttsCacheKey(cacheBase), ttsCacheKey({ ...cacheBase, voiceId: "Puck" }));
assert.notEqual(ttsCacheKey(cacheBase), ttsCacheKey({ ...cacheBase, style: "warm" }));

let interactionRequest: unknown;
const fakeClient = {
  models: { get: async ({ model }: { model: string }) => ({ name: `models/${model}` }) },
  voices: { list: async () => ({ voices: [
    { id: "Kore", display_name: "Kore", language_code: "id-ID", gender: "female", type: "prebuilt" },
    { id: "paid-custom", display_name: "Custom", language_code: "id-ID", gender: "female", type: "replicated" },
  ] }) },
  interactions: { create: async (params: unknown) => {
    interactionRequest = params;
    return { output_audio: { type: "audio", data: Buffer.from([1, 2, 3]).toString("base64"), mime_type: "audio/wav" } };
  } },
} as unknown as GeminiSdkClient;
const gemini = new GeminiSpeechProvider({ apiKey: "test-key", model: FREE_TIER_TTS_MODELS[0], freeTierOnly: true, clientFactory: () => fakeClient });
assert.equal(gemini.configured, true);
const voiceCatalog = await gemini.listVoices("id-ID");
assert.equal(voiceCatalog.voices.length, 1, "only prebuilt Gemini voices are offered");
assert.equal(voiceCatalog.source, "api");
const generated = await gemini.synthesize({ text: "Gunung naik", locale: "id-ID", voiceId: "Kore", style: "warm", speakingRate: 1.2 });
assert.deepEqual(generated.data, Buffer.from([1, 2, 3]));
assert.equal(generated.mimeType, "audio/wav");
const request = interactionRequest as { model: string; input: Array<{ content: Array<{ text: string; annotations: Array<{ type: string; style: string }> }> }>; response_format: { type: string }; generation_config: { speech_config: Array<{ voice: string; language: string }> } };
assert.equal(request.model, FREE_TIER_TTS_MODELS[0]);
assert.equal(request.input[0]!.content[0]!.text, "Gunung naik");
assert.equal(request.input[0]!.content[0]!.annotations[0]!.type, "speech_metadata");
assert.match(request.input[0]!.content[0]!.annotations[0]!.style, /speaking briskly/);
assert.equal(request.response_format.type, "audio");
assert.equal(request.generation_config.speech_config[0]!.voice, "Kore");
assert.equal(request.generation_config.speech_config[0]!.language, "id-ID");
assert.equal(new GeminiSpeechProvider({ apiKey: "test-key", model: FREE_TIER_TTS_MODELS[0], freeTierOnly: false }).configured, false, "Free Tier confirmation is fail-closed");
assert.equal(new GeminiSpeechProvider({ apiKey: "test-key", model: "paid-model", freeTierOnly: true }).configured, false, "paid/non-allowlisted models stay disabled");
const disabledCatalog = await new GeminiSpeechProvider({ apiKey: "test-key", model: FREE_TIER_TTS_MODELS[0], freeTierOnly: false }).listVoices("id-ID");
assert.ok(disabledCatalog.voices.length > 0 && disabledCatalog.voices.every((voice) => voice.availability === "fallback"), "official fallback catalog avoids an empty voice selector");
assert.match(disabledCatalog.warning ?? "", /unverified/i, "fallback doesn't claim live voice availability");

const unavailableGemini = new GeminiSpeechProvider({
  apiKey: "test-key", model: FREE_TIER_TTS_MODELS[0], freeTierOnly: true,
  clientFactory: () => ({
    models: { get: async () => { throw new ApiError({ status: 404, message: "model absent" }); } },
    voices: { list: async () => ({ voices: [] }) },
    interactions: { create: async () => { throw new Error("must not synthesize missing model"); } },
  }) as unknown as GeminiSdkClient,
});
assert.equal((await unavailableGemini.listVoices("id-ID")).source, "fallback", "voice list failure shows fallback catalog");
let unavailableCode = "";
try { await unavailableGemini.synthesize({ text: "test", locale: "id-ID", voiceId: "Kore", style: "neutral", speakingRate: 1 }); }
catch (error) { unavailableCode = (error as { code?: string }).code ?? ""; }
assert.equal(unavailableCode, "model-unavailable", "unavailable model stops without paid fallback");

console.log(`PASS: ${samples.length} packages; schema safety, Gemini Free Tier guard, SDK config, cache, estimated timing, and rolling limit checks.`);
