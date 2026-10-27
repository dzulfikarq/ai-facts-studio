import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseResearchPackage } from "../src/domain/research";
import { applyVisualStoryboard, buildVisualStoryboard } from "../src/domain/visual-storyboard";
import { motionTargetExists, planSceneMotion } from "../src/domain/motion-director";
import { renderSnapshot } from "./render-core";
import { RENDERER_VERSION } from "../src/video/renderer-version";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.resolve(root, process.env.MOTION_DIRECTOR_OUTPUT_DIR ?? `artifacts/motion-director-poc/${stamp}`);
await mkdir(outputDir, { recursive: true });

async function extractFrame(video: string, second: number, output: string) {
  await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(second), "-i", video, "-frames:v", "1", "-vf", "scale=324:576", "-y", output], { timeout: 60_000 });
}

async function contactSheet(inputs: string[], output: string) {
  const sources = inputs.flatMap((file) => ["-i", file]);
  const filters = inputs.map((_, index) => `[${index}:v]setsar=1[v${index}]`).join(";");
  const stack = inputs.map((_, index) => `[v${index}]`).join("");
  await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...sources, "-filter_complex", `${filters};${stack}hstack=inputs=${inputs.length}[out]`, "-map", "[out]", "-frames:v", "1", output], { timeout: 60_000 });
}

async function renderTopic(filename: string, slug: string, required: string[]) {
  const source = JSON.parse(await readFile(path.join(root, "samples", filename), "utf8")) as unknown;
  const parsed = parseResearchPackage(source);
  if (!parsed.success) throw parsed.error;
  assert.ok(parsed.success, `${filename} research sample validates`);
  const previous = buildVisualStoryboard(parsed.data);
  const storyboard = {
    ...previous,
    scenes: previous.scenes.map((scene) => ({ ...scene, ...planSceneMotion(scene, "balanced") })),
  };
  const research = parseResearchPackage(applyVisualStoryboard(parsed.data, storyboard));
  if (!research.success) throw research.error;
  assert.ok(research.success, `${filename} Motion Plan persists in Research Package`);
  const actions = research.data.scenes.flatMap((scene) => scene.motionActions);
  for (const id of required) assert.ok(actions.some((action) => action.id === id), `${filename} contains semantic action '${id}'`);
  for (const scene of research.data.scenes) for (const action of scene.motionActions) {
    assert.ok(motionTargetExists(scene.visualComposition, action.targetNode), `${action.id} targets real composition node`);
    assert.ok(action.startFrame + action.durationFrames <= Math.floor((scene.endSec - scene.startSec) * 30), `${action.id} stays inside scene timing`);
  }
  if (slug === "sea-salt") {
    const evaporation = actions.filter((action) => action.id === "water-vapor-rise");
    assert.ok(evaporation.length && evaporation.every((action) => !action.targetNode.includes("salt-ions")), `evaporation leaves salt layer unmoved: ${JSON.stringify(evaporation)}`);
  }
  const magnet = actions.find((action) => action.id === "charged-particle-deflection");
  if (magnet) assert.ok(!magnet.targetNode.startsWith("uv-rays/"), "magnetosphere motion targets charged-particle composition, never UV");

  const planFile = path.join(outputDir, `${slug}-motion-plan.json`);
  await writeFile(planFile, JSON.stringify({ topic: parsed.data.title, rendererVersion: RENDERER_VERSION, motionTiming: "approximate; no word-level audio alignment available", scenes: storyboard.scenes.map((scene) => ({
    sceneNumber: scene.sceneNumber, headline: scene.headline, durationSec: scene.durationSec, motionIntensity: scene.motionIntensity,
    motionTiming: scene.motionTiming, motionStatus: scene.motionStatus, motionSummary: scene.motionSummary, motionActions: scene.motionActions,
  })) }, null, 2), { flag: "wx" });
  const video = path.join(outputDir, `${slug}-motion-demo.mp4`);
  const manifest = await renderSnapshot({ research: research.data, rendererVersion: RENDERER_VERSION }, video, () => {}, 0.35);
  await writeFile(video.replace(/\.mp4$/i, ".manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });

  const selectedActions = new Set(required);
  const frames: string[] = [];
  for (const scene of research.data.scenes) for (const action of scene.motionActions) {
    if (!selectedActions.has(action.id)) continue;
    for (const [label, fraction] of [["start", 0.12], ["middle", 0.55], ["end", 0.88]] as const) {
      const second = scene.startSec + (action.startFrame + Math.floor(action.durationFrames * fraction)) / 30;
      const output = path.join(outputDir, `${slug}-${action.id}-${label}.png`);
      await extractFrame(video, second, output);
      frames.push(output);
    }
  }
  const contact = path.join(outputDir, `${slug}-motion-frames.png`);
  await contactSheet(frames, contact);
  return { slug, planFile, video, contact, manifest, actionIds: actions.map((action) => action.id), frameCount: frames.length };
}

const seaSalt = await renderTopic("kenapa-air-laut-asin.json", "sea-salt", ["rain-fall", "river-mineral-flow", "water-vapor-rise"]);
const earth = await renderTopic("bagaimana-bumi-melindungi-kita.json", "earth-protection", ["uv-approach-ozone", "partial-uv-transmission", "charged-particle-deflection"]);
await writeFile(path.join(outputDir, "limitations.md"), [
  "# Motion Director V1 limitations",
  "",
  "- Planning is deterministic and composition-bound; no AI request occurs during planning batch, preview, or render.",
  "- Scene timing is approximate from narration structure and scene duration. No word-level audio alignment is available.",
  "- UV artwork does not identify each ray by wavelength; the partial-transmission path avoids claiming every UV ray is stopped, but does not model UV-B/UV-C proportions.",
  "- Magnetosphere motion follows available charged-particle paths; it does not move UV rays.",
  "- Raster images remain one layer and receive only whole-image transforms; internal depicted objects cannot move independently.",
  "- Path extraction samples existing SVG vector geometry; complex masks, physical simulation, and cross-scene object tracking remain out of scope.",
].join("\n"), { flag: "wx" });
console.log(JSON.stringify({ outputDir, seaSalt, earth }, null, 2));
