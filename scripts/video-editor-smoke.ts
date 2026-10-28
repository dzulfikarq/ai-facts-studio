import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openBrowser } from "@remotion/renderer";
import { visualStoryboardQualityGate } from "../src/domain/visual-storyboard";

const root = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-facts-video-editor-"));
const evidenceDir = path.resolve(root, process.env.VIDEO_EDITOR_SMOKE_OUTPUT_DIR ?? "artifacts/video-editor-v2");
const projectIds: string[] = [];
let exportAssetPath: string | undefined;
await mkdir(evidenceDir, { recursive: true });

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

async function waitFor(check: () => Promise<boolean>, description: string, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out: ${description}`);
}

async function runLocal(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

const apiPort = await freePort();
const vitePort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const viteUrl = `http://127.0.0.1:${vitePort}`;
const apiLogs: string[] = [];
const apiServer = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
  cwd: root,
  env: { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(apiPort), VITE_PORT: String(vitePort), DATA_DIR: path.join(tempDir, "data"), DAILY_JOB_LIMIT: "1", TTS_MOCK_PROVIDER: "0", GEMINI_API_KEY: "", HF_TOKEN: "", HF_IMAGE_GENERATION_ENABLED: "false", HF_IMAGE_ALLOW_PAID: "false", OPENCODE_SERVER_URL: "http://127.0.0.1:4096" },
  stdio: ["ignore", "pipe", "pipe"],
});
for (const stream of [apiServer.stdout, apiServer.stderr]) stream?.on("data", (chunk: Buffer) => {
  apiLogs.push(...chunk.toString().split(/\r?\n/).filter(Boolean));
  if (apiLogs.length > 40) apiLogs.splice(0, apiLogs.length - 40);
});
let viteServer: ChildProcess | undefined;
let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;

try {
  await waitFor(async () => { try { return (await fetch(`${apiUrl}/api/status`)).ok; } catch { return false; } }, "API startup");
  viteServer = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], {
    cwd: root,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(apiPort), VITE_PORT: String(vitePort) },
    stdio: "ignore",
  });
  await waitFor(async () => { try { return (await fetch(`${viteUrl}/api/status`)).ok; } catch { return false; } }, "Vite startup");

  const mountain = JSON.parse(await readFile(path.join(root, "samples/mountain-formation.json"), "utf8"));
  const createProject = async (researchPackage: unknown) => {
    const response = await fetch(`${apiUrl}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage }) });
    assert.equal(response.status, 201, `project creation: ${await response.clone().text()}`);
    const project = await response.json();
    projectIds.push(project.id);
    const manualTiming = await fetch(`${apiUrl}/api/projects/${project.id}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: project.researchPackage, visualStoryboard: project.visualStoryboard, narrationMode: "manual" }),
    });
    assert.equal(manualTiming.status, 200, "browser fixture explicitly chooses manual narration timing");
    return manualTiming.json();
  };
  const mountainProject = await createProject(mountain);
  assert.equal(mountainProject.visualStoryboard.scenes.length, 7, "mountain sample retains all seven scenes");
  const oneScene = structuredClone(mountain);
  oneScene.id = `video-editor-smoke-${randomUUID()}`;
  oneScene.title = "Editor smoke · render end-to-end";
  oneScene.targetDurationSec = 7;
  oneScene.scenes = [{ ...oneScene.scenes[0], order: 1, startSec: 0, endSec: 7 }];
  oneScene.narration = oneScene.scenes[0].narrationText;
  const exportProject = await createProject(oneScene);
  const fixtureSeed = Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 6), 16);
  const fixtureColor = (offset: number) => `0x${((fixtureSeed + offset * 7919) & 0xffffff).toString(16).padStart(6, "0")}`;
  const flowFixtures = [1, 2, 3].map((index) => ({ name: `scene-0${index}-gunung-terbentuk.png`, color: fixtureColor(index) }));
  const flowFixtureBytes = await Promise.all(flowFixtures.map(async (fixture) => {
    const output = path.join(tempDir, fixture.name);
    await runLocal("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${fixture.color}:s=720x1280:d=1`, "-frames:v", "1", "-y", output]);
    return readFile(output);
  }));
  const retryFixturePath = path.join(tempDir, "flow-scene-04-retry.png");
  await runLocal("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${fixtureColor(4)}:s=720x1280:d=1`, "-frames:v", "1", "-y", retryFixturePath]);
  const retryFixtureBytes = await readFile(retryFixturePath);

  browser = await openBrowser("chrome", { logLevel: "error" });
  const page = await browser.newPage({ context: () => null, logLevel: "error", indent: 0, pageIndex: 0, onBrowserLog: () => {}, onLog: () => {} } as never);
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto({ url: viteUrl, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".project-card-open").length >= 2), "project dashboard");

  const clickProject = async (title: string) => {
    const found = await page.evaluate((projectTitle) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>(".project-card-open")].find((item) => item.getAttribute("aria-label")?.includes(projectTitle));
      button?.click();
      return Boolean(button);
    }, title);
    assert.equal(found, true, `project card exists: ${title}`);
    await waitFor(() => page.evaluate((projectTitle) => document.querySelector<HTMLInputElement>('.workspace-heading .title-input, .video-editor-title input')?.value === projectTitle, title), `open ${title}`);
    if (!await page.evaluate(() => Boolean(document.querySelector(".video-editor-v2")))) {
      await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="visual"]')?.click());
    }
    await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".video-editor-v2"))), `editor for ${title}`);
  };
  const clickEditorProject = async (title: string) => {
    await clickProject(title);
    if (!await page.evaluate(() => location.pathname.endsWith("/editor"))) {
      await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Lanjut ke Edit Video"))?.click());
    }
    await waitFor(() => page.evaluate(() => location.pathname.endsWith("/editor") && document.querySelectorAll(".editor-inspector-tabs button").length > 1), `approved project opens Edit Video: ${title}`);
  };
  const clickButton = async (selector: string, description: string) => {
    const found = await page.evaluate((query) => {
      const button = document.querySelector<HTMLButtonElement>(query);
      button?.click();
      return Boolean(button);
    }, selector);
    assert.equal(found, true, `${description} control exists`);
  };
  const setIllustrationWorkflow = async (workflow: string) => page.evaluate((value) => {
    const select = document.querySelector<HTMLSelectElement>(".editor-illustration-section select");
    if (!select) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, workflow);
  const setFlowVisualMode = async (mode: string) => page.evaluate((value) => {
    const select = [...document.querySelectorAll<HTMLLabelElement>(".google-flow-panel label.editor-field")].find((label) => label.textContent?.includes("Jenis Visual"))?.querySelector("select");
    if (!select) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, mode);
  const setMotionCue = async (cue: string, enabled: boolean) => page.evaluate(({ cueId, shouldEnable }) => {
    const checkbox = document.querySelector<HTMLInputElement>(`.editor-motion-effect[data-cue="${cueId}"] input[type="checkbox"]`);
    if (!checkbox) return false;
    if (checkbox.checked !== shouldEnable) checkbox.click();
    return checkbox.checked === shouldEnable;
  }, { cueId: cue, shouldEnable: enabled });
  const setMotionControl = async (selector: string, value: string) => page.evaluate(({ query, nextValue }) => {
    const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(query);
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, { query: selector, nextValue: value });
  const captureViewport = async (filename: string) => {
    const client = (page as unknown as { _client: () => { send: (method: string, params?: Record<string, unknown>) => Promise<{ value: any }> } })._client();
    const viewport = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, width: window.innerWidth, height: window.innerHeight }));
    const image = (await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false, clip: { ...viewport, scale: 1 } })).value;
    await writeFile(path.join(evidenceDir, filename), Buffer.from(image.data, "base64"));
  };
  const assertResponsiveNoOverflow = async (view: string) => {
    for (const width of [1440, 1280, 1024, 768, 390, 360, 320]) {
      await page.setViewport({ width, height: width <= 390 ? 844 : 900, deviceScaleFactor: 1 });
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const metrics = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        offenders: [...document.querySelectorAll<HTMLElement>("body *")].filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.right > innerWidth + 1;
        }).slice(0, 8).map((element) => ({ tag: element.tagName, className: typeof element.className === "string" ? element.className : "", right: Math.round(element.getBoundingClientRect().right), width: Math.round(element.getBoundingClientRect().width) })),
      }));
      if (view === "Settings" && width === 360) await captureViewport("settings-360px.png");
      assert.ok(metrics.scrollWidth <= metrics.width, `${view} overflows at ${width}px: ${JSON.stringify(metrics)}`);
    }
  };

  await captureViewport("dashboard-light-desktop.png");
  await assertResponsiveNoOverflow("dashboard");
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('.topbar-create[aria-label="Buat video"]')?.click());
  await waitFor(() => page.evaluate(() => location.pathname === "/create" && document.querySelector(".ai-generate-panel") !== null), "Create Video route");
  await captureViewport("create-light-desktop.png");
  await assertResponsiveNoOverflow("Create Video");
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('.topbar-icon[aria-label="Pengaturan"]')?.click());
  await waitFor(() => page.evaluate(() => location.pathname === "/settings" && document.querySelector(".ai-generation-settings") !== null), "Settings route");
  await captureViewport("settings-light-desktop.png");
  await assertResponsiveNoOverflow("Settings");
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".nav-home")?.click());
  await waitFor(() => page.evaluate(() => location.pathname === "/" && document.querySelectorAll(".project-card-open").length >= 2), "return to dashboard");

  await clickProject(mountainProject.researchPackage.title);
  const editorRoute = await page.evaluate(() => ({ path: location.pathname, scene: new URLSearchParams(location.search).get("scene") }));
  assert.equal(editorRoute.path, `/projects/${mountainProject.id}`, "Visual Storyboard has its own project route");
  assert.equal(await page.evaluate(() => new URLSearchParams(location.search).get("step")), "visual", "Visual Storyboard step is URL-backed");
  assert.equal(editorRoute.scene, mountainProject.visualStoryboard.scenes[0].sceneId, "selected scene is URL-backed");
  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>(".editor-scene-item")[1]?.click());
  await waitFor(() => page.evaluate((sceneId) => new URLSearchParams(location.search).get("scene") === sceneId, mountainProject.visualStoryboard.scenes[1].sceneId), "scene selection updates URL");
  const restoredEditorUrl = await page.evaluate(() => location.href);
  await page.evaluate(() => history.back());
  await waitFor(() => page.evaluate((id) => location.pathname.endsWith(`/projects/${id}`) && document.querySelector(".workflow-stepper") !== null, mountainProject.id), "Back restores prior workspace step");
  await page.evaluate(() => history.forward());
  await waitFor(() => page.evaluate((id) => location.pathname === `/projects/${id}` && new URLSearchParams(location.search).get("step") === "visual" && document.querySelector(".video-editor-v2") !== null, mountainProject.id), "Forward restores Visual Storyboard route");
  assert.equal(await page.evaluate(() => new URLSearchParams(location.search).get("scene")), mountainProject.visualStoryboard.scenes[1].sceneId, "Forward restores selected scene too");
  await page.evaluate((title) => {
    const input = document.querySelector<HTMLInputElement>(".video-editor-title input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, `${title} · draft`);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, mountainProject.researchPackage.title);
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() !== "Tersimpan"), "draft edit marks workspace unsaved");
  await page.evaluate(() => history.back());
  await waitFor(() => page.evaluate(() => new URLSearchParams(location.search).get("step") !== "visual"), "Back first returns to prior workspace step");
  await page.evaluate(() => history.back());
  await waitFor(() => page.evaluate(() => document.querySelector('[role="dialog"] .confirm-cancel') !== null), "Back asks before leaving unsaved workspace");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[role="dialog"] .confirm-cancel')?.click());
  await waitFor(() => page.evaluate((id) => location.pathname === `/projects/${id}` && new URLSearchParams(location.search).get("step") !== "visual" && document.querySelector('[role="dialog"]') === null, mountainProject.id), "cancelled Back restores prior workspace route");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="visual"]')?.click());
  await waitFor(() => page.evaluate(() => new URLSearchParams(location.search).get("step") === "visual" && document.querySelector(".video-editor-v2") !== null), "return to Visual Storyboard after cancelling Back");
  await page.evaluate((title) => {
    const input = document.querySelector<HTMLInputElement>(".video-editor-title input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, title);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, mountainProject.researchPackage.title);
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Tersimpan"), "restore original title and save baseline project");
  await page.goto({ url: restoredEditorUrl, timeout: 90_000 });
  await waitFor(() => page.evaluate((sceneId) => new URLSearchParams(location.search).get("scene") === sceneId && document.querySelector(".video-editor-v2") !== null, mountainProject.visualStoryboard.scenes[1].sceneId), "direct Visual Storyboard URL restores scene after reload");
  assert.equal(await page.evaluate(() => new URLSearchParams(location.search).get("scene")), mountainProject.visualStoryboard.scenes[1].sceneId);
  await page.goto({ url: `${viteUrl}/projects/${mountainProject.id}?step=render&scene=${mountainProject.visualStoryboard.scenes[1].sceneId}`, timeout: 90_000 });
  await waitFor(() => page.evaluate((id) => location.pathname === `/projects/${id}/editor` && document.querySelector(".video-editor-v2") !== null, mountainProject.id), "direct blocked Review step resolves through Edit Video guard");
  assert.equal(await page.evaluate(() => new URLSearchParams(location.search).get("scene")), mountainProject.visualStoryboard.scenes[1].sceneId, "workflow fallback retains selected scene");
  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>(".editor-scene-item")[0]?.click());
  await waitFor(() => page.evaluate((sceneId) => new URLSearchParams(location.search).get("scene") === sceneId, mountainProject.visualStoryboard.scenes[0].sceneId), "restore scene one for editor checks");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="materials"]')?.click());
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".workflow-stepper") && document.querySelector(".scene-editor"))), "Materials storyboard opens separately");
  await page.evaluate(() => document.querySelector<HTMLDetailsElement>(".advanced-editor summary")?.click());
  const materialsMotionControls = await page.evaluate(() => ({
    motionTab: [...document.querySelectorAll(".workflow-stepper button")].some((button) => button.textContent?.trim() === "Gerak"),
    duplicateCueEditor: Boolean(document.querySelector(".motion-cue-grid")),
    motionJsonEditor: [...document.querySelectorAll(".visual-json-editor summary")].some((summary) => summary.textContent?.includes("Motion plan")),
  }));
  assert.deepEqual(materialsMotionControls, { motionTab: false, duplicateCueEditor: false, motionJsonEditor: false }, "Materials step keeps motion controls in Edit Video");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="visual"]')?.click());
  await waitFor(() => page.evaluate(() => new URLSearchParams(location.search).get("step") === "visual" && document.querySelector(".video-editor-v2") !== null), "Visual Storyboard route opens");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.getAttribute("aria-expanded") === "true"), "inspector opens for baseline visual checks");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.getAttribute("aria-expanded") === "false"), "collapse inspector for baseline visual checks");
  const initialEditor = await page.evaluate(() => ({
    scenes: document.querySelectorAll(".editor-scene-item").length,
    canvas: Boolean(document.querySelector(".editor-canvas-shell svg")),
    viewportWidth: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    status: document.querySelector(".editor-save-state")?.textContent?.trim(),
    headline: document.querySelector(".editor-canvas-shell svg text")?.textContent?.trim(),
    workflow: document.querySelector<HTMLSelectElement>(".editor-illustration-section select")?.value,
    flowVisualMode: [...document.querySelectorAll<HTMLLabelElement>(".google-flow-panel label.editor-field")].find((label) => label.textContent?.includes("Jenis Visual"))?.querySelector("select")?.value,
    illustrationStatus: document.querySelector(".editor-illustration-heading span")?.textContent?.trim(),
    hfVisible: Boolean(document.querySelector(".editor-ai-image-panel")),
    inspectorExpanded: document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.getAttribute("aria-expanded"),
  }));
  assert.equal(initialEditor.scenes, 7);
  assert.equal(initialEditor.canvas, true, "canvas uses actual Remotion composition SVG");
  assert.ok(initialEditor.scrollWidth <= initialEditor.viewportWidth, `desktop editor does not overflow: ${JSON.stringify(initialEditor)}`);
  assert.ok(initialEditor.headline, "canvas displays real scene text");
  assert.equal(initialEditor.workflow, "google-flow", "Google Flow is default source for scene one");
  assert.equal(initialEditor.flowVisualMode, "animated-video", "new scenes default to animated Google Flow prompts");
  assert.equal(initialEditor.illustrationStatus, "Perlu Ilustrasi", "procedural draft is explicitly not treated as main illustration");
  assert.equal(initialEditor.hfVisible, false, "Hugging Face controls stay hidden until AI Image API is selected");
  assert.equal(initialEditor.inspectorExpanded, "false", "inspector starts collapsed");
  await captureViewport("mountain-editor-visual-inspector-flow-default.png");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.getAttribute("aria-expanded") === "true"), "inspector opens without changing scene");
  await captureViewport("mountain-editor-inspector-open.png");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.getAttribute("aria-expanded") === "false"), "inspector closes without changing scene");
  await captureViewport("mountain-editor-inspector-closed.png");
  await page.evaluate(() => {
    const switcher = document.querySelector<HTMLDetailsElement>(".theme-switcher")!;
    switcher.open = true;
    [...switcher.querySelectorAll<HTMLButtonElement>(".theme-choices button")].find((button) => button.textContent?.trim() === "Dark")?.click();
  });
  await waitFor(() => page.evaluate(() => document.documentElement.dataset.theme === "dark"), "editor supports Dark Purple theme");
  await captureViewport("mountain-editor-visual-inspector-flow-dark.png");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".theme-choices button")].find((button) => button.textContent?.trim() === "System")?.click());
  await waitFor(() => page.evaluate(() => document.documentElement.dataset.themePreference === "system"), "theme preference remains separate and System restores");
  await captureViewport("mountain-editor-scene-01-before.png");

  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>(".editor-scene-item")[1]?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-inspector-scene")?.textContent?.includes("SCENE 02") ?? false), "scene list selection syncs inspector");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLSelectElement>(".editor-illustration-section select")?.value), "google-flow", "Google Flow remains selected after scene switch");
  await captureViewport("mountain-editor-scene-02-before.png");
  const scrubExists = await page.evaluate(() => Boolean(document.querySelector<HTMLInputElement>("#editor-playhead")));
  assert.equal(scrubExists, true, "native Remotion timeline scrubber exists");
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("#editor-playhead")!;
    input.value = String(8 * 30);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-inspector-scene")?.textContent?.includes("SCENE 02") ?? false), "timeline seeks to scene two");
  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>(".editor-scene-item")[0]?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-inspector-scene")?.textContent?.includes("SCENE 01") ?? false), "return to mountain scene one");

  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>(".editor-scene-item")[6]?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-inspector-scene")?.textContent?.includes("SCENE 07") ?? false), "select scene seven for per-scene source persistence test");
  await setIllustrationWorkflow("ai-image-api");
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-ai-config-message")?.textContent?.includes("HF_TOKEN") ?? false), "unconfigured AI Image API shows setup guidance only when selected");
  const hfEmptyState = await page.evaluate(() => ({ modelDropdowns: document.querySelectorAll(".editor-ai-image-panel select").length, generateButton: [...document.querySelectorAll<HTMLButtonElement>(".editor-ai-image-panel button")].some((button) => button.textContent?.includes("Generate satu gambar")), flowStillAccessible: document.querySelector<HTMLSelectElement>(".editor-illustration-section select")?.value === "ai-image-api" }));
  assert.deepEqual(hfEmptyState, { modelDropdowns: 0, generateButton: false, flowStillAccessible: true }, "unconfigured Hugging Face exposes neither empty model dropdown nor inactive generate button");
  await setIllustrationWorkflow("upload-image");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Tersimpan"), "per-scene illustration source preference saves");
  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>(".editor-scene-item")[0]?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-inspector-scene")?.textContent?.includes("SCENE 01") ?? false), "return to Flow-default scene one");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLSelectElement>(".editor-illustration-section select")?.value), "google-flow", "switching scenes preserves distinct source selection");

  const sourceBoundsBefore = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>(".editor-canvas-shell")!.getBoundingClientRect();
    return { width: canvas.width, height: canvas.height };
  });
  assert.ok(sourceBoundsBefore.width > 200 && sourceBoundsBefore.height > 350, `portrait preview stays large: ${JSON.stringify(sourceBoundsBefore)}`);
  await captureViewport("mountain-editor-illustration-source.png");

  const screenshotBytes = flowFixtureBytes[0]!;
  const renderFixtureForm = new FormData();
  renderFixtureForm.append("illustration", new Blob([flowFixtureBytes[0]!], { type: "image/png" }), "google-flow-local-fixture-scene-01.png");
  renderFixtureForm.append("name", "Google Flow local smoke fixture");
  renderFixtureForm.append("source", "ai-generated");
  renderFixtureForm.append("provider", "Google Flow (manual import; synthetic smoke fixture)");
  renderFixtureForm.append("model", "Local synthetic fixture");
  renderFixtureForm.append("prompt", "Local synthetic color fixture for render pipeline smoke; not Google Flow output.");
  renderFixtureForm.append("license", "Local test fixture; not generated by Google Flow");
  const renderFixtureResponse = await fetch(`${apiUrl}/api/projects/${exportProject.id}/visual-assets`, { method: "POST", body: renderFixtureForm });
  const renderFixture = await renderFixtureResponse.json();
  assert.equal(renderFixtureResponse.status, 201, renderFixture.error);
  exportAssetPath = path.resolve(root, "public/visual-assets", renderFixture.asset.file);
  const exportCurrent = await fetch(`${apiUrl}/api/projects/${exportProject.id}`).then((response) => response.json());
  const exportBoard = structuredClone(exportCurrent.visualStoryboard);
  const { semanticPlan: _renderSemanticPlan, ...exportScene } = exportBoard.scenes[0];
  const renderOverride = { background: exportBoard.palette.canvas, layers: [{ id: "manual-flow-raster-fixture", depth: 0.05, nodes: [{ type: "image", asset: renderFixture.asset.id, x: 0, y: 0, width: 1080, height: 1920, fit: "cover", position: "center" }] }] };
  exportBoard.visualWorld = {
    id: "shared-visual-world", name: "Smoke shared base", sourceSceneId: exportScene.sceneId, composition: exportScene.composition,
    elements: exportScene.composition.layers.map((layer: { id: string }) => ({ layerId: layer.id, semanticRole: "other" })),
  };
  exportBoard.scenes[0] = {
    ...exportScene,
    compositionOverride: renderOverride,
    compositionType: "hero-object-focus", layout: "existing-composition", objects: [], relationships: [], visualFocus: null,
    illustrationIntent: renderFixture.asset.name, motionIntent: "gentle-reveal", motionSummary: "Raster fixture animates as one image.",
    motionStatus: "not_prepared", motionActions: [], compositionSource: "library", illustrationSource: "ai-image", missingVisuals: [],
    authoringStatus: "needs_review", authoringConfirmed: false, warnings: ["Synthetic local fixture; not Google Flow output."],
    approved: false, approvedFingerprint: null, flowStatus: "illustration-imported",
  };
  const renderBoardSave = await fetch(`${apiUrl}/api/projects/${exportProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: exportCurrent.researchPackage, visualStoryboard: exportBoard }),
  });
  assert.equal(renderBoardSave.status, 200, await renderBoardSave.clone().text());
  const encoded = screenshotBytes.toString("base64");
  await setIllustrationWorkflow("upload-image");
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-source-card")?.textContent?.includes("Upload Gambar") ?? false), "switch to Upload Gambar source");
  await clickButton(".editor-source-card button", "Upload Gambar picker");
  await page.evaluate((base64) => {
    const input = document.querySelector<HTMLInputElement>(".editor-source-card input")!;
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const file = new File([bytes], "mountain-manual-smoke-fixture.png", { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, encoded);
  await waitFor(async () => {
    const latest = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
    return latest.visualAssets.some((asset: { name: string }) => asset.name === "mountain-manual-smoke-fixture");
  }, "manual raster asset upload persists", 150);
  const uploadedProject = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
  const uploadedAsset = uploadedProject.visualAssets.find((asset: { name: string }) => asset.name === "mountain-manual-smoke-fixture");
  const previewAssetResponse = await fetch(`${viteUrl}/visual-assets/${encodeURIComponent(uploadedAsset.file)}`);
  assert.equal(previewAssetResponse.status, 200, "Vite dev preview proxies project raster assets to API static storage");
  assert.match(previewAssetResponse.headers.get("content-type") ?? "", /^image\//, "Remotion preview receives actual image bytes, not SPA fallback HTML");
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".editor-canvas-shell image").length > 0), "uploaded raster appears in Remotion canvas");
  await captureViewport("mountain-editor-scene-01-after-replace.png");

  const imageTarget = await page.evaluate(() => {
    const target = document.querySelector<SVGRectElement>('.editor-canvas-shell [role="button"][aria-label^="Ilustrasi dipilih"]');
    if (!target) return null;
    const bounds = target.getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, width: bounds.width, height: bounds.height };
  });
  assert.ok(imageTarget && imageTarget.width > 80 && imageTarget.height > 80, `uploaded raster has a usable direct manipulation hit target: ${JSON.stringify(imageTarget)}`);
  const client = (page as unknown as { _client: () => { send: (method: string, params?: Record<string, unknown>) => Promise<unknown> } })._client();
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: imageTarget.x, y: imageTarget.y, button: "left", buttons: 1, clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: imageTarget.x + 24, y: imageTarget.y + 14, button: "left", buttons: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: imageTarget.x + 24, y: imageTarget.y + 14, button: "left", buttons: 0, clickCount: 1 });
  await waitFor(() => page.evaluate(() => document.querySelector('.editor-canvas-shell [data-editor-handle="resize"]') !== null), "image resize handle appears after selection");
  const resizeTarget = await page.evaluate(() => {
    const handle = document.querySelector<SVGRectElement>('.editor-canvas-shell [data-editor-handle="resize"]')!;
    const bounds = handle.getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  });
  const resizeHit = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    return { handle: target?.getAttribute("data-editor-handle"), role: target?.getAttribute("role"), label: target?.getAttribute("aria-label"), x, y, viewport: [innerWidth, innerHeight] };
  }, resizeTarget);
  assert.equal(resizeHit.handle, "resize", `resize handle is topmost hit target: ${JSON.stringify(resizeHit)}`);
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: resizeTarget.x, y: resizeTarget.y, button: "left", buttons: 1, clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: resizeTarget.x - 12, y: resizeTarget.y - 12, button: "left", buttons: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: resizeTarget.x - 12, y: resizeTarget.y - 12, button: "left", buttons: 0, clickCount: 1 });
  const saveButton = await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.outerHTML ?? "");
  assert.ok(saveButton, "editor exposes explicit save state/action");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Tersimpan"), "direct canvas transform saves");
  const movedProject = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
  const movedImage = movedProject.visualStoryboard.scenes[0].composition.layers.flatMap((layer: { nodes: Array<{ type: string; asset?: string }> }) => layer.nodes).find((node: { type: string; asset?: string }) => node.type === "image" && node.asset?.startsWith("upload-"));
  assert.ok(movedImage && movedImage.x > 40, `drag updates existing composition coordinates and persists: ${JSON.stringify(movedImage)}`);
  assert.ok(movedImage.width < 1000 && Math.abs(movedImage.width / movedImage.height - 1000 / 900) < 0.02, `resize handle scales raster while preserving aspect ratio: ${JSON.stringify(movedImage)}`);
  await page.evaluate(() => {
    const details = [...document.querySelectorAll<HTMLDetailsElement>(".editor-advanced")].find((item) => item.querySelector("summary")?.textContent?.includes("Posisi, skala & crop"));
    if (details) details.open = true;
    const select = [...document.querySelectorAll<HTMLLabelElement>(".editor-field")].find((label) => label.textContent?.includes("Tampilan gambar"))?.querySelector("select");
    if (!select) return;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, "cover");
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll<HTMLLabelElement>(".editor-field")].find((label) => label.textContent?.includes("Tampilan gambar"))?.querySelector("select")?.value === "cover"), "fit selector reflects local raster transform");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.click());
  await waitFor(async () => {
    const latest = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
    return latest.visualStoryboard.scenes[0].composition.layers.some((layer: { nodes: Array<{ type: string; fit?: string }> }) => layer.nodes.some((node) => node.type === "image" && node.fit === "cover"));
  }, "fit choice persists with raster transform").catch(async (error) => {
    const latest = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
    const ui = await page.evaluate(() => ({ scene: document.querySelector(".editor-inspector-scene")?.textContent, saved: document.querySelector(".editor-save-state")?.textContent, fit: [...document.querySelectorAll<HTMLLabelElement>(".editor-field")].find((label) => label.textContent?.includes("Tampilan gambar"))?.querySelector("select")?.value, toast: document.querySelector(".toast")?.textContent?.trim() }));
    throw new Error(`${error instanceof Error ? error.message : error}\nUI ${JSON.stringify(ui)}\nScene ${JSON.stringify({ base: latest.visualStoryboard.scenes[0].composition, override: latest.visualStoryboard.scenes[0].compositionOverride })}`);
  });
  await captureViewport("mountain-editor-scene-01-after-edit.png");

  for (const width of [1280, 1024, 768, 390, 360, 320]) {
    await page.setViewport({ width, height: width <= 390 ? 844 : 900, deviceScaleFactor: 1 });
    const viewport = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(viewport.scrollWidth <= viewport.width, `editor has no page overflow at ${width}px: ${JSON.stringify(viewport)}`);
    if (width === 390 || width === 360) await captureViewport(`video-editor-${width}px.png`);
  }
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  const mobileBounds = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, canvas: document.querySelector<HTMLElement>(".editor-canvas-shell")?.getBoundingClientRect().width ?? 0, scenes: document.querySelector(".video-editor-scenes")?.getBoundingClientRect().width ?? 0 }));
  assert.ok(mobileBounds.scrollWidth <= mobileBounds.width && mobileBounds.canvas > 240 && mobileBounds.scenes <= mobileBounds.width, `mobile editor panels scroll rather than overflow: ${JSON.stringify(mobileBounds)}`);
  const mobileInspector = await page.evaluate(() => ({ expanded: document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.getAttribute("aria-expanded"), width: document.querySelector<HTMLElement>(".video-editor-inspector")?.getBoundingClientRect().width ?? 0, contentHeight: document.querySelector<HTMLElement>(".editor-inspector-content")?.clientHeight ?? 0, scrollHeight: document.querySelector<HTMLElement>(".editor-inspector-content")?.scrollHeight ?? 0 }));
  assert.equal(mobileInspector.expanded, "true", "scene selection opens inspector on mobile");
  assert.ok(mobileInspector.width <= 390 && mobileInspector.contentHeight > 0, `mobile inspector fits viewport and keeps internal scroll: ${JSON.stringify(mobileInspector)}`);
  await captureViewport("video-editor-mobile.png");
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });

  await page.goto({ url: viteUrl, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".project-card-open").length >= 2), "dashboard after editor reload");
  await clickProject(mountainProject.researchPackage.title);
  const persistedAfterReload = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
  const reloadedImage = persistedAfterReload.visualStoryboard.scenes[0].composition.layers.flatMap((layer: { nodes: Array<{ type: string; asset?: string }> }) => layer.nodes).find((node: { type: string; asset?: string }) => node.type === "image" && node.asset?.startsWith("upload-"));
  assert.equal(reloadedImage.x, movedImage.x, "canvas position survives project reload");
  assert.equal(reloadedImage.fit, "cover", "fit mode survives project reload");
  assert.equal(persistedAfterReload.visualStoryboard.scenes[0].illustrationWorkflow, "upload-image", "scene one source selection persists after reload");
  assert.equal(persistedAfterReload.visualStoryboard.scenes[6].illustrationWorkflow, "upload-image", "scene seven keeps its independent source selection after reload");
  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>(".editor-scene-item")[6]?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-inspector-scene")?.textContent?.includes("SCENE 07") ?? false), "reload restores source on scene seven");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLSelectElement>(".editor-illustration-section select")?.value), "upload-image");
  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>(".editor-scene-item")[0]?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-inspector-scene")?.textContent?.includes("SCENE 01") ?? false), "return to scene one after source persistence check");

  await setIllustrationWorkflow("google-flow");
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".google-flow-panel"))), "Google Flow workflow panel");
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('.editor-inspector-tabs [role="tab"]')].map((button) => button.textContent?.trim())), ["Visual"], "Visual Storyboard exposes visual authoring only");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.getAttribute("aria-expanded") === "false"), "close inspector before testing batch modal");
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector<HTMLButtonElement>(".editor-batch-launch") && !document.querySelector<HTMLButtonElement>(".editor-batch-launch")!.disabled)), "batch launcher remains available with inspector closed");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-batch-launch")?.click());
  await waitFor(() => page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>(".google-flow-batch-dialog");
    const bounds = dialog?.getBoundingClientRect();
    return Boolean(dialog?.open && bounds && bounds.width > 0 && bounds.height > 0);
  }), "batch modal renders outside collapsed inspector");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.getAttribute("aria-expanded")), "false", "batch modal does not require opening inspector");
  await captureViewport("batch-modal-inspector-closed.png");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[aria-label="Tutup batch import"]')?.click());
  await waitFor(() => page.evaluate(() => !(document.querySelector<HTMLDialogElement>(".google-flow-batch-dialog")?.open ?? false)), "close batch modal while inspector stays closed");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.getAttribute("aria-expanded") === "true"), "reopen inspector for Flow authoring checks");
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('.editor-inspector-tabs [role="tab"]')].some((button) => button.textContent?.trim() === "Visual" && button.getAttribute("aria-selected") === "true")), "Visual tab remains active for Flow authoring checks");
  assert.ok(await setFlowVisualMode("still-image"), "legacy still-image Flow workflow remains selectable");
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll<HTMLLabelElement>(".google-flow-panel label.editor-field")].find((label) => label.textContent?.includes("Jenis Visual"))?.querySelector("select")?.value === "still-image"), "select still-image prompt mode for image-import regression");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".google-flow-panel button")].find((button) => button.textContent?.includes("Buat Prompt Ilustrasi"))?.click());
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".google-flow-prompt-details"))), "per-scene prompt generation and collapsible prompt editor");
  const panelPrompt = await page.evaluate(() => document.querySelector<HTMLTextAreaElement>(".google-flow-prompt")?.value ?? "");
  assert.match(panelPrompt, /one finished still illustration/i, "scene prompt requests one complete illustration");
  assert.match(panelPrompt, /no text/i);
  assert.match(await page.evaluate(() => document.querySelector(".google-flow-identity small")?.textContent ?? ""), /flow-[a-f0-9]{16}\.webp$/, "recommended filename retains stable scene token");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLDetailsElement>(".google-flow-prompt-details")?.open), false, "generated prompt starts collapsed");
  await page.evaluate(() => document.querySelector(".google-flow-panel")?.scrollIntoView({ block: "start" }));
  await captureViewport("mountain-google-flow-prompt-ready.png");
  await page.evaluate(() => {
    const writeText = new Function("value", "document.documentElement.dataset.copiedPrompt = value; return Promise.resolve();");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    [...document.querySelectorAll<HTMLButtonElement>(".google-flow-actions button")].find((button) => button.textContent?.includes("Edit Prompt"))?.click();
  });
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLDetailsElement>(".google-flow-prompt-details")?.open ?? false), "Edit Prompt expands the collapsible editor");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".google-flow-actions button")].find((button) => button.textContent?.includes("Salin Prompt"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".google-flow-live")?.textContent?.includes("Prompt disalin") ?? false), "Copy Prompt writes generated scene prompt");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLAnchorElement>(".google-flow-actions a")?.href), "https://flow.google.com/", "official Google Flow link is used");

  const editedPrompt = `${panelPrompt}\nLocal browser-smoke edit; still one image.`;
  await page.evaluate((value) => {
    const textarea = document.querySelector<HTMLTextAreaElement>(".google-flow-prompt")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  }, editedPrompt);
  await page.evaluate(() => {
    const details = document.querySelector<HTMLDetailsElement>(".google-flow-project-tools")!;
    details.open = true;
    const lighting = [...document.querySelectorAll<HTMLLabelElement>(".google-flow-style-fields label")].find((label) => label.textContent?.includes("Lighting"))?.querySelector("textarea");
    if (lighting) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(lighting, "Consistent soft local-smoke lighting");
      lighting.dispatchEvent(new Event("input", { bubbles: true }));
      lighting.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll<HTMLLabelElement>(".google-flow-style-fields label")].find((label) => label.textContent?.includes("Lighting"))?.querySelector("textarea")?.value === "Consistent soft local-smoke lighting"), "Style Lock edit applies to project state");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".google-flow-project-actions button")].find((button) => button.textContent?.includes("Apply Style Lock to All Prompts"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector('[role="alertdialog"] .confirm-submit') !== null), "confirm prompt regeneration without changing artwork");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[role="alertdialog"] .confirm-submit')?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() !== "Tersimpan"), "Flow prompt/style edits mark project dirty");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Tersimpan"), "Google Flow prompt and Style Lock save");
  const flowPromptProject = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
  assert.equal(flowPromptProject.visualStoryboard.styleLock.lighting, "Consistent soft local-smoke lighting");
  assert.ok(flowPromptProject.visualStoryboard.scenes.slice(0, 3).every((scene: { flowPrompt?: string }) => scene.flowPrompt?.includes("Consistent soft local-smoke lighting")), "Apply Style Lock rebuilds and persists scene prompt pack");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".google-flow-project-actions button")].find((button) => button.textContent?.includes("Export Markdown"))?.click());

  const singleFixtureBase64 = flowFixtureBytes[0]!.toString("base64");
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const file = new File([bytes], "scene-01-gunung-terbentuk.png", { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector<HTMLInputElement>(".google-flow-drop input")!;
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, singleFixtureBase64);
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".google-flow-file-preview img"))), "single illustration import preview");
  await page.evaluate(() => document.querySelector(".google-flow-file-preview")?.scrollIntoView({ block: "center" }));
  await captureViewport("mountain-google-flow-single-import-preview.png");
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.evaluate(() => document.querySelector(".google-flow-file-preview")?.scrollIntoView({ block: "center" }));
  const mobileImportPreview = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>(".google-flow-file-preview")!;
    const info = card.querySelector<HTMLElement>("div")!;
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, cardRight: card.getBoundingClientRect().right, columns: getComputedStyle(card).gridTemplateColumns.split(" ").length, infoWidth: info.getBoundingClientRect().width };
  });
  assert.ok(mobileImportPreview.scrollWidth <= mobileImportPreview.width && mobileImportPreview.cardRight <= mobileImportPreview.width && mobileImportPreview.columns === 1 && mobileImportPreview.infoWidth > 180, `narrow import preview stacks and wraps without overflow: ${JSON.stringify(mobileImportPreview)}`);
  await captureViewport("mountain-google-flow-single-import-preview-mobile.png");
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector<HTMLElement>(".editor-inspector-content")!.scrollTop = 0; });
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".google-flow-file-preview button")].find((button) => button.textContent?.includes("Gunakan Ilustrasi"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector('[role="alertdialog"] .confirm-submit') !== null), "confirm replacing current scene artwork");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[role="alertdialog"] .confirm-submit')?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".google-flow-identity")?.textContent?.includes("Ilustrasi Diimport") ?? false), "single image import updates scene status");
  const singleImportedProject = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
  assert.deepEqual(singleImportedProject.visualStoryboard.scenes[1].composition, mountainProject.visualStoryboard.scenes[1].composition, "single-scene import leaves other scene composition unchanged");
  assert.ok(await page.evaluate(() => document.querySelectorAll(".editor-scene-item:first-child .editor-scene-thumbnail image").length > 0), "single-scene import updates sidebar thumbnail immediately");
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-content button")].some((button) => button.textContent?.includes("Gunakan untuk Semua Scene") && !button.disabled)), "shared Visual World action is enabled after upload");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-content button")].find((button) => button.textContent?.includes("Gunakan untuk Semua Scene"))?.click());
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector('[role="alertdialog"] .confirm-submit'))), "shared Visual World warns about affected scenes");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[role="alertdialog"] .confirm-submit')?.click());
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll(".editor-info-box strong")].some((item) => item.textContent?.includes("Shared VisualWorld"))), "shared Visual World is active before per-scene batch import");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Tersimpan"), "shared Visual World persists before per-scene batch import");
  const sharedWorldBeforeBatch = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json()).then((project) => project.visualStoryboard.visualWorld);

  await waitFor(() => page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>(".editor-batch-launch");
    return Boolean(button && !button.disabled);
  }), "Scene List batch import launcher ready");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-batch-launch")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLDialogElement>(".google-flow-batch-dialog")?.open ?? false), "batch import review dialog");
  await page.evaluate((encodedFiles) => {
    const transfer = new DataTransfer();
    for (const item of encodedFiles) {
      const bytes = item.oversized ? new Uint8Array(10 * 1024 * 1024 + 1) : Uint8Array.from(atob(item.base64), (character) => character.charCodeAt(0));
      transfer.items.add(new File([bytes], item.name, { type: "image/png" }));
    }
    const input = document.querySelector<HTMLInputElement>(".google-flow-batch-drop input")!;
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, [
    ...flowFixtures.map((fixture, index) => ({ name: fixture.name, base64: flowFixtureBytes[index]!.toString("base64") })),
    { name: "unknown-final.png", base64: flowFixtureBytes[2]!.toString("base64") },
    { name: "scene-04-corrupt.png", base64: Buffer.from("not a PNG image").toString("base64") },
    { name: "scene-06-oversized.png", oversized: true },
  ]);
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".google-flow-batch-row:not(.google-flow-batch-head)").length === 6), "three matched, one unmatched, one corrupt, and one oversized Flow file enter batch review");
  const batchMapping = await page.evaluate(() => [...document.querySelectorAll<HTMLSelectElement>(".google-flow-batch-row:not(.google-flow-batch-head) select")].map((select) => select.value));
  assert.deepEqual(batchMapping, [...mountainProject.visualStoryboard.scenes.slice(0, 3).map((scene: { sceneId: string }) => scene.sceneId), "", mountainProject.visualStoryboard.scenes[3].sceneId, mountainProject.visualStoryboard.scenes[5].sceneId], "batch maps first three scenes, leaves unknown unmatched, and assigns invalid/oversized files by scene number");
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".google-flow-batch-row:not(.google-flow-batch-head) .google-flow-match-status")[3]?.textContent?.includes("duplikat konten") ?? false), "exact duplicate content receives a batch review hint");
  await page.evaluate((sceneId) => {
    const select = document.querySelectorAll<HTMLSelectElement>(".google-flow-batch-row:not(.google-flow-batch-head) select")[3]!;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, sceneId);
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, mountainProject.visualStoryboard.scenes[4].sceneId);
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".google-flow-batch-row:not(.google-flow-batch-head) .google-flow-match-status")[3]?.textContent?.includes("Assignment manual") ?? false), "unmatched file accepts manual scene assignment");
  await page.evaluate(() => {
    const row = document.querySelectorAll<HTMLDivElement>(".google-flow-batch-row:not(.google-flow-batch-head)")[3]!;
    const select = row.querySelector<HTMLSelectElement>("select")!;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, "");
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    row.querySelector<HTMLButtonElement>("button")?.click();
  });
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".google-flow-batch-row:not(.google-flow-batch-head) .google-flow-match-status")[3]?.textContent?.trim() === "Dilewati"), "unmatched file can be explicitly skipped");
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".google-flow-batch-row:not(.google-flow-batch-head) .google-flow-match-status")[5]?.textContent?.includes("melebihi 10 MB") ?? false), "oversized file gets per-row validation before upload");
  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>(".google-flow-batch-row:not(.google-flow-batch-head) button")[5]?.click());
  await captureViewport("mountain-google-flow-batch-review.png");
  const batchApplyButton = await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".google-flow-batch-dialog footer button")].find((button) => button.textContent?.includes("Terapkan Media"))?.textContent ?? "");
  assert.match(batchApplyButton, /\(4\)/, "three scene mappings and one server-validated candidate have unique assignments");
  const batchRequestsBefore = await page.evaluate((path) => performance.getEntriesByType("resource").filter((entry) => new URL(entry.name).pathname === path).length, `/api/projects/${mountainProject.id}/visual-assets/batch`);
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".google-flow-batch-dialog footer button")].find((button) => button.textContent?.includes("Terapkan Media"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector('[role="alertdialog"] .confirm-submit') !== null), "confirm batch replacement for existing artwork");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[role="alertdialog"] .confirm-submit')?.click());
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".google-flow-batch-error")?.textContent?.trim())), "batch keeps per-file failure visible after successful files apply", 180);
  const batchRequestsAfter = await page.evaluate((path) => performance.getEntriesByType("resource").filter((entry) => new URL(entry.name).pathname === path).length, `/api/projects/${mountainProject.id}/visual-assets/batch`);
  assert.equal(batchRequestsAfter - batchRequestsBefore, 2, "four eligible files upload as bounded requests of at most three files");
  const batchProgress = await page.evaluate(() => ({
    text: document.querySelector(".google-flow-batch-progress")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    value: document.querySelector<HTMLElement>('.google-flow-batch-progress [role="progressbar"]')?.getAttribute("aria-valuenow") ?? "",
  }));
  assert.equal(batchProgress.value, "100", "completed partial batch exposes accessible completed progress");
  assert.match(batchProgress.text, /3 berhasil · 1 gagal dari 4/);
  const partialBatch = await page.evaluate(() => ({ remainingRows: document.querySelectorAll(".google-flow-batch-row:not(.google-flow-batch-head)").length, error: document.querySelector(".google-flow-batch-error")?.textContent?.trim() ?? "" }));
  assert.equal(partialBatch.remainingRows, 3, "successful files leave review list while skipped and failed files remain");
  assert.match(partialBatch.error, /scene-04-corrupt\.png/);
  await captureViewport("mountain-google-flow-batch-partial-failure.png");
  await page.evaluate(() => {
    const row = [...document.querySelectorAll<HTMLDivElement>(".google-flow-batch-row:not(.google-flow-batch-head)")].find((item) => item.textContent?.includes("scene-04-corrupt.png"));
    row?.querySelector<HTMLButtonElement>("button")?.click();
  });
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "scene-04-retry.png", { type: "image/png" }));
    const input = document.querySelector<HTMLInputElement>(".google-flow-batch-drop input")!;
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, retryFixtureBytes.toString("base64"));
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".google-flow-batch-row:not(.google-flow-batch-head)").length === 4), "retry adds only replacement for failed file while retaining skipped rows");
  await waitFor(() => page.evaluate((sceneId) => [...document.querySelectorAll<HTMLSelectElement>(".google-flow-batch-row:not(.google-flow-batch-head) select")].some((select) => select.value === sceneId), mountainProject.visualStoryboard.scenes[3].sceneId), "retry file auto-matches failed scene");
  const retryCount = await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".google-flow-batch-dialog footer button")].find((button) => button.textContent?.includes("Terapkan Media"))?.textContent ?? "");
  assert.match(retryCount, /\(1\)/, "retry submits only remaining valid file, not prior successes");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".google-flow-batch-dialog footer button")].find((button) => button.textContent?.includes("Terapkan Media"))?.click());
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector('[role="alertdialog"] .confirm-submit'))), "confirm replacement for retry scene");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[role="alertdialog"] .confirm-submit')?.click());
  await waitFor(() => page.evaluate(() => !(document.querySelector<HTMLDialogElement>(".google-flow-batch-dialog")?.open ?? false)), "retry applies failed file and closes completed batch");
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() !== "Tersimpan"), "batch image assignments mark project dirty");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.click());
  const batchSaveState = await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Tersimpan"), "batch save result", 180)
    .then(() => page.evaluate(() => ({ state: document.querySelector(".editor-save-state")?.textContent?.trim() ?? "missing", message: document.querySelector(".toast")?.textContent?.trim() ?? "" })));
  assert.equal(batchSaveState.state, "Tersimpan", `batch scene artwork persists; toast=${batchSaveState.message}`);
  const flowImportedProject = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
  const importedFirstThree = flowImportedProject.visualStoryboard.scenes.slice(0, 3);
  assert.deepEqual(flowImportedProject.visualStoryboard.visualWorld, sharedWorldBeforeBatch, "per-scene Flow batch leaves Shared VisualWorld unchanged");
  assert.ok(importedFirstThree.every((scene: { flowStatus: string; composition: { layers: Array<{ nodes: Array<{ type: string; asset?: string }> }> } }) => scene.flowStatus === "illustration-imported" && scene.composition.layers.flatMap((layer) => layer.nodes).some((node) => node.type === "image" && node.asset?.startsWith("upload-"))), "all three POC scenes persist raster assets as imported artwork");
  assert.ok(importedFirstThree.every((scene: { compositionOverride?: { layers: Array<{ nodes: Array<{ type: string; asset?: string }> }> } }) => scene.compositionOverride?.layers.flatMap((layer) => layer.nodes).some((node) => node.type === "image")), "all three imported scenes persist explicit scene overrides");
  assert.ok(flowImportedProject.visualStoryboard.scenes.slice(4).every((scene: { compositionOverride?: unknown }) => !scene.compositionOverride), "unassigned scenes retain shared base without per-scene override");
  assert.equal(flowImportedProject.visualStoryboard.scenes[3].flowStatus, "illustration-imported", "retry applies previously failed row without re-uploading successful rows");
  assert.ok(flowImportedProject.visualStoryboard.scenes[3].compositionOverride?.layers.flatMap((layer: { nodes: Array<{ type: string }> }) => layer.nodes).some((node: { type: string }) => node.type === "image"), "retry persists replacement scene override");
  assert.deepEqual(importedFirstThree.map((scene: { flowPrompt?: string }) => Boolean(scene.flowPrompt)), [true, true, true], "scene-specific prompts persist with imported raster artwork");
  await page.evaluate(() => {
    document.querySelector<HTMLElement>(".editor-inspector-content")!.scrollTop = 0;
    document.querySelector(".editor-canvas-shell")?.scrollIntoView({ block: "center" });
  });
  await captureViewport("mountain-google-flow-imported-canvas.png");
  await page.goto({ url: viteUrl, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".project-card-open").length >= 2), "dashboard before Flow project reload");
  await clickProject(mountainProject.researchPackage.title);
  const flowAfterReload = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
  assert.deepEqual(flowAfterReload.visualStoryboard.scenes.slice(0, 3).map((scene: { flowStatus: string }) => scene.flowStatus), ["illustration-imported", "illustration-imported", "illustration-imported"], "imported Flow fixture scene state survives project reload");
  assert.equal(await page.evaluate(() => document.querySelectorAll(".editor-canvas-shell image").length > 0), true, "reloaded editor canvas renders persisted raster illustration");
  await captureViewport("mountain-google-flow-reloaded.png");

  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>(".editor-scene-item")[0]?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-inspector-scene")?.textContent?.includes("SCENE 01") ?? false), "return to imported scene for shared Visual World test");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-content button")].find((button) => button.textContent?.includes("Gunakan untuk Semua Scene"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector('[role="alertdialog"] .confirm-submit') !== null), "shared Visual World warns before replacing imported scenes");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[role="alertdialog"] .confirm-submit')?.click());
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll(".editor-info-box strong")].some((node) => node.textContent?.includes("Shared VisualWorld"))), "shared Visual World applies to all scenes");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Tersimpan"), "shared Visual World saves");
  const sharedWorldSaved = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
  assert.ok(sharedWorldSaved.visualStoryboard.visualWorld?.elements.length > 0, "Visual World layer manifest persists with project");
  assert.ok(sharedWorldSaved.visualStoryboard.scenes.every((scene: { composition: unknown }) => JSON.stringify(scene.composition) === JSON.stringify(sharedWorldSaved.visualStoryboard.visualWorld.composition)), "every persisted scene references the same base composition");

  const mountainBeforeEditor = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
  const smokeImageComposition = {
    background: mountainBeforeEditor.visualStoryboard.palette.canvas,
    layers: [{ id: "smoke-approved-art", depth: 0.72, nodes: [{ type: "image", asset: uploadedAsset.id, x: 100, y: 560, width: 880, height: 800, fit: "cover", position: "center" }] }],
  };
  const artworkBoard = {
    ...mountainBeforeEditor.visualStoryboard,
    scenes: mountainBeforeEditor.visualStoryboard.scenes.map((scene: any) => {
      const prepared = {
        ...scene, compositionOverride: smokeImageComposition, compositionSource: "manual", illustrationSource: "manual",
        authoringStatus: "ready_for_review", authoringConfirmed: true, missingVisuals: [], warnings: [], relationships: [],
        flowStatus: "illustration-imported", approved: false, approvedFingerprint: null,
      };
      return prepared;
    }),
  };
  const artworkResponse = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: mountainBeforeEditor.researchPackage, visualStoryboard: artworkBoard, narrationMode: "manual" }),
  });
  assert.equal(artworkResponse.status, 200, `smoke fixture saves synthetic scene art: ${await artworkResponse.clone().text()}`);
  const artworkProject = await artworkResponse.json();
  const editorReadyGate = visualStoryboardQualityGate(artworkProject.researchPackage, artworkProject.visualStoryboard, artworkProject.visualAssets);
  assert.equal(editorReadyGate.ready, true, `smoke fixture Visual Storyboard passes quality gate: ${JSON.stringify(editorReadyGate.issues)}`);
  assert.ok(artworkProject.visualStoryboard.scenes.every((scene: { approved: boolean }) => !scene.approved), "Edit Video fixture keeps scene approvals pending");
  await page.goto({ url: `${viteUrl}/projects/${mountainProject.id}?step=visual&scene=${encodeURIComponent(mountainBeforeEditor.visualStoryboard.scenes[0].sceneId)}`, timeout: 90_000 });
  await waitFor(() => page.evaluate((title) => new URLSearchParams(location.search).get("step") === "visual" && document.querySelector(".video-editor-v2") !== null && document.querySelector<HTMLInputElement>(".video-editor-title input")?.value === title, mountainProject.researchPackage.title), "Visual Storyboard reloads before Edit Video");
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].map((button) => button.textContent?.trim())), ["Visual"], "Visual Storyboard stays separate from Edit Video controls");
  await page.goto({ url: `${viteUrl}/projects/${mountainProject.id}/editor?scene=${encodeURIComponent(mountainBeforeEditor.visualStoryboard.scenes[0].sceneId)}`, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => location.pathname.endsWith("/editor") && [...document.querySelectorAll(".editor-inspector-tabs button")].some((button) => button.textContent?.trim() === "Gerak")), "Visual approval unlocks direct Edit Video route");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Gerak")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-motion-direction") !== null), "Motion Direction controls load only in Edit Video");
  await captureViewport("motion-direction-controls.png");
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const mobileMotionLayout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, panelRight: Math.round(document.querySelector<HTMLElement>(".editor-inspector")?.getBoundingClientRect().right ?? 0) }));
  assert.ok(mobileMotionLayout.scrollWidth <= mobileMotionLayout.width && mobileMotionLayout.panelRight <= mobileMotionLayout.width + 1, `Motion Direction fits mobile viewport: ${JSON.stringify(mobileMotionLayout)}`);
  await captureViewport("motion-direction-390px.png");
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  const motionBefore = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
  const untouchedSceneMotion = structuredClone(motionBefore.researchPackage.scenes[1].motionPlan);
  assert.equal(await page.evaluate(() => document.querySelector<HTMLInputElement>('.editor-motion-effect[data-cue="fadeIn"] input')?.checked), true, "legacy Fade In cue appears active");
  assert.equal(await setMotionCue("fadeIn", false), true, "Fade In can be disabled");
  assert.equal(await setMotionCue("fadeIn", true), true, "Fade In can be enabled again");
  assert.equal(await setMotionCue("pan", true), true, "Pan can be enabled per scene");
  assert.equal(await setMotionControl('[aria-label="Durasi Pan (detik)"]', "2.4"), true, "Pan duration input is editable");
  assert.equal(await setMotionControl('.editor-motion-parameters select', "right"), true, "Pan direction input is editable");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-motion-transition button")].find((button) => button.textContent?.trim() === "Crossfade")?.click());
  assert.equal(await setMotionControl('[aria-label="Durasi transisi (detik)"]', "1.2"), true, "Crossfade duration input is editable");
  await page.evaluate(() => {
    const playhead = document.querySelector<HTMLInputElement>("#editor-playhead")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(playhead, "0");
    playhead.dispatchEvent(new Event("input", { bubbles: true }));
    playhead.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.ok(await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-motion-direction button")].some((button) => button.textContent?.includes("Pratinjau Efek · Pan"))), "effect preview names selected Motion Direction");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-motion-direction button")].find((button) => button.textContent?.includes("Pratinjau Efek"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-play-button")?.getAttribute("aria-label") === "Jeda video"), "Remotion effect preview starts scene playback");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-play-button")?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-motion-direction button")].find((button) => button.textContent?.includes("Pratinjau Efek"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-play-button")?.getAttribute("aria-label") === "Jeda video"), "Motion Direction preview can be replayed");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-play-button")?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Tersimpan"), "Motion Direction draft saves");
  const savedMotion = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
  const savedSceneMotion = savedMotion.researchPackage.scenes[0].motionPlan;
  assert.ok(savedSceneMotion.some((plan: { cue: string }) => plan.cue === "fadeIn"), "enabled Fade In persists");
  assert.deepEqual(savedSceneMotion.find((plan: { cue: string }) => plan.cue === "pan"), { cue: "pan", targetLayer: "all", delayFrames: 0, durationFrames: 72, easing: "linear", direction: "right" }, "Pan direction and duration persist");
  assert.equal(savedSceneMotion.find((plan: { cue: string }) => plan.cue === "dissolve")?.durationFrames, 36, "Crossfade duration persists");
  assert.deepEqual(savedMotion.researchPackage.scenes[1].motionPlan, untouchedSceneMotion, "editing scene one does not change scene two motion");
  await page.goto({ url: `${viteUrl}/projects/${mountainProject.id}/editor?scene=${mountainBeforeEditor.visualStoryboard.scenes[0].sceneId}`, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => location.pathname.endsWith("/editor") && Boolean(document.querySelector(".video-editor-v2"))), "reload Motion Direction project while Visual approval is pending");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Gerak")?.click());
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector<HTMLInputElement>('.editor-motion-effect[data-cue="pan"] input')?.checked)), "Pan remains active after reload");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('.editor-motion-effect[data-cue="pan"] button')?.click());
  assert.equal(await page.evaluate(() => document.querySelector<HTMLInputElement>('[aria-label="Durasi Pan (detik)"]')?.value), "2.4", "Pan duration reloads into editor");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLInputElement>('.editor-motion-effect[data-cue="fadeIn"] input')?.checked), true, "Fade In reloads into editor");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Gerak")?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-content button")].find((button) => button.textContent?.includes("Tambah beat jalur magma"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector('[data-motion-path-point="0"]') !== null), "authored Motion Beat exposes editable canvas handles");
  const initialPoint = await page.evaluate(() => document.querySelector<SVGCircleElement>('[data-motion-path-point="0"]')?.getAttribute("aria-valuetext") ?? "");
  await page.evaluate(() => {
    const handle = document.querySelector<SVGCircleElement>('[data-motion-path-point="0"]')!;
    handle.focus();
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  });
  await waitFor(() => page.evaluate((before) => document.querySelector<SVGCircleElement>('[data-motion-path-point="0"]')?.getAttribute("aria-valuetext") !== before, initialPoint), "keyboard edits deterministic path coordinates");
  const startBeforeTimelineNudge = await page.evaluate(() => document.querySelector<HTMLInputElement>('.editor-motion-beats input[type="number"]')?.value ?? "");
  await page.evaluate(() => {
    const clip = document.querySelector<HTMLButtonElement>(".editor-motion-clip")!;
    clip.focus();
    clip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  });
  await waitFor(() => page.evaluate((before) => document.querySelector<HTMLInputElement>('.editor-motion-beats input[type="number"]')?.value !== before, startBeforeTimelineNudge), "timeline keyboard nudge updates Motion Beat timing");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Tersimpan"), "Motion Beat path and timing save");
  const motionBeatSaved = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
  const persistedBeat = motionBeatSaved.visualStoryboard.scenes[0].motionActions[0];
  assert.ok(persistedBeat?.path?.length >= 2 && persistedBeat.path[0].x !== 540, "canvas keyboard edit persists in authored path");
  assert.equal(persistedBeat.startFrame, 40, "timeline keyboard nudge persists scene-relative start frame");
  await page.goto({ url: viteUrl, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".project-card-open").length >= 2), "dashboard before Visual World reload check");
  await clickEditorProject(mountainProject.researchPackage.title);
  const sharedWorldAfterReload = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
  assert.ok(sharedWorldAfterReload.visualStoryboard.visualWorld?.elements.length > 0, "Visual World survives editor reload");
  assert.equal(sharedWorldAfterReload.visualStoryboard.scenes[0].motionActions[0].startFrame, 40, "edited Motion Beat survives editor reload");
  assert.ok(await page.evaluate(() => document.querySelectorAll(".editor-motion-clip").length > 0), "reloaded editor timeline shows persisted Motion Beat");

  await page.goto({ url: viteUrl, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".project-card-open").length >= 2), "dashboard before export flow");
  await clickProject(exportProject.researchPackage.title);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="visual"]')?.click());
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".video-editor-v2"))), "short project editor");
  const renderCanvas = await page.evaluate(() => ({ imageCount: document.querySelectorAll(".editor-canvas-shell image").length, href: document.querySelector<SVGImageElement>(".editor-canvas-shell image")?.getAttribute("href") ?? document.querySelector<SVGImageElement>(".editor-canvas-shell image")?.getAttribute("xlink:href") ?? "" }));
  assert.ok(renderCanvas.imageCount > 0 && renderCanvas.href.includes(renderFixture.asset.file), `editor preview displays imported local raster fixture: ${JSON.stringify(renderCanvas)}`);
  await captureViewport("mountain-google-flow-render-source.png");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-content button")].find((button) => button.textContent?.includes("Saya sudah meninjau visual"))?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Tersimpan"), "human visual review confirmation persists");
  await waitFor(() => page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-footer button")].find((item) => item.textContent?.includes("Setujui scene"));
    return Boolean(button && !button.disabled);
  }), "imported image passes review gate for explicit approval", 80).catch(() => {});
  const approvalState = await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-footer button")].find((item) => item.textContent?.includes("Setujui scene"));
    return { enabled: Boolean(button && !button.disabled), button: button?.textContent?.trim() ?? "missing", footer: document.querySelector(".editor-inspector-footer")?.textContent?.trim() ?? "", saveState: document.querySelector(".editor-save-state")?.textContent?.trim() ?? "" };
  });
  assert.equal(approvalState.enabled, true, `valid draft can be opened and scene approval works from editor: ${JSON.stringify(approvalState)}`);
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-footer button")].find((button) => button.textContent?.includes("Setujui scene"))?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Tersimpan"), "approved scene saves");
  await waitFor(async () => (await fetch(`${apiUrl}/api/projects/${exportProject.id}`).then((response) => response.json())).visualStoryboard.scenes[0].approved, "scene approval persists");
  await page.goto({ url: `${viteUrl}/projects/${exportProject.id}/editor`, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => location.pathname.endsWith("/editor") && [...document.querySelectorAll(".editor-inspector-tabs button")].some((button) => button.textContent?.trim() === "Gerak")), "explicit visual approval unlocks Edit Video route");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-back-button")?.click());
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".workflow-stepper"))), "workflow returns to project materials");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="review"]')?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".review-author-card button") !== null), "fact review step");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".review-author-card button")?.click());
  await waitFor(async () => (await fetch(`${apiUrl}/api/projects/${exportProject.id}`).then((response) => response.json())).researchReviewStatus === "verified-by-author", "author fact review persists");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="preview"]')?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".interactive-preview-player") !== null), "whole-video Remotion preview");
  const play = await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".interactive-preview-player button")].find((button) => /play/i.test(`${button.getAttribute("aria-label")} ${button.title} ${button.textContent}`))?.outerHTML ?? "");
  assert.ok(play, "full-video preview has functional playback controls");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".interactive-preview-player button")].find((button) => /play/i.test(`${button.getAttribute("aria-label")} ${button.title} ${button.textContent}`))?.click());
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".interactive-preview-note button")].some((button) => button.textContent?.includes("Tandai Preview sudah ditinjau"))), "preview playback starts review");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".interactive-preview-note button")].find((button) => button.textContent?.includes("Tandai Preview sudah ditinjau"))?.click());
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".interactive-preview-note button")].some((button) => button.textContent?.includes("Preview ditinjau"))), "preview review status saves");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="render"]')?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".render-actions .button-primary") !== null), "render step");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".render-actions .button-primary")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector('[role="alertdialog"] .confirm-submit') !== null), "explicit silent render confirmation");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[role="alertdialog"] .confirm-submit')?.click());
  await waitFor(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/projects/${exportProject.id}`);
      if (!response.ok) return false;
      const project = await response.json();
      return project.latestJob?.state === "rendered" || project.latestJob?.state === "failed";
    } catch (error) {
      if (apiServer.exitCode !== null) throw new Error(`API exited ${apiServer.exitCode}; recent logs:\n${apiLogs.slice(-20).join("\n")}\n${error instanceof Error ? error.message : error}`);
      return false;
    }
  }, "short approved MP4 render", 900);
  const renderedProject = await fetch(`${apiUrl}/api/projects/${exportProject.id}`).then((response) => response.json());
  assert.equal(renderedProject.latestJob.state, "rendered", `MP4 render succeeds: ${renderedProject.latestJob.error ?? ""}`);
  assert.equal(renderedProject.latestJob.manifest.videoCodec, "h264");
  assert.equal(renderedProject.latestJob.manifest.width, 1080);
  const renderSnapshot = JSON.parse(await readFile(path.join(tempDir, "data", "jobs", renderedProject.latestJob.id, "snapshot.json"), "utf8"));
  assert.deepEqual(renderSnapshot.research.scenes[0].visualComposition, renderOverride, "immutable render snapshot resolves scene override over Shared VisualWorld");
  assert.ok(renderSnapshot.visualAssets.some((asset: { id: string }) => asset.id === renderFixture.asset.id), "render snapshot includes asset referenced only by scene override");
  const mp4 = await fetch(`${apiUrl}${renderedProject.latestJob.downloadUrl}`).then(async (response) => {
    assert.equal(response.status, 200);
    return Buffer.from(await response.arrayBuffer());
  });
  const mp4Path = path.join(evidenceDir, "mountain-editor-smoke.mp4");
  await writeFile(mp4Path, mp4);
  assert.ok(mp4.length > 50_000, "rendered MP4 has nontrivial output bytes");
  const mp4FramePath = path.join(evidenceDir, "mountain-google-flow-mp4-frame.png");
  await runLocal("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", mp4Path, "-frames:v", "1", "-y", mp4FramePath]);
  assert.ok((await readFile(mp4FramePath)).length > 1000, "rendered MP4 decodes to a non-empty image frame");

  await page.goto({ url: viteUrl, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".project-card-open").length >= 2), "dashboard before volcano sample shortcut");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('.topbar-create[aria-label="Buat video"]')?.click());
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("button")].some((button) => button.textContent?.includes("Gunakan sample gunung api"))), "Create Video sample shortcut");
  const sampleOpened = await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("Gunakan sample gunung api"));
    button?.click();
    return Boolean(button);
  });
  assert.equal(sampleOpened, true, "dashboard volcano sample button exists");
  const volcanoTitle = "Bagaimana Gunung Api Terbentuk dan Meletus?";
  await waitFor(() => page.evaluate((title) => document.querySelector<HTMLInputElement>(".workspace-heading .title-input, .video-editor-title input")?.value === title, volcanoTitle), "volcano sample opens in workspace");
  const volcanoProject = await fetch(`${apiUrl}/api/projects`).then((response) => response.json()).then((projects: Array<{ id: string; researchPackage: { title: string } }>) => projects.find((item) => item.researchPackage.title === volcanoTitle));
  assert.ok(volcanoProject, "dashboard sample shortcut creates a saved volcano project");
  projectIds.push(volcanoProject!.id);
  const volcanoBeforeEditor = await fetch(`${apiUrl}/api/projects/${volcanoProject!.id}`).then((response) => response.json());
  const volcanoGate = visualStoryboardQualityGate(volcanoBeforeEditor.researchPackage, volcanoBeforeEditor.visualStoryboard, volcanoBeforeEditor.visualAssets);
  assert.equal(volcanoGate.ready, false, "volcano sample keeps known Visual Storyboard review issues for editor-access regression");
  const manualTiming = await fetch(`${apiUrl}/api/projects/${volcanoProject!.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: volcanoBeforeEditor.researchPackage, visualStoryboard: volcanoBeforeEditor.visualStoryboard, narrationMode: "manual" }),
  });
  assert.equal(manualTiming.status, 200, "sample fixture explicitly chooses manual narration timing");
  await page.goto({ url: `${viteUrl}/projects/${volcanoProject!.id}/editor`, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => location.pathname.endsWith("/editor") && document.querySelectorAll(".editor-motion-clip").length === 6), "volcano sample remains editable despite Visual quality issues");
  const volcanoEditor = await page.evaluate(() => ({
    scenes: document.querySelectorAll(".editor-scene-item").length,
    beats: document.querySelectorAll(".editor-motion-clip").length,
     world: [...document.querySelectorAll(".editor-info-box strong")].find((item) => item.textContent?.includes("Shared VisualWorld"))?.textContent?.trim() ?? "",
    layers: [...document.querySelectorAll(".editor-advanced")].find((item) => item.querySelector("summary")?.textContent?.includes("Layer & peran Visual World"))?.querySelectorAll("li").length ?? 0,
    draftNotice: [...document.querySelectorAll(".editor-info-box span")].some((item) => item.textContent?.includes("Draft prosedural, bukan ilustrasi Flow final.")),
  }));
   assert.deepEqual(volcanoEditor, { scenes: 6, beats: 6, world: "Shared VisualWorld · 12 stable layer", layers: 12, draftNotice: true }, `sample opens with shared draft world, layer roles, and six beats: ${JSON.stringify(volcanoEditor)}`);
  await captureViewport("volcano-sample-visual-world-six-motion-beats.png");
  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>(".editor-motion-clip")[2]?.click());
  await waitFor(() => page.evaluate(() => document.querySelector('[data-motion-path-point="0"]') !== null), "volcano Motion Beat opens path handles without Flow artwork");
  const volcanoPathStart = await page.evaluate(() => document.querySelector<SVGCircleElement>('[data-motion-path-point="0"]')?.getAttribute("aria-valuetext") ?? "");
  await page.evaluate(() => {
    const handle = document.querySelector<SVGCircleElement>('[data-motion-path-point="0"]')!;
    handle.focus();
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  });
  await waitFor(() => page.evaluate((before) => document.querySelector<SVGCircleElement>('[data-motion-path-point="0"]')?.getAttribute("aria-valuetext") !== before, volcanoPathStart), "volcano draft path supports keyboard editing");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Tersimpan"), "volcano Motion Beat edit saves");
  const volcanoSaved = await fetch(`${apiUrl}/api/projects/${volcanoProject!.id}`).then((response) => response.json());
  assert.equal(volcanoSaved.visualStoryboard.scenes.reduce((count: number, scene: { motionActions: unknown[] }) => count + scene.motionActions.length, 0), 6, "all six sample beats persist");
  assert.ok(volcanoSaved.visualStoryboard.scenes.every((scene: { composition: unknown }) => JSON.stringify(scene.composition) === JSON.stringify(volcanoSaved.visualStoryboard.visualWorld.composition)), "all sample scenes persist same shared world");
  assert.notEqual(volcanoSaved.visualStoryboard.scenes[2].motionActions[0].path[0].x, 535, "sample path edit persists without an image asset");
  await page.goto({ url: viteUrl, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".project-card-open").length >= 2), "dashboard before volcano sample reload");
  await clickProject(volcanoTitle);
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".editor-motion-clip").length === 6), "reloaded volcano editor shows all six Motion Beats");
  const volcanoReloaded = await fetch(`${apiUrl}/api/projects/${volcanoProject!.id}`).then((response) => response.json());
  assert.equal(volcanoReloaded.visualStoryboard.scenes[2].motionActions[0].path[0].x, volcanoSaved.visualStoryboard.scenes[2].motionActions[0].path[0].x, "edited volcano path survives project reload");
   assert.ok(await page.evaluate(() => [...document.querySelectorAll(".editor-info-box strong")].some((item) => item.textContent?.includes("Shared VisualWorld"))), "shared draft Visual World remains visible after reload");
  console.log(`PASS: Remotion editor scene switch, scrub, Flow prompt/style-lock/import/batch/reload, shared Visual World persistence, Motion Beat timeline/path editing, raster transform/motion preview, approval, fact review, full preview, MP4 fixture, and volcano sample direct-to-editor persistence. Evidence: ${evidenceDir}`);
} finally {
  for (const projectId of projectIds.reverse()) {
    try { await fetch(`${apiUrl}/api/projects/${projectId}`, { method: "DELETE" }); } catch { /* isolated test server may already be stopped */ }
  }
  if (exportAssetPath) await rm(exportAssetPath, { force: true });
  if (browser) await browser.close({ silent: true });
  await stop(viteServer);
  await stop(apiServer);
  await rm(tempDir, { recursive: true, force: true });
}
