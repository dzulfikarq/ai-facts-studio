import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { openBrowser } from "@remotion/renderer";
import { visualApprovalFingerprint, visualStoryboardSchema } from "../src/domain/visual-storyboard";
import { visualObjectIds } from "../src/domain/visual-objects";

const root = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-facts-scene-media-smoke-"));
const evidenceDir = path.resolve(root, process.env.SCENE_MEDIA_SMOKE_OUTPUT_DIR ?? "artifacts/scene-media-smoke");
const execFileAsync = promisify(execFile);
const mediaFiles: string[] = [];
let assetFile: string | undefined;
let projectId: string | undefined;
let outroAssetId: string | undefined;
let outroFile: string | undefined;
let outroPosterFile: string | undefined;
let apiServer: ChildProcess | undefined;
let viteServer: ChildProcess | undefined;
let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;

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

async function waitFor(check: () => Promise<boolean>, description: string, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out: ${description}`);
}

async function runLocal(command: string, args: string[], timeout = 120_000) {
  await execFileAsync(command, args, { cwd: root, timeout, maxBuffer: 2 * 1024 * 1024 });
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(body)}`);
  return body;
}

await mkdir(evidenceDir, { recursive: true });
const apiPort = await freePort();
const vitePort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const viteUrl = `http://127.0.0.1:${vitePort}`;

try {
  const mp4Path = path.join(tempDir, "moving-flow.mp4");
  const outroPath = path.join(tempDir, "moving-outro.mp4");
  const gifPath = path.join(tempDir, "moving-flow.gif");
  const imagePath = path.join(tempDir, "static-flow.png");
  const fixtureHue = Number.parseInt(randomUUID().slice(0, 6), 16) % 360;
  await runLocal("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc2=size=360x640:rate=24:duration=1.4,hue=h=${fixtureHue},eq=brightness=0.45:saturation=0.5`, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=1.4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", "-y", mp4Path]);
  await runLocal("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc=size=360x640:rate=24:duration=1.4,hue=h=t*130`, "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=44100:duration=1.4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", "-y", outroPath]);
  await runLocal("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc2=size=320x480:rate=12:duration=1.4,hue=h=${fixtureHue},lutrgb=r=val*0.25:g=val*0.25:b=val*0.25`, "-filter_complex", "[0:v]split[a][b];[a]palettegen[p];[b][p]paletteuse", "-loop", "0", "-y", gifPath]);
  await runLocal("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=0x${fixtureHue.toString(16).padStart(6, "0")}:s=720x1280:d=1`, "-frames:v", "1", "-y", imagePath]);

  apiServer = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(apiPort), VITE_PORT: String(vitePort), DATA_DIR: path.join(tempDir, "data"), DAILY_JOB_LIMIT: "5", TTS_MOCK_PROVIDER: "0", GEMINI_API_KEY: "", HF_TOKEN: "", HF_IMAGE_GENERATION_ENABLED: "false", HF_IMAGE_ALLOW_PAID: "false", OPENCODE_SERVER_URL: "http://127.0.0.1:4096" },
    stdio: "inherit",
  });
  await waitFor(async () => { try { return (await fetch(`${apiUrl}/api/status`)).ok; } catch { return false; } }, "API startup");
  viteServer = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], {
    cwd: root, env: { ...process.env, HOST: "127.0.0.1", PORT: String(apiPort), VITE_PORT: String(vitePort) }, stdio: "ignore",
  });
  await waitFor(async () => { try { return (await fetch(`${viteUrl}/api/status`)).ok; } catch { return false; } }, "Vite startup");

  const sample = JSON.parse(await readFile(path.join(root, "samples/mountain-formation.json"), "utf8")) as Record<string, any>;
  const scenes = sample.scenes.slice(0, 3).map((scene: Record<string, unknown>, index: number) => {
    const { motionActions: _legacyActions, ...source } = scene;
    return { ...source, id: `scene-media-smoke-${index + 1}`, order: index + 1, startSec: index * 2, endSec: (index + 1) * 2 };
  });
  const researchPackage = {
    ...sample, id: `scene-media-smoke-${randomUUID()}`, title: "Scene Media Local Smoke", targetDurationSec: 6,
    narration: scenes.map((scene: { narrationText: string }) => scene.narrationText).join(" "), scenes,
  };
  const outroForm = new FormData();
  outroForm.append("outro", new Blob([await readFile(outroPath)], { type: "video/mp4" }), "Local moving outro.mp4");
  const uploadedOutro = await json<{ asset: { id: string; name: string; file: string; posterFile: string; bytes: number; durationSec: number; localAvailable: boolean } }>(await fetch(`${apiUrl}/api/outros`, { method: "POST", body: outroForm }));
  outroAssetId = uploadedOutro.asset.id;
  outroFile = uploadedOutro.asset.file;
  outroPosterFile = uploadedOutro.asset.posterFile;
  assert.equal(uploadedOutro.asset.localAvailable, true, "Outro MP4 is normalized and stored locally");
  assert.ok(uploadedOutro.asset.durationSec > 1, "Outro metadata stores moving clip duration");
  await json(await fetch(`${apiUrl}/api/outros/${outroAssetId}/default`, { method: "POST" }));

  browser = await openBrowser("chrome", { logLevel: "error" });
  const browserLogs: string[] = [];
  const page = await browser.newPage({ context: () => null, logLevel: "error", indent: 0, pageIndex: 0, onBrowserLog: (log: unknown) => browserLogs.push(JSON.stringify(log)), onLog: (log: unknown) => browserLogs.push(JSON.stringify(log)) } as never);
  const captureSettingsViewport = async (filename: string) => {
    const client = (page as unknown as { _client: () => { send: (method: string, params?: Record<string, unknown>) => Promise<{ value: any }> } })._client();
    const viewport = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, width: window.innerWidth, height: window.innerHeight }));
    const image = (await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false, clip: { ...viewport, scale: 1 } })).value;
    await writeFile(path.join(evidenceDir, filename), Buffer.from(image.data, "base64"));
  };
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto({ url: `${viteUrl}/create`, timeout: 30_000 });
  await waitFor(() => page.evaluate((id) => {
    const select = document.querySelector<HTMLSelectElement>('[aria-label="Outro Video (Opsional)"]');
    return Boolean(select && !select.disabled && select.value === id && [...select.options].some((option) => option.textContent === "Tanpa Outro"));
  }, outroAssetId!), "Create Video shows library default and Tanpa Outro option");
  await waitFor(() => page.evaluate((file) => Boolean(document.querySelector(`.create-outro-selected video[src*="${file}"]`)), outroFile!), "Create Video previews selected moving Outro");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('.create-mode-switch [role="tab"]')].find((button) => button.textContent?.includes("Import Research Package"))?.click());
  await page.evaluate((value) => {
    const input = document.querySelector<HTMLTextAreaElement>('[aria-label="Editor Research Package JSON"]');
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }, JSON.stringify(researchPackage));
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".import-footer .button-primary")?.click());
  await waitFor(() => page.evaluate(() => /^\/projects\/[^/]+/.test(location.pathname)), "Create Video persists selected Outro");
  const createdProjectId = await page.evaluate(() => decodeURIComponent(location.pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? ""));
  assert.ok(createdProjectId, "Create Video route identifies new project");
  projectId = createdProjectId;
  const created = await json<{ id: string; researchPackage: any; visualStoryboard: any; outro: any }>(await fetch(`${apiUrl}/api/projects/${createdProjectId}`));
  assert.equal(created.outro.assetId, outroAssetId, "project creation persists selected Outro default");
  const sceneIds = created.researchPackage.scenes.map((scene: { id: string }) => scene.id) as string[];

  await page.goto({ url: `${viteUrl}/settings`, timeout: 30_000 });
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".settings-nav-item").length === 5 && location.pathname === "/settings"), "Settings General section and URL-backed navigation");
  assert.equal(await page.evaluate(() => document.querySelector('.settings-nav-item[aria-current="page"] span')?.textContent), "General", "General is the canonical default section");
  for (const section of ["appearance", "ai-generation", "outro-library", "preferences"] as const) {
    await page.evaluate((target) => document.querySelector<HTMLAnchorElement>(`.settings-nav-item[href="/settings?section=${target}"]`)?.click(), section);
    await waitFor(() => page.evaluate((target) => location.search === `?section=${target}` && document.querySelector('.settings-nav-item[aria-current="page"]')?.getAttribute("href") === `/settings?section=${target}`, section), `Settings ${section} navigation`);
  }
  await page.evaluate(() => document.querySelector<HTMLAnchorElement>('.settings-nav-item[href="/settings?section=appearance"]')?.click());
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".appearance-theme-choices"))), "Appearance theme cards load");
  for (const preference of ["light", "dark", "system"] as const) {
    await page.evaluate((target) => [...document.querySelectorAll<HTMLButtonElement>(".appearance-theme-choices button")].find((button) => button.textContent?.includes(target[0]!.toUpperCase() + target.slice(1)))?.click(), preference);
    await waitFor(() => page.evaluate((target) => localStorage.getItem("ai-facts-studio:theme") === target && document.documentElement.dataset.themePreference === target, preference), `Theme ${preference} selection persists globally`);
  }
  await page.evaluate(() => document.querySelector<HTMLAnchorElement>('.settings-nav-item[href="/settings?section=ai-generation"]')?.click());
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector('.ai-mode-switch [role="radio"][aria-checked="true"]'))), "AI Generation settings remain available");
  const aiModeBeforeOutro = await page.evaluate(() => document.querySelector('.ai-mode-switch [role="radio"][aria-checked="true"] strong')?.textContent?.trim());
  await page.evaluate(() => document.querySelector<HTMLAnchorElement>('.settings-nav-item[href="/settings?section=outro-library"]')?.click());
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".outro-library .outro-card"))), "Outro Library card loads in Settings");
  await page.evaluate(() => history.back());
  await waitFor(() => page.evaluate(() => location.search === "?section=ai-generation"), "Settings browser Back restores prior section");
  assert.equal(await page.evaluate(() => document.querySelector('.ai-mode-switch [role="radio"][aria-checked="true"] strong')?.textContent?.trim()), aiModeBeforeOutro, "AI Generation mode survives section navigation");
  await page.evaluate(() => history.forward());
  await waitFor(() => page.evaluate(() => location.search === "?section=outro-library"), "Settings browser Forward restores next section");
  await page.goto({ url: `${viteUrl}/settings?section=outro-library`, timeout: 30_000 });
  await waitFor(() => page.evaluate(() => document.querySelector('.settings-nav-item[aria-current="page"]')?.getAttribute("href") === "/settings?section=outro-library"), "Settings refresh retains active section");
  assert.equal(await page.evaluate(() => localStorage.getItem("ai-facts-studio:theme")), "system", "theme preference survives Settings refresh");
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".outro-library .outro-card"))), "Outro Library reloads saved assets");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".outro-card-poster")?.click());
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector<HTMLDialogElement>(".outro-preview-dialog[open] video"))), "native Outro preview dialog");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[aria-label="Tutup pratinjau"]')?.click());

  const browserOutroName = "Browser Uploaded Outro";
  assert.equal(await page.evaluate(({ bytes, name }) => {
    const input = document.querySelector<HTMLInputElement>(".outro-upload-button input");
    if (!input) return false;
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], name, { type: "video/mp4" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, { bytes: [...await readFile(outroPath)], name: `${browserOutroName}.mp4` }), true, "Settings upload control accepts MP4");
  await waitFor(() => page.evaluate((name) => [...document.querySelectorAll(".outro-card-title strong")].some((node) => node.textContent === name), browserOutroName), "Outro upload appears in Settings");
  await page.evaluate((name) => {
    const card = [...document.querySelectorAll<HTMLElement>(".outro-card")].find((item) => item.querySelector(".outro-card-title strong")?.textContent === name);
    const input = card?.querySelector<HTMLInputElement>(".outro-rename-row input");
    if (!card || !input) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, `${name} Renamed`);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    card.querySelector<HTMLButtonElement>(".outro-rename-row button")?.click();
    return true;
  }, browserOutroName);
  const renamedOutroName = `${browserOutroName} Renamed`;
  await waitFor(() => page.evaluate((name) => [...document.querySelectorAll(".outro-card-title strong")].some((node) => node.textContent === name), renamedOutroName), "Outro rename persists from Settings UI");
  await page.evaluate((name) => {
    const card = [...document.querySelectorAll<HTMLElement>(".outro-card")].find((item) => item.querySelector(".outro-card-title strong")?.textContent === name);
    card?.querySelector<HTMLButtonElement>(".outro-card-actions .button-outline")?.click();
  }, renamedOutroName);
  await waitFor(async () => {
    const state = await fetch(`${apiUrl}/api/outros`).then((response) => json<{ outros: { id: string; name: string }[]; defaultOutroId: string | null }>(response));
    return state.outros.some((asset) => asset.name === renamedOutroName) && state.defaultOutroId === state.outros.find((asset) => asset.name === renamedOutroName)?.id;
  }, "Outro default persists after Settings action");
  const browserOutroId = (await fetch(`${apiUrl}/api/outros`).then((response) => json<{ outros: { id: string; name: string }[] }>(response))).outros.find((asset) => asset.name === renamedOutroName)!.id;
  await page.evaluate((name) => {
    const card = [...document.querySelectorAll<HTMLElement>(".outro-card")].find((item) => item.querySelector(".outro-card-title strong")?.textContent === name);
    card?.querySelector<HTMLButtonElement>(".outro-delete-button")?.click();
  }, renamedOutroName);
  await waitFor(() => page.evaluate(() => document.querySelector(".confirm-dialog[role=alertdialog]")?.textContent?.includes("Hapus outro dari library?") ?? false), "Outro delete uses custom confirmation");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".confirm-submit.danger")?.click());
  await waitFor(async () => !(await fetch(`${apiUrl}/api/outros`).then((response) => json<{ outros: { id: string }[] }>(response))).outros.some((asset) => asset.id === browserOutroId), "Confirmed Outro delete removes unused upload");
  await page.evaluate((name) => {
    const card = [...document.querySelectorAll<HTMLElement>(".outro-card")].find((item) => item.querySelector(".outro-card-title strong")?.textContent === name);
    card?.querySelector<HTMLButtonElement>(".outro-card-actions .button-outline")?.click();
  }, uploadedOutro.asset.name);
  await waitFor(async () => (await fetch(`${apiUrl}/api/outros`).then((response) => json<{ defaultOutroId: string | null }>(response))).defaultOutroId === outroAssetId, "Original Outro default can be restored");
  await page.goto({ url: `${viteUrl}/settings?section=outro-library`, timeout: 30_000 });
  await waitFor(() => page.evaluate((name) => [...document.querySelectorAll<HTMLElement>(".outro-card")].some((card) => card.querySelector(".outro-card-title strong")?.textContent === name && Boolean(card.querySelector(".outro-default-badge"))), uploadedOutro.asset.name), "Default outro survives Settings refresh");
  assert.equal(await page.evaluate(() => { const input = document.querySelector<HTMLInputElement>(".outro-upload-button input"); return Boolean(input && !input.disabled); }), true, "Outro upload stays enabled when idle");
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector<HTMLElement>(".outro-upload-button")!).color), "rgb(255, 255, 255)", "primary upload label keeps white text contrast");
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await captureSettingsViewport("settings-outro-desktop.png");
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await captureSettingsViewport("settings-outro-mobile.png");
  for (const width of [1440, 1280, 1024, 768, 390, 360, 320]) {
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
    const bounds = await page.evaluate(() => ({ viewport: window.innerWidth, page: document.documentElement.scrollWidth, card: document.querySelector<HTMLElement>(".outro-card")?.getBoundingClientRect().right ?? 0 }));
    assert.ok(bounds.page <= bounds.viewport + 1 && bounds.card <= bounds.viewport + 1, `Outro Library fits ${width}px without horizontal overflow: ${JSON.stringify(bounds)}`);
  }
  await page.goto({ url: `${viteUrl}/create`, timeout: 30_000 });
  await waitFor(() => page.evaluate((id) => document.querySelector<HTMLSelectElement>('[aria-label="Outro Video (Opsional)"]')?.value === id, outroAssetId!), "Create Outro selection reload");
  const createOutroSelect = await page.evaluate((id) => {
    const select = document.querySelector<HTMLSelectElement>('[aria-label="Outro Video (Opsional)"]');
    if (!select) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, "");
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const noOutro = select.value === "" && document.querySelector(".create-outro-none")?.textContent?.trim() === "Tanpa Outro";
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, id);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return noOutro;
  }, outroAssetId!);
  assert.equal(createOutroSelect, true, "Create Video allows explicit Tanpa Outro and reselecting library media");
  await page.setViewport({ width: 320, height: 900, deviceScaleFactor: 1 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Create Outro controls fit 320px viewport");

  async function uploadMedia(sceneId: string, filePath: string, mimeType: string, fileName = path.basename(filePath)) {
    const form = new FormData();
    form.append("media", new Blob([await readFile(filePath)], { type: mimeType }), fileName);
    const result = await json<{ media: any }>(await fetch(`${apiUrl}/api/projects/${created.id}/scenes/${encodeURIComponent(sceneId)}/media`, { method: "POST", body: form }));
    mediaFiles.push(result.media.file, result.media.posterFile);
    return result.media;
  }

  const mp4Media = await uploadMedia(sceneIds[0]!, mp4Path, "video/mp4", "Venus_rotation_and_orbit_comparison_030570aa.mp4");
  const gifMedia = await uploadMedia(sceneIds[1]!, gifPath, "image/gif");
  assert.equal(mp4Media.audioCodec, "aac", "MP4 audio stream is normalized to AAC");
  assert.equal(mp4Media.audioEnabled, false, "imported clip audio defaults off");
  assert.equal(gifMedia.sourceFormat, "gif");
  assert.ok(gifMedia.sourceDurationSec > 1 && gifMedia.frameRate === 30, "animated GIF retains duration and normalizes to 30 fps");

  const staticForm = new FormData();
  staticForm.append("illustration", new Blob([await readFile(imagePath)], { type: "image/png" }), "static-flow.png");
  staticForm.append("name", "Scene media static fixture");
  staticForm.append("source", "user-upload");
  staticForm.append("provider", "Local scene-media smoke");
  staticForm.append("model", "Synthetic fixture");
  staticForm.append("prompt", "Synthetic static frame fixture for local E2E verification.");
  staticForm.append("license", "Local test fixture; not externally generated");
  const imageUpload = await json<{ asset: { id: string; file: string } }>(await fetch(`${apiUrl}/api/projects/${created.id}/visual-assets`, { method: "POST", body: staticForm }));
  assetFile = imageUpload.asset.file;

  const fresh = await fetch(`${apiUrl}/api/projects/${created.id}`).then((response) => json<any>(response));
  const board = structuredClone(fresh.visualStoryboard);
  board.scenes = board.scenes.map((scene: any, index: number) => {
    const next = {
      ...scene, authoringStatus: "ready_for_review", authoringConfirmed: true, approved: false, approvedFingerprint: null,
      flowStatus: "illustration-imported", motionStatus: "not_prepared", motionActions: [], missingVisuals: [], warnings: [],
    };
    if (index === 0) {
      next.sceneMedia = mp4Media;
      next.flowVisualMode = "animated-video";
      next.illustrationSource = "video-clip";
    } else if (index === 1) {
      next.sceneMedia = gifMedia;
      next.flowVisualMode = "animated-video";
      next.illustrationSource = "video-clip";
    } else {
      next.sceneMedia = undefined;
      next.flowVisualMode = "still-image";
      next.illustrationSource = "upload-image";
      next.illustrationWorkflow = "upload-image";
      next.compositionSource = "manual";
      next.layout = "existing-composition";
      next.compositionType = "hero-object-focus";
      next.visualFocus = null;
      next.objects = [];
      next.relationships = [];
      next.compositionOverride = undefined;
      next.composition = {
        background: "#203040",
        layers: [{ id: "static-image", depth: 0.05, nodes: [{ type: "image", asset: imageUpload.asset.id, x: 0, y: 0, width: 1080, height: 1920, fit: "cover", position: "center" }] }],
      };
    }
    return next;
  });
  board.reusableWorldObjects = visualObjectIds.filter((objectId: string) => board.scenes.filter((scene: any) => scene.objects.some((object: any) => object.objectId === objectId)).length > 1);
  const normalizedBoard = visualStoryboardSchema.parse(board);
  normalizedBoard.scenes = normalizedBoard.scenes.map((scene) => {
    const approved = { ...scene, approved: true, flowStatus: "approved" as const };
    return { ...approved, approvedFingerprint: visualApprovalFingerprint(approved) };
  });
  const saved = await fetch(`${apiUrl}/api/projects/${created.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: fresh.researchPackage, visualStoryboard: normalizedBoard, narrationMode: "manual" }),
  });
  const persisted = await json<any>(saved);
  assert.deepEqual(persisted.visualStoryboard.scenes.map((scene: any) => Boolean(scene.sceneMedia)), [true, true, false], "project persists two animated clips plus separate static illustration");
  assert.equal(persisted.researchPackage.scenes[0].sceneMedia.sha256, mp4Media.sha256, "MP4 metadata projects into persisted render input");
  assert.equal((await fetch(`${apiUrl}/scene-media/${encodeURIComponent(mp4Media.file)}`)).status, 200, "local normalized MP4 is served for preview/render");

  const visualUrl = `${viteUrl}/projects/${created.id}?step=visual&scene=${encodeURIComponent(sceneIds[0]!)}`;
  const editorUrl = `${viteUrl}/projects/${created.id}/editor?scene=${encodeURIComponent(sceneIds[0]!)}`;
  await page.goto({ url: visualUrl, timeout: 30_000 });
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".video-editor-v2"))), "media project editor reload");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.click());
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".editor-scene-media-controls"))), "scene media inspector");
  await waitFor(() => page.evaluate((file) => Boolean(document.querySelector(`.editor-canvas-shell video[src*="${file}"]`)), mp4Media.file), "Remotion preview mounts normalized MP4")
    .catch(async (error) => { throw new Error(`${error instanceof Error ? error.message : error}\n${await page.evaluate(() => document.body.innerText)}\n${browserLogs.slice(-10).join("\n")}`); });

  const initialControls = await page.evaluate(() => ({
    audioEnabled: document.querySelector<HTMLInputElement>(".editor-media-audio input")?.checked,
    videoSrc: document.querySelector<HTMLVideoElement>(".editor-canvas-shell video[src*='scene-media']")?.getAttribute("src"),
    trackClips: document.querySelectorAll(".editor-media-clip").length,
  }));
  assert.deepEqual(initialControls.audioEnabled, false, "audio control is unchecked by default in editor");
  assert.equal(initialControls.trackClips, 2, "timeline shows video clips for only animated scenes");
  assert.ok(initialControls.videoSrc?.includes(mp4Media.file), "editor preview uses local normalized MP4 source");

  const setNumber = async (index: number, value: number) => page.evaluate(({ inputIndex, inputValue }) => {
    const input = document.querySelectorAll<HTMLInputElement>(".editor-scene-media-controls input[type=number]")[inputIndex];
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, String(inputValue));
    input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true;
  }, { inputIndex: index, inputValue: value });
  const setSelect = async (index: number, value: string) => page.evaluate(({ selectIndex, selectValue }) => {
    const select = document.querySelectorAll<HTMLSelectElement>(".editor-scene-media-controls select")[selectIndex];
    if (!select) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, selectValue);
    select.dispatchEvent(new Event("input", { bubbles: true })); select.dispatchEvent(new Event("change", { bubbles: true })); return true;
  }, { selectIndex: index, selectValue: value });
  const saveEditor = async () => {
    await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Simpan"))?.click());
    await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Tersimpan"), "scene media editor save")
      .catch(async (error) => { throw new Error(`${error instanceof Error ? error.message : error}\n${JSON.stringify(await page.evaluate(() => ({ state: document.querySelector(".editor-save-state")?.textContent, buttons: [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].map((button) => ({ text: button.textContent?.trim(), disabled: button.disabled })), alert: document.querySelector("[role=alert]")?.textContent, message: document.querySelector(".app-message")?.textContent })))}\n${browserLogs.slice(-10).join("\n")}`); });
  };
  const seekEditor = async (frame: number) => page.evaluate((value) => {
    const input = document.querySelector<HTMLInputElement>("#editor-playhead");
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true;
  }, frame);
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".video-editor-toolbar-actions button")].find((button) => button.textContent?.includes("Pengaturan Video"))?.click());
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector("#editor-video-settings"))), "video-level Outro settings");
  const createSelectedOutro = await page.evaluate(() => ({
    id: document.querySelector<HTMLSelectElement>('[aria-label="Pilih outro video"]')?.value,
    clip: document.querySelector<HTMLButtonElement>(".editor-outro-clip")?.getAttribute("aria-label"),
  }));
  assert.equal(createSelectedOutro.id, outroAssetId, "Video Editor loads per-project selected Outro");
  assert.ok(createSelectedOutro.clip?.includes("Local moving outro"), "timeline exposes separate Outro segment");
  const setOutroNumber = async (index: number, value: number) => page.evaluate(({ inputIndex, inputValue }) => {
    const input = document.querySelectorAll<HTMLInputElement>(".editor-outro-trim input[type=number]")[inputIndex];
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, String(inputValue));
    input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true;
  }, { inputIndex: index, inputValue: value });
  assert.ok(await setOutroNumber(0, 0.2) && await setOutroNumber(1, 1.2), "Outro trim in/out controls accept project-specific values");
  const setOutroAudio = await page.evaluate(() => {
    const input = document.querySelectorAll<HTMLInputElement>(".editor-outro-controls input[type=checkbox]")[1];
    if (!input) return false;
    if (!input.checked) input.click();
    return input.checked;
  });
  assert.equal(setOutroAudio, true, "original Outro audio can be enabled independently");
  await waitFor(() => page.evaluate(() => {
    const inputs = [...document.querySelectorAll<HTMLInputElement>(".editor-outro-trim input[type=number]")];
    return inputs[0]?.value === "0.2" && inputs[1]?.value === "1.2";
  }), "trim values update in editor");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-outro-clip")?.click());
  await waitFor(() => page.evaluate((file) => {
    const video = document.querySelector<HTMLVideoElement>(`.editor-canvas-shell video[src*="${file}"]`);
    return Boolean(video && video.readyState >= 2);
  }, outroFile!), "moving Outro mounts in Remotion preview");
  assert.equal(await page.evaluate(() => document.querySelectorAll(".editor-canvas-shell svg text").length), 0, "outro preview has no scene overlays");
  const outroStartTime = await page.evaluate((file) => document.querySelector<HTMLVideoElement>(`.editor-canvas-shell video[src*="${file}"]`)?.currentTime ?? -1, outroFile!);
  assert.ok(outroStartTime >= 0, "preview video has a valid moving media clock");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-play-button")?.click());
  await waitFor(() => page.evaluate((input) => (document.querySelector<HTMLVideoElement>(`.editor-canvas-shell video[src*="${input.file}"]`)?.currentTime ?? 0) > input.start + 0.15, { file: outroFile!, start: outroStartTime }), "Outro preview playback advances independently");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-play-button")?.click());
  await saveEditor();
  const persistedOutro = await fetch(`${apiUrl}/api/projects/${created.id}`).then((response) => json<any>(response));
  assert.deepEqual(persistedOutro.outro, { ...created.outro, trimInSec: 0.2, trimOutSec: 1.2, audioEnabled: true }, "Video Editor persists Outro selection, trim, and source-audio settings");
  const setMotionCue = async (cue: string, enabled: boolean) => page.evaluate(({ cueId, shouldEnable }) => {
    const input = document.querySelector<HTMLInputElement>(`.editor-motion-effect[data-cue="${cueId}"] input`);
    if (!input) return false;
    if (input.checked !== shouldEnable) input.click();
    return input.checked === shouldEnable;
  }, { cueId: cue, shouldEnable: enabled });
  const setMotionControl = async (selector: string, value: string) => page.evaluate(({ query, nextValue }) => {
    const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(query);
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, { query: selector, nextValue: value });

  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Gerak")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-motion-direction") !== null), "animated clip Motion Direction controls");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-motion-direction button")].find((button) => button.textContent?.includes("Tanpa efek · Cut"))?.click());
  assert.ok(await seekEditor(15), "motion-free clip can be scrubbed");
  const staticClipMotion = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>(".editor-canvas-shell");
    let element = document.querySelector<HTMLVideoElement>(".editor-canvas-shell video")?.parentElement ?? null;
    while (element && element !== canvas) {
      if (element.style.transform.startsWith("translate(")) return { transform: element.style.transform, opacity: element.style.opacity };
      element = element.parentElement;
    }
    return null;
  });
  assert.ok(staticClipMotion?.transform.includes("translate(0px, 0px)"), `no additional motion leaves MP4 layer static: ${JSON.stringify(staticClipMotion)}`);
  assert.ok(await setMotionCue("pan", true), "Pan can animate entire imported clip");
  assert.ok(await setMotionControl('.editor-motion-parameters select', "right"), "whole-clip Pan direction can be set");
  assert.ok(await setMotionControl('[aria-label="Durasi Pan (detik)"]', "1.0"), "whole-clip Pan duration can be set");
  assert.ok(await seekEditor(15), "animated clip can be scrubbed to effect frame");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const animatedClipMotion = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>(".editor-canvas-shell");
    let element = document.querySelector<HTMLVideoElement>(".editor-canvas-shell video")?.parentElement ?? null;
    while (element && element !== canvas) {
      if (element.style.transform.startsWith("translate(")) return { transform: element.style.transform, opacity: element.style.opacity };
      element = element.parentElement;
    }
    return null;
  });
  assert.ok(animatedClipMotion && animatedClipMotion.transform !== staticClipMotion?.transform, `Remotion preview transforms whole MP4 layer with Pan: ${JSON.stringify(animatedClipMotion)}`);
  await saveEditor();
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Klip")?.click());
  assert.ok(await setSelect(0, "freeze-last-frame"), "Klip tab exposes freeze-last-frame control");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Visual")?.click());

  assert.ok(await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(".editor-media-audio input");
    if (!input) return false;
    input.click(); return input.checked;
  }), "scene audio checkbox can be enabled explicitly");
  assert.ok(await setSelect(0, "contain") && await setSelect(1, "bottom"), "fit and crop position controls work");
  await saveEditor();
  let latest = await fetch(`${apiUrl}/api/projects/${created.id}`).then((response) => json<any>(response));
  let savedMedia = latest.visualStoryboard.scenes[0].sceneMedia;
  mediaFiles.push(savedMedia.posterFile);
  assert.equal(savedMedia.trimInSec, mp4Media.trimInSec, "visual controls preserve clip trim");
  assert.equal(savedMedia.trimOutSec, mp4Media.trimOutSec, "visual controls preserve clip trim");
  assert.equal(savedMedia.shortClip, "freeze-last-frame");
  assert.equal(savedMedia.fit, "contain");
  assert.equal(savedMedia.position, "bottom");
  assert.equal(savedMedia.audioEnabled, true);

  await page.goto({ url: editorUrl, timeout: 30_000 });
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".video-editor-v2"))), "Edit Video workspace reload");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Klip")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector('.editor-inspector-tabs button[aria-selected="true"]')?.textContent?.trim() === "Klip"), "clip timing inspector");
  assert.ok(await setNumber(0, 0.1) && await setNumber(1, Math.max(0.4, mp4Media.durationSec - 0.1)), "trim controls accept a valid range");
  await saveEditor();
  latest = await fetch(`${apiUrl}/api/projects/${created.id}`).then((response) => json<any>(response));
  savedMedia = latest.visualStoryboard.scenes[0].sceneMedia;
  mediaFiles.push(savedMedia.posterFile);
  assert.equal(savedMedia.trimInSec, 0.1);
  assert.ok(Math.abs(savedMedia.trimOutSec - Math.max(0.4, mp4Media.durationSec - 0.1)) < 0.001);
  assert.equal(savedMedia.posterTrimOutSec, savedMedia.trimOutSec, "freeze poster regenerates for trimmed endpoint");
  assert.ok(await seekEditor(45), "trimmed clip can seek beyond media duration");
  await waitFor(() => page.evaluate((poster) => Boolean(document.querySelector(`.editor-canvas-shell img[src*="${poster}"]`)), savedMedia.posterFile), "freeze mode holds trimmed last-frame poster beyond clip duration");

  await page.goto({ url: editorUrl, timeout: 30_000 });
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".video-editor-v2"))), "clip timing state reload");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Klip")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-scene-media-controls") !== null), "clip media inspector reload");
  assert.deepEqual(await page.evaluate(() => ({
    trimIn: Number(document.querySelectorAll<HTMLInputElement>(".editor-scene-media-controls input[type=number]")[0]?.value),
    trimOut: Number(document.querySelectorAll<HTMLInputElement>(".editor-scene-media-controls input[type=number]")[1]?.value),
  })), { trimIn: 0.1, trimOut: savedMedia.trimOutSec }, "clip trim survives editor reload");
  await page.setViewport({ width: 401, height: 768, deviceScaleFactor: 1 });
  await page.evaluate(() => { const content = document.querySelector<HTMLElement>(".editor-inspector-content"); if (content) content.scrollTop = 0; });
  const mobileClipLayout = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(".editor-inspector-content")!;
    const info = document.querySelector<HTMLElement>(".editor-scene-media-controls .editor-info-box")!;
    return { viewport: innerWidth, page: document.documentElement.scrollWidth, contentWidth: content.clientWidth, contentScrollWidth: content.scrollWidth, infoWidth: info.clientWidth, infoScrollWidth: info.scrollWidth };
  });
  assert.ok(mobileClipLayout.page <= mobileClipLayout.viewport + 1 && mobileClipLayout.contentScrollWidth <= mobileClipLayout.contentWidth + 1 && mobileClipLayout.infoScrollWidth <= mobileClipLayout.infoWidth + 1, `Clip inspector wraps long filenames without horizontal overflow at 401px: ${JSON.stringify(mobileClipLayout)}`);
  await captureSettingsViewport("scene-media-clip-mobile.png");
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });

  await page.goto({ url: visualUrl, timeout: 30_000 });
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".video-editor-v2"))), "visual media workspace reload");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.click());
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".editor-scene-media-controls"))), "visual media controls reload");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Klip")?.click());
  assert.ok(await setSelect(0, "loop"), "Klip tab exposes loop control");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Visual")?.click());
  assert.ok(await setSelect(0, "cover") && await setSelect(1, "center"), "cover crop can be restored");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Klip")?.click());
  await waitFor(() => page.evaluate(() => document.querySelectorAll<HTMLSelectElement>(".editor-scene-media-controls select")[0]?.value === "loop"), "loop selection updates editor state");
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() !== "Tersimpan"), "loop selection marks project dirty");
  await saveEditor();
  latest = await fetch(`${apiUrl}/api/projects/${created.id}`).then((response) => json<any>(response));
  savedMedia = latest.visualStoryboard.scenes[0].sceneMedia;
  assert.equal(savedMedia.shortClip, "loop", "loop choice persists to project before snapshot generation");
  await seekEditor(45);
  await waitFor(() => page.evaluate((file) => Boolean(document.querySelector(`.editor-canvas-shell video[src*="${file}"]`)), savedMedia.file), "loop mode restarts trimmed video after source end");
  await seekEditor(5);
  const playState = await page.evaluate(() => ({ button: document.querySelector<HTMLButtonElement>(".editor-play-button")?.getAttribute("aria-label"), videoTime: document.querySelector<HTMLVideoElement>(".editor-canvas-shell video[src*='scene-media']")?.currentTime ?? 0 }));
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-play-button")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-play-button")?.getAttribute("aria-label") === "Jeda video"), "editor playback starts");
  await new Promise((resolve) => setTimeout(resolve, 700));
  const playedTime = await page.evaluate(() => document.querySelector<HTMLVideoElement>(".editor-canvas-shell video[src*='scene-media']")?.currentTime ?? 0);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-play-button")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-play-button")?.getAttribute("aria-label") === "Putar video"), "editor playback pauses");
  assert.ok(playedTime > playState.videoTime, `MP4 playback time advances after seek/play: ${playState.videoTime} → ${playedTime}`);
  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>(".editor-scene-item")[1]?.click());
  assert.ok(await seekEditor(75), "GIF scene can be scrubbed");
  await waitFor(() => page.evaluate((file) => Boolean(document.querySelector(`.editor-canvas-shell video[src*="${file}"]`)), gifMedia.file), "normalized GIF preview mounts as video");
  const gifStartTime = await page.evaluate(() => document.querySelector<HTMLVideoElement>(".editor-canvas-shell video[src*='scene-media']")?.currentTime ?? 0);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-play-button")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-play-button")?.getAttribute("aria-label") === "Jeda video"), "GIF preview playback starts");
  await new Promise((resolve) => setTimeout(resolve, 700));
  const gifPlayedTime = await page.evaluate(() => document.querySelector<HTMLVideoElement>(".editor-canvas-shell video[src*='scene-media']")?.currentTime ?? 0);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-play-button")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-play-button")?.getAttribute("aria-label") === "Putar video"), "GIF preview playback pauses");
  assert.ok(gifPlayedTime > gifStartTime, `normalized GIF remains animated in preview: ${gifStartTime} → ${gifPlayedTime}`);
  latest = await fetch(`${apiUrl}/api/projects/${created.id}`).then((response) => json<any>(response));
  const reapprovedBoard = {
    ...latest.visualStoryboard,
    scenes: latest.visualStoryboard.scenes.map((scene: any) => {
      const approved = { ...scene, authoringConfirmed: true, authoringStatus: "ready_for_review", approved: true, flowStatus: "approved" };
      return { ...approved, approvedFingerprint: visualApprovalFingerprint(approved) };
    }),
  };
  await json(await fetch(`${apiUrl}/api/projects/${created.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: latest.researchPackage, visualStoryboard: reapprovedBoard, narrationMode: "manual" }),
  }));
  await page.goto({ url: visualUrl, timeout: 30_000 });
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".video-editor-v2"))), "approved Flow project reloads in unified editor");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.click());
  await waitFor(() => page.evaluate(() => document.querySelectorAll(".editor-inspector-tabs button").length === 6), "all six Inspector tabs remain available with approved Flow media");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Klip")?.click());
  assert.ok(await setNumber(0, 0.2), "trim adjustment is available after visual approval");
  await saveEditor();
  latest = await fetch(`${apiUrl}/api/projects/${created.id}`).then((response) => json<any>(response));
  assert.equal(latest.visualStoryboard.scenes[0].approved, true, "changing Flow trim keeps artwork approval intact");
  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>(".editor-scene-item")[1]?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Transisi")?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-motion-transition button")].find((button) => button.textContent?.trim() === "Crossfade")?.click());
  await saveEditor();
  latest = await fetch(`${apiUrl}/api/projects/${created.id}`).then((response) => json<any>(response));
  assert.equal(latest.visualStoryboard.scenes[1].approved, true, "changing scene transition keeps that scene's artwork approval");
  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>(".editor-scene-item")[2]?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-inspector-scene")?.textContent?.includes("SCENE 03") ?? false), "static image scene selection");
  assert.ok(await page.evaluate(() => document.querySelectorAll(".editor-canvas-shell image").length > 0), "static imported image remains separate from video scene media");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Gerak")?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-motion-direction button")].find((button) => button.textContent?.includes("Tanpa gerakan tambahan"))?.click());
  await seekEditor(135);
  const staticImageTransform = await page.evaluate(() => document.querySelector<SVGGElement>('.editor-canvas-shell svg g[transform*="translate(540 960)"]')?.getAttribute("transform") ?? "");
  const panEnabled = await setMotionCue("pan", true);
  const panDirectionSet = await setMotionControl('.editor-motion-parameters select', "right");
  assert.ok(panEnabled && panDirectionSet, `static raster image accepts targeted Pan effect: ${JSON.stringify({ panEnabled, panDirectionSet, ui: await page.evaluate(() => ({ tabs: [...document.querySelectorAll(".editor-inspector-tabs button")].map((button) => button.textContent?.trim()), effects: [...document.querySelectorAll(".editor-motion-effect")].map((item) => item.getAttribute("data-cue")), parameters: document.querySelector(".editor-motion-parameters")?.textContent?.slice(0, 120) })) })}`);
  await seekEditor(135);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const animatedImageTransform = await page.evaluate(() => document.querySelector<SVGGElement>('.editor-canvas-shell svg g[transform*="translate(540 960)"]')?.getAttribute("transform") ?? "");
  assert.ok(staticImageTransform && animatedImageTransform !== staticImageTransform, `Remotion preview transforms imported static image layer: ${staticImageTransform} → ${animatedImageTransform}`);
  await saveEditor();
  latest = await fetch(`${apiUrl}/api/projects/${created.id}`).then((response) => json<any>(response));

  await page.goto({ url: editorUrl, timeout: 30_000 });
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".video-editor-v2"))), "Edit Video overlay workspace");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Teks")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-overlay-settings") !== null), "overlay settings controls");
  const overlayState = () => page.evaluate(() => [...document.querySelectorAll<HTMLInputElement>(".editor-overlay-settings input[type=checkbox]")].map((input) => input.checked));
  const previewOverlayState = () => page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>(".editor-canvas-shell svg");
    const texts = [...svg?.querySelectorAll("text") ?? []].map((text) => text.textContent?.trim() ?? "");
    const groups = [...svg?.children ?? []].filter((element) => element.tagName.toLowerCase() === "g");
    const captionGroup = groups.at(-1);
    return {
      texts,
      captions: captionGroup?.querySelectorAll("text").length ?? 0,
      headerShade: Boolean(svg?.querySelector('rect[fill="url(#caption-shade)"][y="50"]')),
      footerShade: Boolean(svg?.querySelector('rect[fill="url(#caption-shade)"][y="1620"]')),
      progress: Boolean(svg?.querySelector('rect[y="1900"]')),
    };
  });
  const setOverlay = async (index: number, enabled: boolean) => page.evaluate(({ checkboxIndex, value }) => {
    const input = document.querySelectorAll<HTMLInputElement>(".editor-overlay-settings input[type=checkbox]")[checkboxIndex];
    if (!input) return false;
    if (input.checked !== value) input.click();
    return input.checked === value;
  }, { checkboxIndex: index, value: enabled });
  assert.deepEqual(await overlayState(), [true, true, true, true, true, false], "new projects default title/subtitles on and branding off");
  await waitFor(async () => {
    const state = await previewOverlayState();
    return state.texts.includes("DARI BATU JADI GUNUNG") && state.captions > 0;
  }, "title and timed subtitle show in Editor preview");
  assert.ok(await setOverlay(1, false) && await setOverlay(3, false), "title and subtitle toggles turn off");
  await waitFor(async () => {
    const state = await previewOverlayState();
    return !state.texts.includes("DARI BATU JADI GUNUNG") && state.captions === 0;
  }, "title and subtitle disappear from live preview");
  await saveEditor();
  latest = await fetch(`${apiUrl}/api/projects/${created.id}`).then((response) => json<any>(response));
  assert.ok(latest.visualStoryboard.scenes.every((scene: any) => scene.approved), "title/subtitle overlay edits keep visual approvals intact");
  assert.ok(await setOverlay(0, false) && await setOverlay(2, false) && await setOverlay(4, false), "category, scene label, and progress toggles turn off");
  await waitFor(async () => {
    const state = await previewOverlayState();
    return !state.headerShade && !state.footerShade && !state.progress;
  }, "unused overlay gradients and progress bar disappear").catch(async (error) => {
    const details = await page.evaluate(() => ({
      settings: [...document.querySelectorAll<HTMLInputElement>(".editor-overlay-settings input[type=checkbox]")].map((input) => input.checked),
      rects: [...document.querySelector<SVGSVGElement>(".editor-canvas-shell svg")?.querySelectorAll("rect") ?? []].map((rect) => ({ x: rect.getAttribute("x"), y: rect.getAttribute("y"), fill: rect.getAttribute("fill") })),
    }));
    throw new Error(`${error instanceof Error ? error.message : error}\n${JSON.stringify(details)}`);
  });
  assert.ok(await setOverlay(5, true), "branding can be enabled");
  await waitFor(async () => (await previewOverlayState()).texts.includes("AI FACTS STUDIO"), "branding appears immediately in preview");
  assert.ok(await setOverlay(5, false), "branding can be disabled");
  assert.ok(await setOverlay(0, true) && await setOverlay(1, true) && await setOverlay(2, true) && await setOverlay(3, true) && await setOverlay(4, true), "all non-brand overlays can be re-enabled");
  await waitFor(async () => {
    const state = await previewOverlayState();
    return state.texts.includes("DARI BATU JADI GUNUNG") && state.captions > 0 && state.headerShade && state.footerShade && state.progress;
  }, "restored overlays appear immediately in preview");
  assert.deepEqual(await overlayState(), [true, true, true, true, true, false], "overlay toggles restore expected settings");
  await saveEditor();
  await page.goto({ url: editorUrl, timeout: 30_000 });
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".video-editor-v2"))), "overlay settings reload");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".editor-inspector-toggle")?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Teks")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-overlay-settings") !== null), "overlay settings inspector reload");
  assert.deepEqual(await overlayState(), [true, true, true, true, true, false], "overlay preferences survive save and reload");

  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>(".editor-scene-item")[1]?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Transisi")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-motion-transition") !== null), "crossfade transition controls");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-motion-transition button")].find((button) => button.textContent?.trim() === "Crossfade")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>('.editor-motion-transition button[aria-pressed="true"]')?.textContent?.trim() === "Crossfade"), "Crossfade selected for GIF scene");
  await saveEditor();
  assert.ok(await seekEditor(69), "crossfade frame can be scrubbed");
  await waitFor(async () => {
    const state = await previewOverlayState();
    return state.texts.includes("LEMPENG TERUS BERGERAK") && state.captions > 0;
  }, "GIF title and timed subtitle remain visible during Crossfade preview");
  await waitFor(() => page.evaluate((file) => Boolean(document.querySelector(`.editor-canvas-shell video[src*="${file}"]`)), gifMedia.file), "GIF remains a moving-video layer during Crossfade");
  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>(".editor-scene-item")[2]?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-inspector-tabs button")].find((button) => button.textContent?.trim() === "Transisi")?.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".editor-motion-transition button")].find((button) => button.textContent?.trim() === "Cut")?.click());
  await waitFor(() => page.evaluate(() => document.querySelector<HTMLButtonElement>('.editor-motion-transition button[aria-pressed="true"]')?.textContent?.trim() === "Cut"), "Cut selected for procedural scene");
  await saveEditor();
  latest = await fetch(`${apiUrl}/api/projects/${created.id}`).then((response) => json<any>(response));

  const approvalBoard = structuredClone(latest.visualStoryboard);
  approvalBoard.scenes = approvalBoard.scenes.map((scene: any) => {
    const approved = { ...scene, authoringConfirmed: true, authoringStatus: "ready_for_review", approved: true, flowStatus: "approved" };
    approved.approvedFingerprint = visualApprovalFingerprint(approved);
    return approved;
  });
  await json(await fetch(`${apiUrl}/api/projects/${created.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: latest.researchPackage, visualStoryboard: approvalBoard }),
  }));

  const generated = await json<{ job: { id: string } }>(await fetch(`${apiUrl}/api/projects/${created.id}/generate`, { method: "POST" }));
  const renderResponse = await fetch(`${apiUrl}/api/jobs/${generated.job.id}/render`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ allowSilent: true }) });
  assert.equal(renderResponse.status, 202, await renderResponse.clone().text());
  await waitFor(async () => {
    if (apiServer && apiServer.exitCode !== null) throw new Error(`API exited during render (${apiServer.exitCode ?? "unknown"}).`);
    const response = await fetch(`${apiUrl}/api/jobs/${generated.job.id}`).catch(() => null);
    if (!response?.ok) return false;
    const job = await json<any>(response);
    return job.state === "rendered" || job.state === "failed";
  }, "mixed MP4/GIF/static render", 900);
  const finalJob = await fetch(`${apiUrl}/api/jobs/${generated.job.id}`).then((response) => json<any>(response));
  assert.equal(finalJob.state, "rendered", `Remotion mixed-media MP4 render: ${finalJob.error ?? ""}`);
  assert.equal(finalJob.manifest.videoCodec, "h264");
  assert.equal(finalJob.manifest.width, 1080);
  assert.equal(finalJob.manifest.height, 1920);
  assert.equal(finalJob.manifest.audioValidation, "pass-media", "explicitly enabled clip audio renders as validated AAC without requiring voiceover");
  assert.equal(finalJob.manifest.outroAssetId, outroAssetId, "render manifest records selected Outro asset");
  assert.ok(Math.abs(finalJob.manifest.durationSec - 7) < 0.15, `final MP4 includes trimmed Outro duration: ${finalJob.manifest.durationSec}s`);
  const mp4Bytes = Buffer.from(await (await fetch(`${apiUrl}${finalJob.downloadUrl}`)).arrayBuffer());
  const renderedPath = path.join(evidenceDir, "scene-media-mixed-e2e.mp4");
  await writeFile(renderedPath, mp4Bytes);
  for (const [label, time] of [["mp4", "0.5"], ["crossfade", "2.3"], ["gif", "3.3"], ["procedural", "5.5"], ["outro-first", "6.1"], ["outro-later", "6.8"]] as const) {
    const framePath = path.join(evidenceDir, `scene-media-${label}.png`);
    await runLocal("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", time, "-i", renderedPath, "-frames:v", "1", "-y", framePath]);
    assert.ok((await readFile(framePath)).length > 1000, `${label} MP4 frame decodes`);
  }
  assert.notDeepEqual(await readFile(path.join(evidenceDir, "scene-media-outro-first.png")), await readFile(path.join(evidenceDir, "scene-media-outro-later.png")), "rendered Outro contains moving frames, not a poster still");
  const renderSnapshot = JSON.parse(await readFile(path.join(tempDir, "data", "jobs", generated.job.id, "snapshot.json"), "utf8"));
  assert.deepEqual(renderSnapshot.outro, {
    assetId: outroAssetId, name: "Local moving outro", file: `outros/${outroFile}`,
    sha256: outroFile!.slice(0, 64), bytes: uploadedOutro.asset.bytes, durationSec: uploadedOutro.asset.durationSec,
    trimInSec: 0.2, trimOutSec: 1.2, audioEnabled: true,
  }, "immutable snapshot captures normalized Outro, trim, and audio choice");
  assert.deepEqual(renderSnapshot.research.scenes.map((scene: any) => Boolean(scene.sceneMedia)), [true, true, false], "immutable render snapshot keeps animated media separate from static composition");
  assert.equal(renderSnapshot.research.videoOverlaySettings.showTitle, true, "render snapshot keeps title enabled");
  assert.equal(renderSnapshot.research.videoOverlaySettings.showSubtitles, true, "render snapshot keeps subtitles enabled");
  assert.equal(renderSnapshot.research.videoOverlaySettings.showBranding, false, "render snapshot keeps branding disabled by default");
  assert.equal(renderSnapshot.research.scenes[1].motionPlan.find((plan: any) => ["cut", "dissolve", "slide-transition", "wipe"].includes(plan.cue))?.cue, "dissolve", "render snapshot keeps GIF Crossfade");
  assert.equal(renderSnapshot.research.scenes[2].motionPlan.find((plan: any) => ["cut", "dissolve", "slide-transition", "wipe"].includes(plan.cue))?.cue, "cut", "render snapshot keeps procedural Cut");
  assert.deepEqual(renderSnapshot.research.scenes[0].motionPlan, latest.researchPackage.scenes[0].motionPlan, "MP4 snapshot uses exact Motion Direction plan preview used");
  assert.equal(renderSnapshot.research.scenes[0].sceneMedia.shortClip, "loop", "render snapshot captures loop selection");
  await rm(path.join(root, "public/scene-media", mp4Media.file), { force: true });
  const mediaHealth = await fetch(`${apiUrl}/api/projects/${created.id}/scene-media-health`).then((response) => json<any>(response));
  assert.match(mediaHealth.errors[sceneIds[0]], /tidak tersedia/i, "missing Flow media surfaces an integrity error");
  const blockedSnapshot = await fetch(`${apiUrl}/api/projects/${created.id}/generate`, { method: "POST" });
  assert.equal(blockedSnapshot.status, 409, "missing Flow media cannot silently fall back during render snapshot creation");
  assert.equal((await blockedSnapshot.json()).code, "scene-media-integrity-failed");
  await page.goto({ url: editorUrl, timeout: 30_000 });
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".editor-media-error[role=alert]"))), "missing Flow media displays editor alert without composition fallback");
  const archiveResponse = await fetch(`${apiUrl}/api/outros/${outroAssetId}`, { method: "DELETE" });
  const archiveResult = await json<{ archived: boolean; projectReferences: number }>(archiveResponse);
  assert.equal(archiveResult.archived, true, "deleting Outro referenced by project/snapshot archives without removing media");
  assert.ok(archiveResult.projectReferences > 0);
  assert.match((await fetch(`${apiUrl}/outros/${outroFile}`)).headers.get("content-type") ?? "", /^video\/mp4/i, "archived Outro stays available to existing render snapshots");
  const deleted = await fetch(`${apiUrl}/api/projects/${created.id}`, { method: "DELETE" });
  assert.equal(deleted.status, 200, "project deletion succeeds after completed render");
  const deleteResult = await deleted.json() as { cleanupPending: number | null };
  assert.equal(deleteResult.cleanupPending, 0, `project and snapshot cleanup queue drains: ${JSON.stringify(deleteResult)}`);
  projectId = undefined;
  assert.doesNotMatch((await fetch(`${apiUrl}/outros/${outroFile}`)).headers.get("content-type") ?? "", /^video\/mp4/i, "archived Outro media cleans up after project and render snapshots are removed");
  assert.doesNotMatch((await fetch(`${apiUrl}/outros/${outroPosterFile}`)).headers.get("content-type") ?? "", /^image\/jpeg/i, "archived Outro poster cleans up with media");
  outroAssetId = undefined;
  for (const file of new Set(mediaFiles)) assert.equal(existsSync(path.join(root, "public/scene-media", file)), false, `unreferenced scene media cleans up after project and snapshots are deleted: ${file}`);
  console.log(`PASS: Outro Library/create/editor selection, trim/audio persistence, moving overlay-free preview/render, safe archive/delete; MP4/GIF scene media, overlay toggles, Cut/Crossfade. Evidence: ${evidenceDir}`);
} finally {
  if (projectId) { try { await fetch(`${apiUrl}/api/projects/${projectId}`, { method: "DELETE" }); } catch { /* isolated API may already be stopped */ } }
  if (outroAssetId) { try { await fetch(`${apiUrl}/api/outros/${outroAssetId}`, { method: "DELETE" }); } catch { /* isolated API may already be stopped */ } }
  if (assetFile) { try { await rm(path.join(root, "public/visual-assets", assetFile), { force: true }); } catch { /* project deletion may have cleaned it */ } }
  for (const file of mediaFiles) { try { await rm(path.join(root, "public/scene-media", file), { force: true }); } catch { /* fixture-only cleanup */ } }
  if (browser) await browser.close({ silent: true });
  await stop(viteServer);
  await stop(apiServer);
  await rm(tempDir, { recursive: true, force: true });
}
