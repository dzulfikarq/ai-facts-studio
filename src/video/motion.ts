import { interpolate, spring } from "remotion";
import type { MotionCuePlan } from "../domain/visual-composition";

export type LayerMotion = { opacity: number; translateX: number; translateY: number; scale: number; reveal: number };
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function cueProgress(plan: MotionCuePlan, localFrame: number, fps = 30) {
  const elapsed = localFrame - plan.delayFrames;
  if (elapsed <= 0) return 0;
  const raw = plan.easing === "spring"
    ? spring({ frame: elapsed, fps, durationInFrames: plan.durationFrames, config: { damping: 18, stiffness: 90 } })
    : interpolate(elapsed, [0, plan.durationFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const t = clamp01(raw);
  if (plan.easing === "easeIn") return t * t;
  if (plan.easing === "easeOut") return 1 - (1 - t) * (1 - t);
  if (plan.easing === "easeInOut") return t * t * (3 - 2 * t);
  return t;
}

export function layerMotion(plans: MotionCuePlan[], layerId: string, depth: number, localFrame: number, progress: number): LayerMotion {
  const state: LayerMotion = { opacity: 1, translateX: 0, translateY: 0, scale: 1, reveal: 1 };
  for (const plan of plans) {
    if (!["all", "scene", layerId].includes(plan.targetLayer) || plan.cue === "cut" || plan.cue === "dissolve") continue;
    const t = cueProgress(plan, localFrame);
    switch (plan.cue) {
      case "fadeIn": state.opacity *= t; break;
      case "slide": state.translateY += (1 - t) * 72; break;
      case "scale": state.scale *= 0.86 + 0.14 * t; break;
      case "pan": state.translateX += interpolate(progress, [0, 1], [26, -26]) * t; break;
      case "zoom": state.scale *= 1 + 0.12 * progress * t; break;
      case "parallax":
        state.translateX += (0.5 - depth) * 52 * progress * t;
        state.translateY += (0.5 - depth) * 18 * progress * t;
        break;
      case "reveal": state.reveal = Math.min(state.reveal, t); break;
      case "pulse": state.scale *= 1 + Math.sin(t * Math.PI) * 0.045; break;
    }
  }
  state.opacity = clamp01(state.opacity);
  state.scale = Math.max(0.75, Math.min(1.25, state.scale));
  state.translateX = Math.max(-80, Math.min(80, state.translateX));
  state.translateY = Math.max(-80, Math.min(80, state.translateY));
  return state;
}

export function sceneTransitionOpacity(plans: MotionCuePlan[], localFrame: number) {
  if (plans.some((plan) => plan.cue === "cut")) return 1;
  const dissolve = plans.find((plan) => plan.cue === "dissolve");
  return dissolve ? cueProgress(dissolve, localFrame) : 1;
}
