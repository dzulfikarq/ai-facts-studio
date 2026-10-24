import "dotenv/config";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
if (process.env.GEMINI_TTS_LIVE_TEST !== "1") throw new Error("Set GEMINI_TTS_LIVE_TEST=1 to make one live Gemini Test Voice request.");
if (!process.env.GEMINI_API_KEY?.trim()) throw new Error("GEMINI_API_KEY is not configured.");
if (process.env.GEMINI_TTS_FREE_TIER_ONLY !== "true") throw new Error("Live test blocked: GEMINI_TTS_FREE_TIER_ONLY must be true.");

const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-facts-gemini-live-"));
const portProbe = createServer();
await new Promise<void>((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
const address = portProbe.address();
assert.ok(address && typeof address !== "string");
const port = address.port;
await new Promise<void>((resolve, reject) => portProbe.close((error) => error ? reject(error) : resolve()));

const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: "development", TTS_MOCK_PROVIDER: "0", HOST: "127.0.0.1", PORT: String(port), DATA_DIR: process.env.DATA_DIR ?? "data" },
  stdio: "ignore",
});

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(`${baseUrl}/api/tts/status`)).ok) { ready = true; break; }
    } catch { /* API still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(ready, true, "local API should start");
  const status = await fetch(`${baseUrl}/api/tts/status`).then((response) => response.json());
  assert.equal(status.configured, true, "Gemini must pass API-key, model-allowlist, and Free Tier guard checks");
  assert.equal(status.freeTierOnly, true);

  const catalog = await fetch(`${baseUrl}/api/tts/voices?locale=id-ID`).then((response) => response.json());
  assert.equal(catalog.catalogSource, "api", "live catalog lookup must succeed; fallback catalog is not live evidence");
  const voice = catalog.voices.find((item: { id: string; availability: string }) => item.id === "Kore" && item.availability === "api")
    ?? catalog.voices.find((item: { availability: string }) => item.availability === "api");
  assert.ok(voice, "Gemini must return at least one prebuilt voice from live API");

  let generated: any;
  for (let attempt = 0; attempt < 30; attempt++) {
    const speakingRate = Number((0.71 + attempt * 0.02).toFixed(2));
    const response = await fetch(`${baseUrl}/api/tts/test-voice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: "id-ID", voiceId: voice.id, style: "calm", speakingRate }),
    });
    const result = await response.json();
    assert.equal(response.ok, true, result.error ?? `Test Voice failed (${response.status}).`);
    if (!result.cacheHit) { generated = result; break; }
  }
  assert.ok(generated, "No uncached live Test Voice setting found; no provider request was made.");
  assert.ok(generated.preview.durationSec > 0 && generated.preview.durationSec <= 120);

  const audioResponse = await fetch(`${baseUrl}${generated.preview.audioUrl}`);
  assert.equal(audioResponse.ok, true, "generated live sample should be served for playback");
  const audioPath = path.join(tempDir, "gemini-test-voice.mp3");
  await writeFile(audioPath, Buffer.from(await audioResponse.arrayBuffer()));
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", audioPath]);
  const media = JSON.parse(stdout) as { streams?: Array<{ codec_type: string; codec_name: string }>; format?: { duration?: string } };
  const audio = media.streams?.find((stream) => stream.codec_type === "audio");
  assert.equal(audio?.codec_name, "mp3", "normalized live sample should be MP3");

  console.log(JSON.stringify({
    test: "live-gemini-test-voice",
    provider: status.provider,
    model: status.model,
    catalogSource: catalog.catalogSource,
    voiceId: voice.id,
    locale: "id-ID",
    durationSec: Number(media.format?.duration ?? generated.preview.durationSec),
    bytes: generated.preview.bytes,
    outputCodec: audio?.codec_name,
    cacheHit: generated.cacheHit,
    result: "PASS — one live Test Voice synthesis; no project audio was attached",
  }, null, 2));
} finally {
  server.kill();
  await new Promise<void>((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once("exit", () => resolve());
    setTimeout(resolve, 3000);
  });
  await rm(tempDir, { recursive: true, force: true });
}
