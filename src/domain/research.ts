import { z } from "zod";
import { captionSegmentsSchema } from "./captions";
import { defaultMotionPlan, defaultVisualComposition } from "./visual-defaults";
import { motionCuePlanSchema, motionCueIds, visualCompositionSchema } from "./visual-composition";
import { motionActionsSchema } from "./motion-director";
import { sceneMediaSchema } from "./scene-media";

export const categories = [
  "Fakta Unik", "Sains & Antariksa", "Sejarah & Misteri", "Tubuh Manusia", "Hewan & Alam", "Teknologi", "Geografi",
] as const;
export const visualPresets = ["flat-2d-storytelling", "animated-infographic", "cinematic-parallax"] as const;
export const templateIds = ["mountain-reveal", "plate-collision", "folding-uplift", "himalaya", "volcano", "infographic", "space-orbit", "animal-habitat"] as const;
export type TemplateId = typeof templateIds[number];
export type VisualPreset = typeof visualPresets[number];
export const motionCues = motionCueIds;
export const sfxCues = ["whoosh", "impact", "rumble", "soft-pop"] as const;

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const referenceSchema = z.object({
  id: boundedText(100),
  title: boundedText(200),
  publisher: boundedText(120),
  url: z.string().url().max(2048).refine((value) => /^https?:\/\//i.test(value), "URL harus memakai http atau https"),
  publishedAt: z.string().date().optional(),
  checkedAt: z.string().date(),
}).strict();

const sceneFields = {
  id: boundedText(100),
  order: z.number().int().positive(),
  startSec: z.number().min(0).max(120),
  endSec: z.number().positive().max(120),
  narrationText: boundedText(2000),
  onScreenText: z.string().max(120),
  templateId: z.enum(templateIds),
  visualDescription: z.string().max(500),
  motionCues: z.array(z.enum(motionCues)).max(9),
  sfxCues: z.array(z.enum(sfxCues)).max(4),
  referenceIds: z.array(boundedText(100)).max(20),
};

const sceneV10Schema = z.object(sceneFields).strict().refine((scene) => scene.endSec > scene.startSec, {
  message: "endSec harus lebih besar dari startSec", path: ["endSec"],
});
const sceneV11Schema = z.object({
  ...sceneFields,
  visualComposition: visualCompositionSchema,
  motionPlan: z.array(motionCuePlanSchema).max(9),
  motionActions: motionActionsSchema.default([]),
  captionSegments: captionSegmentsSchema.optional(),
  sceneMedia: sceneMediaSchema.optional(),
}).strict().superRefine((scene, ctx) => {
  if (scene.motionCues.length !== scene.motionPlan.length || scene.motionCues.some((cue, index) => cue !== scene.motionPlan[index]?.cue)) {
    ctx.addIssue({ code: "custom", message: "motionPlan harus memiliki satu konfigurasi untuk setiap motionCue dan urutan yang sama", path: ["motionPlan"] });
  }
  if (new Set(scene.motionCues).size !== scene.motionCues.length) ctx.addIssue({ code: "custom", message: "Motion cue tidak boleh berulang", path: ["motionCues"] });
  const transitionPlans = scene.motionPlan.filter((plan) => ["cut", "dissolve", "slide-transition", "wipe"].includes(plan.cue));
  if (transitionPlans.length > 1) ctx.addIssue({ code: "custom", message: "Pilih satu transisi scene: Cut, Crossfade, Slide, atau Wipe", path: ["motionPlan"] });
  const layerIds = new Set(scene.visualComposition.layers.map((layer) => layer.id));
  scene.motionPlan.forEach((plan, index) => {
    if (["cut", "dissolve", "slide-transition", "wipe"].includes(plan.cue) && plan.targetLayer !== "scene") ctx.addIssue({ code: "custom", message: "Cue transisi harus menargetkan seluruh scene", path: ["motionPlan", index, "targetLayer"] });
    if (!["all", "scene"].includes(plan.targetLayer) && !layerIds.has(plan.targetLayer)) {
      ctx.addIssue({ code: "custom", message: `Layer motion '${plan.targetLayer}' tidak ditemukan`, path: ["motionPlan", index, "targetLayer"] });
    }
  });
  const durationFrames = Math.floor((scene.endSec - scene.startSec) * 30);
  // ponytail: keep stale targets repairable; storyboard quality gate blocks approval/render.
  scene.motionActions.forEach((action, index) => {
    if (action.startFrame + action.durationFrames > durationFrames) ctx.addIssue({ code: "custom", message: "Motion action melewati durasi scene", path: ["motionActions", index, "durationFrames"] });
  });
}).refine((scene) => scene.endSec > scene.startSec, {
  message: "endSec harus lebih besar dari startSec", path: ["endSec"],
});

const packageFields = {
  id: boundedText(100),
  title: boundedText(120),
  category: z.enum(categories),
  visualPreset: z.enum(visualPresets),
  language: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/, "Format bahasa harus seperti id-ID").max(10),
  targetDurationSec: z.number().int().min(1).max(120),
  aspectRatio: z.literal("9:16"),
  narration: z.string().max(5000),
  videoOverlaySettings: z.object({
    showCategory: z.boolean(),
    showTitle: z.boolean(),
    showSceneLabel: z.boolean(),
    showSubtitles: z.boolean(),
    showProgress: z.boolean(),
    showBranding: z.boolean(),
    brandName: z.string().trim().max(40),
  }).strict().default({ showCategory: true, showTitle: true, showSceneLabel: true, showSubtitles: true, showProgress: true, showBranding: true, brandName: "AI FACTS STUDIO" }),
  references: z.array(referenceSchema).max(50),
};

function validateRelations(data: { references: Array<{ id: string }>; scenes: Array<{ id: string; order: number; startSec: number; endSec: number; referenceIds: string[] }>; targetDurationSec: number }, ctx: z.RefinementCtx) {
  const referenceIds = new Set<string>();
  data.references.forEach((reference, index) => {
    if (referenceIds.has(reference.id)) ctx.addIssue({ code: "custom", message: "ID referensi harus unik", path: ["references", index, "id"] });
    referenceIds.add(reference.id);
  });
  const sceneIds = new Set<string>();
  let priorOrder = 0;
  let priorEnd = 0;
  data.scenes.forEach((scene, index) => {
    if (sceneIds.has(scene.id)) ctx.addIssue({ code: "custom", message: "ID scene harus unik", path: ["scenes", index, "id"] });
    if (scene.order <= priorOrder) ctx.addIssue({ code: "custom", message: "Urutan scene harus meningkat", path: ["scenes", index, "order"] });
    if (scene.startSec < priorEnd) ctx.addIssue({ code: "custom", message: "Scene bertumpuk; ubah timing agar berurutan", path: ["scenes", index, "startSec"] });
    if (scene.endSec > data.targetDurationSec) ctx.addIssue({ code: "custom", message: "Scene melebihi targetDurationSec", path: ["scenes", index, "endSec"] });
    scene.referenceIds.forEach((referenceId) => {
      if (!referenceIds.has(referenceId)) ctx.addIssue({ code: "custom", message: `Referensi '${referenceId}' tidak ditemukan`, path: ["scenes", index, "referenceIds"] });
    });
    sceneIds.add(scene.id);
    priorOrder = scene.order;
    priorEnd = scene.endSec;
  });
}

const packageV10Schema = z.object({ schemaVersion: z.literal("1.0"), ...packageFields, scenes: z.array(sceneV10Schema).min(1).max(30) })
  .strict().superRefine(validateRelations);
const packageV11Schema = z.object({ schemaVersion: z.literal("1.1"), ...packageFields, scenes: z.array(sceneV11Schema).min(1).max(30) })
  .strict().superRefine(validateRelations);

export const researchPackageSchema = packageV11Schema;
export type ResearchPackage = z.infer<typeof packageV11Schema>;
export type Scene = ResearchPackage["scenes"][number];
type ParseResult = ReturnType<typeof packageV11Schema.safeParse>;

function preserveLegacyTransitionBehavior(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const packageData = value as { scenes?: unknown };
  if (!Array.isArray(packageData.scenes)) return value;
  return {
    ...packageData,
    scenes: packageData.scenes.map((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return entry;
      const scene = entry as { motionCues?: unknown; motionPlan?: unknown };
      if (!Array.isArray(scene.motionCues) || !scene.motionCues.includes("cut") || !scene.motionCues.includes("dissolve")) return entry;
      // Legacy renderer treated Cut as winner when both transitions were stored.
      return {
        ...scene,
        motionCues: scene.motionCues.filter((cue) => cue !== "dissolve"),
        ...(Array.isArray(scene.motionPlan) ? { motionPlan: scene.motionPlan.filter((plan) => typeof plan !== "object" || plan === null || !("cue" in plan) || (plan as { cue?: unknown }).cue !== "dissolve") } : {}),
      };
    }),
  };
}

export function parseResearchPackage(value: unknown): ParseResult {
  const compatibleValue = preserveLegacyTransitionBehavior(value);
  if (typeof compatibleValue === "object" && compatibleValue !== null && !Array.isArray(compatibleValue) && (compatibleValue as { schemaVersion?: unknown }).schemaVersion === "1.0") {
    const old = packageV10Schema.safeParse(compatibleValue);
    if (!old.success) return old as unknown as ParseResult;
    const upgraded = {
      ...old.data,
      schemaVersion: "1.1" as const,
      scenes: old.data.scenes.map((scene) => ({
        ...scene,
        visualComposition: visualCompositionSchema.parse(defaultVisualComposition(scene.templateId)),
        motionPlan: defaultMotionPlan(scene.motionCues),
      })),
    };
    return packageV11Schema.safeParse(upgraded);
  }
  return packageV11Schema.safeParse(compatibleValue);
}

export function researchWarnings(research: ResearchPackage) {
  const warnings: string[] = [];
  if (research.references.length === 0) warnings.push("Belum ada sumber; verifikasi klaim sebelum publikasi.");
  if (research.scenes.some((scene) => scene.referenceIds.length === 0)) warnings.push("Ada scene tanpa referensi klaim.");
  return warnings;
}
