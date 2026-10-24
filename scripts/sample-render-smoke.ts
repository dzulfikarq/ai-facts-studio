import "dotenv/config";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parseResearchPackage } from "../src/domain/research";

const execFileAsync = promisify(execFile);
const outputDir = process.env.SAMPLE_RENDER_OUTPUT_DIR
  ? path.resolve(process.cwd(), process.env.SAMPLE_RENDER_OUTPUT_DIR)
  : await mkdtemp(path.join(os.tmpdir(), "ai-facts-sample-renders-"));
const cleanupOutput = !process.env.SAMPLE_RENDER_OUTPUT_DIR;
const samples = ["mountain-formation", "lightning-charge", "kenapa-air-laut-asin"];

try {
  for (const name of samples) {
    const parsed = parseResearchPackage(JSON.parse(await readFile(path.resolve("samples", `${name}.json`), "utf8")));
    assert.equal(parsed.success, true, `${name} package should migrate/validate`);
    if (!parsed.success) throw new Error(`${name} package invalid`);
    const titleSlug = parsed.data.title.normalize("NFKD").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 64) || "facts-video";
    await execFileAsync(process.execPath, ["--import", "tsx", "scripts/render.ts", `samples/${name}.json`], {
      cwd: process.cwd(),
      env: { ...process.env, RENDER_OUTPUT_DIR: outputDir },
      timeout: 600_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const manifest = JSON.parse(await readFile(path.join(outputDir, `${titleSlug}.manifest.json`), "utf8")) as {
      rendererVersion: number; videoCodec: string; width: number; height: number; durationSec: number; bytes: number; sha256: string;
    };
    assert.equal(manifest.rendererVersion, 2);
    assert.equal(manifest.videoCodec, "h264");
    assert.equal(manifest.width, 1080);
    assert.equal(manifest.height, 1920);
    assert.ok(Math.abs(manifest.durationSec - parsed.data.targetDurationSec) < 0.1);
    console.log(`${name}: renderer V${manifest.rendererVersion}, ${manifest.durationSec.toFixed(2)} sec, ${manifest.width}x${manifest.height}, H.264, ${manifest.bytes} bytes, SHA-256 ${manifest.sha256}`);
  }
} finally {
  if (cleanupOutput) await rm(outputDir, { recursive: true, force: true });
}
