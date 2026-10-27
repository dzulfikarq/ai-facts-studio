import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { openBrowser } from "@remotion/renderer";
import { parseManualAiResult, type AiGenerationInput } from "../src/domain/ai-generation";
import { parseResearchPackage } from "../src/domain/research";
import { applyVisualStoryboard } from "../src/domain/visual-storyboard";
import { renderSnapshot } from "../scripts/render-core";
import { RENDERER_VERSION } from "../src/video/renderer-version";

const root = process.cwd();
const execFileAsync = promisify(execFile);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-facts-visual-storyboard-"));
const screenshotDir = path.resolve(root, process.env.VISUAL_STORYBOARD_SMOKE_OUTPUT_DIR ?? "artifacts/visual-storyboard-phase2");
const cleanupProjectIds: string[] = [];
await mkdir(screenshotDir, { recursive: true });

async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function stop(child?: ChildProcess) {
  if (!child || child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 4000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
    child.kill();
  });
}

async function waitFor(check: () => Promise<boolean>, description: string, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out: ${description}`);
}

const apiPort = await freePort();
const vitePort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const viteUrl = `http://127.0.0.1:${vitePort}`;
const apiServer = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
  cwd: root,
  env: { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(apiPort), VITE_PORT: String(vitePort), DATA_DIR: path.join(tempDir, "data"), DAILY_JOB_LIMIT: "1", TTS_MOCK_PROVIDER: "0", GEMINI_API_KEY: "", HF_TOKEN: "", HF_IMAGE_GENERATION_ENABLED: "false", HF_IMAGE_ALLOW_PAID: "false", OPENCODE_SERVER_URL: "http://127.0.0.1:4096" },
  stdio: "ignore",
});
let viteServer: ChildProcess | undefined;
let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;

try {
  await waitFor(async () => {
    try { return (await fetch(`${apiUrl}/api/status`)).ok; } catch { return false; }
  }, "local API startup");
  viteServer = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], {
    cwd: root,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(apiPort), VITE_PORT: String(vitePort) },
    stdio: "ignore",
  });
  await waitFor(async () => {
    try { return (await fetch(`${viteUrl}/api/status`)).ok; } catch { return false; }
  }, "Vite UI and API proxy startup");

  const sampleFiles = ["bagaimana-bumi-melindungi-kita.json", "kenapa-air-laut-asin.json", "bagaimana-pelangi-terbentuk.json"];
  const projects: Array<{ id: string; title: string; scenes: number }> = [];
  for (const filename of sampleFiles) {
    const researchPackage = JSON.parse(await readFile(path.join(root, "samples", filename), "utf8"));
    const response = await fetch(`${apiUrl}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage }) });
    assert.equal(response.status, 201);
    const project = await response.json();
    assert.equal(project.visualStoryboard.scenes.length, researchPackage.scenes.length);
    assert.ok(project.visualStoryboard.scenes.every((scene: { authoringStatus: string }) => scene.authoringStatus === "ready_for_review"), `${filename} should map to supported reusable objects`);
    if (filename === "bagaimana-bumi-melindungi-kita.json") assert.equal(project.visualStoryboard.scenes.length, 5, "Earth sample covers five distinct explanation beats");
    assert.ok(project.visualStoryboard.scenes.every((scene: { layout: string }) => scene.layout !== "two-column-object-grid"), `${filename} must not fall back to generic icon cards`);
    if (filename === "kenapa-air-laut-asin.json") {
      assert.deepEqual(project.visualStoryboard.scenes.map((scene: { compositionType: string }) => scene.compositionType), ["hero-object-focus", "cross-section", "connected-environment", "cross-section", "scientific-diagram"]);
      const riverLayers = project.visualStoryboard.scenes[2].composition.layers.map((layer: { id: string }) => layer.id);
      assert.ok(["mountain", "river", "coast-and-ocean"].every((id) => riverLayers.includes(id)), "river and sea must share one connected landscape");
    }
    const blocked = await fetch(`${apiUrl}/api/projects/${project.id}/generate`, { method: "POST" });
    assert.equal(blocked.status, 409, "unapproved visual storyboard must block snapshot creation");
    projects.push({ id: project.id, title: project.researchPackage.title, scenes: project.visualStoryboard.scenes.length });
    cleanupProjectIds.push(project.id);
  }

  const cancelResearch = JSON.parse(await readFile(path.join(root, "samples", "kenapa-air-laut-asin.json"), "utf8"));
  cancelResearch.id = "motion-cancel-retry-smoke";
  cancelResearch.title = "Motion cancel and retry smoke";
  cancelResearch.scenes = Array.from({ length: 30 }, (_, index) => {
    const source = cancelResearch.scenes[index % cancelResearch.scenes.length];
    const startSec = Number((index * 32 / 30).toFixed(3));
    const endSec = index === 29 ? 32 : Number(((index + 1) * 32 / 30).toFixed(3));
    return { ...structuredClone(source), id: `motion-cancel-${String(index + 1).padStart(2, "0")}`, order: index + 1, startSec, endSec };
  });
  cancelResearch.narration = cancelResearch.scenes.map((scene: { narrationText: string }) => scene.narrationText).join(" ");
  const cancelCreated = await fetch(`${apiUrl}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: cancelResearch }) });
  assert.equal(cancelCreated.status, 201, `30-scene cancellation fixture validates: ${await cancelCreated.clone().text()}`);
  const cancelProject = await cancelCreated.json();
  cleanupProjectIds.push(cancelProject.id);
  const cancelStart = await fetch(`${apiUrl}/api/projects/${cancelProject.id}/motion-preparation`, {
    method: "POST", headers: { "content-type": "application/json", origin: apiUrl }, body: JSON.stringify({ requestId: randomUUID(), intensity: "balanced" }),
  });
  assert.equal(cancelStart.status, 202, "long persisted motion batch starts");
  const cancelStartedJob = (await cancelStart.json()).job;
  const cancelResponse = await fetch(`${apiUrl}/api/projects/${cancelProject.id}/motion-preparation/${cancelStartedJob.id}/cancel`, {
    method: "POST", headers: { origin: apiUrl },
  });
  assert.equal(cancelResponse.status, 202, "running motion batch accepts cancellation");
  let cancelledMotion: any;
  await waitFor(async () => {
    cancelledMotion = await fetch(`${apiUrl}/api/projects/${cancelProject.id}/motion-preparation`).then((response) => response.json());
    return cancelledMotion.job?.status !== "running";
  }, "motion batch cancellation persists", 150);
  assert.equal(cancelledMotion.job.status, "cancelled", "cancelled motion job reaches terminal cancelled state");
  const cancelledSceneIds = cancelledMotion.job.scenes.filter((scene: { status: string }) => scene.status === "cancelled").map((scene: { sceneId: string }) => scene.sceneId);
  assert.ok(cancelledSceneIds.length > 0, "cancel preserves completed work and marks remaining scenes cancelled");
  const retryResponse = await fetch(`${apiUrl}/api/projects/${cancelProject.id}/motion-preparation`, {
    method: "POST", headers: { "content-type": "application/json", origin: apiUrl },
    body: JSON.stringify({ requestId: randomUUID(), intensity: "balanced", sceneIds: cancelledSceneIds }),
  });
  assert.equal(retryResponse.status, 202, "cancelled scenes can be retried selectively");
  await waitFor(async () => (await fetch(`${apiUrl}/api/projects/${cancelProject.id}/motion-preparation`).then((response) => response.json())).job?.status !== "running", "selective motion retry completes", 150);
  const motionRetry = await fetch(`${apiUrl}/api/projects/${cancelProject.id}/motion-preparation`).then((response) => response.json());
  assert.equal(motionRetry.job.status, "completed");
  assert.ok(motionRetry.job.scenes.filter((scene: { sceneId: string }) => cancelledSceneIds.includes(scene.sceneId)).every((scene: { status: string }) => scene.status === "ready_for_review"), "retry fills cancelled scenes without replacing completed scenes");
  const reopenedMotion = await fetch(`${apiUrl}/api/projects/${cancelProject.id}`).then((response) => response.json());
  assert.equal(reopenedMotion.motionPreparation.id, motionRetry.job.id, "latest motion retry survives project reopen");

  const batchResearch = JSON.parse(await readFile(path.join(root, "samples", "kenapa-air-laut-asin.json"), "utf8"));
  batchResearch.title = "Smart Hybrid batch smoke";
  const batchCreated = await fetch(`${apiUrl}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: batchResearch }) });
  assert.equal(batchCreated.status, 201);
  const batchProject = await batchCreated.json();
  const batchStory = { title: batchProject.researchPackage.title as string, scenes: batchProject.visualStoryboard.scenes.length as number };
  const batchBoard = structuredClone(batchProject.visualStoryboard);
  batchBoard.scenes[0] = {
    ...batchBoard.scenes[0], headline: "Konsep yang belum didukung", narrationText: "Eksperimen kuantum rekaan ini mengurai konsep abstrak yang belum tersedia di library ilustrasi lokal.",
    visualSummary: "Satu proses abstrak baru yang tidak dikenali oleh composer lokal.", composition: { background: batchBoard.palette.canvas, layers: [{ id: "placeholder", depth: 0.5, nodes: [{ type: "shape", shape: "rect", x: 0, y: 0, width: 1080, height: 1920, fill: batchBoard.palette.canvas }] }] },
    objects: [], relationships: [], visualFocus: null, semanticPlan: undefined, compositionSource: "existing", authoringStatus: "needs_visual_authoring",
    authoringConfirmed: false, missingVisuals: ["konsep abstrak belum dikenali"], warnings: ["smoke fixture: visual tidak didukung"], approved: false, approvedFingerprint: null,
  };
  const batchSaved = await fetch(`${apiUrl}/api/projects/${batchProject.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: batchProject.researchPackage, visualStoryboard: batchBoard }) });
  assert.equal(batchSaved.status, 200, `batch UI fixture is valid: ${await batchSaved.clone().text()}`);
  cleanupProjectIds.push(batchProject.id);

  const imageProviderStatus = await fetch(`${apiUrl}/api/ai-image/providers`).then((response) => response.json());
  assert.equal(imageProviderStatus.configured, false, "no paid image provider is enabled by default");
  assert.equal(imageProviderStatus.status, "Not Configured");
  assert.equal(imageProviderStatus.providers[0].models.length, 0, "disabled image provider does not make Hub requests");
  assert.match(imageProviderStatus.message, /HF_TOKEN/);
  const unconfiguredProject = await fetch(`${apiUrl}/api/projects/${projects[0]!.id}`).then((response) => response.json());
  const blockedImageRequest = await fetch(`${apiUrl}/api/projects/${projects[0]!.id}/scenes/${unconfiguredProject.visualStoryboard.scenes[0].sceneId}/ai-image/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "huggingface-inference", model: "stabilityai/stable-diffusion-3-medium-diffusers", prompt: "one 2D educational scene for a 9:16 video", resolution: "576x1024", confirmed: true, costAcknowledged: true }) });
  assert.equal(blockedImageRequest.status, 503, "image generation stays disabled without backend token and operator opt-in");
  const syntheticImagePath = path.join(tempDir, "synthetic-raster-smoke.png");
  await execFileAsync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1080x1080:rate=1", "-frames:v", "1", syntheticImagePath]);
  const syntheticImage = await readFile(syntheticImagePath);
  const uploadForm = new FormData();
  uploadForm.append("illustration", new Blob([syntheticImage], { type: "image/png" }), "synthetic-raster-smoke.png");
  uploadForm.append("name", "Synthetic raster smoke fixture · NOT AI");
  uploadForm.append("source", "user-upload");
  uploadForm.append("license", "Generated locally with FFmpeg testsrc2 for integration smoke; not AI output");
  uploadForm.append("style", "smoke-fixture");
  uploadForm.append("semanticTags", "raster,smoke");
  const uploadResponse = await fetch(`${apiUrl}/api/projects/${projects[0]!.id}/visual-assets`, { method: "POST", body: uploadForm });
  assert.equal(uploadResponse.status, 201, `valid raster upload is accepted: ${await uploadResponse.clone().text()}`);
  const uploadResult = await uploadResponse.json();
  const smokeAsset = uploadResult.asset as { id: string; file: string; source: string; sha256: string; width: number; height: number; bytes: number };
  assert.equal(smokeAsset.source, "user-upload", "synthetic fixture is never misreported as AI-generated");
  assert.ok(smokeAsset.width <= 1080 && smokeAsset.height <= 1920 && smokeAsset.bytes > 0, "decoded dimensions and optimized file metadata persist");
  const libraryResponse = await fetch(`${apiUrl}/api/visual-assets/library`).then((response) => response.json());
  assert.ok(libraryResponse.assets.some((asset: { id: string }) => asset.id === smokeAsset.id), "library indexes uploaded content-addressed asset across projects");
  const originalSalt = await fetch(`${apiUrl}/api/projects/${projects[1]!.id}`).then((response) => response.json());
  const proxiedProjects = await fetch(`${viteUrl}/api/projects`).then((response) => response.json());
  assert.ok(projects.every((project) => proxiedProjects.some((item: { id: string }) => item.id === project.id)), "Vite proxy routes browser requests to isolated smoke API");

  browser = await openBrowser("chrome", { logLevel: "error" });
  const page = await browser.newPage({ context: () => null, logLevel: "error", indent: 0, pageIndex: 0, onBrowserLog: () => {}, onLog: () => {} } as never);
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto({ url: viteUrl, timeout: 30_000 });
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".project-card-open").length >= 2), "project list in original UI");
  assert.equal((await fetch(`${apiUrl}/api/status`).then((response) => response.json())).generationMode, "development");
  const setSmokeAiMode = (mode: "development" | "production") => {
    const settingsDb = new DatabaseSync(path.join(tempDir, "data", "ai-facts-studio.sqlite"));
    settingsDb.prepare("INSERT INTO ai_generation_settings (id, mode, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at").run(mode, new Date().toISOString());
    settingsDb.close();
  };
  setSmokeAiMode("production");
  const productionStatus = await fetch(`${apiUrl}/api/status`).then((response) => response.json());
  assert.equal(productionStatus.generationMode, "production");
  assert.equal(productionStatus.dailyLimit, 1);
  await page.goto({ url: `${viteUrl}/?render-quota-mode=production`, timeout: 30_000 });
  await waitFor(() => page.evaluate(() => document.querySelector(".dashboard-heading") !== null), "dashboard reload in Production mode");
  assert.equal(await page.evaluate(() => document.querySelector(".dashboard-heading")?.textContent?.includes("Project Saya")), true);
  setSmokeAiMode("development");
  assert.equal((await fetch(`${apiUrl}/api/status`).then((response) => response.json())).generationMode, "development");
  await page.goto({ url: `${viteUrl}/?render-quota-mode=development`, timeout: 30_000 });
  await waitFor(() => page.evaluate(() => document.querySelector(".dashboard-heading") !== null), "dashboard reload in Development mode");
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".project-card-open").length >= 2), "projects reload in Development mode");
  assert.equal((await fetch(`${apiUrl}/api/status`).then((response) => response.json())).generationMode, "development");

  async function openStoryboard(project: { title: string; scenes: number }, screenshot: string, expectedStatus = "Ready for Review") {
    const openResult = await page.evaluate((title) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>(".project-card-open")].find((item) => item.getAttribute("aria-label")?.includes(title));
      button?.click();
      return { found: Boolean(button), labels: [...document.querySelectorAll<HTMLButtonElement>(".project-card-open")].map((item) => item.getAttribute("aria-label")), body: document.body.innerText.slice(0, 600) };
    }, project.title);
    assert.equal(openResult.found, true, `project card button exists for ${project.title}; available: ${JSON.stringify(openResult)}`);
    try { await waitFor(() => page.evaluate((title) => document.querySelector<HTMLInputElement>(".title-input")?.value === title, project.title), `workspace for ${project.title}`); }
    catch (error) { console.error("Workspace open debug:", await page.evaluate(() => ({ title: document.querySelector<HTMLInputElement>(".title-input")?.value, body: document.body.innerText.slice(0, 900) }))); throw error; }
    const stepHeights = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".workflow-step")].map((step) => Math.round(step.getBoundingClientRect().height)));
    assert.equal(new Set(stepHeights).size, 1, `workflow step cards should have equal height: ${stepHeights.join(", ")}`);
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="visual"]')?.click());
    await waitFor(() => page.evaluate((count) => document.querySelectorAll(".visual-scene-card").length === count, project.scenes), `Visual Storyboard for ${project.title}`);
    const status = await page.evaluate(() => document.querySelector(".visual-review-state strong")?.textContent?.trim());
    assert.equal(status, expectedStatus);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await captureScreenshot(page, path.join(screenshotDir, screenshot));
  }

  async function captureScreenshot(target: typeof page, output: string) {
    const client = (target as unknown as { _client: () => { send: (method: string, params?: Record<string, unknown>) => Promise<{ value: any }> } })._client();
    const metrics = (await client.send("Page.getLayoutMetrics")).value;
    const width = Math.min(1440, metrics.cssContentSize.width);
    const height = Math.min(5000, metrics.cssContentSize.height);
    const image = (await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 0.8 } })).value;
    await writeFile(output, Buffer.from(image.data, "base64"));
  }

  async function captureViewportScreenshot(target: typeof page, output: string) {
    const client = (target as unknown as { _client: () => { send: (method: string, params?: Record<string, unknown>) => Promise<{ value: any }> } })._client();
    const viewport = await target.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    const image = (await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false, clip: { x: 0, y: 0, ...viewport, scale: 1 } })).value;
    await writeFile(output, Buffer.from(image.data, "base64"));
  }

  async function extractReviewFrame(video: string, seconds: number, output: string) {
    await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(seconds), "-i", video, "-frames:v", "1", "-vf", "scale=324:576", "-y", output], { timeout: 60_000 });
  }

  async function buildContactSheet(frames: string[], output: string) {
    const inputs = frames.flatMap((file) => ["-i", file]);
    const filters = frames.map((_, index) => `[${index}:v]setsar=1[v${index}]`).join(";");
    const stack = frames.map((_, index) => `[v${index}]`).join("");
    await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", `${filters};${stack}hstack=inputs=${frames.length}[out]`, "-map", "[out]", "-frames:v", "1", output], { timeout: 60_000 });
  }

  async function runSmartHybridAcceptance(projectId: string, slug: string) {
    const before = await fetch(`${apiUrl}/api/projects/${projectId}`).then((response) => response.json());
    const beforeVisuals = before.visualStoryboard.scenes.map((scene: { composition: unknown; compositionSource: string; authoringStatus: string; approved: boolean; approvedFingerprint: string | null }) => ({
      composition: scene.composition, compositionSource: scene.compositionSource, authoringStatus: scene.authoringStatus, approved: scene.approved, approvedFingerprint: scene.approvedFingerprint,
    }));
    const response = await fetch(`${apiUrl}/api/projects/${projectId}/visual-preparation`, {
      method: "POST", headers: { "content-type": "application/json", origin: apiUrl }, body: JSON.stringify({ requestId: randomUUID() }),
    });
    assert.equal(response.status, 202, `${slug} Smart Hybrid batch starts`);
    const started = await response.json();
    await waitFor(async () => (await fetch(`${apiUrl}/api/projects/${projectId}/visual-preparation`).then((result) => result.json())).job?.status !== "running", `${slug} Smart Hybrid batch settles`, 100);
    const latest = await fetch(`${apiUrl}/api/projects/${projectId}`).then((result) => result.json());
    const job = latest.visualPreparation;
    assert.equal(job.id, started.job.id);
    assert.equal(job.status, "completed");
    assert.equal(job.total, beforeVisuals.length);
    assert.equal(job.readyForReview, beforeVisuals.length, `${slug} scenes remain ready for human review`);
    assert.equal(job.needsAttention, 0);
    assert.ok(job.scenes.every((scene: { status: string; source: string }) => scene.status === "ready_for_review" && scene.source === "preserved"), `${slug} already-ready art is preserved rather than regenerated`);
    const afterVisuals = latest.visualStoryboard.scenes.map((scene: { composition: unknown; compositionSource: string; authoringStatus: string; approved: boolean; approvedFingerprint: string | null }) => ({
      composition: scene.composition, compositionSource: scene.compositionSource, authoringStatus: scene.authoringStatus, approved: scene.approved, approvedFingerprint: scene.approvedFingerprint,
    }));
    assert.deepEqual(afterVisuals, beforeVisuals, `${slug} batch does not mutate ready artwork or approvals`);

    const evidenceDir = path.join(screenshotDir, `smart-hybrid-acceptance-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    await mkdir(evidenceDir, { recursive: true });
    const research = parseResearchPackage(applyVisualStoryboard(latest.researchPackage, latest.visualStoryboard));
    assert.equal(research.success, true, `${slug} project research remains valid`);
    if (!research.success) throw new Error(`${slug} research package invalid after batch`);
    const storyboardPath = path.join(evidenceDir, `${slug}-visual-storyboard.json`);
    const jobPath = path.join(evidenceDir, `${slug}-preparation-job.json`);
    const mp4Path = path.join(evidenceDir, `${slug}-review-silent.mp4`);
    await writeFile(storyboardPath, JSON.stringify(latest.visualStoryboard, null, 2), { flag: "wx" });
    await writeFile(jobPath, JSON.stringify({ topic: latest.researchPackage.title, disposition: "all scenes already had locally authored/reusable illustrations; Smart Hybrid preserved them; no AI Image/Vector generation", job }, null, 2), { flag: "wx" });
    const manifest = await renderSnapshot({ research: research.data, visualAssets: latest.visualAssets, rendererVersion: RENDERER_VERSION }, mp4Path, () => {}, 0.35);
    await writeFile(mp4Path.replace(/\.mp4$/i, ".manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
    const frames: string[] = [];
    for (const [index, scene] of research.data.scenes.entries()) {
      const framePath = path.join(evidenceDir, `${slug}-scene-${String(index + 1).padStart(2, "0")}.png`);
      await extractReviewFrame(mp4Path, (scene.startSec + scene.endSec) / 2, framePath);
      frames.push(framePath);
    }
    const contactPath = path.join(evidenceDir, `${slug}-contact-sheet.png`);
    await buildContactSheet(frames, contactPath);
    return { evidenceDir, job, manifest, contactPath, mp4Path };
  }

  async function clickButtonStartingWith(label: string) {
    const clicked = await page.evaluate((value) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.trim().startsWith(value));
      button?.click();
      return Boolean(button);
    }, label);
    assert.equal(clicked, true, `button should exist: ${label}`);
  }

  async function chooseIllustrationSource(sceneIndex: number, source: string) {
    await page.evaluate((index) => [...(document.querySelectorAll<HTMLElement>(".visual-scene-card")[index]?.querySelectorAll<HTMLButtonElement>(".visual-scene-actions button") ?? [])].find((button) => button.textContent?.includes("Ubah Ilustrasi"))?.click(), sceneIndex);
    await waitFor(() => page.evaluate(() => document.querySelector<HTMLDialogElement>(".visual-source-dialog")?.open ?? false), "scene illustration source dialog");
    const selected = await page.evaluate((label) => {
      const button = [...(document.querySelector<HTMLDialogElement>(".visual-source-dialog")?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((item) => item.textContent?.trim().startsWith(label));
      button?.click();
      return Boolean(button);
    }, source);
    assert.equal(selected, true, `illustration source option exists: ${source}`);
  }

  async function setField(selector: string, value: string) {
    const updated = await page.evaluate(({ query, text }) => {
      const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(query);
      if (!element) return false;
      const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, text);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, { query: selector, text: value });
    assert.equal(updated, true, `field should exist: ${selector}`);
  }

  async function openCreateVideo() {
    await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".topbar-create")].find((button) => !button.disabled && !button.classList.contains("topbar-primary-anchor"))?.click());
    await waitFor(() => page.evaluate(() => document.querySelector<HTMLInputElement>(".ai-topic-field input") !== null), "new Create Video form");
    await waitFor(() => page.evaluate(() => !document.querySelector<HTMLInputElement>(".ai-topic-field input")?.disabled), "AI generation settings loaded");
  }

  async function generateManualReview(topic: string, researchPackage: unknown) {
    await setField(".ai-topic-field input", topic);
    await page.evaluate(() => document.querySelector<HTMLDetailsElement>(".ai-advanced-flow")?.querySelector("summary")?.click());
    await clickButtonStartingWith("Buat Prompt Manual");
    await setField(".manual-prompt-result", JSON.stringify({ researchPackage }));
    await clickButtonStartingWith("Validate & Review");
    await waitFor(() => page.evaluate(() => document.querySelector(".ai-draft-review") !== null), `review result for ${topic}`);
  }

  const seaSaltEvidence = await runSmartHybridAcceptance(projects[1]!.id, "sea-salt");
  const rainbowEvidence = await runSmartHybridAcceptance(projects[2]!.id, "rainbow");
  console.log(`Smart Hybrid topic evidence: ${seaSaltEvidence.evidenceDir} (${seaSaltEvidence.manifest.width}x${seaSaltEvidence.manifest.height} silent MP4 + contact sheet); ${rainbowEvidence.evidenceDir} (${rainbowEvidence.manifest.width}x${rainbowEvidence.manifest.height} silent MP4 + contact sheet). Existing scene art preserved; no AI generation.`);

  const motionBatchResponse = await fetch(`${apiUrl}/api/projects/${projects[1]!.id}/motion-preparation`, {
    method: "POST", headers: { "content-type": "application/json", origin: apiUrl }, body: JSON.stringify({ requestId: randomUUID(), intensity: "balanced" }),
  });
  assert.equal(motionBatchResponse.status, 202, "salt Motion Director batch starts from persisted project");
  await waitFor(async () => (await fetch(`${apiUrl}/api/projects/${projects[1]!.id}/motion-preparation`).then((response) => response.json())).job?.status !== "running", "salt Motion Director batch completes", 150);
  const motionBatch = await fetch(`${apiUrl}/api/projects/${projects[1]!.id}/motion-preparation`).then((response) => response.json());
  assert.equal(motionBatch.job.status, "completed");
  const motionStoryboard = await fetch(`${apiUrl}/api/projects/${projects[1]!.id}`).then((response) => response.json());
  assert.ok(motionStoryboard.visualStoryboard.scenes.some((scene: { motionActions: unknown[] }) => scene.motionActions.length > 0), "motion plan persists to project storyboard before UI preview");

  await openStoryboard(batchStory, "smart-hybrid-unified-workflow.png", "Needs Attention");
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.evaluate(() => [...(document.querySelectorAll<HTMLElement>(".visual-scene-card")[0]?.querySelectorAll<HTMLButtonElement>(".visual-scene-actions button") ?? [])].find((button) => button.textContent?.includes("Ubah Ilustrasi"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLDialogElement>(".visual-source-dialog")?.open ?? false), "responsive source chooser dialog");
  const sourceDialogBounds = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>(".visual-source-dialog");
    const rect = dialog?.getBoundingClientRect();
    return { left: rect?.left ?? -1, right: rect?.right ?? Infinity, viewport: window.innerWidth, labelled: Boolean(dialog?.getAttribute("aria-labelledby") && document.getElementById(dialog.getAttribute("aria-labelledby")!)), focusInside: Boolean(dialog?.contains(document.activeElement)) };
  });
  assert.ok(sourceDialogBounds.left >= 0 && sourceDialogBounds.right <= sourceDialogBounds.viewport, `source chooser fits 390px viewport: ${JSON.stringify(sourceDialogBounds)}`);
  assert.equal(sourceDialogBounds.labelled, true, "source dialog has accessible label");
  assert.equal(sourceDialogBounds.focusInside, true, "native modal dialog moves keyboard focus inside");
  await captureScreenshot(page, path.join(screenshotDir, "smart-hybrid-source-picker-mobile.png"));
  await page.evaluate(() => document.querySelector<HTMLDialogElement>(".visual-source-dialog")?.close());
  await waitFor(() => page.evaluate(() => !document.querySelector<HTMLDialogElement>(".visual-source-dialog")?.open), "close mobile source chooser");
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  const startedBatch = await page.evaluate(() => {
    [...document.querySelectorAll<HTMLButtonElement>(".visual-preparation-actions button")].find((button) => button.textContent?.trim() === "Siapkan Semua Ilustrasi")?.click();
    return document.querySelector(".visual-preparation-actions button")?.textContent?.trim();
  });
  assert.ok(startedBatch?.includes("Menyiapkan Ilustrasi") || startedBatch === "Siapkan Semua Ilustrasi", "batch action starts from unified storyboard UI");
  await waitFor(() => page.evaluate(() => document.querySelector(".visual-preparation-progress") !== null), "persisted batch progress appears in UI");
  await captureScreenshot(page, path.join(screenshotDir, "smart-hybrid-batch-progress.png"));
  await waitFor(async () => {
    const latest = await fetch(`${apiUrl}/api/projects/${batchProject.id}/visual-preparation`).then((response) => response.json());
    return latest.job?.status !== "running";
  }, "Smart Hybrid batch completes with unsupported scene retained as attention", 100);
  const completedBatch = await fetch(`${apiUrl}/api/projects/${batchProject.id}/visual-preparation`).then((response) => response.json());
  assert.notEqual(completedBatch.job.id, undefined);
  assert.ok(["completed", "partial_failure"].includes(completedBatch.job.status));
  assert.ok(completedBatch.job.needsAttention >= 1, "unsupported concepts stay Needs Attention; batch does not force irrelevant art");
  await captureScreenshot(page, path.join(screenshotDir, "smart-hybrid-needs-attention.png"));
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[aria-label="Kembali ke Project Saya"]')?.click());
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".project-card-open").length >= 2), "return to dashboard after batch");
  await openStoryboard(batchStory, "smart-hybrid-batch-reopened.png", "Needs Attention");
  const reopenedBatch = await fetch(`${apiUrl}/api/projects/${batchProject.id}`).then((response) => response.json());
  assert.equal(reopenedBatch.visualPreparation.id, completedBatch.job.id, "reopening restores last batch status");
  assert.equal(reopenedBatch.visualPreparation.status, completedBatch.job.status);
  const retried = await page.evaluate(() => {
    [...document.querySelectorAll<HTMLButtonElement>(".visual-preparation-actions button")].find((button) => button.textContent?.trim() === "Perbaiki Scene Bermasalah")?.click();
    return true;
  });
  assert.equal(retried, true);
  await waitFor(async () => {
    const latest = await fetch(`${apiUrl}/api/projects/${batchProject.id}/visual-preparation`).then((response) => response.json());
    return latest.job?.id !== completedBatch.job.id;
  }, "repair button retries only unresolved scene", 100);
  await waitFor(async () => (await fetch(`${apiUrl}/api/projects/${batchProject.id}/visual-preparation`).then((response) => response.json())).job?.status !== "running", "selective retry completes", 100);
  const retriedBatch = await fetch(`${apiUrl}/api/projects/${batchProject.id}/visual-preparation`).then((response) => response.json());
  assert.ok(retriedBatch.job.scenes.filter((scene: { status: string }) => scene.status === "pending").length === 0, "selective retry does not leave pending work");
  assert.deepEqual(retriedBatch.job.scenes.filter((scene: { source?: string }) => scene.source !== "preserved").map((scene: { sceneId: string }) => scene.sceneId), [batchProject.visualStoryboard.scenes[0].sceneId], "selective retry targets only unresolved, unprotected scene");
  await captureScreenshot(page, path.join(screenshotDir, "smart-hybrid-selective-retry.png"));
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[aria-label="Kembali ke Project Saya"]')?.click());
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".project-card-open").length >= 2), "return to dashboard after retry");

  await openStoryboard(projects[0]!, "earth-visual-storyboard.png");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[aria-label="Kembali ke Project Saya"]')?.click());
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".project-card-open").length >= 2), "return to project dashboard");
  await openStoryboard(projects[1]!, "sea-salt-visual-storyboard.png");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLInputElement>(".title-input")?.value), projects[1]!.title, "library scene belongs to destination project");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".visual-scene-actions button")].find((button) => button.textContent?.includes("Motion Preview"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLDialogElement>(".visual-preview-dialog")?.open ?? false), "Motion Preview dialog opens from scene review");
  const desktopSeek = await page.evaluate(() => {
    const range = document.querySelector<HTMLInputElement>("#motion-frame-scrubber");
    if (!range) return { exists: false, max: 0, labelled: false };
    range.value = String(Math.floor(Number(range.max) * 0.62));
    range.dispatchEvent(new Event("input", { bubbles: true }));
    range.dispatchEvent(new Event("change", { bubbles: true }));
    range.focus();
    return { exists: true, max: Number(range.max), labelled: Boolean(document.querySelector('label[for="motion-frame-scrubber"]')), focused: document.activeElement === range };
  });
  assert.equal(desktopSeek.exists, true, "native frame scrubber exists");
  assert.equal(desktopSeek.labelled, true, "motion scrubber has an accessible label");
  assert.equal(desktopSeek.focused, true, "motion scrubber receives keyboard focus");
  const keyboard = (page as unknown as { _client: () => { send: (method: string, params?: Record<string, unknown>) => Promise<unknown> } })._client();
  const valueBeforeArrow = await page.evaluate(() => document.querySelector<HTMLInputElement>("#motion-frame-scrubber")?.value);
  await keyboard.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await keyboard.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await waitFor(async () => (await page.evaluate(() => document.querySelector<HTMLInputElement>("#motion-frame-scrubber")?.value)) !== valueBeforeArrow, "keyboard arrows seek deterministic preview frames");
  await captureScreenshot(page, path.join(screenshotDir, "motion-director-preview.png"));
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  const previewBounds = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>(".visual-preview-dialog");
    const rect = dialog?.getBoundingClientRect();
    return { left: rect?.left ?? -1, right: rect?.right ?? Infinity, viewport: innerWidth, rangeVisible: Boolean(document.querySelector<HTMLInputElement>("#motion-frame-scrubber")) };
  });
  assert.ok(previewBounds.left >= 0 && previewBounds.right <= previewBounds.viewport && previewBounds.rangeVisible, `motion preview fits mobile viewport: ${JSON.stringify(previewBounds)}`);
  await captureViewportScreenshot(page, path.join(screenshotDir, "motion-director-preview-mobile.png"));
  await page.evaluate(() => document.querySelector<HTMLDialogElement>(".visual-preview-dialog")?.close());
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });

  await chooseIllustrationSource(0, "AI Image");
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".illustration-prompt-panel").length === 1), "scene-specific AI Image prompt builder");
  const generatedPrompt = await page.evaluate(() => document.querySelector<HTMLTextAreaElement>(".illustration-prompt-details textarea")?.value ?? "");
  assert.match(generatedPrompt, /Laut tampak biru/);
  assert.match(generatedPrompt, /portrait 9:16/);
  assert.match(generatedPrompt, /No words.*watermark.*card layouts/s);
  assert.match(generatedPrompt, /Required spatial relationships and direction/);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".illustration-prompt-panel button")].find((button) => button.textContent?.trim() === "Generate Illustration")?.disabled), true, "Generate Illustration stays disabled when provider is not configured");
  await captureScreenshot(page, path.join(screenshotDir, "ai-image-prompt-builder-manual-import.png"));
  await page.goto({ url: viteUrl, timeout: 30_000 });
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".project-card-open").length >= 2), "discard unsaved prompt-source selection for clean import smoke");
  await openStoryboard(projects[1]!, "sea-salt-visual-storyboard.png");

  await chooseIllustrationSource(2, "Reusable Scene");
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLDialogElement>(".smart-asset-dialog")?.open ?? false), "smart asset library dialog");
  await waitFor(async () => (await fetch(`${apiUrl}/api/reusable-scenes`).then((response) => response.json())).total === 0, "initial reusable-scene catalog is empty");
  await clickButtonStartingWith("Simpan komposisi reusable");
  await waitFor(async () => (await fetch(`${apiUrl}/api/reusable-scenes`).then((response) => response.json())).total === 1, "save connected river scene as reusable composition", 120);
  const savedReusable = await fetch(`${apiUrl}/api/reusable-scenes`).then((response) => response.json());
  assert.equal(savedReusable.scenes[0].assetIds.length, 0, "river template stores authored composition without synthetic asset references");
  assert.ok(savedReusable.scenes[0].relationships.some((relationship: { relation: string }) => relationship.relation === "flows-to"), "reusable sea-salt composition retains river-to-sea relationship metadata");
  const reusableName = savedReusable.scenes[0].name as string;
  await waitFor(() => page.evaluate((name) => [...document.querySelectorAll<HTMLElement>(".smart-asset-card")].some((card) => card.textContent?.includes(name)), reusableName), "saved composition appears in reusable scene search", 100);
  await captureScreenshot(page, path.join(screenshotDir, "reusable-scenes-river.png"));
  await page.evaluate((name) => [...document.querySelectorAll<HTMLElement>(".smart-asset-card")].find((card) => card.textContent?.includes(name))?.querySelector<HTMLButtonElement>("button")?.click(), reusableName);
  await waitFor(() => page.evaluate(() => !document.querySelector<HTMLDialogElement>(".smart-asset-dialog")?.open), "copy saved composition into current storyboard scene");
  const unchangedTemplate = await fetch(`${apiUrl}/api/reusable-scenes`).then((response) => response.json());
  assert.deepEqual(unchangedTemplate.scenes[0].composition, savedReusable.scenes[0].composition, "reuse copies template without mutating its source composition");

  await chooseIllustrationSource(2, "Asset Library");
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLDialogElement>(".smart-asset-dialog")?.open ?? false), "reopen smart asset library after reusable copy");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".smart-asset-tabs [role=tab]")].find((button) => button.textContent?.includes("Asset Packs"))?.click());
  await setField(".smart-asset-search input", "ripple");
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".smart-asset-card")].some((card) => card.textContent?.includes("ripple"))), "search official Tabler metadata");
  await captureScreenshot(page, path.join(screenshotDir, "asset-pack-tabler-icons.png"));
  await page.evaluate(() => {
    const fitMode = [...document.querySelectorAll<HTMLLabelElement>(".smart-asset-toolbar label")].find((label) => label.textContent?.includes("Cara gunakan"))?.querySelector("select");
    if (fitMode) { fitMode.value = "layer"; fitMode.dispatchEvent(new Event("input", { bubbles: true })); fitMode.dispatchEvent(new Event("change", { bubbles: true })); }
    const card = [...document.querySelectorAll<HTMLElement>(".smart-asset-card")].find((item) => item.textContent?.includes("ripple"));
    card?.querySelector<HTMLButtonElement>(".button-primary")?.click();
  });
  await waitFor(() => page.evaluate(() => !document.querySelector<HTMLDialogElement>(".smart-asset-dialog")?.open && document.querySelectorAll(".visual-asset-review").length > 0), "import and use sanitized Tabler ripple as one small layer");
  assert.equal((await fetch(`${apiUrl}/api/projects/${projects[1]!.id}`).then((response) => response.json())).visualAssets.some((asset: { source: string }) => asset.source === "tabler-pack"), true, "selected icon is stored locally with MIT attribution");

  await chooseIllustrationSource(2, "Asset Library");
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLDialogElement>(".smart-asset-dialog")?.open ?? false), "reopen library for selected local raster");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".smart-asset-tabs [role=tab]")].find((button) => button.textContent?.includes("Cari Online"))?.click());
  await setField(".smart-asset-search input", "river to ocean illustration");
  await clickButtonStartingWith("Cari Openverse");
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector<HTMLElement>(".smart-asset-error")?.textContent) || Boolean(document.querySelector<HTMLElement>(".smart-asset-result-count"))), "Openverse error or live results", 100);
  const openverseEvidence = await page.evaluate(() => ({ results: document.querySelectorAll(".smart-asset-card").length, error: document.querySelector<HTMLElement>(".smart-asset-error")?.textContent ?? "" }));
  if (openverseEvidence.error) assert.equal(openverseEvidence.results, 0, "no fake Openverse result is accepted when external API is unavailable");
  else assert.ok(openverseEvidence.results > 0, "live Openverse result has a rendered preview");
  await captureScreenshot(page, path.join(screenshotDir, "openverse-search.png"));
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  const mobileDialog = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>(".smart-asset-dialog");
    const rect = dialog?.getBoundingClientRect();
    return { width: rect?.width ?? 0, left: rect?.left ?? -1, right: rect?.right ?? Infinity, viewport: window.innerWidth };
  });
  assert.ok(mobileDialog.width > 0 && mobileDialog.left >= 0 && mobileDialog.right <= mobileDialog.viewport, `Smart Asset Library fits 390px viewport: ${JSON.stringify(mobileDialog)}`);
  await captureScreenshot(page, path.join(screenshotDir, "smart-asset-library-mobile.png"));
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".smart-asset-tabs [role=tab]")].find((button) => button.textContent?.includes("Library Saya"))?.click());
  await setField(".smart-asset-search input", "");
  await page.evaluate(() => {
    const mode = [...document.querySelectorAll<HTMLLabelElement>(".smart-asset-toolbar label")].find((label) => label.textContent?.includes("Cara gunakan"))?.querySelector("select");
    if (mode) { mode.value = "hero"; mode.dispatchEvent(new Event("input", { bubbles: true })); mode.dispatchEvent(new Event("change", { bubbles: true })); }
  });
  const fixtureName = "Synthetic raster smoke fixture · NOT AI";
  await waitFor(() => page.evaluate((name) => [...document.querySelectorAll<HTMLElement>(".smart-asset-card")].some((card) => card.textContent?.includes(name)), fixtureName), "selected raster appears in local search");
  const availableAsset = await page.evaluate((name) => [...document.querySelectorAll<HTMLElement>(".smart-asset-card")].find((card) => card.textContent?.includes(name))?.querySelector<HTMLButtonElement>(".button-primary")?.textContent?.trim(), fixtureName);
  assert.equal(availableAsset, "Gunakan di scene", "cross-project raster is selectable from the searchable asset catalog");
  await captureScreenshot(page, path.join(screenshotDir, "asset-library-cross-project.png"));
  await page.evaluate((name) => {
    const card = [...document.querySelectorAll<HTMLElement>(".smart-asset-card")].find((item) => item.textContent?.includes(name));
    card?.querySelector<HTMLButtonElement>(".button-primary")?.click();
  }, fixtureName);
  await waitFor(() => page.evaluate(() => document.querySelector('[role="alertdialog"]') !== null || !document.querySelector<HTMLDialogElement>(".smart-asset-dialog")?.open && document.querySelectorAll(".visual-asset-review").length > 0), "attach selected local raster to river scene");
  if (await page.evaluate(() => document.querySelector('[role="alertdialog"]') !== null)) {
    await page.evaluate(() => document.querySelector<HTMLButtonElement>(".confirm-submit")?.click());
  }
  await waitFor(() => page.evaluate(() => !document.querySelector<HTMLDialogElement>(".smart-asset-dialog")?.open && document.querySelectorAll(".visual-asset-review").length > 0), "confirmed local asset attachment");
  assert.equal(await page.evaluate(() => document.querySelectorAll<HTMLElement>(".visual-scene-card")[2]?.querySelector(".visual-asset-review")?.textContent?.includes("asset-library")), true);
  const destinationAfterAttach = await fetch(`${apiUrl}/api/projects/${projects[1]!.id}`).then((response) => response.json());
  assert.ok(destinationAfterAttach.visualAssets.some((asset: { id: string }) => asset.id === smokeAsset.id), "cross-project library selection attaches the asset metadata");
  const libraryAfterAttach = await fetch(`${apiUrl}/api/visual-assets/library`).then((response) => response.json());
  assert.equal(libraryAfterAttach.assets.find((asset: { id: string }) => asset.id === smokeAsset.id)?.projectIds.length, 2, "server library associates shared content with both projects");
  await chooseIllustrationSource(2, "Asset Library");
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLDialogElement>(".smart-asset-dialog")?.open ?? false), "reopen shared library after cross-project reuse");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".smart-asset-tabs [role=tab]")].find((button) => button.textContent?.includes("Library Saya"))?.click());
  await setField(".smart-asset-search input", "Synthetic raster smoke fixture");
  await waitFor(() => page.evaluate((name) => [...document.querySelectorAll<HTMLElement>(".smart-asset-card")].some((card) => card.textContent?.includes(name)), fixtureName), "library search finds cross-project raster association");
  const linkedProjects = await fetch(`${apiUrl}/api/visual-assets/library?q=${encodeURIComponent("Synthetic raster smoke fixture")}`).then((response) => response.json());
  assert.equal(linkedProjects.assets.find((asset: { id: string }) => asset.id === smokeAsset.id)?.projectIds.length, 2, "same content-addressed file links to both project records");
  await captureScreenshot(page, path.join(screenshotDir, "asset-library-cross-project.png"));
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".smart-asset-head .button")?.click());
  await waitFor(() => page.evaluate(() => !document.querySelector<HTMLDialogElement>(".smart-asset-dialog")?.open), "close smart asset library dialog");
  await captureScreenshot(page, path.join(screenshotDir, "raster-river-storyboard.png"));
  await page.evaluate(() => [...(document.querySelectorAll<HTMLElement>(".visual-scene-card")[2]?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((button) => button.textContent?.includes("Motion Preview"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLDialogElement>(".visual-preview-dialog")?.open ?? false), "raster scene composition preview");
  await captureScreenshot(page, path.join(screenshotDir, "raster-river-scene-preview.png"));
  await page.evaluate(() => [...(document.querySelector<HTMLDialogElement>(".visual-preview-dialog")?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((button) => button.textContent?.includes("Tutup preview"))?.click());
  await waitFor(() => page.evaluate(() => !document.querySelector<HTMLDialogElement>(".visual-preview-dialog")?.open), "close raster scene preview");
  await page.evaluate(() => document.querySelectorAll<HTMLElement>(".visual-scene-card")[2]?.querySelector<HTMLButtonElement>(".visual-asset-review .visual-author-button")?.click());
  await waitFor(() => page.evaluate(() => document.querySelectorAll<HTMLElement>(".visual-scene-card")[2]?.querySelector(".visual-scene-issues") === null), "human confirmation clears raster-only review issue");
  for (let index = 0; index < projects[1]!.scenes; index++) {
    const buttonState = await page.evaluate((item) => {
      const card = document.querySelectorAll<HTMLElement>(".visual-scene-card")[item];
      const button = card?.querySelector<HTMLButtonElement>(".visual-approve-button");
      const state = { disabled: button?.disabled, text: button?.textContent?.trim(), issues: card?.querySelector(".visual-scene-issues")?.textContent, chip: card?.querySelector(".visual-approval-chip")?.textContent?.trim() };
      button?.click();
      return state;
    }, index);
    assert.equal(buttonState.disabled, false, `river project scene ${index + 1} passes visual quality gate`);
    const waitForApprovalInPage = new Function("item", `return new Promise(function(resolve) {
      var card = document.querySelectorAll('.visual-scene-card')[item];
      function approved() { return !!card && card.querySelector('.visual-approval-chip')?.textContent?.trim() === 'Approved'; }
      if (approved()) return resolve(true);
      var observer = new MutationObserver(function() { if (approved()) { observer.disconnect(); resolve(true); } });
      if (card) observer.observe(card, { subtree: true, childList: true, characterData: true });
      setTimeout(function() { observer.disconnect(); resolve(approved()); }, 30000);
    });`) as (item: number) => Promise<boolean>;
    const approved = await page.evaluate(waitForApprovalInPage, index);
    assert.equal(approved, true, `river project scene ${index + 1} approval`);
  }
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".topbar-save")?.click());
  try {
    await waitFor(async () => {
      const saved = await fetch(`${apiUrl}/api/projects/${projects[1]!.id}`).then((response) => response.json());
      return saved.visualStoryboard.scenes.every((scene: { approved: boolean }) => scene.approved) && saved.visualAssets.some((asset: { id: string }) => asset.id === smokeAsset.id);
    }, "save raster approval and project asset link", 150);
  } catch (error) { console.error("Raster save debug:", await page.evaluate(() => document.querySelector(".toast")?.textContent ?? "")); throw error; }
  await waitFor(() => page.evaluate(() => document.querySelector(".toast")?.textContent?.includes("Storyboard tersimpan.") ?? false), "raster save UI settles after API persistence");
  await new Promise((resolve) => setTimeout(resolve, 100));
  const savedSalt = await fetch(`${apiUrl}/api/projects/${projects[1]!.id}`).then((response) => response.json());
  const savedRasterScene = savedSalt.visualStoryboard.scenes[2];
  assert.equal(savedRasterScene.illustrationSource, "asset-library");
  assert.equal(savedRasterScene.approved, true, "raster scene approval persists");
  assert.equal(savedRasterScene.composition.layers[0].nodes[0].asset, smokeAsset.id);
  assert.ok(savedSalt.visualAssets.some((asset: { id: string }) => asset.id === smokeAsset.id), "reused file is attached to destination project without copying bytes");
  const inUseDelete = await fetch(`${apiUrl}/api/projects/${projects[1]!.id}/visual-assets/${encodeURIComponent(smokeAsset.id)}`, { method: "DELETE" });
  assert.equal(inUseDelete.status, 409, "asset used by storyboard cannot be deleted");
  assert.equal((await inUseDelete.json()).code, "visual-asset-in-use");

  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="review"]')?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".workspace-step-heading h2")?.textContent?.trim() === "Review & Subtitle"), "river project fact review");
  await waitFor(() => page.evaluate(() => document.querySelector(".review-author-card button") !== null), "river fact review confirmation control");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".review-author-card button")?.click());
  await waitFor(async () => (await fetch(`${apiUrl}/api/projects/${projects[1]!.id}`).then((response) => response.json())).researchReviewStatus === "verified-by-author", "river fact review persisted");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="preview"]')?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".interactive-preview-player") !== null), "river raster Motion Preview");
  const playClicked = await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".interactive-preview-player button")].find((candidate) => /play/i.test(`${candidate.getAttribute("aria-label")} ${candidate.title} ${candidate.textContent}`));
    button?.click();
    return Boolean(button);
  });
  assert.equal(playClicked, true, "Motion Preview playback control exists");
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll<SVGImageElement>(".interactive-preview-player svg image")].some((image) => (image.getAttribute("href") ?? image.getAttributeNS("http://www.w3.org/1999/xlink", "href") ?? "").includes("visual-assets/"))), "raster asset appears in Remotion Motion Preview", 110);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await captureScreenshot(page, path.join(screenshotDir, "raster-river-motion-preview.png"));

  const snapshotResponse = await fetch(`${apiUrl}/api/projects/${projects[1]!.id}/generate`, { method: "POST" });
  assert.equal(snapshotResponse.status, 201, `approved raster project snapshot is created: ${await snapshotResponse.clone().text()}`);
  const snapshotJob = (await snapshotResponse.json()).job as { id: string };
  const snapshotPath = path.join(tempDir, "data", "jobs", snapshotJob.id, "snapshot.json");
  const immutableSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assert.deepEqual(immutableSnapshot.visualAssets.map((asset: { id: string }) => asset.id), [smokeAsset.id], "snapshot captures referenced raster only");
  assert.equal(immutableSnapshot.visualAssets[0].sha256, smokeAsset.sha256);
  const riverScene = immutableSnapshot.research.scenes[2];
  const oneSceneSnapshot = {
    ...immutableSnapshot,
    research: { ...immutableSnapshot.research, targetDurationSec: 2, scenes: [{ ...riverScene, startSec: 0, endSec: 2 }] },
  };
  const rasterMp4 = path.join(screenshotDir, "raster-river-remotion-smoke.mp4");
  const rasterManifest = await renderSnapshot(oneSceneSnapshot, rasterMp4, () => {}, 1 / 3);
  assert.equal(rasterManifest.videoCodec, "h264");
  assert.equal(rasterManifest.width, 360);
  assert.equal(rasterManifest.height, 640);
  await execFileAsync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", "1.5", "-i", rasterMp4, "-frames:v", "1", path.join(screenshotDir, "raster-river-remotion-frame.png")]);
  await writeFile(path.join(screenshotDir, "raster-river-remotion-manifest.json"), JSON.stringify(rasterManifest, null, 2));
  const resetResponse = await fetch(`${apiUrl}/api/projects/${projects[1]!.id}`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ researchPackage: originalSalt.researchPackage, visualStoryboard: originalSalt.visualStoryboard }),
  });
  assert.equal(resetResponse.status, 200, "smoke-only storyboard replacement succeeds after immutable snapshot creation");
  const snapshotGuard = await fetch(`${apiUrl}/api/projects/${projects[1]!.id}/visual-assets/${encodeURIComponent(smokeAsset.id)}`, { method: "DELETE" });
  assert.equal(snapshotGuard.status, 409, "asset stays protected after scene replacement while immutable snapshot references it");
  assert.equal((await snapshotGuard.json()).code, "visual-asset-snapshot-in-use");

  await page.goto({ url: viteUrl, timeout: 30_000 });
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".project-card-open").length >= 2), "return to project dashboard after raster snapshot smoke");
  await page.evaluate((title) => [...document.querySelectorAll<HTMLButtonElement>(".project-card-open")].find((button) => button.getAttribute("aria-label")?.includes(title))?.click(), projects[0]!.title);
  await waitFor(() => page.evaluate((title) => document.querySelector<HTMLInputElement>(".title-input")?.value === title, projects[0]!.title), "Earth project workspace");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="visual"]')?.click());
  await waitFor(() => page.evaluate((count) => document.querySelectorAll(".visual-approve-button").length === count, projects[0]!.scenes), "Earth scene approval controls");
  for (let index = 0; index < projects[0]!.scenes; index++) {
    const enabled = await page.evaluate((item) => !document.querySelectorAll<HTMLButtonElement>(".visual-approve-button")[item]?.disabled, index);
    assert.equal(enabled, true, `Earth scene ${index + 1} passes preview quality gate`);
    await page.evaluate((item) => document.querySelectorAll<HTMLButtonElement>(".visual-approve-button")[item]?.click(), index);
    if (index === 0) {
      await waitFor(() => page.evaluate(() => document.querySelector(".visual-scene-card .visual-approval-chip")?.textContent?.trim() === "Approved"), "first Earth scene approval");
      await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".visual-scene-card .visual-author-button")].find((button) => button.textContent?.includes("Generate / Perbaiki komposisi"))?.click());
      await waitFor(() => page.evaluate(() => document.querySelector('[role="alertdialog"]') !== null), "replacement confirmation for approved composition");
      await page.evaluate(() => document.querySelector<HTMLButtonElement>(".confirm-cancel")?.click());
      await waitFor(() => page.evaluate(() => document.querySelector('[role="alertdialog"]') === null), "cancel regeneration");
      assert.equal(await page.evaluate(() => document.querySelector(".visual-scene-card .visual-approval-chip")?.textContent?.trim()), "Approved", "cancel preserves approved composition");
      await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".visual-scene-card .visual-author-button")].find((button) => button.textContent?.includes("Generate / Perbaiki komposisi"))?.click());
      await waitFor(() => page.evaluate(() => document.querySelector('[role="alertdialog"]') !== null), "second replacement confirmation");
      await page.evaluate(() => document.querySelector<HTMLButtonElement>(".confirm-submit")?.click());
      await waitFor(() => page.evaluate(() => document.querySelector('[role="alertdialog"]') === null && document.querySelector(".visual-scene-card .visual-approval-chip")?.textContent?.trim() !== "Approved"), "confirmed replacement invalidates approval");
      await page.evaluate(() => document.querySelector<HTMLButtonElement>(".visual-scene-card .visual-approve-button")?.click());
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".topbar-save")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".toast")?.textContent?.includes("Storyboard tersimpan.") ?? false), "approved storyboard persistence");
  await new Promise((resolve) => setTimeout(resolve, 250));
  const savedEarth = await fetch(`${apiUrl}/api/projects/${projects[0]!.id}`).then((response) => response.json());
  assert.ok(savedEarth.visualStoryboard.scenes.every((scene: { approved: boolean }) => scene.approved), "all Earth scene approvals persist");
  const staleApproval = structuredClone(savedEarth.visualStoryboard);
  staleApproval.scenes[0].composition.background = "#ffffff";
  const staleSave = await fetch(`${apiUrl}/api/projects/${projects[0]!.id}`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ researchPackage: savedEarth.researchPackage, visualStoryboard: staleApproval }),
  });
  assert.equal(staleSave.status, 400, "API rejects an approved scene whose composition changed after approval");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="review"]')?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".workspace-step-heading h2")?.textContent?.trim() === "Review & Subtitle"), "fact review step");
  await waitFor(() => page.evaluate(() => document.querySelector(".review-author-card button") !== null), "fact review controls");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".review-author-card button")?.click());
  await waitFor(async () => (await fetch(`${apiUrl}/api/projects/${projects[0]!.id}`).then((response) => response.json())).researchReviewStatus === "verified-by-author", "author review confirmation");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="preview"]')?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".interactive-preview-player") !== null), "motion preview step");
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".interactive-preview-player button")].find((button) => /play/i.test(`${button.getAttribute("aria-label")} ${button.title} ${button.textContent}`))?.click());
  await new Promise((resolve) => setTimeout(resolve, 2200));
  await captureScreenshot(page, path.join(screenshotDir, "earth-motion-preview.png"));
  const preview = await page.evaluate(() => ({ step: document.querySelector(".workspace-step-heading h2")?.textContent?.trim(), title: document.querySelector(".interactive-preview-note h3")?.textContent?.trim() }));
  assert.deepEqual(preview, { step: "Preview Motion", title: "Preview interaktif" });

  await page.evaluate(() => document.querySelector<HTMLButtonElement>('button[aria-label="Kembali ke Project Saya"]')?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".dashboard-heading") !== null), "dashboard before rainbow-topic review");
  await openStoryboard(projects[2]!, "rainbow-water-droplet-storyboard.png");
  const rainbowProject = await fetch(`${apiUrl}/api/projects/${projects[2]!.id}`).then((response) => response.json());
  assert.equal(rainbowProject.researchPackage.title, "Bagaimana Pelangi Terbentuk?");
  assert.equal(rainbowProject.visualStoryboard.scenes.length, 5);
  assert.ok(rainbowProject.visualStoryboard.scenes.every((scene: { approved: boolean }) => !scene.approved), "rainbow scenes stay pending human approval");
  assert.ok(rainbowProject.visualStoryboard.scenes.every((scene: { composition: { layers: Array<{ id: string }> } }) => scene.composition.layers.some((layer) => layer.id === "rain") && scene.composition.layers.some((layer) => layer.id === "sunlight")), "water droplets and sunlight remain visible across rainbow storyboard");
  assert.ok(rainbowProject.visualStoryboard.scenes[2].composition.layers.some((layer: { id: string; nodes: Array<{ type: string }> }) => layer.id === "internal-reflection" && layer.nodes.some((node) => node.type === "path")), "single internal reflection is illustrated; no prism substitutes for raindrops");
  await page.evaluate(() => [...(document.querySelectorAll<HTMLElement>(".visual-scene-card")[2]?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((button) => button.textContent?.includes("Motion Preview"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLDialogElement>(".visual-preview-dialog")?.open ?? false), "rainbow droplet scene preview");
  await captureScreenshot(page, path.join(screenshotDir, "rainbow-water-droplet-scene-preview.png"));
  await page.evaluate(() => [...(document.querySelector<HTMLDialogElement>(".visual-preview-dialog")?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((button) => button.textContent?.includes("Tutup preview"))?.click());
  await waitFor(() => page.evaluate(() => !document.querySelector<HTMLDialogElement>(".visual-preview-dialog")?.open), "close rainbow droplet preview");
  const parsedRainbow = parseResearchPackage(JSON.parse(await readFile(path.join(root, "samples", "bagaimana-pelangi-terbentuk.json"), "utf8")));
  assert.equal(parsedRainbow.success, true, "source-backed rainbow Research Package validates before local rendering");
  if (!parsedRainbow.success) throw new Error("Rainbow Research Package validation failed.");
  const rainbowMp4 = path.join(screenshotDir, "rainbow-water-droplet-smoke.mp4");
  const rainbowManifest = await renderSnapshot({ research: parsedRainbow.data, rendererVersion: RENDERER_VERSION }, rainbowMp4, () => {}, 1 / 3);
  assert.equal(rainbowManifest.videoCodec, "h264");
  assert.equal(rainbowManifest.width, 360);
  assert.equal(rainbowManifest.height, 640);
  await execFileAsync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", "16", "-i", rainbowMp4, "-frames:v", "1", path.join(screenshotDir, "rainbow-water-droplet-remotion-frame.png")]);
  await writeFile(path.join(screenshotDir, "rainbow-water-droplet-manifest.json"), JSON.stringify(rainbowManifest, null, 2));

  const manualResearch = JSON.parse(await readFile(path.join(root, "samples", "kenapa-air-laut-asin.json"), "utf8"));
  const staleInput: AiGenerationInput = { topic: "Hasil sesi lama", language: "id-ID", targetDurationSec: 30, deliveryStyle: "edukatif", additionalInstructions: "instruksi lama", sourceUrls: [] };
  const staleDraft = parseManualAiResult(manualResearch, staleInput, randomUUID());
  assert.equal(staleDraft.success, true, "legacy-storage regression fixture must be valid");
  const settings = await fetch(`${apiUrl}/api/settings/ai-generation`).then((response) => response.json());
  const preferredModel = settings.providers.development.models[0]?.id ?? "";
  await page.evaluate(({ model, input, draft }) => {
    if (model) localStorage.setItem("ai-facts-studio:opencode-model:v1", model);
    localStorage.setItem("ai-facts-studio:ai-generation-input:v1", JSON.stringify(input));
    localStorage.setItem("ai-facts-studio:ai-generation-draft:v1", JSON.stringify(draft));
  }, { model: preferredModel, input: staleInput, draft: staleDraft.success ? staleDraft.draft : null });
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('button[aria-label="Kembali ke Project Saya"]')?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".dashboard-heading") !== null), "dashboard before AI project creation");
  await openCreateVideo();
  const freshForm = await page.evaluate(() => ({
    topic: document.querySelector<HTMLInputElement>(".ai-topic-field input")?.value,
    instructions: document.querySelector<HTMLTextAreaElement>(".ai-instructions-field textarea")?.value,
    sources: document.querySelector<HTMLTextAreaElement>(".ai-source-field textarea")?.value,
    reviewVisible: document.querySelector(".ai-draft-review") !== null,
    status: document.querySelector(".ai-generation-status-row")?.textContent?.trim(),
    mode: document.querySelector(".settings-mode-badge")?.textContent?.trim(),
    model: document.querySelector<HTMLSelectElement>(".ai-opencode-status select")?.value,
    legacyInputPresent: localStorage.getItem("ai-facts-studio:ai-generation-input:v1") !== null,
    legacyDraftPresent: localStorage.getItem("ai-facts-studio:ai-generation-draft:v1") !== null,
  }));
  assert.deepEqual(freshForm, { topic: "", instructions: "", sources: "", reviewVisible: false, status: "Draft Input", mode: "DEVELOPMENT", model: preferredModel, legacyInputPresent: false, legacyDraftPresent: false }, "legacy AI draft/input storage is ignored and cleared; model preference remains");

  const savedTitle = "Workflow smoke · Project persisten";
  await setField(".ai-topic-field input", savedTitle);
  await setField(".ai-instructions-field textarea", "Instruksi sesi pertama");
  await setField(".ai-source-field textarea", "https://example.com/source");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("[role=tab]")].find((button) => button.textContent?.includes("Import Research Package"))?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("[role=tab]")].find((button) => button.textContent?.includes("Generate with AI"))?.click());
  assert.deepEqual(await page.evaluate(() => ({
    topic: document.querySelector<HTMLInputElement>(".ai-topic-field input")?.value,
    instructions: document.querySelector<HTMLTextAreaElement>(".ai-instructions-field textarea")?.value,
    sources: document.querySelector<HTMLTextAreaElement>(".ai-source-field textarea")?.value,
  })), { topic: savedTitle, instructions: "Instruksi sesi pertama", sources: "https://example.com/source" }, "switching create tabs preserves current session fields");
  await page.evaluate(() => document.querySelector<HTMLDetailsElement>(".ai-advanced-flow")?.querySelector("summary")?.click());
  await clickButtonStartingWith("Buat Prompt Manual");
  await setField(".manual-prompt-result", JSON.stringify({ researchPackage: manualResearch }));
  await clickButtonStartingWith("Validate & Review");
  await waitFor(() => page.evaluate(() => document.querySelector(".ai-draft-review") !== null), "AI result review");
  await clickButtonStartingWith("Review Hasil");
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll("button")].some((button) => button.textContent?.includes("Simpan Video"))), "Save Video action after review");
  await clickButtonStartingWith("Simpan Video");
  await waitFor(() => page.evaluate((title) => document.querySelector<HTMLInputElement>(".title-input")?.value === title, savedTitle), "saved AI project opens in workspace");
  await waitFor(() => page.evaluate(() => document.querySelector(".workspace-step-heading h2")?.textContent?.trim() === "Visual Storyboard"), "Save Video opens Visual Storyboard");
  const savedAiProject = await fetch(`${apiUrl}/api/projects`).then((response) => response.json()).then((list) => list.find((item: { researchPackage: { title: string } }) => item.researchPackage.title === savedTitle));
  assert.ok(savedAiProject, "Save Video creates a persistent Video Library record");
  assert.equal(savedAiProject.researchPackage.scenes.length, manualResearch.scenes.length, "saved AI record contains all scenes");
  assert.equal(savedAiProject.visualStoryboard.scenes.length, manualResearch.scenes.length, "saved AI record contains its Visual Storyboard");
  assert.ok(savedAiProject.researchPackage.scenes.every((scene: { narrationText: string }) => scene.narrationText.length > 0), "saved AI record contains narration");
  await waitFor(() => page.evaluate((count) => document.querySelectorAll(".visual-scene-card").length === count, manualResearch.scenes.length), "saved AI Visual Storyboard opens for editing");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('button[aria-label="Kembali ke Project Saya"]')?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".dashboard-heading") !== null), "dashboard after saved AI record");
  await page.evaluate((title) => [...document.querySelectorAll<HTMLButtonElement>(".project-card-open")].find((button) => button.getAttribute("aria-label")?.includes(title))?.click(), savedTitle);
  await waitFor(() => page.evaluate((title) => document.querySelector<HTMLInputElement>(".title-input")?.value === title, savedTitle), "reopen saved AI record from Video Library");
  await waitFor(() => page.evaluate(() => document.querySelector(".workspace-step-heading h2")?.textContent?.trim() === "Visual Storyboard"), "reopened AI record restores its workspace step");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="visual"]')?.click());
  await waitFor(() => page.evaluate((count) => document.querySelectorAll(".visual-scene-card").length === count, manualResearch.scenes.length), "reopened record restores Visual Storyboard");

  await page.evaluate(() => document.querySelector<HTMLButtonElement>('button[aria-label="Kembali ke Project Saya"]')?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".dashboard-heading") !== null), "dashboard before fresh Create Video");
  await openCreateVideo();
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLInputElement>(".ai-topic-field input") !== null), "Create Video re-entry after saved project");
  const cleanAfterSave = await page.evaluate(() => ({
    topic: document.querySelector<HTMLInputElement>(".ai-topic-field input")?.value,
    instructions: document.querySelector<HTMLTextAreaElement>(".ai-instructions-field textarea")?.value,
    sources: document.querySelector<HTMLTextAreaElement>(".ai-source-field textarea")?.value,
    reviewVisible: document.querySelector(".ai-draft-review") !== null,
    status: document.querySelector(".ai-generation-status-row")?.textContent?.trim(),
    mode: document.querySelector(".settings-mode-badge")?.textContent?.trim(),
    model: document.querySelector<HTMLSelectElement>(".ai-opencode-status select")?.value,
  }));
  assert.deepEqual(cleanAfterSave, { topic: "", instructions: "", sources: "", reviewVisible: false, status: "Draft Input", mode: "DEVELOPMENT", model: preferredModel }, "saved projects never restore into fresh AI form; AI mode and OpenCode model preference remain");

  const abandonedTitle = "Workflow smoke · Hasil belum disimpan";
  await generateManualReview(abandonedTitle, manualResearch);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('button[aria-label="Beranda"]')?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".confirm-dialog") !== null), "custom confirmation for unsaved AI output");
  assert.match(await page.evaluate(() => document.querySelector("#confirm-message")?.textContent ?? ""), /hasil generate.*akan hilang/i);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".confirm-cancel")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".ai-draft-review") !== null), "cancel keeps generated review in same session");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLInputElement>(".ai-topic-field input")?.value), abandonedTitle);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('button[aria-label="Beranda"]')?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".confirm-dialog") !== null), "second unsaved-output confirmation");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".confirm-submit")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".dashboard-heading") !== null), "discard unsaved AI output and leave");
  await openCreateVideo();
  assert.deepEqual(await page.evaluate(() => ({
    topic: document.querySelector<HTMLInputElement>(".ai-topic-field input")?.value,
    instructions: document.querySelector<HTMLTextAreaElement>(".ai-instructions-field textarea")?.value,
    sources: document.querySelector<HTMLTextAreaElement>(".ai-source-field textarea")?.value,
    reviewVisible: document.querySelector(".ai-draft-review") !== null,
    status: document.querySelector(".ai-generation-status-row")?.textContent?.trim(),
  })), { topic: "", instructions: "", sources: "", reviewVisible: false, status: "Draft Input" }, "discarding a session leaves the next Create Video form clean");

  await page.evaluate(() => document.querySelector<HTMLDetailsElement>(".ai-advanced-flow")?.querySelector("summary")?.click());
  await clickButtonStartingWith("Buat Prompt Manual");
  assert.match(await page.evaluate(() => document.querySelector(".workflow-alert.danger")?.textContent ?? ""), /Perbaiki input/i, "form validation feedback is visible before reset");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('button[aria-label="Beranda"]')?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".dashboard-heading") !== null), "leave invalid empty form");
  await openCreateVideo();
  assert.deepEqual(await page.evaluate(() => ({
    topic: document.querySelector<HTMLInputElement>(".ai-topic-field input")?.value,
    error: document.querySelector(".workflow-alert.danger")?.textContent ?? "",
    reviewVisible: document.querySelector(".ai-draft-review") !== null,
    status: document.querySelector(".ai-generation-status-row")?.textContent?.trim(),
    mode: document.querySelector(".settings-mode-badge")?.textContent?.trim(),
  })), { topic: "", error: "", reviewVisible: false, status: "Draft Input", mode: "DEVELOPMENT" }, "reopening Create Video resets validation and error state without resetting AI mode");

  console.log(`PASS: SQLite/Tabler/reusable Asset Library, Openverse search UI, 390px dialog fit, rainbow droplet sample, raster upload/reuse, scene approval, immutable snapshot, Motion Preview and Remotion MP4; legacy workflows. Raster fixture synthetic, not AI. Screenshots: ${screenshotDir}`);
} finally {
  for (const projectId of [...cleanupProjectIds].reverse()) {
    try { await fetch(`${apiUrl}/api/projects/${projectId}`, { method: "DELETE" }); } catch { /* server may not have started */ }
  }
  if (browser) await browser.close({ silent: true });
  await stop(viteServer);
  await stop(apiServer);
  await rm(tempDir, { recursive: true, force: true });
}
