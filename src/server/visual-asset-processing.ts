import { spawn } from "node:child_process";
import { inspectRasterImage, validateRasterImage } from "../domain/visual-assets";

function runImageTool(command: "ffprobe" | "ffmpeg", args: string[], input: Buffer, maxOutputBytes: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const output: Buffer[] = [];
    let outputBytes = 0;
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 45_000);
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) child.kill();
      else output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4000); });
    child.once("error", (error) => { clearTimeout(timeout); reject(new Error(`${command} tidak tersedia untuk validasi gambar: ${error.message}`)); });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) return reject(new Error("Validasi/optimasi gambar melewati batas 45 detik."));
      if (outputBytes > maxOutputBytes) return reject(new Error("Output gambar teroptimasi melewati batas 10 MB."));
      if (code !== 0) return reject(new Error(`${command} menolak data gambar: ${stderr.trim() || `exit ${code}`}`));
      resolve(Buffer.concat(output));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

export async function validateAndOptimizeRasterImage(buffer: Buffer, mimeType: string) {
  const signature = validateRasterImage(buffer);
  const expectedMime = signature.format === "jpeg" ? "image/jpeg" : `image/${signature.format}`;
  if (mimeType !== expectedMime) throw new Error("MIME type dan signature gambar tidak cocok.");
  const probeText = await runImageTool("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", "pipe:0"], buffer, 1024 * 1024);
  const probe = JSON.parse(probeText.toString("utf8")) as { streams?: Array<{ width?: number; height?: number }> };
  const stream = probe.streams?.[0];
  if (stream?.width !== signature.width || stream.height !== signature.height) throw new Error("Dimensi gambar dari decoder tidak cocok dengan header file.");
  const webp = await runImageTool("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-map", "0:v:0", "-frames:v", "1", "-map_metadata", "-1",
    "-vf", "scale='min(1080,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease",
    "-c:v", "libwebp", "-quality", "88", "-compression_level", "4", "-f", "webp", "pipe:1",
  ], buffer, 10 * 1024 * 1024);
  const optimized = inspectRasterImage(webp);
  const useWebp = signature.width > 1080 || signature.height > 1920 || webp.length < buffer.length;
  const finalBuffer = useWebp ? webp : buffer;
  const finalImage = validateRasterImage(finalBuffer);
  return { buffer: finalBuffer, image: finalImage, optimized: useWebp, originalBytes: buffer.length };
}
