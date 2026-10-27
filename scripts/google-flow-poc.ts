import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildIllustrationPrompt } from "../src/domain/illustration-prompt";
import { googleFlowPromptPack } from "../src/domain/google-flow";
import { parseResearchPackage } from "../src/domain/research";
import { buildVisualStoryboard } from "../src/domain/visual-storyboard";

const raw = JSON.parse(await readFile("samples/mountain-formation.json", "utf8")) as unknown;
const parsed = parseResearchPackage(raw);
if (!parsed.success) throw new Error("Mountain sample failed Research Package validation.");
const research = parsed.data;
const storyboard = buildVisualStoryboard(research);
const scenes = storyboard.scenes.slice(0, 3).map((scene) => ({
  sceneId: scene.sceneId,
  sceneNumber: scene.sceneNumber,
  sceneToken: scene.sceneToken,
  recommendedFilename: scene.recommendedFilename,
  headline: scene.headline,
  narrationText: scene.narrationText,
  prompt: buildIllustrationPrompt({ research, storyboard, scene }),
}));
const pack = googleFlowPromptPack(research.title, storyboard.styleLock, scenes);
const output = path.resolve("artifacts/google-flow-poc");
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(path.join(output, "mountain-formation-scenes-01-03.md"), pack.markdown, "utf8"),
  writeFile(path.join(output, "mountain-formation-scenes-01-03.json"), `${JSON.stringify(pack.json, null, 2)}\n`, "utf8"),
  writeFile(path.join(output, "README.md"), [
    "# Google Flow POC evidence",
    "",
    "- Prompt exports use the first three scenes from `samples/mountain-formation.json`.",
    "- Source sample scene 3 covers plate collision/compression; explicit folding and uplift narration is in scene 4. Scene 3 prompt includes that project-wide context without rewriting source scene identity.",
    "- Generation remains manual at https://flow.google.com/; this app does not call a Flow API or automate its browser.",
    "- Editor screenshots and MP4 in `../video-editor-v2/` use locally generated/supplied test fixture images, not Google Flow output or curated artwork.",
    "- Watch Folder is deferred; explicit upload and reviewed batch import remain supported.",
    "",
  ].join("\n"), "utf8"),
]);
console.log(`Wrote 3-scene Google Flow prompt pack: ${output}`);
