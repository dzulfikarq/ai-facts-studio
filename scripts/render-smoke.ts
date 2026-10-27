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
  for (const version of [3, 2, 1]) {
    const outputPath = path.join(tempDir, `renderer-v${version}.mp4`);
    const audioName = `render-smoke-${randomUUID()}.wav`;
    const { stdout, stderr } = await execFileAsync(process.execPath, ["--import", "tsx", "scripts/render-smoke-case.ts", String(version), outputPath, audioName], {
      cwd: process.cwd(), timeout: 300_000, maxBuffer: 2 * 1024 * 1024,
    });
    assert.match(stdout, /^PASS:/m, `renderer V${version} process must verify its MP4 output`);
    process.stdout.write(stdout);
    // ponytail: Chrome may report target-closed after successful MP4 verification; nonzero exits still fail execFile.
    if (stderr && !stderr.includes("ProtocolError: Protocol error (Page.bringToFront): Target closed.")) process.stderr.write(stderr);
  }
  console.log("PASS: isolated V3, V2, and legacy V1 render processes avoid cross-render browser state.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
