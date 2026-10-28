import type { ResearchPackage, Scene } from "./research";

export const FPS = 30;

export function timelineDuration(research: ResearchPackage, audioDurationSec?: number, timingMode: "scaled" | "estimated" = "scaled") {
  if (!audioDurationSec || audioDurationSec <= 0) return research.targetDurationSec;
  return timingMode === "estimated" ? Math.max(research.targetDurationSec, audioDurationSec) : audioDurationSec;
}

export function sceneTimes(research: ResearchPackage, scene: Scene, durationSec: number, timingMode: "scaled" | "estimated" = "scaled") {
  if (timingMode === "estimated") return { startSec: scene.startSec, endSec: scene.endSec };
  const scale = durationSec / research.targetDurationSec;
  return { startSec: scene.startSec * scale, endSec: scene.endSec * scale };
}

export function durationInFrames(research: ResearchPackage, audioDurationSec?: number, timingMode: "scaled" | "estimated" = "scaled") {
  return Math.max(1, Math.ceil(timelineDuration(research, audioDurationSec, timingMode) * FPS));
}

export function setSceneDuration(research: ResearchPackage, sceneId: string, durationSec: number): ResearchPackage {
  if (!Number.isFinite(durationSec) || durationSec < 0.1 || durationSec > 120) throw new Error("Durasi scene harus antara 0,1 dan 120 detik.");
  const index = research.scenes.findIndex((scene) => scene.id === sceneId);
  if (index < 0) throw new Error(`Scene ${sceneId} tidak ditemukan.`);
  const selected = research.scenes[index]!;
  const nextEnd = Math.round((selected.startSec + durationSec) * 1000) / 1000;
  const delta = nextEnd - selected.endSec;
  const scenes = research.scenes.map((scene, sceneIndex) => sceneIndex < index ? scene
    : sceneIndex === index ? { ...scene, endSec: nextEnd }
      : { ...scene, startSec: Math.round((scene.startSec + delta) * 1000) / 1000, endSec: Math.round((scene.endSec + delta) * 1000) / 1000 });
  const lastEnd = scenes.at(-1)!.endSec;
  if (lastEnd > 120) throw new Error("Durasi total video tidak boleh melebihi 120 detik.");
  return { ...research, targetDurationSec: Math.max(1, Math.ceil(lastEnd)), scenes };
}

export function canStartNewJob(createdAt: string[], nowMs: number, limit = 1) {
  const cutoff = nowMs - 24 * 60 * 60 * 1000;
  const recent = createdAt.map((value) => Date.parse(value)).filter((value) => Number.isFinite(value) && value > cutoff);
  return { allowed: recent.length < limit, nextAllowedAt: recent.length < limit ? null : new Date(Math.min(...recent) + 24 * 60 * 60 * 1000).toISOString() };
}
