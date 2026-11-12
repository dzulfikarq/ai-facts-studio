import type { ResearchPackage } from "./research";

export function narrationScript(research: Pick<ResearchPackage, "scenes">) {
  const narration = research.scenes.map((scene) => scene.narrationText.trim());
  if (narration.some((text) => !text || ["narasi belum diisi.", "tulis narasi untuk scene ini."].includes(text.toLocaleLowerCase("id-ID")))) return "";
  return narration.join("\n\n");
}

export function estimateSceneTimings(research: ResearchPackage, audioDurationSec: number, wordsPerMinute = 150, speakingRate = 1): ResearchPackage {
  if (!Number.isFinite(audioDurationSec) || audioDurationSec <= 0) throw new Error("Durasi audio harus positif.");
  const wpm = Number.isFinite(wordsPerMinute) && wordsPerMinute > 0 ? wordsPerMinute : 150;
  const rate = Math.max(0.7, Math.min(1.3, speakingRate));
  const weights = research.scenes.map((scene, index) => {
    const text = scene.narrationText.trim();
    const words = text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 1;
    const commas = text.match(/[,;:]/g)?.length ?? 0;
    const sentenceEnds = text.match(/[.!?…]+/g)?.length ?? 0;
    const scenePause = index < research.scenes.length - 1 ? 0.35 : 0;
    return Math.max(0.1, words * 60 / (wpm * rate) + commas * 0.14 + sentenceEnds * 0.28 + scenePause);
  });
  const weightTotal = weights.reduce((total, weight) => total + weight, 0);
  let cursor = 0;
  const scenes = research.scenes.map((scene, index) => {
    const startSec = cursor;
    const endSec = index === research.scenes.length - 1
      ? audioDurationSec
      : Math.round((cursor + audioDurationSec * weights[index]! / weightTotal) * 1000) / 1000;
    cursor = endSec;
    const oldFrames = Math.max(1, Math.floor((scene.endSec - scene.startSec) * 30));
    const newFrames = Math.max(1, Math.floor((endSec - startSec) * 30));
    const ratio = newFrames / oldFrames;
    const motionActions = scene.motionActions.map((action) => {
      const actionStart = Math.min(newFrames - 1, Math.max(0, Math.round(action.startFrame * ratio)));
      return { ...action, startFrame: actionStart, durationFrames: Math.min(newFrames - actionStart, Math.max(1, Math.round(action.durationFrames * ratio))) };
    });
    return { ...scene, startSec, endSec, motionActions };
  });
  return { ...research, targetDurationSec: Math.max(1, Math.ceil(audioDurationSec)), scenes };
}
