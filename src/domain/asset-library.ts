import { z } from "zod";
import { motionCuePlanSchema, visualCompositionSchema } from "./visual-composition";
import { visualObjectIds } from "./visual-storyboard";
import { visualRelationshipKinds } from "./visual-composer";

export const openverseLicenseIds = ["cc0", "pdm", "by", "by-sa"] as const;

const sceneLayoutSchema = z.enum(["two-column-object-grid", "existing-composition", "procedural-scene", "full-landscape", "cross-section", "hero-object-focus", "step-by-step-process", "before-and-after", "connected-environment", "scientific-diagram"]);
const sceneCompositionTypeSchema = z.enum(["full-landscape", "cross-section", "hero-object-focus", "step-by-step-process", "before-and-after", "connected-environment", "scientific-diagram"]);
const paletteSchema = z.object({ canvas: z.string().regex(/^#[0-9a-fA-F]{6}$/), surface: z.string().regex(/^#[0-9a-fA-F]{6}$/), primary: z.string().regex(/^#[0-9a-fA-F]{6}$/), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/), text: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).strict();

export const reusableSceneInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  tags: z.array(z.string().trim().min(1).max(60)).max(20),
  concepts: z.array(z.string().trim().min(1).max(100)).max(20),
  styleId: z.literal("clean-flat-2d"),
  layout: sceneLayoutSchema,
  compositionType: sceneCompositionTypeSchema.optional(),
  composition: visualCompositionSchema,
  palette: paletteSchema,
  motionIntent: z.enum(["particle-flow", "path-animation", "keyword-highlight", "focus-shift", "gentle-reveal"]),
  motionSummary: z.string().trim().min(1).max(240),
  motionPlan: z.array(motionCuePlanSchema).max(24),
  objects: z.array(z.object({ objectId: z.enum(visualObjectIds), assetId: z.enum(visualObjectIds), role: z.string().min(1).max(120), label: z.string().min(1).max(80) }).strict()).max(12),
  relationships: z.array(z.object({ from: z.enum(visualObjectIds), relation: z.enum(visualRelationshipKinds), to: z.enum(visualObjectIds) }).strict()).max(12),
  visualFocus: z.enum(visualObjectIds).nullable(),
  assetIds: z.array(z.string().regex(/^upload-[a-f0-9]{64}\.(png|jpg|webp|svg)$/)).max(24),
  thumbnailDataUrl: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(180_000),
  provenance: z.string().trim().min(1).max(300).default("User-authored reusable composition"),
}).strict();

export type ReusableSceneInput = z.infer<typeof reusableSceneInputSchema>;

export type OpenverseImage = {
  id: string;
  title: string;
  thumbnail: string;
  url: string;
  landingUrl: string;
  creator: string;
  creatorUrl: string;
  license: string;
  licenseVersion: string;
  licenseUrl: string;
  attribution: string;
  provider: string;
  source: string;
  category: string;
  width: number;
  height: number;
  filetype: string;
  filesize: number | null;
};

export type TablerIconEntry = { id: string; category: string; tags: string[]; license: "MIT"; packageVersion: string; previewUrl: string };
