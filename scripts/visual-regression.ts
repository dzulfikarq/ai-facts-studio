import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import React from "react";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { parseResearchPackage, templateIds, visualPresets, type ResearchPackage, type Scene } from "../src/domain/research";
import { defaultMotionPlan, defaultVisualComposition } from "../src/domain/visual-defaults";
import { visualCompositionSchema } from "../src/domain/visual-composition";
import { applyVisualStoryboard, buildVisualStoryboard, visualStoryboardQualityGate } from "../src/domain/visual-storyboard";
import { RENDERER_VERSION } from "../src/video/renderer-version";
import type { VideoProps } from "../src/video/types";

const root = process.cwd();
const recordOnly = process.argv.includes("--record");
const updateBaseline = process.argv.includes("--update-baseline");
const baselinePath = path.resolve(root, "scripts/visual-goldens.json");
const outputDir = path.resolve(root, process.env.VISUAL_REGRESSION_OUTPUT_DIR ?? "artifacts/illustration-upgrade-final/visual-regression");
const raw = JSON.parse(await readFile(path.join(root, "samples/lightning-charge.json"), "utf8")) as unknown;
const parsed = parseResearchPackage(raw);
assert.equal(parsed.success, true, "lightning sample must migrate/validate");
if (!parsed.success) throw new Error("Lightning sample invalid.");
const basePackage = parsed.data;
const saltResult = parseResearchPackage(JSON.parse(await readFile(path.join(root, "samples/kenapa-air-laut-asin.json"), "utf8")));
assert.equal(saltResult.success, true, "sea-salt acceptance sample must validate");
if (!saltResult.success) throw new Error("Sea-salt sample invalid.");
const saltPackage = saltResult.data;
const mountainResult = parseResearchPackage(JSON.parse(await readFile(path.join(root, "samples/mountain-formation.json"), "utf8")));
assert.equal(mountainResult.success, true, "mountain legacy sample must validate");
if (!mountainResult.success) throw new Error("Mountain sample invalid.");
const mountainBoard = buildVisualStoryboard(mountainResult.data);
assert.equal(visualStoryboardQualityGate(mountainResult.data, mountainBoard).ready, true, "mountain Visual Storyboard passes visual evidence gate");
const mountainIllustrated = parseResearchPackage(applyVisualStoryboard(mountainResult.data, mountainBoard));
assert.equal(mountainIllustrated.success, true, "mountain Visual Storyboard must be valid renderer input");
if (!mountainIllustrated.success) throw new Error("Mountain Visual Storyboard invalid.");
const saltBoard = buildVisualStoryboard(saltPackage);
assert.equal(visualStoryboardQualityGate(saltPackage, saltBoard).ready, true, "sea-salt Visual Storyboard passes art direction gate");
const saltIllustrated = parseResearchPackage(applyVisualStoryboard(saltPackage, saltBoard));
assert.equal(saltIllustrated.success, true, "sea-salt Visual Storyboard must be valid renderer input");
if (!saltIllustrated.success) throw new Error("Sea-salt Visual Storyboard invalid.");
const earthResult = parseResearchPackage(JSON.parse(await readFile(path.join(root, "samples/bagaimana-bumi-melindungi-kita.json"), "utf8")));
assert.equal(earthResult.success, true, "Earth reuse sample must validate");
if (!earthResult.success) throw new Error("Earth sample invalid.");
const earthBoard = buildVisualStoryboard(earthResult.data);
assert.equal(visualStoryboardQualityGate(earthResult.data, earthBoard).ready, true, "Earth Visual Storyboard passes art direction gate");
const earthIllustrated = parseResearchPackage(applyVisualStoryboard(earthResult.data, earthBoard));
assert.equal(earthIllustrated.success, true, "Earth Visual Storyboard must be valid renderer input");
if (!earthIllustrated.success) throw new Error("Earth Visual Storyboard invalid.");

function packageFor(templateId: Scene["templateId"], preset: ResearchPackage["visualPreset"], cues: Scene["motionCues"], visualComposition = defaultVisualComposition(templateId)) {
  const original = basePackage.scenes[0]!;
  const scene: Scene = {
    ...original,
    id: `visual-${templateId}-${preset}`,
    startSec: 0,
    endSec: 3,
    templateId,
    visualComposition: visualCompositionSchema.parse(visualComposition),
    motionCues: cues,
    motionPlan: defaultMotionPlan(cues),
  };
  return { ...basePackage, title: "Visual regression", visualPreset: preset, targetDurationSec: 3, scenes: [scene] } satisfies ResearchPackage;
}

type FrameCase = { key: string; research: ResearchPackage; frame: number };
const cases: FrameCase[] = [];
const illustratedMotionPairs: string[] = [];
for (const templateId of templateIds) {
  cases.push({ key: `template/${templateId}/mid`, research: packageFor(templateId, "flat-2d-storytelling", []), frame: 45 });
}
for (const preset of visualPresets) for (const [label, frame] of [["start",0],["middle",45],["end",89]] as const) {
  cases.push({ key: `preset/${preset}/${label}`, research: packageFor("mountain-reveal", preset, ["fadeIn","zoom","parallax"]), frame });
}
cases.push({ key: "preset/animated-infographic/staggered-entrance", research: packageFor("mountain-reveal", "animated-infographic", []), frame: 6 });
basePackage.scenes.forEach((scene,index)=>cases.push({
  key: `lightning/scene-${String(index+1).padStart(2,"0")}/middle`,
  research: { ...basePackage, targetDurationSec: 3, scenes: [{ ...scene, startSec: 0, endSec: 3 }] },
  frame: 45,
}));
for (const [topic, research] of [["mountain-formation", mountainIllustrated.data], ["sea-salt", saltIllustrated.data], ["earth-reuse", earthIllustrated.data]] as const) {
  research.scenes.forEach((scene,index)=>{
    const duration = scene.endSec - scene.startSec;
    const key = `visual-storyboard/${topic}/scene-${String(index+1).padStart(2,"0")}`;
    const singleScene = { ...research, scenes: [{ ...scene, order: 1, startSec: 0, endSec: duration }], targetDurationSec: duration };
    cases.push(
      { key: `${key}/start`, research: singleScene, frame: 6 },
      { key: `${key}/middle`, research: singleScene, frame: Math.floor(duration * 15) },
      { key: `${key}/end`, research: singleScene, frame: Math.max(1, Math.ceil(duration * 30) - 1) },
    );
    illustratedMotionPairs.push(key);
  });
}
cases.push({ key: "motion/none/frame-12", research: packageFor("mountain-reveal", "flat-2d-storytelling", []), frame: 12 });
for (const cue of ["fadeIn","slide","scale","pan","zoom","parallax","reveal","pulse","dissolve"] as const) {
  cases.push({ key: `motion/${cue}/frame-12`, research: packageFor("mountain-reveal", "flat-2d-storytelling", [cue]), frame: 12 });
}
const transitionBefore = packageFor("plate-collision", "cinematic-parallax", []).scenes[0]!;
const transitionAfter = packageFor("volcano", "cinematic-parallax", ["dissolve"]).scenes[0]!;
cases.push(
  { key: "transition/before", research: { ...basePackage, targetDurationSec: 6, visualPreset: "cinematic-parallax", scenes: [{ ...transitionBefore, id: "transition-before", order: 1, startSec: 0, endSec: 3 }, { ...transitionAfter, id: "transition-after", order: 2, startSec: 3, endSec: 6 }] }, frame: 89 },
  { key: "transition/start", research: { ...basePackage, targetDurationSec: 6, visualPreset: "cinematic-parallax", scenes: [{ ...transitionBefore, id: "transition-before", order: 1, startSec: 0, endSec: 3 }, { ...transitionAfter, id: "transition-after", order: 2, startSec: 3, endSec: 6 }] }, frame: 90 },
  { key: "transition/middle", research: { ...basePackage, targetDurationSec: 6, visualPreset: "cinematic-parallax", scenes: [{ ...transitionBefore, id: "transition-before", order: 1, startSec: 0, endSec: 3 }, { ...transitionAfter, id: "transition-after", order: 2, startSec: 3, endSec: 6 }] }, frame: 99 },
  { key: "transition/end", research: { ...basePackage, targetDurationSec: 6, visualPreset: "cinematic-parallax", scenes: [{ ...transitionBefore, id: "transition-before", order: 1, startSec: 0, endSec: 3 }, { ...transitionAfter, id: "transition-after", order: 2, startSec: 3, endSec: 6 }] }, frame: 108 },
);

await mkdir(outputDir, { recursive: true });
const serveUrl = await bundle({ entryPoint: path.join(root, "src/video/entry.tsx"), onProgress: () => {} });
const browser = await openBrowser("chrome", { logLevel: "error" });
const hashes: Record<string, string> = {};

try {
  for (const frameCase of cases) {
    const inputProps: VideoProps = { research: frameCase.research, rendererVersion: RENDERER_VERSION };
    const composition = await selectComposition({ serveUrl, id: "FactsVideo", inputProps, puppeteerInstance: browser, logLevel: "error" });
    const rendered = await renderStill({
      composition,
      serveUrl,
      inputProps,
      frame: frameCase.frame,
      output: null,
      imageFormat: "png",
      scale: 0.25,
      puppeteerInstance: browser,
      logLevel: "error",
    });
    assert.ok(rendered.buffer?.length, `${frameCase.key} should produce PNG frame`);
    hashes[frameCase.key] = createHash("sha256").update(rendered.buffer!).digest("hex");
    const filename = `${frameCase.key.replace(/[^a-zA-Z0-9_-]+/g, "-")}.png`;
    await writeFile(path.join(outputDir, filename), rendered.buffer!);
  }
} finally {
  await browser.close({ silent: true });
}

const templateHashes = templateIds.map((id) => hashes[`template/${id}/mid`]);
assert.equal(new Set(templateHashes).size, templateIds.length, "all template defaults should produce distinct middle frames");
const presetHashes = visualPresets.map((preset) => hashes[`preset/${preset}/middle`]);
assert.equal(new Set(presetHashes).size, visualPresets.length, "all visual presets should visibly differ");
const baseHash = hashes["motion/none/frame-12"];
for (const cue of ["fadeIn","slide","scale","pan","zoom","parallax","reveal","pulse","dissolve"] as const) {
  assert.notEqual(hashes[`motion/${cue}/frame-12`], baseHash, `${cue} should change rendered frame`);
}
assert.notEqual(hashes["transition/start"], hashes["transition/middle"], "dissolve should blend frames over its duration");
assert.notEqual(hashes["transition/middle"], hashes["transition/end"], "dissolve should resolve to incoming scene");
for (const key of illustratedMotionPairs) assert.notEqual(hashes[`${key}/start`], hashes[`${key}/end`], `${key} deterministic process motion should change rendered frame`);

if (recordOnly) {
  const serialized = JSON.stringify({ rendererVersion: RENDERER_VERSION, scale: 0.25, frames: hashes }, null, 2);
  if (updateBaseline) await writeFile(baselinePath, `${serialized}\n`);
  console.log(serialized);
} else {
  const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as { rendererVersion: number; scale: number; frames: Record<string, string> };
  assert.equal(baseline.rendererVersion, RENDERER_VERSION);
  assert.deepEqual(hashes, baseline.frames, "golden frame changed; inspect renders/visual-regression before updating baseline");
  console.log(`PASS: ${cases.length} golden frames; 8 templates, 3 presets, 9 cues, lightning, seven mountain scenes, five salt scenes, five Earth scenes, transitions.`);
}
