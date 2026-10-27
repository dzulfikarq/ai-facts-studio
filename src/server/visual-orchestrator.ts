import { visualCompositionSchema, type VisualComposition } from "../domain/visual-composition";
import { composeVisualScene, visualRelationshipIsVisible, type CompositionSource, type VisualRelationship } from "../domain/visual-composer";
import type { VisualStoryboard, VisualStoryboardScene } from "../domain/visual-storyboard";
import { visualObjectLibrary } from "../domain/visual-objects";
import type { ReusableSceneInput } from "../domain/asset-library";
import type { VisualAsset } from "../domain/visual-assets";

export type ReusableCandidate = Pick<ReusableSceneInput,
  "name" | "styleId" | "layout" | "compositionType" | "composition" | "tags" | "concepts" | "objects" | "relationships" | "visualFocus" | "assetIds" | "palette" | "motionIntent" | "motionSummary" | "motionPlan" | "provenance"> & {
  id: string;
};

export type SmartVisualResult = {
  source: "reusable-scene" | "asset-library" | "local-composer" | "needs-authoring";
  status: VisualStoryboardScene["authoringStatus"];
  composition?: VisualComposition;
  compositionSource?: CompositionSource;
  illustrationSource?: NonNullable<VisualStoryboardScene["illustrationSource"]>;
  compositionType?: VisualStoryboardScene["compositionType"];
  layout?: VisualStoryboardScene["layout"];
  objects?: VisualStoryboardScene["objects"];
  relationships?: VisualRelationship[];
  visualFocus?: VisualStoryboardScene["visualFocus"];
  illustrationIntent?: string;
  motionIntent?: VisualStoryboardScene["motionIntent"];
  motionSummary?: string;
  missingVisuals: string[];
  warnings: string[];
  assetIds: string[];
  resourceId?: string;
};

const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("id-ID");
const tokens = (value: string) => new Set((normalize(value).match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length > 2));
const unknownLicense = (value: string) => /unspecified|not specified|unknown|no license|created via manual external ai import/i.test(value);
function hasKnownLicense(asset: VisualAsset) {
  if (asset.source === "ai-generated" || unknownLicense(asset.license)) return false;
  if (asset.source === "openverse") return /^(?:CC0|Public Domain Mark|CC BY(?:-SA)?)(?:\s|$)/i.test(asset.license);
  return asset.source === "user-upload";
}

function conceptCoverage(scene: VisualStoryboardScene, descriptions: string[]) {
  const sourceTokens = tokens(`${scene.visualSummary} ${scene.narrationText}`);
  const candidateTokens = tokens(descriptions.join(" "));
  if (!sourceTokens.size) return 0;
  return [...sourceTokens].filter((word) => candidateTokens.has(word)).length / sourceTokens.size;
}

function objectCoverage(scene: VisualStoryboardScene, objects: readonly string[], descriptions: string[]) {
  const declared = new Set(objects);
  const description = normalize(descriptions.join(" "));
  const required = [...new Set([
    ...scene.objects.map((item) => item.objectId),
    ...(scene.semanticPlan?.requiredAssets ?? []),
  ])];
  if (!required.length) return 0;
  const matched = required.filter((id) => declared.has(id) || description.includes(normalize(visualObjectLibrary[id].label)) || description.includes(id));
  return matched.length / required.length;
}

function availableReferences(candidate: ReusableCandidate, assets: readonly VisualAsset[]) {
  const referenced = candidate.assetIds.map((id) => assets.find((asset) => asset.id === id));
  return referenced.every((asset) => Boolean(asset && hasKnownLicense(asset)));
}

function samePalette(left: ReusableCandidate["palette"], right: VisualStoryboard["palette"]) {
  return left.canvas === right.canvas && left.surface === right.surface && left.primary === right.primary && left.accent === right.accent && left.text === right.text;
}

function reusableMatch(scene: VisualStoryboardScene, candidates: readonly ReusableCandidate[], assets: readonly VisualAsset[], storyboard: Pick<VisualStoryboard, "styleId" | "palette">) {
  const requirements = [...scene.relationships];
  const requiredObjectIds = scene.objects.map((item) => item.objectId);
  return candidates.flatMap((candidate) => {
    if (candidate.styleId !== storyboard.styleId || !samePalette(candidate.palette, storyboard.palette) || !candidate.provenance.trim() || !availableReferences(candidate, assets)) return [];
    const candidateObjectIds = candidate.objects.map((item) => item.objectId);
    const objectScore = objectCoverage(scene, candidateObjectIds, [...candidate.tags, ...candidate.concepts, candidate.name]);
    const relationScore = requirements.length
      ? requirements.filter((relation) => candidate.relationships.some((item) => item.from === relation.from && item.relation === relation.relation && item.to === relation.to)
        && visualRelationshipIsVisible(relation, candidate.composition)).length / requirements.length
      : 1;
    if (requiredObjectIds.length && requiredObjectIds.some((id) => !candidateObjectIds.includes(id))) return [];
    if (relationScore !== 1) return [];
    const concepts = conceptCoverage(scene, [candidate.name, ...candidate.tags, ...candidate.concepts]);
    const layoutScore = candidate.compositionType && candidate.compositionType === scene.compositionType ? 1 : candidate.layout === scene.layout ? 1 : 0;
    const score = objectScore * 0.35 + relationScore * 0.4 + concepts * 0.2 + layoutScore * 0.05;
    return score >= 0.82 ? [{ candidate, score }] : [];
  }).sort((a, b) => b.score - a.score)[0]?.candidate;
}

function assetMatch(scene: VisualStoryboardScene, assets: readonly VisualAsset[], styleId: string) {
  // ponytail: raster metadata cannot prove process semantics; never auto-select it when scene has required relationships.
  if (scene.relationships.length || scene.objects.length === 0) return undefined;
  return assets.flatMap((asset) => {
    if (asset.style !== styleId || asset.assetType !== "illustration" || !hasKnownLicense(asset)) return [];
    const descriptions = [asset.name, asset.role, ...asset.semanticTags, ...asset.supportedConcepts];
    const coverage = objectCoverage(scene, [], descriptions);
    const concepts = conceptCoverage(scene, descriptions);
    if (coverage < 1 || concepts < 0.68) return [];
    return [{ asset, score: coverage * 0.55 + concepts * 0.35 + 0.1 }];
  }).sort((a, b) => b.score - a.score)[0]?.asset;
}

function imageComposition(asset: VisualAsset, background: string) {
  return visualCompositionSchema.parse({
    background,
    layers: [{ id: `library-${asset.sha256.slice(0, 12)}`, depth: 0.72, nodes: [{
      type: "image", asset: asset.id, x: 40, y: 510, width: 1000, height: 900, fit: "contain", position: "center",
    }] }],
  });
}

export function prepareSmartVisual(input: {
  scene: VisualStoryboardScene;
  storyboard: Pick<VisualStoryboard, "styleId" | "palette" | "reusableWorldObjects">;
  reusableScenes: readonly ReusableCandidate[];
  assets: readonly VisualAsset[];
}) : SmartVisualResult {
  const { scene, storyboard, reusableScenes, assets } = input;
  const reusable = reusableMatch(scene, reusableScenes, assets, storyboard);
  if (reusable) {
    const usedAssets = reusable.assetIds;
    return {
      source: "reusable-scene", status: "needs_review", composition: reusable.composition,
      compositionSource: "library", illustrationSource: "asset-library",
      compositionType: reusable.compositionType as VisualStoryboardScene["compositionType"],
      layout: reusable.layout as VisualStoryboardScene["layout"], objects: reusable.objects,
      relationships: reusable.relationships, visualFocus: reusable.visualFocus,
      illustrationIntent: reusable.concepts.join(" · ") || reusable.name,
      motionIntent: reusable.motionIntent, motionSummary: reusable.motionSummary,
      missingVisuals: [], assetIds: usedAssets, resourceId: reusable.id,
      warnings: [`Reusable scene “${reusable.name}” dipilih karena objek/proses terstruktur cocok; periksa gaya, makna, dan lisensi sebelum approval.`],
    };
  }

  const illustration = assetMatch(scene, assets, storyboard.styleId);
  if (illustration) return {
    source: "asset-library", status: "needs_review", compositionSource: "library", illustrationSource: "asset-library",
    composition: imageComposition(illustration, storyboard.palette.canvas),
    compositionType: "hero-object-focus", layout: "existing-composition", objects: [], relationships: [], visualFocus: null,
    illustrationIntent: illustration.name, motionIntent: "gentle-reveal", motionSummary: "Reveal ringan pada ilustrasi lokal; periksa crop dan kecocokan.",
    missingVisuals: [], assetIds: [illustration.id], resourceId: illustration.id,
    warnings: [`Ilustrasi lokal “${illustration.name}” cocok menurut metadata objek, konsep, gaya, dan lisensi; konfirmasi kecocokan visual secara manual.`],
  };

  const composed = composeVisualScene({
    headline: scene.headline, narration: scene.narrationText, visualDescription: scene.visualSummary,
    artDirection: { styleId: storyboard.styleId, palette: storyboard.palette },
    sceneVisualFocus: scene.visualFocus, illustrationIntent: scene.illustrationIntent,
    existingVisualPlan: { objects: scene.objects.map((item) => item.objectId), relationships: scene.relationships, source: scene.compositionSource },
    existingComposition: scene.composition, semanticPlan: scene.semanticPlan,
    sharedWorldObjects: storyboard.reusableWorldObjects, assetLibrary: visualObjectLibrary, preserveExisting: false,
  });
  if (composed.composition) return {
    source: "local-composer", status: composed.status, composition: composed.composition,
    compositionSource: composed.compositionSource,
    illustrationSource: composed.compositionSource === "ai-vector" ? "ai-vector" : composed.compositionSource === "manual" ? "manual" : "procedural",
    compositionType: composed.compositionType as VisualStoryboardScene["compositionType"],
    layout: composed.compositionType ?? (composed.compositionSource === "procedural" ? "procedural-scene" : "existing-composition"),
    objects: composed.objects.map((id) => ({ objectId: id, assetId: id, role: visualObjectLibrary[id].role, label: visualObjectLibrary[id].label })),
    relationships: composed.relationships, visualFocus: composed.focus, illustrationIntent: composed.illustrationIntent,
    motionIntent: scene.motionIntent, motionSummary: scene.motionSummary, missingVisuals: composed.missingVisuals,
    assetIds: [], warnings: composed.warnings,
  };
  return {
    source: "needs-authoring", status: "needs_visual_authoring", missingVisuals: composed.missingVisuals,
    assetIds: [], warnings: ["Smart Hybrid tidak menemukan ilustrasi yang cukup relevan. Coba AI Vector yang sesuai, Asset Library, AI Image berizin, atau upload."],
  };
}
