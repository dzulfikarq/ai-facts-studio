import "dotenv/config";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseResearchPackage } from "../src/domain/research";
import { renderSnapshot } from "./render-core";

const root = await realpath(process.cwd());
const requestedPath = process.argv[2] ?? "samples/mountain-formation.json";
const inputPath = await realpath(path.resolve(root, requestedPath));
if (!inputPath.startsWith(`${root}${path.sep}`) || path.extname(inputPath).toLowerCase() !== ".json") {
  throw new Error("Input harus berupa file JSON di dalam repository.");
}

const parsed = parseResearchPackage(JSON.parse(await readFile(inputPath, "utf8")));
if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n"));

const fileSlug = parsed.data.title.normalize("NFKD").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 64) || "facts-video";
const output = path.resolve(root, "renders", `${fileSlug}.mp4`);
let lastProgress = -1;
const manifest = await renderSnapshot({ research: parsed.data }, output, (progress) => {
  if (progress === lastProgress) return;
  lastProgress = progress;
  process.stdout.write(`\rRender: ${progress}%`);
});
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output.replace(/\.mp4$/i, ".manifest.json"), JSON.stringify(manifest, null, 2));
process.stdout.write(`\nSaved ${path.relative(root, output)}\n${JSON.stringify(manifest, null, 2)}\n`);
