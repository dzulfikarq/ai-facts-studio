import "dotenv/config";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseResearchPackage } from "../src/domain/research";
import { renderSnapshot } from "./render-core";
import { RENDERER_VERSION } from "../src/video/renderer-version";

const root = await realpath(process.cwd());
const requestedPath = process.argv[2] ?? "samples/mountain-formation.json";
const inputPath = await realpath(path.resolve(root, requestedPath));
if (!inputPath.startsWith(`${root}${path.sep}`) || path.extname(inputPath).toLowerCase() !== ".json") {
  throw new Error("Input harus berupa file JSON di dalam repository.");
}

const parsed = parseResearchPackage(JSON.parse(await readFile(inputPath, "utf8")));
if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n"));

const fileSlug = parsed.data.title.normalize("NFKD").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 64) || "facts-video";
const outputDir = path.resolve(root, process.env.RENDER_OUTPUT_DIR ?? "renders");
const output = path.resolve(outputDir, `${fileSlug}.mp4`);
const manifestPath = output.replace(/\.mp4$/i, ".manifest.json");
if (existsSync(output) || existsSync(manifestPath)) throw new Error(`Output already exists; preserving it: ${path.relative(root, output)}. Set RENDER_OUTPUT_DIR to a new directory to render separately.`);
let lastProgress = -1;
let manifest: Awaited<ReturnType<typeof renderSnapshot>>;
try {
  manifest = await renderSnapshot({ research: parsed.data, rendererVersion: RENDERER_VERSION }, output, (progress) => {
    if (progress === lastProgress) return;
    lastProgress = progress;
    process.stdout.write(`\rRender: ${progress}%`);
  });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: "wx" });
} catch (error) {
  await rm(output, { force: true });
  await rm(manifestPath, { force: true });
  throw error;
}
process.stdout.write(`\nSaved ${path.relative(root, output)}\n${JSON.stringify(manifest, null, 2)}\n`);
