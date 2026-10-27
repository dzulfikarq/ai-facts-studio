import type { ResearchPackage } from "./research";
import type { VisualStoryboard, VisualStoryboardScene } from "./visual-storyboard";
import { visualObjectLibrary } from "./visual-objects";

export function buildIllustrationPrompt({ research, storyboard, scene, previousReference }: {
  research: ResearchPackage;
  storyboard: VisualStoryboard;
  scene: VisualStoryboardScene;
  previousReference?: { sceneNumber: number; name: string; prompt?: string; style: string };
}) {
  const objectLabels = scene.objects.map((object) => `${object.label} (${object.role})`);
  const labelsById = new Map(scene.objects.map((object) => [object.objectId, object.label]));
  const relationships = scene.relationships.map((relation) => `${labelsById.get(relation.from) ?? relation.from} ${relation.relation} ${labelsById.get(relation.to) ?? relation.to}`);
  const focus = scene.visualFocus ? visualObjectLibrary[scene.visualFocus].label : scene.illustrationIntent;
  const palette = Object.entries(storyboard.palette).map(([name, color]) => `${name} ${color}`).join(", ");
  return [
    "Create one polished 2D editorial illustration for a short educational video, portrait 9:16.",
    `Video topic: ${research.title}.`,
    `Scene narration (meaning to depict, not text to print): ${scene.narrationText}`,
    `Scene visual direction: ${scene.visualSummary}`,
        `Primary visual focus: ${focus}.`,
        `Important scene objects and roles: ${objectLabels.length ? objectLabels.join("; ") : "Use the concrete objects and relationships explicitly described in the narration and visual direction."}`,
        `Required spatial relationships and direction: ${relationships.length ? relationships.join("; ") : "Infer only relationships stated in the narration and visual direction; do not invent extra processes."}`,
        `Art direction: ${storyboard.styleId}; ${storyboard.typographyIntent.heading}; ${storyboard.typographyIntent.body}. Keep shapes, outlines, shading, and texture consistent across project scenes.`,
        `Project palette: ${palette}. Use palette as guidance, not as a requirement to color every object identically.`,
        "Use polished flat 2D editorial illustration: clear silhouettes, restrained geometric detail, consistent outline weight, subtle depth, and one cohesive environment. Build one coherent scene; show each required relationship and movement direction spatially. Use an integrated landscape for connected geography or flow; avoid unrelated isolated objects.",
        "Compose for a vertical 9:16 canvas. Leave upper 25% and lower 22% visually quiet for separately-rendered headline and subtitle; keep primary subject in central safe area.",
    "No words, letters, labels, captions, numbers, watermark, logos, icon grids, card layouts, UI panels, or detached generic icons. Do not bake headline/subtitle into image; Remotion renders those separately.",
    previousReference
      ? `Optional consistency reference: use previous scene ${previousReference.sceneNumber} illustration (${previousReference.name}, style ${previousReference.style}) only as a guide for palette, shape language, outlines, and texture; do not copy its subject. Prior prompt: ${previousReference.prompt ?? "not recorded"}. Visual consistency is approximate, not guaranteed.`
        : "Use project art direction for consistency. No image reference is attached to this text-only request; consistency is approximate, not guaranteed.",
  ].join("\n\n");
}
