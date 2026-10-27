import { interpolate, spring } from "remotion";
import type { MotionCuePlan } from "../domain/visual-composition";
import { motionActionProgress, motionActionValue, motionPathProgress, type MotionAction } from "../domain/motion-director";

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
      case "slide": state.translateY += (1 - t) * 108; break;
      case "scale": state.scale *= 0.82 + 0.18 * t; break;
      case "pan": state.translateX += interpolate(progress, [0, 1], [42, -42]) * t; break;
      case "zoom": state.scale *= 1 + 0.18 * progress * t; break;
      case "parallax":
        state.translateX += (0.5 - depth) * 88 * progress * t;
        state.translateY += (0.5 - depth) * 34 * progress * t;
        break;
      case "reveal": state.reveal = Math.min(state.reveal, t); break;
      case "pulse": state.scale *= 1 + Math.sin(t * Math.PI) * 0.06; break;
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

export function carriedMotionProgress(sceneOrder: number, activationOrder: number, action: MotionAction | undefined, frame: number, fallback = 0) {
  if (sceneOrder < activationOrder) return 0;
  if (sceneOrder > activationOrder) return 1;
  return action ? motionPathProgress(action, frame) : clamp01(fallback);
}

export function nodeMotion(actions: MotionAction[], targetNode: string, box: { x: number; y: number; width: number; height: number }, frame: number) {
  const state = { x: box.x + box.width / 2, y: box.y + box.height / 2, scale: 1, rotation: 0, opacity: 1 };
  let drawProgress: number | undefined;
  for (const action of actions) {
    if (action.targetNode !== targetNode) continue;
    const progress = motionActionProgress(action, frame);
    if (action.kind === "draw") { drawProgress = progress ?? (frame < action.startFrame ? 0 : 1); continue; }
    if (action.kind === "particle-flow") continue;
    const actionFrame = progress === null
      ? frame < action.startFrame ? action.startFrame : action.startFrame + action.durationFrames
      : frame;
    if (action.kind === "follow-path" && action.path) {
      const point = pointAlongPolyline(action.path, progress ?? (frame < action.startFrame ? 0 : 1));
      state.x = point.x; state.y = point.y;
      continue;
    }
    const next = motionActionValue(action, actionFrame, state);
    if (!next) continue;
    if (["translate", "repeat"].includes(action.kind)) { state.x = next.x; state.y = next.y; }
    if (["scale", "focus-shift"].includes(action.kind)) state.scale *= next.scale;
    if (action.kind === "rotate") state.rotation += next.rotation;
    if (["fade", "reveal", "state-transition"].includes(action.kind)) state.opacity *= next.opacity;
  }
  return {
    translateX: state.x - (box.x + box.width / 2), translateY: state.y - (box.y + box.height / 2),
    scale: Math.max(0.75, Math.min(1.25, state.scale)), rotation: Math.max(-12, Math.min(12, state.rotation)),
    opacity: clamp01(state.opacity), drawProgress,
  };
}

export function pointAlongPolyline(points: Array<{ x: number; y: number }>, progress: number) {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let distance = Math.max(0, Math.min(1, progress)) * total;
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index]!;
    if (distance <= length || index === lengths.length - 1) {
      const amount = length ? distance / length : 0;
      const from = points[index]!; const to = points[index + 1]!;
      return { x: from.x + (to.x - from.x) * amount, y: from.y + (to.y - from.y) * amount };
    }
    distance -= length;
  }
  return points.at(-1)!;
}
