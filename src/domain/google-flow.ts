import { z } from "zod";

export const googleFlowStyleLockSchema = z.object({
  illustrationStyle: z.string().trim().min(1).max(160).default("Premium 2D Editorial Educational Illustration"),
  colorPalette: z.string().trim().min(1).max(500).default("Deep teal, sea-glass green, soft cream, and restrained warm amber; follow project palette."),
  lighting: z.string().trim().min(1).max(300).default("Soft directional editorial lighting with gentle depth; keep highlights controlled."),
  visualComplexity: z.string().trim().min(1).max(300).default("Attractive, detailed, readable illustration; clear foreground, midground, and background."),
  outlineShapeStyle: z.string().trim().min(1).max(300).default("Cohesive hand-shaped forms, clean silhouettes, restrained consistent outlines, subtle texture."),
  compositionGuidelines: z.string().trim().min(1).max(500).default("One full-scene portrait 9:16 composition; strong focal point; leave upper and lower safe space for separately rendered headline and subtitles."),
  consistencyInstructions: z.string().trim().min(1).max(500).default("Keep palette, lighting, outline weight, shape language, and texture consistent across scenes. Consistency is approximate, not guaranteed."),
  referenceAssetIds: z.array(z.string().regex(/^upload-[a-f0-9]{64}\.(png|jpg|webp|svg)$/)).max(8).default([]),
}).strict();

export type GoogleFlowStyleLock = z.infer<typeof googleFlowStyleLockSchema>;

export const defaultGoogleFlowStyleLock = googleFlowStyleLockSchema.parse({});

export function stableGoogleFlowSceneToken(sceneId: string) {
  let first = 2166136261;
  let second = 0x9e3779b9;
  for (let index = 0; index < sceneId.length; index++) {
    const code = sceneId.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ (code + index), 2246822519);
  }
  return `flow-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

export function googleFlowSlug(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("id-ID")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48).replace(/-$/g, "") || "ilustrasi";
}

export function recommendedGoogleFlowFilename(scene: { sceneId: string; sceneNumber: number; headline: string; sceneToken?: string }) {
  const token = scene.sceneToken ?? stableGoogleFlowSceneToken(scene.sceneId);
  return `scene-${String(scene.sceneNumber).padStart(2, "0")}-${googleFlowSlug(scene.headline)}-${token}.webp`;
}

export type GoogleFlowMatchScene = { sceneId: string; sceneNumber: number; headline: string; sceneToken?: string; recommendedFilename?: string };
export type GoogleFlowFileMatch = {
  fileIndex: number;
  fileName: string;
  sceneId: string | null;
  status: "matched" | "unmatched" | "ambiguous" | "duplicate-file" | "scene-conflict" | "number-conflict";
  reason: string;
};

function filenameStem(value: string) {
  return value.split(/[\\/]/).at(-1)!.replace(/\.[^.]+$/, "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("id-ID").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function matchByUnique<T>(items: T[]) {
  return items.length === 1 ? items[0] : undefined;
}

export function matchGoogleFlowFiles(files: readonly { name: string }[], scenes: readonly GoogleFlowMatchScene[]): GoogleFlowFileMatch[] {
  const matches = files.map((file, fileIndex): GoogleFlowFileMatch => {
    const stem = filenameStem(file.name);
    const tokenMatches = scenes.filter((scene) => stem.includes((scene.sceneToken ?? stableGoogleFlowSceneToken(scene.sceneId)).toLocaleLowerCase("id-ID")));
    let candidate = matchByUnique(tokenMatches);
    let reason = "Token scene stabil";
    if (tokenMatches.length > 1) return { fileIndex, fileName: file.name, sceneId: null, status: "ambiguous", reason: "Lebih dari satu token scene ditemukan." };
    if (!candidate) {
      const exactFilenameMatches = scenes.filter((scene) => scene.recommendedFilename && filenameStem(scene.recommendedFilename) === stem);
      candidate = matchByUnique(exactFilenameMatches);
      reason = "Nama file rekomendasi";
      if (exactFilenameMatches.length > 1) return { fileIndex, fileName: file.name, sceneId: null, status: "ambiguous", reason: "Nama file cocok dengan beberapa scene." };
    }

    const numberMatch = stem.match(/(?:^|-)scene-0*(\d+)(?:-|$)/) ?? stem.match(/^0*(\d+)(?:-|$)/);
    const numberedScenes = numberMatch ? scenes.filter((scene) => scene.sceneNumber === Number(numberMatch[1])) : [];
    const slugMatches = scenes.filter((scene) => {
      const slug = googleFlowSlug(scene.headline);
      return slug.length >= 5 && (`-${stem}-`).includes(`-${slug}-`);
    });

    if (candidate) {
      if (numberedScenes.length === 1 && numberedScenes[0]!.sceneId !== candidate.sceneId) {
        return { fileIndex, fileName: file.name, sceneId: null, status: "number-conflict", reason: `Token mengarah ke scene ${candidate.sceneNumber}, nomor file mengarah ke scene ${numberedScenes[0]!.sceneNumber}.` };
      }
    } else if (numberMatch) {
      if (slugMatches.length === 1 && slugMatches[0]!.sceneNumber !== Number(numberMatch[1])) {
        return { fileIndex, fileName: file.name, sceneId: null, status: "number-conflict", reason: `Nomor file ${numberMatch[1]} bertentangan dengan slug scene ${slugMatches[0]!.sceneNumber}.` };
      }
      candidate = matchByUnique(numberedScenes);
      reason = slugMatches.length === 1 ? "Nomor scene + slug" : "Nomor scene unik";
      if (numberedScenes.length > 1 || slugMatches.length > 1) return { fileIndex, fileName: file.name, sceneId: null, status: "ambiguous", reason: "Nomor atau slug cocok dengan beberapa scene." };
    } else {
      candidate = matchByUnique(slugMatches);
      reason = "Slug headline unik";
      if (slugMatches.length > 1) return { fileIndex, fileName: file.name, sceneId: null, status: "ambiguous", reason: "Slug headline cocok dengan beberapa scene." };
    }

    return candidate
      ? { fileIndex, fileName: file.name, sceneId: candidate.sceneId, status: "matched", reason }
      : { fileIndex, fileName: file.name, sceneId: null, status: "unmatched", reason: "Nama file tidak memuat token, nomor, atau slug scene yang unik." };
  });

  const names = new Map<string, number[]>();
  for (const match of matches) {
    const key = filenameStem(match.fileName);
    names.set(key, [...(names.get(key) ?? []), match.fileIndex]);
  }
  for (const indices of names.values()) if (indices.length > 1) for (const index of indices) {
    matches[index] = { ...matches[index]!, sceneId: null, status: "duplicate-file", reason: "Nama file duplikat; tetapkan scene secara manual atau lewati file." };
  }

  const sceneAssignments = new Map<string, number[]>();
  for (const match of matches) if (match.sceneId) sceneAssignments.set(match.sceneId, [...(sceneAssignments.get(match.sceneId) ?? []), match.fileIndex]);
  for (const indices of sceneAssignments.values()) if (indices.length > 1) for (const index of indices) {
    matches[index] = { ...matches[index]!, status: "scene-conflict", reason: "Beberapa file cocok ke scene yang sama; tetapkan ulang sebelum impor." };
  }
  return matches;
}

export function validGoogleFlowAssignments(rows: readonly { sceneId: string | null; skipped: boolean }[]) {
  const counts = new Map<string, number>();
  for (const row of rows) if (!row.skipped && row.sceneId) counts.set(row.sceneId, (counts.get(row.sceneId) ?? 0) + 1);
  return rows.map((row) => Boolean(!row.skipped && row.sceneId && counts.get(row.sceneId) === 1));
}

export function googleFlowPromptPack(projectTitle: string, styleLock: GoogleFlowStyleLock, scenes: readonly {
  sceneId: string; sceneNumber: number; sceneToken: string; recommendedFilename: string; headline: string; narrationText: string; prompt: string;
}[]) {
  const json = { format: "ai-facts-studio-google-flow-v1", projectTitle, styleLock, scenes };
  const fence = "`".repeat(Math.max(3, ...scenes.flatMap((scene) => scene.prompt.match(/`+/g)?.map((run) => run.length + 1) ?? [])));
  const markdown = [
    `# Google Flow Prompt Pack — ${projectTitle}`,
    "",
    "External manual workflow: copy one prompt per scene into official Google Flow. Generation is not connected to this app.",
    "",
    "## Global Style Lock",
    ...Object.entries(styleLock).filter(([key]) => key !== "referenceAssetIds").map(([key, value]) => `- **${key}:** ${value}`),
    ...(styleLock.referenceAssetIds.length ? [`- **Local reference assets:** ${styleLock.referenceAssetIds.join(", ")}. Upload these references to Flow manually when useful; they are not attached by AI Facts Studio.`] : []),
    "",
    ...scenes.flatMap((scene) => [
      `## Scene ${String(scene.sceneNumber).padStart(2, "0")} — ${scene.headline}`,
      `- Scene ID: \`${scene.sceneId}\``,
      `- Stable token: \`${scene.sceneToken}\``,
      `- Recommended filename: \`${scene.recommendedFilename}\``,
      `- Narration: ${scene.narrationText}`,
      "",
      `${fence}text`,
      scene.prompt,
      fence,
      "",
    ]),
  ].join("\n");
  return { json, markdown };
}
