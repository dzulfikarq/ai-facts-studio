import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { aiGenerationSchema } from "../src/server/ai-generation/provider";
import { OpenCodeTextGenerationProvider } from "../src/server/ai-generation/opencode-provider";
import { generateAiVectorIllustration } from "../src/server/ai-generation/vector-illustrator";
import { aiVectorIllustrationSchema } from "../src/domain/ai-vector-illustration";
import { visualPlannerInputSchema } from "../src/server/ai-generation/visual-planner";
import { applyVisualStoryboard, buildVisualStoryboard, visualStoryboardQualityGate, visualStoryboardSchema } from "../src/domain/visual-storyboard";
import { parseResearchPackage } from "../src/domain/research";
import { VisualCompositionView } from "../src/video/visual-primitives";
import { visualStyles } from "../src/video/style-config";
import { RENDERER_VERSION } from "../src/video/renderer-version";
import { renderSnapshot } from "./render-core";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const sha256Json = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const argModel = process.argv.find((value) => value.startsWith("--model="))?.slice("--model=".length);
const model = process.env.AI_VECTOR_MODEL?.trim() || argModel;
const argSpecPath = process.argv.find((value) => value.startsWith("--spec="))?.slice("--spec=".length);

const input = visualPlannerInputSchema.parse({
  headline: "CAHAYA MATAHARI TERURAI MENJADI SPEKTRUM",
  narration: "Cahaya Matahari terdiri dari berbagai warna yang dapat dipisahkan menggunakan prisma.",
  visualDescription: "Satu berkas cahaya putih memasuki prisma kaca lalu keluar sebagai spektrum warna yang terlihat jelas.",
});
let provenance: { source: string; model: string; cached?: boolean; generatedAt?: string; specSha256?: string };
let generated: { spec: unknown; cached: boolean | null; model: string; source: "live-opencode" | "generated-spec-replay" | "live-opencode-spec-replay" };
if (argSpecPath) {
  const resolvedSpecPath = path.resolve(root, argSpecPath);
  const specValue = JSON.parse(await readFile(resolvedSpecPath, "utf8"));
  const provenancePath = path.join(path.dirname(resolvedSpecPath), "generation-provenance.json");
  provenance = existsSync(provenancePath) ? JSON.parse(await readFile(provenancePath, "utf8")) : { source: "generated-spec-replay", model: model ?? "recorded OpenCode model" };
  if (provenance.specSha256 && provenance.specSha256 !== sha256Json(specValue)) throw new Error("AI Vector spec hash does not match its generation provenance.");
  generated = {
    spec: specValue, cached: provenance.cached ?? null,
    model: provenance.model || model || "recorded OpenCode model",
    source: provenance.source === "opencode-live" ? "live-opencode-spec-replay" : "generated-spec-replay",
  };
} else {
  if (!model) throw new Error("Set AI_VECTOR_MODEL or pass --model=<OpenCode model id>.");
  const provider = new OpenCodeTextGenerationProvider(model);
  const status = await provider.status();
  if (!status.configured) throw new Error(status.disabledReason ?? "OpenCode tidak tersedia.");
  if (!status.models.some((item) => item.id === model)) throw new Error(`OpenCode model '${model}' is not connected.`);
  const cacheDb = new DatabaseSync(":memory:");
  cacheDb.exec(aiGenerationSchema);
  try {
    const result = await generateAiVectorIllustration(cacheDb, provider, input);
    generated = { ...result, source: "live-opencode" };
    provenance = { source: "opencode-live", model: result.model, cached: result.cached, generatedAt: new Date().toISOString(), specSha256: sha256Json(result.spec) };
  } finally { cacheDb.close(); }
}
const spec = aiVectorIllustrationSchema.parse(generated.spec);

const outputRelative = process.env.AI_VECTOR_POC_DIR ?? `artifacts/ai-vector-prism-poc-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const outputDir = path.resolve(root, outputRelative);
if (existsSync(outputDir)) throw new Error(`PoC output exists; preserving it: ${path.relative(root, outputDir)}.`);
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, "generation-provenance.json"), JSON.stringify(provenance!, null, 2), { flag: "wx" });

const durationSec = 8;
const storyHeadline = "PRISMA MEMISAHKAN CAHAYA PUTIH";
const researchResult = parseResearchPackage({
  schemaVersion: "1.1",
  id: "ai-vector-prism-poc",
  title: "Cahaya Matahari dan Prisma",
  category: "Sains & Antariksa",
  visualPreset: "flat-2d-storytelling",
  language: "id-ID",
  targetDurationSec: durationSec,
  aspectRatio: "9:16",
  narration: input.narration,
  references: [],
  scenes: [{
    id: "sunlight-prism-spectrum",
    order: 1,
    startSec: 0,
    endSec: durationSec,
    narrationText: input.narration,
    onScreenText: storyHeadline,
    templateId: "infographic",
    visualDescription: input.visualDescription,
    motionCues: [],
    sfxCues: [],
    referenceIds: [],
    visualComposition: spec.composition,
    motionPlan: [],
  }],
});
if (!researchResult.success) throw new Error(`PoC Research Package invalid: ${researchResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);

const starter = buildVisualStoryboard(researchResult.data);
const starterScene = starter.scenes[0]!;
const storyboard = visualStoryboardSchema.parse({
  ...starter,
  scenes: [{
    ...starterScene,
    layout: "scientific-diagram",
    compositionType: "scientific-diagram",
    objects: [],
    relationships: [],
    visualFocus: null,
    illustrationIntent: spec.description,
    motionIntent: "gentle-reveal",
    motionSummary: "Reveal ringan mengikuti motion plan scene.",
    composition: spec.composition,
    compositionSource: "ai-vector",
    missingVisuals: [],
    warnings: [],
    authoringStatus: "needs_review",
    authoringConfirmed: false,
    approved: false,
    approvedFingerprint: null,
  }],
});
const qualityGate = visualStoryboardQualityGate(researchResult.data, storyboard);
const researchWithStoryboard = parseResearchPackage(applyVisualStoryboard(researchResult.data, storyboard));
if (!researchWithStoryboard.success) throw new Error(`PoC composed package invalid: ${researchWithStoryboard.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
const research = researchWithStoryboard.data;
const scene = research.scenes[0]!;
const thumbnailFrame = Math.floor(durationSec * 30 * 0.42);
const thumbnailProgress = thumbnailFrame / (durationSec * 30);

await writeFile(path.join(outputDir, "ai-vector-spec.json"), JSON.stringify(spec, null, 2), { flag: "wx" });
await writeFile(path.join(outputDir, "visual-storyboard.json"), JSON.stringify(storyboard, null, 2), { flag: "wx" });
await writeFile(path.join(outputDir, "research-package.json"), JSON.stringify(research, null, 2), { flag: "wx" });

const thumbnailSvg = renderToStaticMarkup(<svg xmlns="http://www.w3.org/2000/svg" width="324" height="576" viewBox="0 0 1080 1920" role="img" aria-label="AI Vector storyboard thumbnail">
  <VisualCompositionView scene={scene} composition={spec.composition} style={visualStyles[research.visualPreset]} preset={research.visualPreset} frame={thumbnailFrame} progress={thumbnailProgress}/>
  <rect x="45" y="34" width="990" height="450" rx="20" fill={storyboard.palette.canvas} opacity=".96"/>
  <text x="84" y="92" fill={storyboard.palette.primary} fontFamily="Arial,sans-serif" fontSize="24" fontWeight="700" letterSpacing="3">AI FACTS · SCENE 01</text>
  <text x="80" y="192" fill={storyboard.palette.text} fontFamily="Arial,sans-serif" fontSize="39" fontWeight="800" letterSpacing="-1">PRISMA MEMISAHKAN CAHAYA PUTIH</text>
</svg>);
const thumbnailSvgPath = path.join(outputDir, "storyboard-thumbnail.svg");
const thumbnailPngPath = path.join(outputDir, "storyboard-thumbnail.png");
await writeFile(thumbnailSvgPath, thumbnailSvg, { flag: "wx" });
const browserPath = process.env.CHROME_PATH || [
  path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Microsoft/Edge/Application/msedge.exe"),
  path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google/Chrome/Application/chrome.exe"),
  path.join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
].find((candidate) => existsSync(candidate));
if (!browserPath) throw new Error("Chrome/Edge not found; set CHROME_PATH to rasterize storyboard thumbnail.");
const browserProfile = await mkdtemp(path.join(os.tmpdir(), "ai-vector-thumb-"));
try {
  await execFileAsync(browserPath, ["--headless", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--user-data-dir=${browserProfile}`, "--window-size=324,576", `--screenshot=${thumbnailPngPath}`, pathToFileURL(thumbnailSvgPath).href], { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
} finally { await rm(browserProfile, { recursive: true, force: true }); }

const videoPath = path.join(outputDir, "ai-vector-prism-poc.mp4");
const renderManifest = await renderSnapshot({ research, rendererVersion: RENDERER_VERSION }, videoPath, () => {});
await writeFile(path.join(outputDir, "remotion-manifest.json"), JSON.stringify(renderManifest, null, 2), { flag: "wx" });
const remotionFramePath = path.join(outputDir, "remotion-frame.png");
await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(thumbnailFrame / 30), "-i", videoPath, "-frames:v", "1", "-vf", "scale=324:576", "-y", remotionFramePath], { timeout: 60_000 });

const report = {
  model: generated.model,
  cached: generated.cached,
  generationSource: generated.source,
  source: "OpenCode text model -> validated ai-vector-v1 -> existing VisualCompositionView -> Remotion",
  instruction: input.narration,
  description: spec.description,
  sceneCount: storyboard.scenes.length,
  layerIds: spec.composition.layers.map((layer) => layer.id),
  nodeCount: spec.composition.layers.reduce((count, layer) => count + layer.nodes.length, 0),
  hasGradient: spec.composition.layers.some((layer) => layer.nodes.some((node) => (node.type === "shape" || node.type === "path") && typeof node.fill === "object")),
  qualityGate: { status: qualityGate.status, issues: qualityGate.issues, reviewNotes: qualityGate.reviewNotes },
  humanApprovalRequired: true,
  rendererVersion: RENDERER_VERSION,
  thumbnailFrame,
  thumbnailProgress,
  compositionSha256: createHash("sha256").update(JSON.stringify(spec.composition)).digest("hex"),
  storyboardCompositionSha256: createHash("sha256").update(JSON.stringify(storyboard.scenes[0]!.composition)).digest("hex"),
  remotionInputCompositionSha256: createHash("sha256").update(JSON.stringify(scene.visualComposition)).digest("hex"),
  matchingComposition: JSON.stringify(storyboard.scenes[0]!.composition) === JSON.stringify(scene.visualComposition),
  artifacts: ["ai-vector-spec.json", "storyboard-thumbnail.png", "storyboard-thumbnail.svg", "ai-vector-prism-poc.mp4", "remotion-frame.png", "visual-storyboard.json", "research-package.json"],
};
await writeFile(path.join(outputDir, "poc-report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
assert.equal(storyboard.scenes.length, 1);
assert.equal(report.matchingComposition, true);
console.log(JSON.stringify({ outputDir: path.relative(root, outputDir), report }, null, 2));
