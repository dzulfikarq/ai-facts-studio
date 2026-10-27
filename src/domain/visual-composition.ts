import { z } from "zod";

export const visualColorTokens = ["canvas", "surface", "primary", "accent", "text", "muted", "snow", "danger"] as const;
export const visualIconIds = ["sun", "cloud", "lightning", "arrow", "mountain", "planet", "water-drop", "leaf", "bear", "wave", "rock", "river", "crystal", "earth", "atmosphere", "ozone-layer", "uv-ray", "charged-particle", "magnetosphere", "rain", "ocean", "evaporation", "salt-crystal", "volcano", "magma", "tectonic-plates"] as const;
export const trustedImageAssets = ["cloud", "lightning", "sun"] as const;
export const diagramKinds = ["charge-separation", "orbit", "geological-layers", "volcano-cross-section", "water-cycle", "process-flow"] as const;
export const nodeMotions = ["drift", "fall", "flow", "rise", "draw"] as const;

const paletteColorSchema = z.union([
  z.enum(visualColorTokens),
  z.string().regex(/^#[0-9a-fA-F]{6}$/, "Warna harus token palette atau hex #RRGGBB"),
]);
const colorSchema = z.union([z.literal("none"), paletteColorSchema]);

export const visualGradientSchema = z.object({
  type: z.literal("linear-gradient"),
  angle: z.number().min(-360).max(360),
  stops: z.array(z.object({ offset: z.number().min(0).max(1), color: paletteColorSchema, opacity: z.number().min(0).max(1).optional() }).strict()).min(2).max(8),
}).strict().superRefine((gradient, ctx) => {
  for (let index = 1; index < gradient.stops.length; index++) {
    if (gradient.stops[index]!.offset <= gradient.stops[index - 1]!.offset) {
      ctx.addIssue({ code: "custom", message: "Gradient stop harus meningkat tanpa offset duplikat", path: ["stops", index, "offset"] });
    }
  }
});
const paintSchema = z.union([colorSchema, visualGradientSchema]);

const nodeFrame = {
  x: z.number().min(0).max(1080),
  y: z.number().min(0).max(1920),
  width: z.number().positive().max(1080),
  height: z.number().positive().max(1920),
  rotation: z.number().min(-360).max(360).optional(),
  opacity: z.number().min(0).max(1).optional(),
  zIndex: z.number().int().min(-10).max(10).optional(),
  motion: z.enum(nodeMotions).optional(),
};

function validateNodeFrame(node: { x: number; y: number; width: number; height: number; rotation?: number }, ctx: z.RefinementCtx) {
  const angle = (node.rotation ?? 0) * Math.PI / 180;
  const rotatedWidth = Math.abs(node.width * Math.cos(angle)) + Math.abs(node.height * Math.sin(angle));
  const rotatedHeight = Math.abs(node.width * Math.sin(angle)) + Math.abs(node.height * Math.cos(angle));
  if (node.x + (node.width - rotatedWidth) / 2 < 0 || node.x + (node.width + rotatedWidth) / 2 > 1080) {
    ctx.addIssue({ code: "custom", message: "Visual node melewati safe canvas secara horizontal", path: ["x", "width", "rotation"] });
  }
  if (node.y + (node.height - rotatedHeight) / 2 < 0 || node.y + (node.height + rotatedHeight) / 2 > 1920) {
    ctx.addIssue({ code: "custom", message: "Visual node melewati safe canvas secara vertikal", path: ["y", "height", "rotation"] });
  }
}

export const shapeNodeSchema = z.object({
  type: z.literal("shape"), ...nodeFrame,
  shape: z.enum(["rect", "ellipse", "circle", "line", "polygon"]),
  fill: paintSchema.optional(),
  stroke: colorSchema.optional(),
  strokeWidth: z.number().min(0).max(80).optional(),
  radius: z.number().min(0).max(540).optional(),
  points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict()).min(3).max(20).optional(),
}).strict().superRefine((node, ctx) => {
  if (node.shape === "polygon" && !node.points) ctx.addIssue({ code: "custom", message: "Polygon membutuhkan points", path: ["points"] });
  validateNodeFrame(node, ctx);
});

export const pathNodeSchema = z.object({
  type: z.literal("path"), ...nodeFrame,
  d: z.string().min(1).max(2048).regex(/^[MmLlHhVvCcSsQqTtAaZz0-9,.+\-\s]+$/, "SVG path hanya boleh berisi path-data"),
  fill: paintSchema.optional(),
  stroke: colorSchema.optional(),
  strokeWidth: z.number().min(0).max(80).optional(),
  fillRule: z.enum(["nonzero", "evenodd"]).optional(),
}).strict().superRefine(validateNodeFrame);

export const textNodeSchema = z.object({
  type: z.literal("text"), ...nodeFrame,
  text: z.string().max(240),
  color: colorSchema,
  fontSize: z.number().min(10).max(120),
  font: z.enum(["heading", "body", "mono"]).default("body"),
  weight: z.enum(["400", "600", "700", "800"]).default("600"),
  align: z.enum(["start", "middle", "end"]).default("start"),
}).strict().superRefine(validateNodeFrame);

export const iconNodeSchema = z.object({
  type: z.literal("icon"), ...nodeFrame,
  icon: z.enum(visualIconIds),
  color: colorSchema,
}).strict().superRefine(validateNodeFrame);

export const imageNodeSchema = z.object({
  type: z.literal("image"), ...nodeFrame,
  asset: z.union([z.enum(trustedImageAssets), z.string().regex(/^upload-[a-f0-9]{64}\.(png|jpg|webp|svg)$/)]),
  fit: z.enum(["contain", "cover"]).optional(),
  position: z.enum(["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
}).strict().superRefine(validateNodeFrame);

export const diagramNodeSchema = z.object({
  type: z.literal("diagram"), ...nodeFrame,
  kind: z.enum(diagramKinds),
  labels: z.array(z.string().max(80)).max(8).default([]),
  color: colorSchema.optional(),
  accent: colorSchema.optional(),
}).strict().superRefine((node, ctx) => {
  validateNodeFrame(node, ctx);
  if (node.kind === "process-flow" && (node.labels.length < 2 || node.labels.length > 4)) {
    ctx.addIssue({ code: "custom", message: "Process flow membutuhkan 2–4 label langkah", path: ["labels"] });
  }
});

export const visualLeafNodeSchema = z.discriminatedUnion("type", [shapeNodeSchema, pathNodeSchema, textNodeSchema, iconNodeSchema, imageNodeSchema, diagramNodeSchema]);
export const groupNodeSchema = z.object({
  type: z.literal("group"), ...nodeFrame,
  children: z.array(visualLeafNodeSchema).min(1).max(24),
}).strict().superRefine(validateNodeFrame);

export const visualNodeSchema = z.discriminatedUnion("type", [shapeNodeSchema, pathNodeSchema, textNodeSchema, iconNodeSchema, imageNodeSchema, diagramNodeSchema, groupNodeSchema]);
export const visualLayerSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  depth: z.number().min(0).max(1),
  nodes: z.array(visualNodeSchema).min(1).max(32),
}).strict();
export const visualCompositionSchema = z.object({
  background: colorSchema,
  layers: z.array(visualLayerSchema).min(1).max(12),
}).strict().superRefine((composition, ctx) => {
  const ids = new Set<string>();
  composition.layers.forEach((layer, index) => {
    if (ids.has(layer.id)) ctx.addIssue({ code: "custom", message: "Layer ID harus unik", path: ["layers", index, "id"] });
    ids.add(layer.id);
  });
});

export type VisualColorToken = typeof visualColorTokens[number];
export type VisualColor = string;
export type VisualGradient = z.infer<typeof visualGradientSchema>;
export type VisualPaint = VisualColor | VisualGradient;
export type VisualLeafNode = z.infer<typeof visualLeafNodeSchema>;
export type VisualNode = z.infer<typeof visualNodeSchema>;
export type VisualLayerInput = z.input<typeof visualLayerSchema>;
export type VisualLayer = z.output<typeof visualLayerSchema>;
export type VisualCompositionInput = z.input<typeof visualCompositionSchema>;
export type VisualComposition = z.infer<typeof visualCompositionSchema>;

export const motionCueIds = ["fadeIn", "slide", "scale", "pan", "zoom", "parallax", "reveal", "pulse", "cut", "dissolve"] as const;
export const motionEasings = ["linear", "easeIn", "easeOut", "easeInOut", "spring"] as const;

export const motionCuePlanSchema = z.object({
  cue: z.enum(motionCueIds),
  targetLayer: z.string().regex(/^(all|scene|[a-z][a-z0-9-]{0,39})$/),
  delayFrames: z.number().int().min(0).max(900),
  durationFrames: z.number().int().min(1).max(300),
  easing: z.enum(motionEasings),
}).strict();
export type MotionCuePlan = z.infer<typeof motionCuePlanSchema>;
