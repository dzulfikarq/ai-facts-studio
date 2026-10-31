import { z } from "zod";

export const outroSelectionSchema = z.object({
  assetId: z.string().uuid(),
  enabled: z.boolean(),
  trimInSec: z.number().min(0).max(120),
  trimOutSec: z.number().positive().max(120),
  audioEnabled: z.boolean(),
}).strict().superRefine((outro, ctx) => {
  if (outro.trimInSec >= outro.trimOutSec) ctx.addIssue({ code: "custom", message: "Rentang trim outro tidak valid.", path: ["trimOutSec"] });
});

export type OutroSelection = z.infer<typeof outroSelectionSchema>;

export type OutroLibraryAsset = {
  id: string;
  name: string;
  file: string;
  sha256: string;
  bytes: number;
  posterFile: string;
  posterSha256: string;
  posterBytes: number;
  durationSec: number;
  width: number;
  height: number;
  videoCodec: "h264";
  audioCodec: string | null;
  frameRate: 30;
  isDefault: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  projectReferenceCount?: number;
  localAvailable: boolean;
  previewUrl: string;
  posterUrl: string;
};

export type OutroRenderInput = {
  assetId?: string;
  name?: string;
  file: string;
  sha256: string;
  bytes: number;
  durationSec: number;
  enabled?: boolean;
  trimInSec: number;
  trimOutSec: number;
  audioEnabled: boolean;
};

export function outroTrimFrames(outro: { enabled?: boolean; trimInSec: number; trimOutSec: number } | null | undefined, fps: number) {
  if (!outro || outro.enabled === false) return 0;
  return Math.max(1, Math.round(outro.trimOutSec * fps) - Math.round(outro.trimInSec * fps));
}
