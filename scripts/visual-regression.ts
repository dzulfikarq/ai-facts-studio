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
import { RENDERER_VERSION } from "../src/video/renderer-version";
import type { VideoProps } from "../src/video/types";

const root = process.cwd();
const recordOnly = process.argv.includes("--record");
const baselinePath = path.resolve(root, "scripts/visual-goldens.json");
const outputDir = path.resolve(root, "renders/visual-regression/v1.0.2");
const raw = JSON.parse(await readFile(path.join(root, "samples/lightning-charge.json"), "utf8")) as unknown;
const parsed = parseResearchPackage(raw);
assert.equal(parsed.success, true, "lightning sample must migrate/validate");
if (!parsed.success) throw new Error("Lightning sample invalid.");
const basePackage = parsed.data;

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

if (recordOnly) {
  console.log(JSON.stringify({ rendererVersion: RENDERER_VERSION, scale: 0.25, frames: hashes }, null, 2));
} else {
  const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as { rendererVersion: number; scale: number; frames: Record<string, string> };
  assert.equal(baseline.rendererVersion, RENDERER_VERSION);
  assert.deepEqual(hashes, baseline.frames, "golden frame changed; inspect renders/visual-regression before updating baseline");
  console.log(`PASS: ${cases.length} golden frames; 8 templates, 3 presets, 9 cues, lightning scenes, transition start/mid/end.`);
}
