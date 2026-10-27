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
import type { VisualAsset } from "../src/domain/visual-assets";
import { validateAudioQuality } from "../src/domain/media-validation";
import { durationInFrames } from "../src/domain/timeline";
import { LEGACY_RENDERER_VERSION, PREVIOUS_RENDERER_VERSION, RENDERER_VERSION } from "../src/video/renderer-version";

const execFileAsync = promisify(execFile);
const root = process.cwd();
let bundlePromise: ReturnType<typeof bundle> | undefined;

export function invalidateBundleCache() {
  bundlePromise = undefined;
}

export type RenderSnapshot = {
  research: ResearchPackage;
  visualAssets?: VisualAsset[];
  audio?: {
    file: string; durationSec: number; timingMode?: "scaled" | "estimated"; source?: "upload" | "tts" | "mock-fixture"; sha256?: string;
    tts?: { provider: string; model: string; cacheKey?: string; scriptSha256: string; locale: string; voiceId: string; voiceName: string; style: string; speakingRate: number; approvedAt?: string; alignment: "estimated" };
  } | null;
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
  let meanVolumeDb: number | null = null;
  let maxVolumeDb: number | null = null;
  if (audio) {
    const { stderr } = await execFileAsync("ffmpeg", ["-hide_banner", "-nostats", "-i", filePath, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"], { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
    const mean = stderr.match(/mean_volume:\s*(-?[\d.]+|-inf)\s+dB/);
    const peak = stderr.match(/max_volume:\s*(-?[\d.]+|-inf)\s+dB/);
    meanVolumeDb = mean?.[1] && mean[1] !== "-inf" ? Number(mean[1]) : null;
    maxVolumeDb = peak?.[1] && peak[1] !== "-inf" ? Number(peak[1]) : null;
  }
  return {
    videoCodec: video.codec_name,
    audioCodec: audio?.codec_name ?? null,
    width: video.width ?? 0,
    height: video.height ?? 0,
    durationSec: Number(probe.format?.duration ?? video.duration ?? 0),
    audioDurationSec: audio ? Number(audio.duration ?? probe.format?.duration ?? 0) : null,
    audioMeanVolumeDb: meanVolumeDb,
    audioMaxVolumeDb: maxVolumeDb,
    bytes: file.size,
    sha256: checksum,
  };
}

async function verifySnapshotAudio(audio: NonNullable<RenderSnapshot["audio"]>) {
  const allowedRoot = path.resolve(root, "public/audio");
  const audioPath = path.resolve(root, "public", audio.file);
  const relative = path.relative(allowedRoot, audioPath);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Audio snapshot tidak berada di audio store lokal yang diizinkan.");
  }
  if (!audio.sha256) return;
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(audioPath)) hash.update(chunk);
  if (hash.digest("hex") !== audio.sha256) throw new Error("Audio snapshot SHA-256 tidak cocok; audio tidak akan dirender.");
}

async function verifySnapshotVisualAssets(assets: readonly VisualAsset[] = []) {
  const allowedRoot = path.resolve(root, "public/visual-assets");
  for (const asset of assets) {
    if (!/^[a-f0-9]{64}\.(png|jpg|webp|svg)$/.test(asset.file) || asset.sha256 !== asset.file.slice(0, 64)) throw new Error("Aset visual snapshot tidak valid.");
    const filePath = path.resolve(allowedRoot, asset.file);
    if (path.dirname(filePath) !== allowedRoot) throw new Error("Aset visual snapshot keluar dari direktori yang diizinkan.");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(filePath)) hash.update(chunk);
    if (hash.digest("hex") !== asset.sha256) throw new Error(`Hash aset visual snapshot tidak cocok: ${asset.file}.`);
  }
}

export async function renderSnapshot(
  snapshot: RenderSnapshot,
  outputLocation: string,
  onProgress: (progress: number) => void = () => {},
  scale = 1,
) {
  const rendererVersion = snapshot.rendererVersion ?? LEGACY_RENDERER_VERSION;
  if (![LEGACY_RENDERER_VERSION, PREVIOUS_RENDERER_VERSION, RENDERER_VERSION].includes(rendererVersion)) throw new Error(`Renderer version not supported: ${rendererVersion}.`);
  if (snapshot.audio) await verifySnapshotAudio(snapshot.audio);
  await verifySnapshotVisualAssets(snapshot.visualAssets);
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
  const audioQuality = validateAudioQuality({
    expected: Boolean(snapshot.audio),
    codec: manifest.audioCodec,
    videoDurationSec: manifest.durationSec,
    audioDurationSec: manifest.audioDurationSec,
    expectedAudioDurationSec: snapshot.audio?.durationSec,
    meanVolumeDb: manifest.audioMeanVolumeDb,
    maxVolumeDb: manifest.audioMaxVolumeDb,
  });
  return {
    ...manifest,
    ...audioQuality,
    rendererVersion,
    audioSource: snapshot.audio ? snapshot.audio.source ?? "legacy-unknown" : null,
    audioSha256: snapshot.audio?.sha256 ?? null,
    audioProvider: snapshot.audio?.tts?.provider ?? null,
    audioModel: snapshot.audio?.tts?.model ?? null,
    audioCacheKey: snapshot.audio?.tts?.cacheKey ?? null,
    audioScriptSha256: snapshot.audio?.tts?.scriptSha256 ?? null,
    audioVoiceId: snapshot.audio?.tts?.voiceId ?? null,
    audioVoice: snapshot.audio?.tts?.voiceName ?? null,
    audioLocale: snapshot.audio?.tts?.locale ?? null,
    audioStyle: snapshot.audio?.tts?.style ?? null,
    audioSpeakingRate: snapshot.audio?.tts?.speakingRate ?? null,
    audioApprovedAt: snapshot.audio?.tts?.approvedAt ?? null,
  };
}
