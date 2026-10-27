import { z } from "zod";
import { visualCompositionSchema, type VisualComposition, type VisualNode } from "./visual-composition";

const maxLayers = 8;
const maxNodes = 32;
const maxPathData = 8_192;
const maxPathCommands = 384;
const maxSpecBytes = 48 * 1024;

const vectorCompositionSchema = visualCompositionSchema.superRefine((composition, ctx) => {
  if (composition.layers.length > maxLayers) ctx.addIssue({ code: "custom", message: `Maksimum ${maxLayers} layer AI Vector`, path: ["layers"] });
  let pathDataLength = 0;
  let pathCommandCount = 0;
  let nodeCount = 0;
  composition.layers.forEach((layer, layerIndex) => {
    layer.nodes.forEach((node, nodeIndex) => {
      nodeCount++;
      if (node.type !== "shape" && node.type !== "path" && node.type !== "text") {
        ctx.addIssue({ code: "custom", message: "AI Vector hanya menerima shape, path, dan text deklaratif", path: ["layers", layerIndex, "nodes", nodeIndex] });
      }
      if (node.type === "path") {
        pathDataLength += node.d.length;
        pathCommandCount += node.d.match(/[MmLlHhVvCcSsQqTtAaZz]/g)?.length ?? 0;
        const pathValues = node.d.match(/[+-]?(?:\d*\.)?\d+/g)?.map(Number) ?? [];
        if (pathValues.some((value) => value < 0 || value > 100)) {
          ctx.addIssue({ code: "custom", message: "Koordinat path harus berada dalam viewBox 0–100", path: ["layers", layerIndex, "nodes", nodeIndex] });
        }
      }
    });
  });
  if (nodeCount > maxNodes) ctx.addIssue({ code: "custom", message: `Maksimum ${maxNodes} node AI Vector`, path: ["layers"] });
  if (pathDataLength > maxPathData) ctx.addIssue({ code: "custom", message: `Total path data melebihi ${maxPathData} karakter`, path: ["layers"] });
  if (pathCommandCount > maxPathCommands) ctx.addIssue({ code: "custom", message: `Total path melebihi ${maxPathCommands} command`, path: ["layers"] });
  if (new TextEncoder().encode(JSON.stringify(composition)).byteLength > maxSpecBytes) {
    ctx.addIssue({ code: "custom", message: `Spesifikasi AI Vector melebihi ${maxSpecBytes} byte`, path: [] });
  }
});

export const aiVectorIllustrationSchema = z.object({
  schemaVersion: z.literal("ai-vector-v1"),
  description: z.string().trim().min(1).max(240),
  composition: vectorCompositionSchema,
}).strict();

export type AiVectorIllustration = z.infer<typeof aiVectorIllustrationSchema>;

export function parseAiVectorIllustration(text: string): AiVectorIllustration {
  if (new TextEncoder().encode(text).byteLength > maxSpecBytes) throw new Error(`AI Vector output melebihi batas ${maxSpecBytes} byte.`);
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error("AI Vector output bukan JSON valid."); }
  const parsed = aiVectorIllustrationSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`AI Vector output ditolak schema: ${parsed.error.issues.slice(0, 6).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  return parsed.data;
}

export function vectorIllustrationNodeCount(composition: VisualComposition) {
  return composition.layers.reduce((count, layer) => count + layer.nodes.reduce((layerCount, node: VisualNode) => layerCount + (node.type === "group" ? 1 + node.children.length : 1), 0), 0);
}
