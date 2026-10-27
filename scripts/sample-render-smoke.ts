import "dotenv/config";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parseResearchPackage } from "../src/domain/research";
import { RENDERER_VERSION } from "../src/video/renderer-version";

const execFileAsync = promisify(execFile);
const outputDir = process.env.SAMPLE_RENDER_OUTPUT_DIR
  ? path.resolve(process.cwd(), process.env.SAMPLE_RENDER_OUTPUT_DIR)
  : await mkdtemp(path.join(os.tmpdir(), "ai-facts-sample-renders-"));
const cleanupOutput = !process.env.SAMPLE_RENDER_OUTPUT_DIR;
const samples = ["mountain-formation", "volcano-formation", "lightning-charge", "kenapa-air-laut-asin"];

try {
  for (const name of samples) {
    const parsed = parseResearchPackage(JSON.parse(await readFile(path.resolve("samples", `${name}.json`), "utf8")));
    assert.equal(parsed.success, true, `${name} package should migrate/validate`);
    if (!parsed.success) throw new Error(`${name} package invalid`);
    const titleSlug = parsed.data.title.normalize("NFKD").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 64) || "facts-video";
    const output = path.join(outputDir, `${titleSlug}.mp4`);
    const manifestPath = output.replace(/\.mp4$/i, ".manifest.json");
    const ffprobePath = output.replace(/\.mp4$/i, ".ffprobe.json");
    const audioReportPath = output.replace(/\.mp4$/i, ".audio-validation.json");
    if ([output, manifestPath, ffprobePath, audioReportPath].some(existsSync)) throw new Error(`Sample review output exists; preserving it: ${path.relative(process.cwd(), output)}.`);
    await execFileAsync(process.execPath, ["--import", "tsx", "scripts/render.ts", `samples/${name}.json`], {
      cwd: process.cwd(),
      env: { ...process.env, RENDER_OUTPUT_DIR: outputDir },
      timeout: 600_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const manifest = JSON.parse(await readFile(path.join(outputDir, `${titleSlug}.manifest.json`), "utf8")) as {
      rendererVersion: number; videoCodec: string; audioCodec: string | null; audioValidation: string; audioMeanVolumeDb: number | null; audioMaxVolumeDb: number | null; width: number; height: number; durationSec: number; bytes: number; sha256: string;
    };
    assert.equal(manifest.rendererVersion, RENDERER_VERSION);
    assert.equal(manifest.videoCodec, "h264");
    assert.equal(manifest.audioCodec, "aac");
    assert.equal(manifest.audioValidation, "silent-expected", `${name} remains an explicitly silent sample render`);
    assert.equal(manifest.width, 1080);
    assert.equal(manifest.height, 1920);
    assert.ok(Math.abs(manifest.durationSec - parsed.data.targetDurationSec) < 0.1);
    const { stdout: ffprobeOutput } = await execFileAsync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", output], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    const probe = JSON.parse(ffprobeOutput) as { streams?: Array<{ codec_type: string; codec_name: string; width?: number; height?: number }> };
    const video = probe.streams?.find((stream) => stream.codec_type === "video");
    const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
    assert.equal(video?.codec_name, "h264");
    assert.equal(video?.width, 1080);
    assert.equal(video?.height, 1920);
    assert.equal(audio?.codec_name, "aac");
    await writeFile(ffprobePath, JSON.stringify(probe, null, 2), { flag: "wx" });
    await writeFile(audioReportPath, JSON.stringify({ source: "silent sample", audioCodec: audio?.codec_name, validation: manifest.audioValidation, meanVolumeDb: manifest.audioMeanVolumeDb, maxVolumeDb: manifest.audioMaxVolumeDb, narration: false }, null, 2), { flag: "wx" });
    console.log(`${name}: renderer V${manifest.rendererVersion}, ${manifest.durationSec.toFixed(2)} sec, ${manifest.width}x${manifest.height}, H.264, ${manifest.bytes} bytes, SHA-256 ${manifest.sha256}`);
  }
} finally {
  if (cleanupOutput) await rm(outputDir, { recursive: true, force: true });
}
