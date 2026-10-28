import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { sceneMediaSchema } from "../domain/scene-media";

const execFileAsync = promisify(execFile);
const maxInputBytes = 100 * 1024 * 1024;
const maxOutputBytes = 150 * 1024 * 1024;

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function frameRate(value?: string) {
  const [numerator, denominator] = (value ?? "").split("/").map(Number);
  return denominator && numerator ? numerator / denominator : 0;
}

async function probe(filePath: string) {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", filePath], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout) as {
    streams?: Array<{ codec_type: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; duration?: string; nb_read_frames?: string }>;
    format?: { duration?: string };
  };
}

export async function verifyStoredSceneMedia(filePath: string, media: import("../domain/scene-media").SceneMedia) {
  const info = await probe(filePath);
  const video = info.streams?.find((stream) => stream.codec_type === "video");
  const audio = info.streams?.find((stream) => stream.codec_type === "audio");
  const durationSec = Number(info.format?.duration ?? video?.duration ?? 0);
  const fps = frameRate(video?.avg_frame_rate) || frameRate(video?.r_frame_rate);
  if (video?.codec_name !== media.videoCodec || video.width !== media.width || video.height !== media.height
    || Math.abs(fps - media.frameRate) > 0.01 || Math.abs(durationSec - media.durationSec) > 1 / 30
    || (audio?.codec_name ?? null) !== media.audioCodec) {
    throw new Error("Metadata klip tidak cocok dengan codec, dimensi, frame rate, durasi, atau track audio file tersimpan.");
  }
}

export async function validateAndNormalizeSceneMedia(input: Buffer, mimeType: string, originalName: string) {
  if (input.length === 0 || input.length > maxInputBytes) throw new Error("Klip harus berukuran 1 byte–100 MB.");
  const isGif = input.subarray(0, 6).toString("ascii") === "GIF87a" || input.subarray(0, 6).toString("ascii") === "GIF89a";
  const isMp4 = input.length >= 12 && input.subarray(4, 8).toString("ascii") === "ftyp";
  const sourceFormat = isGif ? "gif" : isMp4 ? "mp4" : null;
  const expectedMime = isGif ? "image/gif" : isMp4 ? "video/mp4" : null;
  if (!sourceFormat || mimeType !== expectedMime || path.extname(originalName).toLowerCase() !== `.${sourceFormat}`) {
    throw new Error("Signature, MIME type, dan ekstensi harus cocok dengan MP4 atau GIF animasi.");
  }

  const workingDir = await mkdtemp(path.join(os.tmpdir(), "ai-facts-scene-media-"));
  try {
    const sourcePath = path.join(workingDir, `source.${sourceFormat}`);
    const outputPath = path.join(workingDir, "normalized.mp4");
    const posterPath = path.join(workingDir, "poster.jpg");
    await writeFile(sourcePath, input);
    const sourceProbe = await probe(sourcePath);
    const sourceVideo = sourceProbe.streams?.find((stream) => stream.codec_type === "video");
    const sourceAudio = sourceProbe.streams?.find((stream) => stream.codec_type === "audio");
    if (sourceFormat === "gif" && Number(sourceVideo?.nb_read_frames ?? 0) < 2) throw new Error("GIF harus berisi minimal dua frame animasi.");
    const sourceDurationSec = Number(sourceProbe.format?.duration ?? sourceVideo?.duration ?? 0);
    const sourceFrameRate = frameRate(sourceVideo?.avg_frame_rate) || frameRate(sourceVideo?.r_frame_rate);
    if (!sourceVideo?.codec_name || !sourceVideo.width || !sourceVideo.height) throw new Error("File tidak memiliki track video yang dapat dibaca.");
    if (sourceVideo.width > 3840 || sourceVideo.height > 3840) throw new Error("Resolusi sumber melebihi batas 3840×3840 piksel.");
    if (!Number.isFinite(sourceDurationSec) || sourceDurationSec <= 0 || sourceDurationSec > 120) throw new Error("Durasi klip harus lebih dari 0 dan maksimal 120 detik.");
    if (!Number.isFinite(sourceFrameRate) || sourceFrameRate <= 0 || sourceFrameRate > 60) throw new Error("Frame rate sumber harus lebih dari 0 dan maksimal 60 fps.");

    try {
      await execFileAsync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-xerror", "-err_detect", "explode", "-i", sourcePath, "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1", "-map_chapters", "-1",
        "-vf", "fps=30,scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "128k", "-ac", "2",
        "-t", "120", "-movflags", "+faststart", "-y", outputPath,
      ], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    } catch (error) {
      const details = error instanceof Error && "stderr" in error ? String(error.stderr).trim().slice(-500) : "";
      throw new Error(`FFmpeg gagal membaca atau menormalisasi klip${details ? `: ${details}` : "."}`);
    }
    const outputStat = await stat(outputPath);
    if (outputStat.size <= 0 || outputStat.size > maxOutputBytes) throw new Error("Video hasil normalisasi melewati batas 150 MB.");
    const normalizedProbe = await probe(outputPath);
    const normalizedVideo = normalizedProbe.streams?.find((stream) => stream.codec_type === "video");
    const normalizedAudio = normalizedProbe.streams?.find((stream) => stream.codec_type === "audio");
    const durationSec = Number(normalizedProbe.format?.duration ?? normalizedVideo?.duration ?? 0);
    if (normalizedVideo?.codec_name !== "h264" || !normalizedVideo.width || !normalizedVideo.height || !durationSec) throw new Error("Video hasil normalisasi tidak valid.");
    const lastFrame = Math.max(0, Number(normalizedVideo.nb_read_frames ?? 1) - 1);
    await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", outputPath, "-vf", `select=eq(n\\,${lastFrame})`, "-fps_mode", "vfr", "-map", "0:v:0", "-frames:v", "1", "-q:v", "3", "-pix_fmt", "yuvj420p", "-threads", "1", "-f", "image2", "-y", posterPath], { timeout: 30_000, maxBuffer: 1024 * 1024 });
    const buffer = await readFile(outputPath);
    const poster = await readFile(posterPath);
    if (!poster.length || poster.length > 2 * 1024 * 1024) throw new Error("Poster frame video gagal dibuat.");
    const hash = sha256(buffer);
    const posterHash = sha256(poster);
    const media = sceneMediaSchema.parse({
      type: "video", name: path.basename(originalName).slice(0, 255), file: `${hash}.mp4`, sha256: hash, bytes: buffer.length,
      posterFile: `${posterHash}.jpg`, posterSha256: posterHash, posterBytes: poster.length, posterTrimOutSec: durationSec,
      sourceFormat, sourceMimeType: mimeType, sourceSha256: sha256(input), sourceBytes: input.length,
      sourceVideoCodec: sourceVideo.codec_name, sourceAudioCodec: sourceAudio?.codec_name ?? null,
      sourceWidth: sourceVideo.width, sourceHeight: sourceVideo.height, sourceFrameRate, sourceDurationSec,
      videoCodec: normalizedVideo.codec_name, audioCodec: normalizedAudio?.codec_name ?? null,
      width: normalizedVideo.width, height: normalizedVideo.height, frameRate: 30, durationSec,
      trimInSec: 0, trimOutSec: durationSec, fit: "cover", position: "center", shortClip: "loop", audioEnabled: false,
    });
    return { media, buffer, poster };
  } finally {
    await rm(workingDir, { recursive: true, force: true });
  }
}
