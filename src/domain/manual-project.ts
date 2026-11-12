import { z } from "zod";
import { defaultMotionPlan, defaultVisualComposition } from "./visual-defaults";
import { parseResearchPackage, type ResearchPackage } from "./research";

const sourceUrlSchema = z.string().trim().max(2048).url().refine((value) => {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}, "URL harus memakai HTTP(S) tanpa kredensial.");

export const manualProjectInputSchema = z.object({
  topic: z.string().trim().min(3, "Judul/topik minimal 3 karakter.").max(120, "Judul/topik maksimal 120 karakter."),
  language: z.enum(["id-ID", "en-US", "en-GB"]),
  targetDurationSec: z.union([z.literal(30), z.literal(45), z.literal(60)]),
  deliveryStyle: z.enum(["edukatif", "storytelling", "santai"]),
  additionalInstructions: z.string().trim().max(1000, "Instruksi tambahan maksimal 1.000 karakter."),
  sourceUrls: z.array(sourceUrlSchema).max(10, "Maksimal 10 URL sumber."),
}).strict();

export type ManualProjectInput = z.infer<typeof manualProjectInputSchema>;
export type ManualProjectBrief = Pick<ManualProjectInput, "deliveryStyle" | "additionalInstructions">;

export function buildManualResearchPackage(input: ManualProjectInput, packageId: string = globalThis.crypto.randomUUID()): ResearchPackage {
  const parsedInput = manualProjectInputSchema.parse(input);
  const templateId = "infographic";
  const references = parsedInput.sourceUrls.map((url) => {
    const hostname = new URL(url).hostname.slice(0, 120);
    return { id: `source-${globalThis.crypto.randomUUID()}`, title: hostname, publisher: hostname, url };
  });
  const candidate = {
    schemaVersion: "1.1",
    id: packageId,
    title: parsedInput.topic,
    category: "Fakta Unik",
    visualPreset: "flat-2d-storytelling",
    language: parsedInput.language,
    targetDurationSec: parsedInput.targetDurationSec,
    aspectRatio: "9:16",
    narration: "",
    references,
    scenes: [{
      id: `scene-${globalThis.crypto.randomUUID()}`,
      order: 1,
      startSec: 0,
      endSec: Math.min(5, parsedInput.targetDurationSec),
      narrationText: "Narasi belum diisi.",
      onScreenText: "",
      templateId,
      visualDescription: "",
      motionCues: ["cut"],
      sfxCues: [],
      referenceIds: [],
      visualComposition: defaultVisualComposition(templateId),
      motionPlan: defaultMotionPlan(["cut"]),
      motionActions: [],
    }],
  };
  const parsed = parseResearchPackage(candidate);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Draft manual tidak valid.");
  return parsed.data;
}
