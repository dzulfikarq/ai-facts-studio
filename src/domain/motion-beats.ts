import { FPS } from "./timeline";
import { motionActionSchema, type MotionAction } from "./motion-director";

export type MotionBeat = {
  id: string;
  description: string;
  targetLayerId: string;
  targetNode: string;
  targetRole: string;
  action: MotionAction["kind"];
  startTimeSec: number;
  durationSec: number;
  easing: MotionAction["easing"];
  motionPathRef?: string;
  path?: MotionAction["path"];
  pathStyle?: MotionAction["pathStyle"];
  stateBefore?: MotionAction["keyframes"] extends Array<infer K> | undefined ? K : never;
  stateAfter?: MotionAction["keyframes"] extends Array<infer K> | undefined ? K : never;
};

export function motionBeatFromAction(action: MotionAction, fps = FPS): MotionBeat {
  const targetLayerId = action.targetLayerId ?? action.targetNode.split("/")[0]!;
  const endpoint = action.keyframes;
  return {
    id: action.id,
    description: action.description ?? `${action.kind.replaceAll("-", " ")} · ${targetLayerId}`,
    targetLayerId,
    targetNode: action.targetNode,
    targetRole: action.targetRole ?? targetLayerId.replaceAll("-", " "),
    action: action.kind,
    startTimeSec: action.startFrame / fps,
    durationSec: action.durationFrames / fps,
    easing: action.easing,
    ...(action.motionPathRef ?? (action.path ? `path-${action.id}` : undefined) ? { motionPathRef: action.motionPathRef ?? `path-${action.id}` } : {}),
    ...(action.path ? { path: action.path } : {}),
    ...(action.pathStyle ? { pathStyle: action.pathStyle } : {}),
    ...(endpoint?.length ? { stateBefore: endpoint[0], stateAfter: endpoint.at(-1) } : {}),
  };
}

export function updateMotionBeat(action: MotionAction, change: Partial<Pick<MotionBeat, "description" | "targetLayerId" | "targetNode" | "targetRole" | "startTimeSec" | "durationSec" | "easing" | "path" | "pathStyle">>, sceneDurationSec: number, fps = FPS): MotionAction {
  const totalFrames = Math.max(1, Math.floor(sceneDurationSec * fps));
  const durationFrames = Math.max(1, Math.min(totalFrames, Math.round((change.durationSec ?? action.durationFrames / fps) * fps)));
  const startFrame = Math.max(0, Math.min(totalFrames - durationFrames, Math.round((change.startTimeSec ?? action.startFrame / fps) * fps)));
  return motionActionSchema.parse({
    ...action,
    ...(change.description === undefined ? {} : { description: change.description.trim() || undefined }),
    ...(change.targetLayerId === undefined ? {} : { targetLayerId: change.targetLayerId }),
    ...(change.targetNode === undefined ? {} : { targetNode: change.targetNode }),
    ...(change.targetRole === undefined ? {} : { targetRole: change.targetRole }),
    ...(change.easing === undefined ? {} : { easing: change.easing }),
    ...(change.path === undefined ? {} : { path: change.path }),
    ...(change.pathStyle === undefined ? {} : { pathStyle: change.pathStyle }),
    startFrame,
    durationFrames,
  });
}
