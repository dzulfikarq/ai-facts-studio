import { z } from "zod";

export const sceneMediaSchema = z.object({
  type: z.literal("video"),
  name: z.string().trim().min(1).max(255),
  file: z.string().regex(/^[a-f0-9]{64}\.mp4$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive().max(150 * 1024 * 1024),
  posterFile: z.string().regex(/^[a-f0-9]{64}\.jpg$/),
  posterSha256: z.string().regex(/^[a-f0-9]{64}$/),
  posterBytes: z.number().int().positive().max(2 * 1024 * 1024),
  posterTrimOutSec: z.number().positive().max(120).optional(),
  sourceFormat: z.enum(["mp4", "gif"]),
  sourceMimeType: z.enum(["video/mp4", "image/gif"]),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceBytes: z.number().int().positive().max(100 * 1024 * 1024),
  sourceVideoCodec: z.string().trim().min(1).max(60),
  sourceAudioCodec: z.string().trim().min(1).max(60).nullable(),
  sourceWidth: z.number().int().positive().max(3840),
  sourceHeight: z.number().int().positive().max(3840),
  sourceFrameRate: z.number().positive().max(60),
  sourceDurationSec: z.number().positive().max(120),
  videoCodec: z.literal("h264"),
  audioCodec: z.string().trim().min(1).max(60).nullable(),
  width: z.number().int().positive().max(1920),
  height: z.number().int().positive().max(1920),
  frameRate: z.literal(30),
  durationSec: z.number().positive().max(120),
  trimInSec: z.number().min(0).max(120).default(0),
  trimOutSec: z.number().positive().max(120),
  fit: z.enum(["cover", "contain"]).default("cover"),
  position: z.enum(["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"]).default("center"),
  shortClip: z.enum(["loop", "freeze-last-frame"]).default("loop"),
  audioEnabled: z.boolean().default(false),
}).strict().superRefine((media, ctx) => {
  if (media.sourceFormat === "gif" && media.sourceMimeType !== "image/gif" || media.sourceFormat === "mp4" && media.sourceMimeType !== "video/mp4") {
    ctx.addIssue({ code: "custom", message: "Format dan MIME sumber tidak cocok.", path: ["sourceMimeType"] });
  }
  if (media.file !== `${media.sha256}.mp4`) ctx.addIssue({ code: "custom", message: "Nama file media tidak cocok dengan SHA-256.", path: ["file"] });
  if (media.posterFile !== `${media.posterSha256}.jpg`) ctx.addIssue({ code: "custom", message: "Nama poster tidak cocok dengan SHA-256.", path: ["posterFile"] });
  if (media.posterTrimOutSec !== undefined && media.posterTrimOutSec > media.durationSec) ctx.addIssue({ code: "custom", message: "Waktu poster melewati durasi klip.", path: ["posterTrimOutSec"] });
  if (media.trimInSec >= media.trimOutSec || media.trimOutSec > media.durationSec) {
    ctx.addIssue({ code: "custom", message: "Rentang trim harus berada di dalam durasi klip.", path: ["trimOutSec"] });
  }
});

export type SceneMedia = z.infer<typeof sceneMediaSchema>;

export function isAnimatedMediaFile(file: Pick<File, "type" | "name">) {
  return file.type === "video/mp4" && /\.mp4$/i.test(file.name) || file.type === "image/gif" && /\.gif$/i.test(file.name);
}
