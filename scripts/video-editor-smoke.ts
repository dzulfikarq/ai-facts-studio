import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openBrowser } from "@remotion/renderer";
import { DatabaseSync } from "node:sqlite";
import { applyVisualStoryboard, visualStoryboardQualityGate } from "../src/domain/visual-storyboard";
import { buildManualResearchPackage } from "../src/domain/manual-project";
import { seedVolcanoVisualSample } from "../src/domain/volcano-visual-sample";

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
  env: { ...process.env, NODE_ENV: "test", STORY_GENERATION_TEST_MOCK_AI: "true", STORY_GENERATION_TEST_MOCK_SETTINGS: "true", HOST: "127.0.0.1", PORT: String(apiPort), VITE_PORT: String(vitePort), DATA_DIR: path.join(tempDir, "data"), DAILY_JOB_LIMIT: "1", TTS_MOCK_PROVIDER: "0", GEMINI_API_KEY: "", HF_TOKEN: "", HF_IMAGE_GENERATION_ENABLED: "false", HF_IMAGE_ALLOW_PAID: "false", OPENCODE_SERVER_URL: "http://127.0.0.1:4096" },
  stdio: ["ignore", "pipe", "pipe"],
});
for (const stream of [apiServer.stdout, apiServer.stderr]) stream?.on("data", (chunk: Buffer) => {
  apiLogs.push(...chunk.toString().split(/\r?\n/).filter(Boolean));
  if (apiLogs.length > 40) apiLogs.splice(0, apiLogs.length - 40);
});
let viteServer: ChildProcess | undefined;
let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;

function generationAttemptCount() {
  const db = new DatabaseSync(path.join(tempDir, "data", "ai-facts-studio.sqlite"));
  try { return (db.prepare("SELECT COUNT(*) AS count FROM ai_generation_attempts").get() as { count: number }).count; }
  finally { db.close(); }
}

try {
  await waitFor(async () => {
    if (apiServer.exitCode !== null) throw new Error(`API exited ${apiServer.exitCode}; recent logs:\n${apiLogs.slice(-20).join("\n")}`);
    try { return (await fetch(`${apiUrl}/api/status`)).ok; } catch { return false; }
  }, "API startup", 150);
  viteServer = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], {
    cwd: root,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(apiPort), VITE_PORT: String(vitePort) },
    stdio: "ignore",
  });
  await waitFor(async () => { try { return (await fetch(`${viteUrl}/api/status`)).ok; } catch { return false; } }, "Vite startup");

  const mountain = JSON.parse(await readFile(path.join(root, "samples/mountain-formation.json"), "utf8"));
  const createProject = async (researchPackage: unknown, creationMode?: "manual") => {
    const response = await fetch(`${apiUrl}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage, ...(creationMode ? { creationMode, creationBrief: { deliveryStyle: "edukatif", additionalInstructions: "" } } : {}) }) });
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
  const exportProject = await createProject(oneScene, "manual");
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
  const flowMotionClipPath = path.join(tempDir, "flow-motion-fixture.mp4");
  await runLocal("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x2288cc:s=720x1280:r=30:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", "-y", flowMotionClipPath]);
  const flowMotionProject = await createProject(oneScene, "manual");
  const flowMotionUpload = new FormData();
  flowMotionUpload.append("media", new Blob([Uint8Array.from(await readFile(flowMotionClipPath))], { type: "video/mp4" }), "flow-motion-fixture.mp4");
  const flowMotionUploadResponse = await fetch(`${apiUrl}/api/projects/${flowMotionProject.id}/scenes/${flowMotionProject.researchPackage.scenes[0].id}/media`, { method: "POST", body: flowMotionUpload });
  assert.equal(flowMotionUploadResponse.status, 201, `synthetic Flow clip passes media validation: ${await flowMotionUploadResponse.clone().text()}`);
  const flowMotionMedia = (await flowMotionUploadResponse.json()).media;
  const flowMotionBoard = structuredClone(flowMotionProject.visualStoryboard);
  flowMotionBoard.scenes[0].sceneMedia = flowMotionMedia;
  flowMotionBoard.scenes[0].flowStatus = "illustration-imported";
  const flowMotionResearch = applyVisualStoryboard(flowMotionProject.researchPackage, flowMotionBoard);
  const flowMotionSave = await fetch(`${apiUrl}/api/projects/${flowMotionProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: flowMotionResearch, visualStoryboard: flowMotionBoard, narrationMode: "manual" }),
  });
  assert.equal(flowMotionSave.status, 200, `synthetic Flow clip attaches to its stable scene: ${await flowMotionSave.clone().text()}`);

  browser = await openBrowser("chrome", { logLevel: "error" });
  const page = await browser.newPage({ context: () => null, logLevel: "error", indent: 0, pageIndex: 0, onBrowserLog: () => {}, onLog: () => {} } as never);
  const captureViewport = async (filename: string) => {
    const client = (page as unknown as { _client: () => { send: (method: string, params?: Record<string, unknown>) => Promise<{ value: any }> } })._client();
    const viewport = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, width: window.innerWidth, height: window.innerHeight }));
    const image = (await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false, clip: { ...viewport, scale: 1 } })).value;
    await writeFile(path.join(evidenceDir, filename), Buffer.from(image.data, "base64"));
  };
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto({ url: viteUrl, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".project-card-open").length >= 2), "project dashboard");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLButtonElement>(".app-sidebar-link.active")?.textContent?.trim()), "Dashboard", "dashboard highlights its global sidebar item");
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".app-sidebar-link")].map((button) => button.textContent?.trim())), ["Dashboard", "AI Facts", "Story Series", "Series Library", "Drafts", "Video Queue", "Completed", "Settings", "Help & Support"], "sidebar matches reference navigation structure");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLButtonElement>(".app-sidebar-link:last-child")?.disabled), true, "unavailable Help & Support is not a fake live route");
  assert.equal(await page.evaluate(() => Boolean(document.querySelector(".app-sidebar-quota"))), true, "sidebar shows live render quota card");
  await page.goto({ url: `${viteUrl}/?section=queue`, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => document.querySelector(".dashboard-page h1")?.textContent === "Video Queue"), "Video Queue dashboard filter");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLButtonElement>(".app-sidebar-link.active")?.textContent?.trim()), "Video Queue", "Video Queue highlights its sidebar item");
  await page.goto({ url: `${viteUrl}/?section=completed`, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => document.querySelector(".dashboard-page h1")?.textContent === "Completed"), "Completed dashboard filter");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLButtonElement>(".app-sidebar-link.active")?.textContent?.trim()), "Completed", "Completed highlights its sidebar item");
  await page.goto({ url: `${viteUrl}/create`, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".create-page"))), "Create page uses global sidebar");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLButtonElement>(".app-sidebar-link.active")?.textContent?.trim()), "AI Facts", "Create highlights its global sidebar item");
  await page.goto({ url: `${viteUrl}/settings?section=appearance`, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".settings-page"))), "Settings page uses global sidebar");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLButtonElement>(".app-sidebar-link.active")?.textContent?.trim()), "Settings", "Settings highlights its global sidebar item");
  await page.goto({ url: viteUrl, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".project-card-open").length >= 2), "return to dashboard for series checks");
  const storySeriesJson = await readFile("fixtures/story-series/bilik-empat-episode-01.json", "utf8");
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto({ url: `${viteUrl}/series`, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".series-generation-start form") && document.querySelector(".series-estimate-panel"))), "Generate from Story dashboard cards");
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector("#saved-story-drafts .series-empty-state, #saved-story-drafts .series-draft-list") && document.querySelector("#series-library .series-library-empty, #series-library .series-library-summary-list"))), "Story Series drafts and library load");
  assert.equal(await page.evaluate(() => document.querySelector(".series-hero h1")?.textContent), "Story Series", "Story Series page shows reference hierarchy");
  assert.equal(await page.evaluate(() => Boolean(document.querySelector(".series-hero-banner .series-hero h1") && document.querySelector(".series-hero-banner .series-mode-switch") && document.querySelector(".series-hero-banner .series-clapperboard-body svg"))), true, "Story Series title, actions, and clapperboard share illustrated banner");
  const heroCardAlignment = await page.evaluate(() => {
    const hero = document.querySelector<HTMLElement>(".series-hero-copy")!.getBoundingClientRect();
    const card = document.querySelector<HTMLElement>(".series-source-form")!.getBoundingClientRect();
    return Math.round(hero.left - card.left);
  });
  assert.equal(heroCardAlignment, 0, "Story Series hero copy aligns with form card left edge");
  const estimateMetricGap = await page.evaluate(() => {
    const metrics = [...document.querySelectorAll<HTMLElement>(".series-estimate-metric")].map((item) => item.getBoundingClientRect());
    return Math.round(metrics[1]!.left - metrics[0]!.right);
  });
  assert.ok(estimateMetricGap >= 8, `production estimate cards have visible spacing: ${estimateMetricGap}px`);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector<HTMLElement>(".series-index-page")!).paddingTop), "38px", "Story Series top spacing matches shared desktop page spacing");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLButtonElement>('.series-mode-switch button[aria-pressed="true"]')?.textContent?.includes("Generate from Story")), true, "Generate from Story remains active default mode");
  assert.equal(await page.evaluate(() => document.querySelectorAll(".series-dashboard-aside > .series-panel").length), 3, "drafts, library, and live estimate occupy right dashboard column");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLButtonElement>(".app-sidebar-link.active")?.textContent?.trim()), "Story Series", "Story Series highlights its global sidebar item");
  const pairedControlHeights = await page.evaluate(() => {
    const heights = [...document.querySelectorAll<HTMLElement>(".series-source-form .series-form-grid")].map((grid) => [...grid.querySelectorAll<HTMLElement>("input,select,textarea")].map((control) => Math.round(control.getBoundingClientRect().height)));
    return [heights[0]!.slice(0, 2), heights[0]!.slice(2, 4), heights[1]!];
  });
  assert.deepEqual(pairedControlHeights, [[44, 44], [44, 44], [44, 44]], "paired source controls align to consistent heights");
  const languageDurationBounds = await page.evaluate(() => {
    const language = document.querySelector<HTMLInputElement>('.series-source-form input[pattern="[a-z]{2}-[A-Z]{2}"]')?.getBoundingClientRect();
    const duration = document.querySelector<HTMLInputElement>('.series-source-form input[type="number"][min="30"][max="120"]')?.getBoundingClientRect();
    return [
      language ? [Math.round(language.top), Math.round(language.bottom)] : null,
      duration ? [Math.round(duration.top), Math.round(duration.bottom)] : null,
    ];
  });
  assert.ok(languageDurationBounds[0]?.[0] === languageDurationBounds[1]?.[0] && languageDurationBounds[0]?.[1] === languageDurationBounds[1]?.[1], `language and duration controls align vertically: ${JSON.stringify(languageDurationBounds)}`);
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".app-sidebar-link")].find((button) => button.textContent?.trim() === "Series Library")?.click());
  await waitFor(() => page.evaluate(() => location.hash === "#series-library"), "Series Library sidebar section target");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".app-sidebar-link")].find((button) => button.textContent?.trim() === "Drafts")?.click());
  await waitFor(() => page.evaluate(() => location.hash === "#saved-story-drafts"), "Drafts sidebar section target");
  await page.evaluate(() => { history.replaceState(history.state, "", "/series"); window.scrollTo(0, 0); });
  assert.equal(await page.evaluate(() => document.querySelector<HTMLSelectElement>('.series-form-field select')?.value), "cinematic-2d-motion-comic", "new story source defaults to locked hand-painted 2D horror style");
  assert.equal(await page.evaluate(() => [...document.querySelectorAll<HTMLOptionElement>('.series-form-field select option')].some((option) => option.value === "stylized-3d-cartoon")), false, "Generate from Story does not offer 3D style fallback");
  await page.setViewport({ width: 1672, height: 941, deviceScaleFactor: 1 });
  await captureViewport("story-series-reference-1672x941.png");
  const selectTheme = async (theme: "Light" | "Dark" | "System") => page.evaluate((label) => {
    const menu = document.querySelector<HTMLDetailsElement>(".theme-switcher");
    if (!menu?.open) menu?.querySelector("summary")?.click();
    [...(menu?.querySelectorAll<HTMLButtonElement>(".theme-choices button") ?? [])].find((button) => button.title === `${label} theme`)?.click();
    if (menu) menu.open = false;
  }, theme);
  await selectTheme("Dark");
  await waitFor(() => page.evaluate(() => document.documentElement.dataset.theme === "dark"), "Story Series dark theme applies");
  await captureViewport("story-series-dark-1672x941.png");
  await selectTheme("System");
  await waitFor(() => page.evaluate(() => document.documentElement.dataset.themePreference === "system"), "Story Series returns to system theme");
  for (const { width, height } of [{ width: 1440, height: 900 }, { width: 1024, height: 900 }, { width: 768, height: 900 }, { width: 375, height: 844 }, { width: 320, height: 844 }]) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    const layout = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      columns: getComputedStyle(document.querySelector<HTMLElement>(".series-dashboard-grid")!).gridTemplateColumns.split(" ").length,
      gutters: [parseFloat(getComputedStyle(document.querySelector<HTMLElement>(".series-index-page")!).marginLeft), parseFloat(getComputedStyle(document.querySelector<HTMLElement>(".series-index-page")!).marginRight)],
      expectedGutter: Math.min(56, Math.max(18, window.innerWidth * 0.04)),
    }));
    assert.equal(layout.scrollWidth <= width, true, `Story Series dashboard has no horizontal overflow at ${width}px: ${JSON.stringify(layout)}`);
    assert.equal(layout.columns, width <= 1024 ? 1 : 2, `Story Series dashboard uses expected columns at ${width}px`);
    assert.ok(layout.gutters.every((gutter) => Math.abs(gutter - layout.expectedGutter) < 0.1), `Story Series uses shared page gutters at ${width}px: ${JSON.stringify(layout)}`);
    if (width === 375) {
      const illustration = await page.evaluate(() => {
        const banner = document.querySelector<HTMLElement>(".series-hero-banner")!.getBoundingClientRect();
        const clapper = document.querySelector<HTMLElement>(".series-clapperboard")!.getBoundingClientRect();
        const hero = document.querySelector<HTMLElement>(".series-hero-copy")!.getBoundingClientRect();
        const card = document.querySelector<HTMLElement>(".series-source-form")!.getBoundingClientRect();
        return { visibleWidth: clapper.width, bounds: [clapper.left, clapper.right], banner: [banner.left, banner.right], withinBanner: clapper.left >= banner.left && clapper.right <= banner.right, heroCardOffset: Math.round(hero.left - card.left) };
      });
      assert.ok(illustration.visibleWidth >= 60 && illustration.withinBanner, `mobile clapperboard remains visible without crop: ${JSON.stringify(illustration)}`);
      assert.equal(illustration.heroCardOffset, 0, "mobile Story Series hero aligns with form card left edge");
    }
    if (width === 1440) await captureViewport("story-series-1440x900.png");
    if (width === 1024) await captureViewport("story-series-1024x900.png");
    if (width === 768) await captureViewport("story-series-768x900.png");
    if (width === 375) await captureViewport("story-series-375x844.png");
  }
  await page.setViewport({ width: 1672, height: 941, deviceScaleFactor: 1 });
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".series-empty-state button")?.click());
  await waitFor(() => page.evaluate(() => document.activeElement?.id === "series-story-text"), "empty-state action focuses story textarea");
  await page.evaluate(() => {
    const duration = document.querySelectorAll<HTMLInputElement>(".series-source-form input[type=number]")[0]!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(duration, "40");
    duration.dispatchEvent(new Event("input", { bubbles: true }));
    duration.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".series-estimate-metric")[1]?.textContent?.includes("5 klip")), "production estimate follows form duration");
  await page.evaluate(() => {
    const duration = document.querySelectorAll<HTMLInputElement>(".series-source-form input[type=number]")[0]!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(duration, "62");
    duration.dispatchEvent(new Event("input", { bubbles: true }));
    duration.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".series-estimate-metric")[1]?.textContent?.includes("8 klip")), "estimate resets to live default before source save");
  await page.evaluate(() => {
    const title = document.querySelector<HTMLInputElement>("#series-story-title")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(title, "Mode switch preserves draft");
    title.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".series-mode-switch button")].find((button) => button.textContent?.startsWith("Import JSON"))?.click());
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".series-import-panel:not([hidden])"))), "Import JSON mode remains functional");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".series-empty-state button")?.click());
  await waitFor(() => page.evaluate(() => document.activeElement?.id === "series-story-text"), "empty-state action switches mode and focuses story textarea");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLInputElement>("#series-story-title")?.value), "Mode switch preserves draft", "switching JSON mode preserves unsaved Story form state");
  const storyAiAttemptsBeforeBrowser = generationAttemptCount();
  await page.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>(".series-generation-start form")!;
    const title = form.querySelector<HTMLInputElement>(".series-form-field input")!;
    const source = form.querySelectorAll<HTMLTextAreaElement>(".series-form-field textarea")[0]!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(title, "Browser mock story");
    title.dispatchEvent(new Event("input", { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(source, "A short source story. A door opens; the protagonist resolves the source-supported conflict.");
    source.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".series-generation-start button")].find((button) => button.type === "submit")?.click());
  await waitFor(() => page.evaluate(() => location.pathname.startsWith("/series/generate/") && Boolean(document.querySelector(".series-source-copy"))), "durable source story workspace route");
  assert.equal(await page.evaluate(() => document.querySelector(".series-source-copy")?.textContent?.includes("A short source story.")), true, "workspace shows preserved original source");
  const clickStoryAction = async (label: string) => {
    const clicked = await page.evaluate((text) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim().startsWith(text) && !item.disabled);
      button?.click();
      return Boolean(button);
    }, label);
    assert.equal(clicked, true, `Story workflow action available: ${label}`);
  };
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector<HTMLSelectElement>(".series-ai-controls select")?.value)), "test-only mock AI provider setting");
  await clickStoryAction("Analisis Cerita");
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".series-plan-card .series-form-field input"))), "mock analysis episode-plan preview");
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(".series-plan-card .series-form-field input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "Browser reviewed episode");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await clickStoryAction("Setujui Episode Plan");
  await waitFor(() => page.evaluate(() => Boolean([...document.querySelectorAll("h2")].find((heading) => heading.textContent === "Story Bible"))), "approved plan Story Bible stage");
  await clickStoryAction("Generate Story Bible");
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector<HTMLTextAreaElement>('.series-json-field textarea')?.value.includes('"story-bible.v1"'))), "mock Story Bible candidate");
  await clickStoryAction("Saya sudah meninjau · Setujui Story Bible");
  await waitFor(() => page.evaluate(() => Boolean([...document.querySelectorAll("h2")].find((heading) => heading.textContent === "Generate Selected Episode"))), "approved Story Bible episode stage");
  await clickStoryAction("Generate Episode 1");
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".series-plan-card .series-form-field textarea").length === 24), "eight scenes with editable Flow, negative, and reference prompts");
  const browserFlowPrompts = await page.evaluate(() => [...document.querySelectorAll<HTMLLabelElement>(".series-plan-card .series-form-field")].filter((label) => label.textContent?.includes("Google Flow animation prompt")).map((label) => label.querySelector("textarea")?.value ?? ""));
  assert.equal(browserFlowPrompts.length, 8);
  assert.ok(browserFlowPrompts.every((prompt) => prompt.includes("hand-painted") && prompt.includes("No 3D")), "mock browser prompts keep 2D style lock");
  await captureViewport("story-generation-episode-review.png");
  await page.evaluate(() => {
    const label = [...document.querySelectorAll<HTMLLabelElement>(".series-plan-card .series-form-field")].find((item) => item.textContent?.includes("Google Flow animation prompt"))!;
    const prompt = label.querySelector<HTMLTextAreaElement>("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(prompt, `${prompt.value} Browser-reviewed prompt edit.`);
    prompt.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await clickStoryAction("Simpan draft & prompt");
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll(".workflow-alert.success")].some((item) => item.textContent?.includes("Episode draft dan prompt tersimpan"))), "persisted editable Flow prompt");
  assert.equal(generationAttemptCount(), storyAiAttemptsBeforeBrowser, "mock Development workflow makes no Gemini request or credit call");
  const generationUrl = await page.evaluate(() => location.href);
  await page.goto({ url: generationUrl, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".series-source-copy") && document.querySelector(".series-plan-card .series-form-field textarea"))), "reloaded story, plan, and episode draft");
  assert.equal(await page.evaluate(() => [...document.querySelectorAll<HTMLLabelElement>(".series-plan-card .series-form-field")].find((label) => label.textContent?.includes("Google Flow animation prompt"))?.querySelector("textarea")?.value.includes("Browser-reviewed prompt edit")), true, "Flow prompt edit survives browser reload");
  for (const width of [390, 360, 320]) {
    await page.setViewport({ width, height: 844, deviceScaleFactor: 1 });
    const pageWidth = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      offenders: [...document.querySelectorAll<HTMLElement>("body *")].map((element) => ({ name: `${element.tagName.toLowerCase()}.${String(element.className).replace(/\s+/g, ".")}`, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width })).filter((element) => element.right > window.innerWidth).sort((a, b) => b.right - a.right).slice(0, 5),
      bounds: ["body", ".app-shell", "main", ".page", ".series-page", ".series-panel"].map((selector) => { const element = document.querySelector<HTMLElement>(selector); if (!element) return { selector, missing: true }; const rect = element.getBoundingClientRect(); return { selector, left: rect.left, right: rect.right, width: rect.width, boxSizing: getComputedStyle(element).boxSizing, padding: getComputedStyle(element).padding, margin: getComputedStyle(element).margin, minWidth: getComputedStyle(element).minWidth }; }),
    }));
    assert.equal(pageWidth.scrollWidth <= width, true, `Generate from Story has no horizontal overflow at ${width}px: ${JSON.stringify(pageWidth)}`);
    if (width === 390) await captureViewport("story-generation-mobile.png");
  }

  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto({ url: `${viteUrl}/series`, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".series-mode-switch"))), "Story Series mode selector");
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".series-draft-item") && document.querySelector(".series-library-summary-item"))), "saved draft and library cards use persisted records");
  assert.equal(await page.evaluate(() => document.querySelector(".series-draft-item")?.textContent?.includes("Browser mock story")), true, "saved drafts display actual generation data");
  await captureViewport("story-series-populated-1440x1000.png");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".series-mode-switch button")].find((button) => button.textContent?.startsWith("Import JSON"))?.click());
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector<HTMLTextAreaElement>(".series-json-field textarea"))), "Story Series import preview page");
  await page.evaluate((json) => {
    const input = document.querySelector<HTMLTextAreaElement>(".series-json-field textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, json);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, storySeriesJson);
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".series-flow-prompt-list textarea").length === 8), "all eight Story Series Flow prompt previews");
  const storyPrompts = await page.evaluate(() => [...document.querySelectorAll<HTMLTextAreaElement>(".series-flow-prompt-list textarea")].map((input) => input.value));
  assert.ok(storyPrompts.every((prompt) => prompt.includes("Traditional flat 2D hand-painted horror animation") && prompt.includes("Absolutely no 3D rendering, CGI")), "import preview applies the hand-painted anti-CGI lock to all eight prompts");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLButtonElement>(".series-import-preview .button-primary")?.disabled), false, "episode import stays available after prompt preview is built");
  for (const width of [390, 360, 320]) {
    await page.setViewport({ width, height: 844, deviceScaleFactor: 1 });
    const pageWidth = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      offenders: [...document.querySelectorAll<HTMLElement>("body *")].map((element) => ({ name: `${element.tagName.toLowerCase()}.${String(element.className).replace(/\s+/g, ".")}`, right: Math.round(element.getBoundingClientRect().right), width: Math.round(element.getBoundingClientRect().width) }))
        .filter((element) => element.right > window.innerWidth + 1).sort((a, b) => b.right - a.right).slice(0, 5),
    }));
    assert.equal(pageWidth.scrollWidth <= width, true, `Story Series prompt preview has no horizontal overflow at ${width}px: ${JSON.stringify(pageWidth)}`);
  }
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto({ url: viteUrl, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".project-card-open").length >= 2), "return to project dashboard without importing preview");

  const clickProject = async (title: string) => {
    const found = await page.evaluate((projectTitle) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>(".project-card-open")].find((item) => item.getAttribute("aria-label")?.includes(projectTitle));
      button?.click();
      return Boolean(button);
    }, title);
    assert.equal(found, true, `project card exists: ${title}`);
    await waitFor(() => page.evaluate((projectTitle) => document.querySelector<HTMLInputElement>('.workspace-heading .title-input, .video-editor-title input')?.value === projectTitle, title), `open ${title}`);
    if (!await page.evaluate(() => Boolean(document.querySelector(".video-editor-v2")))) {
      await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="video-editor"]')?.click());
    }
    await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".video-editor-v2"))), `editor for ${title}`);
  };
  const clickEditorProject = async (title: string) => {
    await clickProject(title);
    if (!await page.evaluate(() => location.pathname.endsWith("/editor"))) {
      await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Lanjut ke Review"))?.click());
    }
    await waitFor(() => page.evaluate(() => location.pathname.endsWith("/editor") && document.querySelectorAll(".editor-inspector-tabs button").length === 6), `project opens unified Video Editor: ${title}`);
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
  const setFormValue = async (selector: string, value: string) => page.evaluate(({ query, nextValue }) => {
    const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(query);
    if (!input) return false;
    Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")?.set?.call(input, nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, { query: selector, nextValue: value });
  const assertResponsiveNoOverflow = async (view: string) => {
    for (const width of [1440, 1280, 1024, 768, 390, 375, 360, 320]) {
      await page.setViewport({ width, height: width <= 390 ? 844 : 900, deviceScaleFactor: 1 });
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const metrics = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        createColumns: document.querySelector<HTMLElement>(".create-workspace-grid") ? getComputedStyle(document.querySelector<HTMLElement>(".create-workspace-grid")!).gridTemplateColumns.trim().split(/\s+/).length : 0,
        styleColumns: document.querySelector<HTMLElement>(".animation-style-grid") ? getComputedStyle(document.querySelector<HTMLElement>(".animation-style-grid")!).gridTemplateColumns.trim().split(/\s+/).length : 0,
        createTopOffsets: (() => { const form = document.querySelector(".create-primary-column")?.getBoundingClientRect(); const options = document.querySelector(".create-options-column")?.getBoundingClientRect(); return form && options ? [form.top, options.top] : null; })(),
        offenders: [...document.querySelectorAll<HTMLElement>("body *")].filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.right > innerWidth + 1;
        }).slice(0, 8).map((element) => ({ tag: element.tagName, className: typeof element.className === "string" ? element.className : "", right: Math.round(element.getBoundingClientRect().right), width: Math.round(element.getBoundingClientRect().width) })),
      }));
      if (view === "Settings" && width === 360) await captureViewport("settings-360px.png");
      assert.ok(metrics.scrollWidth <= metrics.width, `${view} overflows at ${width}px: ${JSON.stringify(metrics)}`);
      if (view === "Create Video") {
        assert.equal(metrics.createColumns, width <= 900 ? 1 : 2, `Create Video uses expected columns at ${width}px`);
        assert.equal(metrics.styleColumns, width <= 560 ? 1 : 2, `animation styles use expected columns at ${width}px`);
        if (width > 900) assert.ok(metrics.createTopOffsets && Math.abs(metrics.createTopOffsets[0] - metrics.createTopOffsets[1]) < 1, `Create Video columns align at ${width}px`);
        if ([1024, 768, 375, 320].includes(width)) await captureViewport(`create-${width}px.png`);
      }
    }
  };

  await captureViewport("dashboard-light-desktop.png");
  await assertResponsiveNoOverflow("dashboard");
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".app-sidebar-link")].find((button) => button.textContent?.trim() === "AI Facts")?.click());
  await waitFor(() => page.evaluate(() => location.pathname === "/create" && document.querySelector(".ai-generate-panel") !== null), "Create Video route");
  await captureViewport("create-light-desktop.png");
  await assertResponsiveNoOverflow("Create Video");
  assert.equal(await page.evaluate(() => Boolean(document.querySelector(".create-heading-actions,.create-hero-art") || [...document.querySelectorAll<HTMLButtonElement>("button")].some((button) => button.textContent?.includes("Gunakan sample gunung api")))), false, "Create Video omits unused header art and sample shortcut");
  assert.equal(await page.evaluate(() => {
    const aiAdvanced = document.querySelector(".ai-advanced-flow")?.closest(".create-primary-column");
    const importAdvanced = document.querySelector(".create-import-advanced")?.closest(".create-options-column");
    return Boolean(aiAdvanced && importAdvanced);
  }), true, "Create Video places each Advanced workflow in its matching column");
  await page.evaluate(() => { const details = document.querySelector<HTMLDetailsElement>(".create-import-advanced"); if (details) details.open = true; });
  assert.equal(await page.evaluate(() => Boolean(document.querySelector(".create-import-advanced[open] .json-editor"))), true, "Research Package import accordion opens in options column");
  await page.evaluate(() => { const details = document.querySelector<HTMLDetailsElement>(".create-import-advanced"); if (details) details.open = false; });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await captureViewport("create-light-mobile.png");
  await page.evaluate(() => { const gallery = document.querySelector(".animation-style-gallery"); if (gallery) window.scrollTo(0, window.scrollY + gallery.getBoundingClientRect().top - 76); });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await captureViewport("create-gallery-mobile.png");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  assert.equal(await page.evaluate(() => document.querySelectorAll(".animation-style-card").length), 7, "Create Video renders all seven animation styles");
  assert.equal(await page.evaluate(() => document.querySelectorAll(".animation-style-card .animation-style-choice").length), 7, "each style has one selection control");
  assert.equal(await page.evaluate(() => document.querySelector('.animation-style-card.selected')?.getAttribute("data-animation-style-id")), "expressive-2d-cartoon", "expressive 2D is selected by default");
  assert.equal(await page.evaluate(() => document.querySelectorAll(".animation-style-card img, .animation-style-card video, .animation-style-dialog, .animation-style-preview-button").length), 0, "style gallery has no poster or preview controls");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('.animation-style-card[data-animation-style-id="stylized-3d-cartoon"] .animation-style-choice')?.click());
  assert.equal(await page.evaluate(() => document.querySelector('.animation-style-card.selected')?.getAttribute("data-animation-style-id")), "stylized-3d-cartoon", "style card selection updates selected state");
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector<HTMLInputElement>(".ai-topic-field input") && !document.querySelector<HTMLInputElement>(".ai-topic-field input")!.disabled && document.querySelector(".ai-advanced-flow"))), "manual AI workflow controls are ready");
  const generatedSmokeTitle = `Auto-create smoke ${randomUUID().slice(0, 8)}`;
  assert.equal(await setFormValue(".ai-topic-field input", generatedSmokeTitle), true, "manual AI workflow accepts topic input");
  const manualSmokeTitle = `Manual create smoke ${randomUUID().slice(0, 8)}`;
  const selectCreationMode = async (label: string) => {
    const found = await page.evaluate((value) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>(".create-mode-switch button")].find((item) => item.textContent?.includes(value));
      button?.click();
      return Boolean(button);
    }, label);
    if (!found) return false;
    await waitFor(() => page.evaluate((value) => [...document.querySelectorAll<HTMLButtonElement>(".create-mode-switch button")].some((button) => button.textContent?.includes(value) && button.getAttribute("aria-pressed") === "true"), label), `${label} mode selected`);
    return true;
  };
  assert.equal(await selectCreationMode("Buat Manual"), true, "manual creation mode can be selected");
  assert.equal(await page.evaluate(() => document.querySelector('.animation-style-card.selected')?.getAttribute("data-animation-style-id")), "stylized-3d-cartoon", "animation style selection survives switching to Manual");
  await waitFor(() => page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".manual-create-panel");
    return Boolean(panel && !panel.closest("[hidden]") && getComputedStyle(panel).display !== "none");
  }), "manual creation form");
  await waitFor(() => page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>(".manual-create-panel button[type='submit']");
    return Boolean(button && !button.disabled && button.textContent?.trim() === "Buat Project Manual");
  }), "manual create button is ready and labeled");
  await page.setViewport({ width: 1440, height: 1400, deviceScaleFactor: 1 });
  await captureViewport("create-manual-light-desktop.png");
  await assertResponsiveNoOverflow("Manual Create Video");
  await page.setViewport({ width: 1440, height: 1400, deviceScaleFactor: 1 });
  await page.evaluate(() => {
    const switcher = document.querySelector<HTMLDetailsElement>(".theme-switcher")!;
    switcher.open = true;
    [...switcher.querySelectorAll<HTMLButtonElement>(".theme-choices button")].find((button) => button.textContent?.trim() === "Dark")?.click();
  });
  await waitFor(() => page.evaluate(() => document.documentElement.dataset.theme === "dark"), "Manual form supports Dark theme");
  await page.evaluate(() => { document.querySelector<HTMLDetailsElement>(".theme-switcher")!.open = false; });
  await captureViewport("create-manual-dark-desktop.png");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".theme-choices button")].find((button) => button.textContent?.trim() === "System")?.click());
  await waitFor(() => page.evaluate(() => document.documentElement.dataset.themePreference === "system"), "Manual form restores System theme");
  assert.equal(await page.evaluate(() => document.querySelectorAll(".manual-create-panel .ai-form-grid > .ai-topic-field, .manual-create-panel .ai-form-grid > .ai-choice-field, .manual-create-panel .ai-form-grid > .ai-instructions-field").length), 5, "manual form exposes five main inputs");
  assert.equal(await setFormValue(".manual-create-panel .ai-topic-field input", manualSmokeTitle), true, "manual mode accepts project topic");
  assert.equal(await setFormValue(".manual-create-panel .ai-instructions-field textarea", "Catatan brief manual."), true, "manual mode accepts additional instructions");
  assert.equal(await setFormValue(".manual-create-panel .ai-source-field textarea", "https://example.org/manual-source"), true, "manual source URL uses shared AI form field");
  assert.equal(await selectCreationMode("Generate with AI"), true, "AI mode remains selectable");
  assert.equal(await page.evaluate(() => document.querySelector('.animation-style-card.selected')?.getAttribute("data-animation-style-id")), "stylized-3d-cartoon", "animation style selection survives switching to AI");
  assert.equal(await page.evaluate((title) => document.querySelector<HTMLInputElement>(".ai-topic-field input")?.value === title, generatedSmokeTitle), true, "AI input survives switching modes");
  assert.equal(await selectCreationMode("Buat Manual"), true, "manual mode can be reselected");
  assert.equal(await page.evaluate((title) => document.querySelector<HTMLInputElement>(".manual-create-panel .ai-topic-field input")?.value === title, manualSmokeTitle), true, "manual input survives switching modes");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLTextAreaElement>(".manual-create-panel .ai-source-field textarea")?.value === "https://example.org/manual-source"), true, "manual source survives switching modes");
  const aiAttemptsBeforeManualCreate = generationAttemptCount();
  await page.evaluate(() => {
    const submit = document.querySelector<HTMLButtonElement>(".manual-create-panel button[type='submit']");
    submit?.click();
    submit?.click();
  });
  await waitFor(() => page.evaluate(() => location.pathname.startsWith("/projects/") && Boolean(document.querySelector(".workflow-stepper"))), "manual create opens Materials & Storyboard");
  const manualProjects = await fetch(`${apiUrl}/api/projects`).then((response) => response.json()).then((projects: Array<any>) => projects.filter((item) => item.researchPackage.title === manualSmokeTitle));
  assert.equal(manualProjects.length, 1, "manual double submit creates exactly one project");
  const manualProject = manualProjects[0]!;
  projectIds.push(manualProject.id);
  assert.equal(manualProject.creationMode, "manual");
  assert.equal(manualProject.animationStyleId, "stylized-3d-cartoon", "Manual Create persists selected style ID");
  assert.equal(manualProject.creationBrief.additionalInstructions, "Catatan brief manual.");
  assert.equal(manualProject.researchPackage.scenes.length, 1, "manual project starts with one schema-compatible placeholder");
  assert.equal(manualProject.researchPackage.scenes[0].onScreenText, "");
  assert.equal(manualProject.researchPackage.scenes[0].visualDescription, "");
  assert.equal(manualProject.researchPackage.references[0].checkedAt, undefined, "manual source remains unverified");
  assert.equal(manualProject.audio, null);
  assert.deepEqual(manualProject.visualAssets, []);
  assert.ok(manualProject.visualStoryboard.scenes.every((scene: { approved: boolean }) => !scene.approved));
  assert.equal(generationAttemptCount(), aiAttemptsBeforeManualCreate, "manual project create makes no AI research-generation request");
  await page.goto({ url: `${viteUrl}/projects/${manualProject.id}`, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".scene-editor") && document.querySelectorAll(".scene-row").length === 1)), "manual project reload restores Materials & Storyboard");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLButtonElement>(".app-sidebar-link.active")?.textContent?.trim()), "Dashboard", "project workspace keeps global sidebar and parent item active");
  const originalManualSceneId = manualProject.researchPackage.scenes[0].id as string;
  await clickButton(".storyboard-actions button", "add scene to manual project");
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".scene-row").length === 2), "manual scene appears");
  await waitFor(() => page.evaluate((sceneId) => document.querySelector<HTMLButtonElement>(".scene-row.chosen")?.dataset.sceneId !== sceneId, originalManualSceneId), "new manual scene becomes selected");
  const addedManualSceneId = await page.evaluate(() => document.querySelector<HTMLButtonElement>(".scene-row.chosen")?.dataset.sceneId ?? "");
  assert.ok(addedManualSceneId && addedManualSceneId !== originalManualSceneId, "manual scene receives a stable ID");
  assert.equal(await setFormValue(".basic-content-section label:nth-of-type(1) input", "Scene manual kedua"), true, "manual scene on-screen text is editable");
  assert.equal(await setFormValue(".basic-content-section label:nth-of-type(2) textarea", "Narasi ditulis pengguna untuk scene kedua."), true, "manual scene narration is editable");
  await page.evaluate(() => { const advanced = document.querySelector<HTMLDetailsElement>(".advanced-editor"); if (advanced) advanced.open = true; });
  assert.equal(await setFormValue(".advanced-scene-section textarea", "Visual direction manual untuk scene kedua."), true, "manual visual direction is editable");
  await page.evaluate(() => { const advanced = document.querySelector<HTMLDetailsElement>(".reference-add-details"); if (advanced) advanced.open = true; });
  assert.equal(await setFormValue(".reference-add-details label:nth-of-type(1) input", "Sumber manual"), true, "manual reference title is editable");
  assert.equal(await setFormValue(".reference-add-details label:nth-of-type(2) input", "Example Publisher"), true, "manual reference publisher is editable");
  assert.equal(await setFormValue(".reference-add-details label:nth-of-type(3) input", "https://example.org/manual-source"), true, "manual reference URL is editable");
  await clickButton(".reference-add-details form button", "add manual reference");
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".reference-item .reference-actions button"))), "manual reference appears");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".reference-item .reference-actions button")?.click());
  assert.equal(await setFormValue(".reference-item form input", "Sumber manual diedit"), true, "manual reference can be edited");
  await clickButton(".reference-item form button[type='submit']", "save manual reference edit");
  await waitFor(() => page.evaluate(() => document.querySelector(".reference-item strong")?.textContent === "Sumber manual diedit"), "manual reference edit persists in draft");
  await page.evaluate(() => document.querySelector<HTMLInputElement>(".scene-reference-picker input")?.click());
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('.scene-reorder-actions button[aria-label="Pindahkan scene 2 ke atas"]')?.click());
  await waitFor(() => page.evaluate((sceneId) => document.querySelector<HTMLButtonElement>(".scene-row")?.dataset.sceneId === sceneId, addedManualSceneId), "manual scene reorder updates the stable-ID list");
  await clickButton('button[aria-label="Simpan perubahan"]', "save manual storyboard and references");
  await waitFor(async () => {
    const saved = await fetch(`${apiUrl}/api/projects/${manualProject.id}`).then((response) => response.json());
    return saved.researchPackage.scenes[0]?.id === addedManualSceneId && saved.researchPackage.scenes[0]?.referenceIds.length === 1 && saved.researchPackage.references[0]?.title === "Sumber manual diedit" && saved.researchPackage.references[0]?.checkedAt === undefined;
  }, "manual scene order, copy, and references persist");
  await waitFor(() => page.evaluate(() => !document.querySelector(".topbar-save")), "manual workspace save completes before reload");
  await page.goto({ url: `${viteUrl}/projects/${manualProject.id}`, timeout: 90_000 });
  await waitFor(() => page.evaluate((sceneId) => document.querySelector<HTMLButtonElement>(".scene-row")?.dataset.sceneId === sceneId, addedManualSceneId), "manual project reload restores reordered scene");
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".app-sidebar-link")].find((button) => button.textContent?.trim() === "AI Facts")?.disabled === false), "AI Facts navigation enabled after workspace reload");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".app-sidebar-link")].find((button) => button.textContent?.trim() === "AI Facts")?.click());
  await waitFor(() => page.evaluate(() => location.pathname === "/create" && Boolean(document.querySelector(".ai-generate-panel"))), "Create Video reopens after manual project");
  assert.equal(await page.evaluate(() => {
    const choice = document.querySelector<HTMLButtonElement>('.animation-style-card[data-animation-style-id="stylized-3d-cartoon"] .animation-style-choice');
    choice?.click();
    return Boolean(choice);
  }), true, "AI Create exposes 3D style after reopening the form");
  await waitFor(() => page.evaluate(() => document.querySelector('.animation-style-card.selected')?.getAttribute("data-animation-style-id") === "stylized-3d-cartoon"), "AI Create selects 3D style");
  assert.equal(await setFormValue(".ai-topic-field input", generatedSmokeTitle), true, "AI form remains usable after manual creation");
  await page.evaluate(() => { const details = document.querySelector<HTMLDetailsElement>(".ai-advanced-flow"); if (details) details.open = true; });
  await clickButton(".ai-manual-actions button", "manual prompt");
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".manual-prompt") && document.querySelector(".workflow-alert.attention")?.textContent?.includes("Menunggu output AI"))), "manual prompt enters waiting state");
  assert.equal(await setFormValue(".manual-prompt-result", "{"), true, "invalid output can be pasted");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".ai-manual-flow button")].find((button) => button.textContent?.includes("Validate & Create Project"))?.click());
  await waitFor(() => page.evaluate(() => Boolean(location.pathname === "/create" && document.querySelector(".workflow-alert.danger")?.textContent?.includes("Validation Failed"))), "invalid AI output stays in Generate with validation error");
  assert.equal(await page.evaluate(() => Boolean(document.querySelector(".ai-generation-form") && document.querySelector(".manual-prompt-result"))), true, "invalid output does not create a project or leave the form");
  assert.equal(await setFormValue(".manual-prompt-result", JSON.stringify(mountain)), true, "valid package can replace invalid output");
  await page.evaluate(() => {
    const submit = [...document.querySelectorAll<HTMLButtonElement>(".ai-manual-flow button")].find((button) => button.textContent?.includes("Validate & Create Project"));
    submit?.click();
    submit?.click();
  });
  await waitFor(() => page.evaluate(() => location.pathname.startsWith("/projects/") && document.querySelector(".workflow-stepper") !== null), "valid manual output auto-creates project and opens Materials");
  assert.notEqual(await page.evaluate(() => new URLSearchParams(location.search).get("step")), "visual", "AI auto-create opens Materials rather than Visual Storyboard");
  const generatedSmokeProjects = await fetch(`${apiUrl}/api/projects`).then((response) => response.json()).then((projects: Array<{ id: string; animationStyleId?: string; researchPackage: { title: string } }>) => projects.filter((project) => project.researchPackage.title === generatedSmokeTitle));
  assert.equal(generatedSmokeProjects.length, 1, "double submit creates only one project");
  projectIds.push(generatedSmokeProjects[0]!.id);
  assert.equal(generatedSmokeProjects[0]!.animationStyleId, "stylized-3d-cartoon", "AI Create persists selected style ID");
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".app-sidebar-link")].find((button) => button.textContent?.trim() === "Settings")?.click());
  await waitFor(() => page.evaluate(() => location.pathname === "/settings" && document.querySelector(".settings-page") !== null), "Settings route");
  await captureViewport("settings-light-desktop.png");
  await assertResponsiveNoOverflow("Settings");
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".app-sidebar-link")].find((button) => button.textContent?.trim() === "Dashboard")?.click());
  await waitFor(() => page.evaluate(() => location.pathname === "/" && document.querySelectorAll(".project-card-open").length >= 2), "return to dashboard");

  await clickProject(mountainProject.researchPackage.title);
  const editorRoute = await page.evaluate(() => ({ path: location.pathname, scene: new URLSearchParams(location.search).get("scene") }));
  assert.equal(editorRoute.path, `/projects/${mountainProject.id}/editor`, "Video Editor has one canonical project route");
  assert.equal(await page.evaluate(() => new URLSearchParams(location.search).get("step")), null, "Video Editor step uses its canonical route");
  assert.equal(editorRoute.scene, mountainProject.visualStoryboard.scenes[0].sceneId, "selected scene is URL-backed");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Pengaturan Video"))?.click());
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".editor-animation-style-controls select"))), "project-level animation style setting");
  assert.equal(await page.evaluate(() => document.querySelectorAll<HTMLSelectElement>(".editor-animation-style-controls select option").length), 7, "Video Editor project setting exposes all seven styles");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLSelectElement>(".editor-animation-style-controls select")?.value), "expressive-2d-cartoon", "legacy project uses default style without prompt migration");
  assert.equal(await setMotionControl(".editor-animation-style-controls select", "stylized-3d-cartoon"), true, "project-level style can be changed");
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() !== "Tersimpan"), "style update marks project unsaved");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Tersimpan"), "project animation style save completes");
  assert.equal((await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json())).animationStyleId, "stylized-3d-cartoon", "Video Editor style setting survives persistence");
  const stalePromptProject = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
  const stalePromptBoard = structuredClone(stalePromptProject.visualStoryboard);
  const stalePromptSceneIds = stalePromptBoard.scenes.slice(0, 2).map((scene: { sceneId: string }) => scene.sceneId);
  for (const [index, sceneId] of stalePromptSceneIds.entries()) {
    const sceneIndex = stalePromptBoard.scenes.findIndex((scene: { sceneId: string }) => scene.sceneId === sceneId);
    stalePromptBoard.scenes[sceneIndex] = { ...stalePromptBoard.scenes[sceneIndex], flowPrompt: `Old prompt ${index + 1} generated for expressive 2D.`, flowPromptMode: "animated-video", flowVisualMode: "animated-video", flowPromptAnimationStyleId: "expressive-2d-cartoon", flowStatus: "prompt-ready" };
  }
  assert.equal((await fetch(`${apiUrl}/api/projects/${mountainProject.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: stalePromptProject.researchPackage, visualStoryboard: stalePromptBoard, animationStyleId: "stylized-3d-cartoon" }) })).status, 200, "stale prompt fixture saves without changing style setting");
  await page.goto({ url: `${viteUrl}/projects/${mountainProject.id}/editor?scene=${encodeURIComponent(stalePromptSceneIds[0])}`, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".video-editor-v2"))), "reloaded editor reads stale prompt metadata");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Pengaturan Video"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-animation-style-stale")?.textContent?.includes("2 prompt lama") === true), "project settings show stale animation prompts");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-animation-style-stale button")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".confirm-submit")?.textContent?.includes("Buat ulang prompt") === true), "prompt regeneration requires explicit confirmation");
  assert.equal(await page.evaluate(() => document.querySelectorAll<HTMLTextAreaElement>(".flow-prompt-review textarea").length), 2, "confirmation previews every regenerated prompt before apply");
  assert.match(await page.evaluate(() => document.querySelector<HTMLTextAreaElement>(".flow-prompt-review textarea")?.value ?? ""), /stylized-3d-cartoon/);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".confirm-submit")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() !== "Tersimpan"), "regenerated prompt marks project unsaved");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Tersimpan"), "regenerated prompt save completes");
  await waitFor(async () => {
    const saved = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
    return stalePromptSceneIds.every((sceneId: string) => {
      const scene = saved.visualStoryboard.scenes.find((item: { sceneId: string }) => item.sceneId === sceneId);
      return scene?.flowPromptAnimationStyleId === "stylized-3d-cartoon" && !scene.flowPrompt.startsWith("Old prompt");
    });
  }, "batch stale animation prompts regenerate with new style");
  const regeneratedStyleProject = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
  for (const sceneId of stalePromptSceneIds) {
    const regenerated = regeneratedStyleProject.visualStoryboard.scenes.find((scene: { sceneId: string }) => scene.sceneId === sceneId);
    assert.match(regenerated.flowPrompt, /stylized-3d-cartoon/);
    assert.deepEqual(regenerated.composition, stalePromptBoard.scenes.find((scene: { sceneId: string }) => scene.sceneId === sceneId).composition, "prompt regeneration preserves existing visual composition");
    assert.equal(regenerated.approved, stalePromptBoard.scenes.find((scene: { sceneId: string }) => scene.sceneId === sceneId).approved, "prompt regeneration preserves visual approval");
  }
  assert.equal(regeneratedStyleProject.animationStyleId, "stylized-3d-cartoon", "prompt regeneration preserves project style");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('.editor-video-settings-heading button[aria-label="Tutup pengaturan video"]')?.click());
  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>(".editor-scene-item")[1]?.click());
  await waitFor(() => page.evaluate((sceneId) => new URLSearchParams(location.search).get("scene") === sceneId, mountainProject.visualStoryboard.scenes[1].sceneId), "scene selection updates URL");
  const restoredEditorUrl = await page.evaluate(() => location.href);
  await page.evaluate(() => history.back());
  await waitFor(() => page.evaluate((id) => location.pathname.endsWith(`/projects/${id}`) && document.querySelector(".workflow-stepper") !== null, mountainProject.id), "Back restores prior workspace step");
  await page.evaluate(() => history.forward());
  await waitFor(() => page.evaluate((id) => location.pathname === `/projects/${id}/editor` && document.querySelector(".video-editor-v2") !== null, mountainProject.id), "Forward restores Video Editor route");
  assert.equal(await page.evaluate(() => new URLSearchParams(location.search).get("scene")), mountainProject.visualStoryboard.scenes[1].sceneId, "Forward restores selected scene too");
  await page.evaluate((title) => {
    const input = document.querySelector<HTMLInputElement>(".video-editor-title input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, `${title} · draft`);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, mountainProject.researchPackage.title);
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() !== "Tersimpan"), "draft edit marks workspace unsaved");
  await page.evaluate(() => history.back());
  await waitFor(() => page.evaluate(() => !location.pathname.endsWith("/editor")), "Back first returns to prior workspace step");
  await page.evaluate(() => history.back());
  await waitFor(() => page.evaluate(() => document.querySelector('[role="dialog"] .confirm-cancel') !== null), "Back asks before leaving unsaved workspace");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[role="dialog"] .confirm-cancel')?.click());
  await waitFor(() => page.evaluate((id) => location.pathname === `/projects/${id}` && document.querySelector('[role="dialog"]') === null, mountainProject.id), "cancelled Back restores prior workspace route");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="video-editor"]')?.click());
  await waitFor(() => page.evaluate((id) => location.pathname === `/projects/${id}/editor` && document.querySelector(".video-editor-v2") !== null, mountainProject.id), "return to Video Editor after cancelling Back");
  await page.evaluate((title) => {
    const input = document.querySelector<HTMLInputElement>(".video-editor-title input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, title);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, mountainProject.researchPackage.title);
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Tersimpan"), "restore original title and save baseline project");
  await page.goto({ url: restoredEditorUrl, timeout: 90_000 });
  await waitFor(() => page.evaluate((sceneId) => new URLSearchParams(location.search).get("scene") === sceneId && document.querySelector(".video-editor-v2") !== null, mountainProject.visualStoryboard.scenes[1].sceneId), "direct Video Editor URL restores scene after reload");
  assert.equal(await page.evaluate(() => new URLSearchParams(location.search).get("scene")), mountainProject.visualStoryboard.scenes[1].sceneId);
  await page.goto({ url: `${viteUrl}/projects/${mountainProject.id}?step=render&scene=${mountainProject.visualStoryboard.scenes[1].sceneId}`, timeout: 90_000 });
  await waitFor(() => page.evaluate((id) => location.pathname === `/projects/${id}/editor` && document.querySelector(".video-editor-v2") !== null, mountainProject.id), "direct blocked Review step resolves through Video Editor guard");
  assert.equal(await page.evaluate(() => new URLSearchParams(location.search).get("scene")), mountainProject.visualStoryboard.scenes[1].sceneId, "workflow fallback retains selected scene");
  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>(".editor-scene-item")[0]?.click());
  await waitFor(() => page.evaluate((sceneId) => new URLSearchParams(location.search).get("scene") === sceneId, mountainProject.visualStoryboard.scenes[0].sceneId), "restore scene one for editor checks");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="materials"]')?.click());
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".workflow-stepper") && document.querySelector(".scene-editor"))), "Materials storyboard opens separately");
  const storyboardViewportWidths = [1440, 1280, 1024, 768, 390, 360, 320];
  for (const width of storyboardViewportWidths) {
    await page.setViewport({ width, height: width <= 390 ? 844 : 900, deviceScaleFactor: 1 });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const metrics = await page.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth, addRight: document.querySelector<HTMLButtonElement>(".storyboard-actions button")?.getBoundingClientRect().right ?? Infinity, deleteRight: document.querySelector<HTMLButtonElement>(".scene-editor-actions button")?.getBoundingClientRect().right ?? Infinity }));
    assert.ok(metrics.page <= metrics.width && metrics.addRight <= metrics.width + 1 && metrics.deleteRight <= metrics.width + 1, `Storyboard fits ${width}px viewport: ${JSON.stringify(metrics)}`);
  }
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  const initialMaterialSceneIds = mountainProject.researchPackage.scenes.map((scene: { id: string }) => scene.id);
  await clickButton(".storyboard-actions button", "add scene");
  await waitFor(() => page.evaluate((count) => document.querySelectorAll(".scene-row").length === count + 1, initialMaterialSceneIds.length), "new storyboard scene appears");
  const addedMaterialSceneId = await page.evaluate(() => document.querySelector<HTMLButtonElement>(".scene-row.chosen")?.dataset.sceneId ?? "");
  assert.ok(addedMaterialSceneId && !initialMaterialSceneIds.includes(addedMaterialSceneId), "new scene gets unique stable ID and selection");
  assert.equal(await page.evaluate(() => new URLSearchParams(location.search).get("scene")), addedMaterialSceneId, "adding scene updates URL-backed selection");
  await waitFor(() => page.evaluate((sceneId) => document.activeElement === [...document.querySelectorAll<HTMLButtonElement>(".scene-row")].find((button) => button.dataset.sceneId === sceneId), addedMaterialSceneId), "new scene receives keyboard focus");
  for (const width of storyboardViewportWidths) {
    await page.setViewport({ width, height: width <= 390 ? 844 : 900, deviceScaleFactor: 1 });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const metrics = await page.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth, addRight: document.querySelector<HTMLButtonElement>(".storyboard-actions button")?.getBoundingClientRect().right ?? Infinity, deleteRight: document.querySelector<HTMLButtonElement>(".scene-editor-actions button")?.getBoundingClientRect().right ?? Infinity }));
    assert.ok(metrics.page <= metrics.width && metrics.addRight <= metrics.width + 1 && metrics.deleteRight <= metrics.width + 1, `Storyboard with added scene fits ${width}px viewport: ${JSON.stringify(metrics)}`);
  }
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await clickButton('button[aria-label="Simpan perubahan"]', "save storyboard with added scene");
  await waitFor(async () => (await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json())).researchPackage.scenes.length === initialMaterialSceneIds.length + 1, "added scene persists to project");
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".scene-editor-actions button")?.disabled === false), "scene actions unlock after save");
  await clickButton(".scene-editor-actions button", "delete selected scene");
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector('[role="alertdialog"] .confirm-submit'))), "delete scene requires confirmation");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[role="alertdialog"] .confirm-cancel')?.click());
  await waitFor(() => page.evaluate(() => document.querySelector('[role="alertdialog"]') === null), "cancel closes delete confirmation");
  assert.equal(await page.evaluate(() => document.querySelectorAll(".scene-row").length), initialMaterialSceneIds.length + 1, "cancelled scene deletion preserves storyboard");
  await clickButton(".scene-editor-actions button", "confirmable delete scene");
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector('[role="alertdialog"] .confirm-submit'))), "delete confirmation reopens");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[role="alertdialog"] .confirm-submit')?.click());
  await waitFor(() => page.evaluate((count) => document.querySelectorAll(".scene-row").length === count, initialMaterialSceneIds.length), "confirmed deletion removes scene");
  assert.equal(await page.evaluate(() => new URLSearchParams(location.search).get("scene")), initialMaterialSceneIds.at(-1), "deleting selected scene selects and routes to adjacent scene");
  await waitFor(() => page.evaluate((sceneId) => document.activeElement === [...document.querySelectorAll<HTMLButtonElement>(".scene-row")].find((button) => button.dataset.sceneId === sceneId), initialMaterialSceneIds.at(-1)), "adjacent scene receives keyboard focus after deletion");
  await clickButton('button[aria-label="Simpan perubahan"]', "save storyboard after deletion");
  await waitFor(async () => {
    const savedProject = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
    return JSON.stringify(savedProject.researchPackage.scenes.map((scene: { id: string }) => scene.id)) === JSON.stringify(initialMaterialSceneIds);
  }, "deleted scene stays removed after save");
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".scene-editor-actions button")?.disabled === false), "scene actions unlock after delete save");
  await page.evaluate(() => document.querySelector<HTMLDetailsElement>(".advanced-editor summary")?.click());
  const materialsMotionControls = await page.evaluate(() => ({
    motionTab: [...document.querySelectorAll(".workflow-stepper button")].some((button) => button.textContent?.trim() === "Gerak"),
    duplicateCueEditor: Boolean(document.querySelector(".motion-cue-grid")),
    motionJsonEditor: [...document.querySelectorAll(".visual-json-editor summary")].some((summary) => summary.textContent?.includes("Motion plan")),
  }));
  assert.deepEqual(materialsMotionControls, { motionTab: false, duplicateCueEditor: false, motionJsonEditor: false }, "Materials step keeps Motion Direction and Motion Beats out of research editing");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-step-id="video-editor"]')?.click());
  await waitFor(() => page.evaluate((id) => location.pathname === `/projects/${id}/editor` && document.querySelector(".video-editor-v2") !== null, mountainProject.id), "Video Editor route opens");
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].map((button) => button.textContent?.trim())), ["Visual", "Gerak", "Klip", "Teks", "Transisi", "Audio"], "Video Editor exposes all six Inspector tabs");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.getAttribute("aria-expanded") === "true"), "inspector opens for baseline visual checks");
  await page.evaluate(() => {
    const first = document.querySelector<HTMLButtonElement>('.editor-inspector-tabs [role="tab"]');
    first?.focus();
    first?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  });
  await waitFor(() => page.evaluate(() => document.querySelectorAll<HTMLButtonElement>('.editor-inspector-tabs [role="tab"]')[1]?.getAttribute("aria-selected") === "true"), "ArrowRight selects next Inspector tab");
  const arrowSelected = await page.evaluate(() => {
    const second = document.querySelectorAll<HTMLButtonElement>('.editor-inspector-tabs [role="tab"]')[1];
    return document.activeElement === second;
  });
  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>('.editor-inspector-tabs [role="tab"]')[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true })));
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>('.editor-inspector-tabs [role="tab"]')?.getAttribute("aria-selected") === "true"), "Home selects first Inspector tab");
  const homeSelected = await page.evaluate(() => document.activeElement === document.querySelector('.editor-inspector-tabs [role="tab"]'));
  const keyboardTabs = { arrowSelected, homeSelected };
  assert.deepEqual(keyboardTabs, { arrowSelected: true, homeSelected: true }, "Inspector tabs support arrow and Home keyboard navigation");
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
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Belum disimpan"), "fit transform marks storyboard dirty before save");
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
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('.editor-inspector-tabs [role="tab"]')].map((button) => button.textContent?.trim())), ["Visual", "Gerak", "Klip", "Teks", "Transisi", "Audio"], "all six Inspector tabs stay available after Flow import");
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
  await page.setViewport({ width: 1024, height: 1000, deviceScaleFactor: 1 });
  const narrowInspectorPreview = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>(".google-flow-file-preview")!;
    const name = card.querySelector<HTMLElement>("strong")!;
    const cardRect = card.getBoundingClientRect();
    const buttonBounds = [...card.querySelectorAll<HTMLButtonElement>("button")].map((button) => {
      const rect = button.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    });
    return {
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      cardRight: cardRect.right,
      nameRight: name.getBoundingClientRect().right,
      columns: getComputedStyle(card).gridTemplateColumns.split(" ").length,
      buttonsFit: buttonBounds.every((button) => button.left >= cardRect.left && button.right <= cardRect.right),
    };
  });
  assert.ok(narrowInspectorPreview.scrollWidth <= narrowInspectorPreview.width && narrowInspectorPreview.cardRight <= narrowInspectorPreview.width && narrowInspectorPreview.nameRight <= narrowInspectorPreview.cardRight && narrowInspectorPreview.columns === 1 && narrowInspectorPreview.buttonsFit, `narrow inspector preview wraps inside card: ${JSON.stringify(narrowInspectorPreview)}`);
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
  await waitFor(() => page.evaluate((title) => location.pathname.endsWith("/editor") && document.querySelector(".video-editor-v2") !== null && document.querySelector<HTMLInputElement>(".video-editor-title input")?.value === title, mountainProject.researchPackage.title), "legacy Visual route migrates to unified Video Editor");
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].map((button) => button.textContent?.trim())), ["Visual", "Gerak", "Klip", "Teks", "Transisi", "Audio"], "one Video Editor owns all Inspector tabs");
  await clickButton(".editor-inspector-toggle", "Visual Storyboard inspector");
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.getAttribute("aria-expanded") === "true"), "Motion Direction inspector opens");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Gerak")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-motion-direction") !== null), "Motion Direction loads in Visual Storyboard");
  assert.equal(await page.evaluate(() => document.querySelector(".editor-motion-transition-panel") === null), true, "Visual Storyboard does not expose inter-scene transitions");
  await captureViewport("motion-direction-controls.png");
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const mobileMotionLayout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, panelRight: Math.round(document.querySelector<HTMLElement>(".video-editor-inspector")?.getBoundingClientRect().right ?? 0) }));
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
  assert.ok(await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-motion-direction button")].some((button) => button.textContent?.includes("Pratinjau Efek · Pan"))), "effect preview names selected Motion Direction");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-motion-direction button")].find((button) => button.textContent?.includes("Pratinjau Efek"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-play-button")?.getAttribute("aria-label") === "Jeda video"), "Remotion effect preview starts scene playback");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-play-button")?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-motion-direction button")].find((button) => button.textContent?.includes("Pratinjau Efek"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-play-button")?.getAttribute("aria-label") === "Jeda video"), "Motion Direction preview can be replayed");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-play-button")?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Tersimpan"), "Motion Direction draft saves");
  let savedMotion = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
  let savedSceneMotion = savedMotion.researchPackage.scenes[0].motionPlan;
  assert.ok(savedSceneMotion.some((plan: { cue: string }) => plan.cue === "fadeIn"), "enabled Fade In persists");
  assert.deepEqual(savedSceneMotion.find((plan: { cue: string }) => plan.cue === "pan"), { cue: "pan", targetLayer: "all", delayFrames: 0, durationFrames: 72, easing: "linear", direction: "right" }, "Pan direction and duration persist");
  assert.deepEqual(savedMotion.researchPackage.scenes[1].motionPlan, untouchedSceneMotion, "editing scene one does not change scene two motion");

  await page.goto({ url: `${viteUrl}/projects/${mountainProject.id}/editor?scene=${mountainBeforeEditor.visualStoryboard.scenes[1].sceneId}`, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => location.pathname.endsWith("/editor") && document.querySelector(".video-editor-v2") !== null), "legacy Edit Video route resolves to Video Editor");
  await clickButton(".editor-inspector-toggle", "Edit Video inspector");
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.getAttribute("aria-expanded") === "true"), "transition inspector opens");
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].map((button) => button.textContent?.trim())), ["Visual", "Gerak", "Klip", "Teks", "Transisi", "Audio"], "Video Editor keeps six tabs when opened through legacy Edit Video URL");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Transisi")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-motion-transition-panel") !== null), "Transisi tab loads transition controls");
  assert.equal(await page.evaluate(() => document.querySelector(".editor-motion-direction") === null && document.querySelector(".google-flow-panel") === null), true, "inactive Inspector panels are not mounted");
  const transitionPair = await page.evaluate(() => document.querySelector(".editor-transition-pair")?.textContent?.trim() ?? "");
  assert.ok(transitionPair.includes(mountainBeforeEditor.researchPackage.scenes[0].onScreenText) && transitionPair.includes(mountainBeforeEditor.researchPackage.scenes[1].onScreenText), `transition inspector identifies outgoing and incoming scenes: ${transitionPair}`);
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-motion-transition button")].find((button) => button.textContent?.trim() === "Crossfade")?.click());
  assert.equal(await setMotionControl('[aria-label="Durasi transisi (detik)"]', "1.2"), true, "Crossfade duration input is editable");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-motion-transition-panel button")].find((button) => button.textContent?.includes("Pratinjau transisi"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-play-button")?.getAttribute("aria-label") === "Jeda video"), "two-scene Remotion transition preview starts");
  assert.equal(await page.evaluate(() => new URLSearchParams(location.search).get("scene")), mountainBeforeEditor.visualStoryboard.scenes[1].sceneId, "transition playback keeps selected incoming scene stable");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-play-button")?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Tersimpan"), "Edit Video transition draft saves");
  savedMotion = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
  assert.equal(savedMotion.researchPackage.scenes[1].motionPlan.find((plan: { cue: string }) => plan.cue === "dissolve")?.durationFrames, 36, "Crossfade duration persists on incoming scene");
  await page.goto({ url: `${viteUrl}/projects/${mountainProject.id}/editor?scene=${mountainBeforeEditor.visualStoryboard.scenes[1].sceneId}`, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => location.pathname.endsWith("/editor") && document.querySelector(".video-editor-v2") !== null), "transition project reloads in Video Editor");
  await clickButton(".editor-inspector-toggle", "reloaded Video Editor inspector");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Transisi")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-motion-transition-panel") !== null), "saved transition tab reloads");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLInputElement>('[aria-label="Durasi transisi (detik)"]')?.value), "1.2", "Crossfade duration survives save/reload");
  await page.goto({ url: `${viteUrl}/projects/${mountainProject.id}?step=visual&scene=${mountainBeforeEditor.visualStoryboard.scenes[0].sceneId}`, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => location.pathname.endsWith("/editor") && Boolean(document.querySelector(".video-editor-v2"))), "legacy Visual route restores Motion Beat authoring in Video Editor");
  await clickButton(".editor-inspector-toggle", "Motion Beat inspector");
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.getAttribute("aria-expanded") === "true"), "Visual Storyboard inspector reopens");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Gerak")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-motion-direction") !== null), "Motion Direction reloads in Gerak tab");
  assert.equal(await page.evaluate(() => Boolean(document.querySelector<HTMLInputElement>('.editor-motion-effect[data-cue="pan"] input')?.checked)), true, "Pan remains active after editor reload");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('.editor-motion-effect[data-cue="pan"] button')?.click());
  assert.equal(await page.evaluate(() => document.querySelector<HTMLInputElement>('[aria-label="Durasi Pan (detik)"]')?.value), "2.4", "Pan duration reloads into Gerak tab");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLInputElement>('.editor-motion-effect[data-cue="fadeIn"] input')?.checked), true, "Fade In reloads into Visual Storyboard");
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

  const clipSceneId = flowMotionProject.visualStoryboard.scenes[0].sceneId;
  await page.goto({ url: `${viteUrl}/projects/${flowMotionProject.id}?step=visual&scene=${clipSceneId}`, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".video-editor-v2") && document.querySelector(".editor-canvas-shell video"))), "Google Flow clip loads in Remotion preview");
  await clickButton(".editor-inspector-toggle", "Flow clip inspector");
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-scene-media-controls") !== null), "Flow media controls load in Visual tab");
  const clipTransformBeforeMotion = await page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>(".editor-canvas-shell video");
    let parent = video?.parentElement;
    while (parent && !parent.classList.contains("editor-canvas-shell")) {
      if (parent.style.transform.includes("scale(")) return parent.style.transform;
      parent = parent.parentElement;
    }
    return "";
  });
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Gerak")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-motion-direction") !== null), "Motion Direction controls load for Flow clip");
  assert.equal(await setMotionCue("pan", true), true, "Motion Direction applies to imported Flow clip scene");
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll<HTMLLabelElement>(".editor-motion-parameters label")].find((label) => label.textContent?.trim().startsWith("Target"))?.querySelector("select")?.value === "all"), "Flow clip motion target defaults to whole media layer");
  assert.equal(await page.evaluate(() => [...document.querySelectorAll<HTMLLabelElement>(".editor-motion-parameters label")].find((label) => label.textContent?.trim().startsWith("Target"))?.querySelector("select")?.value), "all", "Flow clip motion targets whole media layer");
  await waitFor(() => page.evaluate((before) => {
    const video = document.querySelector<HTMLVideoElement>(".editor-canvas-shell video");
    let parent = video?.parentElement;
    while (parent && !parent.classList.contains("editor-canvas-shell")) {
      if (parent.style.transform.includes("scale(")) return parent.style.transform !== before;
      parent = parent.parentElement;
    }
    return false;
  }, clipTransformBeforeMotion), "Remotion applies Motion Direction transform to Flow video", 80);
  await captureViewport("google-flow-clip-motion-direction.png");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Tersimpan"), "Flow clip Motion Direction saves");
  const savedFlowMotionProject = await fetch(`${apiUrl}/api/projects/${flowMotionProject.id}`).then((response) => response.json());
  assert.equal(savedFlowMotionProject.researchPackage.scenes[0].sceneMedia.file, flowMotionMedia.file, "Flow clip identity survives Motion Direction save");
  assert.ok(savedFlowMotionProject.researchPackage.scenes[0].motionPlan.some((plan: { cue: string }) => plan.cue === "pan"), "Motion Direction plan persists with Flow media");
  await page.goto({ url: `${viteUrl}/projects/${flowMotionProject.id}/editor?scene=${clipSceneId}`, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => location.pathname.endsWith("/editor") && document.querySelector(".video-editor-v2") !== null), "Flow clip opens in Video Editor");
  await clickButton(".editor-inspector-toggle", "Edit Video clip inspector");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Klip")?.click());
  assert.equal(await page.evaluate(() => document.querySelectorAll(".editor-scene-media-controls input[type=number]").length), 2, "Klip tab owns trim-in and trim-out controls for Flow media");
  assert.equal(await page.evaluate(() => document.querySelector(".editor-motion-direction") === null), true, "inactive Gerak panel is not mounted while Klip is selected");

  await page.goto({ url: viteUrl, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".project-card-open").length >= 2), "dashboard before Visual World reload check");
  await clickProject(mountainProject.researchPackage.title);
  const sharedWorldAfterReload = await fetch(`${apiUrl}/api/projects/${mountainProject.id}`).then((response) => response.json());
  assert.ok(sharedWorldAfterReload.visualStoryboard.visualWorld?.elements.length > 0, "Visual World survives editor reload");
  assert.equal(sharedWorldAfterReload.visualStoryboard.scenes[0].motionActions[0].startFrame, 40, "edited Motion Beat survives editor reload");
  assert.ok(await page.evaluate(() => document.querySelectorAll(".editor-motion-clip").length > 0), "reloaded Video Editor timeline shows persisted Motion Beat");

  await page.goto({ url: `${viteUrl}/projects/${exportProject.id}?step=visual&scene=${encodeURIComponent(exportProject.visualStoryboard.scenes[0].sceneId)}`, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => location.pathname.endsWith("/editor") && Boolean(document.querySelector(".video-editor-v2"))), "legacy Visual link opens short project in Video Editor");
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
  await waitFor(() => page.evaluate(() => location.pathname.endsWith("/editor") && [...document.querySelectorAll(".editor-inspector-tabs button")].some((button) => button.textContent?.trim() === "Transisi")), "explicit visual approval unlocks Edit Video route");
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

  const volcanoTitle = "Bagaimana Gunung Api Terbentuk dan Meletus?";
  const volcanoPackageResponse = await fetch(`${apiUrl}/api/sample?topic=volcano-formation`);
  assert.equal(volcanoPackageResponse.status, 200, "sample package endpoint returns volcano fixture");
  const volcanoPackage = await volcanoPackageResponse.json();
  assert.equal(volcanoPackage.title, volcanoTitle);
  const volcanoCreateResponse = await fetch(`${apiUrl}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: volcanoPackage, creationMode: "sample" }) });
  assert.equal(volcanoCreateResponse.status, 201, `sample project creation: ${await volcanoCreateResponse.clone().text()}`);
  const volcanoCreated = await volcanoCreateResponse.json();
  const volcanoProject = { id: volcanoCreated.id, researchPackage: volcanoCreated.researchPackage };
  projectIds.push(volcanoProject.id);
  const volcanoSeeded = await fetch(`${apiUrl}/api/projects/${volcanoProject.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: volcanoCreated.researchPackage, visualStoryboard: seedVolcanoVisualSample(volcanoCreated.visualStoryboard) }) });
  assert.equal(volcanoSeeded.status, 200, "sample visual world and Motion Beats persist");
  const volcanoBeforeEditor = await fetch(`${apiUrl}/api/projects/${volcanoProject.id}`).then((response) => response.json());
  const volcanoGate = visualStoryboardQualityGate(volcanoBeforeEditor.researchPackage, volcanoBeforeEditor.visualStoryboard, volcanoBeforeEditor.visualAssets);
  assert.equal(volcanoGate.ready, false, "volcano sample keeps known Visual Storyboard review issues for editor-access regression");
  const manualTiming = await fetch(`${apiUrl}/api/projects/${volcanoProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: volcanoBeforeEditor.researchPackage, visualStoryboard: volcanoBeforeEditor.visualStoryboard, narrationMode: "manual" }),
  });
  assert.equal(manualTiming.status, 200, "sample fixture explicitly chooses manual narration timing");
  await page.goto({ url: `${viteUrl}/projects/${volcanoProject.id}/editor`, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => location.pathname.endsWith("/editor") && document.querySelector(".video-editor-v2") !== null), "volcano sample remains directly editable despite Visual quality issues");
  assert.equal(await page.evaluate(() => document.querySelectorAll(".editor-motion-clip").length), 6, "unified Video Editor timeline keeps all Motion Beats visible");
  await page.goto({ url: `${viteUrl}/projects/${volcanoProject.id}?step=visual`, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => location.pathname.endsWith("/editor") && document.querySelectorAll(".editor-motion-clip").length === 6), "legacy Visual link exposes six Motion Beats in Video Editor");
  await clickButton(".editor-inspector-toggle", "volcano Video Editor inspector");
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.getAttribute("aria-expanded") === "true"), "volcano inspector opens");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Visual")?.click());
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
  const volcanoSaved = await fetch(`${apiUrl}/api/projects/${volcanoProject.id}`).then((response) => response.json());
  assert.equal(volcanoSaved.visualStoryboard.scenes.reduce((count: number, scene: { motionActions: unknown[] }) => count + scene.motionActions.length, 0), 6, "all six sample beats persist");
  assert.ok(volcanoSaved.visualStoryboard.scenes.every((scene: { composition: unknown }) => JSON.stringify(scene.composition) === JSON.stringify(volcanoSaved.visualStoryboard.visualWorld.composition)), "all sample scenes persist same shared world");
  assert.notEqual(volcanoSaved.visualStoryboard.scenes[2].motionActions[0].path[0].x, 535, "sample path edit persists without an image asset");
  await page.goto({ url: viteUrl, timeout: 90_000 });
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".project-card-open").length >= 2), "dashboard before volcano sample reload");
  await clickProject(volcanoTitle);
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".editor-motion-clip").length === 6), "reloaded volcano editor shows all six Motion Beats");
  const volcanoReloaded = await fetch(`${apiUrl}/api/projects/${volcanoProject.id}`).then((response) => response.json());
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
