import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-facts-api-smoke-"));
const dataPath = path.join(tempDir, "data");
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
`);
const legacyProject = { researchPackage: legacyPackage, audio: null, researchReviewStatus: "needs-review" };
oldDb.prepare("INSERT INTO projects (id,title,data_json,created_at,updated_at) VALUES (?,?,?,?,?)")
  .run(legacyProjectId, legacyPackage.title, JSON.stringify(legacyProject), legacyNow, legacyNow);
oldDb.prepare("INSERT INTO jobs (id,project_id,source_sha256,snapshot_path,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
  .run(legacyJobId, legacyProjectId, "legacy-source", legacySnapshotPath, "preview-ready", legacyNow, legacyNow);
oldDb.close();

const probe = createServer();
await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
const address = probe.address();
assert.ok(address && typeof address !== "string");
const port = address.port;
await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));

const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: "test", TTS_MOCK_PROVIDER: "0", GEMINI_API_KEY: "", GEMINI_TTS_FREE_TIER_ONLY: "false", DAILY_JOB_LIMIT: "3", HOST: "127.0.0.1", PORT: String(port), DATA_DIR: dataPath },
  stdio: "ignore",
});
let projectId: string | undefined;
let jobAudioPath: string | undefined;
let jobSnapshotPath: string | undefined;
let projectUploadPath: string | undefined;
let jobId: string | undefined;
let renderOutputPath: string | undefined;

try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/status`);
      if (response.ok) { ready = true; break; }
    } catch { /* API still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(ready, true, "local API should start");
  assert.equal((await fetch(baseUrl)).status, 200, "production UI should be served");
  const migratedProject = await fetch(`${baseUrl}/api/projects/${legacyProjectId}`).then((response) => response.json());
  assert.equal(migratedProject.researchPackage.schemaVersion, "1.1", "legacy v1.0 project should migrate on read");
  assert.equal(migratedProject.latestJob.rendererVersion, 1, "legacy jobs should retain V1 renderer metadata");
  assert.equal(migratedProject.latestJobContentCurrent, true, "legacy snapshot should remain current after compatible migration");
  assert.equal((await fetch(`${baseUrl}/api/status`).then((response) => response.json())).jobsUsed, 1, "legacy jobs should backfill rolling quota history");
  const [ttsStatus, ttsCatalog] = await Promise.all([
    fetch(`${baseUrl}/api/tts/status`).then((response) => response.json()),
    fetch(`${baseUrl}/api/tts/voices?locale=id-ID`).then((response) => response.json()),
  ]);
  assert.equal(ttsStatus.requestsRemaining, ttsStatus.dailyLimit, "TTS status reports rolling synthesis quota without secrets");
  assert.equal(ttsCatalog.locales[0].locale, "id-ID", "Indonesian should be first/default locale");
  assert.ok(ttsCatalog.voices.length > 0, "official prebuilt fallback catalog should keep voice selector populated");
  assert.equal(ttsCatalog.catalogSource, "fallback");

  const research = await fetch(`${baseUrl}/api/sample`).then((response) => response.json());
  const silentProject = await fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: research }),
  }).then((response) => response.json());
  const silentJob = await fetch(`${baseUrl}/api/projects/${silentProject.id}/generate`, { method: "POST" }).then((response) => response.json());
  assert.equal(silentJob.job.state, "preview-ready");
  const silentRenderResponse = await fetch(`${baseUrl}/api/jobs/${silentJob.job.id}/render`, { method: "POST" });
  const silentRender = await silentRenderResponse.json();
  assert.equal(silentRenderResponse.status, 409);
  assert.equal(silentRender.code, "silent-render-confirmation-required", "API also requires explicit confirmation for a silent snapshot");
  assert.equal((await fetch(`${baseUrl}/api/projects/${silentProject.id}`, { method: "DELETE" })).status, 200);
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
  const first = await generate().then((response) => response.json());
  const second = await generate().then((response) => response.json());
  assert.equal(first.job.id, second.job.id, "unchanged snapshot should reuse idempotent job");
  assert.equal(first.job.rendererVersion, 2, "new snapshot should record renderer V2");
  jobId = first.job.id;
  jobSnapshotPath = path.join(tempDir, "data", "jobs", first.job.id, "snapshot.json");
  const snapshot = JSON.parse(await readFile(jobSnapshotPath, "utf8"));
  assert.equal(snapshot.rendererVersion, 2, "new job snapshot records renderer version");
  assert.equal(first.job.rendererVersion, 2);
  assert.ok(snapshot.audio.file.startsWith("audio/jobs/"), "job snapshot should reference immutable audio copy");
  assert.equal(snapshot.audio.source, "upload");
  assert.equal(snapshot.audio.sha256, uploaded.audio.sha256, "snapshot preserves approved audio identity");
  jobAudioPath = path.resolve("public", snapshot.audio.file);
  await readFile(jobAudioPath);
  renderOutputPath = path.join("renders", first.job.id, "attempt-1.mp4");
  await mkdir(path.dirname(renderOutputPath), { recursive: true });
  await writeFile(renderOutputPath, "smoke-render-placeholder");

  const removed = await fetch(`${baseUrl}/api/projects/${projectId}/audio`, { method: "DELETE" });
  assert.equal(removed.status, 200);
  await readFile(jobAudioPath);
  assert.equal((await generate()).status, 429, "changed snapshot should respect daily cap");

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
  assert.equal((await fetch(`${baseUrl}/api/status`).then((response) => response.json())).jobsUsed, 3, "deleting a project must not reset rolling job quota");
  projectId = undefined;
  console.log(`PASS: production UI/API, import/idempotency, research-review invalidation, upload/cleanup, shared audio, quota persistence, id-ID voice fallback. Gemini configured=${ttsStatus.configured}.`);
} finally {
  if (projectId) await fetch(`${baseUrl}/api/projects/${projectId}`, { method: "DELETE" }).catch(() => {});
  if (jobAudioPath) await rm(jobAudioPath, { force: true });
  if (renderOutputPath) await rm(path.dirname(renderOutputPath), { recursive: true, force: true });
  server.kill();
  await new Promise<void>((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once("exit", () => resolve());
    setTimeout(resolve, 3000);
  });
  await rm(tempDir, { recursive: true, force: true });
}
