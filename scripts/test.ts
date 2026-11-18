import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { captionSegmentsSchema, createCaptionSegments } from "../src/domain/captions";
import { validateAudioQuality } from "../src/domain/media-validation";
import { isAnimatedMediaFile, sceneMediaSchema } from "../src/domain/scene-media";
import { appendResearchScene, canStartNewJob, deleteResearchScene, durationInFrames, reorderResearchScene, sceneTimes, setSceneDuration, timelineDuration } from "../src/domain/timeline";
import { outroSelectionSchema } from "../src/domain/outro";
import { estimateSceneTimings, narrationScript } from "../src/domain/voice-timing";
import { parseResearchPackage, researchWarnings } from "../src/domain/research";
import { ApiError, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";
import { GeminiSpeechProvider, type GeminiSdkClient } from "../src/server/tts/gemini-provider";
import { DEFAULT_TTS_MODEL, FREE_TIER_TTS_MODELS, GEMINI_TTS_LOCALES, ttsCacheKey } from "../src/server/tts/provider";
import { carriedMotionProgress, cueProgress, layerMotion, nodeMotion, pointAlongPolyline, sceneTransitionOpacity } from "../src/video/motion";
import { registeredTemplateIds } from "../src/video/renderer-registry";
import { visualStyles } from "../src/video/style-config";
import { renderedVisualBounds, visualCompositionFrame } from "../src/domain/visual-geometry";
import { aiVectorIllustrationSchema, parseAiVectorIllustration, vectorIllustrationNodeCount } from "../src/domain/ai-vector-illustration";
import { motionCuePlanSchema, updateVisualImageNode, visualCompositionSchema, visualImageNodes } from "../src/domain/visual-composition";
import { VisualCompositionView } from "../src/video/visual-primitives";
import { buildIllustrationPrompt } from "../src/domain/illustration-prompt";
import { ANIMATION_STYLE_PRESETS, DEFAULT_ANIMATION_STYLE_ID, animationStyleIdSchema, animationStylePromptIsStale, getAnimationStylePreset } from "../src/domain/animation-styles";
import { AnimationStyleGallery } from "../src/client/AnimationStyleGallery";
import { googleFlowPromptPack, matchGoogleFlowFiles, recommendedGoogleFlowFilename, stableGoogleFlowSceneToken, validGoogleFlowAssignments } from "../src/domain/google-flow";
import { visualAssetSchema, validateRasterImage } from "../src/domain/visual-assets";
import { visualSemanticPlanSchema } from "../src/domain/visual-semantic-plan";
import { applyVisualStoryboard, buildVisualStoryboard, buildVisualWorld, compositionForVisualScene, illustrationSourceForScene, legacyMotionApprovalFingerprint, legacyVisualApprovalFingerprint, retimeVisualStoryboard, visualApprovalFingerprint, visualStoryboardQualityGate, visualStoryboardSchema, visualWorldSchema, type VisualStoryboard, type VisualStoryboardScene } from "../src/domain/visual-storyboard";
import { composeVisualScene, hasGenericIconCards, visualRelationshipIsVisible } from "../src/domain/visual-composer";
import { visualObjectIds, visualObjectLibrary } from "../src/domain/visual-objects";
import { prepareSmartVisual, type ReusableCandidate } from "../src/server/visual-orchestrator";
import { canAdvanceWorkspaceStep, normalizeWorkspaceStep, previewReviewFingerprint, reachableWorkspaceStep, workflowStatuses, workspaceSteps, type WorkflowSignals } from "../src/client/workflow";
import { appRouteHref, parseAppRoute } from "../src/client/routes";
import { aiGeneratedContentSchema, aiGenerationInputSchema, buildAiGenerationDraft, buildDevelopmentPrompt, parseManualAiResult, parseManualAiResultText, researchPackageWithConfirmedSources, restoreAiGenerationDraft, type AiGeneratedContent } from "../src/domain/ai-generation";
import { aiGenerationSchema, DEFAULT_TEXT_MODEL, FREE_TIER_TEXT_MODELS, getAiGenerationSettings, getGeminiTextQuotaMonitoring, getProductionProviderStatus, isLoopbackAddress, readAiGenerationMode, writeAiGenerationMode } from "../src/server/ai-generation/provider";
import { AiGenerationRequestError, reserveAiGenerationRequest } from "../src/server/ai-generation/quota";
import { GeminiTextGenerationError, GeminiTextGenerationProvider } from "../src/server/ai-generation/gemini-text-provider";
import { getOpenCodeProviderStatus, OpenCodeGenerationError, OpenCodeTextGenerationProvider, restrictedOpenCodeEnvironment, type RestrictedOpenCodeServerFactory } from "../src/server/ai-generation/opencode-provider";
import { generateAiResearchStoryboard } from "../src/server/ai-generation/generate";
import { generateVisualSemanticPlan, type VisualPlannerInput } from "../src/server/ai-generation/visual-planner";
import { generateAiVectorIllustration } from "../src/server/ai-generation/vector-illustrator";
import type { AiGenerationProvider } from "../src/server/ai-generation/provider";
import { DEFAULT_HF_IMAGE_MODEL, HF_IMAGE_RESOLUTIONS, HuggingFaceImageError, HuggingFaceInferenceImageProvider, discoverHuggingFaceImageModels, huggingFaceImageConfiguration, parseHuggingFaceImageModels } from "../src/server/ai-generation/huggingface-image";
import { fillEmptyGeminiTextEnvironment } from "../src/server/environment";
import { resolveTheme } from "../src/client/theme-system";
import { assetFtsExpression, indexTablerIcons, isPublicInternetAddress, openverseResultIsCached, sanitizedTablerSvg, searchTablerIcons, upsertVisualAssetCatalog } from "../src/server/asset-library";
import { openverseLicenseIds } from "../src/domain/asset-library";
import { motionActionProgress, motionActionSchema, motionPathProgress, motionTargetExists, planSceneMotion } from "../src/domain/motion-director";
import { motionBeatFromAction, updateMotionBeat } from "../src/domain/motion-beats";
import { seedVolcanoVisualSample } from "../src/domain/volcano-visual-sample";
import { buildManualResearchPackage, manualProjectInputSchema } from "../src/domain/manual-project";
import { adaptStorySeriesEpisode, storySeriesPackageSchema } from "../src/domain/story-series";

const samples = ["mountain-formation", "volcano-formation", "space-orbit", "animal-habitat", "lightning-charge", "kenapa-air-laut-asin", "bagaimana-bumi-melindungi-kita", "bagaimana-pelangi-terbentuk"];
const storySeriesFixtureResult = storySeriesPackageSchema.safeParse(JSON.parse(await readFile(new URL("../fixtures/story-series/bilik-empat-episode-01.json", import.meta.url), "utf8")));
if (!storySeriesFixtureResult.success) throw new Error(`Story Series acceptance fixture invalid: ${storySeriesFixtureResult.error.message}`);
const storySeriesFixture = storySeriesFixtureResult.data;
const adaptedStorySeries = adaptStorySeriesEpisode(storySeriesFixture);
assert.equal(adaptedStorySeries.researchPackage.category, "Fiksi");
assert.deepEqual(researchWarnings(adaptedStorySeries.researchPackage), [], "fiction does not trigger factual citation warnings");
assert.deepEqual(adaptedStorySeries.researchPackage.scenes.map((scene) => scene.onScreenText), storySeriesFixture.episode.scenes.map((scene) => scene.onScreenText), "fiction scene text is preserved, including intentionally empty text");
assert.deepEqual(adaptedStorySeries.researchPackage.scenes.map((scene) => scene.narrationText), storySeriesFixture.episode.scenes.map((scene) => scene.narration), "episode narration is preserved in scene order");
assert.equal(adaptedStorySeries.visualStoryboard.scenes.length, storySeriesFixture.episode.scenes.length, "adapter creates one editable storyboard scene per source scene");
for (const [index, source] of storySeriesFixture.episode.scenes.entries()) {
  const adapted = adaptedStorySeries.visualStoryboard.scenes[index]!;
  assert.equal(adapted.sceneId, source.sceneId);
  assert.equal(adapted.sceneNumber, source.order);
  assert.equal(adapted.durationSec, source.durationSeconds);
  assert.equal(adapted.headline, source.title);
  assert.notEqual(adapted.flowPrompt, source.googleFlow.prompt, `scene ${index + 1} applies authoritative style lock to authored prompt`);
  assert.equal(adapted.storySeries?.googleFlow.authoredPrompt, source.googleFlow.prompt, `scene ${index + 1} retains source prompt separately`);
  assert.match(adapted.flowPrompt ?? "", /Traditional flat 2D hand-painted horror animation/);
  assert.match(adapted.flowPrompt ?? "", /Absolutely no 3D rendering, CGI/);
  assert.doesNotMatch(adapted.flowPrompt ?? "", /Cinematic 2D Motion Comic|semi-realistic/i, `scene ${index + 1} excludes obsolete source style heading`);
  assert.equal(adapted.flowPromptAnimationStyleId, storySeriesFixture.series.visualStyle.presetId);
  assert.equal(animationStylePromptIsStale(source.googleFlow.prompt, storySeriesFixture.series.visualStyle.presetId, storySeriesFixture.series.visualStyle.presetId), true, `scene ${index + 1} detects obsolete prompt despite stable preset ID`);
  assert.equal(adapted.flowNegativePrompt, source.googleFlow.negativePrompt);
  assert.equal(adapted.flowReferenceInstructions, source.googleFlow.referenceInstructions);
  assert.deepEqual(adapted.storySeries?.audio, source.audio, `scene ${index + 1} preserves ambience, SFX, and music notes`);
  assert.equal(adapted.storySeries?.visualDescription, source.visual.description, `scene ${index + 1} preserves full visual direction`);
  assert.equal(adapted.storySeries?.primaryAction, source.visual.primaryAction);
  assert.deepEqual(adapted.storySeries?.continuityNotes, source.continuityNotes, `scene ${index + 1} preserves continuity notes`);
  assert.deepEqual(adapted.storySeries?.references.characters.map((item) => item.id), source.references.characterIds);
  assert.deepEqual(adapted.storySeries?.references.locations.map((item) => item.id), source.references.locationIds);
  assert.deepEqual(adapted.storySeries?.references.props.map((item) => item.id), source.references.propIds);
}
const regeneratedStoryPrompt = buildIllustrationPrompt({ research: adaptedStorySeries.researchPackage, storyboard: adaptedStorySeries.visualStoryboard, scene: adaptedStorySeries.visualStoryboard.scenes[0]!, mode: "animated-video", animationStyleId: storySeriesFixture.series.visualStyle.presetId });
assert.match(regeneratedStoryPrompt, /fictional narrative scene/);
assert.match(regeneratedStoryPrompt, /bilik empat|Wartel Sari Rejeki/i);
assert.match(regeneratedStoryPrompt, /Audio cues are post-production guidance only/);
assert.doesNotMatch(regeneratedStoryPrompt, /educational short-video|scientific context/);
assert.equal(adaptedStorySeries.visualStoryboard.scenes.length, 8, "all eight Bilik Empat scenes get generated prompts");
assert.ok(adaptedStorySeries.visualStoryboard.scenes.every((scene) => scene.flowPrompt?.includes(getAnimationStylePreset(storySeriesFixture.series.visualStyle.presetId).prompt.style)), "same hand-painted style instructions appear in every scene prompt");
assert.equal(animationStylePromptIsStale(adaptedStorySeries.visualStoryboard.scenes[0]!.flowPrompt, storySeriesFixture.series.visualStyle.presetId, storySeriesFixture.series.visualStyle.presetId), false, "current prompt instructions are not stale");
assert.equal(animationStylePromptIsStale("legacy motion comic prompt", storySeriesFixture.series.visualStyle.presetId, storySeriesFixture.series.visualStyle.presetId), true, "same-ID prompts with obsolete instructions are stale");
assert.equal(animationStylePromptIsStale(`${getAnimationStylePreset(storySeriesFixture.series.visualStyle.presetId).prompt.style} ${getAnimationStylePreset(storySeriesFixture.series.visualStyle.presetId).prompt.motion}`, storySeriesFixture.series.visualStyle.presetId, storySeriesFixture.series.visualStyle.presetId), true, "same-ID prompts with outdated motion or negative instructions are stale");
assert.deepEqual(parseAppRoute("http://localhost/"), { view: "dashboard" }, "dashboard route survives direct navigation");
assert.deepEqual(parseAppRoute("http://localhost/settings"), { view: "settings", section: "general" }, "settings route defaults to General on refresh");
assert.deepEqual(parseAppRoute("http://localhost/settings?section=appearance"), { view: "settings", section: "appearance" }, "settings section survives direct navigation");
assert.deepEqual(parseAppRoute("http://localhost/settings?section=outro-library"), { view: "settings", section: "outro-library" }, "Outro Library section survives refresh");
assert.deepEqual(parseAppRoute("http://localhost/settings?section=unknown"), { view: "settings", section: "general" }, "invalid settings section falls back to General");
assert.deepEqual(parseAppRoute("http://localhost/series"), { view: "series-library", slug: null }, "Story Series Library survives direct navigation");
assert.deepEqual(parseAppRoute("http://localhost/series?slug=bilik-empat"), { view: "series-library", slug: "bilik-empat" }, "series continuation slug survives refresh");
assert.deepEqual(parseAppRoute("http://localhost/series/series-123"), { view: "series-detail", seriesId: "series-123" }, "Story Bible detail has deep link");
assert.deepEqual(parseAppRoute("http://localhost/projects/demo"), { view: "workspace", projectId: "demo", step: "materials", sceneId: null }, "project URL opens materials by default");
assert.deepEqual(parseAppRoute("http://localhost/projects/demo/editor?scene=scene-3"), { view: "workspace", projectId: "demo", step: "video-editor", sceneId: "scene-3" }, "legacy editor URL restores selected scene in Video Editor");
assert.deepEqual(parseAppRoute("http://localhost/projects/demo?step=visual&scene=scene-3"), { view: "workspace", projectId: "demo", step: "video-editor", sceneId: "scene-3" }, "legacy visual step resolves to Video Editor");
assert.deepEqual(parseAppRoute("http://localhost/projects/demo?step=editor&scene=scene-3"), { view: "workspace", projectId: "demo", step: "video-editor", sceneId: "scene-3" }, "legacy editor step resolves to Video Editor");
assert.deepEqual(parseAppRoute("http://localhost/projects/demo?step=render&scene=scene-3"), { view: "workspace", projectId: "demo", step: "render", sceneId: "scene-3" }, "workspace URL restores step and scene");
const invalidStepRoute = parseAppRoute("http://localhost/projects/demo?step=invalid");
assert.equal(invalidStepRoute.view === "workspace" ? invalidStepRoute.step : "", "materials", "invalid workspace step falls back safely");
assert.equal(appRouteHref({ view: "workspace", projectId: "demo", step: "video-editor", sceneId: "scene-3" }), "/projects/demo/editor?scene=scene-3", "Video Editor route serializes selected scene");
assert.equal(appRouteHref({ view: "settings", section: "general" }), "/settings", "General settings route uses canonical URL");
assert.equal(appRouteHref({ view: "settings", section: "ai-generation" }), "/settings?section=ai-generation", "AI Generation settings section serializes in URL");
assert.equal(appRouteHref({ view: "series-library", slug: "bilik-empat" }), "/series?slug=bilik-empat", "series continuation route serializes in URL");
assert.equal(appRouteHref({ view: "series-detail", seriesId: "series-123" }), "/series/series-123", "Story Bible detail serializes in URL");
assert.equal(normalizeWorkspaceStep("visual"), "video-editor", "legacy stored visual step migrates without project rewrite");
assert.equal(normalizeWorkspaceStep("editor"), "video-editor", "legacy stored editor step migrates without project rewrite");
assert.equal(workspaceSteps.length, 6, "workflow has six steps");
assert.equal(resolveTheme("system", true), "dark", "System theme follows dark OS preference");
assert.equal(resolveTheme("system", false), "light", "System theme follows light OS preference");
assert.equal(resolveTheme("dark", false), "dark", "Explicit theme ignores OS preference");
assert.equal(huggingFaceImageConfiguration({} as NodeJS.ProcessEnv).configured, false, "Hugging Face image provider is disabled unless token and both operator opt-ins exist");
assert.deepEqual(HF_IMAGE_RESOLUTIONS.map((size) => size.split("x").map(Number)[0]! / size.split("x").map(Number)[1]!), [9 / 16, 9 / 16], "supported raster dimensions preserve exact 9:16 framing");
const hfModelFixture = [
  { id: "example/live-image", tags: ["license:apache-2.0"], inferenceProviderMapping: [{ provider: "hf-inference", status: "live", task: "text-to-image" }] },
  { id: "example/error-image", tags: [], inferenceProviderMapping: [{ provider: "hf-inference", status: "error", task: "text-to-image" }] },
  { id: "example/other-provider", tags: [], inferenceProviderMapping: [{ provider: "fal-ai", status: "live", task: "text-to-image" }] },
];
assert.deepEqual(parseHuggingFaceImageModels(hfModelFixture), [{ id: "example/live-image", license: "apache-2.0" }], "catalog only allows live hf-inference text-to-image models");
assert.deepEqual(parseHuggingFaceImageModels([{ id: "example/live-object", tags: [], inferenceProviderMapping: { "hf-inference": { status: "live", task: "text-to-image" } } }]).map((model) => model.id), ["example/live-object"], "catalog supports Hub mapping object response shape");
let discoveryRequested = "";
const mockedModels = await discoverHuggingFaceImageModels((async (input) => {
  discoveryRequested = String(input);
  return new Response(JSON.stringify(hfModelFixture), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch);
assert.match(discoveryRequested, /inference_provider=hf-inference.*pipeline_tag=text-to-image/);
assert.deepEqual(mockedModels.map((model) => model.id), ["example/live-image"], "model availability uses mocked official Hub response");
const mockedImageCalls: Array<{ url: string; init: RequestInit }> = [];
const mockedImageProvider = new HuggingFaceInferenceImageProvider("test-token-never-real", (async (input, init) => {
  mockedImageCalls.push({ url: String(input), init: init ?? {} });
  return new Response(Uint8Array.from([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/png" } });
}) as typeof fetch);
const mockedImage = await mockedImageProvider.generate({ model: DEFAULT_HF_IMAGE_MODEL, prompt: "one cohesive 2D river illustration", resolution: "576x1024", userConfirmed: true, costAcknowledged: true });
assert.deepEqual([...mockedImage.bytes], [137, 80, 78, 71]);
assert.equal(mockedImage.mimeType, "image/png");
assert.match(mockedImageCalls[0]!.url, /router\.huggingface\.co\/hf-inference\/models\/stabilityai\/stable-diffusion-3-medium-diffusers/);
assert.equal((mockedImageCalls[0]!.init.headers as Record<string, string>).Authorization, "Bearer test-token-never-real", "HF token stays in server Authorization header");
assert.deepEqual(JSON.parse(String(mockedImageCalls[0]!.init.body)), { inputs: "one cohesive 2D river illustration", parameters: { width: 576, height: 1024 } });
await assert.rejects(() => mockedImageProvider.generate({ model: DEFAULT_HF_IMAGE_MODEL, prompt: "one cohesive 2D river illustration", resolution: "576x1024", userConfirmed: false, costAcknowledged: false } as unknown as Parameters<typeof mockedImageProvider.generate>[0]), /konfirmasi biaya/);
assert.equal(mockedImageCalls.length, 1, "missing per-image confirmation prevents provider request");
const rateLimitedProvider = new HuggingFaceInferenceImageProvider("mock-token", (async () => new Response(JSON.stringify({ error: "rate limit" }), { status: 429, headers: { "content-type": "application/json", "retry-after": "4" } })) as typeof fetch);
await assert.rejects(() => rateLimitedProvider.generate({ model: DEFAULT_HF_IMAGE_MODEL, prompt: "one cohesive 2D river illustration", resolution: "576x1024", userConfirmed: true, costAcknowledged: true }), (error: unknown) => error instanceof HuggingFaceImageError && error.code === "ai-image-rate-limited" && error.retryAfterMs === 4000);
const quotaProvider = new HuggingFaceInferenceImageProvider("mock-token", (async () => new Response(JSON.stringify({ error: "insufficient credits" }), { status: 402, headers: { "content-type": "application/json" } })) as typeof fetch);
await assert.rejects(() => quotaProvider.generate({ model: DEFAULT_HF_IMAGE_MODEL, prompt: "one cohesive 2D river illustration", resolution: "576x1024", userConfirmed: true, costAcknowledged: true }), (error: unknown) => error instanceof HuggingFaceImageError && error.code === "ai-image-quota-exhausted");
const redesignCss = await readFile(new URL("../src/client/redesign.css", import.meta.url), "utf8");
const lightTokens = redesignCss.match(/^:root \{([^}]+)\}/m)?.[1] ?? "";
const darkTokens = redesignCss.match(/^:root\[data-theme="dark"\] \{([^}]+)\}/m)?.[1] ?? "";
const tokenColor = (block: string, name: string) => {
  const value = block.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1];
  assert.ok(value, `Missing color token --${name}`);
  return value!;
};
const contrastRatio = (foreground: string, background: string) => {
  const luminance = (hex: string) => {
    const [r, g, b] = hex.slice(1).match(/.{2}/g)!.map((value) => parseInt(value, 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
};
for (const [tokens, foreground, background] of [
  [lightTokens, "text-primary", "background"], [lightTokens, "text-secondary", "surface"], [lightTokens, "primary-text", "primary-soft"], [lightTokens, "text-on-primary", "primary-action"],
  [darkTokens, "text-primary", "background"], [darkTokens, "text-secondary", "surface"], [darkTokens, "primary-text", "primary-soft"], [darkTokens, "text-on-primary", "primary-action"],
] as const) assert.ok(contrastRatio(tokenColor(tokens, foreground), tokenColor(tokens, background)) >= 4.5, `${foreground} on ${background} must meet WCAG AA`);
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
assert.equal(mountain.videoOverlaySettings.showTitle, true, "legacy packages receive default title overlay settings");
assert.equal(mountain.videoOverlaySettings.showSubtitles, true, "new packages show subtitles by default");
assert.equal(mountain.videoOverlaySettings.showBranding, false, "new packages hide branding by default");
assert.equal(mountain.videoOverlaySettings.brandName, "AI FACTS STUDIO", "default brand name remains available when branding is enabled");
const savedOverlayPreferences = parseResearchPackage({ ...mountain, videoOverlaySettings: { ...mountain.videoOverlaySettings, showTitle: false, showBranding: true } });
assert.equal(savedOverlayPreferences.success && savedOverlayPreferences.data.videoOverlaySettings.showTitle, false, "saved title preference survives schema parsing");
assert.equal(savedOverlayPreferences.success && savedOverlayPreferences.data.videoOverlaySettings.showBranding, true, "saved branding preference survives schema parsing");
const seaSalt = parsedSamples.find((sample) => sample.id === "why-seawater-is-salty-id")!;
const solarProtection = parsedSamples.find((sample) => sample.id === "earth-solar-protection-id")!;
const rainbow = parsedSamples.find((sample) => sample.id === "how-rainbows-form-id")!;
const volcano = parsedSamples.find((sample) => sample.id === "volcano-formation-id")!;
assert.equal(volcano.scenes.length, 6, "volcano sample covers six requested beats");
assert.equal(volcano.targetDurationSec, 30, "volcano sample targets a 30-second edit");
assert.ok(volcano.narration.trim().split(/\s+/).length <= 80, "volcano narration stays concise for a 30-second voice track");
assert.ok(volcano.scenes[0]!.narrationText.includes("berbeda dari pegunungan lipatan"), "volcano sample distinguishes volcanic growth from folded mountain formation");
assert.ok(volcano.scenes[1]!.narrationText.includes("satu atau beberapa zona penyimpanan"), "sample avoids implying one universal fixed magma chamber");
assert.ok(volcano.scenes[3]!.narrationText.includes("lava atau meletus eksplosif"), "sample explains effusive and explosive eruption outcomes");
assert.ok(volcano.scenes[5]!.narrationText.includes("beragam"), "sample states real volcanic systems and forms vary");
const volcanoVisualSample = seedVolcanoVisualSample(buildVisualStoryboard(volcano));
assert.equal(volcanoVisualSample.visualWorld?.elements.length, volcanoVisualSample.visualWorld?.composition.layers.length, "volcano sample declares every stable shared-world layer");
assert.equal(volcanoVisualSample.scenes.reduce((count, scene) => count + scene.motionActions.length, 0), 6, "volcano sample seeds six persisted Motion Beats");
assert.ok(volcanoVisualSample.scenes.every((scene) => !scene.approved && scene.compositionSource === "procedural" && scene.flowStatus === "awaiting-illustration"), "sample Visual World remains an unapproved procedural draft until final artwork is imported");
assert.ok(volcanoVisualSample.scenes.every((scene) => JSON.stringify(scene.composition) === JSON.stringify(volcanoVisualSample.visualWorld!.composition)), "all six sample scenes share same Visual World composition");
assert.ok(volcanoVisualSample.scenes.every((scene) => scene.motionActions.every((action) => motionTargetExists(scene.composition, action.targetNode) && (action.kind !== "particle-flow" || (action.path?.length ?? 0) >= 2))), "sample Motion Beats target real nodes and expose editable paths where applicable");
const reservoirBeat = volcanoVisualSample.scenes[1]!.motionActions[0]!;
assert.equal(carriedMotionProgress(1, 2, reservoirBeat, reservoirBeat.startFrame + 20), 0, "magma reservoir stays hidden before storage beat");
assert.equal(carriedMotionProgress(2, 2, reservoirBeat, reservoirBeat.startFrame + reservoirBeat.durationFrames / 2), 0.5, "reservoir fill follows deterministic beat progress");
assert.equal(carriedMotionProgress(3, 2, undefined, 0), 1, "completed reservoir state carries into later scene");
const mountainStoryboard = buildVisualStoryboard(mountain);
const handAuthoredMotionPlan = [
  { cue: "slide", targetLayer: "all", delayFrames: 12, durationFrames: 45, easing: "easeOut", direction: "left", intensity: 1.5 },
  { cue: "dissolve", targetLayer: "scene", delayFrames: 3, durationFrames: 36, easing: "easeInOut" },
];
const manualMotionPackage = parseResearchPackage({ ...mountain, scenes: mountain.scenes.map((scene, index) => index === 0 ? { ...scene, motionCues: handAuthoredMotionPlan.map((plan) => plan.cue), motionPlan: handAuthoredMotionPlan } : scene) });
assert.equal(manualMotionPackage.success, true, "manual Motion Direction supports per-cue direction, intensity, and dissolve parameters");
if (manualMotionPackage.success) {
  const manualMotionBoard = buildVisualStoryboard(manualMotionPackage.data);
  const changedIntentBoard = { ...manualMotionBoard, scenes: manualMotionBoard.scenes.map((scene, index) => index === 0 ? { ...scene, motionIntent: "focus-shift" as const } : scene) };
  const appliedMotion = applyVisualStoryboard(manualMotionPackage.data, changedIntentBoard);
  assert.deepEqual(appliedMotion.scenes[0]!.motionPlan, handAuthoredMotionPlan, "applyVisualStoryboard does not overwrite authored Motion Direction when visual intent changes");
  assert.deepEqual(appliedMotion.scenes[0]!.motionCues, handAuthoredMotionPlan.map((plan) => plan.cue), "legacy motionCues stay synchronized with canonical motionPlan");
  assert.deepEqual(appliedMotion.scenes[1]!.motionPlan, manualMotionPackage.data.scenes[1]!.motionPlan, "editing one scene leaves other scene Motion Direction untouched");
  assert.equal(parseResearchPackage(appliedMotion).success, true, "authored Motion Direction survives package save/reload validation");
}
assert.equal(motionCuePlanSchema.safeParse({ cue: "fadeIn", targetLayer: "all", delayFrames: 0, durationFrames: 24, easing: "linear", intensity: 1 }).success, false, "unsupported intensity controls are rejected");
for (const cue of ["cut", "dissolve", "slide-transition", "wipe"] as const) {
  const plan = { cue, targetLayer: "scene", delayFrames: 0, durationFrames: cue === "cut" ? 1 : 24, easing: cue === "cut" ? "linear" : "easeInOut", ...(cue === "slide-transition" ? { direction: "right" } : {}) };
  const parsedTransition = parseResearchPackage({ ...mountain, scenes: mountain.scenes.map((scene, index) => index ? scene : { ...scene, motionCues: [cue], motionPlan: [plan] }) });
  assert.equal(parsedTransition.success, true, `${cue} is valid persisted scene transition`);
}
const multipleTransitions = parseResearchPackage({ ...mountain, scenes: mountain.scenes.map((scene, index) => index ? scene : { ...scene,
  motionCues: ["slide-transition", "wipe"], motionPlan: [
    { cue: "slide-transition", targetLayer: "scene", delayFrames: 0, durationFrames: 24, easing: "easeInOut" },
    { cue: "wipe", targetLayer: "scene", delayFrames: 0, durationFrames: 24, easing: "easeInOut" },
  ],
}) });
assert.equal(multipleTransitions.success, false, "scene cannot combine two transition types");
const conflictingTransitions = parseResearchPackage({ ...mountain, scenes: mountain.scenes.map((scene, index) => index === 0 ? { ...scene, motionCues: ["cut", "dissolve"], motionPlan: [{ cue: "cut", targetLayer: "scene", delayFrames: 0, durationFrames: 1, easing: "linear" }, { cue: "dissolve", targetLayer: "scene", delayFrames: 0, durationFrames: 18, easing: "easeInOut" }] } : scene) });
assert.equal(conflictingTransitions.success, true, "legacy Cut and Dissolve conflicts are normalized instead of blocking project load");
if (conflictingTransitions.success) {
  assert.deepEqual(conflictingTransitions.data.scenes[0]!.motionCues, ["cut"], "legacy transition normalization preserves old Cut precedence");
  assert.deepEqual(conflictingTransitions.data.scenes[0]!.motionPlan.map((plan) => plan.cue), ["cut"], "legacy motionPlan remains synchronized after transition normalization");
}
assert.ok(mountainStoryboard.styleLock.illustrationStyle.includes("Modern 2D Cartoon"));
assert.ok(mountainStoryboard.scenes.every((scene) => scene.illustrationWorkflow === "google-flow"), "new and legacy scenes default to persisted Google Flow workflow");
assert.ok(mountainStoryboard.scenes.every((scene) => scene.flowVisualMode === "animated-video"), "new scenes default to Google Flow animation mode");
const legacyFlowModes = visualStoryboardSchema.parse({ ...mountainStoryboard, scenes: mountainStoryboard.scenes.map(({ flowVisualMode: _mode, flowPromptMode: _promptMode, ...scene }) => scene) });
assert.ok(legacyFlowModes.scenes.every((scene) => scene.flowVisualMode === "still-image" && scene.flowPromptMode === "still-image"), "legacy storyboard defaults to still-image prompts without breaking schema compatibility");
const animationStyleTaggedBoard = visualStoryboardSchema.parse({ ...mountainStoryboard, scenes: mountainStoryboard.scenes.map((scene, index) => ({ ...scene, flowPrompt: `Flow prompt ${index}`, flowVisualMode: "animated-video", flowPromptMode: "animated-video", flowPromptAnimationStyleId: ANIMATION_STYLE_PRESETS[index % ANIMATION_STYLE_PRESETS.length]!.id })) });
assert.ok(animationStyleTaggedBoard.scenes.every((scene, index) => scene.flowPromptAnimationStyleId === ANIMATION_STYLE_PRESETS[index % ANIMATION_STYLE_PRESETS.length]!.id), "stable animation-style metadata validates per scene");
const legacyPromptMetadata = visualStoryboardSchema.parse({ ...mountainStoryboard, scenes: mountainStoryboard.scenes.map((scene) => ({ ...scene, flowPrompt: "Legacy animation prompt", flowVisualMode: "animated-video", flowPromptMode: "animated-video" })) });
assert.ok(legacyPromptMetadata.scenes.every((scene) => scene.flowPromptAnimationStyleId === undefined), "legacy prompts load without implicit style rewrite");
assert.equal(buildVisualStoryboard(mountain, animationStyleTaggedBoard).scenes[0]!.flowPromptAnimationStyleId, animationStyleTaggedBoard.scenes[0]!.flowPromptAnimationStyleId, "prompt style metadata survives storyboard save/reload merge");
const testMediaHash = (character: string) => character.repeat(64);
const testSceneMedia = sceneMediaSchema.parse({
  type: "video", name: "flow-clip.gif", file: `${testMediaHash("b")}.mp4`, sha256: testMediaHash("b"), bytes: 4096,
  posterFile: `${testMediaHash("c")}.jpg`, posterSha256: testMediaHash("c"), posterBytes: 1024,
  sourceFormat: "gif", sourceMimeType: "image/gif", sourceSha256: testMediaHash("a"), sourceBytes: 2048,
  sourceVideoCodec: "gif", sourceAudioCodec: null, sourceWidth: 320, sourceHeight: 480, sourceFrameRate: 12, sourceDurationSec: 1.2,
  videoCodec: "h264", audioCodec: null, width: 320, height: 480, frameRate: 30, durationSec: 1.2,
  trimInSec: 0, trimOutSec: 1.2, fit: "cover", position: "center", shortClip: "loop", audioEnabled: false,
});
assert.throws(() => sceneMediaSchema.parse({ ...testSceneMedia, trimInSec: 0.8, trimOutSec: 0.7 }), /trim/i, "media trim bounds reject inverted ranges");
assert.equal(isAnimatedMediaFile({ type: "image/gif", name: "Flow.GIF" } as File), true, "GIF batch files use case-insensitive extension matching");
const mediaStoryboard = { ...mountainStoryboard, scenes: mountainStoryboard.scenes.map((scene, index) => index === 0 ? { ...scene, sceneMedia: testSceneMedia, authoringConfirmed: true } : scene) };
const mediaResearch = applyVisualStoryboard(mountain, mediaStoryboard);
assert.equal(mediaResearch.scenes[0]!.sceneMedia?.sha256, testSceneMedia.sha256, "animated media projects from Visual Storyboard into Research Package");
assert.equal(buildVisualStoryboard(mediaResearch, mediaStoryboard).scenes[0]!.sceneMedia?.file, testSceneMedia.file, "animated media survives storyboard rebuild/reload path");
const mediaWithAnimationStyle = { ...mediaStoryboard, scenes: mediaStoryboard.scenes.map((scene, index) => index === 0 ? { ...scene, flowPrompt: "Saved Flow animation prompt", flowVisualMode: "animated-video" as const, flowPromptMode: "animated-video" as const, flowPromptAnimationStyleId: DEFAULT_ANIMATION_STYLE_ID } : scene) };
const mediaStyleRebuild = buildVisualStoryboard(mediaResearch, mediaWithAnimationStyle);
assert.equal(mediaStyleRebuild.scenes[0]!.sceneMedia?.file, testSceneMedia.file, "style metadata merge leaves imported animated media untouched");
assert.equal(mediaStyleRebuild.scenes[0]!.flowPromptAnimationStyleId, DEFAULT_ANIMATION_STYLE_ID, "style metadata and media both survive storyboard rebuild");
const oldWorkflowBoard = visualStoryboardSchema.parse({ ...mountainStoryboard, scenes: mountainStoryboard.scenes.map(({ illustrationWorkflow: _workflow, ...scene }) => scene) });
assert.ok(oldWorkflowBoard.scenes.every((scene) => scene.illustrationWorkflow === "google-flow"), "legacy persisted storyboard fills Google Flow source preference without migration loss");
assert.ok(mountainStoryboard.scenes.every((scene) => /^flow-[a-f0-9]{16}$/.test(scene.sceneToken) && scene.recommendedFilename.includes(scene.sceneToken)), "all scenes persist stable token and tokenized recommended filename");
const savedFlowPrompt = "Manual prompt that must survive storyboard regeneration.";
const seededFlowBoard: VisualStoryboard = { ...mountainStoryboard, styleLock: { ...mountainStoryboard.styleLock, lighting: "Warm sunrise, soft shadow" }, scenes: mountainStoryboard.scenes.map((scene, index) => index ? scene : { ...scene, flowPrompt: savedFlowPrompt, flowStatus: "prompt-ready" }) };
const renamedMountain = { ...mountain, scenes: mountain.scenes.map((scene, index) => index ? scene : { ...scene, onScreenText: "Gunung terbentuk perlahan" }) };
const rebuiltFlowBoard = buildVisualStoryboard(renamedMountain, seededFlowBoard);
assert.equal(rebuiltFlowBoard.scenes[0]!.sceneToken, seededFlowBoard.scenes[0]!.sceneToken, "stable token survives headline edits and board regeneration");
assert.equal(rebuiltFlowBoard.scenes[0]!.flowPrompt, savedFlowPrompt, "stored per-scene Flow prompt survives regeneration without touching raster art");
assert.equal(rebuiltFlowBoard.scenes[0]!.recommendedFilename.includes("gunung-terbentuk-perlahan"), true, "recommended filename tracks current headline and scene number");
assert.equal(rebuiltFlowBoard.styleLock.lighting, "Warm sunrise, soft shadow", "project Style Lock survives storyboard rebuild");
const sourceChoiceBoard = buildVisualStoryboard(mountain, { ...mountainStoryboard, scenes: mountainStoryboard.scenes.map((scene, index) => index ? scene : { ...scene, illustrationWorkflow: "asset-library" }) });
assert.equal(sourceChoiceBoard.scenes[0]!.illustrationWorkflow, "asset-library", "scene source choice survives storyboard rebuild");
assert.equal(seaSalt.title, "Kenapa Air Laut Asin?");
assert.equal(seaSalt.scenes.length, 5);
assert.equal(solarProtection.scenes.length, 5, "Earth protection POC contains all five requested beats");
assert.equal(rainbow.scenes.length, 5, "rainbow sample covers five explanatory beats");
assert.equal(visualStoryboardQualityGate(mountain, mountainStoryboard).ready, true, "mountain storyboard has visual evidence for each planned concept");
assert.deepEqual(mountainStoryboard.scenes[0]!.composition.layers.map((layer) => layer.id), ["sunlight", "cloud", "mountain", "rock"], "mountain hook depicts sun, cloud, peak, and rock instead of claiming missing evidence");
assert.ok(mountainStoryboard.scenes[3]!.composition.layers.some((layer) => layer.id === "rock" && layer.nodes.some((node) => node.type === "path")), "folding scene draws layered rock paths");
assert.ok(mountainStoryboard.scenes[4]!.composition.layers.some((layer) => layer.id === "mountain") && mountainStoryboard.scenes[4]!.composition.layers.some((layer) => layer.id === "tectonic-plates"), "Himalaya scene connects uplifted peaks to colliding plates");
assert.ok(mountainStoryboard.scenes[4]!.composition.layers.flatMap((layer) => layer.nodes).some((node) => node.type === "text" && node.text === "INDIA → EURASIA"), "Himalaya diagram identifies both colliding continents");
const seaSaltNodes = seaSalt.scenes.flatMap((scene) => scene.visualComposition.layers.flatMap((layer) => layer.nodes));
assert.ok(seaSaltNodes.some((node) => node.type === "path"), "salt sample uses continuous landscape and water paths");
const saltStoryboard = buildVisualStoryboard(seaSalt);
const solarStoryboard = buildVisualStoryboard(solarProtection);
const rainbowStoryboard = buildVisualStoryboard(rainbow);
assert.equal(visualStoryboardQualityGate(seaSalt, saltStoryboard).ready, true, "salt storyboard passes relevance, density, and text-layout gate");
assert.equal(visualStoryboardQualityGate(solarProtection, solarStoryboard).ready, true, `Earth protection storyboard passes visual quality gate: ${JSON.stringify(visualStoryboardQualityGate(solarProtection, solarStoryboard).issues)}`);
assert.equal(visualStoryboardQualityGate(rainbow, rainbowStoryboard).ready, true, `water-droplet rainbow storyboard passes visual structure gate: ${JSON.stringify(visualStoryboardQualityGate(rainbow, rainbowStoryboard).issues)}`);
assert.ok(rainbowStoryboard.scenes.every((scene) => scene.composition.layers.some((layer) => layer.id === "rain") && scene.composition.layers.some((layer) => layer.id === "sunlight")), "rainbow scenes depict raindrops and sunlight, not a standalone prism/icon");
assert.ok(rainbowStoryboard.scenes[2]!.composition.layers.some((layer) => layer.id === "internal-reflection" && layer.nodes.some((node) => node.type === "path")), "rainbow droplet diagram depicts internal light path");
assert.ok(rainbow.scenes[4]!.narrationText.includes("42 derajat") && rainbow.references[0]!.publisher.includes("National Weather Service"), "sun-angle and viewing-condition claims link to NWS source");
assert.ok(rainbowStoryboard.scenes.every((scene) => !scene.approved), "new rainbow scenes require explicit per-scene visual approval");
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
const approvedPromptOnlyEdit = structuredClone(approvedSalt);
approvedPromptOnlyEdit.scenes[0]!.flowPrompt = "Updated external prompt; rendered illustration remains unchanged.";
assert.equal(visualApprovalFingerprint(approvedPromptOnlyEdit.scenes[0]!), approvedSalt.scenes[0]!.approvedFingerprint, "editing external Flow prompt does not change rendered-scene approval fingerprint");
assert.equal(visualApprovalFingerprint({ ...approvedSalt.scenes[0]!, illustrationWorkflow: "ai-image-api" }), approvedSalt.scenes[0]!.approvedFingerprint, "changing source preference alone does not invalidate artwork approval");
assert.equal(visualStoryboardSchema.safeParse(approvedPromptOnlyEdit).success, true, "external prompt edit preserves approval for unchanged rendered scene");
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
const staleMotionApproval = structuredClone(approvedSalt);
staleMotionApproval.scenes[2]!.approved = true;
staleMotionApproval.scenes[2]!.approvedFingerprint = visualApprovalFingerprint(staleMotionApproval.scenes[2]!);
Object.assign(staleMotionApproval.scenes[2]!, planSceneMotion(staleMotionApproval.scenes[2]!));
assert.equal(visualStoryboardSchema.safeParse(staleMotionApproval).success, false, "changing Motion Plan invalidates existing approval fingerprint");
const preMotionApproved = JSON.parse(JSON.stringify(saltStoryboard)) as { scenes: Array<Record<string, any>> };
preMotionApproved.scenes[0]!.approved = true;
preMotionApproved.scenes[0]!.approvedFingerprint = legacyMotionApprovalFingerprint(preMotionApproved.scenes[0] as unknown as VisualStoryboardScene);
assert.notEqual(visualStoryboardQualityGate(seaSalt, preMotionApproved as unknown as VisualStoryboard).scenes[preMotionApproved.scenes[0]!.sceneId]?.some((issue) => issue.includes("Approval visual stale")), true, "pre-Motion approval remains valid through quality gate migration");
const preparedOldApproval = structuredClone(saltStoryboard);
preparedOldApproval.scenes[0]!.approved = true;
preparedOldApproval.scenes[0]!.approvedFingerprint = legacyMotionApprovalFingerprint(preparedOldApproval.scenes[0]!);
Object.assign(preparedOldApproval.scenes[0]!, planSceneMotion(preparedOldApproval.scenes[0]!));
assert.equal(visualStoryboardSchema.safeParse(preparedOldApproval).success, false, "adding a Motion Plan to a pre-Motion approval invalidates that old approval");
for (const field of ["motionIntensity", "motionTiming", "motionStatus", "motionActions"]) delete preMotionApproved.scenes[0]![field];
assert.equal(visualStoryboardSchema.safeParse(preMotionApproved).success, true, "pre-Motion Director approvals migrate without becoming stale");
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
const relationScene = (board: VisualStoryboard, relation: string) => board.scenes.find((scene) => scene.relationships.some((item) => item.relation === relation));
const rainMotion = planSceneMotion(relationScene(saltStoryboard, "falls-on")!);
const riverMotion = planSceneMotion(relationScene(saltStoryboard, "carries")!);
const evaporationMotion = planSceneMotion(relationScene(saltStoryboard, "evaporates-from")!);
const ozoneMotion = planSceneMotion(relationScene(solarStoryboard, "filters")!);
const magnetosphereMotion = planSceneMotion(relationScene(solarStoryboard, "deflects")!);
const directedSaltStoryboard = { ...saltStoryboard, scenes: saltStoryboard.scenes.map((scene) => ({ ...scene, ...planSceneMotion(scene, "balanced") })) };
const directedEarthStoryboard = { ...solarStoryboard, scenes: solarStoryboard.scenes.map((scene) => ({ ...scene, ...planSceneMotion(scene, "balanced") })) };
assert.equal(visualStoryboardSchema.safeParse(directedSaltStoryboard).success, true, "all generated sea-salt actions pass storyboard safety schema");
assert.equal(visualStoryboardSchema.safeParse(directedEarthStoryboard).success, true, "all generated Earth actions pass storyboard safety schema");
assert.ok(rainMotion.motionActions.some((action) => action.id === "rain-fall" && action.kind === "particle-flow"), "rain motion follows an actual rain-to-land composition route");
assert.ok(riverMotion.motionActions.some((action) => action.id === "river-mineral-flow" && action.kind === "particle-flow"), "mineral flow follows actual river path nodes");
assert.ok(evaporationMotion.motionActions.some((action) => action.id === "water-vapor-rise" && action.kind === "particle-flow"), "evaporation moves water upward without animating salt");
assert.ok(ozoneMotion.motionActions.some((action) => action.id === "uv-approach-ozone") && ozoneMotion.motionActions.some((action) => action.id === "partial-uv-transmission"), "ozone motion shows UV approaching filter and partial transmission");
const transmittedPath = ozoneMotion.motionActions.find((action) => action.id === "partial-uv-transmission")!.path!;
assert.ok(transmittedPath.some((point, index) => index > 0 && Math.hypot(point.x - transmittedPath[index - 1]!.x, point.y - transmittedPath[index - 1]!.y) >= 80), "partial UV transmission moves beyond ozone instead of rendering a stationary point");
assert.ok(magnetosphereMotion.motionActions.some((action) => action.id === "charged-particle-deflection" && action.kind === "particle-flow"), "charged particles follow a curved magnetosphere route, separate from UV actions");
for (const [board, plan] of [[saltStoryboard, riverMotion], [solarStoryboard, ozoneMotion], [solarStoryboard, magnetosphereMotion]] as const) {
  const scene = board.scenes.find((item) => item.motionActions.length === 0 && item.relationships.some((relation) => relation.relation === (plan === riverMotion ? "carries" : plan === ozoneMotion ? "filters" : "deflects")))!;
  const targetIds = new Set(scene.composition.layers.flatMap((layer) => layer.nodes.map((_, index) => `${layer.id}/${index}`)));
  assert.ok(plan.motionActions.every((action) => targetIds.has(action.targetNode)), "semantic plan targets existing composition nodes");
  assert.ok(plan.motionActions.every((action) => action.startFrame >= 0 && action.startFrame + action.durationFrames <= scene.durationSec * 30), "semantic action timing stays within scene duration");
}
assert.equal(motionActionSchema.safeParse({ id: "bad-motion", kind: "particle-flow", targetNode: "missing/0", startFrame: 0, durationFrames: 20, easing: "linear", path: [{ x: -1, y: 0 }, { x: 20, y: 20 }], particleCount: 99 }).success, false, "motion schema rejects unsafe path bounds and excessive particles");
assert.equal(motionActionSchema.safeParse({ id: "mismatched-layer", kind: "particle-flow", targetNode: "lava/0", targetLayerId: "magma", startFrame: 0, durationFrames: 20, easing: "linear", path: [{ x: 300, y: 800 }, { x: 400, y: 600 }], particleCount: 3 }).success, false, "Motion Beat layer reference must match persisted target node");
const authoredMagmaAction = motionActionSchema.parse({ id: "magma-rise", description: "Magma naik", kind: "particle-flow", targetNode: "imported-illustration/0", targetLayerId: "imported-illustration", targetRole: "magma", startFrame: 10, durationFrames: 60, easing: "linear", path: [{ x: 400, y: 1200 }, { x: 500, y: 850 }], motionPathRef: "path-magma-rise", pathStyle: "magma", particleCount: 4 });
const authoredMagmaBeat = motionBeatFromAction(authoredMagmaAction);
assert.equal(authoredMagmaBeat.startTimeSec, 10 / 30, "Motion Beat projects persisted start frame to scene-relative seconds");
assert.equal(authoredMagmaBeat.targetRole, "magma", "Motion Beat exposes semantic target role");
assert.equal(motionPathProgress(authoredMagmaAction, 9), 0, "overlay path stays hidden before its start frame");
assert.equal(motionPathProgress(authoredMagmaAction, 40), 0.5, "overlay path progress is deterministic at midpoint");
assert.equal(motionPathProgress(authoredMagmaAction, 71), 1, "overlay path remains complete after end frame");
const editedMagmaAction = updateMotionBeat(authoredMagmaAction, { description: "Magma naik lewat saluran", startTimeSec: 1.2, durationSec: 2, path: [{ x: 450, y: 1300 }, { x: 530, y: 700 }] }, 5);
assert.deepEqual([editedMagmaAction.startFrame, editedMagmaAction.durationFrames], [36, 60], "Motion Beat edits round-trip to deterministic frame timing");
assert.equal(editedMagmaAction.description, "Magma naik lewat saluran", "Motion Beat description persists on source action");
assert.deepEqual(editedMagmaAction.path?.[0], { x: 450, y: 1300 }, "Motion Beat path edit persists in action data");
const riverAction = riverMotion.motionActions.find((action) => action.kind === "particle-flow")!;
const riverDrawAction = riverMotion.motionActions.find((action) => action.kind === "draw")!;
assert.notEqual(motionActionProgress(riverAction, riverAction.startFrame + 5), motionActionProgress(riverAction, riverAction.startFrame + 15), "semantic motion progress is a pure function of frame");
assert.notDeepEqual(pointAlongPolyline(riverAction.path!, 0.2), pointAlongPolyline(riverAction.path!, 0.8), "particles move along deterministic polyline positions");
const movingNode = relationScene(saltStoryboard, "carries")!;
const targetNode = movingNode.composition.layers.flatMap((layer) => layer.nodes.map((node, index) => ({ ref: `${layer.id}/${index}`, node }))).find((entry) => entry.ref === riverAction.targetNode)!.node;
assert.notDeepEqual(nodeMotion(riverMotion.motionActions, riverAction.targetNode, targetNode, riverAction.startFrame + 6), nodeMotion(riverMotion.motionActions, riverAction.targetNode, targetNode, riverAction.startFrame + 18), "Remotion node state changes deterministically across frames");
assert.equal(nodeMotion(riverMotion.motionActions, riverDrawAction.targetNode, targetNode, riverDrawAction.startFrame - 1).drawProgress, 0, "semantic draw path stays hidden before its planned start frame");
assert.equal(nodeMotion(riverMotion.motionActions, riverDrawAction.targetNode, targetNode, riverDrawAction.startFrame + riverDrawAction.durationFrames + 1).drawProgress, 1, "semantic draw path stays fully revealed after its planned end frame");
const fadeAction = motionActionSchema.parse({ id: "bounded-fade", kind: "fade", targetNode: riverAction.targetNode, startFrame: 10, durationFrames: 20, easing: "linear", keyframes: [{ at: 0, opacity: 0 }, { at: 1, opacity: 1 }] });
assert.equal(nodeMotion([fadeAction], fadeAction.targetNode, targetNode, 9).opacity, 0, "fade holds its first keyframe before planned start");
assert.equal(nodeMotion([fadeAction], fadeAction.targetNode, targetNode, 31).opacity, 1, "fade holds final keyframe after planned end");
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
const aiImportAsset = visualAssetSchema.parse({
  id: `upload-${"a".repeat(64)}.webp`, name: "River landscape", visualCategory: "user-illustration",
  semanticTags: ["river", "mineral", "ocean"], supportedConcepts: ["river carries mineral to sea"], role: "Connected educational landscape",
  format: "webp", aspectRatio: 1, source: "ai-generated", license: "Created via manual external AI import",
  style: "clean-flat-2d", prompt: "Vertical landscape: mountains, rock, mineral-bearing river flowing to ocean; no lettering.",
  provider: "ChatGPT manual import", model: "image model (user supplied)", sha256: "a".repeat(64), bytes: 840_000,
  width: 1000, height: 1000, file: `${"a".repeat(64)}.webp`,
});
assert.equal(visualAssetSchema.safeParse({ ...aiImportAsset, prompt: undefined }).success, false, "AI-imported asset must retain prompt provenance");
const smartRiver = saltStoryboard.scenes[2]!;
const reusableRiver: ReusableCandidate = {
  id: "reusable-river-test", name: "Connected river process", tags: smartRiver.objects.map((object) => object.label),
  concepts: [smartRiver.visualSummary, smartRiver.narrationText], styleId: "clean-flat-2d", layout: smartRiver.layout,
  compositionType: smartRiver.compositionType, composition: smartRiver.composition, palette: saltStoryboard.palette,
  motionIntent: smartRiver.motionIntent, motionSummary: smartRiver.motionSummary, motionPlan: seaSalt.scenes[2]!.motionPlan,
  objects: smartRiver.objects, relationships: smartRiver.relationships, visualFocus: smartRiver.visualFocus, assetIds: [],
  provenance: "Locally authored composition; source license checked.",
};
const reusableSelection = prepareSmartVisual({ scene: smartRiver, storyboard: saltStoryboard, reusableScenes: [reusableRiver], assets: [] });
assert.equal(reusableSelection.source, "reusable-scene", "Smart Hybrid prefers structured reusable scene with matching object/process relations");
assert.equal(reusableSelection.status, "needs_review", "reused art remains unapproved and requires human review");
const paletteMismatch = prepareSmartVisual({ scene: smartRiver, storyboard: saltStoryboard, reusableScenes: [{ ...reusableRiver, palette: { ...reusableRiver.palette, accent: "#000000" } }], assets: [] });
assert.notEqual(paletteMismatch.source, "reusable-scene", "reusable scene with incompatible art palette is rejected");
const unlicensedAiReusable = prepareSmartVisual({ scene: smartRiver, storyboard: saltStoryboard, reusableScenes: [{ ...reusableRiver, assetIds: [aiImportAsset.id] }], assets: [aiImportAsset] });
assert.notEqual(unlicensedAiReusable.source, "reusable-scene", "AI-imported asset with unverified output license cannot qualify for automatic reuse");
const imageNotFitForRiverProcess = prepareSmartVisual({ scene: smartRiver, storyboard: saltStoryboard, reusableScenes: [], assets: [aiImportAsset] });
assert.equal(imageNotFitForRiverProcess.source, "local-composer", "metadata-only raster is not selected for scene requiring a connected process");
assert.ok(smartRiver.relationships.every((relation) => imageNotFitForRiverProcess.composition && visualRelationshipIsVisible(relation, imageNotFitForRiverProcess.composition)), "local fallback preserves river/mineral/ocean relationships as connected paths");
const rasterStoryboard = structuredClone(saltStoryboard);
const rasterScene = rasterStoryboard.scenes[2]!;
Object.assign(rasterScene, {
  objects: [], relationships: [], visualFocus: null, illustrationSource: "ai-image", compositionSource: "manual",
  compositionType: "hero-object-focus", layout: "existing-composition", authoringStatus: "needs_review", authoringConfirmed: false,
  approved: false, approvedFingerprint: null, warnings: [],
  composition: visualCompositionSchema.parse({ background: saltStoryboard.palette.canvas, layers: [{ id: "imported-illustration", depth: 0.72, nodes: [{ type: "image", asset: aiImportAsset.id, x: 40, y: 520, width: 1000, height: 900, fit: "contain", position: "center" }] }] }),
});
assert.equal(illustrationSourceForScene(rasterScene), "ai-image");
const rasterWorld = buildVisualWorld("Shared river world", rasterScene);
assert.equal(rasterWorld.sourceAssetId, aiImportAsset.id, "Visual World tracks imported base raster asset");
assert.deepEqual(rasterWorld.elements.map((element) => element.layerId), rasterWorld.composition.layers.map((layer) => layer.id), "Visual World exposes every composition layer by stable ID");
assert.equal(visualWorldSchema.safeParse(rasterWorld).success, true, "stable Visual World layer manifest passes schema");
const sharedWorldBoard = structuredClone(rasterStoryboard);
sharedWorldBoard.visualWorld = rasterWorld;
sharedWorldBoard.scenes.forEach((scene) => { scene.composition = rasterWorld.composition; });
sharedWorldBoard.reusableWorldObjects = visualObjectIds.filter((objectId) => sharedWorldBoard.scenes.filter((scene) => scene.objects.some((object) => object.objectId === objectId)).length > 1);
const sharedWorldParse = visualStoryboardSchema.safeParse(sharedWorldBoard);
assert.equal(sharedWorldParse.success, true, `shared Visual World persists with identical base composition in every scene: ${sharedWorldParse.success ? "" : JSON.stringify(sharedWorldParse.error.issues)}`);
const splitWorldBoard = structuredClone(sharedWorldBoard);
splitWorldBoard.scenes[0]!.compositionOverride = saltStoryboard.scenes[0]!.composition;
assert.equal(visualStoryboardSchema.safeParse(splitWorldBoard).success, true, "shared Visual World allows explicit scene composition override");
assert.deepEqual(compositionForVisualScene(splitWorldBoard, splitWorldBoard.scenes[0]!), saltStoryboard.scenes[0]!.composition, "scene override takes precedence over shared Visual World");
assert.deepEqual(compositionForVisualScene(splitWorldBoard, splitWorldBoard.scenes[1]!), rasterWorld.composition, "non-target scenes keep shared Visual World base");
const splitProjection = applyVisualStoryboard(seaSalt, splitWorldBoard);
assert.deepEqual(splitProjection.scenes[0]!.visualComposition, saltStoryboard.scenes[0]!.composition, "Remotion projection renders scene-specific override");
assert.ok(splitProjection.scenes.slice(1).every((scene) => JSON.stringify(scene.visualComposition) === JSON.stringify(rasterWorld.composition)), "Remotion projection keeps shared base on unaffected scenes");

const sixSceneImportBoard = structuredClone(volcanoVisualSample);
const sharedCompositionBeforeImport = structuredClone(sixSceneImportBoard.visualWorld!.composition);
const motionBeforeImport = sixSceneImportBoard.scenes.map((scene) => structuredClone(scene.motionActions));
sixSceneImportBoard.scenes.forEach((scene, index) => {
  const composition = visualCompositionSchema.parse({ background: sixSceneImportBoard.palette.canvas, layers: [{ id: `flow-fixture-${index + 1}`, depth: 0.05, nodes: [{ type: "image", asset: aiImportAsset.id, x: 0, y: 0, width: 1080, height: 1920, fit: "cover", position: "center" }] }] });
  scene.composition = composition;
  scene.compositionOverride = composition;
  scene.compositionSource = "library";
  scene.illustrationSource = "ai-image";
  scene.authoringConfirmed = false;
  scene.authoringStatus = "needs_review";
  scene.approved = false;
  scene.approvedFingerprint = null;
});
assert.equal(sixSceneImportBoard.scenes.length, 6, "six-scene Google Flow fixture covers all imported scenes");
assert.deepEqual(sixSceneImportBoard.visualWorld!.composition, sharedCompositionBeforeImport, "per-scene batch leaves shared Visual World immutable");
assert.deepEqual(sixSceneImportBoard.scenes.map((scene) => scene.motionActions), motionBeforeImport, "per-scene batch preserves every Motion Beat");
assert.ok(sixSceneImportBoard.scenes.every((scene) => compositionForVisualScene(sixSceneImportBoard, scene).layers[0]?.nodes[0]?.type === "image"), "all six scenes render their imported scene overrides");
const sixSceneGate = visualStoryboardQualityGate(volcano, sixSceneImportBoard, [aiImportAsset]);
assert.ok(sixSceneGate.issues.some((issue) => issue.includes("Motion Beat memiliki target layer/node yang hilang")), "missing Motion Beat targets stay visible as quality issues after import");
const staleTargetResearch = parseResearchPackage(applyVisualStoryboard(volcano, sixSceneImportBoard));
assert.equal(staleTargetResearch.success, true, "stale Motion Beat targets remain saveable so they can be repaired in the editor");
if (staleTargetResearch.success) assert.deepEqual(staleTargetResearch.data.scenes.map((scene) => scene.motionActions), motionBeforeImport, "saving stale targets preserves Motion Beats for repair");
assert.ok(visualStoryboardQualityGate(seaSalt, rasterStoryboard, [aiImportAsset]).scenes[rasterScene.sceneId]?.some((issue) => issue.includes("Tinjau semantik")), "raster illustration requires explicit semantic/provenance review before approval");
rasterScene.authoringConfirmed = true;
const rasterGate = visualStoryboardQualityGate(seaSalt, rasterStoryboard, [aiImportAsset]);
assert.deepEqual(rasterGate.scenes[rasterScene.sceneId] ?? [], [], "one complete raster scene passes object-ID checks after human review");
assert.ok(rasterGate.reviewNotes.some((note) => note.includes("license/provenance")) === false, "specific asset provenance avoids unspecified-license review note");
const rasterMotion = planSceneMotion(rasterScene, "balanced");
assert.ok(rasterMotion.motionActions.length > 0 && rasterMotion.motionActions.every((action) => action.targetNode === "imported-illustration/0" && ["focus-shift", "scale", "translate", "fade", "reveal"].includes(action.kind)), "raster art receives whole-image transforms only");
assert.ok(rasterMotion.motionSummary.includes("Raster bergerak sebagai satu gambar"), "raster limitation is visible in motion summary");
const rasterMotionBoard = structuredClone(rasterStoryboard);
Object.assign(rasterMotionBoard.scenes[2]!, rasterMotion);
rasterMotionBoard.reusableWorldObjects = visualObjectIds.filter((objectId) => rasterMotionBoard.scenes.filter((scene) => scene.objects.some((object) => object.objectId === objectId)).length > 1);
const rasterMotionValidation = visualStoryboardSchema.safeParse(rasterMotionBoard);
assert.equal(rasterMotionValidation.success, true, `safe whole-image raster motion passes storyboard schema: ${rasterMotionValidation.success ? "" : JSON.stringify(rasterMotionValidation.error.issues)}`);
const invalidRasterMotion = structuredClone(rasterMotionBoard);
invalidRasterMotion.scenes[2]!.motionActions = [{ ...rasterMotion.motionActions[0]!, id: "invented-raster-object", targetNode: "imported-illustration/0.0", kind: "particle-flow", path: [{ x: 200, y: 300 }, { x: 300, y: 500 }], particleCount: 3 }];
assert.equal(visualStoryboardSchema.safeParse(invalidRasterMotion).success, true, "missing Motion Beat target remains persisted for repair instead of being silently discarded");
assert.ok(visualStoryboardQualityGate(seaSalt, invalidRasterMotion, [aiImportAsset]).scenes[rasterScene.sceneId]?.some((issue) => issue.includes("target layer/node yang hilang")), "quality gate marks missing raster Motion Beat target for repair");
const rasterOverlay = structuredClone(rasterMotionBoard);
rasterOverlay.scenes[2]!.motionActions = [{ id: "available-raster-overlay", kind: "particle-flow", targetNode: "imported-illustration/0", startFrame: 10, durationFrames: 20, easing: "linear", path: [{ x: 300, y: 600 }, { x: 600, y: 900 }], particleCount: 2 }];
assert.equal(visualStoryboardSchema.safeParse(rasterOverlay).success, true, "raster layer permits real overlay particles without pretending internal objects are separate");
const libraryRasterStoryboard = structuredClone(rasterStoryboard);
libraryRasterStoryboard.scenes[2]!.compositionSource = "library";
libraryRasterStoryboard.scenes[2]!.illustrationSource = "asset-library";
const changedRasterResearch = structuredClone(seaSalt);
changedRasterResearch.scenes[2]!.narrationText += " Mineral larut terus terbawa ke laut.";
const rebuiltRasterStoryboard = buildVisualStoryboard(changedRasterResearch, libraryRasterStoryboard);
assert.deepEqual(rebuiltRasterStoryboard.scenes[2]!.composition, libraryRasterStoryboard.scenes[2]!.composition, "storyboard rebuild keeps manually selected library raster composition");
assert.equal(rebuiltRasterStoryboard.scenes[2]!.illustrationSource, "asset-library", "storyboard rebuild keeps illustration source metadata");
const missingRaster = structuredClone(rasterStoryboard);
missingRaster.scenes[2]!.composition = saltStoryboard.scenes[2]!.composition;
missingRaster.scenes[2]!.authoringConfirmed = false;
assert.equal(visualStoryboardQualityGate(seaSalt, missingRaster).scenes[missingRaster.scenes[2]!.sceneId]?.length, 1, "missing raster shows one actionable authoring issue, not cascading empty-composition errors");
const rasterMarkup = renderToStaticMarkup(React.createElement("svg", null, React.createElement(VisualCompositionView, {
  scene: seaSalt.scenes[2]!, composition: rasterScene.composition, style: visualStyles[seaSalt.visualPreset], preset: seaSalt.visualPreset, frame: 45, progress: 0.42,
})));
assert.match(rasterMarkup, /preserveAspectRatio="xMidYMid meet"/);
const magmaOverlayScene = { ...seaSalt.scenes[2]!, motionActions: [authoredMagmaAction] };
const magmaOverlayMarkup = renderToStaticMarkup(React.createElement("svg", null, React.createElement(VisualCompositionView, {
  scene: magmaOverlayScene, composition: rasterScene.composition, style: visualStyles[seaSalt.visualPreset], preset: seaSalt.visualPreset,
  frame: 40, progress: 0.5,
  editor: {
    sceneId: magmaOverlayScene.id, selectedImageId: null, onSelectImage: () => {}, onTransformImage: () => {},
    selectedMotionPath: { actionId: authoredMagmaAction.id, points: authoredMagmaAction.path!, pathStyle: "magma" },
    onTransformMotionPathPoint: () => {},
  },
})));
assert.match(magmaOverlayMarkup, /data-motion-path-point="0"/, "selected Motion Beat exposes canvas path handles");
assert.match(magmaOverlayMarkup, /role="slider"[^>]+aria-valuetext="x 400, y 1200"/, "canvas path handle exposes keyboard-editable coordinates");
const preMotionV2Scene = structuredClone(seaSalt.scenes[2]!) as unknown as Record<string, unknown>;
delete preMotionV2Scene.motionActions;
const preMotionV2Markup = renderToStaticMarkup(React.createElement("svg", null, React.createElement(VisualCompositionView, {
  scene: preMotionV2Scene as unknown as typeof seaSalt.scenes[number], composition: seaSalt.scenes[2]!.visualComposition,
  style: visualStyles[seaSalt.visualPreset], preset: seaSalt.visualPreset, frame: 45, progress: 0.42,
})));
assert.match(preMotionV2Markup, /<svg/, "pre-Motion renderer V2 scene without motionActions remains renderable");
assert.deepEqual(visualCompositionFrame(rasterScene.composition), { scale: 1, translateX: 0, translateY: 0 }, "raster art-directed framing does not auto-crop the safe composition");
const trustedImageComposition = structuredClone(rasterScene.composition);
const trustedImage = trustedImageComposition.layers[0]!.nodes[0]!;
assert.equal(trustedImage.type, "image");
if (trustedImage.type === "image") trustedImage.asset = "cloud";
assert.notEqual(visualCompositionFrame(trustedImageComposition).scale, 1, "built-in curated image framing preserves legacy auto-fit behavior");
const rasterPrompt = buildIllustrationPrompt({ research: seaSalt, storyboard: saltStoryboard, scene: saltStoryboard.scenes[2]! });
assert.match(rasterPrompt, /[Vv]ertical 9:16/);
assert.match(rasterPrompt, /Narasi|Scene narration/);
assert.match(rasterPrompt, /NEGATIVE INSTRUCTIONS: Avoid 3D.*No text.*collage.*multi-panel storyboard.*generic icon cards/s);
assert.match(rasterPrompt, /palette/);
assert.match(rasterPrompt, /Visual style: Modern 2D cartoon educational explainer; clean outlines, soft rounded shapes/s);
assert.match(rasterPrompt, /Animation style: Smooth 2D motion.*slight squash and stretch.*gentle secondary motion/s);
assert.match(rasterPrompt, /Composition and camera: Vertical 9:16, mobile-first.*mostly fixed camera.*no dramatic camera rotations/s);
assert.match(rasterPrompt, /NEGATIVE INSTRUCTIONS: Avoid 3D, photorealism, realistic textures, CGI look, cinematic realism/s);
assert.match(rasterPrompt, /SUNGAI flows-to LAUT.*SUNGAI carries MINERAL/s, "river prompt encodes mineral flow from mountain river toward sea");
const animatedPrompt = buildIllustrationPrompt({ research: seaSalt, storyboard: saltStoryboard, scene: saltStoryboard.scenes[2]!, mode: "animated-video" });
assert.match(animatedPrompt, /Create one continuous animated video clip/);
assert.match(animatedPrompt, /Primary motion: Animate/);
assert.match(animatedPrompt, /expressive-2d-cartoon · Kartun 2D Ekspresif/);
assert.match(animatedPrompt, /Scene duration: exactly .* seconds\. Compose for portrait 9:16/);
assert.match(animatedPrompt, /Maintain the selected preset across all scenes in this project/);
assert.deepEqual(ANIMATION_STYLE_PRESETS.map((preset) => preset.id), ["expressive-2d-cartoon", "2d-motion-graphics", "2d-cinematic", "cinematic-2d-motion-comic", "2d-hand-drawn", "2d-paper-cutout", "stylized-3d-cartoon"]);
assert.equal(DEFAULT_ANIMATION_STYLE_ID, "expressive-2d-cartoon");
assert.equal(animationStyleIdSchema.safeParse("stylized-3d-cartoon").success, true, "stable 3D style ID validates");
assert.equal(animationStyleIdSchema.safeParse("Kartun 3D Stylized").success, false, "display names are not style identifiers");
assert.equal(getAnimationStylePreset("legacy-unknown-style").id, DEFAULT_ANIMATION_STYLE_ID, "unknown and legacy style IDs fall back without throwing");
assert.equal(new Set(ANIMATION_STYLE_PRESETS.map((preset) => `${preset.prompt.style}\n${preset.prompt.motion}\n${preset.prompt.negative}`)).size, 7, "all preset prompt configurations differ");
const presetPrompts = ANIMATION_STYLE_PRESETS.map((preset) => buildIllustrationPrompt({ research: seaSalt, storyboard: saltStoryboard, scene: saltStoryboard.scenes[2]!, mode: "animated-video", animationStyleId: preset.id }));
assert.equal(new Set(presetPrompts).size, 7, "same scene produces distinct animation prompts for all presets");
for (const [index, preset] of ANIMATION_STYLE_PRESETS.entries()) assert.match(presetPrompts[index]!, new RegExp(preset.id));
assert.match(presetPrompts[1]!, /Flat vector educational motion graphics.*scientific diagrams/s);
assert.match(presetPrompts[2]!, /Cinematic hand-painted 2D animation.*atmospheric depth/s);
assert.match(presetPrompts[3]!, /Traditional flat 2D hand-painted horror animation.*mature eerie animated-film atmosphere/s);
assert.match(presetPrompts[4]!, /Traditional hand-drawn 2D animation.*organic linework/s);
assert.match(presetPrompts[5]!, /Layered 2D paper cutout animation.*tactile paper fibers/s);
assert.match(presetPrompts[6]!, /Stylized 3D cartoon animation.*soft global illumination/s);
assert.doesNotMatch(presetPrompts[6]!, /Avoid 3D/i, "3D preset negative instructions do not prohibit 3D");
assert.doesNotMatch(presetPrompts[6]!, /Soft flat 2D lighting|Required minimal shading/i, "default 2D Style Lock does not contradict 3D preset");
assert.match(presetPrompts[6]!, /Project Style Lock.*selected preset controls/s, "Style Lock remains subordinate to selected animation style");
const galleryMarkup = renderToStaticMarkup(React.createElement(AnimationStyleGallery, { selectedId: DEFAULT_ANIMATION_STYLE_ID, onChange: () => {} }));
assert.equal((galleryMarkup.match(/<article class="animation-style-card/g) ?? []).length, 7, "Create gallery renders all seven presets");
assert.equal((galleryMarkup.match(/<button\b/g) ?? []).length, 7, "each preset has one selection button");
assert.match(galleryMarkup, /data-animation-style-id="expressive-2d-cartoon"/);
assert.match(galleryMarkup, /aria-pressed="true"/);
assert.doesNotMatch(galleryMarkup, /<(?:img|video|dialog)\b|preview|showcase/i, "gallery is text-only without preview UI");
const oversizedPreviousReference = { sceneNumber: 1, name: "Previous scene", style: mountainStoryboard.styleLock.illustrationStyle, prompt: `PREVIOUS_PROMPT_MUST_NOT_BE_COPIED ${"previous prompt content ".repeat(600)}` };
const followupPrompt = buildIllustrationPrompt({ research: mountain, storyboard: mountainStoryboard, scene: mountainStoryboard.scenes[1]!, previousReference: oversizedPreviousReference });
assert.ok(followupPrompt.length <= 12000, "previous Flow prompt is not recursively copied into the next scene prompt");
assert.equal(followupPrompt.includes("PREVIOUS_PROMPT_MUST_NOT_BE_COPIED"), false, "scene reference keeps only concise style context");
const ozonePrompt = buildIllustrationPrompt({ research: solarProtection, storyboard: solarStoryboard, scene: solarStoryboard.scenes[2]! });
assert.match(ozonePrompt, /LAPISAN OZON filters SINAR UV/, "ozone prompt encodes UV absorption before radiation reaches Earth");
assert.match(ozonePrompt, /Modern 2D Cartoon Educational Explainer.*one connected environment/s);
assert.match(rasterPrompt, /one finished still illustration.*one full-scene illustration/s, "Flow prompt requests exactly one illustration, not a multi-panel storyboard");
assert.match(rasterPrompt, /scientifically incorrect scale\/relationships/);
const mountainFlowScenes = mountainStoryboard.scenes.slice(0, 3);
const firstFlowScene = mountainFlowScenes[0]!;
const firstToken = firstFlowScene.sceneToken;
assert.equal(firstToken, stableGoogleFlowSceneToken(firstFlowScene.sceneId), "scene token derives from stable scene identity");
assert.equal(stableGoogleFlowSceneToken(firstFlowScene.sceneId), stableGoogleFlowSceneToken(firstFlowScene.sceneId), "stable token survives title edits and project reload");
const fileForSceneOne = recommendedGoogleFlowFilename({ ...firstFlowScene, headline: "Gunung terbentuk perlahan" });
assert.match(fileForSceneOne, /^scene-01-gunung-terbentuk-perlahan-flow-[a-f0-9]{16}\.webp$/);
const flowIdentities = mountainFlowScenes.map((scene) => ({ sceneId: scene.sceneId, sceneNumber: scene.sceneNumber, headline: scene.headline, sceneToken: scene.sceneToken, recommendedFilename: scene.recommendedFilename }));
const tokenMapping = matchGoogleFlowFiles([{ name: `${firstFlowScene.sceneToken}.webp` }], flowIdentities);
assert.equal(tokenMapping[0]?.sceneId, firstFlowScene.sceneId, "stable token takes priority for import auto-match");
const numberedMapping = matchGoogleFlowFiles([{ name: "scene-01.webp" }, { name: "scene-02.webp" }, { name: "scene-03.webp" }], flowIdentities);
assert.deepEqual(numberedMapping.map((match) => match.sceneId), mountainFlowScenes.map((scene) => scene.sceneId), "unambiguous scene-number filenames map to matching scene identities");
const numberMismatch = matchGoogleFlowFiles([{ name: `scene-02-${firstFlowScene.sceneToken}.webp` }], flowIdentities);
assert.equal(numberMismatch[0]?.status, "number-conflict", "stable token and explicit scene number conflict blocks automatic assignment");
const duplicateFiles = matchGoogleFlowFiles([{ name: "scene-01.webp" }, { name: "scene-01.webp" }], flowIdentities);
assert.ok(duplicateFiles.every((match) => match.status === "duplicate-file" && match.sceneId === null), "duplicate filenames require manual review instead of silently replacing");
const sceneConflict = matchGoogleFlowFiles([{ name: "scene-01.webp" }, { name: "scene-01-gunung-terbentuk.webp" }], flowIdentities);
assert.ok(sceneConflict.every((match) => match.status === "scene-conflict"), "multiple distinct files targeting same scene become a conflict");
const unmatched = matchGoogleFlowFiles([{ name: "mountain-final.webp" }], flowIdentities);
assert.equal(unmatched[0]?.status, "unmatched", "unrecognized names require manual scene assignment");
assert.deepEqual(validGoogleFlowAssignments([{ sceneId: mountainFlowScenes[0]!.sceneId, skipped: false }, { sceneId: mountainFlowScenes[0]!.sceneId, skipped: false }]), [false, false], "manual duplicate target assignment cannot apply");
assert.deepEqual(validGoogleFlowAssignments([{ sceneId: mountainFlowScenes[0]!.sceneId, skipped: false }, { sceneId: mountainFlowScenes[1]!.sceneId, skipped: false }, { sceneId: null, skipped: true }]), [true, true, false], "unique manual assignments apply while skipped files remain untouched");
const flowPack = googleFlowPromptPack(mountain.title, mountainStoryboard.styleLock, mountainFlowScenes.map((scene) => ({ sceneId: scene.sceneId, sceneNumber: scene.sceneNumber, sceneToken: scene.sceneToken, recommendedFilename: scene.recommendedFilename, headline: scene.headline, narrationText: scene.narrationText, prompt: buildIllustrationPrompt({ research: mountain, storyboard: mountainStoryboard, scene }) })));
assert.equal(flowPack.json.scenes.length, 3);
assert.match(flowPack.markdown, /Global Style Lock/);
assert.match(flowPack.markdown, /Stable token:/);
assert.match(flowPack.json.scenes[0]!.prompt, /no text/i);
assert.match(flowPack.json.scenes[0]!.prompt, /berlangsung sangat lama/, "scene one prompt includes relevant project-wide geological timescale");
assert.match(flowPack.json.scenes[2]!.prompt, /melipat dan mengangkat kerak/, "scene three prompt includes project-wide crust folding and uplift context");
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
const aiVectorFixture = {
  schemaVersion: "ai-vector-v1",
  description: "Satu berkas cahaya putih memasuki prisma kaca lalu terurai menjadi spektrum warna.",
  composition: {
    background: "#f8f7fc",
    layers: [
      { id: "sunlight-source", depth: 0.2, nodes: [{ type: "shape", shape: "circle", x: 120, y: 900, width: 180, height: 180, fill: "#f4b65e", stroke: "#c97945", strokeWidth: 6 }] },
      { id: "incoming-white-light", depth: 0.35, nodes: [{ type: "shape", shape: "polygon", x: 290, y: 930, width: 380, height: 120, points: [{ x: 0, y: 0.35 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0.65 }], fill: { type: "linear-gradient", angle: 0, stops: [{ offset: 0, color: "#fffdf5" }, { offset: 1, color: "#b8d9f2", opacity: 0.7 }] } }] },
      { id: "prism-and-spectrum", depth: 0.55, nodes: [
        { type: "shape", shape: "polygon", x: 540, y: 770, width: 260, height: 410, points: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], fill: { type: "linear-gradient", angle: 45, stops: [{ offset: 0, color: "#d9f2ff", opacity: 0.72 }, { offset: 1, color: "#83bce0", opacity: 0.42 }] }, stroke: "#538baa", strokeWidth: 8 },
        { type: "path", x: 750, y: 920, width: 270, height: 220, d: "M 0 10 C 25 20 60 25 100 35", fill: "none", stroke: "#e84d51", strokeWidth: 3 },
      ] },
    ],
  },
} as const;
assert.equal(aiVectorIllustrationSchema.safeParse(aiVectorFixture).success, true, "AI Vector accepts unrestricted semantic layer IDs, geometry, paths, and gradients");
const parsedAiVectorFixture = aiVectorIllustrationSchema.parse(aiVectorFixture);
assert.equal(vectorIllustrationNodeCount(parsedAiVectorFixture.composition), 4);
const gradientMarkup = renderToStaticMarkup(React.createElement("svg", null, React.createElement(VisualCompositionView, {
  scene: seaSalt.scenes[0]!, composition: parsedAiVectorFixture.composition,
  style: visualStyles[seaSalt.visualPreset], preset: seaSalt.visualPreset, frame: 45, progress: 0.42,
})));
assert.match(gradientMarkup, /<linearGradient/);
assert.match(gradientMarkup, /fill="url\(#paint-/);
assert.equal(aiVectorIllustrationSchema.safeParse({ ...aiVectorFixture, composition: { ...aiVectorFixture.composition, layers: [{ ...aiVectorFixture.composition.layers[0]!, nodes: [{ type: "icon", icon: "sun", x: 120, y: 900, width: 180, height: 180, color: "#f4b65e" }] }] } }).success, false, "AI Vector rejects legacy icon IDs and only accepts explicit geometry");
assert.equal(aiVectorIllustrationSchema.safeParse({ ...aiVectorFixture, composition: { ...aiVectorFixture.composition, layers: [{ ...aiVectorFixture.composition.layers[0]!, nodes: [{ type: "path", x: 120, y: 900, width: 180, height: 180, d: "M0 0 L101 100", fill: "#ffffff" }] }] } }).success, false, "AI Vector path coordinates stay inside normalized 0–100 viewBox");
assert.equal(aiVectorIllustrationSchema.safeParse({ ...aiVectorFixture, composition: { ...aiVectorFixture.composition, layers: [{ id: "outside", depth: 0.5, nodes: [{ type: "shape", shape: "rect", x: 1080, y: 1000, width: 1, height: 1 }] }] } }).success, false, "AI Vector rejects node bounds outside 9:16 canvas");
assert.throws(() => parseAiVectorIllustration(" ".repeat(48 * 1024 + 1)), /exceeds batas|melebihi batas/, "AI Vector rejects oversized output before JSON parsing");
assert.equal(visualCompositionSchema.safeParse(aiVectorFixture.composition).success, true, "existing visual composition parser accepts safe gradient fills");
const rasterEditFixture = visualCompositionSchema.parse({ background: "#ffffff", layers: [
  { id: "raster", depth: 0.5, nodes: [{ type: "image", asset: "cloud", x: 100, y: 200, width: 400, height: 500, fit: "contain" }] },
  { id: "grouped-raster", depth: 0.6, nodes: [{ type: "group", x: 100, y: 900, width: 600, height: 700, children: [{ type: "image", asset: "sun", x: 80, y: 100, width: 260, height: 340 }] }] },
] });
assert.deepEqual(visualImageNodes(rasterEditFixture).map((image) => image.id), ["raster/0", "grouped-raster/0.0"], "editor finds raster nodes in normal and grouped composition layers");
const movedRasterFixture = updateVisualImageNode(rasterEditFixture, "raster/0", { x: 160, y: 280, width: 480, height: 600, fit: "cover", position: "top-right" });
assert.deepEqual(visualImageNodes(movedRasterFixture)[0]?.node, { type: "image", asset: "cloud", x: 160, y: 280, width: 480, height: 600, fit: "cover", position: "top-right" }, "raster transform and fit persist in existing composition schema");
assert.equal(visualImageNodes(rasterEditFixture)[0]?.node.x, 100, "editing returns new composition without mutating source project data");
assert.throws(() => updateVisualImageNode(rasterEditFixture, "raster/0", { x: 700, width: 500 }), /Visual node melewati safe canvas/, "invalid out-of-canvas raster transform is rejected by existing schema");
assert.throws(() => updateVisualImageNode(rasterEditFixture, "missing/0", { x: 20 }), /tidak ditemukan/, "stale editor node references fail explicitly");
const aiVectorStoryboard = structuredClone(saltStoryboard);
const aiVectorScene = aiVectorStoryboard.scenes[0]!;
Object.assign(aiVectorScene, {
  layout: "scientific-diagram", compositionType: "scientific-diagram", objects: [], relationships: [], visualFocus: null,
  illustrationIntent: parsedAiVectorFixture.description, motionIntent: "gentle-reveal", motionSummary: "Reveal ringan pada ilustrasi.",
  composition: parsedAiVectorFixture.composition, compositionSource: "ai-vector", missingVisuals: [], warnings: [],
  authoringStatus: "needs_review", authoringConfirmed: false, approved: false, approvedFingerprint: null,
});
assert.equal(visualStoryboardSchema.safeParse(aiVectorStoryboard).success, true, "AI Vector scene persists without old library object IDs");
assert.deepEqual(visualStoryboardQualityGate(seaSalt, aiVectorStoryboard).issues, [], "valid AI Vector geometry passes storyboard quality checks but still requires review");
const rebuiltAiVector = buildVisualStoryboard(applyVisualStoryboard(seaSalt, aiVectorStoryboard), aiVectorStoryboard).scenes[0]!;
assert.equal(rebuiltAiVector.compositionSource, "ai-vector");
assert.deepEqual(rebuiltAiVector.composition, parsedAiVectorFixture.composition, "storyboard rebuild preserves authored AI Vector composition");
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
assert.equal(validateAudioQuality({ ...clearAudio, source: "scene-media", expectedAudioDurationSec: undefined, meanVolumeDb: -80 }).audioValidation, "pass-media", "enabled scene audio remains distinct from narration loudness validation");
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
  hasPendingAudio: false, narrationMode: "audio", reviewVerified: false, hasWarnings: false, previewReviewed: false,
  latestJobContentCurrent: false,
};
assert.equal(workflowStatuses(workflowBase).materials, "active");
assert.equal(reachableWorkspaceStep("video-editor", workflowBase), "video-editor", "Video Editor remains reachable while visuals need repair or approval");
assert.equal(reachableWorkspaceStep("review", workflowBase), "video-editor", "review remains blocked until visual approval");
assert.equal(reachableWorkspaceStep("render", workflowBase), "video-editor", "resume reaches Video Editor but stops before review until visual approval");
assert.equal(reachableWorkspaceStep("render", { ...workflowBase, visualStoryboardApproved: true }), "review", "visual approval precedes research review");
assert.equal(reachableWorkspaceStep("render", { ...workflowBase, visualStoryboardApproved: true, reviewVerified: true }), "preview");
assert.equal(reachableWorkspaceStep("render", { ...workflowBase, visualStoryboardApproved: true, reviewVerified: true, previewReviewed: true }), "render");
assert.equal(canAdvanceWorkspaceStep("narration", { ...workflowBase, audioMatchesNarration: false }), false, "stale AI audio blocks progression");
assert.equal(canAdvanceWorkspaceStep("video-editor", workflowBase), false, "visual issues block progression out of Video Editor, not entry");
assert.equal(canAdvanceWorkspaceStep("video-editor", { ...workflowBase, visualStoryboardApproved: true }), true, "approved Video Editor can advance to Review");
assert.equal(reachableWorkspaceStep("render", { ...workflowBase, visualStoryboardApproved: true, audioMatchesNarration: false }), "narration");
assert.equal(workflowStatuses({ ...workflowBase, activeStep: "preview", reviewVerified: false }).review, "attention");
assert.equal(workflowStatuses({ ...workflowBase, activeStep: "render", latestJobState: "rendered", latestJobContentCurrent: true }).render, "active");
const reviewAudio = { file: "audio/test.wav", sha256: "audio-sha", durationSec: 12, timingMode: "scaled" as const, source: "upload" as const };
const previewFingerprint = previewReviewFingerprint(mountain, reviewAudio, 2);
assert.equal(previewFingerprint, previewReviewFingerprint(mountain, reviewAudio, 2, null), "projects without Outro retain their existing preview-review fingerprint shape");
assert.notEqual(previewFingerprint, previewReviewFingerprint(mountain, reviewAudio, 2, { assetId: "outro-a", trimOutSec: 2 }), "Outro changes invalidate preview review");
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
  assert.ok(generatedDraft.researchPackage.scenes.every((scene) => scene.motionCues.length === 1 && scene.motionCues[0] === "cut" && scene.motionPlan.length === 1 && scene.motionPlan[0]!.cue === "cut"), "new AI scenes default to Cut without added Motion Direction effects");
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
const manualLegacyPackage = parseManualAiResult(mountain, aiInput, "manual-v1-package");
assert.equal(manualLegacyPackage.success, true, "manual result accepts existing Research Package v1.0 after migration");
if (manualLegacyPackage.success) assert.deepEqual(manualLegacyPackage.draft.researchPackage.scenes[0]!.motionPlan, mountain.scenes[0]!.motionPlan, "manual/legacy package retains authored motion configuration");
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

const manualInput = manualProjectInputSchema.parse({ topic: "Mengapa laut asin?", language: "id-ID", targetDurationSec: 30, deliveryStyle: "edukatif", additionalInstructions: "Gunakan bahasa sederhana.", sourceUrls: ["https://example.org/source"] });
assert.equal(manualProjectInputSchema.safeParse({ ...manualInput, sourceUrls: ["javascript:alert(1)"] }).success, false, "manual sources reject non-HTTP URLs");
const manualDraft = buildManualResearchPackage(manualInput, "manual-package-id");
assert.equal(parseResearchPackage(manualDraft).success, true, "manual draft satisfies existing Research Package schema");
assert.equal(manualDraft.scenes.length, 1, "manual draft has one schema-compatible placeholder scene");
assert.equal(manualDraft.scenes[0]!.onScreenText, "", "manual placeholder has no fabricated on-screen facts");
assert.equal(manualDraft.scenes[0]!.visualDescription, "", "manual placeholder has no fabricated visual direction");
assert.equal(manualDraft.references[0]!.checkedAt, undefined, "manual source remains unverified");
assert.equal(narrationScript(manualDraft), "", "placeholder narration cannot be sent to TTS");
const completedManualDraft = { ...manualDraft, scenes: manualDraft.scenes.map((scene) => ({ ...scene, narrationText: "Naskah yang ditulis pengguna." })) };
assert.equal(narrationScript(completedManualDraft), "Naskah yang ditulis pengguna.", "completed manual narration becomes processable");

assert.equal(durationInFrames(mountain), 56 * 30);
assert.equal(durationInFrames(mountain, 43.5), 43.5 * 30);
const outroSelection = { assetId: "f46e6843-a5e8-438e-bc8f-21c58515f268", enabled: true, trimInSec: 0.2, trimOutSec: 1.3, audioEnabled: false };
assert.equal(durationInFrames(mountain, undefined, "scaled", outroSelection), 56 * 30 + 33, "Outro trim appends frame-quantized duration without retiming scenes");
assert.equal(durationInFrames(mountain, undefined, "scaled", { ...outroSelection, enabled: false }), 56 * 30, "disabled outro contributes no timeline frames");
assert.equal(outroSelectionSchema.safeParse({ ...outroSelection, trimOutSec: 0.2 }).success, false, "Outro trim must have positive range");
assert.equal(sceneTimes(mountain, mountain.scenes[1]!, 43.5).endSec, 15 * (43.5 / 56));
const manualTimeline = setSceneDuration(mountain, mountain.scenes[0]!.id, mountain.scenes[0]!.endSec - mountain.scenes[0]!.startSec + 1);
assert.equal(manualTimeline.scenes[1]!.startSec, mountain.scenes[1]!.startSec + 1, "manual scene resize shifts following scenes without overlap");
assert.equal(manualTimeline.scenes.at(-1)!.endSec, mountain.scenes.at(-1)!.endSec + 1, "manual scene resize preserves downstream durations");
assert.throws(() => setSceneDuration(mountain, "missing-scene", 2), /tidak ditemukan/i);
const appendedSceneInput = { ...mountain.scenes[0]!, id: "scene-added" };
const appendedScene = appendResearchScene(mountain, appendedSceneInput);
assert.deepEqual(appendedScene.scenes.at(-1), { ...mountain.scenes[0]!, id: "scene-added", order: mountain.scenes.at(-1)!.order + 1, startSec: mountain.scenes.at(-1)!.endSec, endSec: mountain.scenes.at(-1)!.endSec + 5 }, "adding scene appends stable content within 120-second limit");
assert.equal(parseResearchPackage(appendedScene).success, true, "appended scene remains a valid Research Package");
assert.throws(() => appendResearchScene(mountain, { ...appendedSceneInput, id: mountain.scenes[0]!.id }), /unik/i, "new scene ID must not collide with existing scene");
const fullDurationMountain = { ...mountain, targetDurationSec: 120, scenes: mountain.scenes.map((scene, index) => index === mountain.scenes.length - 1 ? { ...scene, endSec: 120 } : scene) };
assert.throws(() => appendResearchScene(fullDurationMountain, appendedSceneInput), /batas video/i, "adding scene respects 120-second cap");
const deletedScene = deleteResearchScene(mountain, mountain.scenes[1]!.id);
assert.equal(deletedScene.scenes.some((scene) => scene.id === mountain.scenes[1]!.id), false, "deleting scene removes only selected stable ID");
assert.equal(deletedScene.scenes[1]!.startSec, mountain.scenes[2]!.startSec - (mountain.scenes[1]!.endSec - mountain.scenes[1]!.startSec), "deleting scene closes its time while preserving later scene duration");
assert.deepEqual(deletedScene.scenes.map((scene) => scene.order), deletedScene.scenes.map((_, index) => index + 1), "deleting scene renumbers display order");
assert.equal(parseResearchPackage(deletedScene).success, true, "deleted-scene timeline remains a valid Research Package");
assert.throws(() => deleteResearchScene({ ...mountain, scenes: [mountain.scenes[0]!] }, mountain.scenes[0]!.id), /minimal satu scene/i);
const reordered = reorderResearchScene(mountain, mountain.scenes[1]!.id, 0);
assert.deepEqual(reordered.scenes.map((scene) => scene.id), [mountain.scenes[1]!.id, mountain.scenes[0]!.id, ...mountain.scenes.slice(2).map((scene) => scene.id)], "scene reorder preserves stable IDs and requested order");
assert.deepEqual(reordered.scenes.map((scene) => scene.order), reordered.scenes.map((_, index) => index + 1), "scene reorder normalizes order numbers");
assert.ok(reordered.scenes.every((scene, index) => scene.endSec - scene.startSec === mountain.scenes.find((prior) => prior.id === scene.id)!.endSec - mountain.scenes.find((prior) => prior.id === scene.id)!.startSec), "scene reorder preserves each scene duration");
assert.equal(parseResearchPackage(reordered).success, true, "reordered storyboard remains valid and references stay attached");

const script = narrationScript(mountain);
assert.equal(script, mountain.scenes.map((scene) => scene.narrationText.trim()).join("\n\n"));
assert.ok(!script.includes(mountain.narration), "scene voice script comes from scene narration fields");
const synced = estimateSceneTimings(mountain, 43.27, 150, 1.1);
assert.equal(synced.targetDurationSec, 44);
assert.equal(synced.scenes[0]!.startSec, 0);
assert.equal(synced.scenes.at(-1)!.endSec, 43.27);
assert.ok(synced.scenes.every((scene, index) => scene.endSec > scene.startSec && (index === 0 || scene.startSec === synced.scenes[index - 1]!.endSec)));
assert.equal(sceneTimes(synced, synced.scenes[2]!, 43.27, "estimated").startSec, synced.scenes[2]!.startSec);
assert.equal(timelineDuration(synced, 43.27, "estimated"), 44, "estimated timeline contains ceil target duration");
const beatResearch = structuredClone(mountain);
const beatScene = beatResearch.scenes[0]!;
const beatSceneFrames = Math.floor((beatScene.endSec - beatScene.startSec) * 30);
beatScene.motionActions = [{ id: "retime-beat", kind: "fade", targetNode: "front/0", startFrame: beatSceneFrames - 30, durationFrames: 30, easing: "linear", keyframes: [{ at: 0, opacity: 0 }, { at: 1, opacity: 1 }] }];
const retimedBeats = estimateSceneTimings(beatResearch, 2);
assert.ok(retimedBeats.scenes.every((scene) => scene.motionActions.every((action) => action.startFrame + action.durationFrames <= Math.floor((scene.endSec - scene.startSec) * 30))), "narration retiming keeps canonical Motion Beats inside each new scene duration");
const retimedBoard = retimeVisualStoryboard(mountainStoryboard, mountain, synced);
assert.deepEqual(retimedBoard.scenes.map((scene) => scene.sceneId), mountainStoryboard.scenes.map((scene) => scene.sceneId), "retiming preserves stable visual scene IDs and order");
assert.deepEqual(retimedBoard.scenes.map((scene) => scene.composition), mountainStoryboard.scenes.map((scene) => scene.composition), "retiming preserves authored scene compositions");
assert.ok(retimedBoard.scenes.every((scene) => scene.durationSec === Math.round((synced.scenes.find((item) => item.id === scene.sceneId)!.endSec - synced.scenes.find((item) => item.id === scene.sceneId)!.startSec) * 1000) / 1000), "retiming synchronizes board scene durations");

assert.equal(DEFAULT_TTS_MODEL, "gemini-3.8-flash-lite-tts");
assert.equal(GEMINI_TTS_LOCALES[0]!.locale, "id-ID", "default voice catalog locale should be Bahasa Indonesia");
assert.equal(registeredTemplateIds().length, 8, "every allowlisted template has an explicit renderer");
assert.equal(new Set(Object.values(visualStyles).map((style) => style.palette.canvas)).size, 3, "presets must have distinct palettes");
const motionPlan = (cue: import("../src/domain/visual-composition").MotionCuePlan["cue"]) => ({ cue, targetLayer: "all" as const, delayFrames: 0, durationFrames: 24, easing: "linear" as const });
const still = { opacity: 1, translateX: 0, translateY: 0, scale: 1, reveal: 1 };
const cueState = (cue: import("../src/domain/visual-composition").MotionCuePlan["cue"]) => layerMotion([motionPlan(cue)], "front", 1, 6, .25);
assert.deepEqual(layerMotion([], "front", 1, 6, .25), still, "removing scene cues returns static layer to neutral state");
for (const cue of ["fadeIn", "slide", "scale", "pan", "zoom", "parallax", "reveal", "pulse"] as const) {
  assert.notDeepEqual(cueState(cue), still, `${cue} must alter frame state`);
}
const directionPlan = { ...motionPlan("slide"), direction: "left" as const, intensity: 1.5 };
assert.ok(layerMotion([directionPlan], "front", 1, 6, .25).translateX > 0, "Slide direction moves layer from opposite side toward requested direction");
assert.ok(layerMotion([directionPlan], "front", 1, 6, .25).translateY === 0, "horizontal Slide does not move vertically");
assert.ok(Math.abs(layerMotion([directionPlan], "front", 1, 6, .25).translateX) > Math.abs(layerMotion([motionPlan("slide")], "front", 1, 6, .25).translateY), "motion intensity scales effect distance");
assert.equal(sceneTransitionOpacity([motionPlan("cut")], 0), 1, "cut stays immediate");
assert.ok(sceneTransitionOpacity([motionPlan("dissolve")], 12) > 0 && sceneTransitionOpacity([motionPlan("dissolve")], 12) < 1, "dissolve spans its configured frames");
for (const cue of ["slide-transition", "wipe"] as const) {
  const plan = { ...motionPlan(cue), targetLayer: "scene" as const };
  assert.ok(sceneTransitionOpacity([plan], 12) > 0 && sceneTransitionOpacity([plan], 12) < 1, `${cue} spans configured frames`);
  assert.deepEqual(layerMotion([plan], "front", 1, 6, .25), still, `${cue} is treated as a scene transition, not a layer effect`);
}
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

const vectorDb = new DatabaseSync(":memory:");
vectorDb.exec(aiGenerationSchema);
let vectorCalls = 0;
const vectorProvider: AiGenerationProvider = {
  id: "vector-test", displayName: "Vector test", model: "selected-test-model",
  generate: async (request) => {
    vectorCalls++;
    assert.equal(request.task, "visual-director");
    assert.equal(request.outputFormat, "ai-vector-illustration-v1");
    assert.ok(request.responseSchema, "AI Vector request carries strict structured schema");
    assert.match(request.prompt, /Depict scene visualDescription and narration/);
    assert.match(request.prompt, /Modern 2D cartoon educational explainer/);
    assert.match(request.prompt, /slight squash and stretch/);
    assert.match(request.prompt, /Avoid 3D, photorealism, realistic textures/);
    assert.match(request.prompt, /Do not add visible text/);
    assert.match(request.prompt, /Art direction: clean-flat-2d/);
    assert.doesNotMatch(request.prompt, /white beam of sunlight entering a clearly triangular glass prism/, "generic AI Vector prompt must not force prism topic on unrelated scenes");
    return { text: JSON.stringify(aiVectorFixture), model: "selected-test-model" };
  },
};
const vectorInput: VisualPlannerInput = {
  headline: "SUNGAI MEMBAWA MINERAL KE LAUT", narration: "Sungai membawa mineral terlarut dari batuan menuju laut.",
  visualDescription: "Satu aliran sungai menghubungkan pegunungan dan laut dengan mineral yang bergerak di sepanjang aliran.",
  artDirection: { styleId: "clean-flat-2d", palette: { canvas: "#e8f3ed", surface: "#b8d8d0", primary: "#267a76", accent: "#edaa59", text: "#173740" } },
  visualPlan: { focus: "river", objects: ["river", "mineral", "ocean"], relationships: [{ from: "river", relation: "carries", to: "mineral" }, { from: "river", relation: "flows-to", to: "ocean" }] },
};
const generatedVector = await generateAiVectorIllustration(vectorDb, vectorProvider, vectorInput);
const cachedVector = await generateAiVectorIllustration(vectorDb, vectorProvider, vectorInput);
assert.equal(generatedVector.cached, false);
assert.equal(cachedVector.cached, true, "identical model/input reuses AI Vector specification cache");
assert.equal(vectorCalls, 1, "AI Vector cache skips repeated model call");
assert.equal((vectorDb.prepare("SELECT COUNT(*) AS count FROM ai_generation_attempts").get() as { count: number }).count, 0, "OpenCode AI Vector leaves production request quotas untouched");
vectorDb.close();

const libraryDb = new DatabaseSync(":memory:");
libraryDb.exec(`CREATE TABLE asset_pack_icons (pack TEXT NOT NULL, icon_id TEXT NOT NULL, category TEXT NOT NULL, tags TEXT NOT NULL, package_version TEXT NOT NULL, PRIMARY KEY(pack, icon_id));
  CREATE VIRTUAL TABLE asset_pack_icons_fts USING fts5(icon_id UNINDEXED, category, tags, tokenize='unicode61 remove_diacritics 2');
  CREATE TABLE visual_asset_catalog (asset_id TEXT PRIMARY KEY, metadata_json TEXT NOT NULL, asset_type TEXT NOT NULL, category TEXT NOT NULL, source TEXT NOT NULL, provider TEXT NOT NULL DEFAULT '', style TEXT NOT NULL, format TEXT NOT NULL, license TEXT NOT NULL, available_local INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
  CREATE VIRTUAL TABLE visual_asset_catalog_fts USING fts5(asset_id UNINDEXED, name, tags, concepts, creator, tokenize='unicode61 remove_diacritics 2');`);
indexTablerIcons(libraryDb);
const rainbowIcons = searchTablerIcons(libraryDb, "rainbow", "", 1, 24);
assert.ok(rainbowIcons.total >= 1, "Tabler metadata FTS finds rainbow-related icons");
assert.ok(rainbowIcons.icons.some((icon) => icon.id === "rainbow"), "official rainbow icon appears among matches");
assert.equal(searchTablerIcons(libraryDb, "rainbow", "", 1, 1).icons.length, 1, "Tabler pagination caps icon payload");
assert.match(sanitizedTablerSvg("rainbow"), /^<svg[^>]+><path/);
assert.doesNotMatch(sanitizedTablerSvg("rainbow"), /script|onload|foreignObject|href=/i, "generated Tabler SVG has no script-capable elements or attributes");
assert.throws(() => sanitizedTablerSvg(".."), /ID tidak valid/);
assert.deepEqual(openverseLicenseIds, ["cc0", "pdm", "by", "by-sa"], "Openverse allowlist excludes NC, ND, and unknown licenses");
assert.equal(openverseResultIsCached("unselected-openverse-image"), false, "Openverse import requires an active selected search result");
assert.equal(assetFtsExpression('river " OR *'), '"river"* OR "or"*', "FTS input tokenization cannot inject operators");
for (const address of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.1.2", "172.31.0.1", "192.168.1.4", "198.18.0.1", "::", "::1", "::ffff:192.168.1.2", "fc00::1", "fe80::1", "2001:db8::1", "ff02::1"]) {
  assert.equal(isPublicInternetAddress(address), false, `${address} is blocked from external requests`);
}
for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"]) assert.equal(isPublicInternetAddress(address), true, `${address} is public`);
const catalogAsset = visualAssetSchema.parse({ ...aiImportAsset, source: "user-upload", prompt: undefined });
upsertVisualAssetCatalog(libraryDb, catalogAsset);
assert.equal((libraryDb.prepare("SELECT COUNT(*) AS count FROM visual_asset_catalog_fts WHERE visual_asset_catalog_fts MATCH ?").get(assetFtsExpression("river")) as { count: number }).count, 1, "asset catalog upsert indexes names/tags/concepts for FTS");
libraryDb.close();

console.log(`PASS: ${samples.length} packages; SQLite asset catalog, paginated Tabler pack/SVG sanitization, Openverse license allowlist, SSRF IP blocks, migration/schema/audio, renderer-aware safe area, image signature validation, mocked HF catalog/image generation and consent/quota handling, river/ozone prompt relations, AI Vector schema/cache/render source, semantic planner cache/schema, AI providers/quota, storyboard review gates, render determinism, Gemini TTS guard/cache, timing.`);
