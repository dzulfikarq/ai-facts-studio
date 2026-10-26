import "dotenv/config";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseResearchPackage, type ResearchPackage } from "../src/domain/research";
import { buildVisualStoryboard, applyVisualStoryboard, visualStoryboardQualityGate, visualObjectLibrary, type VisualObjectId } from "../src/domain/visual-storyboard";
import { visualCompositionSchema, type VisualComposition } from "../src/domain/visual-composition";
import { renderSnapshot } from "./render-core";
import { RENDERER_VERSION } from "../src/video/renderer-version";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const outputDir = path.resolve(root, process.env.ILLUSTRATION_POC_DIR ?? "artifacts/illustration-upgrade-final-v2");
if (existsSync(outputDir)) throw new Error(`POC output exists; preserving it: ${path.relative(root, outputDir)}.`);
await mkdir(outputDir, { recursive: true });

async function loadSample(name: string) {
  const parsed = parseResearchPackage(JSON.parse(await readFile(path.join(root, "samples", name), "utf8")));
  if (!parsed.success) throw new Error(`${name} invalid: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  const storyboard = buildVisualStoryboard(parsed.data);
  const gate = visualStoryboardQualityGate(parsed.data, storyboard);
  assert.deepEqual(gate.issues, [], `${name} must pass visual quality gate`);
  const research = parseResearchPackage(applyVisualStoryboard(parsed.data, storyboard));
  if (!research.success) throw new Error(`${name} composed visuals invalid: ${research.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  return { source: parsed.data, storyboard, research: research.data, gate };
}

async function render(name: string, research: ResearchPackage, scale = 1) {
  const output = path.join(outputDir, name);
  const manifest = await renderSnapshot({ research, rendererVersion: RENDERER_VERSION }, output, () => {}, scale);
  await writeFile(output.replace(/\.mp4$/i, ".manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
  return output;
}

async function extractFrame(video: string, seconds: number, output: string) {
  await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(seconds), "-i", video, "-frames:v", "1", "-vf", "scale=324:576", "-y", output], { timeout: 60_000 });
}

async function contactSheet(files: string[], output: string) {
  const inputs = files.flatMap((file) => ["-i", file]);
  const chains = files.map((_, index) => `[${index}:v]setsar=1[v${index}]`).join(";");
  const stack = files.map((_, index) => `[v${index}]`).join("");
  await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", `${chains};${stack}hstack=inputs=${files.length}[out]`, "-map", "[out]", "-frames:v", "1", output], { timeout: 60_000 });
}

const salt = await loadSample("kenapa-air-laut-asin.json");
const earth = await loadSample("bagaimana-bumi-melindungi-kita.json");
await writeFile(path.join(outputDir, "sea-salt-visual-storyboard.json"), JSON.stringify(salt.storyboard, null, 2), { flag: "wx" });
await writeFile(path.join(outputDir, "earth-reuse-visual-storyboard.json"), JSON.stringify(earth.storyboard, null, 2), { flag: "wx" });
await writeFile(path.join(outputDir, "sea-salt-render-input.json"), JSON.stringify(salt.research, null, 2), { flag: "wx" });
await writeFile(path.join(outputDir, "earth-protection-render-input.json"), JSON.stringify(earth.research, null, 2), { flag: "wx" });
await writeFile(path.join(outputDir, "quality-gate-report.json"), JSON.stringify({
  seaSalt: { status: salt.gate.status, issues: salt.gate.issues, reviewNotes: salt.gate.reviewNotes, approvedScenes: salt.storyboard.scenes.filter((scene) => scene.approved).length },
  earthProtection: { status: earth.gate.status, issues: earth.gate.issues, reviewNotes: earth.gate.reviewNotes, approvedScenes: earth.storyboard.scenes.filter((scene) => scene.approved).length },
}, null, 2), { flag: "wx" });

const finalVideo = await render("sea-salt-review.mp4", salt.research);
const motionPreview = await render("sea-salt-motion-preview.mp4", salt.research, 0.35);
const saltFrames: string[] = [];
for (const [index, scene] of salt.research.scenes.entries()) {
  const frame = path.join(outputDir, `sea-salt-scene-${String(index + 1).padStart(2, "0")}.png`);
  await extractFrame(finalVideo, (scene.startSec + scene.endSec) / 2, frame);
  saltFrames.push(frame);
}
await contactSheet(saltFrames, path.join(outputDir, "sea-salt-contact-sheet.png"));

const earthPreview = await render("earth-reuse-motion-preview.mp4", earth.research, 0.35);
const earthReview = await render("earth-protection-review.mp4", earth.research);
const earthFrames: string[] = [];
for (const [index, scene] of earth.research.scenes.entries()) {
  const frame = path.join(outputDir, `earth-reuse-scene-${String(index + 1).padStart(2, "0")}.png`);
  await extractFrame(earthReview, (scene.startSec + scene.endSec) / 2, frame);
  earthFrames.push(frame);
}
await contactSheet(earthFrames, path.join(outputDir, "earth-reuse-contact-sheet.png"));

// ponytail: legacy frame exists only as before/after evidence; product renderer no longer builds icon grids.
function legacyIconGrid(research: ResearchPackage, objectIds: VisualObjectId[]): ResearchPackage {
  const layers = objectIds.slice(0, 8).map((objectId, index) => {
    const x = 70 + (index % 2) * 490;
    const y = 520 + Math.floor(index / 2) * 216;
    return {
      id: `object-${objectId}`, depth: 0.25 + Math.floor(index / 2) * 0.12,
      nodes: [
        { type: "shape" as const, shape: "rect" as const, x, y, width: 450, height: 198, radius: 28, fill: "#ffffff", stroke: "#d8e7e1", strokeWidth: 3 },
        { type: "icon" as const, icon: visualObjectLibrary[objectId].icon, x: x + 164, y: y + 14, width: 122, height: 116, color: "#087f8c" },
        { type: "text" as const, x: x + 16, y: y + 143, width: 418, height: 42, text: visualObjectLibrary[objectId].label, color: "#173740", fontSize: 28, font: "heading" as const, weight: "800" as const, align: "middle" as const },
      ],
    };
  });
  const scene = research.scenes[2]!;
  const legacy = visualCompositionSchema.parse({ background: "#edf3ef", layers }) as VisualComposition;
  return { ...research, targetDurationSec: scene.endSec - scene.startSec, scenes: [{ ...scene, id: "legacy-grid-before", order: 1, startSec: 0, endSec: scene.endSec - scene.startSec, visualComposition: legacy, motionCues: [], motionPlan: [] }] };
}

const beforeResearch = legacyIconGrid(salt.source, salt.storyboard.scenes[2]!.objects.map((object) => object.objectId));
const beforeVideo = await render("legacy-grid-before.mp4", beforeResearch, 0.35);
const beforeFrame = path.join(outputDir, "before-generic-icon-cards.png");
await extractFrame(beforeVideo, 3.2, beforeFrame);
await contactSheet([beforeFrame, saltFrames[2]!], path.join(outputDir, "before-after-river-scene.png"));

console.log(JSON.stringify({ outputDir: path.relative(root, outputDir), finalVideo, motionPreview, saltScenes: saltFrames.length, earthScenes: earthFrames.length, earthReview, earthPreview }, null, 2));
