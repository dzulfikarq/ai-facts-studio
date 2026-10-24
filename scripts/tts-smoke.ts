import assert from "node:assert/strict";
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
const server = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: "test", TTS_MOCK_PROVIDER: "1", HOST: "127.0.0.1", PORT: String(port), DATA_DIR: path.join(tempDir, "data") },
  stdio: "pipe",
});
server.stdout.pipe(process.stdout);
server.stderr.pipe(process.stderr);
let projectId: string | undefined;
const audioPaths = new Set<string>();
let jobAudioPath: string | undefined;
let renderPath: string | undefined;

try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/tts/status`);
      if (response.ok) { ready = true; break; }
    } catch { /* API still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(ready, true, "test API should start");
  const sample = await fetch(`${baseUrl}/api/sample`).then((response) => response.json());
  const createResponse = await fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: sample }),
  });
  const project = await createResponse.json();
  assert.equal(createResponse.status, 201);
  projectId = project.id;

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
  assert.equal((await fetch(`${baseUrl}/api/projects/${projectId}`).then((response) => response.json())).audio, null, "Test Voice must not attach audio to project");
  const cachedSample = await fetch(`${baseUrl}/api/tts/test-voice`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(selection),
  }).then((response) => response.json());
  assert.equal(cachedSample.cacheHit, true, "same Test Voice settings should reuse local sample cache");

  const first = await fetch(`${baseUrl}/api/projects/${projectId}/tts`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(selection),
  }).then((response) => response.json());
  assert.equal(first.cacheHit, false);
  assert.equal(first.project.audio, null, "full narration preview must not replace selected audio");
  assert.equal(first.project.pendingTtsMatchesNarration, true);
  assert.equal(first.project.pendingTts.audioUrl, first.preview.audioUrl);
  audioPaths.add(path.resolve("public", first.preview.audioUrl.slice(1)));

  const cached = await fetch(`${baseUrl}/api/projects/${projectId}/tts`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(selection),
  }).then((response) => response.json());
  assert.equal(cached.cacheHit, true, "same script/config should reuse local audio");
  assert.equal(cached.project.audio, null, "cached preview still requires approval");
  const regenerated = await fetch(`${baseUrl}/api/projects/${projectId}/tts`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...selection, regenerate: true }),
  }).then((response) => response.json());
  assert.equal(regenerated.cacheHit, false, "explicit regenerate should issue provider request");
  audioPaths.add(path.resolve("public", regenerated.preview.audioUrl.slice(1)));
  const regeneratedAgain = await fetch(`${baseUrl}/api/projects/${projectId}/tts`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...selection, regenerate: true }),
  }).then((response) => response.json());
  assert.equal(regeneratedAgain.cacheHit, false);
  audioPaths.add(path.resolve("public", regeneratedAgain.preview.audioUrl.slice(1)));
  assert.equal((await fetch(`${baseUrl}/api/projects/${projectId}/tts`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...selection, regenerate: true }),
  })).status, 429, "TTS retries should be bounded");
  assert.equal((await fetch(`${baseUrl}/api/status`).then((response) => response.json())).jobsUsed, 0, "TTS does not use video job allowance");

  const changedStory = structuredClone(sample);
  changedStory.scenes[0].narrationText += " Tambahan edit.";
  const changedProject = await fetch(`${baseUrl}/api/projects/${projectId}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: changedStory }),
  }).then((response) => response.json());
  assert.equal(changedProject.pendingTts, null, "editing script invalidates pending narration preview");
  assert.equal((await fetch(`${baseUrl}/api/projects/${projectId}/tts/approve`, { method: "POST" })).status, 409, "stale narration cannot be approved");
  const freshPreview = await fetch(`${baseUrl}/api/projects/${projectId}/tts`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(selection),
  }).then((response) => response.json());
  assert.equal(freshPreview.cacheHit, false, "edited script gets distinct audio cache");
  audioPaths.add(path.resolve("public", freshPreview.preview.audioUrl.slice(1)));

  const approvedResponse = await fetch(`${baseUrl}/api/projects/${projectId}/tts/approve`, { method: "POST" });
  const approved = await approvedResponse.json();
  assert.equal(approvedResponse.status, 200, approved.error);
  assert.equal(approved.project.audio.source, "tts", "only explicit approval attaches the full narration");
  assert.equal(approved.project.pendingTts, null);
  assert.equal(approved.project.audioMatchesNarration, true);
  assert.equal(approved.project.audio.timingMode, "estimated");
  assert.ok(Math.abs(approved.project.researchPackage.scenes.at(-1).endSec - approved.project.audio.durationSec) < 0.001);
  audioPaths.add(path.resolve("public", approved.project.audio.file));

  const generatedJob = await fetch(`${baseUrl}/api/projects/${projectId}/generate`, { method: "POST" }).then((response) => response.json());
  assert.equal(generatedJob.job.state, "preview-ready");
  const snapshot = JSON.parse(await readFile(path.join(tempDir, "data", "jobs", generatedJob.job.id, "snapshot.json"), "utf8"));
  assert.equal(snapshot.audio.timingMode, "estimated");
  jobAudioPath = path.resolve("public", snapshot.audio.file);
  assert.equal((await fetch(`${baseUrl}/${snapshot.audio.file}`)).status, 200, "production API should serve generated snapshot audio to Player/renderer");

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
  assert.equal(completed.manifest.width, 1080);
  assert.equal(completed.manifest.height, 1920);
  renderPath = path.resolve("renders", generatedJob.job.id);
  const output = path.resolve(renderPath, "attempt-1.mp4");
  const volume = await execFileAsync("ffmpeg", ["-hide_banner", "-i", output, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"], { maxBuffer: 1024 * 1024 });
  const meanVolume = volume.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/);
  assert.ok(meanVolume && meanVolume[1] !== "-inf", "rendered AAC track should contain audible mock signal, not silence");
  console.log(`PASS: mock Test Voice/cache + full preview/approval → estimated scene timing → MP4 H.264 + audible AAC (${completed.manifest.durationSec.toFixed(2)}s).`);
} finally {
  server.kill();
  await new Promise<void>((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once("exit", () => resolve());
    setTimeout(resolve, 3000);
  });
  if (projectId) await fetch(`${baseUrl}/api/projects/${projectId}/audio`, { method: "DELETE" }).catch(() => {});
  await Promise.all([...audioPaths].map((file) => rm(file, { force: true })));
  if (jobAudioPath) await rm(jobAudioPath, { force: true });
  if (renderPath) await rm(renderPath, { recursive: true, force: true });
  await rm(tempDir, { recursive: true, force: true });
}
