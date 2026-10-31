export const workspaceSteps = [
  { id: "materials", title: "Materi & Storyboard", description: "Riset, scene, naskah, dan arahan visual" },
  { id: "narration", title: "Narasi", description: "Generate atau upload audio; pilih durasi manual" },
  { id: "video-editor", title: "Video Editor", description: "Visual Flow, gerak, klip, teks, transisi, audio, dan preview" },
  { id: "review", title: "Review", description: "Verifikasi fakta, materi, dan kesiapan konten" },
  { id: "preview", title: "Preview Video", description: "Tinjau hasil lengkap sebelum render" },
  { id: "render", title: "Render & Download", description: "Buat MP4 final" },
] as const;

export type WorkspaceStep = typeof workspaceSteps[number]["id"];
export type WorkflowStatus = "not-started" | "active" | "complete" | "attention";
export function normalizeWorkspaceStep(value: string | null): WorkspaceStep | null {
  if (value === "visual" || value === "editor" || value === "video-editor") return "video-editor";
  return workspaceSteps.some((step) => step.id === value) ? value as WorkspaceStep : null;
}

export type WorkflowSignals = {
  activeStep: WorkspaceStep;
  hasResearch: boolean;
  saved: boolean;
  visualStoryboardReady: boolean;
  visualStoryboardApproved: boolean;
  hasAudio: boolean;
  audioMatchesNarration: boolean;
  hasPendingAudio: boolean;
  narrationMode: "unset" | "audio" | "manual";
  reviewVerified: boolean;
  hasWarnings: boolean;
  previewReviewed: boolean;
  latestJobState?: string;
  latestJobContentCurrent: boolean;
};

export function workflowStatuses(signals: WorkflowSignals): Record<WorkspaceStep, WorkflowStatus> {
  const activeIndex = workspaceSteps.findIndex((step) => step.id === signals.activeStep);
  const completed: Record<WorkspaceStep, boolean> = {
    materials: signals.hasResearch && signals.saved,
    narration: signals.narrationMode === "manual" && !signals.hasAudio || signals.hasAudio && signals.audioMatchesNarration && !signals.hasPendingAudio,
    "video-editor": signals.saved && signals.visualStoryboardReady && signals.visualStoryboardApproved,
    review: signals.reviewVerified,
    preview: signals.previewReviewed,
    render: signals.latestJobState === "rendered" && signals.latestJobContentCurrent,
  };
  const attention: Record<WorkspaceStep, boolean> = {
    materials: !signals.hasResearch || !signals.saved,
    narration: signals.hasPendingAudio || (!signals.hasAudio && signals.narrationMode !== "manual" && activeIndex > 1) || (signals.hasAudio && !signals.audioMatchesNarration),
    "video-editor": !signals.saved || !signals.visualStoryboardReady || !signals.visualStoryboardApproved,
    review: signals.hasWarnings || (!signals.reviewVerified && activeIndex > 3),
    preview: !signals.previewReviewed && activeIndex > 4,
    render: signals.latestJobState === "failed" || Boolean(signals.latestJobState && !signals.latestJobContentCurrent),
  };
  return Object.fromEntries(workspaceSteps.map(({ id }, index) => [
    id,
    completed[id] ? id === signals.activeStep ? "active" : "complete"
      : attention[id] ? "attention"
        : index === activeIndex ? "active" : "not-started",
  ])) as Record<WorkspaceStep, WorkflowStatus>;
}

export function canAdvanceWorkspaceStep(step: WorkspaceStep, signals: WorkflowSignals) {
  if (step === "materials") return signals.hasResearch && signals.saved;
  if (step === "narration") return signals.narrationMode === "manual" && !signals.hasAudio || signals.hasAudio && signals.audioMatchesNarration && !signals.hasPendingAudio;
  if (step === "video-editor") return signals.saved && signals.visualStoryboardReady && signals.visualStoryboardApproved;
  if (step === "review") return signals.reviewVerified;
  if (step === "preview") return signals.previewReviewed;
  return false;
}

export function reachableWorkspaceStep(target: WorkspaceStep, signals: WorkflowSignals): WorkspaceStep {
  const targetIndex = workspaceSteps.findIndex((step) => step.id === target);
  for (let index = 0; index < targetIndex; index++) {
    const step = workspaceSteps[index]!.id;
    if (!canAdvanceWorkspaceStep(step, signals)) return step;
  }
  return target;
}

export function storedWorkspaceStep(projectId: string): WorkspaceStep {
  try {
    const saved = localStorage.getItem(`ai-facts-studio:workspace-step:${projectId}`);
    return normalizeWorkspaceStep(saved) ?? "materials";
  } catch { return "materials"; }
}

export function previewReviewFingerprint(
  research: { title: string; category: string; targetDurationSec: number; visualPreset: string; scenes: unknown[] },
  audio?: { file: string; sha256: string; durationSec: number; timingMode: "scaled" | "estimated"; source: "upload" | "tts" } | null,
  rendererVersion = 0,
) {
  return JSON.stringify([research.title, research.category, research.targetDurationSec, research.visualPreset, research.scenes, audio ?? null, rendererVersion]);
}

export function storedPreviewReviewed(projectId: string, fingerprint: string) {
  try { return localStorage.getItem(`ai-facts-studio:preview-reviewed:${projectId}`) === fingerprint; }
  catch { return false; }
}
