import type { ResearchPackage } from "./research";
import type { VisualStoryboard, VisualStoryboardScene } from "./visual-storyboard";
import { visualObjectLibrary } from "./visual-objects";
import { defaultGoogleFlowStyleLock, type GoogleFlowStyleLock } from "./google-flow";

export const baseVisualStylePrompt = "Modern 2D cartoon educational explainer; clean outlines, soft rounded shapes, lively and expressive friendly visuals, bright but balanced colors, simple clean backgrounds, minimal texture and shading, clear and easy to understand.";
export const baseAnimationStylePrompt = "Smooth 2D motion with subtle bounce, slight squash and stretch, gentle secondary motion; expressive but controlled, readable educational pacing, never chaotic or overly cinematic.";
export const baseCompositionPrompt = "Vertical 9:16, mobile-first, one clear main subject, strong visual focus, simple composition, mostly fixed camera; slight pan or zoom only when useful, no dramatic camera rotations.";
export const baseNegativeVisualPrompt = "Avoid 3D, photorealism, realistic textures, CGI look, cinematic realism, overly detailed backgrounds, and clutter. No text on screen, subtitles, logos, or watermarks.";

export function buildIllustrationPrompt({ research, storyboard, scene, styleLock, previousReference, mode = "still-image" }: {
  research: ResearchPackage;
  storyboard: VisualStoryboard;
  scene: VisualStoryboardScene;
  styleLock?: GoogleFlowStyleLock;
  previousReference?: { sceneNumber: number; name: string; style: string };
  mode?: "still-image" | "animated-video";
}) {
  const lock = styleLockFor(styleLock ?? storyboard.styleLock);
  const objectLabels = scene.objects.map((object) => `${object.label} (${object.role})`);
  const labelsById = new Map(scene.objects.map((object) => [object.objectId, object.label]));
  const relationships = scene.relationships.map((relation) => `${labelsById.get(relation.from) ?? relation.from} ${relation.relation} ${labelsById.get(relation.to) ?? relation.to}`);
  const focus = scene.visualFocus ? visualObjectLibrary[scene.visualFocus].label : scene.illustrationIntent;
  const palette = Object.entries(storyboard.palette).map(([name, color]) => `${name} ${color}`).join(", ");
  const semantic = scene.semanticPlan;
  return [
    mode === "animated-video"
      ? "Create one continuous animated video clip for one educational short-video scene. Keep subject, environment, palette, and character design consistent throughout."
      : "Create exactly one finished still illustration for one educational short-video scene. This is one full-scene illustration, never a multi-panel storyboard or collage.",
    `Scene topic: ${research.title}.`,
    `Broader project scientific context (background only; include only facts relevant to this scene and do not combine separate mechanisms): ${research.narration}`,
    `Scene headline (context only; do not render as text): ${scene.headline}.`,
    `Scene narration (scientific meaning to depict, not words to print): ${scene.narrationText}`,
    `Scene visual description: ${scene.visualSummary}`,
    `Primary visual concept: ${semantic?.primaryVisualConcept ?? focus}.`,
    `Main subject and visual focus: ${focus}.`,
    `Objects and roles: ${objectLabels.length ? objectLabels.join("; ") : "Use only concrete objects stated in scene narration and visual description."}`,
    `Required relationships and direction: ${relationships.length ? relationships.join("; ") : semantic?.relationships.map((relation) => `${relation.from} ${relation.relation} ${relation.to}`).join("; ") || "Show only relationships explicitly supported by the scene narration and description; do not invent scientific processes."}`,
    `Background and environment: ${semantic?.environment ?? "Use the environment explicitly described by the scene; do not invent a contradictory setting."}`,
    `Main action and scientific process: ${semantic?.processAction ?? scene.narrationText}. Preserve scale, cause-and-effect, and spatial relationships accurately; do not add unsupported science.`,
    ...(mode === "animated-video" ? [
      `Subject continuity: Keep ${focus} identity, shape, materials, and position coherent for the whole shot.`,
      `Primary motion: Animate ${semantic?.processAction ?? scene.narrationText} with clear direction and gradual cause-and-effect; do not substitute camera movement for subject motion.`,
      `Beginning-to-ending change: Begin with the process in its initial state; show the stated action progressing in visible stages; end with the described result. Do not add a new scene or unsupported event.`,
    ] : []),
    `Project visual palette: ${palette}. Global palette lock: ${lock.colorPalette}.`,
    `Visual style: ${baseVisualStylePrompt} Project style lock: ${lock.illustrationStyle}; ${lock.outlineShapeStyle}. Required 2D cartoon style takes priority if project wording conflicts.`,
    `Animation style: ${baseAnimationStylePrompt}${mode === "still-image" ? " For this still image, use a lively readable pose; motion guidance applies only if image is animated later." : ""}`,
    `Composition and camera: ${baseCompositionPrompt} Project framing lock: ${lock.compositionGuidelines} Required 9:16 framing and restrained-camera rules take priority if project wording conflicts. Keep essential details in the central safe area, with upper and lower space for separately rendered headline and subtitles.`,
    `Lighting and complexity: ${lock.lighting} ${lock.visualComplexity} Required minimal shading and simple-background rules take priority if project wording conflicts.`,
    `Cross-scene consistency lock (supporting guidance): ${lock.consistencyInstructions} Follow where compatible with required 2D style.`,
    "Keep one connected environment and one clear educational focal point; make the subject legible at phone size. Do not use generic icon cards or unrelated floating objects. AI Facts Studio renders headline and subtitles separately.",
    mode === "animated-video"
      ? `NEGATIVE INSTRUCTIONS: ${baseNegativeVisualPrompt} No captions, labels, split panels, abrupt scene changes, unnecessary camera movement, unrelated actions, unexplained object morphing, or scientifically incorrect scale/relationships and invented causal steps.`
      : `NEGATIVE INSTRUCTIONS: ${baseNegativeVisualPrompt} No letters, labels, scene numbering, collage, multi-panel storyboard, split screen, comic panels, generic icon cards, UI panels, oversized empty backgrounds, unrelated detached icons, scientifically incorrect scale/relationships, or invented causal steps.`,
    lock.referenceAssetIds.length ? `Project visual reference asset IDs: ${lock.referenceAssetIds.join(", ")}. These are stored locally only and are NOT attached to Google Flow. Upload them manually to Flow as visual references if useful; use them only for style/palette, never copy their subject.` : "No project reference image attached. Text-only style consistency is approximate and cannot guarantee identical output across scenes.",
    previousReference
      ? `Optional previous-scene style reference: scene ${previousReference.sceneNumber}, “${previousReference.name}”, style ${previousReference.style}. If manually supplied to Flow, use only as a palette, lighting, outline, and texture guide; do not copy its subject. Consistency is approximate, not guaranteed.`
      : "Use project Style Lock; visual consistency across independent generations is approximate, not guaranteed.",
  ].join("\n\n");
}

function styleLockFor(styleLock?: GoogleFlowStyleLock) {
  return styleLock ?? defaultGoogleFlowStyleLock;
}
