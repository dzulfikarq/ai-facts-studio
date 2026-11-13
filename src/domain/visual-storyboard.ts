import { z } from "zod";
import type { ResearchPackage } from "./research";
import { visualCompositionSchema, type VisualComposition } from "./visual-composition";
import { renderedVisualBounds } from "./visual-geometry";
import { layerMotion } from "../video/motion";
import { composeVisualScene, compositionShowsObject, hasGenericIconCards, visualRelationshipIsVisible, visualRelationshipKinds, type VisualRelationship, type VisualAuthoringStatus } from "./visual-composer";
import { visualObjectIds, visualObjectLibrary, visualObjectsForText, type VisualObjectId } from "./visual-objects";
import { visualSemanticPlanSchema, type VisualSemanticPlan } from "./visual-semantic-plan";
import { motionActionsSchema, motionIntensitySchema, motionKeyframesWithinSafeCanvas, motionTargetNode, type MotionIntensity } from "./motion-director";
import { defaultGoogleFlowStyleLock, googleFlowStyleLockSchema, recommendedGoogleFlowFilename, stableGoogleFlowSceneToken } from "./google-flow";
import { sceneMediaSchema } from "./scene-media";
import { animationStyleIdSchema } from "./animation-styles";

export { visualObjectIds, visualObjectLibrary, visualObjectsForText } from "./visual-objects";
export type { VisualObjectId } from "./visual-objects";

const objectIdSchema = z.enum(visualObjectIds);
const colorHex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
type ApprovalInput = {
  sceneId: string; durationSec: number; headline: string; narrationText: string; visualSummary: string;
  layout: string; compositionType?: string; objects: Array<{ objectId: string; assetId: string; role: string; label: string }>;
  visualFocus: string | null; relationships: VisualRelationship[]; illustrationIntent: string; motionIntent: string; motionSummary: string;
  motionIntensity: MotionIntensity; motionTiming: "approximate" | "narration-aligned"; motionStatus: "not_prepared" | "ready_for_review" | "needs_review" | "static";
  motionActions: import("./motion-director").MotionAction[];
  sceneMedia?: import("./scene-media").SceneMedia;
  composition: VisualComposition; compositionOverride?: VisualComposition; compositionSource: string; illustrationSource?: string; illustrationWorkflow?: string; authoringStatus: string; authoringConfirmed: boolean; missingVisuals: string[];
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
    motionSummary: scene.motionSummary, composition: scene.composition, compositionOverride: scene.compositionOverride, compositionSource: scene.compositionSource, illustrationSource: scene.illustrationSource,
    motionIntensity: scene.motionIntensity, motionTiming: scene.motionTiming, motionStatus: scene.motionStatus, motionActions: scene.motionActions,
    authoringStatus: scene.authoringStatus, authoringConfirmed: scene.authoringConfirmed, missingVisuals: scene.missingVisuals,
    semanticPlan: scene.semanticPlan, sceneMedia: scene.sceneMedia,
  }));
}
export function legacyMotionApprovalFingerprint(scene: ApprovalInput) {
  return fingerprint(JSON.stringify({
    sceneId: scene.sceneId, durationSec: scene.durationSec, headline: scene.headline, narrationText: scene.narrationText,
    visualSummary: scene.visualSummary, layout: scene.layout, compositionType: scene.compositionType, objects: scene.objects, relationships: scene.relationships,
    visualFocus: scene.visualFocus, illustrationIntent: scene.illustrationIntent, motionIntent: scene.motionIntent,
    motionSummary: scene.motionSummary, composition: scene.composition, compositionSource: scene.compositionSource, illustrationSource: scene.illustrationSource,
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
  motionIntensity: motionIntensitySchema.default("balanced"),
  motionTiming: z.enum(["approximate", "narration-aligned"]).default("approximate"),
  motionStatus: z.enum(["not_prepared", "ready_for_review", "needs_review", "static"]).default("not_prepared"),
    motionActions: motionActionsSchema.default([]),
    composition: visualCompositionSchema,
    compositionOverride: visualCompositionSchema.optional(),
  compositionSource: z.enum(["existing", "library", "procedural", "manual", "ai-vector"]).default("existing"),
  illustrationSource: z.enum(["ai-vector", "ai-image", "asset-library", "upload-image", "video-clip", "procedural", "manual"]).optional(),
  illustrationWorkflow: z.enum(["google-flow", "asset-library", "upload-image", "ai-vector", "ai-image-api"]).default("google-flow"),
  sceneToken: z.string().trim().min(1).max(100).optional(),
  recommendedFilename: z.string().trim().min(1).max(180).optional(),
  flowPrompt: z.string().max(12000).optional(),
  flowPromptAnimationStyleId: animationStyleIdSchema.optional(),
  flowVisualMode: z.enum(["still-image", "animated-video"]).default("still-image"),
  flowPromptMode: z.enum(["still-image", "animated-video"]).default("still-image"),
  sceneMedia: sceneMediaSchema.optional(),
  flowStatus: z.enum(["awaiting-illustration", "prompt-ready", "illustration-imported", "ready-for-review", "approved"]).optional(),
  missingVisuals: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
  warnings: z.array(z.string().trim().min(1).max(240)).max(8),
  authoringStatus: z.enum(["ready_for_review", "needs_review", "needs_visual_authoring"]),
  authoringConfirmed: z.boolean(),
  notes: z.string().max(500),
  approved: z.boolean(),
  approvedFingerprint: z.string().regex(/^[a-f0-9]{8}$/).nullable().default(null),
}).strict().superRefine((scene, ctx) => {
  const legacyMetadata = scene.relationships.length === 0 && scene.compositionSource === "existing" && scene.missingVisuals.length === 0;
  const legacyMotionUnchanged = scene.motionStatus === "not_prepared" && scene.motionActions.length === 0;
  const motionDurationFrames = Math.floor(scene.durationSec * 30);
  scene.motionActions.forEach((action, index) => {
    if (action.startFrame + action.durationFrames > motionDurationFrames) ctx.addIssue({ code: "custom", message: "Motion action melewati durasi scene", path: ["motionActions", index, "durationFrames"] });
  });
  if (scene.approved && scene.approvedFingerprint !== visualApprovalFingerprint(scene)
    && !(legacyMotionUnchanged && scene.approvedFingerprint === legacyMotionApprovalFingerprint(scene))
    && !(legacyMetadata && legacyMotionUnchanged && scene.approvedFingerprint === legacyVisualApprovalFingerprint(scene))) {
    ctx.addIssue({ code: "custom", message: "Approval visual sudah stale; tinjau ulang komposisi scene.", path: ["approvedFingerprint"] });
  }
}).transform((scene) => {
  const sceneToken = scene.sceneToken ?? stableGoogleFlowSceneToken(scene.sceneId);
  const hasImage = compositionNodes(scene.compositionOverride ?? scene.composition).some((node) => node.type === "image");
  const hasMedia = Boolean(scene.sceneMedia);
  const flowStatus = scene.flowStatus ?? (scene.approved ? "approved" : hasMedia || hasImage ? scene.authoringConfirmed ? "ready-for-review" : "illustration-imported" : scene.flowPrompt ? "prompt-ready" : "awaiting-illustration");
  return { ...scene, sceneToken, recommendedFilename: recommendedGoogleFlowFilename({ ...scene, sceneToken }), flowStatus };
});

export const visualWorldRoles = ["background", "mountain-exterior", "ground-cross-section", "magma-reservoir", "magma-conduit", "surface-crater", "lava", "smoke", "particles", "educational-overlay", "illustration-base", "other"] as const;
export const visualWorldSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  name: z.string().trim().min(1).max(120),
  sourceSceneId: z.string().trim().min(1).max(100),
  sourceAssetId: z.string().trim().min(1).max(120).optional(),
  composition: visualCompositionSchema,
  elements: z.array(z.object({
    layerId: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
    semanticRole: z.enum(visualWorldRoles),
  }).strict()).min(1).max(12),
}).strict().superRefine((world, ctx) => {
  if (world.sourceAssetId && !compositionNodes(world.composition).some((node) => node.type === "image" && node.asset === world.sourceAssetId)) {
    ctx.addIssue({ code: "custom", message: "Source asset harus menjadi image node dalam Visual World", path: ["sourceAssetId"] });
  }
  const layerIds = world.composition.layers.map((layer) => layer.id);
  const elementIds = world.elements.map((element) => element.layerId);
  if (new Set(elementIds).size !== elementIds.length) ctx.addIssue({ code: "custom", message: "Visual World layer ID harus unik", path: ["elements"] });
  if (layerIds.length !== elementIds.length || layerIds.some((id) => !elementIds.includes(id))) {
    ctx.addIssue({ code: "custom", message: "Visual World harus mendeklarasikan setiap stable layer ID tepat satu kali", path: ["elements"] });
  }
});

export const visualStoryboardSchema = z.object({
  schemaVersion: z.literal("1.0"),
  styleId: z.literal("clean-flat-2d"),
  palette: z.object({ canvas: colorHex, surface: colorHex, primary: colorHex, accent: colorHex, text: colorHex }).strict(),
  typographyIntent: z.object({ heading: z.string().min(1).max(120), body: z.string().min(1).max(120), hierarchy: z.string().min(1).max(240) }).strict(),
  headlineStrategy: z.enum(["short-concept-first", "cause-then-effect"]),
  styleLock: googleFlowStyleLockSchema.default(defaultGoogleFlowStyleLock),
  visualWorld: visualWorldSchema.optional(),
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
export type VisualWorld = z.infer<typeof visualWorldSchema>;

export function compositionForVisualScene(storyboard: Pick<VisualStoryboard, "visualWorld">, scene: Pick<VisualStoryboardScene, "composition" | "compositionOverride">): VisualComposition {
  return scene.compositionOverride ?? storyboard.visualWorld?.composition ?? scene.composition;
}

export function retimeVisualStoryboard(storyboard: VisualStoryboard, previous: ResearchPackage, next: ResearchPackage): VisualStoryboard {
  if (previous.scenes.length !== next.scenes.length || previous.scenes.some((scene, index) => scene.id !== next.scenes[index]?.id)) {
    throw new Error("Scene IDs berubah; storyboard perlu rekonsiliasi eksplisit sebelum retiming.");
  }
  const scenes = storyboard.scenes.map((visual) => {
    const index = previous.scenes.findIndex((scene) => scene.id === visual.sceneId);
    const before = previous.scenes[index];
    const after = next.scenes[index];
    if (!before || !after) throw new Error(`Scene ${visual.sceneId} tidak ditemukan saat retiming.`);
    const oldFrames = Math.max(1, Math.round((before.endSec - before.startSec) * 30));
    const newFrames = Math.max(1, Math.round((after.endSec - after.startSec) * 30));
    const ratio = newFrames / oldFrames;
    const motionActions = visual.motionActions.map((action) => {
      const startFrame = Math.min(newFrames - 1, Math.max(0, Math.round(action.startFrame * ratio)));
      return { ...action, startFrame, durationFrames: Math.min(newFrames - startFrame, Math.max(1, Math.round(action.durationFrames * ratio))) };
    });
    const retimed = { ...visual, durationSec: Math.round((after.endSec - after.startSec) * 1000) / 1000, motionActions };
    return visual.approved ? { ...retimed, approvedFingerprint: visualApprovalFingerprint(retimed) } : retimed;
  });
  return visualStoryboardSchema.parse({ ...storyboard, scenes });
}

export function buildVisualWorld(name: string, sourceScene: VisualStoryboardScene): VisualWorld {
  const composition = sourceScene.compositionOverride ?? sourceScene.composition;
  const image = compositionNodes(composition).find((node) => node.type === "image");
  return visualWorldSchema.parse({
    id: "shared-visual-world",
    name,
    sourceSceneId: sourceScene.sceneId,
    ...(image?.type === "image" ? { sourceAssetId: image.asset } : {}),
    composition,
    elements: composition.layers.map((layer) => {
      const id = layer.id.toLocaleLowerCase("id-ID");
      const hasImage = layer.nodes.some((node) => node.type === "image" || node.type === "group" && node.children.some((child) => child.type === "image"));
      const semanticRole = id.includes("background") || id.includes("sky") ? "background"
        : id.includes("mountain") || id.includes("volcano") || id.includes("cone") ? "mountain-exterior"
          : id.includes("cross-section") || id.includes("geology") || id.includes("ground") || id.includes("rock") ? "ground-cross-section"
            : id.includes("reservoir") || id.includes("chamber") ? "magma-reservoir"
              : id.includes("conduit") || id.includes("vent") ? "magma-conduit"
                : id.includes("crater") ? "surface-crater"
                  : id.includes("lava") ? "lava"
                    : id.includes("smoke") || id.includes("ash") ? "smoke"
                      : id.includes("particle") ? "particles"
                        : hasImage ? "illustration-base" : "other";
      return { layerId: layer.id, semanticRole };
    }),
  });
}

export function illustrationSourceForScene(scene: Pick<VisualStoryboardScene, "illustrationSource" | "compositionSource" | "composition" | "sceneMedia">): NonNullable<VisualStoryboardScene["illustrationSource"]> {
  if (scene.sceneMedia) return "video-clip";
  if (scene.illustrationSource) return scene.illustrationSource;
  const image = scene.composition.layers.flatMap((layer) => layer.nodes.flatMap((node) => node.type === "group" ? node.children : [node]))
    .find((node) => node.type === "image");
  if (image) return image.asset.startsWith("upload-") ? "upload-image" : "asset-library";
  if (scene.compositionSource === "ai-vector") return "ai-vector";
  if (scene.compositionSource === "manual") return "manual";
  return "procedural";
}

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
  void intent; void objects;
  return "Motion belum disiapkan; scene tetap valid sebagai komposisi statis.";
}

export function buildVisualStoryboard(research: ResearchPackage, previous?: VisualStoryboard): VisualStoryboard {
  const worldObjects = visualObjectsForText(research.scenes.flatMap((scene) => [scene.onScreenText, scene.narrationText, scene.visualDescription]).join(" "));
  const scenes = research.scenes.map((scene, index) => {
    const prior = previous?.scenes.find((item) => item.sceneId === scene.id);
    const visualSummary = scene.visualDescription.trim() || "Visual authoring diperlukan untuk materi ini.";
    const sameCopy = prior?.headline === scene.onScreenText && prior.narrationText === scene.narrationText && prior.visualSummary === visualSummary;
    const priorComposition = prior ? compositionForVisualScene(previous!, prior) : undefined;
    const hasRaster = Boolean(priorComposition && compositionNodes(priorComposition).some((node) => node.type === "image"));
    const preserveExisting = Boolean(prior && (prior.authoringConfirmed || prior.approved || prior.compositionSource === "ai-vector" || hasRaster || prior.sceneMedia || sameCopy));
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
      existingComposition: priorComposition ?? scene.visualComposition,
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
      motionSummary: prior?.motionSummary ?? motionCopy(intent, composed.objects),
      motionIntensity: prior?.motionIntensity ?? "balanced",
      motionTiming: prior?.motionTiming ?? "approximate",
      motionStatus: prior?.motionActions?.length ? (sameCopy ? prior.motionStatus : "needs_review") : prior?.motionStatus ?? "not_prepared",
       motionActions: prior?.motionActions ?? [],
       composition: composed.composition ?? authoringPlaceholder(),
       ...(prior?.compositionOverride ? { compositionOverride: composed.composition ?? prior.compositionOverride } : {}),
      compositionSource: composed.compositionSource,
      ...(prior?.illustrationSource ? { illustrationSource: prior.illustrationSource }
        : prior ? {} : { illustrationSource: composed.compositionSource === "ai-vector" ? "ai-vector" as const : composed.compositionSource === "manual" ? "manual" as const : "procedural" as const }),
       illustrationWorkflow: prior?.illustrationWorkflow ?? "google-flow",
       flowVisualMode: prior?.flowVisualMode ?? "animated-video",
       flowPromptMode: prior?.flowPromptMode ?? "still-image",
       ...(prior?.sceneMedia ? { sceneMedia: prior.sceneMedia } : {}),
      missingVisuals: composed.missingVisuals,
      warnings: composed.warnings,
      authoringStatus: composed.status,
      authoringConfirmed: composed.compositionSource === "manual" || Boolean(prior?.authoringConfirmed),
      notes: prior?.notes ?? "",
      approved: false,
      approvedFingerprint: null,
      sceneToken: prior?.sceneToken ?? stableGoogleFlowSceneToken(scene.id),
       recommendedFilename: recommendedGoogleFlowFilename({ sceneId: scene.id, sceneNumber: index + 1, headline: scene.onScreenText || `Scene ${index + 1}`, sceneToken: prior?.sceneToken }),
       ...(prior?.flowPrompt ? { flowPrompt: prior.flowPrompt } : {}),
       ...(prior?.flowPromptAnimationStyleId ? { flowPromptAnimationStyleId: prior.flowPromptAnimationStyleId } : {}),
       flowStatus: sameCopy ? prior?.flowStatus ?? (hasRaster || prior?.sceneMedia ? "illustration-imported" as const : prior?.flowPrompt ? "prompt-ready" as const : "awaiting-illustration" as const)
         : hasRaster || prior?.sceneMedia ? prior?.authoringConfirmed ? "ready-for-review" as const : "illustration-imported" as const
          : prior?.flowPrompt ? "prompt-ready" as const : "awaiting-illustration" as const,
    };
    const keepApproval = Boolean(composed.status === "ready_for_review" && sameCopy && prior?.approved && JSON.stringify(prior.composition) === JSON.stringify(nextScene.composition)
      && JSON.stringify(prior.semanticPlan) === JSON.stringify(nextScene.semanticPlan)
      && [visualApprovalFingerprint(nextScene), legacyMotionApprovalFingerprint(nextScene)].includes(prior.approvedFingerprint ?? ""));
    return { ...nextScene, approved: keepApproval, approvedFingerprint: keepApproval ? prior!.approvedFingerprint : null };
  });
  const reusableWorldObjects = visualObjectIds.filter((objectId) => scenes.filter((scene) => scene.objects.some((object) => object.objectId === objectId)).length > 1);
  return visualStoryboardSchema.parse({
    schemaVersion: "1.0",
    styleId: "clean-flat-2d",
    palette,
    typographyIntent: { heading: "Sans-serif tebal, kontras tinggi", body: "Sans-serif bersih untuk caption pendek", hierarchy: "Headline 1–2 baris; objek ilustrasi jadi fokus; narasi tetap caption." },
    headlineStrategy: "short-concept-first",
    styleLock: previous?.styleLock ?? defaultGoogleFlowStyleLock,
    ...(previous?.visualWorld ? { visualWorld: previous.visualWorld } : {}),
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
export function visualStoryboardQualityGate(research: ResearchPackage, storyboard: VisualStoryboard, assets: readonly (string | import("./visual-assets").VisualAsset)[] = []): VisualQualityGate {
  const scenes: Record<string, string[]> = {};
  const sceneStatuses: Record<string, VisualAuthoringStatus> = {};
  const reviewNotes: string[] = [];
  const availableAssets = new Set(assets.map((asset) => typeof asset === "string" ? asset : asset.id));
  const assetById = new Map(assets.flatMap((asset) => typeof asset === "string" ? [] : [[asset.id, asset] as const]));
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
    const illustrationSource = illustrationSourceForScene(visual);
    const composition = compositionForVisualScene(storyboard, visual);
    const nodes = compositionNodes(composition);
    const imageNodes = nodes.filter((node) => node.type === "image");
    const motionVectors = nodes.filter((node) => node.type !== "image" && node.type !== "text"
      && !(node.type === "shape" && node.shape === "rect" && node.width >= 900 && node.height >= 1200));
    if (imageNodes.length && motionVectors.length === 0 && visual.motionActions.length) {
      reviewNotes.push(`Scene ${visual.sceneNumber}: ilustrasi raster digerakkan sebagai satu gambar; objek di dalam raster tidak dipisah.`);
    }
    if (visual.sceneMedia) {
      if (!visual.authoringConfirmed) add(visual.sceneId, "Tinjau gerakan, crop, durasi, dan audio klip lalu konfirmasi sebelum approval.");
      if (visual.sceneMedia.audioEnabled && !visual.sceneMedia.audioCodec) add(visual.sceneId, "Audio klip diaktifkan tetapi file tidak memiliki track audio.");
      if (visual.sceneMedia.audioCodec && !visual.sceneMedia.audioEnabled) reviewNotes.push(`Scene ${visual.sceneNumber}: audio klip nonaktif secara default; voice-over tetap menjadi track utama.`);
      if (visual.motionActions.length) reviewNotes.push(`Scene ${visual.sceneNumber}: Motion Beat dipertahankan, tidak ditumpuk otomatis di atas klip video.`);
      const legacyMotionUnchanged = visual.motionStatus === "not_prepared" && visual.motionActions.length === 0;
      if (visual.approved && visual.approvedFingerprint !== visualApprovalFingerprint(visual)
        && !(legacyMotionUnchanged && visual.approvedFingerprint === legacyMotionApprovalFingerprint(visual))) add(visual.sceneId, "Approval visual stale; tinjau ulang scene setelah perubahan.");
      return;
    }
    if (["ai-image", "asset-library", "upload-image"].includes(illustrationSource) && imageNodes.length === 0) {
      sceneStatuses[visual.sceneId] = "needs_visual_authoring";
      add(visual.sceneId, "Ilustrasi gambar belum tersedia. Buat/copy prompt lalu impor gambar, atau pilih aset dari Library.");
      return;
    }
    let missingImage = false;
    for (const node of imageNodes) {
      if (node.asset.startsWith("upload-") && !availableAssets.has(node.asset)) {
        add(visual.sceneId, `Aset gambar ${node.asset.slice(0, 22)} tidak tersedia; pilih ulang dari Asset Library atau unggah lagi.`);
        missingImage = true;
      }
      const asset = assetById.get(node.asset);
      if (asset && asset.width * asset.height < 600_000) add(visual.sceneId, `Resolusi aset ${asset.name} rendah; gunakan gambar minimal 600.000 piksel.`);
      if (asset && illustrationSource === "ai-image" && asset.source !== "ai-generated") add(visual.sceneId, "Source scene AI Image tidak cocok dengan provenance aset.");
      if (asset && illustrationSource === "upload-image" && asset.source !== "user-upload") add(visual.sceneId, "Source scene Upload Image tidak cocok dengan provenance aset.");
      if (asset && /unspecified|not specified/i.test(asset.license)) reviewNotes.push(`Scene ${visual.sceneNumber}: license/provenance aset ${asset.name} belum dicatat spesifik.`);
    }
    if (missingImage) {
      sceneStatuses[visual.sceneId] = "needs_visual_authoring";
      return;
    }
    if (imageNodes.length > 0 && !visual.authoringConfirmed) add(visual.sceneId, "Tinjau semantik, crop, dan provenance gambar lalu konfirmasi sebelum approval.");
    if (visual.authoringStatus === "needs_visual_authoring") add(visual.sceneId, `needs_visual_authoring: ${visual.missingVisuals.join(", ") || "komposisi belum menjelaskan konsep inti secara memadai"}.`);
    if (visual.layout === "two-column-object-grid" || hasGenericIconCards(composition)) add(visual.sceneId, "Scene masih memakai kartu ikon generik; author ilustrasi utuh.");
    const legacyMotionUnchanged = visual.motionStatus === "not_prepared" && visual.motionActions.length === 0;
    if (visual.approved && visual.approvedFingerprint !== visualApprovalFingerprint(visual)
      && !(legacyMotionUnchanged && visual.approvedFingerprint === legacyMotionApprovalFingerprint(visual))
      && !(visual.relationships.length === 0 && visual.compositionSource === "existing" && visual.missingVisuals.length === 0
        && legacyMotionUnchanged && visual.approvedFingerprint === legacyVisualApprovalFingerprint(visual))) add(visual.sceneId, "Approval visual stale; tinjau ulang scene setelah perubahan.");
    if (visual.motionStatus === "not_prepared") reviewNotes.push(`Scene ${visual.sceneNumber}: Motion Plan belum dibuat; scene statis tetap valid.`);
    if (visual.motionStatus === "needs_review") reviewNotes.push(`Scene ${visual.sceneNumber}: Motion Plan dipertahankan setelah perubahan; tinjau ulang gerak.`);
    const motionDurationFrames = Math.floor(visual.durationSec * 30);
    const missingMotionTargets = visual.motionActions.filter((action) => !motionTargetNode(composition, action.targetNode));
    if (missingMotionTargets.length) {
      sceneStatuses[visual.sceneId] = "needs_review";
      add(visual.sceneId, `${missingMotionTargets.length} Motion Beat memiliki target layer/node yang hilang; pilih target baru atau hapus beat.`);
    }
    visual.motionActions.forEach((action, actionIndex) => {
      const target = motionTargetNode(composition, action.targetNode);
      if (action.startFrame + action.durationFrames > motionDurationFrames) add(visual.sceneId, `Motion action ${actionIndex + 1} memiliki timing tidak valid.`);
      if (target?.type === "text") add(visual.sceneId, `Motion action ${actionIndex + 1} menargetkan label teks; pilih objek visual.`);
      if (target && action.kind === "draw" && target.type !== "path" && !(target.type === "shape" && target.shape === "line")) {
        add(visual.sceneId, `Motion action ${actionIndex + 1} harus menggambar path atau line.`);
      }
      if (target && !motionKeyframesWithinSafeCanvas(action, target)) add(visual.sceneId, `Motion action ${actionIndex + 1} keluar dari safe canvas.`);
      if (target && imageNodes.length && motionVectors.length === 0) {
        const rasterTarget = target.type === "image" || target.type === "group" && target.children.some((child) => child.type === "image");
        const wholeImageAction = ["fade", "translate", "scale", "rotate", "follow-path", "repeat", "reveal", "focus-shift", "state-transition"].includes(action.kind);
        if (!rasterTarget || !wholeImageAction && !(action.kind === "particle-flow" && rasterTarget)) {
          add(visual.sceneId, `Motion action ${actionIndex + 1} tidak didukung untuk ilustrasi raster tunggal.`);
        }
      }
    });
    if (visual.motionActions.reduce((total, action) => total + (action.particleCount ?? 0), 0) > 24) add(visual.sceneId, "Jumlah partikel motion melebihi batas 24.");
    if (visual.motionTiming === "approximate" && visual.motionActions.length) reviewNotes.push(`Scene ${visual.sceneNumber}: timing motion approximate berdasarkan durasi/narasi, bukan word-level audio alignment.`);

    const reviewFrame = Math.round(visual.durationSec * 15);
    const layerMotions = new Map(composition.layers.map((layer) => [layer.id, layerMotion(source?.motionPlan ?? [], layer.id, layer.depth, reviewFrame, 0.5)]));
    const renderedBounds = renderedVisualBounds(composition, research.visualPreset, { progress: 0.5, frame: reviewFrame, layerMotions });
    const keyVisuals = nodes.filter((node) => node.type !== "text" && !(node.type === "shape" && node.shape === "rect" && node.width >= 900 && node.height >= 1200));
    if (visual.objects.length === 0 && !visual.authoringConfirmed && visual.compositionSource !== "ai-vector" && imageNodes.length === 0) add(visual.sceneId, "Object plan belum menentukan konsep visual utama.");
    if (nodes.length > 32) add(visual.sceneId, "Komposisi terlalu padat untuk layar ponsel.");
    if (keyVisuals.length === 0) add(visual.sceneId, "Komposisi tidak memiliki ilustrasi yang terlihat.");
    if (visual.visualFocus && !visual.authoringConfirmed && !compositionShowsObject(composition, visual.visualFocus)) add(visual.sceneId, `Visual focus ${visualObjectLibrary[visual.visualFocus].label.toLocaleLowerCase("id-ID")} tidak tampak pada komposisi.`);
    if (!visual.authoringConfirmed) for (const relationship of visual.relationships) {
      if (!visualRelationshipIsVisible(relationship, composition)) add(visual.sceneId, `Hubungan ${relationship.from} ${relationship.relation} ${relationship.to} belum tergambar.`);
    }
    const bounds = keyVisuals.reduce((box, node) => {
      const rendered = renderedBounds.get(node);
      return rendered ? { left: Math.min(box.left, rendered.left), top: Math.min(box.top, rendered.top), right: Math.max(box.right, rendered.right), bottom: Math.max(box.bottom, rendered.bottom) } : box;
    }, { left: 1080, top: 1920, right: 0, bottom: 0 });
    if ((bounds.right - bounds.left) * (bounds.bottom - bounds.top) < 120_000) add(visual.sceneId, "Ilustrasi utama terlalu kecil untuk frame ponsel.");
    const foregroundImageOutsideSafeArea = imageNodes.some((node) => {
      const layer = composition.layers.find((item) => item.nodes.some((entry) => entry === node));
      if (layer && layer.depth <= 0.1) return false;
      const rendered = renderedBounds.get(node);
      return rendered && (rendered.top < 500 || rendered.bottom > 1510);
    });
    if (foregroundImageOutsideSafeArea || imageNodes.length === 0 && (bounds.bottom <= 510 || bounds.top >= 1510)) add(visual.sceneId, "Ilustrasi utama berada di luar area aman 9:16.");
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
      const composition = compositionForVisualScene(storyboard, visual);
      const layerIds = new Set(composition.layers.map((layer) => layer.id));
      // Research Package motionPlan is canonical; retarget removed layers without losing authored timing/effects.
      const motionPlan = scene.motionPlan.map((plan) => !["all", "scene"].includes(plan.targetLayer) && !layerIds.has(plan.targetLayer)
        ? { ...plan, targetLayer: "all" }
        : plan);
      const cues: ResearchPackage["scenes"][number]["motionCues"] = motionPlan.map((plan) => plan.cue);
      return {
        ...scene,
        onScreenText: visual.headline,
        narrationText: visual.narrationText,
        visualDescription: visual.visualSummary,
        visualComposition: composition,
        sceneMedia: visual.sceneMedia,
        motionActions: visual.motionActions,
        motionCues: cues,
        motionPlan,
        captionSegments: visual.narrationText === scene.narrationText ? scene.captionSegments : undefined,
      };
    }),
  };
}
