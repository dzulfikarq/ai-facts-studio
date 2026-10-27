import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseResearchPackage } from "../src/domain/research";
import { LEGACY_RENDERER_VERSION, PREVIOUS_RENDERER_VERSION, RENDERER_VERSION } from "../src/video/renderer-version";
import type { ResearchPackage } from "../src/domain/research";
import { renderSnapshot } from "./render-core";

const execFileAsync = promisify(execFile);
const version = Number(process.argv[2]);
assert.ok([RENDERER_VERSION, PREVIOUS_RENDERER_VERSION, LEGACY_RENDERER_VERSION].includes(version));
const outputPath = path.resolve(process.argv[3]!);
const audioName = process.argv[4]!;
const audioPath = path.resolve("public/audio", audioName);
const short = parseResearchPackage(JSON.parse(await readFile("samples/mountain-formation.json", "utf8")));
assert.equal(short.success, true);
if (!short.success) throw new Error("Mountain package invalid.");
const current = { ...short.data, targetDurationSec: 2, scenes: [{ ...short.data.scenes[0]!, startSec: 0, endSec: 2 }] };
let research: ResearchPackage = current;
if (version === LEGACY_RENDERER_VERSION) {
  const legacy = structuredClone(current) as unknown as { schemaVersion: string; scenes: Array<Record<string, unknown>> };
  legacy.schemaVersion = "1.0";
  for (const scene of legacy.scenes) { delete scene.visualComposition; delete scene.motionPlan; }
  research = legacy as unknown as ResearchPackage;
} else if (version === PREVIOUS_RENDERER_VERSION) {
  const previous = structuredClone(current) as unknown as { scenes: Array<Record<string, unknown>> };
  for (const scene of previous.scenes) delete scene.motionActions;
  research = previous as unknown as ResearchPackage;
}

try {
  await execFileAsync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "pcm_s16le", audioPath]);
  const audioSha256 = createHash("sha256").update(await readFile(audioPath)).digest("hex");
  await assert.rejects(renderSnapshot({ research, audio: { file: `audio/${audioName}`, durationSec: 2, source: "upload", sha256: "0".repeat(64) }, ...(version !== LEGACY_RENDERER_VERSION ? { rendererVersion: version } : {}) }, outputPath), /SHA-256/, "modified snapshot audio must fail integrity check before render");
  const manifest = await renderSnapshot({
    research,
    audio: { file: `audio/${audioName}`, durationSec: 2, source: "upload", sha256: audioSha256 },
    ...(version !== LEGACY_RENDERER_VERSION ? { rendererVersion: version } : {}),
  }, outputPath, () => {}, 1 / 3);
  assert.equal(manifest.rendererVersion, version);
  assert.equal(manifest.videoCodec, "h264");
  assert.equal(manifest.audioCodec, "aac");
  assert.equal(manifest.audioValidation, "pass");
  assert.equal(manifest.audioSource, "upload");
  assert.equal(manifest.audioSha256, audioSha256);
  assert.equal(manifest.width, 360);
  assert.equal(manifest.height, 640);
  assert.ok(manifest.durationSec > 1.8 && manifest.durationSec < 2.2);
  console.log(`PASS: renderer V${version} ${manifest.durationSec.toFixed(1)}s ${manifest.width}x${manifest.height} H.264 + AAC SHA-256 ${manifest.sha256}`);
} finally {
  await Promise.all([rm(audioPath, { force: true }), rm(outputPath, { force: true })]);
}
