import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { openBrowser } from "@remotion/renderer";
import { buildVisualStoryboard, applyVisualStoryboard } from "../src/domain/visual-storyboard";
import { parseResearchPackage } from "../src/domain/research";
import { seedVolcanoVisualSample } from "../src/domain/volcano-visual-sample";
import { RENDERER_VERSION } from "../src/video/renderer-version";
import { renderSnapshot } from "./render-core";

const root = process.cwd();
const evidenceDir = path.resolve(root, process.env.VOLCANO_REVIEW_OUTPUT_DIR ?? "artifacts/volcano-animation-review");
const reuseExisting = process.env.VOLCANO_REVIEW_REUSE_RENDER === "1";
const tempRoot = "C:/Users/Augie Winanda F/AppData/Local/Temp/opencode";
const execFileAsync = promisify(execFile);
const tempDir = await mkdtemp(path.join(tempRoot, "volcano-review-"));
const projectIds: string[] = [];
const expectedFiles = [
  "volcano-process-preview-10s.mp4", "volcano-six-beat-fixture-30s.mp4",
  "volcano-review.json", "volcano-visualworld-editor.png", "volcano-timeline-path-editor.png",
];
await mkdir(evidenceDir, { recursive: true });
for (const file of expectedFiles) if (!reuseExisting && existsSync(path.join(evidenceDir, file))) throw new Error(`Review artifact exists; preserving it: ${file}`);

async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(check: () => Promise<boolean>, description: string, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out: ${description}`);
}

async function stop(child?: ChildProcess) {
  if (!child || child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 4000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
    child.kill();
  });
}

async function captureFrame(input: string, second: number, name: string) {
  const output = path.join(evidenceDir, "frame-sequence", name);
  if (!reuseExisting || !existsSync(output)) await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(second), "-i", input, "-frames:v", "1", "-y", output], { timeout: 30_000 });
  return output;
}

const sample = JSON.parse(await readFile(path.join(root, "samples/volcano-formation.json"), "utf8"));
const parsed = parseResearchPackage(sample);
assert.equal(parsed.success, true, "volcano source sample validates");
if (!parsed.success) throw new Error("Volcano source sample invalid");
const fullBoard = seedVolcanoVisualSample(buildVisualStoryboard(parsed.data));
const fullResearch = applyVisualStoryboard(parsed.data, fullBoard);
const previewResearch = applyVisualStoryboard({
  ...parsed.data,
  targetDurationSec: 10,
  scenes: parsed.data.scenes.slice(1, 3).map((scene, index) => ({ ...scene, startSec: index * 5, endSec: (index + 1) * 5 })),
}, { ...fullBoard, scenes: fullBoard.scenes.slice(1, 3) });

let apiServer: ChildProcess | undefined;
let viteServer: ChildProcess | undefined;
let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;
try {
  const previewPath = path.join(evidenceDir, expectedFiles[0]!);
  const fullPath = path.join(evidenceDir, expectedFiles[1]!);
  const previewManifest = reuseExisting && existsSync(previewPath.replace(/\.mp4$/, ".manifest.json"))
    ? JSON.parse(await readFile(previewPath.replace(/\.mp4$/, ".manifest.json"), "utf8")) as Awaited<ReturnType<typeof renderSnapshot>>
    : await renderSnapshot({ research: previewResearch, rendererVersion: RENDERER_VERSION }, previewPath, (value) => {
      if (value % 10 === 0) process.stdout.write(`\r10s preview: ${value}%`);
    });
  assert.equal(previewManifest.audioValidation, "silent-expected");
  assert.ok(previewManifest.durationSec >= 9.9 && previewManifest.durationSec <= 10.1);
  const previewManifestPath = previewPath.replace(/\.mp4$/, ".manifest.json");
  if (!reuseExisting || !existsSync(previewManifestPath)) await writeFile(previewManifestPath, JSON.stringify(previewManifest, null, 2), { flag: reuseExisting ? "w" : "wx" });

  const fullManifest = reuseExisting && existsSync(fullPath.replace(/\.mp4$/, ".manifest.json"))
    ? JSON.parse(await readFile(fullPath.replace(/\.mp4$/, ".manifest.json"), "utf8")) as Awaited<ReturnType<typeof renderSnapshot>>
    : await renderSnapshot({ research: fullResearch, rendererVersion: RENDERER_VERSION }, fullPath, (value) => {
      if (value % 10 === 0) process.stdout.write(`\r30s six-beat fixture: ${value}%`);
    });
  assert.equal(fullManifest.audioValidation, "silent-expected");
  assert.ok(fullManifest.durationSec >= 29.9 && fullManifest.durationSec <= 30.1);
  const fullManifestPath = fullPath.replace(/\.mp4$/, ".manifest.json");
  if (!reuseExisting || !existsSync(fullManifestPath)) await writeFile(fullManifestPath, JSON.stringify(fullManifest, null, 2), { flag: reuseExisting ? "w" : "wx" });
  process.stdout.write("\n");

  const frameDir = path.join(evidenceDir, "frame-sequence");
  await mkdir(frameDir, { recursive: true });
  const frames = [
    [0.25, "01-reservoir-before.png"], [2.3, "02-reservoir-filling.png"], [4.7, "03-reservoir-settled.png"],
    [5.35, "04-magma-enters-conduit.png"], [7.4, "05-magma-mid-conduit.png"], [9.65, "06-magma-reaches-crater.png"],
  ] as const;
  for (const [second, name] of frames) await captureFrame(previewPath, second, name);
  const fullFrames = [
    [17.2, "07-eruption-smoke-and-fragments.png"], [22.4, "08-lava-flow-and-deposits.png"], [28.2, "09-conclusion-carries-process-state.png"],
  ] as const;
  for (const [second, name] of fullFrames) await captureFrame(fullPath, second, name);

  const apiPort = await freePort();
  const vitePort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const viteUrl = `http://127.0.0.1:${vitePort}`;
  apiServer = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(apiPort), VITE_PORT: String(vitePort), DATA_DIR: path.join(tempDir, "data"), DAILY_JOB_LIMIT: "1", TTS_MOCK_PROVIDER: "0", GEMINI_API_KEY: "", HF_TOKEN: "", HF_IMAGE_GENERATION_ENABLED: "false", HF_IMAGE_ALLOW_PAID: "false", OPENCODE_SERVER_URL: "http://127.0.0.1:4096" },
    stdio: "ignore",
  });
  await waitFor(async () => { try { return (await fetch(`${apiUrl}/api/status`)).ok; } catch { return false; } }, "API startup");
  viteServer = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], {
    cwd: root,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(apiPort), VITE_PORT: String(vitePort) },
    stdio: "ignore",
  });
  await waitFor(async () => { try { return (await fetch(`${viteUrl}/api/status`)).ok; } catch { return false; } }, "Vite startup");

  const createdResponse = await fetch(`${apiUrl}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: parsed.data }) });
  assert.equal(createdResponse.status, 201, await createdResponse.clone().text());
  const created = await createdResponse.json();
  projectIds.push(created.id);
  const seeded = seedVolcanoVisualSample(created.visualStoryboard);
  const saveSeed = await fetch(`${apiUrl}/api/projects/${created.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: created.researchPackage, visualStoryboard: seeded }) });
  assert.equal(saveSeed.status, 200, await saveSeed.clone().text());

  browser = await openBrowser("chrome", { logLevel: "error" });
  const page = await browser.newPage({ context: () => null, logLevel: "error", indent: 0, pageIndex: 0, onBrowserLog: () => {}, onLog: () => {} } as never);
  await page.setViewport({ width: 1600, height: 1050, deviceScaleFactor: 1 });
  const browserClient = (page as unknown as { _client: () => { send: (method: string, params?: Record<string, unknown>) => Promise<{ value: any }> } })._client();
  const openProject = async () => {
    await page.goto({ url: viteUrl, timeout: 30_000 });
    await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".project-card-open"))), "project dashboard");
    await page.evaluate((title) => [...document.querySelectorAll<HTMLButtonElement>(".project-card-open")].find((button) => button.getAttribute("aria-label")?.includes(title))?.click(), parsed.data.title);
    await waitFor(() => page.evaluate((title) => document.querySelector<HTMLInputElement>(".workspace-heading .title-input, .video-editor-title input")?.value === title, parsed.data.title), "open volcano project");
    if (!await page.evaluate(() => Boolean(document.querySelector(".video-editor-v2")))) await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="visual"]')?.click());
    await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".video-editor-v2"))), "volcano editor");
  };
  const captureViewport = async (filename: string) => {
    const viewport = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, width: window.innerWidth, height: window.innerHeight }));
    const image = (await browserClient.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false, clip: { ...viewport, scale: 1 } })).value;
    const output = path.join(evidenceDir, filename);
    if (!reuseExisting || !existsSync(output)) await writeFile(output, Buffer.from(image.data, "base64"), { flag: reuseExisting ? "w" : "wx" });
  };
  const selectScene = async (index: number) => page.evaluate((sceneIndex) => document.querySelectorAll<HTMLButtonElement>(".editor-scene-item")[sceneIndex]?.click(), index);
  const selectMotionTab = async () => page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent?.trim() === "Gerak")?.click());
  const selectSceneThreeBeat = async () => page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-motion-clip")].find((button) => button.getAttribute("aria-label")?.startsWith("Motion Beat scene 3"))?.click());

  await openProject();
  await selectScene(0);
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-inspector-scene")?.textContent?.includes("SCENE 01") ?? false), "select first scene");
  await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".editor-info-box")].find((element) => element.textContent?.includes("Visual World aktif"))?.scrollIntoView({ block: "center" }));
  await captureViewport("volcano-visualworld-editor.png");

  await selectScene(2);
  await selectMotionTab();
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".editor-motion-beats"))), "Motion Beat inspector");
  await selectSceneThreeBeat();
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-motion-beats button")].find((button) => button.textContent?.includes("Pilih jalur di canvas"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelectorAll("[data-motion-path-point]").length >= 2), "editable magma path handles");
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector<HTMLElement>(".editor-inspector-content")!.scrollTop = 0; });
  await captureViewport("volcano-timeline-path-editor.png");

  const actionBefore = (await fetch(`${apiUrl}/api/projects/${created.id}`).then((response) => response.json())).visualStoryboard.scenes[2].motionActions[0];
  const inputBounds = await page.evaluate(() => {
    const label = [...document.querySelectorAll<HTMLLabelElement>(".editor-motion-beats label")].find((item) => item.textContent?.includes("Mulai · detik"));
    const input = label?.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("Motion start input missing");
    const bounds = input.getBoundingClientRect();
    input.focus();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, value: input.value };
  });
  await browserClient.send("Input.dispatchMouseEvent", { type: "mousePressed", x: inputBounds.x, y: inputBounds.y, button: "left", buttons: 1, clickCount: 1 });
  await browserClient.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: inputBounds.x, y: inputBounds.y, button: "left", buttons: 0, clickCount: 1 });
  await browserClient.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 });
  await browserClient.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
  await browserClient.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
  await browserClient.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 });
  await browserClient.send("Input.insertText", { text: "0.5" });
  await browserClient.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  await browserClient.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  await page.evaluate(() => {
    const point = document.querySelector<SVGCircleElement>('[data-motion-path-point="0"]');
    if (!point) throw new Error("Motion path handle missing");
    point.focus();
  });
  await browserClient.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await browserClient.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() !== "Tersimpan"), "timing and path edits mark project dirty");
  const editedStart = await page.evaluate(() => [...document.querySelectorAll<HTMLInputElement>(".editor-motion-beats input")].find((input) => input.type === "number")?.value);
  assert.equal(editedStart, "0.5", `browser changed scene-relative timing from ${inputBounds.value}`);
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Tersimpan"), "save timing and path edits");
  const saved = await fetch(`${apiUrl}/api/projects/${created.id}`).then((response) => response.json());
  const actionSaved = saved.visualStoryboard.scenes[2].motionActions.find((action: { id: string }) => action.id === actionBefore.id);
  assert.equal(actionSaved.startFrame, 15, "timeline beat timing saves as scene-relative frames");
  assert.equal(actionSaved.path[0].x, actionBefore.path[0].x + 10, "keyboard path edit saves to project");

  await openProject();
  const reloaded = await fetch(`${apiUrl}/api/projects/${created.id}`).then((response) => response.json());
  const actionReloaded = reloaded.visualStoryboard.scenes[2].motionActions.find((action: { id: string }) => action.id === actionBefore.id);
  assert.equal(actionReloaded.startFrame, actionSaved.startFrame, "timeline timing survives editor reload");
  assert.equal(actionReloaded.path[0].x, actionSaved.path[0].x, "canvas path survives editor reload");

  await writeFile(path.join(evidenceDir, "volcano-review.json"), JSON.stringify({
    classification: "silent animation fixture; not production art or approved narration",
    artwork: "procedural VisualWorld draft; no local Google Flow portrait assets",
    narration: "none; approximate beat timing",
    preview: { file: expectedFiles[0], durationSec: previewManifest.durationSec, width: previewManifest.width, height: previewManifest.height, audio: previewManifest.audioValidation },
    full: { file: expectedFiles[1], durationSec: fullManifest.durationSec, width: fullManifest.width, height: fullManifest.height, audio: fullManifest.audioValidation },
    frames: [...frames, ...fullFrames].map(([, name]) => `frame-sequence/${name}`),
    editor: { visualWorldScreenshot: expectedFiles[3], timelinePathScreenshot: expectedFiles[4], timingAndPathSaved: true, editsSurvivedReload: true },
  }, null, 2), { flag: reuseExisting ? "w" : "wx" });
  console.log(`Saved volcano render and editor evidence under ${path.relative(root, evidenceDir)}`);
} finally {
  if (browser) await browser.close({ silent: true });
  await stop(viteServer);
  await stop(apiServer);
  await rm(tempDir, { recursive: true, force: true });
}
