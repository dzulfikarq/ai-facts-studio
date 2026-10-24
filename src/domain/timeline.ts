import type { ResearchPackage, Scene } from "./research";

export const FPS = 30;

export function timelineDuration(research: ResearchPackage, audioDurationSec?: number) {
  return audioDurationSec && audioDurationSec > 0 ? audioDurationSec : research.targetDurationSec;
}

export function sceneTimes(research: ResearchPackage, scene: Scene, durationSec: number, timingMode: "scaled" | "estimated" = "scaled") {
  if (timingMode === "estimated") return { startSec: scene.startSec, endSec: scene.endSec };
  const scale = durationSec / research.targetDurationSec;
  return { startSec: scene.startSec * scale, endSec: scene.endSec * scale };
}

export function durationInFrames(research: ResearchPackage, audioDurationSec?: number) {
  return Math.max(1, Math.ceil(timelineDuration(research, audioDurationSec) * FPS));
}

export function canStartNewJob(createdAt: string[], nowMs: number, limit = 1) {
  const cutoff = nowMs - 24 * 60 * 60 * 1000;
  const recent = createdAt.map((value) => Date.parse(value)).filter((value) => Number.isFinite(value) && value > cutoff);
  return { allowed: recent.length < limit, nextAllowedAt: recent.length < limit ? null : new Date(Math.min(...recent) + 24 * 60 * 60 * 1000).toISOString() };
}
