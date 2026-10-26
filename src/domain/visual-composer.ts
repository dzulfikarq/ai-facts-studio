import { visualCompositionSchema, type VisualComposition } from "./visual-composition";
import { directIllustration, proceduralIllustration, type IllustrationType } from "./illustration-library";
import { visualObjectLibrary, visualObjectsForText, type ObjectDefinition, type VisualObjectId } from "./visual-objects";
import type { VisualSemanticPlan } from "./visual-semantic-plan";

export const visualRelationshipKinds = ["flows-to", "carries", "erodes", "evaporates-from", "contains", "filters", "deflects", "illuminates", "falls-on"] as const;
export type VisualRelationshipKind = typeof visualRelationshipKinds[number];
export type VisualRelationship = { from: VisualObjectId; relation: VisualRelationshipKind; to: VisualObjectId };
export type CompositionSource = "existing" | "library" | "procedural" | "manual";
export type VisualAuthoringStatus = "ready_for_review" | "needs_review" | "needs_visual_authoring";
export type VisualPlan = { objects: VisualObjectId[]; relationships: VisualRelationship[]; source?: CompositionSource; status?: VisualAuthoringStatus; authoringConfirmed?: boolean; approved?: boolean };

type ArtDirection = { styleId: string; palette: { canvas: string; surface: string; primary: string; accent: string; text: string } };
type ComposerInput = {
  narration: string;
  visualDescription: string;
  headline: string;
  artDirection: ArtDirection;
  sceneVisualFocus: VisualObjectId | null;
  illustrationIntent: string;
  existingVisualPlan?: VisualPlan;
  existingComposition?: VisualComposition;
  sharedWorldObjects: readonly VisualObjectId[];
  assetLibrary: Readonly<Record<VisualObjectId, ObjectDefinition>>;
  preserveExisting?: boolean;
  semanticPlan?: VisualSemanticPlan;
};
export type ComposedVisual = {
  composition?: VisualComposition;
  compositionType?: IllustrationType;
  compositionSource: CompositionSource;
  status: VisualAuthoringStatus;
  objects: VisualObjectId[];
  focus: VisualObjectId | null;
  relationships: VisualRelationship[];
  illustrationIntent: string;
  missingVisuals: string[];
  warnings: string[];
};

const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("id-ID");
const layerAliases: Record<VisualObjectId, string[]> = {
  sun: ["sun", "sunlight"], earth: ["earth-world"], atmosphere: ["atmosphere", "earth-world"],
  "ozone-layer": ["ozone"], "uv-rays": ["uv-rays"], "charged-particles": ["charged-particles"],
  magnetosphere: ["magnetic-field"], rain: ["rain"], rock: ["rock", "geological-layers"],
  mineral: ["mineral", "salt-ions"], river: ["river"], ocean: ["ocean", "ocean-horizon", "coast-and-ocean"],
  evaporation: ["water-vapor"], "salt-crystal": ["salt-ions", "mineral"], mountain: ["mountain", "mountains"],
  volcano: ["volcano"], magma: ["magma", "volcano"], "tectonic-plates": ["tectonic-plates"], lightning: ["lightning", "storm-cloud"],
  cloud: ["cloud", "rain", "clouds"], "water-cycle": ["water-vapor", "ocean", "cloud", "river"], planet: ["earth-world", "planet"], bear: ["bear", "ice-hills"],
};

function hasLayer(composition: VisualComposition, ids: VisualObjectId[]) {
  const layers = composition.layers.map((layer) => layer.id);
  return ids.some((id) => layerAliases[id].some((alias) => layers.some((layer) => layer === alias || layer.includes(alias))));
}

export function compositionShowsObject(composition: VisualComposition, objectId: VisualObjectId, library = visualObjectLibrary) {
  if (hasLayer(composition, [objectId])) return true;
  const iconId = library[objectId].icon;
  const nodes = composition.layers.flatMap((layer) => layer.nodes.flatMap((node) => node.type === "group" ? node.children : [node]));
  if (nodes.some((node) => node.type === "icon" && node.icon === iconId)) return true;
  const label = normalize(library[objectId].label);
  return nodes.some((node) => node.type === "text" && normalize(node.text).includes(label));
}

export function hasGenericIconCards(composition: VisualComposition) {
  return composition.layers.some((layer) => {
    const nodes = layer.nodes.flatMap((node) => node.type === "group" ? node.children : [node]);
    return nodes.some((card) => card.type === "shape" && card.shape === "rect" && card.width >= 280 && card.height >= 140
      && nodes.some((icon) => icon.type === "icon" && icon.x >= card.x && icon.y >= card.y && icon.x + icon.width <= card.x + card.width && icon.y + icon.height <= card.y + card.height)
      && nodes.some((label) => label.type === "text" && label.x >= card.x && label.y >= card.y && label.x + label.width <= card.x + card.width && label.y + label.height <= card.y + card.height));
  });
}

export function visualObjectsForTextInPlan(text: string, library: Readonly<Record<VisualObjectId, ObjectDefinition>> = visualObjectLibrary): VisualObjectId[] {
  return visualObjectsForText(text).filter((objectId) => Boolean(library[objectId]));
}

export function deriveVisualRelationships(text: string, ids: readonly VisualObjectId[]): VisualRelationship[] {
  const copy = normalize(text);
  const has = (...objects: VisualObjectId[]) => objects.every((object) => ids.includes(object));
  const relations: VisualRelationship[] = [];
  if (has("river", "ocean") && /bawa|membawa|mengalir|menuju|bermuara|flows?/.test(copy)) relations.push({ from: "river", relation: "flows-to", to: "ocean" });
  if (has("river", "mineral") && /bawa|membawa|mengangkut|mengalir|terlarut|carry/.test(copy)) relations.push({ from: "river", relation: "carries", to: "mineral" });
  if (has("rain", "rock") && /lapuk|pelapuk|mengikis|rekah|erod/.test(copy)) relations.push({ from: "rain", relation: "erodes", to: "rock" });
  if (has("ocean", "evaporation") && /(?:menguapkan|menguap).{0,45}(?:laut|permukaan)|(?:laut|permukaan).{0,45}menguap|\buap\b.{0,35}(?:naik|dari|permukaan)|penguapan.{0,25}dari (?:laut|permukaan)|evaporat.{0,40}from/.test(copy)) {
    relations.push({ from: "evaporation", relation: "evaporates-from", to: "ocean" });
  }
  if (has("ocean", "salt-crystal") && /terlarut|garam|salinitas|mengandung/.test(copy)) relations.push({ from: "ocean", relation: "contains", to: "salt-crystal" });
  const filter = ids.includes("ozone-layer") ? "ozone-layer" : ids.includes("atmosphere") ? "atmosphere" : null;
  if (filter && has(filter, "uv-rays") && /serap|menyerap|menahan|filter|menyaring|saring|absorb/.test(copy)) relations.push({ from: filter, relation: "filters", to: "uv-rays" });
  if (has("magnetosphere", "charged-particles") && /belok|membelok|arah|mengarah|lindung|deflect/.test(copy)) relations.push({ from: "magnetosphere", relation: "deflects", to: "charged-particles" });
  if (has("sun", "earth") && /sinar|cahaya|energi|menuju|menerima|terpapar|illuminat/.test(copy)) relations.push({ from: "sun", relation: "illuminates", to: "earth" });
  if (has("rain", "mountain") && /hujan|jatuh|turun|rain/.test(copy)) relations.push({ from: "rain", relation: "falls-on", to: "mountain" });
  return relations;
}

export function visualRelationshipIsVisible(relationship: VisualRelationship, composition: VisualComposition) {
  const has = (...objects: VisualObjectId[]) => objects.every((object) => compositionShowsObject(composition, object));
  const layerNodes = (id: string) => composition.layers.filter((layer) => layer.id === id || layer.id.includes(id)).flatMap((layer) => layer.nodes.flatMap((node) => node.type === "group" ? node.children : [node]));
  const hasPath = (id: string) => layerNodes(id).some((node) => node.type === "path");
  const hasMotion = (id: string, motion: string) => layerNodes(id).some((node) => "motion" in node && node.motion === motion);
  switch (relationship.relation) {
    case "flows-to": return has("river", "ocean") && hasPath("river");
    case "carries": return has("river", "mineral") && hasPath("river");
    case "erodes": return has("rain", "rock") && hasMotion("rain", "fall") && hasPath("rock");
    case "evaporates-from": return has("ocean", "evaporation") && hasMotion("water-vapor", "rise");
    case "contains": return has("ocean", "salt-crystal") && layerNodes("salt-ions").some((node) => node.type === "shape" && (node.shape === "circle" || node.shape === "ellipse"));
    case "filters": return has(relationship.from, "uv-rays") && (relationship.from === "ozone-layer" || relationship.from === "atmosphere") && hasPath("uv-rays");
    case "deflects": return has("magnetosphere", "charged-particles") && hasPath("magnetic-field") && hasMotion("charged-particles", "flow");
    case "illuminates": return has("sun", "earth") && hasPath("sunlight");
    case "falls-on": return has("rain", "mountain") && hasMotion("rain", "fall");
  }
}

export function composeVisualScene(input: ComposerInput): ComposedVisual {
  const copy = `${input.headline} ${input.narration} ${input.visualDescription} ${input.semanticPlan ? `${input.semanticPlan.environment} ${input.semanticPlan.processAction}` : ""}`;
  const detected = input.semanticPlan?.objects ?? visualObjectsForTextInPlan(copy, input.assetLibrary);
  const shared = [...new Set(input.sharedWorldObjects)];
  const existingPlan = input.existingVisualPlan;
  const isManual = existingPlan?.source === "manual" || existingPlan?.authoringConfirmed === true;
  const existingRelationships = input.semanticPlan?.relationships ?? deriveVisualRelationships(copy, detected);
  const relevantExisting = Boolean(input.existingComposition && !hasGenericIconCards(input.existingComposition) && detected.length > 0
    && detected.every((id) => compositionShowsObject(input.existingComposition!, id, input.assetLibrary))
    && existingRelationships.every((relationship) => visualRelationshipIsVisible(relationship, input.existingComposition!)));
  const canReuse = Boolean(input.existingComposition && input.preserveExisting && (isManual || existingPlan?.approved || relevantExisting));
  if (canReuse && input.existingComposition) {
    const staleCopy = Boolean(existingPlan?.approved && !isManual);
    return {
      composition: input.existingComposition,
      compositionType: undefined,
      compositionSource: isManual ? "manual" : existingPlan?.source ?? "existing",
      status: staleCopy || (isManual && existingPlan?.status !== "ready_for_review") ? "needs_review" : existingPlan?.status ?? "ready_for_review",
      objects: existingPlan?.objects ?? detected,
      focus: input.semanticPlan?.visualFocus ?? input.sceneVisualFocus ?? existingPlan?.objects[0] ?? detected[0] ?? null,
      relationships: input.semanticPlan?.relationships ?? existingPlan?.relationships ?? deriveVisualRelationships(copy, [...new Set([...detected, ...shared])]),
      illustrationIntent: input.illustrationIntent || "Pertahankan komposisi scene yang sudah dibuat; periksa kembali hubungan visual setelah perubahan narasi.",
      missingVisuals: [],
      warnings: staleCopy || isManual ? ["Komposisi sebelumnya dipertahankan; periksa kecocokannya dengan narasi terbaru sebelum approval."] : [],
    };
  }

  const world = [...new Set([...shared, ...detected])];
  const planObjects = [...new Set([...detected, ...(existingPlan?.objects ?? []).filter((id) => detected.includes(id))])];
  // ponytail: shared-world objects provide visual context, never evidence for relations absent from this scene.
  const plannedRelationships = input.semanticPlan?.relationships ?? deriveVisualRelationships(copy, planObjects);
  const exact = directIllustration(planObjects, world, copy);
  const generated = exact ?? proceduralIllustration(planObjects, world, copy, input.semanticPlan?.visualFocus ?? input.sceneVisualFocus);
  if (!generated) {
    const missing = detected.length ? detected.filter((object) => !input.assetLibrary[object]).map((object) => object) : [];
    return {
      compositionSource: "procedural", status: "needs_visual_authoring", objects: detected, focus: input.semanticPlan?.visualFocus ?? input.sceneVisualFocus ?? detected[0] ?? null,
      relationships: plannedRelationships, illustrationIntent: input.illustrationIntent || "Konsep inti belum memiliki representasi visual yang cukup akurat di library lokal.",
      missingVisuals: missing.length ? missing.map((object) => input.assetLibrary[object].label) : [detected.length ? "Hubungan/proses scene belum memiliki ilustrasi yang sesuai." : "Konsep inti belum dikenali library visual lokal."],
      warnings: ["Visual belum dibuat; jangan mengganti dengan ikon generik."],
    };
  }

  const composition = visualCompositionSchema.parse({ ...generated.composition, background: input.artDirection.palette.canvas });
  const isVisualObjectId = (object: string): object is VisualObjectId => Object.hasOwn(input.assetLibrary, object);
  const objects = [...new Set([...generated.objects.filter(isVisualObjectId), ...(input.semanticPlan?.objects ?? [])])];
  const requiredObjects = input.semanticPlan?.requiredAssets ?? [];
  const missingObjects = [...new Set([...objects, ...requiredObjects])].filter((object) => !compositionShowsObject(composition, object, input.assetLibrary));
  const missingRelations = plannedRelationships.filter((relationship) => !visualRelationshipIsVisible(relationship, composition));
  const missingVisuals = [
    ...missingObjects.map((object) => input.assetLibrary[object].label),
    ...missingRelations.map((relationship) => `${relationship.from} ${relationship.relation} ${relationship.to}`),
  ];
  const needsAuthoring = missingObjects.length > 0 || missingRelations.length > 0;
  const status: VisualAuthoringStatus = needsAuthoring ? "needs_visual_authoring" : exact ? "ready_for_review" : "needs_review";
  const focusObject = generated.focus as VisualObjectId;
  return {
    composition,
    compositionType: generated.type,
    compositionSource: exact ? "library" : "procedural",
    status,
    objects,
    focus: focusObject,
    relationships: plannedRelationships,
    illustrationIntent: generated.intent || input.illustrationIntent || `Ilustrasikan ${input.assetLibrary[focusObject].label.toLocaleLowerCase("id-ID")} dalam satu lingkungan visual yang relevan.`,
    missingVisuals,
    warnings: [
      ...(input.semanticPlan && input.semanticPlan.compositionType !== generated.type ? [`AI menyarankan ${input.semanticPlan.compositionType}; composer lokal memilih ${generated.type} agar cocok dengan ilustrasi yang tersedia.`] : []),
      ...(status === "needs_review" ? ["Komposisi prosedural tersedia; tinjau kecocokan scene sebelum approval."]
        : status === "needs_visual_authoring" ? ["Objek/relasi penting belum tampak cukup jelas; author visual sebelum approval."] : []),
    ],
  };
}
