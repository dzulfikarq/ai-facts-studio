import "dotenv/config";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { ResearchPackage } from "../src/domain/research";
import { durationInFrames } from "../src/domain/timeline";
import { LEGACY_RENDERER_VERSION, RENDERER_VERSION } from "../src/video/renderer-version";

const execFileAsync = promisify(execFile);
const root = process.cwd();
let bundlePromise: ReturnType<typeof bundle> | undefined;

export function invalidateBundleCache() {
  bundlePromise = undefined;
}

export type RenderSnapshot = {
  research: ResearchPackage;
  audio?: { file: string; durationSec: number; timingMode?: "scaled" | "estimated" } | null;
  rendererVersion?: number;
};

export async function inspectMedia(filePath: string) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", filePath,
  ], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  const probe = JSON.parse(stdout) as {
    streams?: Array<{ codec_type: string; codec_name: string; width?: number; height?: number; duration?: string }>;
    format?: { duration?: string };
  };
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
  if (!video) throw new Error("Render tidak menghasilkan video.");
  const file = await stat(filePath);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  const checksum = hash.digest("hex");
  return {
    videoCodec: video.codec_name,
    audioCodec: audio?.codec_name ?? null,
    width: video.width ?? 0,
    height: video.height ?? 0,
    durationSec: Number(probe.format?.duration ?? video.duration ?? 0),
    bytes: file.size,
    sha256: checksum,
  };
}

export async function renderSnapshot(
  snapshot: RenderSnapshot,
  outputLocation: string,
  onProgress: (progress: number) => void = () => {},
  scale = 1,
) {
  const rendererVersion = snapshot.rendererVersion ?? LEGACY_RENDERER_VERSION;
  if (![LEGACY_RENDERER_VERSION, RENDERER_VERSION].includes(rendererVersion)) throw new Error(`Renderer version not supported: ${rendererVersion}.`);
  await mkdir(path.dirname(outputLocation), { recursive: true });
  bundlePromise ??= bundle({
    entryPoint: path.resolve(root, "src/video/entry.tsx"),
    onProgress: () => {},
  }).catch((error) => {
    bundlePromise = undefined;
    throw error;
  });
  const serveUrl = await bundlePromise;
  const inputProps = {
    research: snapshot.research,
    audioFile: snapshot.audio?.file,
    audioDurationSec: snapshot.audio?.durationSec,
    audioTimingMode: snapshot.audio?.timingMode ?? "scaled",
    rendererVersion: snapshot.rendererVersion ?? LEGACY_RENDERER_VERSION,
  };
  const composition = await selectComposition({ serveUrl, id: "FactsVideo", inputProps });
  await renderMedia({
    composition: {
      ...composition,
      durationInFrames: durationInFrames(snapshot.research, snapshot.audio?.durationSec),
    },
    serveUrl,
    codec: "h264",
    audioCodec: "aac",
    outputLocation,
    inputProps,
    scale,
    concurrency: 2,
    onProgress: ({ progress }: { progress: number }) => onProgress(Math.round(progress * 100)),
  });
  const manifest = await inspectMedia(outputLocation);
  if (manifest.videoCodec !== "h264") throw new Error("Codec video hasil render bukan H.264.");
  if (scale === 1 && (manifest.width !== 1080 || manifest.height !== 1920)) {
    throw new Error(`Resolusi hasil render salah: ${manifest.width}x${manifest.height}.`);
  }
  if (snapshot.audio && manifest.audioCodec !== "aac") throw new Error("Audio hasil render bukan AAC.");
  return { ...manifest, rendererVersion };
}
