import { z } from "zod";
import { visualObjectIds } from "./visual-objects";
import { visualRelationshipKinds } from "./visual-composer";

export const visualCompositionTypes = ["full-landscape", "cross-section", "hero-object-focus", "step-by-step-process", "before-and-after", "connected-environment", "scientific-diagram"] as const;
const objectId = z.enum(visualObjectIds);
const relationship = z.object({ from: objectId, relation: z.enum(visualRelationshipKinds), to: objectId }).strict();

export const visualSemanticPlanSchema = z.object({
  primaryVisualConcept: z.string().trim().min(1).max(180),
  objects: z.array(objectId).min(1).max(12),
  relationships: z.array(relationship).max(12),
  environment: z.string().trim().min(1).max(300),
  processAction: z.string().trim().min(1).max(300),
  illustrationStyle: z.enum(["clean-flat-2d", "scientific-diagram", "continuous-landscape"]),
  visualFocus: objectId,
  requiredAssets: z.array(objectId).max(12),
  supportingAssets: z.array(objectId).max(12),
  compositionType: z.enum(visualCompositionTypes),
}).strict().superRefine((plan, ctx) => {
  const objects = new Set(plan.objects);
  if (!objects.has(plan.visualFocus)) ctx.addIssue({ code: "custom", message: "Visual focus harus ada dalam object plan.", path: ["visualFocus"] });
  plan.relationships.forEach((item, index) => {
    if (!objects.has(item.from) || !objects.has(item.to)) ctx.addIssue({ code: "custom", message: "Relationship endpoint harus ada dalam object plan.", path: ["relationships", index] });
  });
  for (const key of ["objects", "requiredAssets", "supportingAssets"] as const) {
    const values = plan[key];
    if (new Set(values).size !== values.length) ctx.addIssue({ code: "custom", message: "ID tidak boleh berulang.", path: [key] });
  }
  const required = new Set(plan.requiredAssets);
  if (plan.supportingAssets.some((asset) => required.has(asset))) ctx.addIssue({ code: "custom", message: "Aset required dan supporting harus terpisah.", path: ["supportingAssets"] });
  for (const key of ["requiredAssets", "supportingAssets"] as const) {
    plan[key].forEach((asset, index) => {
      if (!objects.has(asset)) ctx.addIssue({ code: "custom", message: "Aset harus dideklarasikan dalam object plan.", path: [key, index] });
    });
  }
});

export type VisualSemanticPlan = z.infer<typeof visualSemanticPlanSchema>;
