import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-facts-api-smoke-"));
const probe = createServer();
await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
const address = probe.address();
assert.ok(address && typeof address !== "string");
const port = address.port;
await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));

const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: "test", TTS_MOCK_PROVIDER: "0", GEMINI_API_KEY: "", GEMINI_TTS_FREE_TIER_ONLY: "false", HOST: "127.0.0.1", PORT: String(port), DATA_DIR: path.join(tempDir, "data") },
  stdio: "ignore",
});
let projectId: string | undefined;
let jobAudioPath: string | undefined;

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
  const [ttsStatus, ttsCatalog] = await Promise.all([
    fetch(`${baseUrl}/api/tts/status`).then((response) => response.json()),
    fetch(`${baseUrl}/api/tts/voices?locale=id-ID`).then((response) => response.json()),
  ]);
  assert.equal(ttsCatalog.locales[0].locale, "id-ID", "Indonesian should be first/default locale");
  assert.ok(ttsCatalog.voices.length > 0, "official prebuilt fallback catalog should keep voice selector populated");
  assert.equal(ttsCatalog.catalogSource, "fallback");

  const research = await fetch(`${baseUrl}/api/sample`).then((response) => response.json());
  const createdResponse = await fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: research }),
  });
  const project = await createdResponse.json();
  assert.equal(createdResponse.status, 201);
  projectId = project.id;

  const audioPath = path.join(tempDir, "voice.wav");
  await execFileAsync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "pcm_s16le", audioPath]);
  const form = new FormData();
  form.append("audio", new Blob([await readFile(audioPath)], { type: "audio/wav" }), "voice.wav");
  const uploadedResponse = await fetch(`${baseUrl}/api/projects/${projectId}/audio`, { method: "POST", body: form });
  const uploaded = await uploadedResponse.json();
  assert.equal(uploadedResponse.status, 201, uploaded.error);
  assert.ok(Math.abs(uploaded.audio.durationSec - 2) < 0.2, "ffprobe duration should persist");

  const generate = () => fetch(`${baseUrl}/api/projects/${projectId}/generate`, { method: "POST" });
  const first = await generate().then((response) => response.json());
  const second = await generate().then((response) => response.json());
  assert.equal(first.job.id, second.job.id, "unchanged snapshot should reuse idempotent job");
  const snapshot = JSON.parse(await readFile(path.join(tempDir, "data", "jobs", first.job.id, "snapshot.json"), "utf8"));
  assert.ok(snapshot.audio.file.startsWith("audio/jobs/"), "job snapshot should reference immutable audio copy");
  jobAudioPath = path.resolve("public", snapshot.audio.file);
  await readFile(jobAudioPath);

  const removed = await fetch(`${baseUrl}/api/projects/${projectId}/audio`, { method: "DELETE" });
  assert.equal(removed.status, 200);
  await readFile(jobAudioPath);
  assert.equal((await generate()).status, 429, "changed snapshot should respect daily cap");
  console.log(`PASS: production UI/API, import, idempotency, upload, daily cap, id-ID default/voice fallback. Gemini configured=${ttsStatus.configured}.`);
} finally {
  if (projectId) await fetch(`${baseUrl}/api/projects/${projectId}/audio`, { method: "DELETE" }).catch(() => {});
  if (jobAudioPath) await rm(jobAudioPath, { force: true });
  server.kill();
  await new Promise<void>((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once("exit", () => resolve());
    setTimeout(resolve, 3000);
  });
  await rm(tempDir, { recursive: true, force: true });
}
