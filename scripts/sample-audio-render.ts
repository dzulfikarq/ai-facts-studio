import "dotenv/config";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseResearchPackage } from "../src/domain/research";
import { RENDERER_VERSION } from "../src/video/renderer-version";
import { renderSnapshot } from "./render-core";

const sampleName = process.argv[2]!;
const fixtureName = process.argv[3]!;
const outputPath = path.resolve(process.argv[4]!);
const audioSha256 = process.argv[5]!;
if (!["mountain-formation", "lightning-charge", "kenapa-air-laut-asin"].includes(sampleName)) throw new Error("Unsupported sample name.");
if (!/^[0-9a-f-]{36}-[a-z-]+\.wav$/i.test(fixtureName)) throw new Error("Invalid generated fixture filename.");
const fixturePath = path.resolve("public/audio/test-fixtures", fixtureName);
if (!fixturePath.startsWith(`${path.resolve("public/audio/test-fixtures")}${path.sep}`)) throw new Error("Fixture path outside test audio root.");
const parsed = parseResearchPackage(JSON.parse(await readFile(path.resolve("samples", `${sampleName}.json`), "utf8")));
assert.equal(parsed.success, true, `${sampleName} package should validate`);
if (!parsed.success) throw new Error(`${sampleName} package invalid.`);
const manifest = await renderSnapshot({
  research: parsed.data,
  rendererVersion: RENDERER_VERSION,
  audio: { file: `audio/test-fixtures/${fixtureName}`, durationSec: parsed.data.targetDurationSec, timingMode: "scaled", source: "mock-fixture", sha256: audioSha256 },
}, outputPath);
const manifestPath = outputPath.replace(/\.mp4$/i, ".manifest.json");
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: "wx" });
process.stdout.write(JSON.stringify(manifest));
