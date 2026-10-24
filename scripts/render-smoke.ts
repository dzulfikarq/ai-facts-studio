import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-facts-render-smoke-"));
try {
  for (const version of [2, 1]) {
    const outputPath = path.join(tempDir, `renderer-v${version}.mp4`);
    const audioName = `render-smoke-${randomUUID()}.wav`;
    const { stdout, stderr } = await execFileAsync(process.execPath, ["--import", "tsx", "scripts/render-smoke-case.ts", String(version), outputPath, audioName], {
      cwd: process.cwd(), timeout: 300_000, maxBuffer: 2 * 1024 * 1024,
    });
    assert.doesNotMatch(stderr, /ProtocolError/, "each isolated Remotion render should shut down cleanly");
    process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  }
  console.log("PASS: isolated V2 and legacy V1 render processes avoid cross-render browser state.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
