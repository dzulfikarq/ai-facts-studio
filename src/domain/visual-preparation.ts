export type VisualPreparationSceneStatus = "pending" | "preparing" | "ready_for_review" | "needs_attention" | "approved" | "failed";
export type VisualPreparationScene = {
  sceneId: string;
  status: VisualPreparationSceneStatus;
  source?: "preserved" | "reusable-scene" | "asset-library" | "local-composer" | "ai-vector" | "ai-image" | "upload";
  message?: string;
  recommendations?: string[];
};
export type VisualPreparationJob = {
  id: string;
  projectId: string;
  requestId: string;
  status: "running" | "completed" | "partial_failure" | "failed";
  total: number;
  processed: number;
  currentSceneId: string | null;
  readyForReview: number;
  needsAttention: number;
  failed: number;
  approved: number;
  scenes: VisualPreparationScene[];
  createdAt: string;
  updatedAt: string;
};
