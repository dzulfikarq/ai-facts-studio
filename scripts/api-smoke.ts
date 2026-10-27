import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { visualApprovalFingerprint, type VisualStoryboardScene } from "../src/domain/visual-storyboard";
import { RENDERER_VERSION } from "../src/video/renderer-version";

const execFileAsync = promisify(execFile);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-facts-api-smoke-"));
const dataPath = path.join(tempDir, "data");
const databasePath = path.join(dataPath, "ai-facts-studio.sqlite");
const legacyProjectId = "legacy-project-v1";
const legacyJobId = "legacy-job-v1";
await mkdir(path.join(dataPath, "jobs", legacyJobId), { recursive: true });
const legacyPackage = JSON.parse(await readFile("samples/mountain-formation.json", "utf8"));
const legacyNow = new Date().toISOString();
const legacySnapshotPath = path.join(dataPath, "jobs", legacyJobId, "snapshot.json");
await writeFile(legacySnapshotPath, JSON.stringify({ research: legacyPackage, audio: null }));
const oldDb = new DatabaseSync(path.join(dataPath, "ai-facts-studio.sqlite"));
oldDb.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), source_sha256 TEXT NOT NULL, snapshot_path TEXT NOT NULL,
    state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT, progress INTEGER NOT NULL DEFAULT 0,
    attempt_count INTEGER NOT NULL DEFAULT 0, output_path TEXT, manifest_json TEXT, UNIQUE(project_id, source_sha256)
  );
  CREATE TABLE render_attempts (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), attempt INTEGER NOT NULL, state TEXT NOT NULL, requested_at TEXT NOT NULL, finished_at TEXT, error TEXT, manifest_json TEXT);
  CREATE TABLE ai_generation_attempts (
    id TEXT PRIMARY KEY, requested_at TEXT NOT NULL, task TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
    state TEXT NOT NULL, error_code TEXT
  );
`);
const legacyProject = { researchPackage: legacyPackage, audio: null, researchReviewStatus: "needs-review" };
oldDb.prepare("INSERT INTO projects (id,title,data_json,created_at,updated_at) VALUES (?,?,?,?,?)")
  .run(legacyProjectId, legacyPackage.title, JSON.stringify(legacyProject), legacyNow, legacyNow);
oldDb.prepare("INSERT INTO jobs (id,project_id,source_sha256,snapshot_path,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
  .run(legacyJobId, legacyProjectId, "legacy-source", legacySnapshotPath, "preview-ready", legacyNow, legacyNow);
oldDb.close();

async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

const port = await freePort();
const vitePort = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const viteUrl = `http://127.0.0.1:${vitePort}`;
function setPersistedAiMode(mode: "development" | "production") {
  // ponytail: switch SQLite mode directly to test production quota without making Gemini calls.
  const settingsDb = new DatabaseSync(databasePath);
  settingsDb.prepare("UPDATE ai_generation_settings SET mode = ? WHERE id = 1").run(mode);
  settingsDb.close();
}
const server = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: "test", TTS_MOCK_PROVIDER: "0", GEMINI_API_KEY: "", GEMINI_TTS_FREE_TIER_ONLY: "false", GEMINI_TEXT_MODEL: "", GEMINI_TEXT_FREE_TIER_ONLY: "false", HF_TOKEN: "", HF_IMAGE_GENERATION_ENABLED: "false", HF_IMAGE_ALLOW_PAID: "false", AI_GENERATION_DAILY_REQUEST_LIMIT: "2", OPENCODE_SERVER_URL: "http://localhost:4096", OPENCODE_SERVER_PASSWORD: "smoke-password", DAILY_JOB_LIMIT: "3", HOST: "127.0.0.1", PORT: String(port), VITE_PORT: String(vitePort), DATA_DIR: dataPath },
  stdio: "ignore",
});
let serverExit: string | null = null;
server.on("exit", (code, signal) => { serverExit = `exit ${code ?? "null"} signal ${signal ?? "null"}`; });
server.on("error", (error) => { serverExit = error.message; });
let viteServer: ReturnType<typeof spawn> | undefined;
let projectId: string | undefined;
let assetProjectId: string | undefined;
let reusableTargetId: string | undefined;
let jobAudioPath: string | undefined;
let jobSnapshotPath: string | undefined;
let projectUploadPath: string | undefined;
let assetUploadPath: string | undefined;
let flowAssetPath: string | undefined;
let jobId: string | undefined;
let renderOutputPath: string | undefined;

try {
  let ready = false;
  let lastStartupResponse = "no response";
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/status`);
      if (response.ok) { ready = true; break; }
      lastStartupResponse = `HTTP ${response.status}`;
    } catch (error) { lastStartupResponse = error instanceof Error ? error.message : "network error"; /* API still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(ready, true, `local API should start (${serverExit ?? "running"}; ${lastStartupResponse})`);
  assert.equal((await fetch(baseUrl)).status, 200, "production UI should be served");
  viteServer = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], {
    cwd: process.cwd(),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), VITE_PORT: String(vitePort) },
    stdio: "ignore",
  });
  let viteReady = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      if ((await fetch(`${viteUrl}/api/status`)).ok) { viteReady = true; break; }
    } catch { /* Vite or proxy still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(viteReady, true, "Vite frontend and API proxy should start on configured port");
  const migratedProject = await fetch(`${baseUrl}/api/projects/${legacyProjectId}`).then((response) => response.json());
  assert.equal(migratedProject.researchPackage.schemaVersion, "1.1", "legacy v1.0 project should migrate on read");
  assert.equal(migratedProject.latestJob.rendererVersion, 1, "legacy jobs should retain V1 renderer metadata");
  assert.equal(migratedProject.latestJobContentCurrent, true, "legacy snapshot should remain current after compatible migration");
  const migratedStatus = await fetch(`${baseUrl}/api/status`).then((response) => response.json());
  assert.equal(migratedStatus.jobsUsed, 1, "legacy jobs should backfill rolling quota history");
  assert.equal(migratedStatus.generationMode, "development");
  assert.equal(migratedStatus.nextAllowedAt, null, "Development status hides production quota countdown");
  const [ttsStatus, ttsCatalog] = await Promise.all([
    fetch(`${baseUrl}/api/tts/status`).then((response) => response.json()),
    fetch(`${baseUrl}/api/tts/voices?locale=id-ID`).then((response) => response.json()),
  ]);
  assert.equal(ttsStatus.requestsRemaining, ttsStatus.dailyLimit, "TTS status reports rolling synthesis quota without secrets");
  assert.equal(ttsCatalog.locales[0].locale, "id-ID", "Indonesian should be first/default locale");
  assert.ok(ttsCatalog.voices.length > 0, "official prebuilt fallback catalog should keep voice selector populated");
  assert.equal(ttsCatalog.catalogSource, "fallback");

  const getAiSettings = () => fetch(`${baseUrl}/api/settings/ai-generation`);
  const initialAiSettings = await getAiSettings().then((response) => response.json());
  assert.equal(initialAiSettings.mode, "development", "AI generation defaults to Development independent of NODE_ENV");
  assert.equal(initialAiSettings.generationAvailable, true, "Development mode exposes the explicit manual prompt/import flow");
  assert.equal(initialAiSettings.providers.development.id, "opencode-local");
  assert.equal(initialAiSettings.providers.development.configured, false, "Development status fails closed without a valid authenticated OpenCode loopback endpoint");
  assert.equal(JSON.stringify(initialAiSettings).includes("smoke-password"), false, "OpenCode auth never reaches browser settings response");
  assert.equal(initialAiSettings.providers.production.configured, false);
  assert.equal(typeof initialAiSettings.providers.production.apiKeyConfigured, "boolean", "settings expose only backend key presence, never key value");
  assert.equal(initialAiSettings.providers.production.quotaMonitoring.usageSource, "local-records");
  assert.equal(initialAiSettings.providers.production.quotaMonitoring.tpm.used, null, "TPM stays unavailable until provider reports token usage");
  assert.ok(!("apiKey" in initialAiSettings.providers.production), "API key must not be exposed to frontend");
  const developmentRequest = { input: { topic: "Kenapa langit biru?", language: "id-ID", targetDurationSec: 30, deliveryStyle: "edukatif", additionalInstructions: "", sourceUrls: [] }, model: "openai/gpt-5-mini" };
  const missingOrigin = await fetch(`${baseUrl}/api/ai-generation`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(developmentRequest) });
  assert.equal(missingOrigin.status, 403, "model-trigger endpoint requires same-origin request");
  const crossOrigin = await fetch(`${baseUrl}/api/ai-generation`, { method: "POST", headers: { "content-type": "application/json", origin: "https://attacker.example" }, body: JSON.stringify(developmentRequest) });
  assert.equal(crossOrigin.status, 403, "cross-origin model trigger is rejected");
  const unproxiedFrontendOrigin = await fetch(`${baseUrl}/api/ai-generation`, { method: "POST", headers: { "content-type": "application/json", origin: viteUrl }, body: JSON.stringify(developmentRequest) });
  assert.equal(unproxiedFrontendOrigin.status, 403, "frontend-port Origin is rejected when request did not pass through trusted Vite proxy");
  const proxiedCrossOrigin = await fetch(`${viteUrl}/api/ai-generation`, { method: "POST", headers: { "content-type": "application/json", origin: "https://attacker.example" }, body: JSON.stringify(developmentRequest) });
  assert.equal(proxiedCrossOrigin.status, 403, "Vite proxy marker does not bypass remote-origin rejection");
  const proxiedGeneration = await fetch(`${viteUrl}/api/ai-generation`, {
    method: "POST", headers: { "content-type": "application/json", origin: viteUrl }, body: JSON.stringify(developmentRequest),
  });
  assert.equal(proxiedGeneration.status, 503, "request through configured Vite port passes Origin guard and reaches OpenCode provider gate");
  assert.equal((await proxiedGeneration.json()).code, "opencode-unavailable", "proxy request is not rejected as invalid-origin");
  const developmentGeneration = await fetch(`${baseUrl}/api/ai-generation`, {
    method: "POST", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify(developmentRequest),
  });
  assert.equal(developmentGeneration.status, 503, "Development one-click generation requires authenticated loopback OpenCode");
  assert.equal((await developmentGeneration.json()).code, "opencode-unavailable");
  assert.equal((await fetch(`${baseUrl}/api/settings/ai-generation`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "staging" }) })).status, 400, "backend validates mode values");
  assert.equal((await fetch(`${baseUrl}/api/settings/ai-generation`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "production" }) })).status, 409, "unconfigured/paid-capable Production cannot be selected");
  const unchangedAiSettings = await getAiSettings().then((response) => response.json());
  assert.equal(unchangedAiSettings.mode, "development", "rejected Production change must leave persisted mode unchanged");
  assert.equal((await fetch(`${baseUrl}/api/tts/status`).then((response) => response.json())).requestsUsed, ttsStatus.requestsUsed, "AI settings do not consume TTS quota");
  assert.equal((await fetch(`${baseUrl}/api/settings/ai-generation`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "development" }) })).status, 200, "Development choice persists through backend settings");
  const settingsDb = new DatabaseSync(path.join(dataPath, "ai-facts-studio.sqlite"));
  assert.equal((settingsDb.prepare("SELECT mode FROM ai_generation_settings WHERE id = 1").get() as { mode: string }).mode, "development", "mode preference is stored in SQLite");
  const generationColumns = settingsDb.prepare("PRAGMA table_info(ai_generation_attempts)").all() as Array<{ name: string }>;
  assert.ok(["input_tokens", "output_tokens", "total_tokens"].every((name) => generationColumns.some((column) => column.name === name)), "existing AI usage table migrates optional token usage fields");
  settingsDb.close();

  const research = await fetch(`${baseUrl}/api/sample`).then((response) => response.json());
  const volcanoSampleResponse = await fetch(`${baseUrl}/api/sample?topic=volcano-formation`);
  assert.equal(volcanoSampleResponse.status, 200, "volcano education sample is available through explicit topic selection");
  const volcanoSample = await volcanoSampleResponse.json();
  assert.equal(volcanoSample.id, "volcano-formation-id");
  assert.equal(volcanoSample.scenes.length, 6);
  const approveScene = (scene: VisualStoryboardScene) => {
    const approved = { ...scene, authoringStatus: scene.authoringStatus === "needs_review" ? "ready_for_review" : scene.authoringStatus, approved: true };
    return { ...approved, approvedFingerprint: visualApprovalFingerprint(approved) };
  };
  const approveVisuals = async (id: string) => {
    const current = await fetch(`${baseUrl}/api/projects/${id}`).then((response) => response.json());
    const storyboard = { ...current.visualStoryboard, scenes: current.visualStoryboard.scenes.map(approveScene) };
    const response = await fetch(`${baseUrl}/api/projects/${id}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: current.researchPackage, visualStoryboard: storyboard }),
    });
    assert.equal(response.status, 200, "approved storyboard persists through project API");
    return response.json();
  };
  const requestId = "7ae1a87d-c840-4a13-9a17-55de36cce721";
  const createIdempotently = (researchPackage: unknown) => fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage, requestId }),
  });
  const projectCountBeforeIdempotentCreate = (await fetch(`${baseUrl}/api/projects`).then((response) => response.json())).length;
  const firstIdempotentCreate = await createIdempotently(research);
  const firstIdempotentProject = await firstIdempotentCreate.json();
  assert.equal(firstIdempotentProject.researchPackage.scenes.length, research.scenes.length, "saved record retains all narrative scenes");
  assert.equal(firstIdempotentProject.visualStoryboard.scenes.length, research.scenes.length, "saved record includes generated Visual Storyboard");
  const approvedSavedBoard = { ...firstIdempotentProject.visualStoryboard, scenes: firstIdempotentProject.visualStoryboard.scenes.map(approveScene) };
  const boardSave = await fetch(`${baseUrl}/api/projects/${firstIdempotentProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: firstIdempotentProject.researchPackage, visualStoryboard: approvedSavedBoard }),
  });
  assert.equal(boardSave.status, 200);
  const reopenedSavedProject = await fetch(`${baseUrl}/api/projects/${firstIdempotentProject.id}`).then((response) => response.json());
  assert.ok(reopenedSavedProject.visualStoryboard.scenes.every((scene: { approved: boolean }) => scene.approved), "reopening record restores per-scene approvals");
  assert.deepEqual(reopenedSavedProject.researchPackage.scenes.map((scene: { narrationText: string }) => scene.narrationText), research.scenes.map((scene: { narrationText: string }) => scene.narrationText), "reopening record restores narration");
  const repeatedIdempotentCreate = await createIdempotently(research);
  const repeatedIdempotentProject = await repeatedIdempotentCreate.json();
  assert.equal(firstIdempotentCreate.status, 201);
  assert.equal(repeatedIdempotentCreate.status, 200);
  assert.equal(repeatedIdempotentProject.id, firstIdempotentProject.id, "same AI draft request ID must not create duplicate projects");
  assert.ok(repeatedIdempotentProject.visualStoryboard.scenes.every((scene: { approved: boolean }) => scene.approved), "idempotent save keeps persisted review approvals");
  assert.equal((await fetch(`${baseUrl}/api/projects`).then((response) => response.json())).length, projectCountBeforeIdempotentCreate + 1, "retry creates exactly one Video Library record");
  assert.equal((await createIdempotently({ ...research, title: `${research.title} changed` })).status, 409, "request ID cannot be reused for a different project payload");
  assert.equal((await fetch(`${baseUrl}/api/projects/${firstIdempotentProject.id}`, { method: "DELETE" })).status, 200);

  const preparationProject = await fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: research }),
  }).then((response) => response.json());
  const preparationBoard = structuredClone(preparationProject.visualStoryboard);
  preparationBoard.scenes[1] = approveScene(preparationBoard.scenes[1]);
  preparationBoard.scenes[0] = {
    ...preparationBoard.scenes[0],
    composition: { background: preparationBoard.palette.canvas, layers: [{ id: "visual-world", depth: 0.5, nodes: [{ type: "shape", shape: "rect", x: 0, y: 0, width: 1080, height: 1920, fill: preparationBoard.palette.canvas }] }] },
    compositionSource: "existing", authoringStatus: "needs_visual_authoring", authoringConfirmed: false,
    missingVisuals: ["mountain scene"], warnings: ["test: unresolved visual"], approved: false, approvedFingerprint: null,
  };
  const preparationSave = await fetch(`${baseUrl}/api/projects/${preparationProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: preparationProject.researchPackage, visualStoryboard: preparationBoard }),
  });
  assert.equal(preparationSave.status, 200, "test project stores one approved and one unresolved scene");
  const preparationRequestId = "143d8d30-ef0b-4928-a48d-86d3df7c95e4";
  const preparationHeaders = { "content-type": "application/json", origin: baseUrl };
  const preparationStart = await fetch(`${baseUrl}/api/projects/${preparationProject.id}/visual-preparation`, {
    method: "POST", headers: preparationHeaders, body: JSON.stringify({ requestId: preparationRequestId }),
  });
  assert.equal(preparationStart.status, 202);
  const startedJob = await preparationStart.json();
  const preparationReplay = await fetch(`${baseUrl}/api/projects/${preparationProject.id}/visual-preparation`, {
    method: "POST", headers: preparationHeaders, body: JSON.stringify({ requestId: preparationRequestId }),
  }).then((response) => response.json());
  assert.equal(preparationReplay.job.id, startedJob.job.id, "duplicate preparation request reuses persisted job");
  const changedPreparationReplay = await fetch(`${baseUrl}/api/projects/${preparationProject.id}/visual-preparation`, {
    method: "POST", headers: preparationHeaders, body: JSON.stringify({ requestId: preparationRequestId, sceneIds: [preparationBoard.scenes[0].sceneId] }),
  });
  assert.equal(changedPreparationReplay.status, 409, "request ID cannot be reused with different scene selection");
  assert.equal((await changedPreparationReplay.json()).code, "idempotency-conflict");
  let finalPreparation: any;
  for (let attempt = 0; attempt < 100; attempt++) {
    finalPreparation = await fetch(`${baseUrl}/api/projects/${preparationProject.id}/visual-preparation`).then((response) => response.json());
    if (finalPreparation.job?.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(["completed", "partial_failure", "failed"].includes(finalPreparation.job.status), "batch reaches persisted terminal status");
  assert.equal(finalPreparation.job.processed, finalPreparation.job.total, "batch progress accounts for every project scene");
  assert.equal(finalPreparation.job.approved, 1, "already-approved scene is counted and never regenerated");
  const reopenedPreparation = await fetch(`${baseUrl}/api/projects/${preparationProject.id}`).then((response) => response.json());
  assert.equal(reopenedPreparation.visualPreparation.id, startedJob.job.id, "project reopening restores preparation status");
  assert.equal(reopenedPreparation.visualStoryboard.scenes[1].approved, true, "batch preserves existing approval and fingerprint");
  assert.ok(reopenedPreparation.visualStoryboard.scenes[0].composition.layers.length > 1, "Smart Hybrid replaced unresolved placeholder with local composition");
  assert.equal((await fetch(`${baseUrl}/api/projects/${preparationProject.id}`, { method: "DELETE" })).status, 200);

  const silentProject = await fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: research }),
  }).then((response) => response.json());
  const blockedVisualRender = await fetch(`${baseUrl}/api/projects/${silentProject.id}/generate`, { method: "POST" });
  assert.equal(blockedVisualRender.status, 409, "unapproved Visual Storyboard blocks snapshot creation");
  assert.equal((await blockedVisualRender.json()).code, "visual-storyboard-not-approved");
  await approveVisuals(silentProject.id);
  const silentJob = await fetch(`${baseUrl}/api/projects/${silentProject.id}/generate`, { method: "POST" }).then((response) => response.json());
  assert.equal(silentJob.job.state, "preview-ready");
  const silentRenderResponse = await fetch(`${baseUrl}/api/jobs/${silentJob.job.id}/render`, { method: "POST" });
  const silentRender = await silentRenderResponse.json();
  assert.equal(silentRenderResponse.status, 409);
  assert.equal(silentRender.code, "silent-render-confirmation-required", "API also requires explicit confirmation for a silent snapshot");
  assert.equal((await fetch(`${baseUrl}/api/projects/${silentProject.id}`, { method: "DELETE" })).status, 200);

  const assetProject = await fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: research }),
  }).then((response) => response.json());
  assetProjectId = assetProject.id;
  const tablerSearch = await fetch(`${baseUrl}/api/asset-packs/tabler?q=rainbow&page=1&pageSize=1`).then((response) => response.json());
  assert.equal(tablerSearch.icons.length, 1, "Tabler search returns bounded page");
  assert.ok(tablerSearch.total >= 1 && tablerSearch.categories.length > 0, "Tabler index exposes real package metadata and category facets");
  const tablerPreview = await fetch(`${baseUrl}/api/asset-packs/tabler/icons/rainbow.svg`);
  const tablerSvg = await tablerPreview.text();
  assert.equal(tablerPreview.status, 200);
  assert.match(tablerSvg, /<svg/);
  assert.doesNotMatch(tablerSvg, /script|onload|foreignObject/i, "Tabler preview contains only generated safe path nodes");
  const importedTablerResponse = await fetch(`${baseUrl}/api/projects/${assetProject.id}/asset-packs/tabler/rainbow/import`, { method: "POST" });
  const importedTabler = await importedTablerResponse.json();
  assert.equal(importedTablerResponse.status, 201, importedTabler.error);
  assert.equal(importedTabler.asset.license, "MIT License");
  assert.match(importedTabler.asset.attribution, /Copyright.*Paweł Kuna.*MIT/i);
  assert.equal(importedTabler.asset.format, "svg");
  const blockedThumbnail = await fetch(`${baseUrl}/api/openverse/thumbnail?url=${encodeURIComponent("https://127.0.0.1/private.png")}`);
  assert.equal(blockedThumbnail.status, 502, "thumbnail proxy refuses URLs not returned by an active Openverse search");
  const unselectedOpenverseImport = await fetch(`${baseUrl}/api/projects/${assetProject.id}/openverse/00000000-0000-0000-0000-000000000000/import`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Unselected fixture" }),
  });
  const unselectedResult = await unselectedOpenverseImport.json();
  assert.equal(unselectedOpenverseImport.status, 502);
  assert.match(unselectedResult.error, /Pilih ulang gambar dari hasil pencarian Openverse/, "API import rejects IDs absent from active selected search results without an external request");
  const pngPath = path.join(tempDir, "illustration.png");
  await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=teal:s=128x96:d=1", "-frames:v", "1", "-y", pngPath]);
  const pngBytes = await readFile(pngPath);
  const imageForm = new FormData();
  imageForm.append("illustration", new Blob([pngBytes], { type: "image/png" }), "ocean.png");
  imageForm.append("name", "Ocean layer");
  const imageUpload = await fetch(`${baseUrl}/api/projects/${assetProject.id}/visual-assets`, { method: "POST", body: imageForm });
  const uploadedVisual = await imageUpload.json();
  assert.equal(imageUpload.status, 201, uploadedVisual.error);
  assert.ok(["png", "webp"].includes(uploadedVisual.asset.format), "valid raster upload may retain or optimize to WebP");
  assert.equal(uploadedVisual.asset.width, 128);
  assert.equal(uploadedVisual.asset.source, "user-upload");
  assert.equal(uploadedVisual.asset.originalName, "ocean.png");
  assert.equal(uploadedVisual.asset.originalMimeType, "image/png");
  assert.equal(uploadedVisual.asset.originalBytes, pngBytes.length);
  assert.match(uploadedVisual.asset.originalSha256, /^[a-f0-9]{64}$/);
  assetUploadPath = path.resolve("public/visual-assets", uploadedVisual.asset.file);
  assert.equal((await fetch(`${baseUrl}/visual-assets/${uploadedVisual.asset.file}`)).status, 200, "content-hash image route serves uploaded asset");

  const batchColors = ["red", "blue", "green", "yellow", "purple"];
  const batchForm = new FormData();
  const batchMetadata = [];
  for (const [index, color] of batchColors.entries()) {
    const batchPath = path.join(tempDir, `batch-${index}.png`);
    await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${color}:s=128x96:d=1`, "-frames:v", "1", "-y", batchPath]);
    batchForm.append("illustrations", new Blob([await readFile(batchPath)], { type: "image/png" }), `flow-scene-${index + 1}.png`);
    batchMetadata.push({ name: `Flow batch ${index + 1}`, source: "ai-generated", prompt: `Prompt scene ${index + 1}`, provider: "Google Flow (manual import)", model: "Google Flow", license: "User-provided; Google Flow output imported manually", semanticTags: [`scene-${index + 1}`], supportedConcepts: [`concept-${index + 1}`] });
  }
  batchForm.append("illustrations", new Blob([Buffer.from("invalid image bytes")], { type: "image/png" }), "flow-scene-invalid.png");
  batchMetadata.push({ name: "Invalid scene", source: "ai-generated", prompt: "Invalid fixture", provider: "Google Flow (manual import)" });
  batchForm.append("metadata", JSON.stringify(batchMetadata));
  const batchResponse = await fetch(`${baseUrl}/api/projects/${assetProject.id}/visual-assets/batch`, { method: "POST", body: batchForm });
  const batchUpload = await batchResponse.json();
  assert.equal(batchResponse.status, 201, batchUpload.error);
  assert.equal(batchUpload.results.length, 5, "six-file batch persists every valid image");
  assert.equal(batchUpload.failures.length, 1, "one invalid image does not discard successful batch imports");
  assert.equal(batchUpload.failures[0].index, 5, "partial failure maps to original file order");
  assert.equal(batchUpload.project.visualAssets.length, uploadedVisual.project.visualAssets.length + 5, "batch response includes all project assets");
  assert.deepEqual(batchUpload.results.map((entry: { index: number }) => entry.index), [0, 1, 2, 3, 4], "batch results preserve file order");
  assert.ok(batchUpload.results.every((entry: { asset: { source: string; provider: string; prompt: string } }, index: number) => entry.asset.source === "ai-generated" && entry.asset.provider === "Google Flow (manual import)" && entry.asset.prompt === `Prompt scene ${index + 1}`), "batch keeps per-file Flow metadata");

  const flowPngPath = path.join(tempDir, "flow-fixture.png");
  await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=purple:s=128x96:d=1", "-frames:v", "1", "-y", flowPngPath]);
  const flowPngBytes = await readFile(flowPngPath);
  const flowForm = new FormData();
  flowForm.append("illustration", new Blob([flowPngBytes], { type: "image/png" }), "flow-scene-01.png");
  flowForm.append("name", "Flow scene one fixture");
  flowForm.append("source", "ai-generated");
  flowForm.append("provider", "Google Flow (manual import)");
  flowForm.append("model", "Google Flow");
  flowForm.append("prompt", "One premium editorial illustration for scene one.");
  flowForm.append("license", "User-provided; Google Flow output imported manually");
  const flowUpload = await fetch(`${baseUrl}/api/projects/${assetProject.id}/visual-assets`, { method: "POST", body: flowForm });
  const flowVisual = await flowUpload.json();
  assert.equal(flowUpload.status, 201, flowVisual.error);
  assert.equal(flowVisual.asset.source, "ai-generated");
  assert.equal(flowVisual.asset.provider, "Google Flow (manual import)");
  assert.equal(flowVisual.asset.prompt, "One premium editorial illustration for scene one.");
  assert.equal(flowVisual.asset.originalName, "flow-scene-01.png");
  assert.equal(flowVisual.asset.originalMimeType, "image/png");
  assert.equal(flowVisual.asset.originalBytes, flowPngBytes.length);
  assert.match(flowVisual.asset.originalSha256, /^[a-f0-9]{64}$/);
  assert.match(flowVisual.asset.usageMetadata, /imported manually; provider origin not independently verified/);
  flowAssetPath = path.resolve("public/visual-assets", flowVisual.asset.file);

  const wrongMimeForm = new FormData();
  wrongMimeForm.append("illustration", new Blob([pngBytes], { type: "image/jpeg" }), "spoof.jpg");
  const wrongMime = await fetch(`${baseUrl}/api/projects/${assetProject.id}/visual-assets`, { method: "POST", body: wrongMimeForm });
  assert.equal(wrongMime.status, 400, "uploaded MIME must match raster signature");

  const imageScene = uploadedVisual.project.visualStoryboard.scenes[0];
  const imageBoard = structuredClone(uploadedVisual.project.visualStoryboard);
  imageBoard.styleLock.referenceAssetIds = [flowVisual.asset.id];
  const imageComposition = (assetId: string) => ({ background: imageBoard.palette.canvas, layers: [{ id: "user-illustration", depth: 0.72, nodes: [{ type: "image", asset: assetId, x: 100, y: 510, width: 880, height: 900 }] }] });
  imageBoard.scenes[0] = { ...imageScene, flowPrompt: "One finished raster illustration; do not render text.", flowStatus: "illustration-imported", composition: imageComposition(`upload-${"f".repeat(64)}.png`), compositionSource: "manual", layout: "existing-composition", authoringStatus: "needs_review", authoringConfirmed: false, approved: false, approvedFingerprint: null, relationships: [] };
  const unknownAssetSave = await fetch(`${baseUrl}/api/projects/${assetProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: uploadedVisual.project.researchPackage, visualStoryboard: imageBoard }),
  });
  assert.equal(unknownAssetSave.status, 400, "project cannot reference an asset it does not own");
  imageBoard.scenes[0] = { ...imageBoard.scenes[0], composition: imageComposition(flowVisual.asset.id) };
  const validAssetSave = await fetch(`${baseUrl}/api/projects/${assetProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: uploadedVisual.project.researchPackage, visualStoryboard: imageBoard }),
  });
  assert.equal(validAssetSave.status, 200, "owned upload persists in Visual Storyboard");
  const reopenedFlowProject = await fetch(`${baseUrl}/api/projects/${assetProject.id}`).then((response) => response.json());
  assert.equal(reopenedFlowProject.visualStoryboard.styleLock.referenceAssetIds[0], flowVisual.asset.id, "project Style Lock reference persists through SQLite");
  assert.equal(reopenedFlowProject.visualStoryboard.scenes[0].flowPrompt, imageBoard.scenes[0].flowPrompt, "edited Flow prompt persists through SQLite");
  assert.equal(reopenedFlowProject.visualStoryboard.scenes[0].sceneToken, imageScene.sceneToken, "stable scene token survives project save/reload");
  assert.equal(reopenedFlowProject.visualStoryboard.scenes[0].flowStatus, "illustration-imported");
  const invalidReferenceBoard = structuredClone(reopenedFlowProject.visualStoryboard);
  invalidReferenceBoard.styleLock.referenceAssetIds = [`upload-${"e".repeat(64)}.webp`];
  assert.equal((await fetch(`${baseUrl}/api/projects/${assetProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: reopenedFlowProject.researchPackage, visualStoryboard: invalidReferenceBoard }),
  })).status, 400, "Style Lock cannot reference another project's or missing asset");
  const approvedFlowBoard = structuredClone(reopenedFlowProject.visualStoryboard);
  approvedFlowBoard.scenes[0] = approveScene(approvedFlowBoard.scenes[0]);
  assert.equal((await fetch(`${baseUrl}/api/projects/${assetProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: reopenedFlowProject.researchPackage, visualStoryboard: approvedFlowBoard }),
  })).status, 200, "imported illustration can be approved after review");
  const approvedFlowProject = await fetch(`${baseUrl}/api/projects/${assetProject.id}`).then((response) => response.json());
  const promptOnlyEdit = structuredClone(approvedFlowProject.visualStoryboard);
  promptOnlyEdit.scenes[0].flowPrompt += "\nOptional hand-edited details.";
  assert.equal((await fetch(`${baseUrl}/api/projects/${assetProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: approvedFlowProject.researchPackage, visualStoryboard: promptOnlyEdit }),
  })).status, 200, "editing external prompt does not stale approval for unchanged rendered art");
  assert.equal((await fetch(`${baseUrl}/api/projects/${assetProject.id}`).then((response) => response.json())).visualStoryboard.scenes[0].approved, true);
  const replaceFlowBoard = structuredClone(promptOnlyEdit);
  replaceFlowBoard.scenes[0] = { ...replaceFlowBoard.scenes[0], composition: imageComposition(uploadedVisual.asset.id), approved: false, approvedFingerprint: null, authoringConfirmed: false, flowStatus: "illustration-imported" };
  assert.equal((await fetch(`${baseUrl}/api/projects/${assetProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: approvedFlowProject.researchPackage, visualStoryboard: replaceFlowBoard }),
  })).status, 200, "replacing imported raster persists only after explicit approval invalidation");
  assert.equal((await fetch(`${baseUrl}/api/projects/${assetProject.id}`).then((response) => response.json())).visualStoryboard.scenes[0].approved, false, "new artwork requires fresh scene approval");
  const styleOnlyBoard = structuredClone(replaceFlowBoard);
  styleOnlyBoard.scenes[0] = { ...styleOnlyBoard.scenes[0], composition: imageComposition(uploadedVisual.asset.id) };
  assert.equal((await fetch(`${baseUrl}/api/projects/${assetProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: approvedFlowProject.researchPackage, visualStoryboard: styleOnlyBoard }),
  })).status, 200);
  const protectedStyleReference = await fetch(`${baseUrl}/api/projects/${assetProject.id}/visual-assets/${encodeURIComponent(flowVisual.asset.id)}`, { method: "DELETE" });
  assert.equal(protectedStyleReference.status, 409, "Style Lock visual reference prevents deleting its source asset");
  assert.equal((await protectedStyleReference.json()).code, "visual-asset-in-use");
  assert.equal((await fetch(`${baseUrl}/api/projects/${assetProject.id}/generate`, { method: "POST" })).status, 409, "manual upload still requires review and approval");
  const sourceScene = assetProject.visualStoryboard.scenes[0];
  const sourceResearchScene = assetProject.researchPackage.scenes[0];
  const reusableResponse = await fetch(`${baseUrl}/api/projects/${assetProject.id}/reusable-scenes`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      name: "Smoke reusable river composition", tags: ["smoke", "river", "ocean"], concepts: ["river carries mineral to sea"],
      styleId: "clean-flat-2d", layout: "existing-composition", compositionType: "hero-object-focus",
      composition: imageComposition(uploadedVisual.asset.id), palette: assetProject.visualStoryboard.palette,
      motionIntent: sourceScene.motionIntent, motionSummary: sourceScene.motionSummary, motionPlan: sourceResearchScene.motionPlan,
      objects: sourceScene.objects, relationships: sourceScene.relationships, visualFocus: sourceScene.visualFocus,
      assetIds: [uploadedVisual.asset.id], thumbnailDataUrl: `data:image/png;base64,${pngBytes.toString("base64")}`,
      provenance: "API smoke only; FFmpeg solid-color fixture, not educational art or AI.",
    }),
  });
  const reusable = await reusableResponse.json();
  assert.equal(reusableResponse.status, 201, reusable.error);
  assert.equal(reusable.version, 1);
  const reusableSearch = await fetch(`${baseUrl}/api/reusable-scenes?q=smoke+river&page=1&pageSize=2`).then((response) => response.json());
  assert.ok(reusableSearch.scenes.some((scene: { id: string }) => scene.id === reusable.id), "FTS finds saved reusable composition");
  const creditCsv = await fetch(`${baseUrl}/api/projects/${assetProject.id}/visual-assets/credits.csv`).then((response) => response.text());
  assert.match(creditCsv, /Ocean layer/);
  assert.match(creditCsv, /License URL/);
  const reusableTarget = await fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: research }),
  }).then((response) => response.json());
  reusableTargetId = reusableTarget.id;
  const attachedReusable = await fetch(`${baseUrl}/api/projects/${reusableTarget.id}/reusable-scenes/${reusable.id}/attach`, { method: "POST" });
  assert.equal(attachedReusable.status, 200, "reusable scene attaches local asset metadata without modifying template JSON");
  const targetAfterAttach = await fetch(`${baseUrl}/api/projects/${reusableTarget.id}`).then((response) => response.json());
  assert.ok(targetAfterAttach.visualAssets.some((asset: { id: string }) => asset.id === uploadedVisual.asset.id));
  assert.equal((await fetch(`${baseUrl}/api/reusable-scenes?q=smoke`).then((response) => response.json())).scenes.find((scene: { id: string }) => scene.id === reusable.id).usageCount, 1);
  assert.equal((await fetch(`${baseUrl}/api/projects/${assetProject.id}`, { method: "DELETE" })).status, 200);
  assert.equal(existsSync(assetUploadPath), true, "asset remains while reusable template/project still references it");
  assert.equal((await fetch(`${baseUrl}/api/projects/${reusableTarget.id}`, { method: "DELETE" })).status, 200);
  reusableTargetId = undefined;
  const deletedReusable = await fetch(`${baseUrl}/api/reusable-scenes/${reusable.id}`, { method: "DELETE" });
  assert.equal(deletedReusable.status, 200);
  assert.equal(existsSync(assetUploadPath), false, "asset cleanup drains after last project and reusable-scene reference is removed");
  assetUploadPath = undefined;
  assetProjectId = undefined;

  const createdResponse = await fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: research }),
  });
  const project = await createdResponse.json();
  assert.equal(createdResponse.status, 201);
  assert.equal(project.researchPackage.schemaVersion, "1.1", "v1.0 package should upgrade compatibly on import");
  projectId = project.id;
  const verifiedProject = await fetch(`${baseUrl}/api/projects/${projectId}/review`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "verified-by-author" }),
  }).then((response) => response.json());
  assert.equal(verifiedProject.researchReviewStatus, "verified-by-author");
  const editedResearch = { ...research, title: `${research.title} (edited)` };
  const editedProject = await fetch(`${baseUrl}/api/projects/${projectId}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: editedResearch }),
  }).then((response) => response.json());
  assert.equal(editedProject.researchReviewStatus, "needs-review", "editing research invalidates author verification");
  const motionRequestId = randomUUID();
  const motionBatchResponse = await fetch(`${baseUrl}/api/projects/${projectId}/motion-preparation`, {
    method: "POST", headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ requestId: motionRequestId, intensity: "balanced" }),
  });
  assert.equal(motionBatchResponse.status, 202, "deterministic motion batch starts without model/provider request");
  const startedMotion = await motionBatchResponse.json();
  let persistedMotionJob: any;
  for (let attempt = 0; attempt < 120; attempt++) {
    persistedMotionJob = await fetch(`${baseUrl}/api/projects/${projectId}/motion-preparation`).then((response) => response.json());
    if (persistedMotionJob.job?.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(persistedMotionJob.job.id, startedMotion.job.id, "motion progress persists under the initial job ID");
  assert.equal(persistedMotionJob.job.status, "completed", "all-scene motion batch completes locally");
  assert.equal(persistedMotionJob.job.processed, persistedMotionJob.job.total, "persisted motion progress reaches every scene");
  const motionProject = await fetch(`${baseUrl}/api/projects/${projectId}`).then((response) => response.json());
  assert.equal(motionProject.motionPreparation.id, startedMotion.job.id, "reopening project returns latest motion job");
  assert.ok(motionProject.researchPackage.scenes.some((scene: { motionActions: unknown[] }) => scene.motionActions.length > 0), "motion actions persist into Research Package");
  const motionReplay = await fetch(`${baseUrl}/api/projects/${projectId}/motion-preparation`, {
    method: "POST", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify({ requestId: motionRequestId, intensity: "balanced" }),
  });
  assert.equal(motionReplay.status, 200);
  assert.equal((await motionReplay.json()).replay, true, "same motion request ID replays durable job");
  const motionConflict = await fetch(`${baseUrl}/api/projects/${projectId}/motion-preparation`, {
    method: "POST", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify({ requestId: motionRequestId, intensity: "expressive" }),
  });
  assert.equal(motionConflict.status, 409, "reused motion request ID with changed intensity conflicts");
  await approveVisuals(project.id);
  const approvedMotionProject = await fetch(`${baseUrl}/api/projects/${projectId}`).then((response) => response.json());
  const staleMotionBoard = structuredClone(approvedMotionProject.visualStoryboard);
  const animatedScene = staleMotionBoard.scenes.find((scene: { motionActions: Array<{ durationFrames: number }> }) => scene.motionActions.length > 0);
  assert.ok(animatedScene, "approval invalidation fixture has planned motion");
  animatedScene.motionActions[0].durationFrames += 1;
  const staleApprovalResponse = await fetch(`${baseUrl}/api/projects/${projectId}`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ researchPackage: approvedMotionProject.researchPackage, visualStoryboard: staleMotionBoard }),
  });
  assert.equal(staleApprovalResponse.status, 400, "changing motion after approval rejects stale approval fingerprint");

  const audioPath = path.join(tempDir, "voice.wav");
  await execFileAsync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "pcm_s16le", audioPath]);
  const form = new FormData();
  form.append("audio", new Blob([await readFile(audioPath)], { type: "audio/wav" }), "voice.wav");
  const uploadedResponse = await fetch(`${baseUrl}/api/projects/${projectId}/audio`, { method: "POST", body: form });
  const uploaded = await uploadedResponse.json();
  assert.equal(uploadedResponse.status, 201, uploaded.error);
  assert.ok(Math.abs(uploaded.audio.durationSec - 2) < 0.2, "ffprobe duration should persist");
  projectUploadPath = path.resolve("public", uploaded.audio.file);

  const generate = () => fetch(`${baseUrl}/api/projects/${projectId}/generate`, { method: "POST" });
  async function changeProjectTitle(suffix: string) {
    const current = await fetch(`${baseUrl}/api/projects/${projectId}`).then((response) => response.json());
    const updated = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ researchPackage: { ...current.researchPackage, title: `${research.title} · ${suffix}` }, visualStoryboard: current.visualStoryboard }),
    });
    assert.equal(updated.status, 200, `project title should change for ${suffix} quota snapshot`);
  }
  const first = await generate().then((response) => response.json());
  const second = await generate().then((response) => response.json());
  assert.equal(first.job.id, second.job.id, "unchanged snapshot should reuse idempotent job");
  assert.equal(first.job.rendererVersion, RENDERER_VERSION, "new snapshot should record current renderer version");
  jobId = first.job.id;
  jobSnapshotPath = path.join(tempDir, "data", "jobs", first.job.id, "snapshot.json");
  const snapshot = JSON.parse(await readFile(jobSnapshotPath, "utf8"));
  assert.equal(snapshot.rendererVersion, RENDERER_VERSION, "new job snapshot records current renderer version");
  assert.equal(first.job.rendererVersion, RENDERER_VERSION);
  assert.ok(snapshot.audio.file.startsWith("audio/jobs/"), "job snapshot should reference immutable audio copy");
  assert.equal(snapshot.audio.source, "upload");
  assert.equal(snapshot.audio.sha256, uploaded.audio.sha256, "snapshot preserves approved audio identity");
  assert.ok(snapshot.research.scenes.some((scene: { motionActions: unknown[] }) => scene.motionActions.length > 0), "immutable renderer snapshot includes approved motion actions");
  jobAudioPath = path.resolve("public", snapshot.audio.file);
  await readFile(jobAudioPath);
  renderOutputPath = path.join("renders", first.job.id, "attempt-1.mp4");
  await mkdir(path.dirname(renderOutputPath), { recursive: true });
  await writeFile(renderOutputPath, "smoke-render-placeholder");

  const removed = await fetch(`${baseUrl}/api/projects/${projectId}/audio`, { method: "DELETE" });
  assert.equal(removed.status, 200);
  await readFile(jobAudioPath);
  assert.equal((await generate()).status, 201, "Development creates snapshots beyond production daily cap");
  const developmentQuotaStatus = await fetch(`${baseUrl}/api/status`).then((response) => response.json());
  assert.equal(developmentQuotaStatus.generationMode, "development");
  assert.equal(developmentQuotaStatus.jobsUsed, 4, "Development jobs remain in rolling history");
  assert.equal(developmentQuotaStatus.nextAllowedAt, null, "Development status omits quota countdown even over production limit");

  setPersistedAiMode("production");
  const productionQuotaStatus = await fetch(`${baseUrl}/api/status`).then((response) => response.json());
  assert.equal(productionQuotaStatus.generationMode, "production");
  assert.equal(productionQuotaStatus.jobsUsed, 4, "switching mode preserves all recent job history");
  assert.ok(productionQuotaStatus.nextAllowedAt, "Production status exposes rolling quota reset time");
  await changeProjectTitle("production-blocked");
  assert.deepEqual(JSON.parse(await readFile(jobSnapshotPath, "utf8")), snapshot, "project edits never mutate existing motion/render snapshot");
  assert.equal((await generate()).status, 429, "Production counts Development-created jobs against daily limit");

  setPersistedAiMode("development");
  await changeProjectTitle("development-unlimited-again");
  assert.equal((await generate()).status, 201, "switching back to Development restores unlimited local snapshots");
  const switchedBackStatus = await fetch(`${baseUrl}/api/status`).then((response) => response.json());
  assert.equal(switchedBackStatus.jobsUsed, 5, "new Development job is still recorded in history");
  assert.equal(switchedBackStatus.nextAllowedAt, null);

  setPersistedAiMode("production");
  await changeProjectTitle("production-still-limited");
  assert.equal((await generate()).status, 429, "switching back to Production cannot reset quota history");

  const secondForm = new FormData();
  secondForm.append("audio", new Blob([await readFile(audioPath)], { type: "audio/wav" }), "again.wav");
  const secondUpload = await fetch(`${baseUrl}/api/projects/${projectId}/audio`, { method: "POST", body: secondForm }).then((response) => response.json());
  projectUploadPath = path.resolve("public", secondUpload.audio.file);
  const deleted = await fetch(`${baseUrl}/api/projects/${projectId}`, { method: "DELETE" });
  const deletion = await deleted.json();
  assert.equal(deleted.status, 200);
  assert.equal(deletion.deleted, true);
  assert.equal(deletion.cleanupPending, 0, "cleanup queue should drain after project deletion");
  assert.equal((await fetch(`${baseUrl}/api/projects/${projectId}`).then((response) => response.status)), 404, "deleted project should disappear");
  assert.equal((await fetch(`${baseUrl}/api/jobs/${jobId}`).then((response) => response.status)), 404, "project jobs should be deleted");
  await assert.rejects(readFile(projectUploadPath), "project upload should be deleted");
  await assert.rejects(readFile(jobSnapshotPath), "job snapshot should be deleted");
  await assert.rejects(readFile(renderOutputPath), "job MP4 should be deleted");
  await readFile(jobAudioPath); // content-addressed audio remains a shared immutable cache
  const finalQuotaStatus = await fetch(`${baseUrl}/api/status`).then((response) => response.json());
  assert.equal(finalQuotaStatus.jobsUsed, 5, "deleting a project must not reset rolling job history");
  assert.equal(finalQuotaStatus.generationMode, "production");
  projectId = undefined;
  console.log(`PASS: production UI/API, Vite proxy Origin/CSRF, import/idempotency, AI mode validation/persistence + TTS quota isolation, research-review invalidation, upload/cleanup, shared audio, quota persistence. Gemini configured=${ttsStatus.configured}.`);
} finally {
  if (projectId) await fetch(`${baseUrl}/api/projects/${projectId}`, { method: "DELETE" }).catch(() => {});
  if (assetProjectId) await fetch(`${baseUrl}/api/projects/${assetProjectId}`, { method: "DELETE" }).catch(() => {});
  if (reusableTargetId) await fetch(`${baseUrl}/api/projects/${reusableTargetId}`, { method: "DELETE" }).catch(() => {});
  if (jobAudioPath) await rm(jobAudioPath, { force: true });
  if (assetUploadPath) await rm(assetUploadPath, { force: true });
  if (flowAssetPath) await rm(flowAssetPath, { force: true });
  if (renderOutputPath) await rm(path.dirname(renderOutputPath), { recursive: true, force: true });
  viteServer?.kill();
  if (viteServer) await new Promise<void>((resolve) => {
    if (viteServer!.exitCode !== null) return resolve();
    viteServer!.once("exit", () => resolve());
    setTimeout(resolve, 3000);
  });
  server.kill();
  await new Promise<void>((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once("exit", () => resolve());
    setTimeout(resolve, 3000);
  });
  await rm(tempDir, { recursive: true, force: true });
}
