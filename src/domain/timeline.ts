import type { ResearchPackage, Scene } from "./research";
import { outroTrimFrames } from "./outro";

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

export function durationInFrames(research: ResearchPackage, audioDurationSec?: number, timingMode: "scaled" | "estimated" = "scaled", outro?: { enabled?: boolean; trimInSec: number; trimOutSec: number } | null) {
  return Math.max(1, Math.ceil(timelineDuration(research, audioDurationSec, timingMode) * FPS)) + outroTrimFrames(outro, FPS);
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

export function appendResearchScene(research: ResearchPackage, scene: Omit<Scene, "order" | "startSec" | "endSec">): ResearchPackage {
  if (research.scenes.length >= 30) throw new Error("Storyboard maksimal 30 scene.");
  if (research.scenes.some((item) => item.id === scene.id)) throw new Error("ID scene harus unik.");
  const last = research.scenes.at(-1);
  if (!last) throw new Error("Storyboard harus memiliki minimal satu scene.");
  const startSec = last.endSec;
  const durationSec = Math.min(5, Math.round((120 - startSec) * 1000) / 1000);
  if (durationSec < 0.1) throw new Error("Tidak ada ruang durasi untuk scene baru; batas video 120 detik.");
  const endSec = Math.round((startSec + durationSec) * 1000) / 1000;
  return {
    ...research,
    targetDurationSec: Math.max(research.targetDurationSec, Math.ceil(endSec)),
    scenes: [...research.scenes, { ...scene, order: last.order + 1, startSec, endSec }],
  };
}

export function deleteResearchScene(research: ResearchPackage, sceneId: string): ResearchPackage {
  if (research.scenes.length <= 1) throw new Error("Storyboard harus memiliki minimal satu scene.");
  const removedIndex = research.scenes.findIndex((scene) => scene.id === sceneId);
  if (removedIndex < 0) throw new Error(`Scene ${sceneId} tidak ditemukan.`);
  const removed = research.scenes[removedIndex]!;
  const removedDuration = Math.round((removed.endSec - removed.startSec) * 1000) / 1000;
  const scenes = research.scenes.filter((scene) => scene.id !== sceneId).map((scene, index) => {
    if (index < removedIndex) return { ...scene, order: index + 1 };
    return {
      ...scene,
      order: index + 1,
      startSec: Math.round((scene.startSec - removedDuration) * 1000) / 1000,
      endSec: Math.round((scene.endSec - removedDuration) * 1000) / 1000,
    };
  });
  return { ...research, targetDurationSec: Math.max(1, Math.ceil(scenes.at(-1)!.endSec)), scenes };
}

export function reorderResearchScene(research: ResearchPackage, sceneId: string, nextIndex: number): ResearchPackage {
  const currentIndex = research.scenes.findIndex((scene) => scene.id === sceneId);
  if (currentIndex < 0) throw new Error(`Scene ${sceneId} tidak ditemukan.`);
  if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= research.scenes.length) throw new Error("Urutan scene tidak valid.");
  if (currentIndex === nextIndex) return research;
  const scenes = [...research.scenes];
  const [moved] = scenes.splice(currentIndex, 1);
  scenes.splice(nextIndex, 0, moved!);
  let cursor = research.scenes[0]!.startSec;
  const reordered = scenes.map((scene, index) => {
    const duration = scene.endSec - scene.startSec;
    const startSec = Math.round(cursor * 1000) / 1000;
    const endSec = Math.round((startSec + duration) * 1000) / 1000;
    cursor = endSec;
    return { ...scene, order: index + 1, startSec, endSec };
  });
  if (cursor > 120) throw new Error("Durasi total video tidak boleh melebihi 120 detik.");
  return { ...research, targetDurationSec: Math.max(research.targetDurationSec, Math.ceil(cursor)), scenes: reordered };
}

export function canStartNewJob(createdAt: string[], nowMs: number, limit = 1) {
  const cutoff = nowMs - 24 * 60 * 60 * 1000;
  const recent = createdAt.map((value) => Date.parse(value)).filter((value) => Number.isFinite(value) && value > cutoff);
  return { allowed: recent.length < limit, nextAllowedAt: recent.length < limit ? null : new Date(Math.min(...recent) + 24 * 60 * 60 * 1000).toISOString() };
}
