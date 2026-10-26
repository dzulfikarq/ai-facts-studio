import { z } from "zod";
import type { ResearchPackage } from "./research";
import { defaultMotionPlan } from "./visual-defaults";
import { visualCompositionSchema, type VisualComposition } from "./visual-composition";
import { renderedVisualBounds } from "./visual-geometry";
import { layerMotion } from "../video/motion";
import { composeVisualScene, compositionShowsObject, hasGenericIconCards, visualRelationshipIsVisible, visualRelationshipKinds, type VisualRelationship, type VisualAuthoringStatus } from "./visual-composer";
import { visualObjectIds, visualObjectLibrary, visualObjectsForText, type VisualObjectId } from "./visual-objects";
import { visualSemanticPlanSchema, type VisualSemanticPlan } from "./visual-semantic-plan";

export { visualObjectIds, visualObjectLibrary, visualObjectsForText } from "./visual-objects";
export type { VisualObjectId } from "./visual-objects";

const objectIdSchema = z.enum(visualObjectIds);
const colorHex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
type ApprovalInput = {
  sceneId: string; durationSec: number; headline: string; narrationText: string; visualSummary: string;
  layout: string; compositionType?: string; objects: Array<{ objectId: string; assetId: string; role: string; label: string }>;
  visualFocus: string | null; relationships: VisualRelationship[]; illustrationIntent: string; motionIntent: string; motionSummary: string;
  composition: VisualComposition; compositionSource: string; authoringStatus: string; authoringConfirmed: boolean; missingVisuals: string[];
  semanticPlan?: VisualSemanticPlan;
};
function fingerprint(content: string) {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index++) hash = Math.imul(hash ^ content.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
export function visualApprovalFingerprint(scene: ApprovalInput) {
  return fingerprint(JSON.stringify({
    sceneId: scene.sceneId, durationSec: scene.durationSec, headline: scene.headline, narrationText: scene.narrationText,
    visualSummary: scene.visualSummary, layout: scene.layout, compositionType: scene.compositionType, objects: scene.objects, relationships: scene.relationships,
    visualFocus: scene.visualFocus, illustrationIntent: scene.illustrationIntent, motionIntent: scene.motionIntent,
    motionSummary: scene.motionSummary, composition: scene.composition, compositionSource: scene.compositionSource,
    authoringStatus: scene.authoringStatus, authoringConfirmed: scene.authoringConfirmed, missingVisuals: scene.missingVisuals,
    semanticPlan: scene.semanticPlan,
  }));
}
export function legacyVisualApprovalFingerprint(scene: ApprovalInput) {
  return fingerprint(JSON.stringify({
    sceneId: scene.sceneId, durationSec: scene.durationSec, headline: scene.headline, narrationText: scene.narrationText,
    visualSummary: scene.visualSummary, layout: scene.layout, compositionType: scene.compositionType, objects: scene.objects,
    visualFocus: scene.visualFocus, illustrationIntent: scene.illustrationIntent, motionIntent: scene.motionIntent,
    motionSummary: scene.motionSummary, composition: scene.composition, authoringStatus: scene.authoringStatus,
    authoringConfirmed: scene.authoringConfirmed,
  }));
}

const storyboardObjectSchema = z.object({
  objectId: objectIdSchema,
  assetId: objectIdSchema,
  role: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(80),
}).strict().refine((object) => object.objectId === object.assetId, "Asset harus berasal dari library visual internal.");
const visualRelationshipSchema = z.object({ from: objectIdSchema, relation: z.enum(visualRelationshipKinds), to: objectIdSchema }).strict();

export const visualStoryboardSceneSchema = z.object({
  sceneId: z.string().trim().min(1).max(100),
  sceneNumber: z.number().int().positive().max(30),
  durationSec: z.number().positive().max(120),
  headline: z.string().trim().min(1).max(120),
  narrationText: z.string().max(2000),
  visualSummary: z.string().trim().min(1).max(500),
  layout: z.enum(["two-column-object-grid", "existing-composition", "procedural-scene", "full-landscape", "cross-section", "hero-object-focus", "step-by-step-process", "before-and-after", "connected-environment", "scientific-diagram"]),
  compositionType: z.enum(["full-landscape", "cross-section", "hero-object-focus", "step-by-step-process", "before-and-after", "connected-environment", "scientific-diagram"]).optional(),
  objects: z.array(storyboardObjectSchema).max(12),
  semanticPlan: visualSemanticPlanSchema.optional(),
  relationships: z.array(visualRelationshipSchema).max(12).default([]),
  visualFocus: objectIdSchema.nullable(),
  illustrationIntent: z.string().trim().min(1).max(500),
  motionIntent: z.enum(["particle-flow", "path-animation", "keyword-highlight", "focus-shift", "gentle-reveal"]),
  motionSummary: z.string().trim().min(1).max(240),
  composition: visualCompositionSchema,
  compositionSource: z.enum(["existing", "library", "procedural", "manual"]).default("existing"),
  missingVisuals: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
  warnings: z.array(z.string().trim().min(1).max(240)).max(8),
  authoringStatus: z.enum(["ready_for_review", "needs_review", "needs_visual_authoring"]),
  authoringConfirmed: z.boolean(),
  notes: z.string().max(500),
  approved: z.boolean(),
  approvedFingerprint: z.string().regex(/^[a-f0-9]{8}$/).nullable().default(null),
}).strict().superRefine((scene, ctx) => {
  const legacyMetadata = scene.relationships.length === 0 && scene.compositionSource === "existing" && scene.missingVisuals.length === 0;
  if (scene.approved && scene.approvedFingerprint !== visualApprovalFingerprint(scene)
    && !(legacyMetadata && scene.approvedFingerprint === legacyVisualApprovalFingerprint(scene))) {
    ctx.addIssue({ code: "custom", message: "Approval visual sudah stale; tinjau ulang komposisi scene.", path: ["approvedFingerprint"] });
  }
});

export const visualStoryboardSchema = z.object({
  schemaVersion: z.literal("1.0"),
  styleId: z.literal("clean-flat-2d"),
  palette: z.object({ canvas: colorHex, surface: colorHex, primary: colorHex, accent: colorHex, text: colorHex }).strict(),
  typographyIntent: z.object({ heading: z.string().min(1).max(120), body: z.string().min(1).max(120), hierarchy: z.string().min(1).max(240) }).strict(),
  headlineStrategy: z.enum(["short-concept-first", "cause-then-effect"]),
  reusableWorldObjects: z.array(objectIdSchema).max(visualObjectIds.length),
  scenes: z.array(visualStoryboardSceneSchema).min(1).max(30),
}).strict().superRefine((storyboard, ctx) => {
  const sceneIds = new Set<string>();
  const reused = new Set<string>();
  storyboard.scenes.forEach((scene, index) => {
    if (sceneIds.has(scene.sceneId)) ctx.addIssue({ code: "custom", message: "Scene ID storyboard harus unik", path: ["scenes", index, "sceneId"] });
    sceneIds.add(scene.sceneId);
    const objects = new Set<string>();
    scene.objects.forEach((object, objectIndex) => {
      if (objects.has(object.objectId)) ctx.addIssue({ code: "custom", message: "Object tidak boleh berulang dalam satu scene", path: ["scenes", index, "objects", objectIndex] });
      objects.add(object.objectId);
    });
    if (scene.sceneNumber !== index + 1) ctx.addIssue({ code: "custom", message: "Nomor scene harus berurutan", path: ["scenes", index, "sceneNumber"] });
  });
  for (const objectId of visualObjectIds) {
    if (storyboard.scenes.filter((scene) => scene.objects.some((object) => object.objectId === objectId)).length > 1) reused.add(objectId);
  }
  const declaredReusable = new Set<string>(storyboard.reusableWorldObjects);
  if ([...declaredReusable].some((objectId) => !reused.has(objectId)) || [...reused].some((objectId) => !declaredReusable.has(objectId))) {
    ctx.addIssue({ code: "custom", message: "Reusable world objects harus tepat berisi asset yang dipakai lintas scene", path: ["reusableWorldObjects"] });
  }
});

export type VisualStoryboard = z.infer<typeof visualStoryboardSchema>;
export type VisualStoryboardScene = VisualStoryboard["scenes"][number];

const palette = { canvas: "#e8f3ed", surface: "#b8d8d0", primary: "#267a76", accent: "#edaa59", text: "#173740" };
const authoringPlaceholder = () => visualCompositionSchema.parse({
  background: palette.canvas,
  layers: [{ id: "visual-world", depth: 0.5, nodes: [{ type: "shape", shape: "rect", x: 0, y: 0, width: 1080, height: 1920, fill: palette.canvas }] }],
});

function intendedMotion(type: VisualStoryboardScene["compositionType"] | undefined): VisualStoryboardScene["motionIntent"] {
  if (type === "connected-environment" || type === "scientific-diagram") return "particle-flow";
  if (type === "cross-section" || type === "step-by-step-process") return "path-animation";
  if (type === "hero-object-focus" || type === "before-and-after") return "focus-shift";
  return "gentle-reveal";
}

function motionCopy(intent: VisualStoryboardScene["motionIntent"], objects: VisualObjectId[]) {
  if (intent === "particle-flow") return "Partikel bergerak deterministik mengikuti arah lingkungan; lintasan terungkap bertahap.";
  if (intent === "path-animation") return "Hujan, aliran air, atau uap bergerak di lintasan proses yang relevan.";
  if (intent === "keyword-highlight") return "Fade ringan lalu pulse singkat pada objek kunci.";
  if (intent === "focus-shift") return `Zoom halus menuju ${visualObjectLibrary[objects[0] ?? "earth"].label.toLocaleLowerCase("id-ID")}.`;
  return "Reveal bertahap menjaga fokus pada ilustrasi.";
}

export function buildVisualStoryboard(research: ResearchPackage, previous?: VisualStoryboard): VisualStoryboard {
  const worldObjects = visualObjectsForText(research.scenes.flatMap((scene) => [scene.onScreenText, scene.narrationText, scene.visualDescription]).join(" "));
  const scenes = research.scenes.map((scene, index) => {
    const prior = previous?.scenes.find((item) => item.sceneId === scene.id);
    const visualSummary = scene.visualDescription.trim() || "Visual authoring diperlukan untuk materi ini.";
    const sameCopy = prior?.headline === scene.onScreenText && prior.narrationText === scene.narrationText && prior.visualSummary === visualSummary;
    const preserveExisting = Boolean(prior && (prior.authoringConfirmed || prior.approved || sameCopy));
    const existingPlan = prior ? {
      objects: prior.objects.map((object) => object.objectId), relationships: prior.relationships,
      source: prior.compositionSource, status: sameCopy ? prior.authoringStatus : "needs_review" as const,
      authoringConfirmed: prior.authoringConfirmed, approved: prior.approved,
    } : undefined;
    const composed = composeVisualScene({
      headline: scene.onScreenText || `Scene ${index + 1}`,
      narration: scene.narrationText,
      visualDescription: visualSummary,
      artDirection: { styleId: "clean-flat-2d", palette },
      sceneVisualFocus: prior?.visualFocus ?? null,
      illustrationIntent: prior?.illustrationIntent ?? "",
      existingVisualPlan: existingPlan,
      existingComposition: prior?.composition ?? scene.visualComposition,
      semanticPlan: sameCopy ? prior?.semanticPlan : undefined,
      sharedWorldObjects: worldObjects,
      assetLibrary: visualObjectLibrary,
      preserveExisting: preserveExisting || !prior,
    });
    const compositionType = composed.compositionType;
    const intent = intendedMotion(compositionType);
    const nextScene = {
      sceneId: scene.id,
      sceneNumber: index + 1,
      durationSec: Math.round((scene.endSec - scene.startSec) * 1000) / 1000,
      headline: scene.onScreenText || `Scene ${index + 1}`,
      narrationText: scene.narrationText,
      visualSummary,
      layout: compositionType ?? (composed.compositionSource === "procedural" ? "procedural-scene" as const : "existing-composition" as const),
      compositionType,
      objects: composed.objects.map((objectId) => ({ objectId, assetId: objectId, role: visualObjectLibrary[objectId].role, label: visualObjectLibrary[objectId].label })),
      relationships: composed.relationships,
      semanticPlan: sameCopy ? prior?.semanticPlan : undefined,
      visualFocus: composed.focus,
      illustrationIntent: composed.illustrationIntent,
      motionIntent: intent,
      motionSummary: motionCopy(intent, composed.objects),
      composition: composed.composition ?? authoringPlaceholder(),
      compositionSource: composed.compositionSource,
      missingVisuals: composed.missingVisuals,
      warnings: composed.warnings,
      authoringStatus: composed.status,
      authoringConfirmed: composed.compositionSource === "manual" || Boolean(prior?.authoringConfirmed),
      notes: prior?.notes ?? "",
      approved: false,
      approvedFingerprint: null,
    };
    const keepApproval = Boolean(composed.status === "ready_for_review" && sameCopy && prior?.approved && JSON.stringify(prior.composition) === JSON.stringify(nextScene.composition)
      && JSON.stringify(prior.semanticPlan) === JSON.stringify(nextScene.semanticPlan)
      && prior.approvedFingerprint === visualApprovalFingerprint(nextScene));
    return { ...nextScene, approved: keepApproval, approvedFingerprint: keepApproval ? prior!.approvedFingerprint : null };
  });
  const reusableWorldObjects = visualObjectIds.filter((objectId) => scenes.filter((scene) => scene.objects.some((object) => object.objectId === objectId)).length > 1);
  return visualStoryboardSchema.parse({
    schemaVersion: "1.0",
    styleId: "clean-flat-2d",
    palette,
    typographyIntent: { heading: "Sans-serif tebal, kontras tinggi", body: "Sans-serif bersih untuk caption pendek", hierarchy: "Headline 1–2 baris; objek ilustrasi jadi fokus; narasi tetap caption." },
    headlineStrategy: "short-concept-first",
    reusableWorldObjects,
    scenes,
  });
}

function compositionNodes(composition: VisualComposition) {
  return composition.layers.flatMap((layer) => layer.nodes.flatMap((node) => node.type === "group" ? node.children : [node]));
}

export type VisualQualityGate = {
  status: VisualAuthoringStatus;
  ready: boolean;
  issues: string[];
  reviewNotes: string[];
  scenes: Record<string, string[]>;
  sceneStatuses: Record<string, VisualAuthoringStatus>;
};
export function visualStoryboardQualityGate(research: ResearchPackage, storyboard: VisualStoryboard, availableAssetIds: readonly string[] = []): VisualQualityGate {
  const scenes: Record<string, string[]> = {};
  const sceneStatuses: Record<string, VisualAuthoringStatus> = {};
  const reviewNotes: string[] = [];
  const availableAssets = new Set(availableAssetIds);
  const add = (sceneId: string, issue: string) => { (scenes[sceneId] ??= []).push(issue); };
  if (storyboard.scenes.length !== research.scenes.length) return { status: "needs_visual_authoring", ready: false, issues: ["Jumlah scene Visual Storyboard tidak sama dengan Research Package."], reviewNotes, scenes, sceneStatuses };
  storyboard.scenes.forEach((visual, index) => {
    sceneStatuses[visual.sceneId] = visual.authoringStatus;
    const source = research.scenes[index];
    if (!source || visual.sceneId !== source.id || visual.durationSec !== Math.round((source.endSec - source.startSec) * 1000) / 1000) {
      add(visual.sceneId, "Nomor, ID, atau durasi tidak cocok dengan scene sumber.");
    }
    if (visual.headline.length > 72) add(visual.sceneId, "Headline terlalu panjang untuk dibaca pada layar ponsel.");
    if (!visual.visualSummary.trim()) add(visual.sceneId, "Ringkasan visual kosong.");
    if (visual.authoringStatus === "needs_visual_authoring") add(visual.sceneId, `needs_visual_authoring: ${visual.missingVisuals.join(", ") || "komposisi belum menjelaskan konsep inti secara memadai"}.`);
    for (const node of compositionNodes(visual.composition)) {
      if (node.type === "image" && node.asset.startsWith("upload-") && !availableAssets.has(node.asset)) add(visual.sceneId, `Aset unggahan ${node.asset.slice(0, 22)} tidak tersedia di project ini.`);
    }
    if (visual.layout === "two-column-object-grid" || hasGenericIconCards(visual.composition)) add(visual.sceneId, "Scene masih memakai kartu ikon generik; author ilustrasi utuh.");
    if (visual.approved && visual.approvedFingerprint !== visualApprovalFingerprint(visual)) add(visual.sceneId, "Approval visual stale; tinjau ulang scene setelah perubahan.");

    const nodes = compositionNodes(visual.composition);
    const reviewFrame = Math.round(visual.durationSec * 15);
    const layerMotions = new Map(visual.composition.layers.map((layer) => [layer.id, layerMotion(source?.motionPlan ?? [], layer.id, layer.depth, reviewFrame, 0.5)]));
    const renderedBounds = renderedVisualBounds(visual.composition, research.visualPreset, { progress: 0.5, frame: reviewFrame, layerMotions });
    const keyVisuals = nodes.filter((node) => node.type !== "text" && !(node.type === "shape" && node.shape === "rect" && node.width >= 900 && node.height >= 1200));
    if (visual.objects.length === 0 && !visual.authoringConfirmed) add(visual.sceneId, "Object plan belum menentukan konsep visual utama.");
    if (nodes.length > 32) add(visual.sceneId, "Komposisi terlalu padat untuk layar ponsel.");
    if (keyVisuals.length === 0) add(visual.sceneId, "Komposisi tidak memiliki ilustrasi yang terlihat.");
    if (visual.visualFocus && !visual.authoringConfirmed && !compositionShowsObject(visual.composition, visual.visualFocus)) add(visual.sceneId, `Visual focus ${visualObjectLibrary[visual.visualFocus].label.toLocaleLowerCase("id-ID")} tidak tampak pada komposisi.`);
    if (!visual.authoringConfirmed) for (const relationship of visual.relationships) {
      if (!visualRelationshipIsVisible(relationship, visual.composition)) add(visual.sceneId, `Hubungan ${relationship.from} ${relationship.relation} ${relationship.to} belum tergambar.`);
    }
    const bounds = keyVisuals.reduce((box, node) => {
      const rendered = renderedBounds.get(node);
      return rendered ? { left: Math.min(box.left, rendered.left), top: Math.min(box.top, rendered.top), right: Math.max(box.right, rendered.right), bottom: Math.max(box.bottom, rendered.bottom) } : box;
    }, { left: 1080, top: 1920, right: 0, bottom: 0 });
    if ((bounds.right - bounds.left) * (bounds.bottom - bounds.top) < 120_000) add(visual.sceneId, "Ilustrasi utama terlalu kecil untuk frame ponsel.");
    if (bounds.bottom <= 510 || bounds.top >= 1510) add(visual.sceneId, "Ilustrasi berada di luar area visual aman 9:16.");
    const textNodes = nodes.filter((node) => node.type === "text");
    if (textNodes.some((node) => {
      const rendered = renderedBounds.get(node);
      return rendered && (rendered.top < 510 || rendered.bottom > 1510);
    })) add(visual.sceneId, "Teks visual bertabrakan dengan area headline atau subtitle.");
    for (let left = 0; left < textNodes.length; left++) for (let right = left + 1; right < textNodes.length; right++) {
      const a = textNodes[left]!;
      const b = textNodes[right]!;
      const ra = renderedBounds.get(a);
      const rb = renderedBounds.get(b);
      if (ra && rb && ra.left < rb.right && ra.right > rb.left && ra.top < rb.bottom && ra.bottom > rb.top) add(visual.sceneId, "Dua label bertabrakan dalam layout scene.");
    }
    if (visual.authoringStatus === "needs_review") reviewNotes.push(`Scene ${visual.sceneNumber}: komposisi tersedia; tinjau kecocokan visual sebelum approval.`);
  });
  const issues = Object.entries(scenes).flatMap(([sceneId, sceneIssues]) => sceneIssues.map((issue) => `Scene ${storyboard.scenes.find((scene) => scene.sceneId === sceneId)?.sceneNumber ?? "?"}: ${issue}`));
  const hasUnvisualizedConcept = Object.values(sceneStatuses).includes("needs_visual_authoring");
  const status: VisualAuthoringStatus = hasUnvisualizedConcept ? "needs_visual_authoring"
    : issues.length || Object.values(sceneStatuses).includes("needs_review") ? "needs_review" : "ready_for_review";
  return { status, ready: status === "ready_for_review", issues, reviewNotes, scenes, sceneStatuses };
}

export function applyVisualStoryboard(research: ResearchPackage, storyboard: VisualStoryboard): ResearchPackage {
  return {
    ...research,
    scenes: research.scenes.map((scene) => {
      const visual = storyboard.scenes.find((item) => item.sceneId === scene.id);
      if (!visual) return scene;
      const cues: ResearchPackage["scenes"][number]["motionCues"] = visual.motionIntent === "particle-flow" ? ["fadeIn", "reveal"]
        : visual.motionIntent === "path-animation" ? ["fadeIn", "reveal"]
          : visual.motionIntent === "keyword-highlight" ? ["fadeIn", "pulse"]
            : visual.motionIntent === "focus-shift" ? ["fadeIn", "zoom"] : ["fadeIn", "reveal"];
      const durationFrames = Math.max(1, Math.min(300, Math.round(Math.min(5, visual.durationSec) * 30)));
      const layerPreference = visual.motionIntent === "particle-flow" ? ["river", "mineral", "charged-particles", "magnetic-field", "salt-ions"]
        : visual.motionIntent === "path-animation" ? ["rain", "runoff", "river", "water-vapor", "uv-rays", "volcano", "tectonic-plates"]
          : visual.motionIntent === "keyword-highlight" ? ["ozone", "salt-ions", "ocean"] : [];
      const targetLayer = layerPreference.find((id) => visual.composition.layers.some((layer) => layer.id === id)) ?? "all";
      const motionPlan = defaultMotionPlan(cues).map((plan, index) => ({
        ...plan,
        targetLayer: plan.cue === "fadeIn" || plan.cue === "zoom" ? "all" : targetLayer,
        delayFrames: index * 6,
        durationFrames,
      }));
      return {
        ...scene,
        onScreenText: visual.headline,
        narrationText: visual.narrationText,
        visualDescription: visual.visualSummary,
        visualComposition: visual.composition,
        motionCues: cues,
        motionPlan,
        captionSegments: visual.narrationText === scene.narrationText ? scene.captionSegments : undefined,
      };
    }),
  };
}
