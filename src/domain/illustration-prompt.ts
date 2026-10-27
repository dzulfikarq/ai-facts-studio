import type { ResearchPackage } from "./research";
import type { VisualStoryboard, VisualStoryboardScene } from "./visual-storyboard";
import { visualObjectLibrary } from "./visual-objects";
import { defaultGoogleFlowStyleLock, type GoogleFlowStyleLock } from "./google-flow";

export function buildIllustrationPrompt({ research, storyboard, scene, styleLock, previousReference }: {
  research: ResearchPackage;
  storyboard: VisualStoryboard;
  scene: VisualStoryboardScene;
  styleLock?: GoogleFlowStyleLock;
  previousReference?: { sceneNumber: number; name: string; style: string };
}) {
  const lock = styleLockFor(styleLock ?? storyboard.styleLock);
  const objectLabels = scene.objects.map((object) => `${object.label} (${object.role})`);
  const labelsById = new Map(scene.objects.map((object) => [object.objectId, object.label]));
  const relationships = scene.relationships.map((relation) => `${labelsById.get(relation.from) ?? relation.from} ${relation.relation} ${labelsById.get(relation.to) ?? relation.to}`);
  const focus = scene.visualFocus ? visualObjectLibrary[scene.visualFocus].label : scene.illustrationIntent;
  const palette = Object.entries(storyboard.palette).map(([name, color]) => `${name} ${color}`).join(", ");
  const semantic = scene.semanticPlan;
  return [
    `Create exactly one finished still illustration for one educational short-video scene. Style: ${lock.illustrationStyle}. Portrait 9:16. This is one full-scene illustration, never a multi-panel storyboard or collage.`,
    `Video topic: ${research.title}.`,
    `Broader project scientific context (background only; include only facts relevant to this scene and do not combine separate mechanisms): ${research.narration}`,
    `Scene headline (context only; do not render as text): ${scene.headline}.`,
    `Scene narration (scientific meaning to depict, not words to print): ${scene.narrationText}`,
    `Scene visual description: ${scene.visualSummary}`,
    `Primary visual concept: ${semantic?.primaryVisualConcept ?? focus}.`,
    `Visual focus: ${focus}.`,
    `Objects and roles: ${objectLabels.length ? objectLabels.join("; ") : "Use only concrete objects stated in scene narration and visual description."}`,
    `Required relationships and direction: ${relationships.length ? relationships.join("; ") : semantic?.relationships.map((relation) => `${relation.from} ${relation.relation} ${relation.to}`).join("; ") || "Show only relationships explicitly supported by the scene narration and description; do not invent scientific processes."}`,
    `Environment: ${semantic?.environment ?? "Use the environment explicitly described by the scene; do not invent a contradictory setting."}`,
    `Scientific process/explanation: ${semantic?.processAction ?? scene.narrationText}. Preserve scale, cause-and-effect, and spatial relationships accurately; do not add unsupported science.`,
    `Project visual palette: ${palette}. Global palette lock: ${lock.colorPalette}.`,
    `Global lighting lock: ${lock.lighting}.`,
    `Global complexity lock: ${lock.visualComplexity}.`,
    `Global outline/shape lock: ${lock.outlineShapeStyle}.`,
    `Global composition lock: ${lock.compositionGuidelines}.`,
    `Cross-scene consistency lock: ${lock.consistencyInstructions}`,
    "Render attractive, detailed, premium editorial 2D artwork with a clear focal point and cohesive foreground, midground, and background. Keep the educational subject visually rich but legible at phone size. Use one connected environment, not generic icon cards or unrelated floating objects.",
    "Portrait 9:16 for YouTube Shorts, Reels, and TikTok. Keep headline-safe space in the upper area and subtitle-safe space in the lower area; keep essential subject details inside central safe area. Do not add typography because AI Facts Studio renders headline and subtitles separately.",
    "NEGATIVE INSTRUCTIONS: no text, letters, labels, captions, subtitles, or scene numbering; no watermark or logo; no collage; no multi-panel storyboard, split screen, or comic panels; no generic icon cards or UI panels; no oversized empty background or unrelated detached icons; no scientifically incorrect scale/relationships or invented causal steps.",
    lock.referenceAssetIds.length ? `Project visual reference asset IDs: ${lock.referenceAssetIds.join(", ")}. These are stored locally only and are NOT attached to Google Flow. Upload them manually to Flow as visual references if useful; use them only for style/palette, never copy their subject.` : "No project reference image attached. Text-only style consistency is approximate and cannot guarantee identical output across scenes.",
    previousReference
      ? `Optional previous-scene style reference: scene ${previousReference.sceneNumber}, “${previousReference.name}”, style ${previousReference.style}. If manually supplied to Flow, use only as a palette, lighting, outline, and texture guide; do not copy its subject. Consistency is approximate, not guaranteed.`
      : "Use project Style Lock; visual consistency across independent generations is approximate, not guaranteed.",
  ].join("\n\n");
}

function styleLockFor(styleLock?: GoogleFlowStyleLock) {
  return styleLock ?? defaultGoogleFlowStyleLock;
}
