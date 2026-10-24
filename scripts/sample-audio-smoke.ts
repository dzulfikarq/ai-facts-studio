import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseResearchPackage, type ResearchPackage } from "../src/domain/research";

const execFileAsync = promisify(execFile);
const outputDir = path.resolve(process.env.SAMPLE_AUDIO_OUTPUT_DIR ?? "renders/v1.0.4-review/mock-audio-validation");
const fixtureDir = path.resolve("public/audio/test-fixtures");
const runId = randomUUID();
const samples = ["mountain-formation", "lightning-charge", "kenapa-air-laut-asin"];
const fixturePaths: string[] = [];
const packages: Array<{ name: string; titleSlug: string; research: ResearchPackage }> = [];
const fixtures: Array<{ name: string; titleSlug: string; research: ResearchPackage; fixtureName: string; audioSha256: string }> = [];
await mkdir(outputDir, { recursive: true });
await mkdir(fixtureDir, { recursive: true });

try {
  for (const name of samples) {
    const parsed = parseResearchPackage(JSON.parse(await readFile(path.resolve("samples", `${name}.json`), "utf8")));
    assert.equal(parsed.success, true, `${name} package should validate`);
    if (!parsed.success) throw new Error(`${name} package invalid.`);
    const titleSlug = parsed.data.title.normalize("NFKD").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 64) || "facts-video";
    const outputPath = path.join(outputDir, `${titleSlug}.mock-fixture.mp4`);
    const manifestPath = outputPath.replace(/\.mp4$/i, ".manifest.json");
    if (existsSync(outputPath) || existsSync(manifestPath)) throw new Error(`Review output exists; preserving it: ${path.relative(process.cwd(), outputPath)}.`);
    packages.push({ name, titleSlug, research: parsed.data });
  }

  for (const sample of packages) {
    const fixtureName = `${runId}-${sample.name}.wav`;
    const fixturePath = path.join(fixtureDir, fixtureName);
    fixturePaths.push(fixturePath);
    await execFileAsync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `sine=frequency=440:duration=${sample.research.targetDurationSec}`, "-c:a", "pcm_s16le", fixturePath], { timeout: 120_000 });
    const audioSha256 = createHash("sha256").update(await readFile(fixturePath)).digest("hex");
    fixtures.push({ ...sample, fixtureName, audioSha256 });
  }
  for (const fixture of fixtures) {
    const outputPath = path.join(outputDir, `${fixture.titleSlug}.mock-fixture.mp4`);
    const manifestPath = outputPath.replace(/\.mp4$/i, ".manifest.json");
    const ffprobePath = outputPath.replace(/\.mp4$/i, ".ffprobe.json");
    const audioReportPath = outputPath.replace(/\.mp4$/i, ".audio-validation.json");
    if ([outputPath, manifestPath, ffprobePath, audioReportPath].some(existsSync)) throw new Error(`Review output exists; preserving it: ${path.relative(process.cwd(), outputPath)}.`);
    try {
      const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "scripts/sample-audio-render.ts", fixture.name, fixture.fixtureName, outputPath, fixture.audioSha256], {
        cwd: process.cwd(), timeout: 600_000, maxBuffer: 4 * 1024 * 1024,
      });
      const manifest = JSON.parse(stdout) as Awaited<ReturnType<typeof import("./render-core").renderSnapshot>> & { audioSource: string; audioSha256: string; audioValidation: string; audioMeanVolumeDb: number; audioMaxVolumeDb: number };
      assert.equal(manifest.rendererVersion, 2);
      assert.equal(manifest.videoCodec, "h264");
      assert.equal(manifest.audioCodec, "aac");
      assert.equal(manifest.audioSource, "mock-fixture");
      assert.equal(manifest.audioSha256, fixture.audioSha256);
      assert.equal(manifest.audioValidation, "pass");
      assert.equal(manifest.width, 1080);
      assert.equal(manifest.height, 1920);
      assert.ok(Math.abs(manifest.durationSec - fixture.research.targetDurationSec) < 0.1);
      assert.ok(manifest.audioMeanVolumeDb !== null && manifest.audioMeanVolumeDb > -45);
      assert.ok(manifest.audioMaxVolumeDb !== null && manifest.audioMaxVolumeDb < -0.1);
      const { stdout: ffprobeOutput } = await execFileAsync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", outputPath], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
      const probe = JSON.parse(ffprobeOutput) as { streams?: Array<{ codec_type: string; codec_name: string; width?: number; height?: number }> };
      const video = probe.streams?.find((stream) => stream.codec_type === "video");
      const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
      assert.equal(video?.codec_name, "h264");
      assert.equal(video?.width, 1080);
      assert.equal(video?.height, 1920);
      assert.equal(audio?.codec_name, "aac");
      await writeFile(ffprobePath, JSON.stringify(probe, null, 2), { flag: "wx" });
      await writeFile(audioReportPath, JSON.stringify({ source: "mock-fixture (FFmpeg sine, not speech)", audioCodec: audio?.codec_name, inputAudioSha256: fixture.audioSha256, validation: manifest.audioValidation, meanVolumeDb: manifest.audioMeanVolumeDb, maxVolumeDb: manifest.audioMaxVolumeDb, durationSec: manifest.audioDurationSec, narrationContentVerified: false }, null, 2), { flag: "wx" });
      console.log(`${fixture.name}: ${manifest.durationSec.toFixed(2)} sec H.264/AAC; source=mock-fixture (tone, not speech); mean=${manifest.audioMeanVolumeDb} dB; SHA-256 ${manifest.sha256}`);
    } catch (error) {
      await rm(outputPath, { force: true });
      await rm(manifestPath, { force: true });
      throw error;
    }
  }
} finally {
  await Promise.all(fixturePaths.map((fixturePath) => rm(fixturePath, { force: true })));
}
