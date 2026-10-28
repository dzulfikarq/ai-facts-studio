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
  const gifPath = path.join(tempDir, "moving-flow.gif");
  const imagePath = path.join(tempDir, "static-flow.png");
  await runLocal("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=24:duration=1.4", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=1.4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", "-y", mp4Path]);
  await runLocal("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x480:rate=12:duration=1.4", "-filter_complex", "[0:v]split[a][b];[a]palettegen[p];[b][p]paletteuse", "-loop", "0", "-y", gifPath]);
  await runLocal("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x8254ce:s=720x1280:d=1", "-frames:v", "1", "-y", imagePath]);

  apiServer = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(apiPort), VITE_PORT: String(vitePort), DATA_DIR: path.join(tempDir, "data"), DAILY_JOB_LIMIT: "5", TTS_MOCK_PROVIDER: "0", GEMINI_API_KEY: "", HF_TOKEN: "", HF_IMAGE_GENERATION_ENABLED: "false", HF_IMAGE_ALLOW_PAID: "false", OPENCODE_SERVER_URL: "http://127.0.0.1:4096" },
    stdio: "ignore",
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
  const created = await json<{ id: string; researchPackage: any; visualStoryboard: any }>(await fetch(`${apiUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage }),
  }));
  projectId = created.id;
  const sceneIds = created.researchPackage.scenes.map((scene: { id: string }) => scene.id) as string[];

  async function uploadMedia(sceneId: string, filePath: string, mimeType: string) {
    const form = new FormData();
    form.append("media", new Blob([await readFile(filePath)], { type: mimeType }), path.basename(filePath));
    const result = await json<{ media: any }>(await fetch(`${apiUrl}/api/projects/${created.id}/scenes/${encodeURIComponent(sceneId)}/media`, { method: "POST", body: form }));
    mediaFiles.push(result.media.file, result.media.posterFile);
    return result.media;
  }

  const mp4Media = await uploadMedia(sceneIds[0]!, mp4Path, "video/mp4");
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
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: fresh.researchPackage, visualStoryboard: normalizedBoard }),
  });
  const persisted = await json<any>(saved);
  assert.deepEqual(persisted.visualStoryboard.scenes.map((scene: any) => Boolean(scene.sceneMedia)), [true, true, false], "project persists two animated clips plus separate static illustration");
  assert.equal(persisted.researchPackage.scenes[0].sceneMedia.sha256, mp4Media.sha256, "MP4 metadata projects into persisted render input");
  assert.equal((await fetch(`${apiUrl}/scene-media/${encodeURIComponent(mp4Media.file)}`)).status, 200, "local normalized MP4 is served for preview/render");

  browser = await openBrowser("chrome", { logLevel: "error" });
  const browserLogs: string[] = [];
  const page = await browser.newPage({ context: () => null, logLevel: "error", indent: 0, pageIndex: 0, onBrowserLog: (log: unknown) => browserLogs.push(JSON.stringify(log)), onLog: (log: unknown) => browserLogs.push(JSON.stringify(log)) } as never);
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  const editorUrl = `${viteUrl}/projects/${created.id}/editor?scene=${encodeURIComponent(sceneIds[0]!)}`;
  await page.goto({ url: editorUrl, timeout: 30_000 });
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
    await waitFor(() => page.evaluate(() => document.querySelector(".editor-save-state")?.textContent?.trim() === "Tersimpan"), "scene media editor save");
  };
  const seekEditor = async (frame: number) => page.evaluate((value) => {
    const input = document.querySelector<HTMLInputElement>("#editor-playhead");
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true;
  }, frame);

  assert.ok(await setNumber(0, 0.1) && await setNumber(1, Math.max(0.4, mp4Media.durationSec - 0.1)), "trim controls accept a valid range");
  assert.ok(await setSelect(2, "freeze-last-frame"), "freeze-last-frame control exists");
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
  assert.equal(savedMedia.trimInSec, 0.1);
  assert.ok(Math.abs(savedMedia.trimOutSec - Math.max(0.4, mp4Media.durationSec - 0.1)) < 0.001);
  assert.equal(savedMedia.posterTrimOutSec, savedMedia.trimOutSec, "freeze poster regenerates for trimmed endpoint");
  assert.equal(savedMedia.shortClip, "freeze-last-frame");
  assert.equal(savedMedia.fit, "contain");
  assert.equal(savedMedia.position, "bottom");
  assert.equal(savedMedia.audioEnabled, true);

  await seekEditor(45);
  await waitFor(() => page.evaluate((poster) => Boolean(document.querySelector(`.editor-canvas-shell img[src*="${poster}"]`)), savedMedia.posterFile), "freeze mode holds trimmed last-frame poster beyond clip duration")
    .catch(async (error) => { throw new Error(`${error instanceof Error ? error.message : error}\n${JSON.stringify(await page.evaluate((poster) => ({ frame: document.querySelector<HTMLInputElement>("#editor-playhead")?.value, aria: document.querySelector<HTMLInputElement>("#editor-playhead")?.getAttribute("aria-valuetext"), time: document.querySelector(".editor-time-readout")?.textContent, inspector: document.querySelector(".editor-inspector-scene")?.textContent, videos: [...document.querySelectorAll<HTMLVideoElement>(".editor-canvas-shell video")].map((video) => ({ src: video.getAttribute("src"), time: video.currentTime, display: getComputedStyle(video).display })), images: [...document.querySelectorAll<HTMLImageElement>(".editor-canvas-shell img")].map((image) => image.getAttribute("src")), poster, html: document.querySelector(".editor-canvas-shell")?.innerHTML.slice(-1000) }), savedMedia.posterFile))}`); });
  await page.goto({ url: editorUrl, timeout: 30_000 });
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".editor-scene-media-controls"))), "trim/audio/freeze state reload");
  assert.deepEqual(await page.evaluate(() => ({
    trimIn: Number(document.querySelectorAll<HTMLInputElement>(".editor-scene-media-controls input[type=number]")[0]?.value),
    trimOut: Number(document.querySelectorAll<HTMLInputElement>(".editor-scene-media-controls input[type=number]")[1]?.value),
    shortClip: document.querySelectorAll<HTMLSelectElement>(".editor-scene-media-controls select")[2]?.value,
    fit: document.querySelectorAll<HTMLSelectElement>(".editor-scene-media-controls select")[0]?.value,
    audio: document.querySelector<HTMLInputElement>(".editor-media-audio input")?.checked,
  })), { trimIn: 0.1, trimOut: savedMedia.trimOutSec, shortClip: "freeze-last-frame", fit: "contain", audio: true }, "scene media controls survive editor reload");

  assert.ok(await setSelect(2, "loop"), "loop control exists");
  assert.ok(await setSelect(0, "cover") && await setSelect(1, "center"), "cover crop can be restored");
  await waitFor(() => page.evaluate(() => document.querySelectorAll<HTMLSelectElement>(".editor-scene-media-controls select")[2]?.value === "loop"), "loop selection updates editor state");
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
  assert.ok(playedTime >= playState.videoTime, `video playback time advances after seek/play: ${playState.videoTime} → ${playedTime}`);
  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>(".editor-scene-item")[2]?.click());
  await waitFor(() => page.evaluate(() => document.querySelector(".editor-inspector-scene")?.textContent?.includes("SCENE 03") ?? false), "static image scene selection");
  assert.ok(await page.evaluate(() => document.querySelectorAll(".editor-canvas-shell image").length > 0), "static imported image remains separate from video scene media");

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
    const job = await fetch(`${apiUrl}/api/jobs/${generated.job.id}`).then((response) => json<any>(response));
    return job.state === "rendered" || job.state === "failed";
  }, "mixed MP4/GIF/static render", 900);
  const finalJob = await fetch(`${apiUrl}/api/jobs/${generated.job.id}`).then((response) => json<any>(response));
  assert.equal(finalJob.state, "rendered", `Remotion mixed-media MP4 render: ${finalJob.error ?? ""}`);
  assert.equal(finalJob.manifest.videoCodec, "h264");
  assert.equal(finalJob.manifest.width, 1080);
  assert.equal(finalJob.manifest.height, 1920);
  assert.equal(finalJob.manifest.audioValidation, "pass-media", "explicitly enabled clip audio renders as validated AAC without requiring voiceover");
  const mp4Bytes = Buffer.from(await (await fetch(`${apiUrl}${finalJob.downloadUrl}`)).arrayBuffer());
  const renderedPath = path.join(evidenceDir, "scene-media-mixed-e2e.mp4");
  await writeFile(renderedPath, mp4Bytes);
  for (const [label, time] of [["start", "0.5"], ["middle", "3"], ["end", "5.5"]] as const) {
    const framePath = path.join(evidenceDir, `scene-media-${label}.png`);
    await runLocal("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", time, "-i", renderedPath, "-frames:v", "1", "-y", framePath]);
    assert.ok((await readFile(framePath)).length > 1000, `${label} MP4 frame decodes`);
  }
  const renderSnapshot = JSON.parse(await readFile(path.join(tempDir, "data", "jobs", generated.job.id, "snapshot.json"), "utf8"));
  assert.deepEqual(renderSnapshot.research.scenes.map((scene: any) => Boolean(scene.sceneMedia)), [true, true, false], "immutable render snapshot keeps animated media separate from static composition");
  assert.equal(renderSnapshot.research.scenes[0].sceneMedia.shortClip, "loop", "render snapshot captures loop selection");
  const deleted = await fetch(`${apiUrl}/api/projects/${created.id}`, { method: "DELETE" });
  assert.equal(deleted.status, 200, "project deletion succeeds after completed render");
  const deleteResult = await deleted.json() as { cleanupPending: number | null };
  assert.equal(deleteResult.cleanupPending, 0, `project and snapshot cleanup queue drains: ${JSON.stringify(deleteResult)}`);
  projectId = undefined;
  for (const file of new Set(mediaFiles)) assert.equal(existsSync(path.join(root, "public/scene-media", file)), false, `unreferenced scene media cleans up after project and snapshots are deleted: ${file}`);
  console.log(`PASS: MP4 + animated GIF normalization, static image mix, API persistence/reload, preview playback/seek/pause, trim/crop, freeze/loop, opt-in audio, Remotion MP4 and sampled frames. Evidence: ${evidenceDir}`);
} finally {
  if (projectId) { try { await fetch(`${apiUrl}/api/projects/${projectId}`, { method: "DELETE" }); } catch { /* isolated API may already be stopped */ } }
  if (assetFile) { try { await rm(path.join(root, "public/visual-assets", assetFile), { force: true }); } catch { /* project deletion may have cleaned it */ } }
  for (const file of mediaFiles) { try { await rm(path.join(root, "public/scene-media", file), { force: true }); } catch { /* fixture-only cleanup */ } }
  if (browser) await browser.close({ silent: true });
  await stop(viteServer);
  await stop(apiServer);
  await rm(tempDir, { recursive: true, force: true });
}
