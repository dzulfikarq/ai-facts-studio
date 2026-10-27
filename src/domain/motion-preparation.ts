import type { MotionIntensity } from "./motion-director";

export type MotionPreparationSceneStatus = "pending" | "preparing" | "ready_for_review" | "preserved" | "needs_attention" | "failed" | "cancelled";
export type MotionPreparationScene = {
  sceneId: string;
  status: MotionPreparationSceneStatus;
  message?: string;
};
export type MotionPreparationJob = {
  id: string;
  projectId: string;
  requestId: string;
  status: "running" | "completed" | "partial_failure" | "failed" | "cancelled";
  intensity: MotionIntensity;
  total: number;
  processed: number;
  currentSceneId: string | null;
  readyForReview: number;
  preserved: number;
  needsAttention: number;
  failed: number;
  scenes: MotionPreparationScene[];
  cancelRequested?: boolean;
  createdAt: string;
  updatedAt: string;
};
