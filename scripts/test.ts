import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { captionSegmentsSchema, createCaptionSegments } from "../src/domain/captions";
import { validateAudioQuality } from "../src/domain/media-validation";
import { canStartNewJob, durationInFrames, sceneTimes } from "../src/domain/timeline";
import { estimateSceneTimings, narrationScript } from "../src/domain/voice-timing";
import { parseResearchPackage } from "../src/domain/research";
import { ApiError } from "@google/genai";
import { GeminiSpeechProvider, type GeminiSdkClient } from "../src/server/tts/gemini-provider";
import { DEFAULT_TTS_MODEL, FREE_TIER_TTS_MODELS, GEMINI_TTS_LOCALES, ttsCacheKey } from "../src/server/tts/provider";
import { cueProgress, layerMotion, sceneTransitionOpacity } from "../src/video/motion";
import { registeredTemplateIds } from "../src/video/renderer-registry";
import { visualStyles } from "../src/video/style-config";
import { visualCompositionFrame } from "../src/video/visual-primitives";
import { canAdvanceWorkspaceStep, previewReviewFingerprint, reachableWorkspaceStep, workflowStatuses, type WorkflowSignals } from "../src/client/workflow";

const samples = ["mountain-formation", "space-orbit", "animal-habitat", "lightning-charge", "kenapa-air-laut-asin"];
const parsedSamples = [];
for (const name of samples) {
  const raw = JSON.parse(await readFile(`samples/${name}.json`, "utf8")) as unknown;
  const parsed = parseResearchPackage(raw);
  assert.equal(parsed.success, true, `${name} should pass schema`);
  if (parsed.success) {
    assert.equal(parsed.data.schemaVersion, "1.1", `${name} should migrate/validate to v1.1 renderer data`);
    assert.ok(parsed.data.scenes.every((scene) => scene.visualComposition.layers.length > 0 && scene.motionPlan.length === scene.motionCues.length));
    parsedSamples.push(parsed.data);
  }
}

const mountain = parsedSamples[0]!;
const seaSalt = parsedSamples.at(-1)!;
assert.equal(seaSalt.title, "Kenapa Air Laut Asin?");
assert.equal(seaSalt.scenes.length, 4);
const seaSaltNodes = seaSalt.scenes.flatMap((scene) => scene.visualComposition.layers.flatMap((layer) => layer.nodes));
assert.ok(seaSaltNodes.some((node) => node.type === "icon" && node.icon === "rock"), "salt sample illustrates mineral weathering with reusable rock icon");
assert.ok(seaSaltNodes.some((node) => node.type === "icon" && node.icon === "crystal"), "salt sample uses reusable mineral crystal icon");
assert.ok(seaSaltNodes.some((node) => node.type === "diagram" && node.kind === "process-flow"), "salt sample uses generic process-flow diagram");
assert.ok(seaSaltNodes.some((node) => node.type === "diagram" && node.kind === "water-cycle"), "salt sample visualizes water cycle");
assert.ok(visualCompositionFrame(seaSalt.scenes[3]!.visualComposition).scale > 1, "small diagrams should be framed larger inside 9:16 canvas");
const clearAudio = { expected: true, codec: "aac", videoDurationSec: 12, audioDurationSec: 12, expectedAudioDurationSec: 12, meanVolumeDb: -20, maxVolumeDb: -2 };
assert.equal(validateAudioQuality(clearAudio).audioValidation, "pass");
assert.throws(() => validateAudioQuality({ ...clearAudio, meanVolumeDb: -91, maxVolumeDb: -91 }), /senyap/i);
assert.throws(() => validateAudioQuality({ ...clearAudio, maxVolumeDb: 0 }), /clipping/i);
assert.throws(() => validateAudioQuality({ ...clearAudio, audioDurationSec: 9 }), /terpotong/i);
assert.equal(validateAudioQuality({ ...clearAudio, expected: false, meanVolumeDb: -91, maxVolumeDb: -91 }).audioValidation, "silent-expected");
assert.throws(() => validateAudioQuality({ ...clearAudio, expected: false }), /non-senyap/i);
const invalidFlow = structuredClone(seaSalt);
const processFlow = invalidFlow.scenes[1]!.visualComposition.layers.flatMap((layer) => layer.nodes).find((node) => node.type === "diagram" && node.kind === "process-flow");
assert.equal(processFlow?.type, "diagram");
if (processFlow?.type === "diagram") processFlow.labels = ["ONE STEP"];
assert.equal(parseResearchPackage(invalidFlow).success, false, "process-flow accepts two to four labeled steps");
const badUrl = structuredClone(mountain);
badUrl.references[0]!.url = "javascript:alert(1)";
assert.equal(parseResearchPackage(badUrl).success, false, "unsafe URL must fail");

const workflowBase: WorkflowSignals = {
  activeStep: "materials", hasResearch: true, saved: true, hasAudio: true, audioMatchesNarration: true,
  hasPendingAudio: false, reviewVerified: false, hasWarnings: false, previewReviewed: false,
  latestJobContentCurrent: false,
};
assert.equal(workflowStatuses(workflowBase).materials, "active");
assert.equal(reachableWorkspaceStep("render", workflowBase), "review", "resume must stop at the first incomplete verification gate");
assert.equal(reachableWorkspaceStep("render", { ...workflowBase, reviewVerified: true }), "preview");
assert.equal(reachableWorkspaceStep("render", { ...workflowBase, reviewVerified: true, previewReviewed: true }), "render");
assert.equal(canAdvanceWorkspaceStep("narration", { ...workflowBase, audioMatchesNarration: false }), false, "stale AI audio blocks progression");
assert.equal(reachableWorkspaceStep("render", { ...workflowBase, audioMatchesNarration: false }), "narration");
assert.equal(workflowStatuses({ ...workflowBase, activeStep: "preview", reviewVerified: false }).review, "attention");
assert.equal(workflowStatuses({ ...workflowBase, activeStep: "render", latestJobState: "rendered", latestJobContentCurrent: true }).render, "active");
const reviewAudio = { file: "audio/test.wav", sha256: "audio-sha", durationSec: 12, timingMode: "scaled" as const, source: "upload" as const };
const previewFingerprint = previewReviewFingerprint(mountain, reviewAudio, 2);
assert.notEqual(previewFingerprint, previewReviewFingerprint(mountain, { ...reviewAudio, sha256: "different-audio-sha" }, 2), "audio changes must invalidate preview review");
assert.notEqual(previewFingerprint, previewReviewFingerprint({ ...mountain, title: `${mountain.title}!` }, reviewAudio, 2), "research changes must invalidate preview review");
assert.notEqual(previewFingerprint, previewReviewFingerprint(mountain, reviewAudio, 3), "renderer changes must invalidate preview review");

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
const captionSegments = createCaptionSegments("Awan badai bergerak. Muatan terpisah lalu kilat menyambar.", "MUATAN TERPISAH");
assert.equal(captionSegments[0]!.startProgress, 0);
assert.equal(captionSegments.at(-1)!.endProgress, 1);
assert.ok(captionSegments.some((segment) => segment.emphasis.includes("muatan")), "caption emphasis can derive from on-screen text");
assert.equal(captionSegmentsSchema.safeParse(captionSegments).success, true);
const longCaptionSegments = createCaptionSegments("a ".repeat(999));
assert.ok(longCaptionSegments.length <= 30, "auto captions must stay within manual schema segment limit");
assert.ok(longCaptionSegments.every((segment) => segment.text.length <= 72), "auto caption phrases must stay bounded");
assert.equal(captionSegmentsSchema.safeParse(longCaptionSegments).success, true);
const phraseBoundaries = createCaptionSegments("Di dalam awan badai, air dan partikel es bergerak karena arus udara yang kuat.");
assert.ok(phraseBoundaries.slice(0, -1).every((segment) => !/(?:dan|atau|karena|yang)$/i.test(segment.text)), "auto captions must not strand common connectors at phrase ends");
assert.equal(captionSegmentsSchema.safeParse([{ ...captionSegments[0]!, endProgress: 0.5 }, { ...captionSegments.at(-1)!, startProgress: 0.6 }]).success, false, "manual caption segments must not gap/overlap");

const unsafeVisual = structuredClone(parsedSamples.at(-1)!);
unsafeVisual.scenes[0]!.visualComposition.layers[0]!.nodes[0] = {
  type: "image", asset: "../../outside.svg", x: 0, y: 0, width: 50, height: 50,
} as unknown as typeof unsafeVisual.scenes[number]["visualComposition"]["layers"][number]["nodes"][number];
assert.equal(parseResearchPackage(unsafeVisual).success, false, "untrusted image paths must fail allowlist validation");
const unsafePath = structuredClone(parsedSamples.at(-1)!);
unsafePath.scenes[0]!.visualComposition.layers[0]!.nodes[0] = {
  type: "path", d: 'M0 0" onload="alert(1)', x: 0, y: 0, width: 50, height: 50,
} as typeof unsafePath.scenes[number]["visualComposition"]["layers"][number]["nodes"][number];
assert.equal(parseResearchPackage(unsafePath).success, false, "SVG path data must reject markup/code payloads");
const offCanvas = structuredClone(parsedSamples.at(-1)!);
offCanvas.scenes[0]!.visualComposition.layers[0]!.nodes[0]!.x = 1070;
assert.equal(parseResearchPackage(offCanvas).success, false, "visual nodes outside 9:16 canvas must fail validation");
const invalidMotionTarget = structuredClone(parsedSamples.at(-1)!);
invalidMotionTarget.scenes[0]!.motionPlan[0]!.targetLayer = "missing-layer";
assert.equal(parseResearchPackage(invalidMotionTarget).success, false, "motion plan targets must reference existing layer IDs");

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
assert.equal(registeredTemplateIds().length, 8, "every allowlisted template has an explicit renderer");
assert.equal(new Set(Object.values(visualStyles).map((style) => style.palette.canvas)).size, 3, "presets must have distinct palettes");
const motionPlan = (cue: import("../src/domain/visual-composition").MotionCuePlan["cue"]) => ({ cue, targetLayer: "all" as const, delayFrames: 0, durationFrames: 24, easing: "linear" as const });
const still = { opacity: 1, translateX: 0, translateY: 0, scale: 1, reveal: 1 };
const cueState = (cue: import("../src/domain/visual-composition").MotionCuePlan["cue"]) => layerMotion([motionPlan(cue)], "front", 1, 6, .25);
for (const cue of ["fadeIn", "slide", "scale", "pan", "zoom", "parallax", "reveal", "pulse"] as const) {
  assert.notDeepEqual(cueState(cue), still, `${cue} must alter frame state`);
}
assert.equal(sceneTransitionOpacity([motionPlan("cut")], 0), 1, "cut stays immediate");
assert.ok(sceneTransitionOpacity([motionPlan("dissolve")], 12) > 0 && sceneTransitionOpacity([motionPlan("dissolve")], 12) < 1, "dissolve spans its configured frames");
assert.deepEqual(layerMotion([motionPlan("zoom")], "front", 12, 12, .5), layerMotion([motionPlan("zoom")], "front", 12, 12, .5), "motion state must be deterministic");
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

console.log(`PASS: ${samples.length} packages; migration/schema/audio, workflow gates and review invalidation, renderer/cue determinism, Gemini Free Tier guard, cache, timing, rolling limit.`);
