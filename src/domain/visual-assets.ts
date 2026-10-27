import { z } from "zod";

const assetFileSchema = z.string().regex(/^[a-f0-9]{64}\.(png|jpg|webp|svg)$/);

export const visualAssetSchema = z.object({
  id: z.string().regex(/^upload-[a-f0-9]{64}\.(png|jpg|webp|svg)$/),
  name: z.string().trim().min(1).max(120),
  visualCategory: z.enum(["user-illustration", "openverse-illustration", "tabler-icon"]).default("user-illustration"),
  assetType: z.enum(["illustration", "icon-object"]).default("illustration"),
  semanticTags: z.array(z.string().trim().min(1).max(60)).max(20),
  supportedConcepts: z.array(z.string().trim().min(1).max(80)).max(12),
  role: z.string().trim().min(1).max(120),
  format: z.enum(["png", "jpeg", "webp", "svg"]),
  aspectRatio: z.number().positive().max(100),
  source: z.enum(["user-upload", "ai-generated", "openverse", "tabler-pack"]),
  provider: z.string().trim().min(1).max(120).optional(),
  creator: z.string().trim().min(1).max(300).optional(),
  attribution: z.string().trim().min(1).max(1000).optional(),
  sourceUrl: z.string().url().max(2000).optional(),
  licenseUrl: z.string().url().max(2000).optional(),
  license: z.string().trim().min(1).max(300),
  style: z.string().trim().min(1).max(120).default("clean-flat-2d"),
  prompt: z.string().trim().min(1).max(12000).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  usageMetadata: z.string().trim().min(1).max(1000).optional(),
  originalName: z.string().trim().min(1).max(255).optional(),
  originalMimeType: z.enum(["image/png", "image/jpeg", "image/webp"]).optional(),
  originalBytes: z.number().int().positive().max(10 * 1024 * 1024).optional(),
  originalSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  createdAt: z.string().datetime().default(() => new Date().toISOString()),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive().max(10 * 1024 * 1024),
  width: z.number().int().min(1).max(8192),
  height: z.number().int().min(1).max(8192),
  file: assetFileSchema,
}).strict().superRefine((asset, ctx) => {
  if (asset.id !== `upload-${asset.file}` || asset.sha256 !== asset.file.slice(0, 64)) ctx.addIssue({ code: "custom", message: "ID aset harus cocok dengan hash file.", path: ["id"] });
  if (asset.aspectRatio !== asset.width / asset.height) ctx.addIssue({ code: "custom", message: "Rasio aset tidak cocok dengan dimensinya.", path: ["aspectRatio"] });
  if ((asset.format === "jpeg" ? "jpg" : asset.format) !== asset.file.split(".").at(-1)) ctx.addIssue({ code: "custom", message: "Format aset tidak cocok dengan file.", path: ["format"] });
  if (asset.source === "ai-generated" && !asset.prompt) ctx.addIssue({ code: "custom", message: "Aset AI-generated harus menyimpan prompt asal.", path: ["prompt"] });
});

export type VisualAsset = z.infer<typeof visualAssetSchema>;
export type VisualLibraryEntry = (VisualAsset & { projectIds: string[]; previewUrl: string; localAvailable: boolean; referenceCount: number }) | {
  id: "sun" | "cloud" | "lightning";
  name: string;
  source: "built-in";
  format: "svg";
  width: number;
  height: number;
  style: string;
  license: string;
  semanticTags: string[];
  projectIds: [];
  previewUrl: string;
  localAvailable: boolean;
  referenceCount: number;
};

// ponytail: header-only signature/dimension validation; use a sandboxed decoder if uploads expand beyond this local review workflow.
export function inspectRasterImage(buffer: Buffer) {
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw new Error("Ukuran ilustrasi harus 1 byte–10 MB.");
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    if (buffer.length < 24 || buffer.toString("ascii", 12, 16) !== "IHDR") throw new Error("Header PNG tidak valid.");
    return { format: "png" as const, extension: "png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < buffer.length) {
      if (buffer[offset] !== 0xff) throw new Error("Struktur JPEG tidak valid.");
      while (buffer[offset] === 0xff) offset++;
      const marker = buffer[offset++]!;
      if (marker === 0xd9 || marker === 0xda) break;
      if ([0xd8, 0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7].includes(marker)) continue;
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) throw new Error("Struktur JPEG tidak valid.");
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { format: "jpeg" as const, extension: "jpg", height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
      }
      offset += length;
    }
    throw new Error("JPEG tidak memiliki frame gambar yang valid.");
  }
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8X" && buffer.length >= 30) return { format: "webp" as const, extension: "webp", width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    if (chunk === "VP8 " && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
      return { format: "webp" as const, extension: "webp", width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
      const b1 = buffer[21]!; const b2 = buffer[22]!; const b3 = buffer[23]!; const b4 = buffer[24]!;
      return { format: "webp" as const, extension: "webp", width: 1 + ((b2 & 0x3f) << 8) + b1, height: 1 + ((b4 & 0x0f) << 10) + (b3 << 2) + ((b2 & 0xc0) >> 6) };
    }
  }
  throw new Error("Ilustrasi harus PNG, JPEG, atau WebP valid. SVG tidak didukung.");
}

export function validateRasterImage(buffer: Buffer) {
  const image = inspectRasterImage(buffer);
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 64 || image.height < 64 || image.width > 8192 || image.height > 8192 || image.width * image.height > 40_000_000) {
    throw new Error("Dimensi ilustrasi harus 64–8192 px dan maksimal 40 megapiksel.");
  }
  return image;
}
