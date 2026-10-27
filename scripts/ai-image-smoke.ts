import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { applyVisualStoryboard } from "../src/domain/visual-storyboard";
import type { ResearchPackage } from "../src/domain/research";
import type { VisualAsset } from "../src/domain/visual-assets";
import { renderSnapshot } from "./render-core";

const execFileAsync = promisify(execFile);
const tempRoot = path.join(process.env.TEMP ?? os.tmpdir(), "opencode");
await mkdir(tempRoot, { recursive: true });
const tempDir = await mkdtemp(path.join(tempRoot, "ai-image-mock-smoke-"));
const dataPath = path.join(tempDir, "data");
const fixturePath = path.join(tempDir, "mock-provider-image.png");
const mockLogPath = path.join(tempDir, "provider-calls.jsonl");
const renderPath = path.join(tempDir, "mocked-ai-image-render.mp4");
await execFileAsync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0xf4f1e8:s=576x1024:r=1,drawbox=x=0:y=690:w=576:h=334:color=0x258ca0:t=fill,drawbox=x=180:y=250:w=216:h=350:color=0x7a9873:t=fill", "-frames:v", "1", fixturePath]);

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [
  "--import", "tsx", "--import", pathToFileURL(path.resolve("scripts/mock-huggingface-fetch.mjs")).href, "src/server/index.ts",
], {
  cwd: process.cwd(),
  env: {
    ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(port), DATA_DIR: dataPath,
    GEMINI_API_KEY: "", TTS_MOCK_PROVIDER: "0", OPENCODE_SERVER_URL: "http://127.0.0.1:4096",
    HF_TOKEN: "test-only-token", HF_IMAGE_GENERATION_ENABLED: "true", HF_IMAGE_ALLOW_PAID: "true",
    HF_IMAGE_MODEL: "stabilityai/stable-diffusion-3-medium-diffusers", MOCK_HF_IMAGE_PATH: fixturePath, MOCK_HF_LOG_PATH: mockLogPath,
  },
  stdio: "ignore",
});
let projectIds: string[] = [];
let storedAsset: VisualAsset | undefined;

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${baseUrl}/api/status`)).ok) { ready = true; break; } } catch { /* server starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(ready, true, "mock API server starts");
  const catalog = await fetch(`${baseUrl}/api/ai-image/providers`).then((response) => response.json());
  assert.equal(catalog.status, "Ready");
  assert.ok(catalog.providers[0].models.some((model: { id: string }) => model.id === "stabilityai/stable-diffusion-3-medium-diffusers"));

  const researchPackage = JSON.parse(await readFile("samples/kenapa-air-laut-asin.json", "utf8")) as ResearchPackage;
  async function createProject() {
    const response = await fetch(`${baseUrl}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage }) });
    assert.equal(response.status, 201, await response.clone().text());
    const project = await response.json();
    projectIds.push(project.id);
    return project;
  }
  const project = await createProject();
  const scene = project.visualStoryboard.scenes[2];
  const prompt = "One coherent flat 2D educational illustration: mountain river carries visible mineral particles downstream to the sea; portrait 9:16, no lettering.";
  const requestUrl = `${baseUrl}/api/projects/${project.id}/scenes/${scene.sceneId}/ai-image/generate`;
  const missingConsent = await fetch(requestUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "huggingface-inference", model: catalog.providers[0].models[0].id, prompt, resolution: "576x1024", confirmed: false, costAcknowledged: false }) });
  assert.equal(missingConsent.status, 400, "API rejects generation without both explicit consent fields");
  assert.equal((await readFile(mockLogPath, "utf8")).split("\n").filter((line) => line.includes('"type":"generate"')).length, 0, "missing consent reaches no provider request");

  const generatedResponse = await fetch(requestUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "huggingface-inference", model: catalog.providers[0].models[0].id, prompt, resolution: "576x1024", confirmed: true, costAcknowledged: true }) });
  assert.equal(generatedResponse.status, 201, await generatedResponse.clone().text());
  const generated = await generatedResponse.json();
  storedAsset = generated.asset as VisualAsset;
  assert.equal(storedAsset.source, "ai-generated");
  assert.equal(storedAsset.prompt, prompt);
  assert.equal(storedAsset.model, "stabilityai/stable-diffusion-3-medium-diffusers");
  assert.equal(storedAsset.provider, "Hugging Face Inference Providers · hf-inference");
  assert.equal(storedAsset.width, 576);
  assert.equal(storedAsset.height, 1024);
  assert.equal(storedAsset.sha256, createHash("sha256").update(await readFile(path.resolve("public/visual-assets", storedAsset.file))).digest("hex"));
  assert.match(storedAsset.usageMetadata ?? "", /x-compute-time/);
  assert.ok(generated.project.visualAssets.some((asset: VisualAsset) => asset.id === storedAsset!.id), "mocked output persisted into project and Asset Library");
  assert.notEqual(generated.project.visualStoryboard.scenes[2].illustrationSource, "ai-image", "generation saves a candidate without applying it to storyboard");

  const reusableProject = await createProject();
  const attached = await fetch(`${baseUrl}/api/projects/${reusableProject.id}/visual-assets/${encodeURIComponent(storedAsset.id)}/attach`, { method: "POST" });
  assert.equal(attached.status, 200, "generated local asset can be reused in another project without another generation");
  assert.ok((await attached.json()).project.visualAssets.some((asset: VisualAsset) => asset.id === storedAsset!.id));

  const storyboard = structuredClone(project.visualStoryboard);
  const generatedScene = storyboard.scenes[2];
  generatedScene.composition = { background: storyboard.palette.canvas, layers: [{ id: "mocked-ai-image", depth: 0.05, nodes: [{ type: "image", asset: storedAsset.id, x: 0, y: 0, width: 1080, height: 1920, fit: "cover", position: "center" }] }] };
  generatedScene.compositionSource = "library";
  generatedScene.illustrationSource = "ai-image";
  generatedScene.compositionType = "hero-object-focus";
  generatedScene.layout = "existing-composition";
  generatedScene.authoringConfirmed = true;
  generatedScene.authoringStatus = "ready_for_review";
  generatedScene.approved = false;
  generatedScene.approvedFingerprint = null;
  const applied = await fetch(`${baseUrl}/api/projects/${project.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: project.researchPackage, visualStoryboard: storyboard }) });
  assert.equal(applied.status, 200, await applied.clone().text());
  const appliedProject = await applied.json();
  assert.equal(appliedProject.visualStoryboard.scenes[2].composition.layers[0].nodes[0].asset, storedAsset.id);
  assert.equal(appliedProject.visualStoryboard.scenes[2].approved, false, "applying generated art does not preserve old approval");

  const sceneIndex = 2;
  const sourceScene = project.researchPackage.scenes[sceneIndex];
  const oneSceneResearch = applyVisualStoryboard({ ...project.researchPackage, targetDurationSec: 2, scenes: [{ ...sourceScene, startSec: 0, endSec: 2 }] }, appliedProject.visualStoryboard);
  const manifest = await renderSnapshot({ research: oneSceneResearch, visualAssets: [storedAsset], rendererVersion: 2 }, renderPath, () => {}, 1 / 3);
  assert.equal(manifest.videoCodec, "h264");
  assert.equal(manifest.width, 360);
  assert.equal(manifest.height, 640);
  assert.ok(existsSync(renderPath), "Remotion render uses persisted image file from mocked provider output");

  const calls = (await readFile(mockLogPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const generationCalls = calls.filter((call) => call.type === "generate");
  assert.equal(generationCalls.length, 1, "exactly one confirmed generation request occurred");
  assert.equal(generationCalls[0].authorized, true, "server-side HF token used in mocked provider request");
  assert.equal(generationCalls[0].prompt, prompt);
  assert.deepEqual(generationCalls[0].parameters, { width: 576, height: 1024 });
  process.stdout.write("PASS: mocked HF catalog + one consented image; local content-addressed persistence, cross-project reuse, explicit apply, approval invalidation, and 360x640 Remotion render. Mock fixture only; no live generation.\n");
} finally {
  for (const projectId of [...projectIds].reverse()) {
    try { await fetch(`${baseUrl}/api/projects/${projectId}`, { method: "DELETE" }); } catch { /* server teardown follows */ }
  }
  server.kill();
  await new Promise<void>((resolve) => { server.once("exit", () => resolve()); setTimeout(resolve, 3000); });
  await rm(tempDir, { recursive: true, force: true });
}
