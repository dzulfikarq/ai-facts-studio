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
import { renderedVisualBounds } from "../src/domain/visual-geometry";
import { validateRasterImage } from "../src/domain/visual-assets";
import { visualSemanticPlanSchema } from "../src/domain/visual-semantic-plan";
import { applyVisualStoryboard, buildVisualStoryboard, legacyVisualApprovalFingerprint, visualApprovalFingerprint, visualStoryboardQualityGate, visualStoryboardSchema, type VisualStoryboardScene } from "../src/domain/visual-storyboard";
import { composeVisualScene, hasGenericIconCards, visualRelationshipIsVisible } from "../src/domain/visual-composer";
import { visualObjectLibrary } from "../src/domain/visual-objects";
import { canAdvanceWorkspaceStep, previewReviewFingerprint, reachableWorkspaceStep, workflowStatuses, type WorkflowSignals } from "../src/client/workflow";
import { aiGeneratedContentSchema, aiGenerationInputSchema, buildAiGenerationDraft, buildDevelopmentPrompt, parseManualAiResult, parseManualAiResultText, researchPackageWithConfirmedSources, restoreAiGenerationDraft, type AiGeneratedContent } from "../src/domain/ai-generation";
import { aiGenerationSchema, DEFAULT_TEXT_MODEL, FREE_TIER_TEXT_MODELS, getAiGenerationSettings, getGeminiTextQuotaMonitoring, getProductionProviderStatus, isLoopbackAddress, readAiGenerationMode, writeAiGenerationMode } from "../src/server/ai-generation/provider";
import { AiGenerationRequestError, reserveAiGenerationRequest } from "../src/server/ai-generation/quota";
import { GeminiTextGenerationError, GeminiTextGenerationProvider } from "../src/server/ai-generation/gemini-text-provider";
import { getOpenCodeProviderStatus, OpenCodeGenerationError, OpenCodeTextGenerationProvider, restrictedOpenCodeEnvironment, type RestrictedOpenCodeServerFactory } from "../src/server/ai-generation/opencode-provider";
import { generateAiResearchStoryboard } from "../src/server/ai-generation/generate";
import { generateVisualSemanticPlan } from "../src/server/ai-generation/visual-planner";
import type { AiGenerationProvider } from "../src/server/ai-generation/provider";
import { fillEmptyGeminiTextEnvironment } from "../src/server/environment";

const samples = ["mountain-formation", "space-orbit", "animal-habitat", "lightning-charge", "kenapa-air-laut-asin", "bagaimana-bumi-melindungi-kita"];
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
const seaSalt = parsedSamples.find((sample) => sample.id === "why-seawater-is-salty-id")!;
const solarProtection = parsedSamples.at(-1)!;
const mountainStoryboard = buildVisualStoryboard(mountain);
assert.equal(seaSalt.title, "Kenapa Air Laut Asin?");
assert.equal(seaSalt.scenes.length, 5);
assert.equal(solarProtection.scenes.length, 5, "Earth protection POC contains all five requested beats");
assert.equal(visualStoryboardQualityGate(mountain, mountainStoryboard).ready, true, "mountain storyboard has visual evidence for each planned concept");
assert.deepEqual(mountainStoryboard.scenes[0]!.composition.layers.map((layer) => layer.id), ["sunlight", "cloud", "mountain", "rock"], "mountain hook depicts sun, cloud, peak, and rock instead of claiming missing evidence");
assert.ok(mountainStoryboard.scenes[3]!.composition.layers.some((layer) => layer.id === "rock" && layer.nodes.some((node) => node.type === "path")), "folding scene draws layered rock paths");
assert.ok(mountainStoryboard.scenes[4]!.composition.layers.some((layer) => layer.id === "mountain") && mountainStoryboard.scenes[4]!.composition.layers.some((layer) => layer.id === "tectonic-plates"), "Himalaya scene connects uplifted peaks to colliding plates");
assert.ok(mountainStoryboard.scenes[4]!.composition.layers.flatMap((layer) => layer.nodes).some((node) => node.type === "text" && node.text === "INDIA → EURASIA"), "Himalaya diagram identifies both colliding continents");
const seaSaltNodes = seaSalt.scenes.flatMap((scene) => scene.visualComposition.layers.flatMap((layer) => layer.nodes));
assert.ok(seaSaltNodes.some((node) => node.type === "path"), "salt sample uses continuous landscape and water paths");
const saltStoryboard = buildVisualStoryboard(seaSalt);
const solarStoryboard = buildVisualStoryboard(solarProtection);
assert.equal(visualStoryboardQualityGate(seaSalt, saltStoryboard).ready, true, "salt storyboard passes relevance, density, and text-layout gate");
assert.equal(visualStoryboardQualityGate(solarProtection, solarStoryboard).ready, true, `Earth protection storyboard passes visual quality gate: ${JSON.stringify(visualStoryboardQualityGate(solarProtection, solarStoryboard).issues)}`);
assert.deepEqual(saltStoryboard.scenes.map((scene) => scene.compositionType), ["hero-object-focus", "cross-section", "connected-environment", "cross-section", "scientific-diagram"], "five salt scenes use distinct narrative-fit compositions");
assert.ok(saltStoryboard.scenes.flatMap((scene) => scene.composition.layers.flatMap((layer) => layer.nodes)).some((node) => node.type === "shape" && node.shape === "circle"), "dissolved ions use particle shapes, not crystal cards");
assert.ok(saltStoryboard.scenes[2]!.composition.layers.some((layer) => layer.id === "mountain") && saltStoryboard.scenes[2]!.composition.layers.some((layer) => layer.id === "river") && saltStoryboard.scenes[2]!.composition.layers.some((layer) => layer.id === "coast-and-ocean"), "river scene is one connected mountain-to-sea illustration");
const brokenRiver = structuredClone(saltStoryboard.scenes[2]!.composition);
brokenRiver.layers.find((layer) => layer.id === "river")!.nodes = [];
assert.equal(visualRelationshipIsVisible(saltStoryboard.scenes[2]!.relationships.find((relation) => relation.relation === "flows-to")!, brokenRiver), false, "two object/layer names without connecting path do not satisfy relation gate");
assert.ok(saltStoryboard.scenes[1]!.composition.layers.flatMap((layer) => layer.nodes).some((node) => node.motion === "fall"), "rain falls deterministically by frame");
assert.ok(saltStoryboard.scenes[2]!.composition.layers.flatMap((layer) => layer.nodes).some((node) => node.motion === "flow"), "mineral particles flow along connected landscape");
assert.ok(saltStoryboard.scenes[3]!.composition.layers.flatMap((layer) => layer.nodes).some((node) => node.motion === "rise"), "evaporation rises while salt stays put");
const approvedSalt = structuredClone(saltStoryboard);
approvedSalt.scenes[0]!.approved = true;
approvedSalt.scenes[0]!.approvedFingerprint = visualApprovalFingerprint(approvedSalt.scenes[0]!);
assert.equal(visualStoryboardSchema.safeParse(approvedSalt).success, true, "approval records rendered visual fingerprint");
const legacyApproved = JSON.parse(JSON.stringify(saltStoryboard)) as { scenes: Array<Record<string, any>> };
legacyApproved.scenes[0]!.approved = true;
legacyApproved.scenes[0]!.approvedFingerprint = legacyVisualApprovalFingerprint(legacyApproved.scenes[0] as unknown as VisualStoryboardScene);
delete legacyApproved.scenes[0]!.relationships;
delete legacyApproved.scenes[0]!.compositionSource;
delete legacyApproved.scenes[0]!.missingVisuals;
assert.equal(visualStoryboardSchema.safeParse(legacyApproved).success, true, "legacy approved storyboard migrates missing composer metadata");
const staleSalt = structuredClone(approvedSalt);
staleSalt.scenes[0]!.composition.background = "#ffffff";
assert.equal(visualStoryboardSchema.safeParse(staleSalt).success, false, "visual edit makes existing approval stale");
const genericGrid = structuredClone(saltStoryboard);
genericGrid.scenes[0]!.layout = "two-column-object-grid";
assert.ok(visualStoryboardQualityGate(seaSalt, genericGrid).scenes[genericGrid.scenes[0]!.sceneId]?.some((issue) => issue.includes("kartu ikon generik")), "quality gate rejects generic icon-card scenes");
assert.equal(saltStoryboard.styleId, solarStoryboard.styleId, "art direction remains consistent across topics");
assert.deepEqual(new Set(saltStoryboard.scenes.flatMap((scene) => scene.objects.map((object) => object.objectId))), new Set(["ocean", "salt-crystal", "rain", "mountain", "rock", "mineral", "river", "sun", "evaporation"]), "salt storyboard maps land, river, sea, evaporation, and dissolved-ion assets");
assert.deepEqual(new Set(solarStoryboard.scenes.flatMap((scene) => scene.objects.map((object) => object.objectId))), new Set(["sun", "earth", "atmosphere", "ozone-layer", "uv-rays", "charged-particles", "magnetosphere"]), "solar storyboard maps Sun, Earth, atmosphere, ozone, UV, particles, and magnetosphere");
assert.ok(solarStoryboard.reusableWorldObjects.includes("earth"), "Earth is reused across solar topic scenes");
assert.ok(solarStoryboard.scenes.every((scene) => !scene.approved), "new storyboard scenes require explicit visual approval");
assert.ok(solarStoryboard.scenes.some((scene) => scene.composition.layers.some((layer) => layer.id === "earth-world")), "Earth art direction reuses same planet layer across scenes");
assert.ok(solarStoryboard.scenes[0]!.composition.layers.every((layer) => !layer.id.includes("orbit-diagram")), "unrelated initial orbit template is not reused for sunlight explanation");
assert.ok(solarStoryboard.scenes[4]!.composition.layers.some((layer) => layer.id === "uv-rays"), "two-shield scene exposes UV paths as semantic evidence");
assert.ok(solarStoryboard.scenes[2]!.relationships.some((relation) => relation.from === "ozone-layer" && relation.relation === "filters"), "ozone-to-UV relation is scoped to scene concepts");
assert.ok(solarStoryboard.scenes[1]!.composition.layers.some((layer) => layer.id === "atmosphere") && !solarStoryboard.scenes[1]!.composition.layers.some((layer) => layer.id === "geological-layers"), "atmosphere scene uses atmospheric geometry, not geological cross-section");
const offsetVisual = structuredClone(saltStoryboard);
const offsetScene = offsetVisual.scenes[3]!;
for (const layer of offsetScene.composition.layers) for (const node of layer.nodes) {
  if (node.type === "group") for (const child of node.children) child.y += 280;
  else node.y += 280;
}
assert.ok(offsetScene.composition.layers.flatMap((layer) => layer.nodes).some((node) => node.y > 1500), "fixture keeps raw authoring coordinates below canvas limit but beyond old safe-area cutoff");
assert.ok(!visualStoryboardQualityGate(seaSalt, offsetVisual).scenes[offsetScene.sceneId]?.some((issue) => issue.includes("area visual aman")), "safe-area gate evaluates renderer-centered/scaled bounds, not raw coordinates");
const imageHeader = Buffer.alloc(33);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(imageHeader);
imageHeader.write("IHDR", 12, "ascii"); imageHeader.writeUInt32BE(128, 16); imageHeader.writeUInt32BE(96, 20);
assert.deepEqual(validateRasterImage(imageHeader), { format: "png", extension: "png", width: 128, height: 96 }, "PNG signature and dimensions are parsed from bytes");
assert.throws(() => validateRasterImage(Buffer.from("<svg onload=alert(1) />")), /PNG, JPEG, atau WebP/);
const semanticPlan = {
  primaryVisualConcept: "Mineral bergerak dari hulu ke laut",
  objects: ["mountain", "river", "mineral", "ocean"],
  relationships: [{ from: "river", relation: "flows-to", to: "ocean" }, { from: "river", relation: "carries", to: "mineral" }],
  environment: "Satu lembah mengalir dari pegunungan ke pesisir",
  processAction: "Aliran membawa partikel mineral menuju muara",
  illustrationStyle: "continuous-landscape",
  visualFocus: "river",
  requiredAssets: ["river", "mineral", "ocean"],
  supportingAssets: ["mountain"],
  compositionType: "connected-environment",
} as const;
assert.equal(visualSemanticPlanSchema.safeParse(semanticPlan).success, true, "semantic plan is bounded and links relationships to declared objects");
assert.equal(visualSemanticPlanSchema.safeParse({ ...semanticPlan, relationships: [{ from: "sun", relation: "illuminates", to: "earth" }] }).success, false, "planner cannot invent undeclared relationship endpoints");
assert.equal(visualSemanticPlanSchema.safeParse({ ...semanticPlan, requiredAssets: ["sun"] }).success, false, "required/supporting assets must be declared in the object plan");
const localConceptsOnly = composeVisualScene({
  headline: "LAUT ASIN", narration: "Ion mineral terlarut membuat air laut asin.", visualDescription: "Ion tersebar di air laut.",
  artDirection: { styleId: saltStoryboard.styleId, palette: saltStoryboard.palette }, sceneVisualFocus: "ocean", illustrationIntent: "",
  sharedWorldObjects: ["river", "mountain"], assetLibrary: visualObjectLibrary, preserveExisting: false,
});
assert.ok(!localConceptsOnly.relationships.some((relation) => relation.from === "river"), "shared-world objects cannot create unstated scene relations");
const singleObjectVisual = composeVisualScene({
  headline: "MATAHARI", narration: "Matahari tampak terang.", visualDescription: "Matahari menjadi fokus visual.",
  artDirection: { styleId: saltStoryboard.styleId, palette: saltStoryboard.palette }, sceneVisualFocus: "sun", illustrationIntent: "",
  sharedWorldObjects: [], assetLibrary: visualObjectLibrary, preserveExisting: false,
});
assert.ok(singleObjectVisual.composition && singleObjectVisual.composition.layers.some((layer) => layer.id === "sun"), "single supported object receives layered procedural illustration");
assert.equal(singleObjectVisual.status, "needs_review", "procedural single-object scene requests human inspection without blocking authoring");
assert.ok(singleObjectVisual.composition!.layers.flatMap((layer) => layer.nodes).some((node) => node.type === "path"), "single-object visual uses paths, not icon cards");
const genericCardComposition = {
  background: "#e8f3ed",
  layers: [{ id: "object-sun", depth: 0.5, nodes: [
    { type: "shape" as const, shape: "rect" as const, x: 100, y: 500, width: 450, height: 200, fill: "#ffffff" },
    { type: "icon" as const, icon: "sun" as const, x: 260, y: 510, width: 100, height: 100, color: "#267a76" },
    { type: "text" as const, x: 100, y: 620, width: 450, height: 50, text: "MATAHARI", color: "#173740", fontSize: 24, font: "heading" as const, weight: "700" as const, align: "middle" as const },
  ] }],
};
assert.equal(hasGenericIconCards(genericCardComposition), true, "large icon-and-label cards are recognized as generic fallback art");
const regeneratedCard = composeVisualScene({
  headline: "MATAHARI", narration: "Matahari tampak terang.", visualDescription: "Matahari menjadi fokus visual.",
  artDirection: { styleId: saltStoryboard.styleId, palette: saltStoryboard.palette }, sceneVisualFocus: "sun", illustrationIntent: "",
  existingComposition: genericCardComposition, sharedWorldObjects: [], assetLibrary: visualObjectLibrary, preserveExisting: true,
});
assert.notEqual(regeneratedCard.composition, genericCardComposition, "generic initial composition is replaced by a relevant scene illustration");
const reviewBoard = structuredClone(saltStoryboard);
reviewBoard.scenes[0]!.authoringStatus = "needs_review";
reviewBoard.scenes[0]!.compositionSource = "procedural";
const reviewGate = visualStoryboardQualityGate(seaSalt, reviewBoard);
assert.equal(reviewGate.status, "needs_review", "available procedural art surfaces human review as distinct gate status");
assert.equal(reviewGate.issues.length, 0, "needs_review does not masquerade as missing visual or structural failure");
const protectedManual = composeVisualScene({
  headline: "MATAHARI", narration: "Matahari tampak terang.", visualDescription: "Matahari menjadi fokus visual.",
  artDirection: { styleId: saltStoryboard.styleId, palette: saltStoryboard.palette }, sceneVisualFocus: "sun", illustrationIntent: "Manual scene",
  existingVisualPlan: { objects: ["earth"], relationships: [], source: "manual", status: "needs_review", authoringConfirmed: true },
  existingComposition: solarStoryboard.scenes[3]!.composition, sharedWorldObjects: [], assetLibrary: visualObjectLibrary, preserveExisting: true,
});
assert.equal(protectedManual.composition, solarStoryboard.scenes[3]!.composition, "manual composition remains untouched unless replacement is explicitly requested");
const confirmedReplacement = composeVisualScene({
  headline: "MATAHARI", narration: "Matahari tampak terang.", visualDescription: "Matahari menjadi fokus visual.",
  artDirection: { styleId: saltStoryboard.styleId, palette: saltStoryboard.palette }, sceneVisualFocus: "sun", illustrationIntent: "",
  existingVisualPlan: { objects: ["earth"], relationships: [], source: "manual", status: "needs_review", authoringConfirmed: true },
  existingComposition: protectedManual.composition, sharedWorldObjects: [], assetLibrary: visualObjectLibrary, preserveExisting: false,
});
assert.ok(confirmedReplacement.composition && confirmedReplacement.composition !== protectedManual.composition, "explicitly confirmed regeneration can replace manual composition");
const solarVisualPackage = parseResearchPackage(applyVisualStoryboard(solarProtection, solarStoryboard));
assert.equal(solarVisualPackage.success, true, "art-directed visuals remain valid renderer input");
if (solarVisualPackage.success) assert.ok(solarVisualPackage.data.scenes.every((scene) => scene.motionPlan.every((plan) => ["all", "scene", ...scene.visualComposition.layers.map((layer) => layer.id)].includes(plan.targetLayer))), "motion intent targets existing storyboard layers");
const unsupportedResearch = parseResearchPackage({ ...mountain, scenes: mountain.scenes.map((scene) => ({ ...scene, onScreenText: "KONSEP YANG BELUM DIDUKUNG", narrationText: "Topik khusus ini membutuhkan ilustrasi teknis yang belum tersedia.", visualDescription: "Butuh authoring visual khusus untuk konsep baru." })) });
assert.equal(unsupportedResearch.success, true);
if (unsupportedResearch.success) {
  const unsupportedBoard = buildVisualStoryboard(unsupportedResearch.data);
  assert.ok(unsupportedBoard.scenes.every((scene) => scene.authoringStatus === "needs_visual_authoring" && scene.objects.length === 0), "unsupported concepts never receive a silent generic object plan");
  assert.equal(visualStoryboardQualityGate(unsupportedResearch.data, unsupportedBoard).ready, false, "unsupported visuals block approval until authored");
}
const overlapBoard = structuredClone(saltStoryboard);
overlapBoard.scenes[0]!.composition.layers[0]!.nodes.push({ type: "text", x: 100, y: 320, width: 850, height: 60, text: "HEADLINE COLLISION", color: "#173740", fontSize: 30, font: "heading", weight: "700", align: "middle" });
assert.ok(visualStoryboardQualityGate(seaSalt, overlapBoard).scenes[overlapBoard.scenes[0]!.sceneId]?.some((issue) => issue.includes("headline atau subtitle")), "headline overlap fails visual quality gate");
const denseBoard = structuredClone(saltStoryboard);
denseBoard.scenes[0]!.composition.layers[0]!.nodes.push(...Array.from({ length: 20 }, (_, index) => ({ type: "shape" as const, shape: "ellipse" as const, x: 900, y: 500 + index, width: 16, height: 16, fill: "#087f8c" })));
assert.ok(visualStoryboardQualityGate(seaSalt, denseBoard).scenes[denseBoard.scenes[0]!.sceneId]?.some((issue) => issue.includes("terlalu padat")), "overcrowded composition fails visual quality gate");
const unsafeStoryboard = structuredClone(solarStoryboard) as unknown as Record<string, any>;
unsafeStoryboard.scenes[0].objects[0].assetId = "javascript:alert(1)";
assert.equal(visualStoryboardSchema.safeParse(unsafeStoryboard).success, false, "storyboard asset IDs are constrained to internal library");
const clearAudio = { expected: true, codec: "aac", videoDurationSec: 12, audioDurationSec: 12, expectedAudioDurationSec: 12, meanVolumeDb: -20, maxVolumeDb: -2 };
assert.equal(validateAudioQuality(clearAudio).audioValidation, "pass");
assert.throws(() => validateAudioQuality({ ...clearAudio, meanVolumeDb: -91, maxVolumeDb: -91 }), /senyap/i);
assert.throws(() => validateAudioQuality({ ...clearAudio, maxVolumeDb: 0 }), /clipping/i);
assert.throws(() => validateAudioQuality({ ...clearAudio, audioDurationSec: 9 }), /terpotong/i);
assert.equal(validateAudioQuality({ ...clearAudio, expected: false, meanVolumeDb: -91, maxVolumeDb: -91 }).audioValidation, "silent-expected");
assert.throws(() => validateAudioQuality({ ...clearAudio, expected: false }), /non-senyap/i);
const invalidFlow = structuredClone(seaSalt);
invalidFlow.scenes[1]!.visualComposition.layers[0]!.nodes.push({ type: "diagram", kind: "process-flow", x: 700, y: 1100, width: 200, height: 200, labels: ["ONE STEP"] });
assert.equal(parseResearchPackage(invalidFlow).success, false, "process-flow accepts two to four labeled steps");
const badUrl = structuredClone(mountain);
badUrl.references[0]!.url = "javascript:alert(1)";
assert.equal(parseResearchPackage(badUrl).success, false, "unsafe URL must fail");

const workflowBase: WorkflowSignals = {
  activeStep: "materials", hasResearch: true, saved: true, visualStoryboardReady: true, visualStoryboardApproved: false, hasAudio: true, audioMatchesNarration: true,
  hasPendingAudio: false, reviewVerified: false, hasWarnings: false, previewReviewed: false,
  latestJobContentCurrent: false,
};
assert.equal(workflowStatuses(workflowBase).materials, "active");
assert.equal(reachableWorkspaceStep("render", workflowBase), "visual", "resume must stop at Visual Storyboard approval gate");
assert.equal(reachableWorkspaceStep("render", { ...workflowBase, visualStoryboardApproved: true }), "review", "visual approval precedes research review");
assert.equal(reachableWorkspaceStep("render", { ...workflowBase, visualStoryboardApproved: true, reviewVerified: true }), "preview");
assert.equal(reachableWorkspaceStep("render", { ...workflowBase, visualStoryboardApproved: true, reviewVerified: true, previewReviewed: true }), "render");
assert.equal(canAdvanceWorkspaceStep("narration", { ...workflowBase, audioMatchesNarration: false }), false, "stale AI audio blocks progression");
assert.equal(reachableWorkspaceStep("render", { ...workflowBase, visualStoryboardApproved: true, audioMatchesNarration: false }), "narration");
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
const dotenvFallbackEnv: NodeJS.ProcessEnv = { GEMINI_API_KEY: "", GEMINI_TEXT_FREE_TIER_ONLY: "false" };
fillEmptyGeminiTextEnvironment(dotenvFallbackEnv, { GEMINI_API_KEY: "dotenv-test-key", GEMINI_TEXT_FREE_TIER_ONLY: "true", GEMINI_TEXT_MODEL: "gemini-3.8-flash" });
assert.equal(dotenvFallbackEnv.GEMINI_API_KEY, "dotenv-test-key", "nonempty .env key fills inherited empty process env value");
assert.equal(dotenvFallbackEnv.GEMINI_TEXT_FREE_TIER_ONLY, "false", "explicit process guard value is never overwritten by .env fallback");
assert.equal(dotenvFallbackEnv.GEMINI_TEXT_MODEL, "gemini-3.8-flash", "blank model env loads from .env without overriding nonempty values");
const noDotenvGuard: NodeJS.ProcessEnv = {};
fillEmptyGeminiTextEnvironment(noDotenvGuard, { GEMINI_API_KEY: "dotenv-test-key" });
assert.equal(noDotenvGuard.GEMINI_TEXT_FREE_TIER_ONLY, undefined, "environment loader never enables Free Tier guard automatically");
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
assert.equal(getProductionProviderStatus({ ...aiEnv, GEMINI_TEXT_RPM_LIMIT: "0" }).configured, false, "invalid operator-configured project quota fails closed");
const monitoredQuotaDb = new DatabaseSync(":memory:");
monitoredQuotaDb.exec(aiGenerationSchema);
const monitoredEnv = { ...aiEnv, AI_GENERATION_DAILY_REQUEST_LIMIT: "20", GEMINI_TEXT_RPM_LIMIT: "2", GEMINI_TEXT_RPD_LIMIT: "3", GEMINI_TEXT_TPM_LIMIT: "300" };
const monitoredStatus = getProductionProviderStatus(monitoredEnv);
monitoredQuotaDb.prepare("INSERT INTO ai_generation_attempts (id, requested_at, task, provider, model, state, total_tokens) VALUES (?, ?, 'research', ?, ?, 'succeeded', ?)")
  .run("rpm-one", new Date(aiNow - 50_000).toISOString(), monitoredStatus.id, monitoredStatus.model, 100);
monitoredQuotaDb.prepare("INSERT INTO ai_generation_attempts (id, requested_at, task, provider, model, state, total_tokens) VALUES (?, ?, 'research', ?, ?, 'failed', ?)")
  .run("rpm-two", new Date(aiNow - 30_000).toISOString(), monitoredStatus.id, monitoredStatus.model, 250);
monitoredQuotaDb.prepare("INSERT INTO ai_generation_attempts (id, requested_at, task, provider, model, state, total_tokens) VALUES (?, ?, 'research', ?, ?, 'succeeded', ?)")
  .run("other-model", new Date(aiNow - 5_000).toISOString(), monitoredStatus.id, "gemini-3.8-flash", 900);
const quotaMonitoring = getGeminiTextQuotaMonitoring(monitoredQuotaDb, monitoredStatus.model, monitoredStatus.projectLimits, aiNow);
assert.equal(quotaMonitoring.rpm.used, 2, "local RPM counts this Gemini model over rolling 60 seconds");
assert.equal(quotaMonitoring.rpm.estimatedRemaining, 0);
assert.equal(quotaMonitoring.rpm.cooldownUntil, new Date(aiNow + 10_000).toISOString(), "RPM cooldown follows oldest request expiry");
assert.equal(quotaMonitoring.rpd.used, 2, "local RPD counts recorded attempts for selected model");
assert.equal(quotaMonitoring.tpm.used, 350, "local TPM sums recorded token usage only for selected model");
assert.equal(quotaMonitoring.tpm.cooldownUntil, new Date(aiNow + 10_000).toISOString());
assert.equal(quotaMonitoring.usageSource, "local-records");
assert.equal(quotaMonitoring.limitSource, "operator-configured-ai-studio");
assert.throws(() => reserveAiGenerationRequest(monitoredQuotaDb, "production", { ...monitoredStatus, quotaMonitoring }, "research", aiNow), (error) => error instanceof AiGenerationRequestError && error.code === "local-rate-limit" && error.quotaType === "RPM" && error.nextAllowedAt === new Date(aiNow + 10_000).toISOString());
assert.throws(() => reserveAiGenerationRequest(monitoredQuotaDb, "production", { ...monitoredStatus, projectLimits: { ...monitoredStatus.projectLimits, rpm: 10 }, quotaMonitoring }, "research", aiNow), (error) => error instanceof AiGenerationRequestError && error.quotaType === "TPM");
assert.throws(() => reserveAiGenerationRequest(monitoredQuotaDb, "production", { ...monitoredStatus, projectLimits: { ...monitoredStatus.projectLimits, rpm: 10, rpd: 2 }, quotaMonitoring }, "research", aiNow), (error) => error instanceof AiGenerationRequestError && error.quotaType === "RPD");
const afterRpmCooldown = reserveAiGenerationRequest(monitoredQuotaDb, "production", monitoredStatus, "research", aiNow + 10_001);
assert.ok(afterRpmCooldown.id, "new request allowed once local RPM/TPM observations expire");
monitoredQuotaDb.close();
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
    return { text: providerCalls === 1 ? "not-json" : JSON.stringify(makeAiContent(aiInput.topic)), modelVersion: productionStatus.model, usageMetadata: { promptTokenCount: 5 + providerCalls, candidatesTokenCount: 7, totalTokenCount: 12 + providerCalls } } as unknown as GenerateContentResponse;
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
assert.equal(getAiGenerationSettings(generationDb, { ...aiEnv, GEMINI_TEXT_TPM_LIMIT: "1000" }, Date.now()).providers.production.quotaMonitoring.tpm.used, 27, "TPM monitoring persists prompt and output token metadata from both attempts");
generationDb.close();

const failedGenerationDb = new DatabaseSync(":memory:");
failedGenerationDb.exec(aiGenerationSchema);
let providerErrorCalls = 0;
const googleRateLimit = JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota exceeded", details: [
  { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_tokens_per_minute", quotaId: "tokens-per-minute" }] },
  { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "30s" },
] } });
const failedProvider = new GeminiTextGenerationProvider(productionStatus.model!, "server-only-test-key", () => ({ models: { generateContent: async () => { providerErrorCalls++; throw new ApiError({ status: 429, message: googleRateLimit }); } } }));
const beforeGoogleRateLimit = Date.now();
await assert.rejects(generateAiResearchStoryboard(failedGenerationDb, "production", productionStatus, aiInput, failedProvider), (error) => {
  assert.ok(error instanceof GeminiTextGenerationError);
  assert.equal(error.code, "free-tier-quota");
  assert.equal(error.quotaType, "TPM", "Google 429 reports quota metric type");
  assert.ok(error.retryAt && Date.parse(error.retryAt) >= beforeGoogleRateLimit + 30_000 && Date.parse(error.retryAt) <= Date.now() + 30_100, "Google RetryInfo is surfaced as retry timestamp");
  assert.match(error.message, /TPM/);
  assert.match(error.message, /tidak diganti otomatis/);
  return true;
});
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
let restrictedServerClosed = false;
const fakeRestrictedServer: RestrictedOpenCodeServerFactory = async () => ({
  config: { baseUrl: new URL("http://127.0.0.1:4096"), username: "opencode", password: "test-opencode-password" },
  close: async () => { restrictedServerClosed = true; },
});
const mockOpenCodeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const authorization = new Headers(init?.headers).get("authorization");
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
    padding: "x".repeat(2_100_000),
  });
  if (url.pathname === "/config" && init?.method === "PATCH") { capturedOpenCodeConfig = JSON.parse(String(init.body)); return Response.json({}); }
  if (url.pathname === "/config") return Response.json({ plugin: ["opencode-caveman", "opencode-rtk", "@example/plugin"], mcp: {}, instructions: [] });
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
assert.equal(openCodeStatus.apiVersion, "v1");
assert.equal(openCodeStatus.state, "connected");
assert.deepEqual(openCodeStatus.models.map((model) => model.id), ["openai/gpt-5-mini"], "only connected provider models are listed");
assert.equal(JSON.stringify(openCodeStatus).includes("test-opencode-password"), false, "OpenCode status never exposes authentication secrets");
assert.equal((await getOpenCodeProviderStatus(openCodeEnv, async (input) => new URL(String(input)).pathname === "/api/info" ? Response.json({ healthy: true }) : new Response("<html>Web UI</html>", { status: 200, headers: { "content-type": "text/html" } }))).state, "unsupported-api-version", "HTTP 200 HTML health page is not API or auth success");
const v1RejectedAuthFetch: typeof fetch = async (input) => {
  const route = new URL(String(input)).pathname;
  if (route === "/api/info") return new Response("Not found", { status: 404 });
  if (route === "/global/health") return Response.json({ healthy: true, version: "1.19.4" });
  return new Response("Unauthorized", { status: 401 });
};
const v1RejectedAuth = await getOpenCodeProviderStatus(openCodeEnv, v1RejectedAuthFetch);
assert.equal(v1RejectedAuth.state, "authentication-failed", "V1 health 200 without WWW-Authenticate cannot override protected API 401");
assert.equal((await getOpenCodeProviderStatus({ ...openCodeEnv, OPENCODE_SERVER_PASSWORD: "" }, mockOpenCodeFetch)).state, "authentication-failed", "OpenCode Basic auth is required");
assert.equal((await getOpenCodeProviderStatus({ ...openCodeEnv, OPENCODE_SERVER_URL: "https://example.com" }, mockOpenCodeFetch)).state, "server-unreachable", "non-loopback OpenCode endpoints are rejected");
const v2Env = { ...openCodeEnv, OPENCODE_SERVER_URL: "http://127.0.0.1:4097" };
const v2Auth = `Basic ${Buffer.from("opencode:test-opencode-password").toString("base64")}`;
const v2Directories: string[] = [];
let capturedV2Session: Record<string, unknown> | undefined;
let capturedV2Generate: Record<string, unknown> | undefined;
const v2SessionDirectories: string[] = [];
let v2SessionDeleted = false;
let v2RestrictedServerClosed = false;
const v2RestrictedServer: RestrictedOpenCodeServerFactory = async () => ({
  config: { baseUrl: new URL("http://127.0.0.1:4097"), username: "opencode", password: "test-opencode-password" },
  close: async () => { v2RestrictedServerClosed = true; },
});
const v2Fetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const authorization = new Headers(init?.headers).get("authorization");
  if (url.pathname === "/api/info" && authorization !== v2Auth) return Response.json({ _tag: "UnauthorizedError" }, { status: 401 });
  assert.equal(authorization, v2Auth, "V2 API requests require configured Basic credentials");
  const directory = url.searchParams.get("location[directory]");
  if (directory) v2Directories.push(directory);
  if (url.pathname === "/api/info") return Response.json({ version: "2.1.4", pid: 1234, urls: [], paths: { tmp: "/tmp" }, capabilities: {} });
  if (url.pathname === "/api/model") return Response.json({ location: { directory: directory ?? "" }, data: [
    { id: "gpt-6-luna", modelID: "gpt-6-luna", providerID: "openai", name: "GPT-6 Luna", status: "active", enabled: true },
    { id: "gpt-6-luna", modelID: "gpt-6-luna", providerID: "openai", name: "Duplicate GPT-6 Luna", status: "active", enabled: true },
    { id: "blocked-model", modelID: "blocked-model", providerID: "disabled-provider", name: "Blocked", status: "active", enabled: true },
  ] });
  if (url.pathname === "/api/provider") return Response.json({ location: { directory: directory ?? "" }, data: [
    { id: "openai", name: "OpenAI", activation: "auto" },
    { id: "disabled-provider", name: "Disabled", activation: "disabled" },
  ] });
  if (url.pathname === "/api/mcp") return Response.json({ location: { directory: directory ?? "" }, data: [{ name: "disabled", status: { status: "disabled" } }] });
  if (url.pathname === "/api/config") return Response.json([{ type: "document", path: "opencode.jsonc", info: { instructions: [] } }]);
  if (url.pathname === "/api/session" && init?.method === "POST") {
    const session = JSON.parse(String(init.body)) as Record<string, unknown>;
    capturedV2Session = session;
    const location = (session.location as { directory?: unknown } | undefined)?.directory;
    if (typeof location === "string") v2SessionDirectories.push(location);
    return Response.json({ data: { id: "v2-session-test" } });
  }
  if (url.pathname === "/api/session/v2-session-test/generate") {
    capturedV2Generate = JSON.parse(String(init?.body));
    return Response.json({ data: { text: JSON.stringify(makeAiContent(aiInput.topic)) } });
  }
  if (url.pathname === "/api/session/v2-session-test" && init?.method === "DELETE") { v2SessionDeleted = true; return Response.json({ deleted: true }); }
  if (url.pathname === "/api/session/v2-session-test/interrupt") return Response.json({ interrupted: true });
  return new Response("Not found", { status: 404 });
};
const v2Status = await getOpenCodeProviderStatus(v2Env, v2Fetch);
assert.equal(v2Status.configured, true);
assert.equal(v2Status.connected, true);
assert.equal(v2Status.state, "connected");
assert.equal(v2Status.version, "2.1.4");
assert.equal(v2Status.apiVersion, "v2");
assert.deepEqual(v2Status.models.map((model) => model.id), ["openai/gpt-6-luna"], "V2 catalog requires enabled model, filters disabled providers, and deduplicates IDs");
const v2ModelOnlyStatus = await getOpenCodeProviderStatus(v2Env, async (input, init) => {
  const route = new URL(String(input)).pathname;
  if (route === "/api/provider") return Response.json({ data: [] });
  if (route === "/api/model") {
    const catalog = await v2Fetch(input, init).then((response) => response.json());
    return Response.json({ ...catalog, data: catalog.data.filter((model: { providerID: string }) => model.providerID === "openai") });
  }
  return v2Fetch(input, init);
});
assert.equal(v2ModelOnlyStatus.configured, true, "V2 enabled model catalog remains authoritative when sidecar provider list is empty");
assert.deepEqual(v2ModelOnlyStatus.models.map((model) => model.id), ["openai/gpt-6-luna"]);
const v2UnauthenticatedStatus = await getOpenCodeProviderStatus(v2Env, async (input) => {
  const route = new URL(String(input)).pathname;
  if (route === "/api/info") return new Response("Unauthorized", { status: 401 });
  if (route === "/global/health") return new Response("<html>OpenCode Web</html>", { status: 200, headers: { "content-type": "text/html" } });
  throw new Error(`Unexpected status request: ${route}`);
});
assert.equal(v2UnauthenticatedStatus.state, "authentication-failed", "V2 API 401 wins over unauthenticated health HTML 200");
const v2Provider = new OpenCodeTextGenerationProvider("openai/gpt-6-luna", v2Env, v2Fetch, v2RestrictedServer);
const v2Draft = await generateAiResearchStoryboard(openCodeDb, "development", null, aiInput, v2Provider);
assert.equal(v2Draft.model, "openai/gpt-6-luna", "V2 generation uses exact authorized model without fallback");
assert.equal(v2Draft.researchPackage.title, aiInput.topic);
assert.deepEqual(capturedV2Session?.model, { id: "gpt-6-luna", providerID: "openai" });
assert.equal(capturedV2Session?.agent, "plan");
assert.deepEqual(capturedV2Session?.permissions, [{ action: "*", resource: "*", effect: "deny" }], "V2 session denies all tools");
assert.equal(capturedV2Generate?.prompt && String(capturedV2Generate.prompt).includes(buildDevelopmentPrompt(aiInput)), true, "V2 generate sends requested prompt text and generation instruction");
assert.equal(v2SessionDeleted, true, "V2 session is deleted after generation");
assert.equal(v2RestrictedServerClosed, true, "V2 restricted sidecar stops after generation");
assert.equal(v2Directories.length, 0, "V2 global provider/model catalog uses default location, not empty temporary location");
const noV2Models = await getOpenCodeProviderStatus(v2Env, async (input, init) => new URL(String(input)).pathname === "/api/model"
  ? Response.json({ data: [] })
  : v2Fetch(input, init));
assert.equal(noV2Models.state, "model-unavailable", "authenticated V2 server without enabled models gets distinct state");
assert.equal(noV2Models.connected, true);
const v2SessionDirectory = (capturedV2Session?.location as { directory?: string } | undefined)?.directory;
assert.ok(v2SessionDirectory && v2SessionDirectory.startsWith(os.tmpdir()));
assert.equal(existsSync(v2SessionDirectory), false, "V2 generation removes its temporary location");
let v2AbortCalled = false;
v2SessionDeleted = false;
v2RestrictedServerClosed = false;
capturedV2Session = undefined;
v2SessionDirectories.length = 0;
const v2AbortFetch: typeof fetch = async (input, init) => {
  const route = new URL(String(input)).pathname;
  if (route === "/api/session/v2-session-test/generate") return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) reject(new DOMException("Aborted", "AbortError"));
    else signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  if (route === "/api/session/v2-session-test/interrupt") v2AbortCalled = true;
  return v2Fetch(input, init);
};
const v2CancelController = new AbortController();
const v2AbortProvider = new OpenCodeTextGenerationProvider("openai/gpt-6-luna", v2Env, v2AbortFetch, v2RestrictedServer);
await assert.rejects(v2AbortProvider.generate({
  task: "research", prompt: buildDevelopmentPrompt(aiInput), outputFormat: "ai-research-storyboard-v1",
  signal: v2CancelController.signal, onPhase: () => v2CancelController.abort(),
}), (error) => error instanceof OpenCodeGenerationError && error.code === "cancelled");
assert.equal(v2AbortCalled, true, "V2 cancellation interrupts active session");
assert.equal(v2SessionDeleted, true, "V2 cancelled session is deleted");
assert.equal(v2RestrictedServerClosed, true, "V2 cancelled sidecar is stopped");
const v2CancelledDirectory = v2SessionDirectories.at(-1);
assert.ok(v2CancelledDirectory && v2CancelledDirectory.startsWith(os.tmpdir()));
assert.equal(existsSync(v2CancelledDirectory), false, "V2 cancelled temporary location is removed");
const isolatedOpenCodeEnv = restrictedOpenCodeEnvironment({ ...openCodeEnv, GEMINI_API_KEY: "app-secret-not-for-opencode" }, "temporary-sidecar-password");
assert.equal(isolatedOpenCodeEnv.OPENCODE_PURE, "true", "generation sidecar disables external OpenCode plugins");
assert.equal(isolatedOpenCodeEnv.GEMINI_API_KEY, undefined, "sidecar does not inherit AI Facts Studio credentials");
const isolatedV2Env = restrictedOpenCodeEnvironment(openCodeEnv, "temporary-sidecar-password", "v2");
assert.deepEqual(JSON.parse(isolatedV2Env.OPENCODE_CONFIG_CONTENT!), {
  share: "disabled",
  plugins: ["-*"],
  permissions: [{ action: "*", resource: "*", effect: "deny" }],
  agents: { plan: { permissions: [{ action: "*", resource: "*", effect: "deny" }] } },
  mcp: { servers: {} },
}, "V2 sidecar overlay disables plugins, sharing, and MCP and denies all permissions including Plan questions");
assert.equal(isolatedV2Env.OPENCODE_PURE, undefined, "V2 keeps built-in provider plugins available");
const isolatedV2WithPluginExclusions = restrictedOpenCodeEnvironment(openCodeEnv, "temporary-sidecar-password", "v2", ["example-plugin"]);
assert.deepEqual(JSON.parse(isolatedV2WithPluginExclusions.OPENCODE_CONFIG_CONTENT!).plugins, ["*", "-example-plugin"], "V2 enables built-in providers while excluding known user plugins");
const openCodeProvider = new OpenCodeTextGenerationProvider("openai/gpt-5-mini", openCodeEnv, mockOpenCodeFetch, fakeRestrictedServer);
const developmentPhases: string[] = [];
const openCodeDraft = await generateAiResearchStoryboard(openCodeDb, "development", null, aiInput, openCodeProvider, { onPhase: (phase) => developmentPhases.push(phase) });
assert.equal(openCodeDraft.mode, "development", "OpenCode draft stays in Development mode");
assert.deepEqual(developmentPhases, ["connecting", "generating", "validating"], "OpenCode UI progress maps to real generation pipeline phases");
assert.equal(openCodeDraft.provider, "opencode-local");
assert.equal(openCodeDraft.model, "openai/gpt-5-mini");
assert.equal(openCodeDraft.researchPackage.title, aiInput.topic);
assert.equal(openCodeSessionDeleted, true, "temporary OpenCode session is deleted after generation");
assert.equal(restrictedServerClosed, true, "restricted OpenCode sidecar is stopped after generation");
assert.ok(openCodeDirectories.length > 0 && openCodeDirectories.every((directory) => directory.startsWith(os.tmpdir()) && !directory.startsWith(process.cwd())), "OpenCode session and config use isolated temp directories");
assert.ok(openCodeDirectories.every((directory) => !existsSync(directory)), "temporary OpenCode directories are removed after use");
assert.equal(capturedOpenCodeConfig?.model, "openai/gpt-5-mini");
assert.equal(capturedOpenCodeConfig?.small_model, "openai/gpt-5-mini", "background title/summary calls cannot pick another model");
assert.equal(capturedOpenCodeConfig?.share, "disabled", "temporary generation config disables session sharing");
assert.deepEqual(capturedOpenCodeConfig?.tools, { "*": false });
assert.deepEqual(capturedOpenCodeConfig?.permission, { "*": "deny" });
assert.deepEqual(capturedOpenCodeMessage?.tools, { "*": false }, "session-level OpenCode permissions deny every tool");
assert.equal(capturedOpenCodeMessage?.agent, "plan", "OpenCode message uses known built-in agent; config PATCH cannot register dynamic agent");
assert.deepEqual(capturedOpenCodeMessage?.model, { providerID: "openai", modelID: "gpt-5-mini" });
assert.deepEqual(capturedOpenCodeMessage?.parts && (capturedOpenCodeMessage.parts as Array<{ type: string }>).map((part) => part.type), ["text"], "only user prompt text enters OpenCode session");
assert.equal(getAiGenerationSettings(openCodeDb, aiEnv, Date.now()).providers.production.requestsUsed, 0, "Development OpenCode requests do not consume Gemini quota");

let remoteAbortCalled = false;
restrictedServerClosed = false;
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
const abortableProvider = new OpenCodeTextGenerationProvider("openai/model", openCodeEnv, abortableOpenCodeFetch, fakeRestrictedServer);
await assert.rejects(abortableProvider.generate({ task: "research", prompt: "test", outputFormat: "ai-research-storyboard-v1", signal: cancelController.signal, onPhase: () => cancelController.abort() }), (error) => error instanceof OpenCodeGenerationError && error.code === "cancelled");
assert.equal(remoteAbortCalled, true, "Cancel interrupts active OpenCode session");
assert.equal(restrictedServerClosed, true, "Cancel cleans up restricted OpenCode sidecar");
const leakedApiKey = "sk-super-secret-token-value";
const providerErrorFetch: typeof fetch = async (input, init) => {
  if (new URL(String(input)).pathname === "/session/session-test/message") {
    return Response.json({ info: { error: { name: "ProviderAuthError", data: { providerID: "openai", message: `Invalid API key: ${leakedApiKey}` } } }, parts: [] });
  }
  return mockOpenCodeFetch(input, init);
};
const providerErrorProvider = new OpenCodeTextGenerationProvider("openai/gpt-5-mini", openCodeEnv, providerErrorFetch, fakeRestrictedServer);
restrictedServerClosed = false;
await assert.rejects(providerErrorProvider.generate({ task: "research", prompt: "test", outputFormat: "ai-research-storyboard-v1" }), (error) => {
  assert.ok(error instanceof OpenCodeGenerationError);
  assert.equal(error.code, "provider-error");
  assert.match(error.message, /ProviderAuthError.*openai/);
  assert.match(error.message, /\[redacted\]/);
  assert.equal(error.message.includes(leakedApiKey), false, "OpenCode provider errors cannot expose API keys");
  return true;
});
assert.equal(restrictedServerClosed, true, "provider errors still stop the OpenCode sidecar");
assert.ok(openCodeDirectories.every((directory) => !existsSync(directory)), "provider errors still remove temporary OpenCode directories");
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

const plannerDb = new DatabaseSync(":memory:");
plannerDb.exec("CREATE TABLE visual_plan_cache (cache_key TEXT PRIMARY KEY, plan_json TEXT NOT NULL, created_at TEXT NOT NULL)");
let plannerCalls = 0;
const plannerProvider: AiGenerationProvider = {
  id: "planner-test", displayName: "Planner test", model: "test-model",
  generate: async (request) => {
    plannerCalls++;
    assert.equal(request.task, "visual-director");
    assert.equal(request.outputFormat, "visual-semantic-plan-v1");
    assert.ok(request.responseSchema, "planner request carries structured JSON schema");
    return { text: JSON.stringify(semanticPlan), model: "test-model" };
  },
};
const plannerInput = { headline: "SUNGAI KE LAUT", narration: "Sungai membawa mineral menuju laut.", visualDescription: "Aliran sungai menghubungkan pegunungan dengan pesisir." };
const firstVisualPlan = await generateVisualSemanticPlan(plannerDb, "development", null, plannerProvider, plannerInput);
const cachedVisualPlan = await generateVisualSemanticPlan(plannerDb, "development", null, plannerProvider, plannerInput);
assert.equal(firstVisualPlan.cached, false);
assert.equal(cachedVisualPlan.cached, true, "identical scene/provider input reuses cached plan");
assert.equal(plannerCalls, 1, "cache prevents repeat provider request");
plannerDb.close();

console.log(`PASS: ${samples.length} packages; migration/schema/audio, renderer-aware safe area, image signature validation, semantic planner cache/schema, AI providers/quota, storyboard review gates, render determinism, Gemini TTS guard/cache, timing.`);
