import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { openBrowser } from "@remotion/renderer";
import { parseManualAiResult, type AiGenerationInput } from "../src/domain/ai-generation";

const root = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-facts-visual-storyboard-"));
const screenshotDir = path.resolve(root, process.env.VISUAL_STORYBOARD_SMOKE_OUTPUT_DIR ?? "artifacts/visual-storyboard-final");
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

async function waitFor(check: () => Promise<boolean>, description: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
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
  env: { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(apiPort), VITE_PORT: String(vitePort), DATA_DIR: path.join(tempDir, "data"), DAILY_JOB_LIMIT: "1", TTS_MOCK_PROVIDER: "0", GEMINI_API_KEY: "", OPENCODE_SERVER_URL: "http://127.0.0.1:4096" },
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

  const sampleFiles = ["bagaimana-bumi-melindungi-kita.json", "kenapa-air-laut-asin.json"];
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
  }

  browser = await openBrowser("chrome", { logLevel: "error" });
  const page = await browser.newPage({ context: () => null, logLevel: "error", indent: 0, pageIndex: 0, onBrowserLog: () => {}, onLog: () => {} } as never);
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto({ url: viteUrl, timeout: 30_000 });
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".project-link").length >= 2), "project list in original UI");
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".stat-card")].find((item) => item.querySelector("small")?.textContent?.trim() === "RENDER QUOTA")?.querySelector("strong")?.textContent?.trim() === "Render Lokal — Unlimited"), "Development quota status");
  assert.deepEqual(await page.evaluate(() => {
    const card = [...document.querySelectorAll<HTMLElement>(".stat-card")].find((item) => item.querySelector("small")?.textContent?.trim() === "RENDER QUOTA");
    return { value: card?.querySelector("strong")?.textContent?.trim(), note: card?.querySelector("p")?.textContent?.trim() };
  }), { value: "Render Lokal — Unlimited", note: "Job lokal tetap dicatat; kuota harian tidak diterapkan." }, "Dashboard shows unlimited Development quota without countdown");
  const setSmokeAiMode = (mode: "development" | "production") => {
    const settingsDb = new DatabaseSync(path.join(tempDir, "data", "ai-facts-studio.sqlite"));
    settingsDb.prepare("INSERT INTO ai_generation_settings (id, mode, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at").run(mode, new Date().toISOString());
    settingsDb.close();
  };
  setSmokeAiMode("production");
  assert.equal((await fetch(`${apiUrl}/api/status`).then((response) => response.json())).generationMode, "production");
  await page.goto({ url: `${viteUrl}/?render-quota-mode=production`, timeout: 30_000 });
  await waitFor(() => page.evaluate(() => document.querySelector(".dashboard-heading") !== null), "dashboard reload in Production mode");
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".stat-card")].find((item) => item.querySelector("small")?.textContent?.trim() === "RENDER QUOTA")?.querySelector("strong")?.textContent?.trim() === "0/1 job per 24 jam"), "Production quota status");
  assert.deepEqual(await page.evaluate(() => {
    const card = [...document.querySelectorAll<HTMLElement>(".stat-card")].find((item) => item.querySelector("small")?.textContent?.trim() === "RENDER QUOTA");
    return { value: card?.querySelector("strong")?.textContent?.trim(), note: card?.querySelector("p")?.textContent?.trim() };
  }), { value: "0/1 job per 24 jam", note: "Kuota 24 jam bergulir; job Development tetap dihitung." }, "Dashboard shows Production jobs used/limit");
  setSmokeAiMode("development");
  assert.equal((await fetch(`${apiUrl}/api/status`).then((response) => response.json())).generationMode, "development");
  await page.goto({ url: `${viteUrl}/?render-quota-mode=development`, timeout: 30_000 });
  await waitFor(() => page.evaluate(() => document.querySelector(".dashboard-heading") !== null), "dashboard reload in Development mode");
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".stat-card")].find((item) => item.querySelector("small")?.textContent?.trim() === "RENDER QUOTA")?.querySelector("strong")?.textContent?.trim() === "Render Lokal — Unlimited"), "Development quota status restored");

  async function openStoryboard(project: { title: string; scenes: number }, screenshot: string) {
    await page.evaluate((title) => [...document.querySelectorAll<HTMLButtonElement>(".project-link")].find((button) => button.textContent?.includes(title))?.click(), project.title);
    await waitFor(() => page.evaluate((title) => document.querySelector<HTMLInputElement>(".title-input")?.value === title, project.title), `workspace for ${project.title}`);
    const stepHeights = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".workflow-step")].map((step) => Math.round(step.getBoundingClientRect().height)));
    assert.equal(new Set(stepHeights).size, 1, `workflow step cards should have equal height: ${stepHeights.join(", ")}`);
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="visual"]')?.click());
    await waitFor(() => page.evaluate((count) => document.querySelectorAll(".visual-scene-card").length === count, project.scenes), `Visual Storyboard for ${project.title}`);
    const status = await page.evaluate(() => document.querySelector(".visual-review-state strong")?.textContent?.trim());
    assert.equal(status, "Ready for Review");
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

  async function clickButtonStartingWith(label: string) {
    const clicked = await page.evaluate((value) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.trim().startsWith(value));
      button?.click();
      return Boolean(button);
    }, label);
    assert.equal(clicked, true, `button should exist: ${label}`);
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
    await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".nav-item")].find((button) => button.textContent?.includes("Create video"))?.click());
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

  await openStoryboard(projects[0]!, "earth-visual-storyboard.png");
  await openStoryboard(projects[1]!, "sea-salt-visual-storyboard.png");

  await page.evaluate((title) => [...document.querySelectorAll<HTMLButtonElement>(".project-link")].find((button) => button.textContent?.includes(title))?.click(), projects[0]!.title);
  await waitFor(() => page.evaluate((title) => document.querySelector<HTMLInputElement>(".title-input")?.value === title, projects[0]!.title), "Earth project workspace");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="visual"]')?.click());
  await waitFor(() => page.evaluate((count) => document.querySelectorAll(".visual-approve-button").length === count, projects[0]!.scenes), "Earth scene approval controls");
  for (let index = 0; index < projects[0]!.scenes; index++) {
    const enabled = await page.evaluate((item) => !document.querySelectorAll<HTMLButtonElement>(".visual-approve-button")[item]?.disabled, index);
    assert.equal(enabled, true, `Earth scene ${index + 1} passes preview quality gate`);
    await page.evaluate((item) => document.querySelectorAll<HTMLButtonElement>(".visual-approve-button")[item]?.click(), index);
    if (index === 0) {
      await waitFor(() => page.evaluate(() => document.querySelector(".visual-scene-card .visual-approval-chip")?.textContent?.trim() === "APPROVED"), "first Earth scene approval");
      await page.evaluate(() => document.querySelector<HTMLButtonElement>(".visual-scene-card .visual-author-button")?.click());
      await waitFor(() => page.evaluate(() => document.querySelector('[role="alertdialog"]') !== null), "replacement confirmation for approved composition");
      await page.evaluate(() => document.querySelector<HTMLButtonElement>(".confirm-cancel")?.click());
      await waitFor(() => page.evaluate(() => document.querySelector('[role="alertdialog"]') === null), "cancel regeneration");
      assert.equal(await page.evaluate(() => document.querySelector(".visual-scene-card .visual-approval-chip")?.textContent?.trim()), "APPROVED", "cancel preserves approved composition");
      await page.evaluate(() => document.querySelector<HTMLButtonElement>(".visual-scene-card .visual-author-button")?.click());
      await waitFor(() => page.evaluate(() => document.querySelector('[role="alertdialog"]') !== null), "second replacement confirmation");
      await page.evaluate(() => document.querySelector<HTMLButtonElement>(".confirm-submit")?.click());
      await waitFor(() => page.evaluate(() => document.querySelector('[role="alertdialog"]') === null && document.querySelector(".visual-scene-card .visual-approval-chip")?.textContent?.trim() !== "APPROVED"), "confirmed replacement invalidates approval");
      await page.evaluate(() => document.querySelector<HTMLButtonElement>(".visual-scene-card .visual-approve-button")?.click());
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".save-button")?.click());
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
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".nav-item")].find((button) => button.textContent?.includes("Dashboard"))?.click());
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
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".nav-item")].find((button) => button.textContent?.includes("Dashboard"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".dashboard-heading") !== null), "dashboard after saved AI record");
  await page.evaluate((title) => [...document.querySelectorAll<HTMLButtonElement>(".project-link")].find((button) => button.textContent?.includes(title))?.click(), savedTitle);
  await waitFor(() => page.evaluate((title) => document.querySelector<HTMLInputElement>(".title-input")?.value === title, savedTitle), "reopen saved AI record from Video Library");
  await waitFor(() => page.evaluate(() => document.querySelector(".workspace-step-heading h2")?.textContent?.trim() === "Visual Storyboard"), "reopened AI record restores its workspace step");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="visual"]')?.click());
  await waitFor(() => page.evaluate((count) => document.querySelectorAll(".visual-scene-card").length === count, manualResearch.scenes.length), "reopened record restores Visual Storyboard");

  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".nav-item")].find((button) => button.textContent?.includes("Create video"))?.click());
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
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".nav-item")].find((button) => button.textContent?.includes("Dashboard"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".confirm-dialog") !== null), "custom confirmation for unsaved AI output");
  assert.match(await page.evaluate(() => document.querySelector("#confirm-message")?.textContent ?? ""), /hasil generate.*akan hilang/i);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".confirm-cancel")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".ai-draft-review") !== null), "cancel keeps generated review in same session");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLInputElement>(".ai-topic-field input")?.value), abandonedTitle);
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".nav-item")].find((button) => button.textContent?.includes("Dashboard"))?.click());
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
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".nav-item")].find((button) => button.textContent?.includes("Dashboard"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".dashboard-heading") !== null), "leave invalid empty form");
  await openCreateVideo();
  assert.deepEqual(await page.evaluate(() => ({
    topic: document.querySelector<HTMLInputElement>(".ai-topic-field input")?.value,
    error: document.querySelector(".workflow-alert.danger")?.textContent ?? "",
    reviewVisible: document.querySelector(".ai-draft-review") !== null,
    status: document.querySelector(".ai-generation-status-row")?.textContent?.trim(),
    mode: document.querySelector(".settings-mode-badge")?.textContent?.trim(),
  })), { topic: "", error: "", reviewVisible: false, status: "Draft Input", mode: "DEVELOPMENT" }, "reopening Create Video resets validation and error state without resetting AI mode");

  console.log(`PASS: Visual Storyboard/motion preview; AI Create Video resets; idempotent persistent save/reopen; unsaved-result confirmation. Screenshots: ${screenshotDir}`);
} finally {
  if (browser) await browser.close({ silent: true });
  await stop(viteServer);
  await stop(apiServer);
  await rm(tempDir, { recursive: true, force: true });
}
