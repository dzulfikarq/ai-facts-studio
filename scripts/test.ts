import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { captionSegmentsSchema, createCaptionSegments } from "../src/domain/captions";
import { validateAudioQuality } from "../src/domain/media-validation";
import { canStartNewJob, durationInFrames, sceneTimes } from "../src/domain/timeline";
import { estimateSceneTimings, narrationScript } from "../src/domain/voice-timing";
import { parseResearchPackage } from "../src/domain/research";
import { ApiError, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";
import { GeminiSpeechProvider, type GeminiSdkClient } from "../src/server/tts/gemini-provider";
import { DEFAULT_TTS_MODEL, FREE_TIER_TTS_MODELS, GEMINI_TTS_LOCALES, ttsCacheKey } from "../src/server/tts/provider";
import { cueProgress, layerMotion, sceneTransitionOpacity } from "../src/video/motion";
import { registeredTemplateIds } from "../src/video/renderer-registry";
import { visualStyles } from "../src/video/style-config";
import { visualCompositionFrame } from "../src/video/visual-primitives";
import { canAdvanceWorkspaceStep, previewReviewFingerprint, reachableWorkspaceStep, workflowStatuses, type WorkflowSignals } from "../src/client/workflow";
import { aiGeneratedContentSchema, aiGenerationInputSchema, buildAiGenerationDraft, buildDevelopmentPrompt, parseManualAiResult, parseManualAiResultText, researchPackageWithConfirmedSources, restoreAiGenerationDraft, type AiGeneratedContent } from "../src/domain/ai-generation";
import { aiGenerationSchema, DEFAULT_TEXT_MODEL, FREE_TIER_TEXT_MODELS, getAiGenerationSettings, getProductionProviderStatus, isLoopbackAddress, readAiGenerationMode, writeAiGenerationMode } from "../src/server/ai-generation/provider";
import { AiGenerationRequestError, reserveAiGenerationRequest } from "../src/server/ai-generation/quota";
import { GeminiTextGenerationError, GeminiTextGenerationProvider } from "../src/server/ai-generation/gemini-text-provider";
import { getOpenCodeProviderStatus, OpenCodeGenerationError, OpenCodeTextGenerationProvider } from "../src/server/ai-generation/opencode-provider";
import { generateAiResearchStoryboard } from "../src/server/ai-generation/generate";
import type { AiGenerationProvider } from "../src/server/ai-generation/provider";

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

const aiDb = new DatabaseSync(":memory:");
aiDb.exec(aiGenerationSchema);
assert.equal(readAiGenerationMode(aiDb), "development", "AI mode defaults to Development, independent of NODE_ENV");
const priorNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
assert.equal(readAiGenerationMode(aiDb), "development", "deployment mode must not select AI Generation mode");
if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = priorNodeEnv;
const aiNow = Date.parse("2026-10-24T12:00:00.000Z");
const aiEnv = { GEMINI_API_KEY: "test-server-key", GEMINI_TEXT_MODEL: "gemini-3.5-flash-lite", GEMINI_TEXT_FREE_TIER_ONLY: "true", AI_GENERATION_DAILY_REQUEST_LIMIT: "2" };
assert.equal(DEFAULT_TEXT_MODEL, "gemini-3.5-flash-lite");
assert.deepEqual(FREE_TIER_TEXT_MODELS, ["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
assert.ok(!(FREE_TIER_TEXT_MODELS as readonly string[]).includes("gemini-3.8-flash-lite"), "invalid Gemini model is excluded from text allowlist");
const productionStatus = getProductionProviderStatus(aiEnv, 0);
assert.equal(productionStatus.configured, true);
assert.equal(productionStatus.model, "gemini-3.5-flash-lite");
assert.equal(getProductionProviderStatus({ ...aiEnv, GEMINI_TEXT_MODEL: "" }).model, DEFAULT_TEXT_MODEL, "default text model follows official allowlist");
assert.ok(!JSON.stringify(productionStatus).includes("test-server-key"), "provider status must never return API key");
assert.equal(getProductionProviderStatus({ ...aiEnv, GEMINI_TEXT_FREE_TIER_ONLY: "false" }).configured, false, "text Free Tier guard fails closed");
assert.equal(getProductionProviderStatus({ ...aiEnv, GEMINI_TEXT_MODEL: "gemini-3.8-flash-lite" }).configured, false, "invalid Gemini 3.8 Flash-Lite text ID must fail closed");
assert.equal(getProductionProviderStatus({ ...aiEnv, GEMINI_TEXT_MODEL: DEFAULT_TTS_MODEL }).configured, false, "TTS model cannot be reused as text model");
assert.throws(() => reserveAiGenerationRequest(aiDb, "production", { ...productionStatus, model: DEFAULT_TTS_MODEL }, "research", aiNow), (error) => error instanceof AiGenerationRequestError && error.httpStatus === 503, "request gate rejects unallowlisted/paid model even if caller supplies configured status");
const firstAiRequest = reserveAiGenerationRequest(aiDb, "production", productionStatus, "research", aiNow);
reserveAiGenerationRequest(aiDb, "production", productionStatus, "storyboard", aiNow + 1);
assert.throws(() => reserveAiGenerationRequest(aiDb, "production", productionStatus, "visual-director", aiNow + 2), (error) => error instanceof AiGenerationRequestError && error.httpStatus === 429);
assert.throws(() => reserveAiGenerationRequest(aiDb, "development", productionStatus, "research", aiNow + 3), (error) => error instanceof AiGenerationRequestError && error.code === "manual-mode");
writeAiGenerationMode(aiDb, "production", new Date(aiNow).toISOString());
assert.equal(getAiGenerationSettings(aiDb, aiEnv, aiNow).mode, "production", "mode preference persists independently in settings table");
assert.equal(getAiGenerationSettings(aiDb, aiEnv, aiNow).providers.production.requestsUsed, 2);
assert.equal(getAiGenerationSettings(aiDb, aiEnv, aiNow).generationAvailable, true, "configured Production mode exposes explicit generation capability");
assert.ok(firstAiRequest.id);
assert.equal(isLoopbackAddress("127.0.0.1"), true);
assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
assert.equal(isLoopbackAddress("203.0.113.8"), false, "settings writes are limited to loopback clients");
aiDb.close();

const sourceUrl = "https://ocean.example/research";
const aiTopics = ["Kenapa air laut asin?", "Bagaimana gunung berapi terbentuk?", "Mengapa petir bisa terjadi?", "Kenapa langit berwarna biru?"];
const aiInput = aiGenerationInputSchema.parse({ topic: aiTopics[0], language: "id-ID", targetDurationSec: 30, deliveryStyle: "edukatif", additionalInstructions: "Pakai bahasa sederhana", sourceUrls: [sourceUrl] });
const makeAiContent = (topic: string): AiGeneratedContent => ({
  summary: `Ringkasan riset untuk ${topic}`,
  category: "Sains & Antariksa",
  visualPreset: "animated-infographic",
  keyFacts: [
    { claim: `Fakta utama tentang ${topic}`, classification: "fact", sourceUrls: [sourceUrl], uncertaintyNote: "Periksa konteks sumber." },
    { claim: "Analogi membantu menjelaskan konsep.", classification: "interpretation", sourceUrls: [], uncertaintyNote: "Ini penjelasan editorial." },
  ],
  uncertainties: ["Minta review manusia untuk setiap klaim."],
  narration: `Narasi edukatif untuk ${topic}.`,
  scenes: [
    { narrationText: `Pengenalan ${topic}.`, onScreenText: "Pertanyaan utama", visualDescription: "Tampilkan objek utama lalu beri highlight bertahap.", templateId: "infographic", motionCues: ["fadeIn"], sourceUrls: [sourceUrl] },
    { narrationText: "Jelaskan proses secara berurutan.", onScreenText: "Bagaimana prosesnya?", visualDescription: "Tampilkan diagram proses dengan panah yang muncul berurutan.", templateId: "infographic", motionCues: ["slide", "reveal"], sourceUrls: [] },
    { narrationText: "Rangkum fakta dan batas pengetahuan.", onScreenText: "Kesimpulan", visualDescription: "Rangkum konsep pada kartu fakta sederhana.", templateId: "mountain-reveal", motionCues: ["scale"], sourceUrls: [sourceUrl] },
  ],
});
for (const topic of aiTopics) {
  const content = makeAiContent(topic);
  assert.equal(aiGeneratedContentSchema.safeParse(content).success, true, `${topic} output should fit structured AI response schema`);
  const input = { ...aiInput, topic };
  const generatedDraft = buildAiGenerationDraft(input, content, `ai-package-${aiTopics.indexOf(topic)}`);
  assert.equal(generatedDraft.researchPackage.title, topic, "unrelated free-form topics use same generic package builder");
  assert.equal(generatedDraft.researchPackage.scenes.length, 3);
  assert.equal(generatedDraft.researchPackage.scenes.at(-1)!.endSec, input.targetDurationSec);
  assert.equal(generatedDraft.researchPackage.references.length, 0, "unverified user sources are not auto-attached to project references");
  assert.equal(generatedDraft.review.facts[0]!.verification, "referenced-unverified", "source association never claims an independent fact-check");
}
assert.match(buildDevelopmentPrompt(aiInput), /Kenapa air laut asin\?/);
assert.match(buildDevelopmentPrompt(aiInput), /Jangan mengarang fakta/);
assert.equal(parseManualAiResultText("{", aiInput, "invalid-json").success, false, "manual paste reports malformed JSON locally");
assert.equal(parseManualAiResult({ schemaVersion: "9.9" }, aiInput, "invalid-package").success, false, "manual paste rejects unsupported Research Package versions");
const manualParsed = parseManualAiResult(makeAiContent(aiInput.topic), aiInput, "manual-ai-package");
assert.equal(manualParsed.success, true, "manual Development result uses same local schema/build path");
if (manualParsed.success) {
  assert.equal(manualParsed.draft.mode, "development");
  assert.equal(restoreAiGenerationDraft(JSON.parse(JSON.stringify(manualParsed.draft)))?.researchPackage.title, aiInput.topic, "saved AI review draft survives reload validation");
  const selectedSource = manualParsed.draft.sourceCandidates[0]!;
  const readyPackage = researchPackageWithConfirmedSources({
    ...manualParsed.draft,
    selectedSourceIds: [selectedSource.id],
    sceneSourceIds: { ...manualParsed.draft.sceneSourceIds, [manualParsed.draft.researchPackage.scenes[0]!.id]: [selectedSource.id] },
  }, "2026-10-24");
  assert.equal(readyPackage.success, true);
  if (readyPackage.success) {
    assert.equal(readyPackage.data.references[0]!.url, sourceUrl);
    const retriedPackage = researchPackageWithConfirmedSources({ ...manualParsed.draft, researchPackage: readyPackage.data, selectedSourceIds: [selectedSource.id] }, "2026-10-25");
    assert.equal(retriedPackage.success && retriedPackage.data.references[0]!.checkedAt, "2026-10-24", "source review date stays stable across Create Project retry");
    assert.deepEqual(readyPackage.data.scenes[0]!.referenceIds, [selectedSource.id]);
  }
}
const fabricatedSourceContent = { ...makeAiContent(aiInput.topic), keyFacts: [{ claim: "Klaim tanpa source input.", classification: "fact" as const, sourceUrls: ["https://invented.example/reference"] }] };
const fabricatedSourceDraft = buildAiGenerationDraft(aiInput, fabricatedSourceContent, "no-model-reference");
assert.equal(fabricatedSourceDraft.sourceCandidates.some((source) => source.url.includes("invented.example")), false, "model-invented URLs are never promoted to source candidates");
assert.equal(fabricatedSourceDraft.review.facts[0]!.verification, "unverified");
assert.equal(parseManualAiResult(mountain, aiInput, "manual-v1-package").success, true, "manual result accepts existing Research Package v1.0 after migration");
assert.equal(aiGenerationInputSchema.safeParse({ ...aiInput, sourceUrls: ["javascript:alert(1)"] }).success, false, "AI source URLs allow HTTP(S) only");
assert.equal(aiGenerationInputSchema.safeParse({ ...aiInput, sourceUrls: ["https://user:pass@source.example/article"] }).success, false, "AI source URLs reject embedded credentials");

const generationDb = new DatabaseSync(":memory:");
generationDb.exec(aiGenerationSchema);
let providerCalls = 0;
const capturedGeminiRequest: { value?: GenerateContentParameters } = {};
const mockAiProvider = new GeminiTextGenerationProvider(productionStatus.model!, "server-only-test-key", (apiKey) => {
  assert.equal(apiKey, "server-only-test-key", "Gemini key is supplied to backend provider factory only");
  return { models: { generateContent: async (request) => {
    providerCalls++;
    capturedGeminiRequest.value = request;
    return { text: providerCalls === 1 ? "not-json" : JSON.stringify(makeAiContent(aiInput.topic)), modelVersion: productionStatus.model } as unknown as GenerateContentResponse;
  } } };
});
const productionPhases: string[] = [];
const mockGeneratedDraft = await generateAiResearchStoryboard(generationDb, "production", productionStatus, aiInput, mockAiProvider, { onPhase: (phase) => productionPhases.push(phase) });
assert.equal(providerCalls, 2, "invalid structured response gets one bounded validation retry");
assert.ok(productionPhases.includes("repairing") && productionPhases.includes("validating"), "pipeline reports repair and validation phases");
assert.equal(mockGeneratedDraft.researchPackage.title, aiInput.topic);
assert.equal(capturedGeminiRequest.value?.model, "gemini-3.5-flash-lite");
assert.equal(capturedGeminiRequest.value?.config?.responseMimeType, "application/json");
assert.ok(capturedGeminiRequest.value?.config?.responseJsonSchema, "Gemini Text uses structured response schema");
assert.equal(capturedGeminiRequest.value?.config?.tools, undefined, "production does not enable unbudgeted Google Search grounding");
assert.equal(getAiGenerationSettings(generationDb, aiEnv, Date.now()).providers.production.requestsUsed, 2, "each Gemini retry consumes one text quota request");
generationDb.close();

const failedGenerationDb = new DatabaseSync(":memory:");
failedGenerationDb.exec(aiGenerationSchema);
let providerErrorCalls = 0;
const failedProvider = new GeminiTextGenerationProvider(productionStatus.model!, "server-only-test-key", () => ({ models: { generateContent: async () => { providerErrorCalls++; throw new ApiError({ status: 429, message: "mock quota" }); } } }));
await assert.rejects(generateAiResearchStoryboard(failedGenerationDb, "production", productionStatus, aiInput, failedProvider), (error) => error instanceof GeminiTextGenerationError && error.code === "free-tier-quota");
assert.equal(providerErrorCalls, 1, "provider/network failures do not trigger generation retries");
assert.equal(getAiGenerationSettings(failedGenerationDb, aiEnv, Date.now()).providers.production.requestsUsed, 1, "failed provider request still consumes rolling request allowance");
failedGenerationDb.close();

const topicGenerationDb = new DatabaseSync(":memory:");
topicGenerationDb.exec(aiGenerationSchema);
const topicProvider: AiGenerationProvider = {
  id: "gemini-developer-api", displayName: "Gemini Text mock", model: productionStatus.model!,
  generate: async (request) => {
    const topic = request.prompt.match(/^Topic: (.+)$/m)?.[1] ?? "unknown topic";
    return { text: JSON.stringify(makeAiContent(topic)), model: productionStatus.model! };
  },
};
for (const topic of aiTopics) {
  const generatedTopic = await generateAiResearchStoryboard(topicGenerationDb, "production", { ...productionStatus, dailyLimit: 10 }, { ...aiInput, topic }, topicProvider);
  assert.equal(generatedTopic.researchPackage.title, topic, "mock Gemini Research/Storyboard generator must support unrelated topics");
  assert.equal(generatedTopic.researchPackage.scenes.length, 3);
}
assert.equal(getAiGenerationSettings(topicGenerationDb, aiEnv, Date.now()).providers.production.requestsUsed, aiTopics.length);
topicGenerationDb.close();

const openCodeEnv = { OPENCODE_SERVER_URL: "http://127.0.0.1:4096", OPENCODE_SERVER_USERNAME: "opencode", OPENCODE_SERVER_PASSWORD: "test-opencode-password" };
const openCodeDb = new DatabaseSync(":memory:");
openCodeDb.exec(aiGenerationSchema);
const openCodeDirectories: string[] = [];
let capturedOpenCodeMessage: Record<string, unknown> | undefined;
let capturedOpenCodeConfig: Record<string, unknown> | undefined;
let openCodeSessionDeleted = false;
const mockOpenCodeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const authorization = new Headers(init?.headers).get("authorization");
  if (url.pathname === "/global/health" && !authorization) return new Response("auth required", { status: 401, headers: { "www-authenticate": "Basic realm=opencode" } });
  assert.equal(authorization, `Basic ${Buffer.from("opencode:test-opencode-password").toString("base64")}`, "OpenCode Basic credentials stay server-side");
  const directory = url.searchParams.get("directory");
  if (directory) openCodeDirectories.push(directory);
  if (url.pathname === "/global/health") return Response.json({ healthy: true, version: "1.19.4" });
  if (url.pathname === "/provider") return Response.json({
    all: [
      { id: "openai", name: "OpenAI", models: { "gpt-5-mini": { id: "gpt-5-mini", name: "GPT-5 mini", status: "active" } } },
      { id: "not-connected", name: "Not connected", models: { model: { id: "model", name: "Model", status: "active" } } },
    ],
    connected: ["openai"],
  });
  if (url.pathname === "/config" && init?.method === "PATCH") { capturedOpenCodeConfig = JSON.parse(String(init.body)); return Response.json({}); }
  if (url.pathname === "/config") return Response.json({ plugin: [], mcp: {}, instructions: [] });
  if (url.pathname === "/session" && init?.method === "POST") return Response.json({ id: "session-test" });
  if (url.pathname === "/session/session-test/message") {
    capturedOpenCodeMessage = JSON.parse(String(init?.body));
    return Response.json({ info: {}, parts: [{ type: "text", text: JSON.stringify(makeAiContent(aiInput.topic)) }] });
  }
  if (url.pathname === "/session/session-test" && init?.method === "DELETE") { openCodeSessionDeleted = true; return Response.json(true); }
  if (url.pathname === "/session/session-test/abort") return Response.json(true);
  return new Response("Not found", { status: 404 });
};
const openCodeStatus = await getOpenCodeProviderStatus(openCodeEnv, mockOpenCodeFetch);
assert.equal(openCodeStatus.configured, true);
assert.equal(openCodeStatus.version, "1.19.4");
assert.deepEqual(openCodeStatus.models.map((model) => model.id), ["openai/gpt-5-mini"], "only connected provider models are listed");
assert.equal(JSON.stringify(openCodeStatus).includes("test-opencode-password"), false, "OpenCode status never exposes authentication secrets");
assert.equal((await getOpenCodeProviderStatus(openCodeEnv, async () => Response.json({ healthy: true }))).configured, false, "unauthenticated OpenCode servers fail closed");
assert.equal((await getOpenCodeProviderStatus({ ...openCodeEnv, OPENCODE_SERVER_PASSWORD: "" }, mockOpenCodeFetch)).configured, false, "OpenCode auth is required");
assert.equal((await getOpenCodeProviderStatus({ ...openCodeEnv, OPENCODE_SERVER_URL: "https://example.com" }, mockOpenCodeFetch)).configured, false, "non-loopback OpenCode endpoints are rejected");
const openCodeProvider = new OpenCodeTextGenerationProvider("openai/gpt-5-mini", openCodeEnv, mockOpenCodeFetch);
const developmentPhases: string[] = [];
const openCodeDraft = await generateAiResearchStoryboard(openCodeDb, "development", null, aiInput, openCodeProvider, { onPhase: (phase) => developmentPhases.push(phase) });
assert.equal(openCodeDraft.mode, "development", "OpenCode draft stays in Development mode");
assert.deepEqual(developmentPhases, ["connecting", "generating", "validating"], "OpenCode UI progress maps to real generation pipeline phases");
assert.equal(openCodeDraft.provider, "opencode-local");
assert.equal(openCodeDraft.model, "openai/gpt-5-mini");
assert.equal(openCodeDraft.researchPackage.title, aiInput.topic);
assert.equal(openCodeSessionDeleted, true, "temporary OpenCode session is deleted after generation");
assert.ok(openCodeDirectories.length > 0 && openCodeDirectories.every((directory) => directory.startsWith(os.tmpdir()) && !directory.startsWith(process.cwd())), "OpenCode session and config use isolated temp directories");
assert.ok(openCodeDirectories.every((directory) => !existsSync(directory)), "temporary OpenCode directories are removed after use");
assert.equal(capturedOpenCodeConfig?.model, "openai/gpt-5-mini");
assert.equal(capturedOpenCodeConfig?.small_model, "openai/gpt-5-mini", "background title/summary calls cannot pick another model");
assert.equal(capturedOpenCodeConfig?.share, "disabled", "temporary generation config disables session sharing");
assert.deepEqual(capturedOpenCodeConfig?.tools, { "*": false });
const restrictedAgent = Object.values(capturedOpenCodeConfig?.agent as Record<string, Record<string, unknown>>)[0]!;
assert.deepEqual(restrictedAgent.tools, { "*": false });
assert.deepEqual(restrictedAgent.permission, { "*": "deny" });
assert.equal(restrictedAgent.mode, "primary", "OpenCode uses dedicated generation agent, not coding agent");
assert.deepEqual(capturedOpenCodeMessage?.tools, { "*": false }, "session-level OpenCode permissions deny every tool");
assert.equal((capturedOpenCodeMessage?.agent as string).startsWith("ai_facts_"), true);
assert.deepEqual(capturedOpenCodeMessage?.model, { providerID: "openai", modelID: "gpt-5-mini" });
assert.deepEqual(capturedOpenCodeMessage?.parts && (capturedOpenCodeMessage.parts as Array<{ type: string }>).map((part) => part.type), ["text"], "only user prompt text enters OpenCode session");
assert.equal(getAiGenerationSettings(openCodeDb, aiEnv, Date.now()).providers.production.requestsUsed, 0, "Development OpenCode requests do not consume Gemini quota");

let remoteAbortCalled = false;
const abortableOpenCodeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.pathname === "/global/health" && !new Headers(init?.headers).has("authorization")) return new Response("auth required", { status: 401, headers: { "www-authenticate": "Basic realm=opencode" } });
  if (url.pathname === "/global/health") return Response.json({ healthy: true, version: "1.19.4" });
  if (url.pathname === "/provider") return Response.json({ all: [{ id: "openai", name: "OpenAI", models: { model: { id: "model", name: "Model", status: "active" } } }], connected: ["openai"] });
  if (url.pathname === "/config" && init?.method === "PATCH") return Response.json({});
  if (url.pathname === "/config") return Response.json({ plugin: [], mcp: {}, instructions: [] });
  if (url.pathname === "/session" && init?.method === "POST") return Response.json({ id: "session-test" });
  if (url.pathname === "/session/session-test/message") return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) reject(new DOMException("Aborted", "AbortError"));
    else signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  if (url.pathname === "/session/session-test/abort") { remoteAbortCalled = true; return Response.json(true); }
  if (url.pathname === "/session/session-test" && init?.method === "DELETE") return Response.json(true);
  return new Response("Not found", { status: 404 });
};
const cancelController = new AbortController();
const abortableProvider = new OpenCodeTextGenerationProvider("openai/model", openCodeEnv, abortableOpenCodeFetch);
await assert.rejects(abortableProvider.generate({ task: "research", prompt: "test", outputFormat: "ai-research-storyboard-v1", signal: cancelController.signal, onPhase: () => cancelController.abort() }), (error) => error instanceof OpenCodeGenerationError && error.code === "cancelled");
assert.equal(remoteAbortCalled, true, "Cancel interrupts active OpenCode session");
openCodeDb.close();

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

console.log(`PASS: ${samples.length} packages; migration/schema/audio, AI mode/providers/quota, OpenCode isolation/cancel, workflow gates/review invalidation, renderer/cue determinism, Gemini TTS guard/cache, timing, rolling limits.`);
