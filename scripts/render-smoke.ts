import "dotenv/config";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseResearchPackage } from "../src/domain/research";
import { renderSnapshot } from "./render-core";

const execFileAsync = promisify(execFile);
const sample = parseResearchPackage(JSON.parse(await readFile("samples/mountain-formation.json", "utf8")));
assert.equal(sample.success, true);
if (!sample.success) throw new Error("Mountain sample invalid.");
const shortResearch = {
  ...sample.data,
  targetDurationSec: 2,
  scenes: [{ ...sample.data.scenes[0]!, endSec: 2 }],
};

const audioPath = path.resolve("public/audio/render-smoke.wav");
const outputPath = path.resolve("renders/render-smoke.mp4");
await mkdir(path.dirname(audioPath), { recursive: true });
try {
  await execFileAsync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "pcm_s16le", audioPath]);
  const manifest = await renderSnapshot({
    research: shortResearch,
    audio: { file: "audio/render-smoke.wav", durationSec: 2 },
  }, outputPath, () => {}, 1 / 3);
  assert.equal(manifest.videoCodec, "h264");
  assert.equal(manifest.audioCodec, "aac");
  assert.equal(manifest.width, 360);
  assert.equal(manifest.height, 640);
  assert.ok(manifest.durationSec > 1.8 && manifest.durationSec < 2.2);
  console.log(`PASS: animated ${manifest.durationSec.toFixed(1)}s MP4 ${manifest.width}x${manifest.height}, H.264 + AAC, SHA-256 ${manifest.sha256}`);
} finally {
  await rm(audioPath, { force: true });
}
