import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-facts-tts-smoke-"));
const portProbe = createServer();
await new Promise<void>((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
const address = portProbe.address();
assert.ok(address && typeof address !== "string");
const port = address.port;
await new Promise<void>((resolve, reject) => portProbe.close((error) => error ? reject(error) : resolve()));

const baseUrl = `http://127.0.0.1:${port}`;
const serverEnv = { ...process.env, NODE_ENV: "test", TTS_MOCK_PROVIDER: "1", GEMINI_API_KEY: "settings-test-key", GEMINI_TEXT_MODEL: "gemini-3.5-flash-lite", GEMINI_TEXT_FREE_TIER_ONLY: "true", AI_GENERATION_DAILY_REQUEST_LIMIT: "20", DAILY_JOB_LIMIT: "1", GEMINI_TTS_DAILY_REQUEST_LIMIT: "20", HOST: "127.0.0.1", PORT: String(port), DATA_DIR: path.join(tempDir, "data") };
function spawnServer() {
  const child = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], { cwd: process.cwd(), env: serverEnv, stdio: "pipe" });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  return child;
}
async function stopServer(child: ReturnType<typeof spawnServer>) {
  if (child.exitCode === null && child.signalCode === null) child.kill();
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", () => resolve());
    setTimeout(resolve, 3000);
  });
}
async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(`${baseUrl}/api/tts/status`)).ok) return; }
    catch { /* API still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("test API did not start");
}
let server = spawnServer();
async function restartServer() {
  await stopServer(server);
  server = spawnServer();
  await waitForServer();
}
let projectId: string | undefined;
const audioPaths = new Set<string>();
let projectUploadPath: string | undefined;
let jobAudioPath: string | undefined;
let renderPath: string | undefined;

try {
  await waitForServer();
  const sample = await fetch(`${baseUrl}/api/sample`).then((response) => response.json());
  const createResponse = await fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: sample }),
  });
  const project = await createResponse.json();
  assert.equal(createResponse.status, 201);
  projectId = project.id;

  const audioPath = path.join(tempDir, "voice.wav");
  await execFileAsync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "pcm_s16le", audioPath]);
  const uploadForm = new FormData();
  uploadForm.append("audio", new Blob([await readFile(audioPath)], { type: "audio/wav" }), "voice.wav");
  const uploaded = await fetch(`${baseUrl}/api/projects/${projectId}/audio`, { method: "POST", body: uploadForm }).then((response) => response.json());
  assert.ok(uploaded.audio?.source === "upload");
  projectUploadPath = path.resolve("public", uploaded.audio.file);
  audioPaths.add(projectUploadPath);

  const voices = await fetch(`${baseUrl}/api/tts/voices?locale=id-ID`).then((response) => response.json());
  assert.equal(voices.configured, true);
  assert.ok(voices.voices.some((voice: { gender: string }) => voice.gender === "Female"));
  assert.ok(voices.voices.some((voice: { gender: string }) => voice.gender === "Male"));
  const selection = { locale: "id-ID", voiceId: "Kore", style: "documentary", speakingRate: 1 };
  const voiceSample = await fetch(`${baseUrl}/api/tts/test-voice`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(selection),
  }).then((response) => response.json());
  assert.equal(voiceSample.cacheHit, false);
  assert.ok(voiceSample.preview.text.includes("contoh suara"));
  assert.equal((await fetch(`${baseUrl}${voiceSample.preview.audioUrl}`)).status, 200, "Test Voice preview should be playable");
  assert.equal((await fetch(`${baseUrl}/api/projects/${projectId}`).then((response) => response.json())).audio.file, uploaded.audio.file, "Test Voice must preserve selected upload");
  const cachedSample = await fetch(`${baseUrl}/api/tts/test-voice`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(selection),
  }).then((response) => response.json());
  assert.equal(cachedSample.cacheHit, true, "same Test Voice settings should reuse local sample cache");

  const first = await fetch(`${baseUrl}/api/projects/${projectId}/tts`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(selection),
  }).then((response) => response.json());
  assert.equal(first.cacheHit, false);
  assert.equal(first.project.audio.file, uploaded.audio.file, "full narration preview must preserve selected audio until approval");
  assert.equal(first.project.pendingTtsMatchesNarration, true);
  assert.equal(first.project.pendingTts.audioUrl, first.preview.audioUrl);
  audioPaths.add(path.resolve("public", first.preview.audioUrl.slice(1)));

  const cached = await fetch(`${baseUrl}/api/projects/${projectId}/tts`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(selection),
  }).then((response) => response.json());
  assert.equal(cached.cacheHit, true, "same script/config should reuse local audio");
  assert.equal(cached.project.audio.file, uploaded.audio.file, "cached preview still requires approval and preserves old audio");
  const replacementSelection = { locale: "en-US", voiceId: "Puck", style: "warm", speakingRate: 1.1 };
  assert.ok((await fetch(`${baseUrl}/api/tts/voices?locale=en-US`).then((response) => response.json())).voices.some((voice: { id: string }) => voice.id === replacementSelection.voiceId), "mock fixture should cover locale changes");
  const settingsChanged = await fetch(`${baseUrl}/api/projects/${projectId}/tts`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(replacementSelection),
  }).then((response) => response.json());
  assert.equal(settingsChanged.cacheHit, false, "locale/voice/style/pace changes must synthesize distinct preview");
  assert.equal(settingsChanged.project.audio.file, uploaded.audio.file, "new voice settings must not silently replace active upload");
  assert.equal(settingsChanged.project.pendingTts.locale, "en-US");
  assert.equal(settingsChanged.project.pendingTts.style, "warm");
  audioPaths.add(path.resolve("public", settingsChanged.preview.audioUrl.slice(1)));
  const regenerated = await fetch(`${baseUrl}/api/projects/${projectId}/tts`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...replacementSelection, regenerate: true }),
  }).then((response) => response.json());
  assert.equal(regenerated.cacheHit, false, "explicit regenerate should issue provider request");
  audioPaths.add(path.resolve("public", regenerated.preview.audioUrl.slice(1)));
  const regeneratedAgain = await fetch(`${baseUrl}/api/projects/${projectId}/tts`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...replacementSelection, regenerate: true }),
  }).then((response) => response.json());
  assert.equal(regeneratedAgain.cacheHit, false);
  audioPaths.add(path.resolve("public", regeneratedAgain.preview.audioUrl.slice(1)));
  assert.equal((await fetch(`${baseUrl}/api/projects/${projectId}/tts`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...replacementSelection, regenerate: true }),
  })).status, 429, "TTS retries should be bounded");
  assert.equal((await fetch(`${baseUrl}/api/status`).then((response) => response.json())).jobsUsed, 0, "TTS does not use video job allowance");

  const changedStory = structuredClone(sample);
  changedStory.scenes[0].narrationText += " Tambahan edit.";
  const changedProject = await fetch(`${baseUrl}/api/projects/${projectId}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: changedStory }),
  }).then((response) => response.json());
  assert.equal(changedProject.pendingTts, null, "editing script invalidates pending narration preview");
  assert.equal((await fetch(`${baseUrl}/api/projects/${projectId}/tts/approve`, { method: "POST" })).status, 409, "stale narration cannot be approved");
  assert.equal(changedProject.audio.file, uploaded.audio.file, "editing narration keeps prior selected audio until replacement is approved");
  assert.ok((await readFile(projectUploadPath)).length > 0, "old upload remains intact while new narration is pending");
  const freshPreview = await fetch(`${baseUrl}/api/projects/${projectId}/tts`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(replacementSelection),
  }).then((response) => response.json());
  assert.equal(freshPreview.cacheHit, false, "edited script gets distinct audio cache");
  audioPaths.add(path.resolve("public", freshPreview.preview.audioUrl.slice(1)));
  assert.equal(freshPreview.project.audio.file, uploaded.audio.file, "fresh preview never replaces old upload before approval");

  const pendingBeforeModeChange = await fetch(`${baseUrl}/api/projects/${projectId}`).then((response) => response.json());
  const ttsRequestsBeforeModeChange = await fetch(`${baseUrl}/api/tts/status`).then((response) => response.json()).then((status) => status.requestsUsed);
  const productionModeResponse = await fetch(`${baseUrl}/api/settings/ai-generation`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "production" }) });
  const productionMode = await productionModeResponse.json();
  assert.equal(productionModeResponse.status, 200, productionMode.error);
  assert.equal(productionMode.mode, "production");

  await restartServer();
  const restoredAiSettings = await fetch(`${baseUrl}/api/settings/ai-generation`).then((response) => response.json());
  assert.equal(restoredAiSettings.mode, "production", "AI mode persists across API restart independently of NODE_ENV");
  const restoredPending = await fetch(`${baseUrl}/api/projects/${projectId}`).then((response) => response.json());
  assert.equal(restoredPending.pendingTts.cacheKey, freshPreview.preview.cacheKey, "pending preview survives API restart");
  assert.equal(restoredPending.audio.file, uploaded.audio.file, "restart preserves selected audio until approval");
  assert.deepEqual(restoredPending.researchPackage, pendingBeforeModeChange.researchPackage, "mode change must not edit project research");
  assert.deepEqual(restoredPending.pendingTts, pendingBeforeModeChange.pendingTts, "mode change must preserve pending audio approval");
  assert.equal((await fetch(`${baseUrl}/api/tts/status`).then((response) => response.json())).requestsUsed, ttsRequestsBeforeModeChange, "mode change does not consume TTS quota");
  assert.equal((await fetch(`${baseUrl}/api/settings/ai-generation`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "development" }) })).status, 200, "mode can be switched back without altering pending preview");
  await readFile(projectUploadPath);

  const approvedResponse = await fetch(`${baseUrl}/api/projects/${projectId}/tts/approve`, { method: "POST" });
  const approved = await approvedResponse.json();
  assert.equal(approvedResponse.status, 200, approved.error);
  assert.equal(approved.project.audio.source, "tts", "only explicit approval attaches the full narration");
  assert.equal(approved.project.pendingTts, null);
  assert.equal(approved.project.audioMatchesNarration, true);
  assert.equal(approved.project.audio.timingMode, "estimated");
  assert.equal(approved.project.audio.tts.locale, "en-US");
  assert.equal(approved.project.audio.tts.voiceId, "Puck");
  assert.equal(approved.project.audio.tts.style, "warm");
  assert.equal(approved.project.audio.tts.speakingRate, 1.1);
  assert.ok(approved.project.audio.tts.approvedAt, "approval time should persist with selected audio metadata");
  assert.ok(Math.abs(approved.project.researchPackage.scenes.at(-1).endSec - approved.project.audio.durationSec) < 0.001);
  await assert.rejects(readFile(projectUploadPath), "replaced upload is cleaned only after explicit audio approval");
  audioPaths.add(path.resolve("public", approved.project.audio.file));

  await restartServer();
  const restoredApproval = await fetch(`${baseUrl}/api/projects/${projectId}`).then((response) => response.json());
  assert.equal(restoredApproval.audio.tts.cacheKey, freshPreview.preview.cacheKey, "approved TTS audio survives API restart");
  assert.equal(restoredApproval.audioMatchesNarration, true);

  const generatedJob = await fetch(`${baseUrl}/api/projects/${projectId}/generate`, { method: "POST" }).then((response) => response.json());
  assert.equal(generatedJob.job.state, "preview-ready");
  const snapshot = JSON.parse(await readFile(path.join(tempDir, "data", "jobs", generatedJob.job.id, "snapshot.json"), "utf8"));
  assert.equal(snapshot.audio.timingMode, "estimated");
  assert.equal(snapshot.audio.source, "tts");
  assert.equal(snapshot.audio.sha256, restoredApproval.audio.sha256);
  assert.equal(snapshot.audio.tts.cacheKey, freshPreview.preview.cacheKey);
  assert.equal(snapshot.audio.tts.scriptSha256, restoredApproval.audio.tts.scriptSha256);
  assert.equal(snapshot.audio.tts.approvedAt, restoredApproval.audio.tts.approvedAt);
  jobAudioPath = path.resolve("public", snapshot.audio.file);
  assert.equal(createHash("sha256").update(await readFile(jobAudioPath)).digest("hex"), snapshot.audio.sha256, "job snapshot audio is immutable content-addressed copy");
  assert.equal((await fetch(`${baseUrl}/${snapshot.audio.file}`)).status, 200, "production API should serve generated snapshot audio to Player/renderer");

  const postSnapshotEdit = structuredClone(changedStory);
  postSnapshotEdit.scenes[0].narrationText += " Post-snapshot edit.";
  await fetch(`${baseUrl}/api/projects/${projectId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: postSnapshotEdit }) });
  const staleProject = await fetch(`${baseUrl}/api/projects/${projectId}`).then((response) => response.json());
  assert.equal(staleProject.latestJobContentCurrent, false, "narration edits mark prior audio snapshot stale");

  const renderResponse = await fetch(`${baseUrl}/api/jobs/${generatedJob.job.id}/render`, { method: "POST" });
  assert.equal(renderResponse.status, 202);
  assert.equal((await fetch(`${baseUrl}/api/projects/${projectId}`, { method: "DELETE" })).status, 409, "active render must protect its project from deletion");
  let completed: any;
  for (let attempt = 0; attempt < 180; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    completed = await fetch(`${baseUrl}/api/jobs/${generatedJob.job.id}`).then((response) => response.json());
    if (completed.state !== "rendering") break;
  }
  assert.equal(completed.state, "rendered", completed.error ?? "TTS-backed render timed out");
  assert.equal(completed.manifest.videoCodec, "h264");
  assert.equal(completed.manifest.audioCodec, "aac");
  assert.equal(completed.manifest.audioValidation, "pass");
  assert.equal(completed.manifest.audioSource, "tts");
  assert.equal(completed.manifest.audioProvider, "mock-gemini");
  assert.equal(completed.manifest.audioCacheKey, freshPreview.preview.cacheKey);
  assert.equal(completed.manifest.audioSha256, snapshot.audio.sha256);
  assert.equal(completed.manifest.audioVoice, "Puck (mock)");
  assert.equal(completed.manifest.audioLocale, "en-US");
  assert.ok(completed.manifest.audioMeanVolumeDb > -45);
  assert.ok(completed.manifest.audioMaxVolumeDb < -0.1);
  assert.ok(Math.abs(completed.manifest.audioDurationSec - completed.manifest.durationSec) < 0.25);
  assert.equal(completed.manifest.width, 1080);
  assert.equal(completed.manifest.height, 1920);
  renderPath = path.resolve("renders", generatedJob.job.id);
  const output = path.resolve(renderPath, "attempt-1.mp4");
  assert.equal(snapshot.research.scenes[0].narrationText, changedStory.scenes[0].narrationText, "render uses immutable pre-edit narration snapshot");
  const renderedProjectBeforeModeChange = await fetch(`${baseUrl}/api/projects/${projectId}`).then((response) => response.json());
  assert.equal((await fetch(`${baseUrl}/api/settings/ai-generation`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "production" }) })).status, 200, "configured Production can be selected after render");
  const renderedProjectAfterModeChange = await fetch(`${baseUrl}/api/projects/${projectId}`).then((response) => response.json());
  assert.equal(renderedProjectAfterModeChange.audio.sha256, renderedProjectBeforeModeChange.audio.sha256, "mode change preserves approved audio");
  assert.equal(renderedProjectAfterModeChange.latestJob.id, renderedProjectBeforeModeChange.latestJob.id, "mode change preserves render job");
  assert.equal(renderedProjectAfterModeChange.latestJob.state, "rendered", "mode change preserves completed render");
  await fetch(`${baseUrl}/api/settings/ai-generation`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "development" }) });
  console.log(`PASS: AI mode persistence/isolation + mock Test Voice/cache + upload preservation + settings/edit/restart approval + immutable snapshot → ${completed.manifest.audioValidation} AAC (${completed.manifest.audioMeanVolumeDb} dB mean, ${completed.manifest.durationSec.toFixed(2)}s). Mock is tone, not speech.`);
} finally {
  await stopServer(server);
  if (projectId) await fetch(`${baseUrl}/api/projects/${projectId}/audio`, { method: "DELETE" }).catch(() => {});
  await Promise.all([...audioPaths].map((file) => rm(file, { force: true })));
  if (jobAudioPath) await rm(jobAudioPath, { force: true });
  if (renderPath) await rm(renderPath, { recursive: true, force: true });
  await rm(tempDir, { recursive: true, force: true });
}
