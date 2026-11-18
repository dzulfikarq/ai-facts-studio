import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowDown, ArrowUp, BookOpen, CircleAlert, Clock3, Film, House, Info, Plus, Save as SaveIcon, Search, Settings as SettingsIcon, SlidersHorizontal, Sparkles, Sun, Trash2, TriangleAlert } from "lucide-react";
import { Player } from "@remotion/player";
import type { PlayerRef } from "@remotion/player";
import type { AnyZodObject } from "remotion";
import { categories, researchReferenceSchema, researchWarnings, visualPresets, type ResearchPackage, type ResearchReference, type Scene } from "../domain/research";
import type { AiGenerationDraft, AiGenerationInput } from "../domain/ai-generation";
import type { ManualProjectBrief } from "../domain/manual-project";
import type { StorySeriesProjectLink } from "../domain/story-series";
import { applyVisualStoryboard, buildVisualStoryboard, buildVisualWorld, compositionForVisualScene, illustrationSourceForScene, retimeVisualStoryboard, visualApprovalFingerprint, visualObjectIds, visualObjectLibrary, visualStoryboardQualityGate, type VisualStoryboard, type VisualStoryboardScene } from "../domain/visual-storyboard";
import { composeVisualScene } from "../domain/visual-composer";
import { visualCompositionSchema, visualImageNodes } from "../domain/visual-composition";
import type { VisualAsset } from "../domain/visual-assets";
import { isAnimatedMediaFile, type SceneMedia } from "../domain/scene-media";
import type { OutroLibraryAsset, OutroSelection } from "../domain/outro";
import type { GoogleFlowStyleLock } from "../domain/google-flow";
import { animationStylePromptIsStale, DEFAULT_ANIMATION_STYLE_ID, getAnimationStylePreset, type AnimationStyleId } from "../domain/animation-styles";
import type { OpenverseImage, ReusableSceneInput, TablerIconEntry } from "../domain/asset-library";
import type { AssetPlacement, ReusableSceneEntry } from "./SmartAssetLibraryDialog";
import { buildIllustrationPrompt } from "../domain/illustration-prompt";
import type { VisualSemanticPlan } from "../domain/visual-semantic-plan";
import type { AiVectorIllustration } from "../domain/ai-vector-illustration";
import type { VisualPreparationJob } from "../domain/visual-preparation";
import type { MotionPreparationJob } from "../domain/motion-preparation";
import { planSceneMotion, type MotionIntensity } from "../domain/motion-director";
import { appendResearchScene, deleteResearchScene, durationInFrames, reorderResearchScene, setSceneDuration } from "../domain/timeline";
import { defaultMotionPlan, defaultVisualComposition } from "../domain/visual-defaults";
import { narrationScript } from "../domain/voice-timing";
import { seedVolcanoVisualSample } from "../domain/volcano-visual-sample";
import { previewInputProps } from "../video/video";
import { VersionedVideo, type VideoProps } from "../video/root";
import { LEGACY_RENDERER_VERSION, RENDERER_VERSION } from "../video/renderer-version";
import { WorkflowStepper } from "./WorkflowStepper";
import { ReviewStep } from "./ReviewStep";
import { AiGenerationPanel, GeminiTextQuotaSummary, type ProductionStatus } from "./AiGenerationPanel";
import { ManualProjectPanel } from "./ManualProjectPanel";
import { AnimationStyleGallery } from "./AnimationStyleGallery";
import { VideoEditorV2 } from "./VideoEditorV2";
import { OutroLibraryPanel } from "./OutroLibraryPanel";
import { StorySeriesPage } from "./StorySeriesPage";
import type { FlowBatchItem, FlowBatchProgress } from "./GoogleFlowPanel";
import { AppearanceSettings, ThemeSwitcher, useThemePreference, type ThemePreference } from "./theme-system";
import { canAdvanceWorkspaceStep, previewReviewFingerprint, reachableWorkspaceStep, storedPreviewReviewed, storedWorkspaceStep, workflowStatuses, workspaceSteps, type WorkspaceStep } from "./workflow";
import { appRouteHref, parseAppRoute, settingsSections, type AppRoute, type SettingsSection } from "./routes";
import "./styles.css";
import "./tts.css";
import "./workflow.css";
import "./workspace-refinement.css";
import "./visual-storyboard.css";
import "./redesign.css";

type Job = {
  id: string;
  projectId: string;
  state: string;
  createdAt: string;
  error: string | null;
  progress: number;
  attemptCount: number;
  rendererVersion: number;
  manifest: { width: number; height: number; durationSec: number; videoCodec: string; audioCodec: string | null; audioDurationSec?: number | null; audioMeanVolumeDb?: number | null; audioMaxVolumeDb?: number | null; audioValidation?: "silent-expected" | "pass" | "pass-low-level" | "pass-media"; audioLevelWarning?: string | null; audioSource?: string | null; audioSha256?: string | null; audioProvider?: string | null; audioModel?: string | null; audioCacheKey?: string | null; audioScriptSha256?: string | null; audioVoiceId?: string | null; audioVoice?: string | null; audioLocale?: string | null; audioStyle?: string | null; audioSpeakingRate?: number | null; audioApprovedAt?: string | null; bytes: number; sha256: string; rendererVersion?: number } | null;
  downloadUrl: string | null;
} | null;

type Project = {
  id: string;
  creationMode: "manual" | "ai-generated" | "imported" | "sample" | "legacy";
  creationBrief?: ManualProjectBrief;
  animationStyleId?: AnimationStyleId;
  storySeries?: StorySeriesProjectLink;
  researchPackage: ResearchPackage;
  visualStoryboard: VisualStoryboard;
  visualStoryboardError?: string;
  sceneMediaErrors?: Record<string, string>;
  visualPreparation: VisualPreparationJob | null;
  motionPreparation: MotionPreparationJob | null;
  visualAssets: VisualAsset[];
  outro: OutroSelection | null;
  outroAsset: OutroLibraryAsset | null;
  outroError?: string;
  audio: {
    file: string; name: string; durationSec: number; bytes: number; sha256: string;
    source: "upload" | "tts"; timingMode: "scaled" | "estimated";
    tts?: { provider: string; model: string; cacheKey: string; scriptSha256: string; locale: string; voiceId: string; voiceName: string; gender: string; voiceAvailability: "api" | "fallback"; speakingRate: number; style: string; generatedAt: string; approvedAt?: string; alignment: "estimated" };
  } | null;
  pendingTts: { cacheKey: string; scriptSha256: string; audioUrl: string; durationSec: number; bytes: number; voiceName: string; locale: string; style: string; speakingRate: number; generatedAt: string } | null;
  narrationMode: "unset" | "audio" | "manual";
  pendingTtsMatchesNarration: boolean;
  audioMatchesNarration: boolean;
  researchReviewStatus: "needs-review" | "verified-by-author";
  latestJobCurrent: boolean;
  latestJobContentCurrent: boolean;
  createdAt: string;
  updatedAt: string;
  latestJob: Job;
};

type AiGenerationMode = "development" | "production";
type OutroLibraryState = { outros: OutroLibraryAsset[]; defaultOutroId: string | null };
type Status = { ffmpegAvailable: boolean; githubWorkflowAvailable: boolean; generationMode: AiGenerationMode; dailyLimit: number; jobsUsed: number; nextAllowedAt: string | null };
type AiGenerationSettings = {
  mode: AiGenerationMode;
  providers: {
    development: { id: "opencode-local"; displayName: string; configured: boolean; connected: boolean; state: "server-unreachable" | "authentication-failed" | "unsupported-api-version" | "model-unavailable" | "connected"; apiVersion: "v1" | "v2" | null; version: string | null; models: Array<{ id: string; providerID: string; modelID: string; name: string }>; disabledReason: string | null };
    production: ProductionStatus & { id: "gemini-developer-api"; displayName: string };
  };
  generationAvailable: boolean;
};
type AiImageStatus = "Not Configured" | "Ready" | "Generating" | "Rate Limited" | "Quota Exhausted" | "Failed";
type AiImageProviderCatalog = { status: AiImageStatus; configured: boolean; providers: Array<{ id: string; displayName: string; models: Array<{ id: string; license: string | null }>; selectedModel: string; supportedAspectRatios: string[]; resolutions: string[]; estimatedCost: null; costDisclosure: string }>; message: string | null; retryAt: string | null };
type IllustrationImportInfo = { source: "user-upload" | "ai-generated"; prompt?: string; license: string; provider?: string; model?: string };
type OpenCodeModel = AiGenerationSettings["providers"]["development"]["models"][number];
type OpenCodeModelGroup = { id: string; name: string; models: OpenCodeModel[] };
type TtsVoice = { id: string; name: string; locale: string; localeName: string; gender: string; description?: string; wordsPerMinute: number; availability: "api" | "fallback" };
type TtsVoices = { provider: string; providerName?: string; model?: string; freeTierOnly?: boolean; configured: boolean; disabledReason?: string; dailyLimit?: number; requestsUsed?: number; requestsRemaining?: number; locales: Array<{ locale: string; localeName: string }>; voices: TtsVoice[]; catalogSource?: "api" | "fallback"; catalogWarning?: string; message?: string };
type TtsPreview = { cacheKey: string; scriptSha256: string; audioUrl: string; durationSec: number; bytes: number; voiceName: string; locale: string; style: string; speakingRate: number; generatedAt: string; text?: string };
type Failure = Error & { code?: string; issues?: Array<{ path: Array<string | number>; message: string }>; nextAllowedAt?: string | null; retryAt?: string | null; quotaType?: string | null };
type ConfirmationOptions = { title: string; message: string; content?: React.ReactNode; confirmLabel: string; cancelLabel?: string; tone?: "primary" | "warning" | "danger"; onConfirm?: () => Promise<void> };
type PendingConfirmation = ConfirmationOptions & { resolve: (confirmed: boolean) => void; pending?: boolean; error?: string };
type TtsTimingChoice = "retime" | "keep-timeline" | "cancel";
type PendingTtsTiming = { previousDurationSec: number; nextDurationSec: number; hadActiveAudio: boolean; resolve: (choice: TtsTimingChoice) => void };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error ?? `Request gagal (${response.status})`) as Failure;
    error.code = body.code;
    error.issues = body.issues;
    error.nextAllowedAt = body.nextAllowedAt;
    error.retryAt = body.retryAt;
    error.quotaType = body.quotaType;
    throw error;
  }
  return body as T;
}

function apiWithUploadProgress<T>(url: string, body: FormData, onProgress: (progress: FlowBatchProgress) => void, timeoutMs = 120_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let lastPercent = -1;
    xhr.open("POST", url);
    xhr.timeout = timeoutMs;
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        const percent = Math.round(event.loaded / event.total * 100);
        if (percent !== lastPercent) { lastPercent = percent; onProgress({ stage: "uploading", percent }); }
      }
    });
    xhr.upload.addEventListener("load", () => onProgress({ stage: "processing" }));
    xhr.addEventListener("load", () => {
      let response: Record<string, unknown> = {};
      try { response = JSON.parse(xhr.responseText) as Record<string, unknown>; } catch { /* keep status fallback */ }
      if (xhr.status >= 200 && xhr.status < 300) { resolve(response as T); return; }
      const error = new Error(typeof response.error === "string" ? response.error : `Request gagal (${xhr.status})`) as Failure;
      error.code = typeof response.code === "string" ? response.code : undefined;
      error.issues = Array.isArray(response.issues) ? response.issues as Failure["issues"] : undefined;
      reject(error);
    });
    xhr.addEventListener("error", () => reject(new Error("Koneksi terputus saat mengimpor batch.")));
    xhr.addEventListener("abort", () => reject(new Error("Impor batch dibatalkan.")));
    xhr.addEventListener("timeout", () => reject(new Error("Request batch melewati batas 120 detik. Periksa koneksi/server, lalu coba ulang file yang gagal.")));
    xhr.send(body);
  });
}

const jsonRequest = (method: string, payload: unknown, signal?: AbortSignal): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
  signal,
});

function friendlyError(error: unknown) {
  if (!(error instanceof Error)) return "Ada kendala. Coba lagi.";
  const failure = error as Failure;
  if (failure.issues?.length) return `${failure.message} ${failure.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" · ")}`;
  if (failure.nextAllowedAt) return `${failure.message} Berikutnya ${new Date(failure.nextAllowedAt).toLocaleString("id-ID")}.`;
  return error.message;
}

function renderOutro(outro: OutroSelection | null, asset: OutroLibraryAsset | null) {
  if (!outro?.enabled || !asset) return undefined;
  return { assetId: asset.id, name: asset.name, file: `outros/${asset.file}`, sha256: asset.sha256, bytes: asset.bytes, durationSec: asset.durationSec, trimInSec: outro.trimInSec, trimOutSec: outro.trimOutSec, audioEnabled: outro.audioEnabled };
}

function App() {
  const [route, setRoute] = useState<AppRoute>(() => parseAppRoute(window.location.href));
  const routeRef = useRef(route);
  routeRef.current = route;
  const view = route.view;
  const activeStep: WorkspaceStep = route.view === "workspace" ? route.step : "materials";
  const [theme, setTheme] = useThemePreference();
  const [createMode, setCreateMode] = useState<"ai" | "manual">("ai");
  const [selectedCreateAnimationStyleId, setSelectedCreateAnimationStyleId] = useState<AnimationStyleId>(DEFAULT_ANIMATION_STYLE_ID);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [sceneMediaErrors, setSceneMediaErrors] = useState<Record<string, string>>({});
  const [research, setResearch] = useState<ResearchPackage | null>(null);
  const [jsonDraft, setJsonDraft] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [aiGenerationSettings, setAiGenerationSettings] = useState<AiGenerationSettings | null>(null);
  const [aiImageProviders, setAiImageProviders] = useState<AiImageProviderCatalog | null>(null);
  const [aiSettingsBusy, setAiSettingsBusy] = useState(false);
  const [aiSettingsError, setAiSettingsError] = useState("");
  const [outroLibrary, setOutroLibrary] = useState<OutroLibraryState>({ outros: [], defaultOutroId: null });
  const [outroLibraryLoaded, setOutroLibraryLoaded] = useState(false);
  const [outroLibraryBusy, setOutroLibraryBusy] = useState(false);
  const [selectedCreateOutroId, setSelectedCreateOutroId] = useState<string | null | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [generatingVisualSceneId, setGeneratingVisualSceneId] = useState<string | null>(null);
  const [planningVisualSceneId, setPlanningVisualSceneId] = useState<string | null>(null);
  const [vectorizingVisualSceneId, setVectorizingVisualSceneId] = useState<string | null>(null);
  const [librarySceneId, setLibrarySceneId] = useState<string | null>(null);
  const [libraryInitialTab, setLibraryInitialTab] = useState<"mine" | "scenes">("mine");
  const [visualPlannerModel, setVisualPlannerModel] = useState("");
  const [saved, setSaved] = useState(true);
  const [previewStarted, setPreviewStarted] = useState(false);
  const [previewReviewed, setPreviewReviewed] = useState(false);
  const [audioMode, setAudioMode] = useState<"ai" | "upload">("upload");
  const [ttsLocale, setTtsLocale] = useState("id-ID");
  const [ttsGender, setTtsGender] = useState("All");
  const [ttsVoiceId, setTtsVoiceId] = useState("");
  const [ttsStyle, setTtsStyle] = useState("documentary");
  const [ttsRate, setTtsRate] = useState(1);
  const [ttsVoices, setTtsVoices] = useState<TtsVoices | null>(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsBusy, setTtsBusy] = useState(false);
  const [ttsMessage, setTtsMessage] = useState("");
  const [testVoicePreview, setTestVoicePreview] = useState<TtsPreview | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const confirmationRef = useRef<PendingConfirmation | null>(null);
  const [ttsTimingPrompt, setTtsTimingPrompt] = useState<PendingTtsTiming | null>(null);
  const createDraftUnsaved = useRef(false);
  const [createDraftUnsavedState, setCreateDraftUnsavedState] = useState(false);
  const popNavigationPending = useRef(false);
  const restorePopNavigation = useRef(false);
  const routeHistoryIndex = useRef(0);
  const previewPlayer = useRef<PlayerRef>(null);
  const setCreateDraftUnsaved = useCallback((value: boolean) => { createDraftUnsaved.current = value; setCreateDraftUnsavedState(value); }, []);

  const selectedSceneId = route.view === "workspace" ? route.sceneId : null;
  const selectedScene = useMemo(() => research?.scenes.find((scene) => scene.id === selectedSceneId) ?? research?.scenes[0], [research, selectedSceneId]);
  const visualResearch = useMemo(() => project && research && !project.visualStoryboardError ? applyVisualStoryboard(research, project.visualStoryboard) : research, [project?.visualStoryboard, project?.visualStoryboardError, project?.id, research]);
  const visualGate = useMemo(() => project && visualResearch && !project.visualStoryboardError ? visualStoryboardQualityGate(visualResearch, project.visualStoryboard, project.visualAssets) : null, [project?.visualStoryboard, project?.visualStoryboardError, project?.visualAssets, visualResearch]);
  const visualApproved = Boolean(visualGate?.ready && !Object.keys(sceneMediaErrors).length && project?.visualStoryboard.scenes.length && project.visualStoryboard.scenes.every((scene) => scene.approved));
  const reviewFingerprint = project && visualResearch ? previewReviewFingerprint(visualResearch, project.audio, RENDERER_VERSION, project.outro) : "";
  const draftAudioMatches = !project?.audio || project.audio.source !== "tts" || Boolean(project.audioMatchesNarration && visualResearch && narrationScript(visualResearch) === narrationScript(project.researchPackage));
  const workflowSignals = {
    activeStep,
    hasResearch: Boolean(research),
    saved,
    visualStoryboardReady: Boolean(visualGate?.ready && !Object.keys(sceneMediaErrors).length),
    visualStoryboardApproved: visualApproved,
    hasAudio: Boolean(project?.audio),
    audioMatchesNarration: draftAudioMatches,
    hasPendingAudio: Boolean(project?.pendingTts),
    narrationMode: project?.narrationMode ?? "unset",
    reviewVerified: project?.researchReviewStatus === "verified-by-author" && saved,
    hasWarnings: Boolean(research && researchWarnings(research).length),
    previewReviewed,
    latestJobState: project?.latestJob?.state,
    latestJobContentCurrent: Boolean(project?.latestJobContentCurrent),
  };
  const stepStatuses = workflowStatuses(workflowSignals);
  const renderMode = aiGenerationSettings?.mode ?? status?.generationMode ?? null;
  const sceneEditingLocked = busy || ttsBusy || ttsLoading || project?.visualPreparation?.status === "running" || project?.motionPreparation?.status === "running";

  function commitRoute(next: AppRoute, mode: "push" | "replace" = "push") {
    const href = appRouteHref(next);
    const currentHref = `${window.location.pathname}${window.location.search}`;
    if (href !== currentHref) {
      if (mode === "push") {
        routeHistoryIndex.current += 1;
        window.history.pushState({ aiFactsStudioIndex: routeHistoryIndex.current }, "", href);
      } else window.history.replaceState({ aiFactsStudioIndex: routeHistoryIndex.current }, "", href);
    }
    routeRef.current = next;
    setRoute(next);
  }

  function navigateWorkspaceStep(step: WorkspaceStep, mode: "push" | "replace" = "push") {
    if (routeRef.current.view !== "workspace") return;
    commitRoute({ ...routeRef.current, step }, mode);
  }

  function selectScene(sceneId: string | null) {
    if (routeRef.current.view !== "workspace") return;
    commitRoute({ ...routeRef.current, sceneId }, "replace");
  }

  function hydrateProject(loaded: Project, requestedStep?: WorkspaceStep, requestedSceneId?: string | null): AppRoute {
    setProject(loaded);
    setSceneMediaErrors(loaded.sceneMediaErrors ?? {});
    setResearch(loaded.researchPackage);
    setAudioMode(loaded.audio?.source === "tts" ? "ai" : "upload");
    setTtsLocale(loaded.audio?.tts?.locale ?? "id-ID");
    setTtsGender(loaded.audio?.tts?.gender ?? "All");
    setTtsVoiceId(loaded.audio?.tts?.voiceId ?? "");
    setTtsStyle(loaded.audio?.tts?.style ?? "documentary");
    setTtsRate(loaded.audio?.tts?.speakingRate ?? 1);
    setTtsVoices(null);
    setTtsLoading(false);
    const loadedVisualResearch = loaded.visualStoryboardError ? loaded.researchPackage : applyVisualStoryboard(loaded.researchPackage, loaded.visualStoryboard);
    const loadedVisualGate = loaded.visualStoryboardError ? null : visualStoryboardQualityGate(loadedVisualResearch, loaded.visualStoryboard, loaded.visualAssets);
    const loadedVisualApproved = Boolean(loadedVisualGate?.ready && !Object.keys(loaded.sceneMediaErrors ?? {}).length && loaded.visualStoryboard.scenes.every((scene) => scene.approved));
    const savedPreviewReview = storedPreviewReviewed(loaded.id, previewReviewFingerprint(loadedVisualResearch, loaded.audio, RENDERER_VERSION, loaded.outro));
    const savedStep = requestedStep ?? storedWorkspaceStep(loaded.id);
    const reachableStep = loaded.visualStoryboardError ? "materials" : reachableWorkspaceStep(savedStep, {
      activeStep: savedStep,
      hasResearch: true,
      saved: true,
      visualStoryboardReady: Boolean(loadedVisualGate?.ready && !Object.keys(loaded.sceneMediaErrors ?? {}).length),
      visualStoryboardApproved: loadedVisualApproved,
      hasAudio: Boolean(loaded.audio),
      audioMatchesNarration: loaded.audio?.source !== "tts" || loaded.audioMatchesNarration,
      hasPendingAudio: Boolean(loaded.pendingTts),
      narrationMode: loaded.narrationMode,
      reviewVerified: loaded.researchReviewStatus === "verified-by-author",
      hasWarnings: researchWarnings(loaded.researchPackage).length > 0,
      previewReviewed: savedPreviewReview,
      latestJobState: loaded.latestJob?.state,
      latestJobContentCurrent: loaded.latestJobContentCurrent,
    });
    const sceneId = loaded.researchPackage.scenes.some((scene) => scene.id === requestedSceneId)
      ? requestedSceneId!
      : loaded.researchPackage.scenes[0]?.id ?? null;
    setPreviewReviewed(savedPreviewReview);
    setPreviewStarted(false);
    setTestVoicePreview(null);
    setSaved(true);
    setMessage("");
    setCreateDraftUnsaved(false);
    return { view: "workspace", projectId: loaded.id, step: reachableStep, sceneId };
  }

  async function loadProjectRoute(projectId: string, step: WorkspaceStep | undefined, sceneId: string | null, mode: "push" | "replace") {
    setBusy(true);
    try {
      const loaded = await api<Project>(`/api/projects/${encodeURIComponent(projectId)}`);
      const mediaHealth = loaded.visualStoryboardError ? { errors: {} } : await api<{ errors: Record<string, string> }>(`/api/projects/${encodeURIComponent(projectId)}/scene-media-health`);
      const next = hydrateProject({ ...loaded, sceneMediaErrors: mediaHealth.errors }, step, sceneId);
      commitRoute(next, mode);
      return next;
    } finally { setBusy(false); }
  }

  async function refresh() {
    try {
      const [list, serverStatus] = await Promise.all([
        api<Project[]>("/api/projects"),
        api<Status>("/api/status"),
      ]);
      setProjects(list);
      setStatus(serverStatus);
    } finally { setProjectsLoaded(true); }
  }

  async function refreshAiGenerationSettings() {
    const settings = await api<AiGenerationSettings>("/api/settings/ai-generation");
    setAiGenerationSettings(settings);
    setVisualPlannerModel((current) => settings.providers.development.models.some((model) => model.id === current) ? current : settings.providers.development.models[0]?.id ?? "");
    return settings;
  }

  async function refreshOutroLibrary() {
    const library = await api<OutroLibraryState>("/api/outros");
    setOutroLibrary(library);
    setSelectedCreateOutroId((current) => current !== undefined && current !== null && !library.outros.some((asset) => asset.id === current) ? null : current);
    setOutroLibraryLoaded(true);
    return library;
  }

  async function uploadOutro(file: File) {
    setOutroLibraryBusy(true);
    try {
      const form = new FormData();
      form.append("outro", file);
      const result = await api<{ asset: OutroLibraryAsset } & OutroLibraryState>("/api/outros", { method: "POST", body: form });
      setOutroLibrary({ outros: result.outros, defaultOutroId: result.defaultOutroId });
      setMessage(`Outro “${result.asset.name}” ditambahkan. Tetapkan sebagai default bila diperlukan.`);
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setOutroLibraryBusy(false); }
  }

  async function renameOutro(id: string, name: string) {
    setOutroLibraryBusy(true);
    try {
      const result = await api<{ asset: OutroLibraryAsset } & OutroLibraryState>(`/api/outros/${encodeURIComponent(id)}`, jsonRequest("PATCH", { name }));
      setOutroLibrary({ outros: result.outros, defaultOutroId: result.defaultOutroId });
      setMessage("Nama outro diperbarui.");
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setOutroLibraryBusy(false); }
  }

  async function makeOutroDefault(id: string) {
    setOutroLibraryBusy(true);
    try {
      setOutroLibrary(await api<OutroLibraryState>(`/api/outros/${encodeURIComponent(id)}/default`, { method: "POST" }));
      setMessage("Default outro diperbarui. Project lama tidak berubah.");
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setOutroLibraryBusy(false); }
  }

  async function deleteOutro(asset: OutroLibraryAsset) {
    await askConfirmation({
      title: "Hapus outro dari library?",
      message: `“${asset.name}” akan diarsipkan bila masih dipakai project atau snapshot render. File yang masih dirujuk tetap tersedia; tidak ada penggantian outro otomatis.`,
      confirmLabel: "Hapus outro",
      cancelLabel: "Pertahankan outro",
      tone: "danger",
      onConfirm: async () => {
        setOutroLibraryBusy(true);
        try {
          const result = await api<{ archived: boolean; projectReferences: number } & OutroLibraryState>(`/api/outros/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
          setOutroLibrary({ outros: result.outros, defaultOutroId: result.defaultOutroId });
          setMessage(result.archived ? `Outro “${asset.name}” diarsipkan; project yang memakainya tetap aman.` : `Outro “${asset.name}” dihapus permanen.`);
        } catch (error) { throw error; }
        finally { setOutroLibraryBusy(false); }
      },
    });
  }

  function askConfirmation(options: ConfirmationOptions) {
    return new Promise<boolean>((resolve) => {
      confirmationRef.current?.resolve(false);
      const next = { ...options, resolve };
      confirmationRef.current = next;
      setConfirmation(next);
    });
  }

  async function resolveConfirmation(confirmed: boolean) {
    const pending = confirmationRef.current;
    if (!pending || pending.pending) return;
    if (confirmed && pending.onConfirm) {
      const resolving = { ...pending, pending: true, error: "" };
      confirmationRef.current = resolving;
      setConfirmation(resolving);
      try { await pending.onConfirm(); }
      catch (error) {
        const failed = { ...resolving, pending: false, error: friendlyError(error) };
        confirmationRef.current = failed;
        setConfirmation(failed);
        return;
      }
    }
    confirmationRef.current = null;
    setConfirmation(null);
    pending.resolve(confirmed);
  }

  useEffect(() => {
    void refresh().catch((error) => setMessage(friendlyError(error)));
    void refreshAiGenerationSettings().catch((error) => setAiSettingsError(friendlyError(error)));
    void refreshOutroLibrary().catch((error) => setMessage(friendlyError(error)));
    void api<AiImageProviderCatalog>("/api/ai-image/providers").then(setAiImageProviders).catch(() => setAiImageProviders({ status: "Failed", configured: false, providers: [], message: "Provider gambar tidak tersedia; gunakan Prompt Builder + import manual.", retryAt: null }));
    const currentIndex = (window.history.state as { aiFactsStudioIndex?: unknown } | null)?.aiFactsStudioIndex;
    routeHistoryIndex.current = Number.isSafeInteger(currentIndex) ? currentIndex as number : 0;
    window.history.replaceState({ aiFactsStudioIndex: routeHistoryIndex.current }, "", window.location.href);
    const canonicalHref = appRouteHref(routeRef.current);
    if (canonicalHref !== `${window.location.pathname}${window.location.search}`) window.history.replaceState({ aiFactsStudioIndex: routeHistoryIndex.current }, "", canonicalHref);
    if (routeRef.current.view === "workspace") {
      const initialRoute = routeRef.current;
      void loadProjectRoute(initialRoute.projectId, initialRoute.step, initialRoute.sceneId, "replace").catch(() => {
        commitRoute({ view: "dashboard" }, "replace");
        setMessage("Project tidak ditemukan atau sudah dihapus. Pilih project lain dari Project Saya.");
      });
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const targetIndexValue = (window.history.state as { aiFactsStudioIndex?: unknown } | null)?.aiFactsStudioIndex;
      const targetIndex = Number.isSafeInteger(targetIndexValue) ? targetIndexValue as number : routeHistoryIndex.current - 1;
      if (restorePopNavigation.current) {
        routeHistoryIndex.current = targetIndex;
        restorePopNavigation.current = false;
        popNavigationPending.current = false;
        return;
      }
      if (popNavigationPending.current) {
        return;
      }
      popNavigationPending.current = true;
      const currentIndex = routeHistoryIndex.current;
      const target = parseAppRoute(window.location.href);
      const restoreCurrentRoute = () => {
        const delta = currentIndex - targetIndex;
        if (!delta) { popNavigationPending.current = false; return; }
        restorePopNavigation.current = true;
        window.history.go(delta);
      };
      let accepted = false;
      void (async () => {
        try {
          if (busy || ttsBusy || ttsLoading || aiSettingsBusy) {
            setMessage("Tunggu proses aktif selesai sebelum berpindah halaman.");
            restoreCurrentRoute();
            return;
          }
          if (route.view === "create" && target.view !== "create" && !await confirmLeaveCreate()) {
            restoreCurrentRoute();
            return;
          }
          if (route.view === "create" && target.view !== "create") setCreateDraftUnsaved(false);
          if (route.view === "workspace" && (target.view !== "workspace" || target.projectId !== route.projectId) && !await saveBeforeLeavingWorkspace()) {
            restoreCurrentRoute();
            return;
          }
          if (target.view === "workspace") {
            if (project?.id === target.projectId) {
              const reachableStep = reachableWorkspaceStep(target.step, { ...workflowSignals, activeStep: target.step });
              const sceneId = research?.scenes.some((scene) => scene.id === target.sceneId)
                ? target.sceneId
                : research?.scenes[0]?.id ?? null;
              routeHistoryIndex.current = targetIndex;
              commitRoute({ ...target, step: reachableStep, sceneId }, "replace");
              accepted = true;
              if (reachableStep !== target.step) setMessage("Langkah tersebut masih terkunci. Selesaikan langkah sebelumnya terlebih dahulu.");
              return;
            }
            try {
              routeHistoryIndex.current = targetIndex;
              await loadProjectRoute(target.projectId, target.step, target.sceneId, "replace");
              accepted = true;
            } catch {
              routeHistoryIndex.current = targetIndex;
              commitRoute({ view: "dashboard" }, "replace");
              accepted = true;
              setMessage("Project tidak ditemukan atau sudah dihapus. Pilih project lain dari Project Saya.");
            }
            return;
          }
          routeHistoryIndex.current = targetIndex;
          commitRoute(target, "replace");
          accepted = true;
          if (target.view === "settings") {
            void refreshAiGenerationSettings().catch((error) => setAiSettingsError(friendlyError(error)));
            void refreshOutroLibrary().catch((error) => setMessage(friendlyError(error)));
          }
        } finally {
          if (accepted) popNavigationPending.current = false;
          else if (!restorePopNavigation.current) popNavigationPending.current = false;
        }
      })();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [route, project?.id, research, saved, busy, ttsBusy, ttsLoading, aiSettingsBusy, workflowSignals]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if ((route.view === "workspace" && !saved) || (route.view === "create" && createDraftUnsavedState)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [route.view, saved, createDraftUnsavedState]);

  useEffect(() => {
    if (!project?.id) return;
    try { localStorage.setItem(`ai-facts-studio:workspace-step:${project.id}`, activeStep); } catch { /* local progress is optional */ }
  }, [project?.id, activeStep]);

  useEffect(() => {
    const id = project?.id;
    const jobId = project?.visualPreparation?.id;
    if (!id || project?.visualPreparation?.status !== "running") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const latest = await api<Project>(`/api/projects/${id}`);
        if (!cancelled && latest.visualPreparation?.id === jobId) {
          setProject((current) => current?.id === id ? latest : current);
          setResearch(latest.researchPackage);
        }
      } catch { /* persisted job remains available when workspace reopens */ }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 900);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [project?.id, project?.visualPreparation?.id, project?.visualPreparation?.status]);

  useEffect(() => {
    const id = project?.id;
    const jobId = project?.motionPreparation?.id;
    if (!id || project?.motionPreparation?.status !== "running") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const latest = await api<Project>(`/api/projects/${id}`);
        if (!cancelled && latest.motionPreparation?.id === jobId) {
          setProject((current) => current?.id === id ? latest : current);
          setResearch(latest.researchPackage);
        }
      } catch { /* persisted job remains available after refresh */ }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 700);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [project?.id, project?.motionPreparation?.id, project?.motionPreparation?.status]);

  useEffect(() => {
    if (!project?.id || !reviewFingerprint) return;
    try {
      const key = `ai-facts-studio:preview-reviewed:${project.id}`;
      if (previewReviewed) localStorage.setItem(key, reviewFingerprint);
      else localStorage.removeItem(key);
    } catch { /* local progress is optional */ }
  }, [project?.id, previewReviewed, reviewFingerprint]);

  useEffect(() => {
    if (activeStep !== "preview" || !previewPlayer.current) return;
    const player = previewPlayer.current;
    const onPlay = () => setPreviewStarted(true);
    player.addEventListener("play", onPlay);
    return () => player.removeEventListener("play", onPlay);
  }, [activeStep]);

  async function saveBeforeLeavingWorkspace() {
    if (view !== "workspace" || saved) return true;
    if (busy || ttsBusy || ttsLoading) { setMessage("Tunggu proses aktif selesai sebelum berpindah halaman."); return false; }
    return await askConfirmation({
      title: "Simpan draft sebelum keluar?",
      message: "Perubahan storyboard belum tersimpan. Simpan sekarang agar bisa dilanjutkan nanti.",
      confirmLabel: "Simpan draft",
      cancelLabel: "Tetap di workspace",
      onConfirm: async () => {
        if (!await saveProject()) throw new Error("Draft belum tersimpan. Periksa pesan error, lalu coba lagi.");
      },
    });
  }

  async function confirmLeaveCreate() {
    if (view !== "create" || !createDraftUnsaved.current) return true;
    const confirmed = await askConfirmation({
      title: "Hasil AI belum disimpan",
      message: "Hasil generate belum tersimpan dan akan hilang jika keluar. Tetap di Create Video untuk menyimpan, atau buang hasil ini?",
      confirmLabel: "Buang hasil & keluar",
      cancelLabel: "Tetap di Create Video",
      tone: "danger",
    });
    return confirmed;
  }

  async function goToDashboard() {
    if (busy || ttsBusy || ttsLoading) return;
    if (!await confirmLeaveCreate()) return;
    if (!await saveBeforeLeavingWorkspace()) return;
    setCreateDraftUnsaved(false);
    setMessage("");
    commitRoute({ view: "dashboard" });
  }

  function askTtsTimingDecision(previousDurationSec: number, nextDurationSec: number, hadActiveAudio: boolean) {
    return new Promise<TtsTimingChoice>((resolve) => {
      setTtsTimingPrompt({ previousDurationSec, nextDurationSec, hadActiveAudio, resolve });
    });
  }

  function resolveTtsTimingDecision(choice: TtsTimingChoice) {
    if (!ttsTimingPrompt) return;
    setTtsTimingPrompt(null);
    ttsTimingPrompt.resolve(choice);
  }

  async function openProject(id: string, notice?: string, createAlreadyConfirmed = false, initialStep?: WorkspaceStep) {
    if (view === "workspace" && project?.id === id) return;
    if (ttsBusy || ttsLoading) return;
    if (!createAlreadyConfirmed && !await confirmLeaveCreate()) return;
    if (!await saveBeforeLeavingWorkspace()) return;
    try {
      const next = await loadProjectRoute(id, initialStep, route.view === "workspace" && route.projectId === id ? route.sceneId : null, "push");
      setCreateDraftUnsaved(false);
      if (notice) setMessage(notice);
      if (next.view === "workspace" && initialStep && next.step !== initialStep) setMessage("Langkah tersebut masih terkunci. Selesaikan langkah sebelumnya terlebih dahulu.");
    } catch (error) { setMessage(friendlyError(error)); }
  }

  async function openCreate() {
    if (busy || ttsBusy || ttsLoading) return;
    if (view === "create") return;
    if (!await confirmLeaveCreate()) return;
    if (!await saveBeforeLeavingWorkspace()) return;
    setCreateMode("ai");
    setJsonDraft("");
    setSelectedCreateOutroId(undefined);
    setCreateDraftUnsaved(false);
    commitRoute({ view: "create" });
    setMessage("");
  }

  async function openStorySeries(target: Extract<AppRoute, { view: "series-library" | "series-detail" }>) {
    if (busy || ttsBusy || ttsLoading) return;
    if (!await confirmLeaveCreate()) return;
    if (!await saveBeforeLeavingWorkspace()) return;
    setCreateDraftUnsaved(false);
    commitRoute(target);
    setMessage("");
  }

  async function openSettings(section: SettingsSection = "general") {
    if (busy || ttsBusy || ttsLoading || aiSettingsBusy) return;
    if (!await confirmLeaveCreate()) return;
    if (!await saveBeforeLeavingWorkspace()) return;
    setCreateDraftUnsaved(false);
    commitRoute({ view: "settings", section });
    setMessage("");
    setAiSettingsError("");
    const results = await Promise.allSettled([refreshAiGenerationSettings(), refreshOutroLibrary()]);
    if (results[0]?.status === "rejected") setAiSettingsError(friendlyError(results[0].reason));
    if (results[1]?.status === "rejected") setMessage(friendlyError(results[1].reason));
  }

  function navigateSettingsSection(section: SettingsSection) {
    if (routeRef.current.view === "settings") commitRoute({ view: "settings", section });
  }

  async function setAiGenerationMode(mode: AiGenerationMode) {
    if (aiSettingsBusy || !aiGenerationSettings || mode === aiGenerationSettings.mode) return;
    setAiSettingsBusy(true);
    setAiSettingsError("");
    try {
      const updated = await api<AiGenerationSettings>("/api/settings/ai-generation", jsonRequest("PUT", { mode }));
      setAiGenerationSettings(updated);
      setStatus(await api<Status>("/api/status"));
    } catch (error) { setAiSettingsError(friendlyError(error)); }
    finally { setAiSettingsBusy(false); }
  }

  async function generateAiDraft(input: AiGenerationInput, model: string | undefined, signal: AbortSignal, onProgress: (phase: "idle" | "connecting" | "generating" | "validating" | "repairing") => void) {
    let watching = true;
    const poll = async () => {
      if (!watching) return;
      try {
        const status = await api<{ active: boolean; phase: "idle" | "connecting" | "generating" | "validating" | "repairing" }>("/api/ai-generation/status");
        onProgress(status.active ? status.phase : "connecting");
      } catch { /* Generation request reports actionable provider/API errors. */ }
      if (watching) window.setTimeout(() => void poll(), 300);
    };
    void poll();
    try { return await api<AiGenerationDraft>("/api/ai-generation", jsonRequest("POST", { input, ...(model ? { model } : {}) }, signal)); }
    finally {
      watching = false;
      onProgress("idle");
      await refreshAiGenerationSettings().catch((error) => setMessage(`Status AI Generation belum diperbarui: ${friendlyError(error)}`));
    }
  }

  async function createAiProject(researchPackage: ResearchPackage, requestId: string) {
    setBusy(true);
    try {
      const created = await api<Project>("/api/projects", jsonRequest("POST", { researchPackage, requestId, creationMode: "ai-generated", animationStyleId: selectedCreateAnimationStyleId, ...(selectedCreateOutroId === undefined ? {} : { outroId: selectedCreateOutroId }) }));
      setCreateDraftUnsaved(false);
      await refresh().catch(() => undefined);
      return { id: created.id, title: created.researchPackage.title };
    } finally { setBusy(false); }
  }

  async function createManualProject(researchPackage: ResearchPackage, requestId: string, creationBrief: ManualProjectBrief) {
    setBusy(true);
    try {
      const created = await api<Project>("/api/projects", jsonRequest("POST", { researchPackage, requestId, creationMode: "manual", creationBrief, animationStyleId: selectedCreateAnimationStyleId, ...(selectedCreateOutroId === undefined ? {} : { outroId: selectedCreateOutroId }) }));
      await refresh().catch(() => undefined);
      return { id: created.id, title: created.researchPackage.title };
    } finally { setBusy(false); }
  }

  async function loadSample() {
    if (!await confirmLeaveCreate()) return;
    if (!await saveBeforeLeavingWorkspace()) return;
    setBusy(true);
    try {
      const researchPackage = await api<ResearchPackage>("/api/sample?topic=volcano-formation");
      const created = await api<Project>("/api/projects", jsonRequest("POST", { researchPackage, creationMode: "sample", animationStyleId: selectedCreateAnimationStyleId, ...(selectedCreateOutroId === undefined ? {} : { outroId: selectedCreateOutroId }) }));
      const seeded = seedVolcanoVisualSample(created.visualStoryboard);
      const prepared = await api<Project>(`/api/projects/${created.id}`, jsonRequest("PUT", { researchPackage: created.researchPackage, visualStoryboard: seeded }));
      await refresh();
      await openProject(prepared.id, "Draft Visual World dan enam Motion Beat siap diuji. Ilustrasi Flow final belum tersedia.", true, "video-editor");
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  async function importFile(file?: File) {
    if (!file) return;
    if (file.size > 1024 * 1024) { setMessage("JSON dibatasi 1 MB."); return; }
    setJsonDraft(await file.text());
    setMessage(`Diimpor: ${file.name}. Tinjau isi, lalu buat storyboard.`);
  }

  async function createFromJson() {
    if (!await confirmLeaveCreate()) return;
    setBusy(true);
    try {
      const researchPackage = JSON.parse(jsonDraft) as ResearchPackage;
      const created = await api<Project>("/api/projects", jsonRequest("POST", { researchPackage, creationMode: "imported", animationStyleId: selectedCreateAnimationStyleId, ...(selectedCreateOutroId === undefined ? {} : { outroId: selectedCreateOutroId }) }));
      await refresh();
      await openProject(created.id, undefined, true);
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  function updateResearch(change: (current: ResearchPackage) => ResearchPackage) {
    setResearch((current) => current ? change(current) : current);
    setProject((current) => current ? { ...current, researchReviewStatus: "needs-review" } : current);
    setSaved(false);
    setPreviewReviewed(false);
    setPreviewStarted(false);
  }

  function updateScene(sceneId: string, change: (scene: Scene) => Scene) {
    if (!research) return;
    const source = research.scenes.find((scene) => scene.id === sceneId);
    if (!source) return;
    const changed = change(source);
    const nextResearch = { ...research, scenes: research.scenes.map((scene) => scene.id === sceneId ? changed : scene) };
    updateResearch(() => nextResearch);
    setProject((current) => {
      if (!current) return current;
      const refreshed = buildVisualStoryboard(nextResearch, current.visualStoryboard);
      const authoredComposition = JSON.stringify(changed.visualComposition) !== JSON.stringify(source.visualComposition);
      return {
        ...current,
        visualStoryboard: {
          ...refreshed,
          scenes: refreshed.scenes.map((scene) => scene.sceneId !== sceneId ? scene : {
            ...scene,
            ...(authoredComposition ? { composition: changed.visualComposition, compositionSource: "manual" as const, illustrationSource: "manual" as const, authoringConfirmed: true, authoringStatus: "needs_review" as const, layout: "existing-composition" as const, warnings: ["Komposisi manual dipilih; periksa kecocokan objek sebelum approval."], approved: false, approvedFingerprint: null } : {}),
          }),
        },
      };
    });
  }

  function updateResearchReferences(references: ResearchPackage["references"]) {
    const validIds = new Set(references.map((reference) => reference.id));
    updateResearch((current) => ({
      ...current,
      references,
      scenes: current.scenes.map((scene) => ({ ...scene, referenceIds: scene.referenceIds.filter((id) => validIds.has(id)) })),
    }));
  }

  function updateResearchSceneStructure(nextResearch: ResearchPackage) {
    if (!project) return;
    const storyboard = buildVisualStoryboard(nextResearch, project.visualStoryboard);
    updateResearch(() => applyVisualStoryboard(nextResearch, storyboard));
    setProject((current) => current ? { ...current, visualStoryboard: storyboard } : current);
  }

  function addResearchScene() {
    if (!project || !research || sceneEditingLocked) return;
    const id = `scene-${crypto.randomUUID()}`;
    const templateId = selectedScene?.templateId ?? "infographic";
    try {
      const nextResearch = appendResearchScene(research, {
        id,
        narrationText: "Tulis narasi untuk scene ini.",
        onScreenText: "Scene baru",
        templateId,
        visualDescription: "",
        motionCues: ["cut"],
        sfxCues: [],
        referenceIds: [],
        visualComposition: visualCompositionSchema.parse(defaultVisualComposition(templateId)),
        motionPlan: defaultMotionPlan(["cut"]),
        motionActions: [],
      });
      updateResearchSceneStructure(nextResearch);
      selectScene(id);
      setMessage("Scene ditambahkan. Lengkapi teks dan narasi, lalu simpan storyboard.");
      requestAnimationFrame(() => [...document.querySelectorAll<HTMLButtonElement>(".scene-row")].find((button) => button.dataset.sceneId === id)?.focus());
    } catch (error) { setMessage(friendlyError(error)); }
  }

  function moveResearchScene(sceneId: string, delta: -1 | 1) {
    if (!project || !research || sceneEditingLocked) return;
    const index = research.scenes.findIndex((scene) => scene.id === sceneId);
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= research.scenes.length) return;
    try {
      updateResearchSceneStructure(reorderResearchScene(research, sceneId, nextIndex));
      setMessage("Urutan scene diperbarui. Timing dan referensi ikut bersama scene; simpan storyboard.");
    } catch (error) { setMessage(friendlyError(error)); }
  }

  async function removeResearchScene(sceneId: string) {
    if (!project || !research || sceneEditingLocked) return;
    const scene = research.scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    const audioNote = project.audio?.source === "tts"
      ? " Audio TTS tidak diubah; narasi berubah sehingga voice-over perlu dibuat ulang sebelum render."
      : project.audio ? " Audio upload tidak diubah; periksa ulang timing dan sinkronisasinya." : project.pendingTts
        ? " Kandidat TTS akan dilepas saat storyboard disimpan." : "";
    const confirmed = await askConfirmation({
      title: "Hapus scene dari storyboard?",
      message: `“${scene.onScreenText || scene.id}” akan dihapus. Timing scene setelahnya maju mengikuti durasi scene ini.${audioNote}`,
      confirmLabel: "Hapus scene",
      cancelLabel: "Pertahankan scene",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      const removedIndex = research.scenes.findIndex((item) => item.id === sceneId);
      const nextResearch = deleteResearchScene(research, sceneId);
      const nextSceneId = nextResearch.scenes[Math.min(removedIndex, nextResearch.scenes.length - 1)]!.id;
      updateResearchSceneStructure(nextResearch);
      setSceneMediaErrors((current) => { const next = { ...current }; delete next[sceneId]; return next; });
      selectScene(nextSceneId);
      setMessage("Scene dihapus. Simpan storyboard untuk menerapkan perubahan.");
      requestAnimationFrame(() => [...document.querySelectorAll<HTMLButtonElement>(".scene-row")].find((button) => button.dataset.sceneId === nextSceneId)?.focus());
    } catch (error) { setMessage(friendlyError(error)); }
  }

  function updateVisualScene(sceneId: string, change: Partial<VisualStoryboardScene>) {
    if (!project || !research) return;
    const prior = project.visualStoryboard.scenes.find((scene) => scene.sceneId === sceneId);
    if (!prior) return;
    if (Object.hasOwn(change, "sceneMedia") && (!change.sceneMedia || change.sceneMedia.file !== prior.sceneMedia?.file)) {
      setSceneMediaErrors((current) => { const next = { ...current }; delete next[sceneId]; return next; });
    }
    const currentComposition = compositionForVisualScene(project.visualStoryboard, prior);
    const requestedComposition = change.compositionOverride ?? change.composition;
    const compositionChanged = Boolean(requestedComposition && JSON.stringify(requestedComposition) !== JSON.stringify(currentComposition));
    const effectiveChange: Partial<VisualStoryboardScene> = compositionChanged
      ? {
          ...change,
          ...(requestedComposition ? project.visualStoryboard.visualWorld
            ? { composition: requestedComposition, compositionOverride: requestedComposition }
            : { composition: requestedComposition, compositionOverride: undefined } : {}),
          ...(!("motionActions" in change) && prior.motionActions.length ? { motionStatus: "needs_review" as const, motionSummary: "Ilustrasi berubah; Motion Beat dipertahankan. Periksa target yang hilang sebelum approval." } : {}),
          ...(!("warnings" in change) && prior.motionActions.length ? { warnings: [...prior.warnings.slice(0, 6), "Ilustrasi berubah; Motion Beat dipertahankan untuk ditinjau. Target yang hilang perlu diperbaiki."] } : {}),
        }
      : change;
    const artworkFields = ["headline", "narrationText", "visualSummary", "layout", "compositionType", "objects", "relationships", "visualFocus", "illustrationIntent", "motionIntent", "motionSummary", "motionIntensity", "motionTiming", "motionStatus", "motionActions", "composition", "compositionOverride", "compositionSource", "illustrationSource", "missingVisuals", "warnings", "authoringStatus", "authoringConfirmed"];
    const mediaAppearanceChanged = "sceneMedia" in effectiveChange && (effectiveChange.sceneMedia?.file !== prior.sceneMedia?.file || effectiveChange.sceneMedia?.fit !== prior.sceneMedia?.fit || effectiveChange.sceneMedia?.position !== prior.sceneMedia?.position);
    const artworkChanged = mediaAppearanceChanged || artworkFields.some((field) => field in effectiveChange);
    const copyChanged = effectiveChange.headline !== undefined && effectiveChange.headline !== prior.headline || effectiveChange.narrationText !== undefined && effectiveChange.narrationText !== prior.narrationText;
    const statusAfterReview = effectiveChange.approved === true && prior.authoringStatus === "needs_review" ? "ready_for_review"
      : effectiveChange.approved === false && prior.compositionSource === "procedural" && prior.authoringStatus === "ready_for_review" ? "needs_review"
        : prior.authoringStatus;
    const updatedScene = {
      ...prior, authoringStatus: statusAfterReview, ...effectiveChange,
      ...(copyChanged && prior.motionActions.length && !("motionActions" in effectiveChange) ? { motionStatus: "needs_review" as const } : {}),
    };
    const approved = effectiveChange.approved ?? (artworkChanged ? false : prior.approved);
    const nextScene = {
      ...updatedScene,
      approved,
      approvedFingerprint: approved ? visualApprovalFingerprint(updatedScene) : null,
      flowStatus: effectiveChange.flowStatus ?? (approved ? "approved" as const
        : effectiveChange.authoringConfirmed === true || effectiveChange.approved === false && prior.approved
          ? "ready-for-review" as const
          : compositionChanged && effectiveChange.composition?.layers.some((layer) => layer.nodes.some((node) => node.type === "image" || node.type === "group" && node.children.some((child) => child.type === "image")))
            ? "illustration-imported" as const : prior.flowStatus),
    };
    let storyboard: VisualStoryboard = {
      ...project.visualStoryboard,
      scenes: project.visualStoryboard.scenes.map((scene) => scene.sceneId === sceneId ? nextScene : scene),
    };
    if (effectiveChange.headline !== undefined || effectiveChange.narrationText !== undefined) {
      storyboard = buildVisualStoryboard(applyVisualStoryboard(research, storyboard), storyboard);
    }
    storyboard = {
      ...storyboard,
      reusableWorldObjects: visualObjectIds.filter((objectId) => storyboard.scenes.filter((scene) => scene.objects.some((object) => object.objectId === objectId)).length > 1),
    };
    const storyboardCopyChanged = prior.headline !== storyboard.scenes.find((scene) => scene.sceneId === sceneId)?.headline || prior.narrationText !== storyboard.scenes.find((scene) => scene.sceneId === sceneId)?.narrationText;
    setProject((current) => current ? { ...current, visualStoryboard: storyboard, ...(storyboardCopyChanged ? { researchReviewStatus: "needs-review" as const } : {}) } : current);
    setResearch((current) => current ? applyVisualStoryboard(current, storyboard) : current);
    setSaved(false);
    setPreviewReviewed(false);
    setPreviewStarted(false);
  }

  async function regenerateVisualScene(sceneId: string, semanticPlanOverride?: VisualSemanticPlan, confirmationDone = false) {
    if (!project || !research || busy && !confirmationDone || generatingVisualSceneId) return;
    const scene = project.visualStoryboard.scenes.find((item) => item.sceneId === sceneId);
    if (!scene) return;
    if (!confirmationDone && (scene.authoringConfirmed || scene.approved || scene.compositionSource === "manual") && !await askConfirmation({
      title: "Ganti ilustrasi yang sudah disetujui/di-edit?",
      message: "Composer akan mengganti komposisi saat ini. Hasil manual dan approval akan hilang; komposisi baru perlu ditinjau dan disetujui ulang.",
      confirmLabel: "Ganti ilustrasi",
      cancelLabel: "Pertahankan komposisi",
      tone: "warning",
    })) return;
    setGeneratingVisualSceneId(sceneId);
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const composed = composeVisualScene({
        headline: scene.headline,
        narration: scene.narrationText,
        visualDescription: scene.visualSummary,
        artDirection: { styleId: project.visualStoryboard.styleId, palette: project.visualStoryboard.palette },
        sceneVisualFocus: scene.visualFocus,
        illustrationIntent: scene.illustrationIntent,
        existingVisualPlan: {
          objects: scene.objects.map((object) => object.objectId), relationships: scene.relationships,
          source: scene.compositionSource, status: scene.authoringStatus,
          authoringConfirmed: scene.authoringConfirmed, approved: scene.approved,
        },
         existingComposition: compositionForVisualScene(project.visualStoryboard, scene),
        semanticPlan: semanticPlanOverride ?? scene.semanticPlan,
        sharedWorldObjects: project.visualStoryboard.reusableWorldObjects,
        assetLibrary: visualObjectLibrary,
        preserveExisting: false,
      });
      if (!composed.composition) {
        setMessage(`Ilustrasi belum dapat dibuat akurat: ${composed.missingVisuals.join(" · ")}. Komposisi saat ini dipertahankan.`);
        return;
      }
      const type = composed.compositionType;
      const motionIntent: VisualStoryboardScene["motionIntent"] = type === "connected-environment" || type === "scientific-diagram" ? "particle-flow"
        : type === "cross-section" || type === "step-by-step-process" ? "path-animation"
          : type === "hero-object-focus" || type === "before-and-after" ? "focus-shift" : "gentle-reveal";
      updateVisualScene(sceneId, {
        composition: composed.composition,
        ...(semanticPlanOverride ?? scene.semanticPlan ? { semanticPlan: semanticPlanOverride ?? scene.semanticPlan } : {}),
        compositionType: type,
        layout: type ?? (composed.compositionSource === "procedural" ? "procedural-scene" : "existing-composition"),
        compositionSource: composed.compositionSource,
        illustrationSource: composed.compositionSource === "manual" ? "manual" : "procedural",
        objects: composed.objects.map((objectId) => ({ objectId, assetId: objectId, role: visualObjectLibrary[objectId].role, label: visualObjectLibrary[objectId].label })),
        relationships: composed.relationships,
        visualFocus: composed.focus,
        illustrationIntent: composed.illustrationIntent,
        motionIntent,
        motionSummary: motionIntent === "particle-flow" ? "Partikel mengikuti lintasan lingkungan secara deterministik."
          : motionIntent === "path-animation" ? "Path proses terungkap; hujan/uap mengikuti arah penjelasan."
            : motionIntent === "focus-shift" ? "Zoom halus mengarahkan perhatian ke objek utama." : "Reveal ringan menjaga fokus pada ilustrasi.",
        missingVisuals: composed.missingVisuals,
        warnings: composed.warnings,
        authoringStatus: composed.status,
        authoringConfirmed: false,
        approved: false,
      });
      setMessage(composed.status === "needs_visual_authoring" ? `Ilustrasi dibuat sebagian. Perlu authoring: ${composed.missingVisuals.join(" · ")}.` : "Ilustrasi otomatis diperbarui. Tinjau thumbnail sebelum approval.");
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setGeneratingVisualSceneId(null); }
  }

  async function planVisualScene(sceneId: string) {
    if (!project || busy || planningVisualSceneId) return;
    const scene = project.visualStoryboard.scenes.find((item) => item.sceneId === sceneId);
    if (!scene) return;
    if ((scene.authoringConfirmed || scene.approved || scene.compositionSource === "manual") && !await askConfirmation({
      title: "Perbarui ilustrasi manual/approved dengan AI plan?",
      message: "AI hanya menyusun semantic plan teks; composer lokal akan membuat ulang komposisi dan approval sebelumnya menjadi stale.",
      confirmLabel: "Plan dan recompose",
      cancelLabel: "Pertahankan ilustrasi",
      tone: "warning",
    })) return;
    setBusy(true);
    setPlanningVisualSceneId(sceneId);
    try {
      const settings = aiGenerationSettings ?? await refreshAiGenerationSettings();
      const model = settings.mode === "development" ? visualPlannerModel : undefined;
      if (settings.mode === "development" && !model) throw new Error("Pilih model OpenCode terhubung sebelum menjalankan visual planner.");
      if (!settings.generationAvailable) throw new Error(settings.providers.production.disabledReason ?? settings.providers.development.disabledReason ?? "Provider AI Text belum tersedia.");
      const result = await api<{ plan: VisualSemanticPlan; cached: boolean }>(`/api/projects/${project.id}/scenes/${sceneId}/visual-plan`, jsonRequest("POST", model ? { model } : {}));
      await regenerateVisualScene(sceneId, result.plan, true);
      setMessage(`Semantic plan ${result.cached ? "dipakai dari cache" : "dibuat provider terpilih"}; komposisi lokal siap ditinjau.`);
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setPlanningVisualSceneId(null); setBusy(false); }
  }

  async function setSharedVisualWorld(sceneId: string) {
    if (!project || !research) return;
    const selectedSource = project.visualStoryboard.scenes.find((scene) => scene.sceneId === sceneId);
    if (!selectedSource) return;
    const source = { ...selectedSource, composition: compositionForVisualScene(project.visualStoryboard, selectedSource), compositionOverride: undefined };
    if (!source.composition.layers.some((layer) => layer.nodes.some((node) => node.type === "image" || node.type === "group" && node.children.some((child) => child.type === "image")))) {
      setMessage("Impor ilustrasi dasar dulu sebelum menjadikannya Visual World bersama.");
      return;
    }
    const replacingOtherArt = project.visualStoryboard.scenes.some((scene) => scene.sceneId !== sceneId && (
      JSON.stringify(compositionForVisualScene(project.visualStoryboard, scene)) !== JSON.stringify(source.composition)
      || scene.compositionSource !== source.compositionSource || scene.illustrationSource !== source.illustrationSource
    ));
    if (replacingOtherArt && !await askConfirmation({
      title: "Gunakan ilustrasi ini untuk semua scene?",
      message: "Komposisi scene ini menjadi shared base untuk seluruh scene dan mengganti override scene lain. Approval scene terdampak dibatalkan; Motion Beat dipertahankan, tetapi target yang hilang perlu diperbaiki.",
      confirmLabel: "Gunakan untuk Semua Scene",
      cancelLabel: "Pertahankan semua scene",
      tone: "warning",
    })) return;
    const visualWorld = buildVisualWorld(research.title, source);
    const storyboard: VisualStoryboard = {
      ...project.visualStoryboard,
      visualWorld,
      scenes: project.visualStoryboard.scenes.map((scene) => {
        const affected = JSON.stringify(compositionForVisualScene(project.visualStoryboard, scene)) !== JSON.stringify(source.composition)
          || scene.compositionSource !== source.compositionSource || scene.illustrationSource !== source.illustrationSource;
        const nextScene = {
          ...scene,
          composition: source.composition,
          compositionOverride: undefined,
          ...(affected ? { compositionSource: source.compositionSource, illustrationSource: source.illustrationSource, illustrationWorkflow: source.illustrationWorkflow } : {}),
          authoringConfirmed: scene.sceneId === sceneId ? source.authoringConfirmed : affected ? false : scene.authoringConfirmed,
          authoringStatus: scene.sceneId === sceneId ? source.authoringStatus : affected ? "needs_review" : scene.authoringStatus,
          approved: affected ? false : scene.approved,
          approvedFingerprint: affected ? null : scene.approvedFingerprint,
          motionStatus: affected && scene.motionActions.length ? "needs_review" as const : scene.motionStatus,
          motionSummary: affected && scene.motionActions.length ? "Shared VisualWorld berubah; Motion Beat dipertahankan. Periksa target layer sebelum approval." : scene.motionSummary,
          flowStatus: affected ? "illustration-imported" as const : scene.flowStatus,
          warnings: affected ? [...scene.warnings.slice(0, 6), "Shared VisualWorld diterapkan; tinjau scene dan target Motion Beat."] : scene.warnings,
        };
        return { ...nextScene, approvedFingerprint: nextScene.approved ? visualApprovalFingerprint(nextScene) : null };
      }),
    };
    setProject((current) => current ? { ...current, visualStoryboard: storyboard } : current);
    setResearch((current) => current ? applyVisualStoryboard(current, storyboard) : current);
    setSaved(false);
    setPreviewReviewed(false);
    setPreviewStarted(false);
    setMessage("Ilustrasi dipakai untuk semua scene. Visual World lama diganti; beat dipertahankan untuk ditinjau. Simpan perubahan.");
  }

  async function generateVectorScene(sceneId: string) {
    if (!project || busy || vectorizingVisualSceneId) return;
    const scene = project.visualStoryboard.scenes.find((item) => item.sceneId === sceneId);
    if (!scene) return;
    if ((scene.authoringConfirmed || scene.approved || scene.compositionSource === "manual") && !await askConfirmation({
      title: "Ganti ilustrasi manual/approved dengan AI Vector?",
      message: "AI Vector akan mengganti komposisi; approval lama menjadi stale dan hasil baru perlu ditinjau.",
      confirmLabel: "Generate AI Vector",
      cancelLabel: "Pertahankan ilustrasi",
      tone: "warning",
    })) return;
    setBusy(true);
    setVectorizingVisualSceneId(sceneId);
    try {
      const settings = aiGenerationSettings ?? await refreshAiGenerationSettings();
      if (settings.mode !== "development") throw new Error("AI Vector PoC membutuhkan OpenCode Development mode.");
      if (!settings.providers.development.models.some((model) => model.id === visualPlannerModel)) throw new Error("Pilih model OpenCode terhubung sebelum menjalankan AI Vector.");
      const result = await api<{ spec: AiVectorIllustration; cached: boolean; model: string }>(`/api/projects/${project.id}/scenes/${sceneId}/visual-vector`, jsonRequest("POST", { model: visualPlannerModel }));
      updateVisualScene(sceneId, {
        composition: result.spec.composition,
        compositionType: "scientific-diagram",
        layout: "scientific-diagram",
        compositionSource: "ai-vector",
        illustrationSource: "ai-vector",
        illustrationWorkflow: "ai-vector",
        objects: [],
        relationships: [],
        visualFocus: null,
        illustrationIntent: result.spec.description,
        motionIntent: "gentle-reveal",
        motionSummary: "Reveal ringan mengikuti motion plan scene.",
        missingVisuals: [],
        warnings: [],
        authoringStatus: "needs_review",
        authoringConfirmed: false,
        approved: false,
      });
      setMessage(`Ilustrasi AI Vector dibuat oleh ${result.model}${result.cached ? " dari cache" : ""}; tinjau thumbnail sebelum approval.`);
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setVectorizingVisualSceneId(null); setBusy(false); }
  }

  async function prepareVisualScenes(sceneIds?: string[]) {
    if (!project || !saved || busy || project.visualPreparation?.status === "running") return;
    setBusy(true);
    try {
      const { job } = await api<{ job: VisualPreparationJob }>(`/api/projects/${project.id}/visual-preparation`, jsonRequest("POST", {
        requestId: crypto.randomUUID(), ...(sceneIds ? { sceneIds } : {}),
      }));
      setProject((current) => current?.id === project.id ? { ...current, visualPreparation: job } : current);
      setMessage(job.status === "completed" ? "Ilustrasi siap ditinjau. Approval tetap manual." : "Smart Hybrid mulai menyiapkan scene yang belum memiliki ilustrasi memadai.");
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  function generateSceneMotion(sceneId: string, intensity: MotionIntensity) {
    const scene = project?.visualStoryboard.scenes.find((item) => item.sceneId === sceneId);
    if (!scene || scene.approved || project?.visualPreparation?.status === "running") return;
    try {
      updateVisualScene(sceneId, planSceneMotion(scene, intensity));
      setMessage("Motion Plan deterministik dibuat dari narasi, relasi, dan node visual yang tersedia. Timing approximate; review sebelum approve.");
    } catch (error) { setMessage(friendlyError(error)); }
  }

  function applyMotionBeatPreset(sceneId: string, preset: "static" | "gentle" | "pan-zoom" | "process" | "particles") {
    const scene = project?.visualStoryboard.scenes.find((item) => item.sceneId === sceneId);
    if (!scene) return;
    if (preset === "static") {
      updateVisualScene(sceneId, { motionIntent: "gentle-reveal", motionActions: [], motionStatus: "static", motionIntensity: "subtle", motionSummary: "Gerak objek nonaktif; transisi template tetap berjalan." });
      return;
    }
    const intensity: MotionIntensity = preset === "gentle" || preset === "pan-zoom" ? "subtle" : "balanced";
    const motionIntent: VisualStoryboardScene["motionIntent"] = preset === "pan-zoom" ? "focus-shift" : preset === "process" ? "path-animation" : preset === "particles" ? "particle-flow" : "gentle-reveal";
    const plan = planSceneMotion(scene, intensity);
    updateVisualScene(sceneId, { ...plan, motionIntent, motionSummary: `${preset === "gentle" ? "Gerak lembut" : preset === "pan-zoom" ? "Pan & zoom" : preset === "process" ? "Animasi proses" : "Aliran partikel"}. ${plan.motionSummary}` });
  }

  async function prepareMotionScenes(intensity: MotionIntensity, sceneIds?: string[]) {
    if (!project || !saved || busy || project.motionPreparation?.status === "running" || project.visualPreparation?.status === "running") return;
    setBusy(true);
    try {
      const { job } = await api<{ job: MotionPreparationJob }>(`/api/projects/${project.id}/motion-preparation`, jsonRequest("POST", {
        requestId: crypto.randomUUID(), intensity, ...(sceneIds ? { sceneIds } : {}),
      }));
      setProject((current) => current?.id === project.id ? { ...current, motionPreparation: job } : current);
      setMessage(job.status === "completed" ? "Motion batch selesai; scene yang ada dipertahankan." : "Motion Director memproses scene valid tanpa AI request.");
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  async function cancelMotionScenes() {
    if (!project?.motionPreparation || project.motionPreparation.status !== "running") return;
    try {
      const { job } = await api<{ job: MotionPreparationJob }>(`/api/projects/${project.id}/motion-preparation/${project.motionPreparation.id}/cancel`, { method: "POST" });
      setProject((current) => current ? { ...current, motionPreparation: job } : current);
      setMessage("Pembatalan Motion batch diminta; scene yang selesai tetap tersimpan.");
    } catch (error) { setMessage(friendlyError(error)); }
  }

  function useAuthoredComposition(sceneId: string) {
    if (!project || !research) return;
    const source = research.scenes.find((scene) => scene.id === sceneId);
    if (!source) return;
    updateVisualScene(sceneId, {
      composition: source.visualComposition,
      compositionSource: "manual",
      illustrationSource: "manual",
      layout: "existing-composition",
      authoringStatus: "needs_review",
      authoringConfirmed: true,
      warnings: ["Komposisi manual dipilih; periksa kecocokan objek sebelum approval."],
      approved: false,
    });
  }

  async function useUploadedIllustration(sceneId: string, assetId: string, uploadedAsset?: VisualAsset, confirmationDone = false, fromLibrary = false, placement: AssetPlacement = { mode: "hero", fit: "contain", position: "center" }, workflow?: VisualStoryboardScene["illustrationWorkflow"]) {
    if (!project) return;
    const current = project.visualStoryboard.scenes.find((scene) => scene.sceneId === sceneId);
    if (!current) return;
    const currentComposition = compositionForVisualScene(project.visualStoryboard, current);
    const currentImageId = currentComposition.layers.flatMap((layer) => layer.nodes.flatMap((node) => node.type === "group" ? node.children : [node])).find((node) => node.type === "image")?.asset;
    const replacingImage = currentImageId !== undefined && currentImageId !== assetId;
    if (!confirmationDone && (current.approved || current.authoringConfirmed || current.sceneMedia || replacingImage) && !await askConfirmation({
      title: "Ganti ilustrasi scene?",
      message: "Ilustrasi baru mengganti komposisi sekarang dan membatalkan approval. Tinjau hasil baru sebelum approve ulang.",
      confirmLabel: "Ganti ilustrasi",
      cancelLabel: "Pertahankan ilustrasi",
      tone: "warning",
    })) return;
    let asset = uploadedAsset ?? project.visualAssets.find((item) => item.id === assetId);
    if (assetId.startsWith("upload-") && (fromLibrary || !asset)) {
      const result = await api<{ project: Project; asset: VisualAsset }>(`/api/projects/${project.id}/visual-assets/${encodeURIComponent(assetId)}/attach`, { method: "POST" });
      asset = result.asset;
      setProject((existing) => existing ? { ...existing, visualAssets: result.project.visualAssets } : existing);
    }
    if (assetId.startsWith("upload-") && !asset) throw new Error("Aset tidak tersedia. Buka Asset Library dan unggah ulang jika diperlukan.");
    const source = fromLibrary ? "asset-library" as const : asset?.source === "ai-generated" ? "ai-image" as const : asset ? "upload-image" as const : "asset-library" as const;
    const { mode } = placement;
    const fullFrameAiImage = mode === "hero" && asset?.source === "ai-generated";
    const layerId = `selected-${assetId.slice(7, 19)}`;
    const node = fullFrameAiImage
      ? { type: "image" as const, asset: assetId, x: 0, y: 0, width: 1080, height: 1920, fit: placement.fit, position: "center" as const }
      : mode === "background"
      ? { type: "image" as const, asset: assetId, x: 0, y: 0, width: 1080, height: 1920, fit: placement.fit, position: placement.position }
      : mode === "layer"
        ? { type: "image" as const, asset: assetId, x: 640, y: 630, width: 360, height: 360, fit: placement.fit, position: placement.position }
        : { type: "image" as const, asset: assetId, x: 40, y: 520, width: 1000, height: 900, fit: placement.fit, position: placement.position };
    const sourceLayer = { id: layerId, depth: mode === "background" || fullFrameAiImage ? 0.05 : 0.72, nodes: [node] };
    const addToExisting = mode !== "hero";
    const existingLayers = currentComposition.layers.filter((layer) => layer.id !== layerId);
    const composition = visualCompositionSchema.parse({
      background: currentComposition.background,
      layers: addToExisting ? [...existingLayers, sourceLayer] : [sourceLayer],
    });
    updateVisualScene(sceneId, {
      sceneMedia: undefined, flowVisualMode: "still-image",
      composition, compositionType: addToExisting ? current.compositionType : "hero-object-focus", layout: addToExisting ? current.layout : "existing-composition", compositionSource: fromLibrary || !asset || asset.source === "ai-generated" ? "library" : "manual", illustrationSource: source,
      illustrationWorkflow: workflow ?? (fromLibrary ? "asset-library" : asset?.source === "ai-generated" ? "ai-image-api" : "upload-image"),
      objects: addToExisting ? current.objects : [], relationships: addToExisting ? current.relationships : [], visualFocus: addToExisting ? current.visualFocus : null,
      illustrationIntent: addToExisting ? current.illustrationIntent : asset?.name ?? `Built-in ${assetId}`,
      motionIntent: addToExisting ? current.motionIntent : "gentle-reveal", motionSummary: addToExisting ? current.motionSummary : "Fade/reveal ringan pada ilustrasi terpilih.", missingVisuals: addToExisting ? current.missingVisuals : [],
      authoringStatus: "needs_review", authoringConfirmed: false, flowStatus: "illustration-imported",
      warnings: [source === "ai-image" ? `AI Image (${asset?.provider ?? "provenance manual"}); tinjau akurasi semantik, crop aman, dan terms.` : `Ilustrasi dipakai sebagai ${mode}; ikon bukan pengganti ilustrasi lengkap. Tinjau kecocokan dan crop sebelum approval.`], approved: false,
    });
    return true;
  }

  async function uploadVisualIllustration(sceneId: string, file: File, metadata: IllustrationImportInfo): Promise<boolean> {
    if (!project || busy) return false;
    const scene = project.visualStoryboard.scenes.find((item) => item.sceneId === sceneId);
    const currentImageId = scene ? compositionForVisualScene(project.visualStoryboard, scene).layers.flatMap((layer) => layer.nodes.flatMap((node) => node.type === "group" ? node.children : [node])).find((node) => node.type === "image")?.asset : undefined;
    if (scene && (scene.approved || scene.authoringConfirmed || scene.sceneMedia || currentImageId !== undefined) && !await askConfirmation({
      title: "Ganti ilustrasi scene?",
      message: "File baru mengganti komposisi dan membatalkan approval. Aset tersimpan di library project.",
      confirmLabel: "Unggah & ganti",
      cancelLabel: "Batal",
      tone: "warning",
    })) return false;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("illustration", file);
      form.append("name", file.name.replace(/\.[^.]+$/, "").slice(0, 120));
      form.append("source", metadata.source);
      form.append("license", metadata.license);
      form.append("style", project.visualStoryboard.styleId);
      form.append("semanticTags", scene?.objects.map((object) => object.label).join(",") ?? "");
      form.append("supportedConcepts", [scene?.visualFocus, scene?.visualSummary].filter(Boolean).join(","));
      if (metadata.prompt) form.append("prompt", metadata.prompt);
      if (metadata.provider) form.append("provider", metadata.provider);
      if (metadata.model) form.append("model", metadata.model);
      const result = await api<{ project: Project; asset: VisualAsset; optimized: boolean; originalBytes: number }>(`/api/projects/${project.id}/visual-assets`, { method: "POST", body: form });
      setProject((current) => current ? { ...current, visualAssets: result.project.visualAssets } : current);
      await useUploadedIllustration(sceneId, result.asset.id, result.asset, true, false,
        metadata.provider?.startsWith("Google Flow") ? { mode: "hero", fit: "cover", position: "center" } : undefined,
        metadata.provider?.startsWith("Google Flow") ? "google-flow" : metadata.source === "ai-generated" ? "ai-image-api" : "upload-image");
      setMessage(`Aset tersimpan${result.optimized ? " dan dioptimalkan ke WebP" : ""}. Tinjau thumbnail, safe crop, lisensi, dan kecocokan sebelum approval.`);
      return true;
    } catch (error) { setMessage(friendlyError(error)); return false; }
    finally { setBusy(false); }
  }

  function saveFlowPrompt(sceneId: string, prompt: string, generatedAnimationStyleId?: AnimationStyleId | null) {
    if (!project) return;
    setProject((current) => current ? { ...current, visualStoryboard: { ...current.visualStoryboard, scenes: current.visualStoryboard.scenes.map((scene) => {
      if (scene.sceneId !== sceneId) return scene;
      const hasImage = compositionForVisualScene(current.visualStoryboard, scene).layers.some((layer) => layer.nodes.some((node) => node.type === "image" || node.type === "group" && node.children.some((child) => child.type === "image")));
        return { ...scene, flowPrompt: prompt, flowPromptMode: scene.flowVisualMode, ...(generatedAnimationStyleId !== undefined ? { flowPromptAnimationStyleId: generatedAnimationStyleId ?? undefined } : {}), flowStatus: hasImage || scene.sceneMedia ? scene.flowStatus : "prompt-ready" };
    }) } } : current);
    setSaved(false);
  }

  function saveFlowStyleLock(styleLock: GoogleFlowStyleLock) {
    setProject((current) => current ? { ...current, visualStoryboard: { ...current.visualStoryboard, styleLock } } : current);
    setSaved(false);
  }

  function prepareFlowPrompts(prompts: Array<{ sceneId: string; prompt: string }>) {
    if (!project || !prompts.length) return;
    const byScene = new Map(prompts.map((item) => [item.sceneId, item.prompt]));
    setProject((current) => current ? { ...current, visualStoryboard: { ...current.visualStoryboard, scenes: current.visualStoryboard.scenes.map((scene) => {
       const prompt = byScene.get(scene.sceneId);
       if (!prompt || scene.flowPrompt) return scene;
       const hasImage = compositionForVisualScene(current.visualStoryboard, scene).layers.some((layer) => layer.nodes.some((node) => node.type === "image" || node.type === "group" && node.children.some((child) => child.type === "image")));
       return { ...scene, flowPrompt: prompt, flowPromptMode: scene.flowVisualMode, flowPromptAnimationStyleId: scene.flowVisualMode === "animated-video" ? current.animationStyleId ?? DEFAULT_ANIMATION_STYLE_ID : undefined, flowStatus: hasImage || scene.sceneMedia ? scene.flowStatus : "prompt-ready" };
    }) } } : current);
    setSaved(false);
    setMessage(`${prompts.length} prompt Flow disiapkan; ilustrasi yang sudah ada tidak diubah.`);
  }

  async function applyFlowStyleLock(prompts: Array<{ sceneId: string; prompt: string }>) {
    if (!project || busy || !prompts.length) return;
    const previewScenes = prompts.flatMap(({ sceneId, prompt }) => {
      const scene = project.visualStoryboard.scenes.find((item) => item.sceneId === sceneId);
      return scene ? [{ sceneId, title: scene.headline, prompt }] : [];
    });
    if (!previewScenes.length) return;
    if (!await askConfirmation({
      title: "Buat ulang prompt Google Flow?",
      message: "Tinjau prompt lengkap per scene sebelum menerapkan. Belum ada media, visual, atau approval yang diubah.",
      content: <div className="flow-prompt-review"><strong>{previewScenes.length} prompt · {getAnimationStylePreset(project.animationStyleId ?? DEFAULT_ANIMATION_STYLE_ID).name}</strong>{previewScenes.map((item) => <details key={item.sceneId}><summary>{item.sceneId} · {item.title}</summary><textarea readOnly rows={8} value={item.prompt} aria-label={`Pratinjau prompt Google Flow ${item.sceneId}`}/></details>)}</div>,
      confirmLabel: "Buat ulang prompt",
      cancelLabel: "Pertahankan prompt",
      tone: "warning",
    })) return;
    const byScene = new Map(prompts.map((item) => [item.sceneId, item.prompt]));
    setProject((current) => current ? { ...current, visualStoryboard: { ...current.visualStoryboard, scenes: current.visualStoryboard.scenes.map((scene) => {
      const prompt = byScene.get(scene.sceneId);
      if (!prompt) return scene;
      const hasImage = compositionForVisualScene(current.visualStoryboard, scene).layers.some((layer) => layer.nodes.some((node) => node.type === "image" || node.type === "group" && node.children.some((child) => child.type === "image")));
      const storySeries = scene.storySeries && !scene.storySeries.googleFlow.authoredPrompt && scene.flowPrompt
        ? { ...scene.storySeries, googleFlow: { ...scene.storySeries.googleFlow, authoredPrompt: scene.flowPrompt } }
        : scene.storySeries;
      return { ...scene, ...(storySeries ? { storySeries } : {}), flowPrompt: prompt, flowPromptMode: scene.flowVisualMode, flowPromptAnimationStyleId: scene.flowVisualMode === "animated-video" ? current.animationStyleId ?? DEFAULT_ANIMATION_STYLE_ID : undefined, flowStatus: hasImage || scene.sceneMedia ? scene.flowStatus : "prompt-ready" };
    }) } } : current);
    setSaved(false);
    setMessage(`${prompts.length} prompt Google Flow diperbarui. Media, visual, dan approval tidak berubah.`);
  }

  function regenerateStaleFlowPrompts() {
    if (!project || !research) return;
    const storyboard = project.visualStoryboard;
    const animationStyleId = project.animationStyleId ?? DEFAULT_ANIMATION_STYLE_ID;
    const prompts = storyboard.scenes.filter((scene) => scene.flowVisualMode === "animated-video" && scene.flowPromptMode === "animated-video" && animationStylePromptIsStale(scene.flowPrompt, scene.flowPromptAnimationStyleId, animationStyleId)).map((scene) => {
      const index = storyboard.scenes.findIndex((item) => item.sceneId === scene.sceneId);
      const previous = storyboard.scenes.slice(0, index).reverse().find((item) => item.flowPrompt || compositionForVisualScene(storyboard, item).layers.some((layer) => layer.nodes.some((node) => node.type === "image")));
      return {
        sceneId: scene.sceneId,
        prompt: buildIllustrationPrompt({ research, storyboard, scene, styleLock: storyboard.styleLock, mode: scene.flowVisualMode, animationStyleId,
          ...(previous ? { previousReference: { sceneNumber: previous.sceneNumber, name: previous.headline, style: scene.flowVisualMode === "animated-video" ? getAnimationStylePreset(animationStyleId).name : storyboard.styleLock.illustrationStyle } } : {}),
        }),
      };
    });
    void applyFlowStyleLock(prompts);
  }

  function updateProjectAnimationStyle(animationStyleId: AnimationStyleId) {
    setProject((current) => current ? { ...current, animationStyleId } : current);
    setSaved(false);
  }

  async function uploadFlowReference(file: File): Promise<VisualAsset | null> {
    if (!project || busy) return null;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("illustration", file);
      form.append("name", file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "Google Flow style reference");
      form.append("source", "user-upload");
      form.append("license", "User-provided visual reference; provenance not independently verified");
      form.append("style", "google-flow-reference");
      form.append("provider", "Manual project reference");
      const result = await api<{ project: Project; asset: VisualAsset; optimized: boolean }>(`/api/projects/${project.id}/visual-assets`, { method: "POST", body: form });
      setProject((current) => current ? { ...current, visualAssets: result.project.visualAssets } : current);
      setMessage(`Referensi tersimpan lokal${result.optimized ? " dan dioptimalkan" : ""}; unggah ke Google Flow secara manual bila perlu.`);
      return result.asset;
    } catch (error) { setMessage(friendlyError(error)); return null; }
    finally { setBusy(false); }
  }

  async function prepareFlowSceneMedia(sceneId: string, file: File): Promise<SceneMedia | null> {
    if (!project || busy || !isAnimatedMediaFile(file)) return null;
    const form = new FormData();
    form.append("media", file, file.name);
    setBusy(true);
    try {
      const result = await apiWithUploadProgress<{ media: SceneMedia }>(
        `/api/projects/${project.id}/scenes/${encodeURIComponent(sceneId)}/media`, form, () => {}, 300_000,
      );
      setMessage("Klip lolos validasi signature, codec, dimensi, durasi, frame rate, dan kerusakan. Tinjau preview sebelum menerapkan.");
      return result.media;
    } catch (error) { setMessage(friendlyError(error)); return null; }
    finally { setBusy(false); }
  }

  async function applyFlowSceneMedia(sceneId: string, media: SceneMedia): Promise<boolean> {
    if (!project || busy) return false;
    const current = project.visualStoryboard.scenes.find((scene) => scene.sceneId === sceneId);
    if (!current) return false;
    const hasIllustration = visualImageNodes(compositionForVisualScene(project.visualStoryboard, current)).length > 0;
    if ((current.sceneMedia || current.approved || current.authoringConfirmed || hasIllustration) && !await askConfirmation({
      title: "Terapkan atau ganti klip scene?",
      message: "Klip video menjadi sumber visual utama scene ini. Komposisi gambar dan Motion Beat lama tetap tersimpan, tetapi approval dibatalkan. Scene lain tidak berubah.",
      confirmLabel: "Terapkan klip",
      cancelLabel: "Pertahankan visual",
      tone: "warning",
    })) return false;
    updateVisualScene(sceneId, {
      sceneMedia: media,
      flowVisualMode: "animated-video",
      illustrationWorkflow: "google-flow",
      illustrationSource: "video-clip",
      authoringConfirmed: false,
      authoringStatus: "needs_review",
      flowStatus: "illustration-imported",
      approved: false,
      warnings: ["Klip Google Flow diimpor manual; tinjau gerakan, crop, durasi, dan audio sebelum approval.", ...(current.motionActions.length ? ["Motion Beat dipertahankan, tidak ditumpuk otomatis di atas klip video."] : [])],
    });
    setSceneMediaErrors((current) => { const next = { ...current }; delete next[sceneId]; return next; });
    setMessage("Klip diterapkan ke scene aktif. Komposisi dan Motion Beat lain tetap; tinjau lalu simpan.");
    return true;
  }

  async function removeFlowSceneMedia(sceneId: string) {
    if (!project || busy) return;
    const scene = project.visualStoryboard.scenes.find((item) => item.sceneId === sceneId);
    if (!scene?.sceneMedia || !await askConfirmation({
      title: "Gunakan visual statis scene?",
      message: "Klip dilepas sebagai sumber aktif. File tetap tersimpan; komposisi, gambar, dan Motion Beat lama dipulihkan tanpa mengubah scene lain.",
      confirmLabel: "Gunakan visual statis",
      cancelLabel: "Pertahankan klip",
      tone: "warning",
    })) return;
    const composition = compositionForVisualScene(project.visualStoryboard, scene);
    const image = visualImageNodes(composition)[0]?.node;
    const asset = image ? project.visualAssets.find((item) => item.id === image.asset) : undefined;
    const source: VisualStoryboardScene["illustrationSource"] = asset?.source === "ai-generated" ? "ai-image"
      : image?.asset.startsWith("upload-") ? "upload-image" : image ? "asset-library" : scene.compositionSource === "ai-vector" ? "ai-vector" : "procedural";
    const workflow: VisualStoryboardScene["illustrationWorkflow"] = source === "ai-image" ? "ai-image-api"
      : source === "asset-library" ? "asset-library" : source === "ai-vector" ? "ai-vector" : source === "procedural" ? "google-flow" : "upload-image";
    updateVisualScene(sceneId, {
      sceneMedia: undefined,
      flowVisualMode: "still-image",
      illustrationSource: source,
      illustrationWorkflow: workflow,
      authoringConfirmed: false,
      authoringStatus: "needs_review",
      flowStatus: image || source === "ai-vector" ? "illustration-imported" : "awaiting-illustration",
      approved: false,
      warnings: ["Visual statis dipulihkan; tinjau komposisi dan approval ulang."],
    });
    setSceneMediaErrors((current) => { const next = { ...current }; delete next[sceneId]; return next; });
    setMessage("Klip dilepas sebagai visual aktif. Komposisi statis lama dipulihkan; simpan perubahan.");
  }

  async function applyAnimatedFlowBatch(items: FlowBatchItem[], onProgress: (progress: FlowBatchProgress) => void) {
    const empty = { appliedIds: [] as string[], failures: [] as Array<{ id: string; fileName: string; message: string }> };
    if (!project || busy || !items.length) return empty;
    const targets = items.map((item) => project.visualStoryboard.scenes.find((scene) => scene.sceneId === item.sceneId));
    if (items.some((item) => !isAnimatedMediaFile(item.file)) || targets.some((scene) => !scene) || new Set(items.map((item) => item.sceneId)).size !== items.length) {
      return { ...empty, failures: items.map((item) => ({ id: item.id, fileName: item.file.name, message: "Pilih MP4/GIF dengan assignment scene unik." })) };
    }
    const replacing = targets.filter((scene) => scene!.sceneMedia || scene!.approved || scene!.authoringConfirmed || visualImageNodes(compositionForVisualScene(project.visualStoryboard, scene!)).length > 0);
    if (replacing.length && !await askConfirmation({
      title: "Terapkan klip animasi ke scene?",
      message: `${replacing.length} scene memiliki visual atau approval. Klip menjadi sumber aktif; komposisi dan Motion Beat tetap tersimpan, scene lain tidak berubah.`,
      confirmLabel: "Impor klip",
      cancelLabel: "Batal",
      tone: "warning",
    })) return empty;

    setBusy(true);
    const failures: Array<{ id: string; fileName: string; message: string }> = [];
    const imported: Array<{ item: FlowBatchItem; scene: VisualStoryboardScene; media: SceneMedia }> = [];
    try {
      for (let index = 0; index < items.length; index++) {
        const item = items[index]!;
        const scene = targets[index]!;
        const form = new FormData();
        form.append("media", item.file, item.file.name);
        try {
          const result = await apiWithUploadProgress<{ media: SceneMedia }>(
            `/api/projects/${project.id}/scenes/${encodeURIComponent(item.sceneId)}/media`, form,
            (progress) => onProgress(progress.stage === "uploading"
              ? { ...progress, percent: Math.round((index + progress.percent / 100) / items.length * 100), completedFiles: index, totalFiles: items.length, batchNumber: index + 1, batchCount: items.length }
              : { stage: "processing", completedFiles: index + 1, totalFiles: items.length, batchNumber: index + 1, batchCount: items.length }),
            300_000,
          );
          imported.push({ item, scene, media: result.media });
        } catch (error) {
          failures.push({ id: item.id, fileName: item.file.name, message: error instanceof Error ? error.message : "Klip gagal divalidasi." });
        }
        onProgress({ stage: "processing", completedFiles: index + 1, totalFiles: items.length, batchNumber: index + 1, batchCount: items.length });
      }
      if (imported.length) {
        const importedByScene = new Map(imported.map((entry) => [entry.scene.sceneId, entry]));
        const scenes = project.visualStoryboard.scenes.map((scene) => {
          const entry = importedByScene.get(scene.sceneId);
          if (!entry) return scene;
          return {
            ...scene,
            sceneMedia: entry.media,
            flowVisualMode: "animated-video" as const,
            flowPrompt: entry.item.prompt,
            flowPromptMode: "animated-video" as const,
            illustrationWorkflow: "google-flow" as const,
            illustrationSource: "video-clip" as const,
            authoringConfirmed: false,
            authoringStatus: "needs_review" as const,
            approved: false,
            approvedFingerprint: null,
            flowStatus: "illustration-imported" as const,
            warnings: ["Klip Google Flow diimpor manual; tinjau gerakan, crop, durasi, dan audio sebelum approval.", ...(scene.motionActions.length ? ["Motion Beat dipertahankan, tidak ditumpuk otomatis di atas klip video."] : [])],
          };
        });
        const storyboard: VisualStoryboard = { ...project.visualStoryboard, scenes };
        setProject((current) => current ? { ...current, visualStoryboard: storyboard } : current);
        setResearch((current) => current ? applyVisualStoryboard(current, storyboard) : current);
        setSceneMediaErrors((current) => {
          const next = { ...current };
          for (const { scene } of imported) delete next[scene.sceneId];
          return next;
        });
        setSaved(false);
        setPreviewReviewed(false);
        setPreviewStarted(false);
      }
      setMessage(`${imported.length} klip diterapkan ke scene${failures.length ? `; ${failures.length} gagal—file sukses tetap tersedia` : ""}. Tinjau lalu simpan.`);
      return { appliedIds: imported.map(({ item }) => item.id), failures };
    } finally { setBusy(false); }
  }

  async function applyFlowBatch(items: FlowBatchItem[], onProgress: (progress: FlowBatchProgress) => void) {
    const empty = { appliedIds: [] as string[], failures: [] as Array<{ id: string; fileName: string; message: string }> };
    if (!project || busy || !items.length) return empty;
    const animated = items.some((item) => isAnimatedMediaFile(item.file));
    if (animated && items.some((item) => !isAnimatedMediaFile(item.file))) return { ...empty, failures: items.map((item) => ({ id: item.id, fileName: item.file.name, message: "Jangan campur gambar statis dan klip animasi dalam satu batch." })) };
    if (animated) return applyAnimatedFlowBatch(items, onProgress);
    const targets = items.map((item) => project.visualStoryboard.scenes.find((scene) => scene.sceneId === item.sceneId));
    if (targets.some((scene) => !scene) || new Set(items.map((item) => item.sceneId)).size !== items.length) {
      return { ...empty, failures: items.map((item) => ({ id: item.id, fileName: item.file.name, message: "Assignment scene tidak valid atau duplikat." })) };
    }
    const replacing = targets.filter((scene) => scene!.sceneMedia || scene!.approved || scene!.motionActions.length > 0 || compositionForVisualScene(project.visualStoryboard, scene!).layers.some((layer) => layer.nodes.some((node) => node.type === "image" || node.type === "group" && node.children.some((child) => child.type === "image"))));
    const sharedWorld = project.visualStoryboard.visualWorld;
    if (replacing.length && !await askConfirmation({
      title: sharedWorld ? "Buat override ilustrasi per scene?" : "Ganti ilustrasi scene?",
      message: sharedWorld
        ? `${replacing.length} scene target mendapat ilustrasi khusus; Shared VisualWorld tetap untuk scene lain. Approval target dibatalkan. Motion Beat dipertahankan; target yang hilang perlu diperbaiki.`
        : `${replacing.length} scene target memiliki ilustrasi, Motion Beat, atau approval. Ilustrasi target diganti; approval dibatalkan. Motion Beat dipertahankan dan target yang hilang ditandai untuk diperbaiki. Scene lain tetap.`,
      confirmLabel: "Impor dan ganti",
      cancelLabel: "Batal",
      tone: "warning",
    })) return empty;

    setBusy(true);
    const failures: Array<{ id: string; fileName: string; message: string }> = [];
    const uploaded: Array<{ item: FlowBatchItem; scene: VisualStoryboardScene; asset: VisualAsset }> = [];
    let storedAssets = project.visualAssets;
    try {
      // ponytail: match server's 3-image validation concurrency; raise both limits together if throughput needs it.
      const filesPerRequest = 3;
      const batchCount = Math.ceil(items.length / filesPerRequest);
      onProgress({ stage: "uploading", percent: 0, completedFiles: 0, totalFiles: items.length, batchNumber: 1, batchCount });
      for (let offset = 0; offset < items.length; offset += filesPerRequest) {
        const batch = items.slice(offset, offset + filesPerRequest);
        const batchNumber = Math.floor(offset / filesPerRequest) + 1;
        const form = new FormData();
        const metadata = batch.map((item) => {
          const scene = project.visualStoryboard.scenes.find((candidate) => candidate.sceneId === item.sceneId)!;
          form.append("illustrations", item.file, item.file.name);
          return {
            name: item.file.name.replace(/\.[^.]+$/, "").slice(0, 120) || scene.headline,
            source: "ai-generated", license: "User-provided; Google Flow output imported manually", style: project.visualStoryboard.styleId,
            provider: "Google Flow (manual import)", model: "Google Flow", prompt: item.prompt,
            semanticTags: scene.objects.map((object) => object.label),
            supportedConcepts: [scene.semanticPlan?.primaryVisualConcept, scene.visualSummary].filter(Boolean),
          };
        });
        form.append("metadata", JSON.stringify(metadata));
        let result: { project: Project; results: Array<{ index: number; asset: VisualAsset }>; failures: Array<{ index: number; fileName: string; message: string }> };
        try {
          result = await apiWithUploadProgress<{ project: Project; results: Array<{ index: number; asset: VisualAsset }>; failures: Array<{ index: number; fileName: string; message: string }> }>(
            `/api/projects/${project.id}/visual-assets/batch`, form,
            (progress) => onProgress({ ...progress, completedFiles: offset, totalFiles: items.length, batchNumber, batchCount }),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "Batch import gagal.";
          failures.push(...batch.map((item) => ({ id: item.id, fileName: item.file.name, message })));
          onProgress({ stage: "processing", completedFiles: offset + batch.length, totalFiles: items.length, batchNumber, batchCount });
          continue;
        }
        storedAssets = result.project.visualAssets;
        onProgress({ stage: "processing", completedFiles: offset + batch.length, totalFiles: items.length, batchNumber, batchCount });
        for (const entry of result.results) {
          const item = batch[entry.index]!;
          const scene = project.visualStoryboard.scenes.find((candidate) => candidate.sceneId === item.sceneId)!;
          uploaded.push({ item, scene, asset: entry.asset });
        }
        for (const failure of result.failures) {
          const item = batch[failure.index];
          failures.push({ id: item?.id ?? failure.fileName, fileName: failure.fileName, message: failure.message });
        }
      }
      if (uploaded.length) {
        const importedByScene = new Map(uploaded.map((entry) => [entry.scene.sceneId, entry]));
        const scenes = project.visualStoryboard.scenes.map((scene) => {
            const imported = importedByScene.get(scene.sceneId);
            if (!imported) return scene;
            const { semanticPlan: _semanticPlan, ...withoutSemanticPlan } = scene;
            const composition = visualCompositionSchema.parse({
              background: project.visualStoryboard.palette.canvas,
              layers: [{ id: `flow-${imported.asset.sha256.slice(0, 12)}`, depth: 0.05, nodes: [{ type: "image", asset: imported.asset.id, x: 0, y: 0, width: 1080, height: 1920, fit: "cover", position: "center" }] }],
            });
            return {
              ...withoutSemanticPlan, sceneMedia: undefined, flowVisualMode: "still-image" as const, composition, compositionOverride: sharedWorld ? composition : undefined, compositionType: "hero-object-focus" as const, layout: "existing-composition" as const,
              objects: [], relationships: [], visualFocus: null, illustrationIntent: imported.asset.name, motionIntent: "gentle-reveal" as const,
              motionSummary: imported.scene.motionActions.length ? "Ilustrasi berubah; Motion Beat dipertahankan untuk ditinjau. Objek raster bergerak sebagai satu gambar." : "Ilustrasi Google Flow raster bergerak sebagai satu gambar; objek internal tidak dipisah.", motionStatus: imported.scene.motionActions.length ? "needs_review" as const : "not_prepared" as const, motionActions: imported.scene.motionActions,
              compositionSource: "library" as const, illustrationSource: "ai-image" as const, missingVisuals: [],
              illustrationWorkflow: "google-flow" as const,
              authoringStatus: "needs_review" as const, authoringConfirmed: false,
              warnings: ["Google Flow output diimpor manual; provenance dilaporkan pengguna. Tinjau akurasi ilmiah, crop, dan safe area.", ...(imported.scene.motionActions.length ? ["Motion Beat dipertahankan; periksa target layer setelah komposisi berubah."] : [])],
              approved: false, approvedFingerprint: null, flowStatus: "illustration-imported" as const,
            };
          });
        const storyboard: VisualStoryboard = {
          ...project.visualStoryboard,
          scenes,
          reusableWorldObjects: visualObjectIds.filter((objectId) => scenes.filter((scene) => scene.objects.some((object) => object.objectId === objectId)).length > 1),
        };
        setProject((current) => current ? { ...current, visualAssets: storedAssets, visualStoryboard: storyboard } : current);
        setResearch((current) => current ? applyVisualStoryboard(current, storyboard) : current);
        setSaved(false);
        setPreviewReviewed(false);
        setPreviewStarted(false);
      }
      setMessage(`${uploaded.length} ilustrasi dipasang ke scene${uploaded.length && sharedWorld ? "; Shared VisualWorld dipertahankan, target memakai override scene" : ""}${failures.length ? `; ${failures.length} gagal—file sukses tetap tersimpan dan tidak perlu diunggah ulang` : ""}. Tinjau lalu simpan perubahan.`);
      return { appliedIds: uploaded.map(({ item }) => item.id), failures };
    } finally { setBusy(false); }
  }

  async function applyGeneratedAiImage(sceneId: string, asset: VisualAsset, fit: "cover" | "contain") {
    if (busy) return;
    setBusy(true);
    try {
      const applied = await useUploadedIllustration(sceneId, asset.id, asset, false, false, { mode: "hero", fit, position: "center" });
      if (applied) setMessage("AI Image diterapkan sebagai full-frame 9:16 lokal. Tinjau preview, makna, crop, dan provenance; approval lama dibatalkan.");
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  async function openVisualLibrary(sceneId: string, tab: "mine" | "scenes" = "mine") {
    if (!project) return;
    setLibraryInitialTab(tab);
    setLibrarySceneId(sceneId);
  }

  async function confirmSceneIllustrationReplacement(sceneId: string, sourceLabel: string) {
    if (!project) return false;
    const scene = project.visualStoryboard.scenes.find((item) => item.sceneId === sceneId);
    if (!scene) return false;
    const hasImage = compositionForVisualScene(project.visualStoryboard, scene).layers.some((layer) => layer.nodes.some((node) => node.type === "image" || node.type === "group" && node.children.some((child) => child.type === "image")));
    if (!(scene.approved || scene.authoringConfirmed || scene.compositionSource === "manual" || scene.compositionSource === "ai-vector" || hasImage)) return true;
    return askConfirmation({
      title: "Ganti komposisi scene?",
      message: `${sourceLabel} akan mengubah komposisi scene. Approval lama menjadi stale; adaptasi dan approve ulang sebelum render.`,
      confirmLabel: "Lanjutkan & tinjau",
      cancelLabel: "Pertahankan komposisi",
      tone: "warning",
    });
  }

  function updateSceneDuration(sceneId: string, durationSec: number) {
    if (!research || !project) return;
    try {
      const nextResearch = setSceneDuration(research, sceneId, durationSec);
      const nextStoryboard = retimeVisualStoryboard(project.visualStoryboard, research, nextResearch);
      setResearch(nextResearch);
      setProject((current) => current ? { ...current, researchPackage: nextResearch, visualStoryboard: nextStoryboard } : current);
      setSaved(false);
      setPreviewReviewed(false);
      setPreviewStarted(false);
    } catch (error) { setMessage(friendlyError(error)); }
  }

  function updateOverlaySettings(change: Partial<ResearchPackage["videoOverlaySettings"]>) {
    setResearch((current) => current ? { ...current, videoOverlaySettings: { ...current.videoOverlaySettings, ...change } } : current);
    setSaved(false);
    setPreviewReviewed(false);
    setPreviewStarted(false);
  }

  function updateProjectOutro(outro: OutroSelection | null) {
    setProject((current) => current ? {
      ...current,
      outro,
      outroAsset: outro ? current.outroAsset?.id === outro.assetId ? current.outroAsset : outroLibrary.outros.find((asset) => asset.id === outro.assetId) ?? null : null,
    } : current);
    setSaved(false);
    setPreviewReviewed(false);
    setPreviewStarted(false);
  }

  async function selectVisualLibraryAsset(sceneId: string, assetId: string, placement: AssetPlacement) {
    if (busy) return;
    setBusy(true);
    try {
      if (!await useUploadedIllustration(sceneId, assetId, undefined, false, true, placement)) return;
      setLibrarySceneId(null);
      setMessage(`Aset lokal dipakai sebagai ${placement.mode}, fit ${placement.fit}, posisi ${placement.position}. Tinjau komposisi dan approve ulang.`);
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  async function importOpenverseAsset(sceneId: string, image: OpenverseImage, placement: AssetPlacement) {
    if (!project || busy || !await confirmSceneIllustrationReplacement(sceneId, "Ilustrasi Openverse")) return;
    setBusy(true);
    try {
      const scene = project.visualStoryboard.scenes.find((item) => item.sceneId === sceneId);
      const result = await api<{ project: Project; asset: VisualAsset; optimized: boolean }>(`/api/projects/${project.id}/openverse/${encodeURIComponent(image.id)}/import`, jsonRequest("POST", {
        name: image.title,
        semanticTags: scene?.objects.map((object) => object.label) ?? [],
        supportedConcepts: [...new Set([scene?.visualSummary ?? "", ...(scene?.semanticPlan?.requiredAssets ?? [])].filter(Boolean))],
        style: project.visualStoryboard.styleId,
      }));
      setProject((current) => current ? { ...current, visualAssets: result.project.visualAssets } : current);
      await useUploadedIllustration(sceneId, result.asset.id, result.asset, true, true, placement);
      setLibrarySceneId(null);
      setMessage(`Ilustrasi Openverse tersimpan lokal${result.optimized ? " dan dioptimalkan" : ""}. Periksa atribusi, lisensi asli, makna, dan crop.`);
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  async function importTablerAsset(sceneId: string, icon: TablerIconEntry, placement: AssetPlacement) {
    if (!project || busy || !await confirmSceneIllustrationReplacement(sceneId, "Ikon Tabler")) return;
    setBusy(true);
    try {
      const result = await api<{ project: Project; asset: VisualAsset }>(`/api/projects/${project.id}/asset-packs/tabler/${encodeURIComponent(icon.id)}/import`, { method: "POST" });
      setProject((current) => current ? { ...current, visualAssets: result.project.visualAssets } : current);
      await useUploadedIllustration(sceneId, result.asset.id, result.asset, true, true, placement);
      setLibrarySceneId(null);
      setMessage(`Tabler ${icon.id} disalin lokal dengan lisensi MIT. Ikon bukan ilustrasi scene lengkap; tinjau ulang.`);
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  async function useReusableScene(sceneId: string, reusable: ReusableSceneEntry) {
    if (!project || busy || !await confirmSceneIllustrationReplacement(sceneId, "Reusable scene")) return;
    setBusy(true);
    try {
      const result = await api<{ project: Project; scene: ReusableSceneEntry }>(`/api/projects/${project.id}/reusable-scenes/${reusable.id}/attach`, { method: "POST" });
      setProject((current) => current ? { ...current, visualAssets: result.project.visualAssets } : current);
      updateScene(sceneId, (source) => ({ ...source, motionPlan: result.scene.motionPlan }));
      updateVisualScene(sceneId, {
        composition: result.scene.composition,
        compositionType: result.scene.compositionType as VisualStoryboardScene["compositionType"],
        layout: result.scene.layout,
        compositionSource: "library", illustrationSource: "asset-library",
        objects: result.scene.objects, relationships: result.scene.relationships,
        visualFocus: result.scene.visualFocus, illustrationIntent: result.scene.concepts.join(" · ") || result.scene.name,
        motionIntent: result.scene.motionIntent, motionSummary: result.scene.motionSummary,
        missingVisuals: [], warnings: ["Reusable composition disalin tanpa judul/narasi sumber. Sesuaikan makna scene baru, hubungan objek, dan crop sebelum approval."],
        authoringStatus: "needs_review", authoringConfirmed: false, approved: false,
      });
      setLibrarySceneId(null);
      setMessage("Reusable scene disalin—template asli tidak berubah. Sesuaikan scene lalu approve ulang.");
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  async function saveReusableScene(sceneId: string, data: Omit<ReusableSceneInput, "thumbnailDataUrl"> & { thumbnailDataUrl: string }) {
    if (!project) throw new Error("Project tidak tersedia.");
    await api(`/api/projects/${project.id}/reusable-scenes`, jsonRequest("POST", data));
    setMessage("Reusable scene tersimpan lokal.");
  }

  async function selectAiImageSource(sceneId: string) {
    if (!project?.visualStoryboard.scenes.some((item) => item.sceneId === sceneId)) return false;
    updateVisualScene(sceneId, { illustrationWorkflow: "ai-image-api" });
    void api<AiImageProviderCatalog>("/api/ai-image/providers").then(setAiImageProviders).catch(() => {});
    return true;
  }

  async function generateAiImage(sceneId: string, providerId: string, model: string, prompt: string, resolution: string): Promise<VisualAsset | null> {
    if (!project || busy || !aiImageProviders?.configured) return null;
    const provider = aiImageProviders.providers.find((item) => item.id === providerId);
    if (providerId !== "huggingface-inference" || !provider?.models.some((item) => item.id === model)) throw new Error("Provider/model tidak ada di katalog live Hugging Face.");
    if (aiImageProviders.status === "Rate Limited" || aiImageProviders.status === "Quota Exhausted" || aiImageProviders.status === "Generating") {
      throw new Error(aiImageProviders.message ?? `AI Image berstatus ${aiImageProviders.status}.`);
    }
    const confirmed = await askConfirmation({
      title: "Generate satu gambar melalui Hugging Face?",
      message: `Prompt akan dikirim ke ${provider.displayName} dengan model ${model}. Harga, sisa kredit, dan kuota tidak dapat diverifikasi aplikasi; request dapat dikenai biaya. Hanya satu gambar dibuat. Lanjutkan?`,
      confirmLabel: "Generate satu gambar",
      cancelLabel: "Batal",
      tone: "warning",
    });
    if (!confirmed) return null;
    setBusy(true);
    try {
      const result = await api<{ project: Project; asset: VisualAsset; optimized: boolean; originalBytes: number }>(
        `/api/projects/${project.id}/scenes/${encodeURIComponent(sceneId)}/ai-image/generate`,
        jsonRequest("POST", { provider: providerId, model, prompt, resolution, confirmed: true, costAcknowledged: true }),
      );
      setProject((current) => current ? { ...current, visualAssets: result.project.visualAssets } : current);
      setAiImageProviders(await api<AiImageProviderCatalog>("/api/ai-image/providers"));
      setMessage(`AI Image tersimpan lokal${result.optimized ? " dan dioptimalkan ke WebP" : ""}. Preview terpisah; storyboard belum diubah.`);
      return result.asset;
    } catch (error) {
      try { setAiImageProviders(await api<AiImageProviderCatalog>("/api/ai-image/providers")); } catch { /* preserve original generation error */ }
      throw error;
    } finally { setBusy(false); }
  }

  async function removeVisualAsset(assetId: string) {
    if (!project) return;
    const confirmed = await askConfirmation({
      title: "Lepas aset dari project?",
      message: "Aset hanya dilepas jika tidak dipakai scene atau snapshot render. Aset yang masih dipakai project lain tetap tersimpan.",
      confirmLabel: "Lepas aset",
      cancelLabel: "Batal",
      tone: "warning",
      onConfirm: async () => {
        const result = await api<{ project: Project }>(`/api/projects/${project.id}/visual-assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
        setProject((current) => current ? { ...current, visualAssets: result.project.visualAssets } : current);
      },
    });
    if (confirmed) setMessage("Aset dilepas dari project.");
  }

  function confirmUploadedIllustration(sceneId: string) {
    updateVisualScene(sceneId, { authoringConfirmed: true, authoringStatus: "needs_review", flowStatus: "ready-for-review", warnings: ["Kecocokan aset dan hubungan telah dikonfirmasi manusia; approval tetap terpisah."] });
  }

  async function saveProject(): Promise<Project | null> {
    if (!project || !research) return null;
    setBusy(true);
    try {
      const updated = await api<Project>(`/api/projects/${project.id}`, jsonRequest("PUT", { researchPackage: research, visualStoryboard: project.visualStoryboard, outro: project.outro, ...(project.animationStyleId ? { animationStyleId: project.animationStyleId } : {}) }));
      setProject(updated);
      setResearch(updated.researchPackage);
      setSaved(true);
      await refresh();
      setMessage("Storyboard tersimpan.");
      return updated;
    } catch (error) { setMessage(friendlyError(error)); return null; }
    finally { setBusy(false); }
  }

  async function goToStep(target: WorkspaceStep) {
    if (!project || !research || busy) return;
    const currentIndex = workspaceSteps.findIndex((step) => step.id === activeStep);
    const targetIndex = workspaceSteps.findIndex((step) => step.id === target);
    if (targetIndex <= currentIndex) {
      navigateWorkspaceStep(target);
      setMessage("");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    let currentProject = project;
    let currentSaved = saved;
    for (let index = 0; index < targetIndex; index++) {
      const step = workspaceSteps[index]!.id;
      if (step === "materials" && !currentSaved) {
        const updated = await saveProject();
        if (!updated) { navigateWorkspaceStep("materials", "replace"); return; }
        currentProject = updated;
        currentSaved = true;
      }
      if (step === "video-editor" && !currentSaved) {
        const updated = await saveProject();
        if (!updated) { navigateWorkspaceStep("video-editor", "replace"); return; }
        currentProject = updated;
        currentSaved = true;
      }
      const canAdvance = canAdvanceWorkspaceStep(step, {
        ...workflowSignals,
        activeStep: step,
        saved: currentSaved,
        reviewVerified: currentProject.researchReviewStatus === "verified-by-author" && currentSaved,
      });
      if (!canAdvance) {
        navigateWorkspaceStep(step, "replace");
        setMessage(step === "materials" ? "Simpan materi sebelum lanjut." : step === "narration" ? "Setujui audio yang cocok, atau pilih durasi manual tanpa narasi." : step === "video-editor" ? "Perbaiki quality gate dan approve visual terkait sebelum lanjut ke Review." : step === "review" ? "Tinjau materi dan tandai sudah diverifikasi sebelum lanjut." : step === "preview" ? "Putar dan tinjau Preview Video sebelum ke render." : "Selesaikan langkah ini sebelum lanjut.");
        return;
      }
    }
    navigateWorkspaceStep(target);
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function completePreviewReview() {
    if (!previewStarted) {
      setMessage("Putar Preview Video terlebih dahulu, lalu tandai sudah ditinjau.");
      return;
    }
    setPreviewReviewed(true);
    setMessage("Preview ditandai sudah ditinjau.");
  }

  async function uploadAudio(file?: File) {
    if (!project || !file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("audio", file);
      const updated = await api<Project>(`/api/projects/${project.id}/audio`, { method: "POST", body: form });
      setProject(updated);
      setPreviewReviewed(false);
      setPreviewStarted(false);
      setAudioMode("upload");
      await refresh();
      setMessage(`Audio siap · ${updated.audio?.durationSec.toFixed(1)} dtk. Timing scene memakai estimasi berbobot dari naskah.`);
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  async function removeAudio() {
    if (!project) return;
    setBusy(true);
    try {
      const updated = await api<Project>(`/api/projects/${project.id}/audio`, { method: "DELETE" });
      setProject(updated);
      setPreviewReviewed(false);
      setPreviewStarted(false);
      await refresh();
      setMessage("Audio dilepas.");
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  async function chooseManualTiming() {
    if (!project || !research || project.audio || busy || ttsBusy) return;
    setBusy(true);
    try {
      const updated = await api<Project>(`/api/projects/${project.id}`, jsonRequest("PUT", {
        researchPackage: research, visualStoryboard: project.visualStoryboard, narrationMode: "manual", outro: project.outro,
      }));
      setProject(updated);
      setResearch(updated.researchPackage);
      setSaved(true);
      setPreviewReviewed(false);
      setPreviewStarted(false);
      setMessage("Mode durasi manual dipilih. Tidak ada layanan TTS yang dipanggil.");
      navigateWorkspaceStep("video-editor");
    } catch (error) { setTtsMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  async function generateTts(regenerate = false) {
    if (!project || !research || ttsBusy || !ttsVoiceId) return;
    setTtsBusy(true);
    setTtsMessage("");
    try {
      if (!saved) {
        const updated = await api<Project>(`/api/projects/${project.id}`, jsonRequest("PUT", { researchPackage: research, visualStoryboard: project.visualStoryboard, outro: project.outro }));
        setProject(updated);
        setResearch(updated.researchPackage);
        setSaved(true);
      }
      const result = await api<{ project: Project; preview: TtsPreview; cacheHit: boolean }>(`/api/projects/${project.id}/tts`, jsonRequest("POST", {
        locale: ttsLocale,
        voiceId: ttsVoiceId,
        style: ttsStyle,
        speakingRate: ttsRate,
        regenerate,
      }));
      setProject(result.project);
      setResearch(result.project.researchPackage);
      setSaved(true);
      setPreviewReviewed(false);
      setPreviewStarted(false);
      setAudioMode("ai");
      setTestVoicePreview(null);
      await refresh();
      setTtsMessage(`${result.cacheHit ? "Preview diambil dari cache" : "Preview narasi selesai"} · ${result.preview.durationSec.toFixed(1)} dtk. Dengarkan, lalu pilih Gunakan Audio Ini.`);
    } catch (error) { setTtsMessage(friendlyError(error)); }
    finally { setTtsBusy(false); }
  }

  async function loadTtsVoices() {
    if (ttsLoading || ttsBusy) return;
    setTtsLoading(true);
    setTtsMessage("");
    try {
      const result = await api<TtsVoices>(`/api/tts/voices?locale=${encodeURIComponent(ttsLocale)}`);
      setTtsVoices(result);
      const choices = ttsGender === "All" ? result.voices : result.voices.filter((voice) => voice.gender === ttsGender);
      setTtsVoiceId((current) => choices.some((voice) => voice.id === current) ? current : choices[0]?.id ?? "");
      if (ttsGender !== "All" && !choices.length) setTtsGender("All");
      if (!result.configured) setTtsMessage(result.message ?? result.disabledReason ?? "Gemini TTS belum dikonfigurasi.");
      else if (result.catalogSource === "fallback") setTtsMessage(result.catalogWarning ?? "Voice live belum terverifikasi; generate dapat gagal.");
    } catch (error) { setTtsMessage(friendlyError(error)); }
    finally { setTtsLoading(false); }
  }

  async function testVoice() {
    if (ttsBusy || !ttsVoiceId) return;
    setTtsBusy(true);
    setTtsMessage("");
    try {
      const preview = await api<{ preview: TtsPreview; cacheHit: boolean }>("/api/tts/test-voice", jsonRequest("POST", {
        locale: ttsLocale, voiceId: ttsVoiceId, style: ttsStyle, speakingRate: ttsRate,
      }));
      setTestVoicePreview(preview.preview);
      setTtsMessage(`Test Voice ${preview.cacheHit ? "diambil dari cache" : "selesai"} · ${preview.preview.durationSec.toFixed(1)} dtk.`);
    } catch (error) { setTtsMessage(friendlyError(error)); }
    finally { setTtsBusy(false); }
  }

  async function approveTts() {
    if (!project || !project.pendingTts || !project.pendingTtsMatchesNarration || !saved || ttsBusy) return;
    setTtsBusy(true);
    setTtsMessage("");
    try {
      const previousDurationSec = project.audio?.durationSec ?? project.researchPackage.targetDurationSec;
      const durationChanged = Math.abs(previousDurationSec - project.pendingTts.durationSec) >= 0.01;
      const timingDecision = durationChanged
        ? await askTtsTimingDecision(previousDurationSec, project.pendingTts.durationSec, Boolean(project.audio))
        : "retime";
      if (timingDecision === "cancel") return;
      const result = await api<{ project: Project }>(`/api/projects/${project.id}/tts/approve`, jsonRequest("POST", { timingDecision }));
      setProject(result.project);
      setResearch(result.project.researchPackage);
      setSaved(true);
      setPreviewReviewed(false);
      setPreviewStarted(false);
      setTestVoicePreview(null);
      await refresh();
      setTtsMessage(timingDecision === "keep-timeline"
        ? "Audio disetujui. Timing scene dipertahankan; sesuaikan durasi manual di Video Editor."
        : "Audio disetujui. Timing awal diselaraskan secara estimasi berbobot; visual tetap dipertahankan.");
    } catch (error) { setTtsMessage(friendlyError(error)); }
    finally { setTtsBusy(false); }
  }

  async function renderFinal() {
    if (!project || !research || busy) return;
    if (!visualGate?.ready || !visualApproved) {
      navigateWorkspaceStep("video-editor");
      setMessage("Visual belum lolos quality gate atau belum disetujui per scene.");
      return;
    }
    if (!saved) {
      navigateWorkspaceStep("materials");
      setMessage("Simpan perubahan storyboard sebelum review fakta dan Preview Video.");
      return;
    }
    if (project.audio?.source === "tts" && (!project.audioMatchesNarration || narrationScript(research) !== narrationScript(project.researchPackage))) {
      navigateWorkspaceStep("narration");
      setMessage("Naskah berubah setelah AI Voice disetujui. Buat dan setujui preview narasi baru sebelum render.");
      return;
    }
    if (project.researchReviewStatus !== "verified-by-author") {
      navigateWorkspaceStep("review");
      setMessage("Tinjau dan verifikasi materi sebelum render final.");
      return;
    }
    if (!previewReviewed) {
      navigateWorkspaceStep("preview");
      setMessage("Putar dan tinjau Preview Video untuk draft ini sebelum render final.");
      return;
    }
    let renderProject = project;
    if (!renderProject.audio && !await askConfirmation({ title: "Render video tanpa narasi?", message: "Audio belum tersedia. MP4 akan berisi video tanpa voice-over; konfirmasi hanya jika memang diinginkan.", confirmLabel: "Render tanpa narasi", tone: "warning" })) return;
    setBusy(true);
    try {
      let job = renderProject.latestJobContentCurrent && renderProject.latestJob?.rendererVersion === RENDERER_VERSION ? renderProject.latestJob : null;
      if (!job) {
        const generated = await api<{ job: NonNullable<Job>; warnings: string[] }>(`/api/projects/${renderProject.id}/generate`, { method: "POST" });
        job = generated.job;
        renderProject = { ...renderProject, latestJob: job, latestJobCurrent: job.rendererVersion === RENDERER_VERSION, latestJobContentCurrent: true };
        setProject(renderProject);
        await api<Status>("/api/status").then(setStatus);
      }
      if (!job) throw new Error("Snapshot render tidak tersedia.");
      if (job.state === "rendered") {
        setProject(renderProject);
        setMessage("Render terakhir untuk materi ini sudah siap. Unduh MP4 yang tersedia.");
        await refresh();
        return;
      }
      if (job.state !== "rendering") {
        if (job.attemptCount >= 3) throw new Error("Batas tiga percobaan render untuk snapshot ini tercapai.");
        await api<Job>(`/api/jobs/${job.id}/render`, jsonRequest("POST", { allowSilent: !renderProject.audio }));
      }
      setMessage("Render berjalan lokal. Progress mengikuti Remotion; ini bisa memakan waktu.");
      for (let check = 0; check < 900; check++) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const updatedJob = await api<NonNullable<Job>>(`/api/jobs/${job.id}`);
        setProject((current) => current ? { ...current, latestJob: updatedJob } : current);
        if (updatedJob.state !== "rendering") {
          setMessage(updatedJob.state !== "rendered" ? updatedJob.error ?? "Render gagal." : updatedJob.manifest?.audioValidation === "silent-expected" ? "MP4 selesai: video tanpa narasi, track senyap terverifikasi." : updatedJob.manifest?.audioValidation === "pass-media" ? "MP4 selesai; audio klip aktif. Dengarkan isi dan sinkronisasi." : updatedJob.manifest?.audioValidation === "pass-low-level" ? "MP4 selesai, tetapi level narasi rendah. Dengarkan dan periksa sebelum dipakai." : updatedJob.manifest?.audioValidation === "pass" ? "MP4 selesai; AAC non-senyap terverifikasi. Dengarkan untuk verifikasi isi narasi." : "MP4 selesai, tetapi metadata validasi audio lama tidak tersedia. Dengarkan sebelum dipakai.");
          await refresh();
          return;
        }
      }
      setMessage("Render masih berjalan. Status tersimpan; buka kembali job beberapa saat lagi.");
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  async function setReview(statusValue: "needs-review" | "verified-by-author") {
    if (!project) return;
    if (statusValue === "verified-by-author" && !saved) { setMessage("Simpan perubahan materi sebelum menandai fakta sudah ditinjau."); return; }
    try {
      const updated = await api<Project>(`/api/projects/${project.id}/review`, jsonRequest("POST", { status: statusValue }));
      setProject(updated);
      if (statusValue === "needs-review") { setPreviewReviewed(false); setPreviewStarted(false); }
      await refresh();
    } catch (error) { setMessage(friendlyError(error)); }
  }

  async function performDeleteProject(id: string, title: string) {
    setBusy(true);
    try {
      const result = await api<{ deleted: boolean; cleanupPending: number | null }>(`/api/projects/${id}`, { method: "DELETE" });
      if (project?.id === id) {
        setProject(null);
        setResearch(null);
        setTestVoicePreview(null);
        setTtsVoices(null);
        setCreateDraftUnsaved(false);
        commitRoute({ view: "dashboard" }, "replace");
        setAudioMode("upload");
      }
      await refresh();
      setMessage(result.cleanupPending === null
        ? `Project “${title}” dihapus. Cleanup file masih antre dan akan dicoba ulang otomatis.`
        : result.cleanupPending > 0
          ? `Project “${title}” dihapus. ${result.cleanupPending} cleanup file akan dicoba ulang otomatis.`
          : `Project “${title}” dihapus.`);
    } catch (error) { setMessage(friendlyError(error)); throw error; }
    finally { setBusy(false); }
  }

  async function deleteProject(id: string) {
    const target = projects.find((item) => item.id === id);
    if (!target || busy || ttsBusy || ttsLoading) return;
    if (view === "create" && project?.id === id && !await confirmLeaveCreate()) return;
    await askConfirmation({
      title: "Hapus video project?",
      message: `“${target.researchPackage.title}” beserta storyboard, job, dan hasil render akan dihapus permanen.`,
      confirmLabel: "Hapus video",
      tone: "danger",
      onConfirm: () => performDeleteProject(id, target.researchPackage.title),
    });
  }

  const currentWorkspaceStep = workspaceSteps.find((step) => step.id === activeStep) ?? workspaceSteps[0];
  const currentStepIndex = workspaceSteps.findIndex((step) => step.id === activeStep);
  const currentJob = project?.latestJobContentCurrent && project.latestJob?.rendererVersion === RENDERER_VERSION ? project.latestJob : null;
  const createOutroId = selectedCreateOutroId === undefined ? outroLibrary.defaultOutroId : selectedCreateOutroId;
  const createOutroAsset = createOutroId ? outroLibrary.outros.find((asset) => asset.id === createOutroId) ?? null : null;

  return <div className={`app-shell ${view === "workspace" && activeStep === "video-editor" ? "editor-active" : ""}`}>
    <main className="main-area">
      <header className="topbar">
        <div className="topbar-left">
          <button className="brand" onClick={() => void goToDashboard()} aria-label="AI Facts Studio — Beranda" disabled={busy || ttsBusy || ttsLoading}>
            <span className="brand-mark"><Sparkles aria-hidden="true" size={17} /></span><span><strong>AI Facts</strong><small>STUDIO</small></span>
          </button>
          <nav className="topbar-nav" aria-label="Navigasi utama">
            <button type="button" className={`nav-home ${view === "dashboard" ? "active" : ""}`} onClick={() => void goToDashboard()} disabled={busy || ttsBusy || ttsLoading} aria-current={view === "dashboard" ? "page" : undefined} aria-label="Beranda"><House aria-hidden="true" size={17} /><span>Beranda</span></button>
            <button type="button" className={`nav-home ${view === "series-library" || view === "series-detail" ? "active" : ""}`} onClick={() => void openStorySeries({ view: "series-library", slug: null })} disabled={busy || ttsBusy || ttsLoading} aria-current={view === "series-library" || view === "series-detail" ? "page" : undefined} aria-label="Story Series"><BookOpen aria-hidden="true" size={17}/><span>Series</span></button>
          </nav>
        </div>
        <div className="topbar-actions">
          {view === "workspace" && activeStep !== "video-editor" && !saved && <button type="button" className="button button-primary topbar-save" onClick={() => void saveProject()} disabled={busy} aria-label="Simpan perubahan" title="Simpan perubahan"><SaveIcon aria-hidden="true" size={16} /><span>Simpan</span></button>}
          <button type="button" className="button button-primary topbar-create" onClick={() => void openCreate()} disabled={busy || ttsBusy || ttsLoading} aria-current={view === "create" ? "page" : undefined} aria-label="Buat video" title="Buat video"><Sparkles aria-hidden="true" size={16} /><span>Buat video</span></button>
          <ThemeSwitcher preference={theme} onChange={setTheme} />
          <button className={`topbar-icon ${view === "settings" ? "active" : ""}`} type="button" onClick={() => void openSettings()} disabled={busy || ttsBusy || ttsLoading || aiSettingsBusy} aria-label="Pengaturan" title="Pengaturan"><SettingsIcon aria-hidden="true" size={18} /></button>
        </div>
      </header>

      {message && <div className="toast" role="status"><span>{message}</span><button onClick={() => setMessage("")} aria-label="Tutup">×</button></div>}

      {view === "dashboard" && <Dashboard projects={projects} loading={!projectsLoaded} busy={busy || ttsBusy || ttsLoading} onSample={() => void loadSample()} onOpen={(id) => void openProject(id)} onDelete={(id) => void deleteProject(id)} />}
      {(view === "series-library" || view === "series-detail") && <StorySeriesPage route={route} busy={busy || ttsBusy || ttsLoading} onNavigate={(target) => void openStorySeries(target)} onOpenProject={(id) => void openProject(id)} />}
      {view === "create" && <section className="page layout-container create-page">
        <div className="page-heading"><div><div className="eyebrow">BUAT VIDEO</div><h1>Create video</h1><p>Pilih Generate with AI atau Buat Manual. Import Research Package tersedia di Advanced; versi lama otomatis di-upgrade.</p></div>
          <button className="button button-light" onClick={() => void loadSample()} disabled={busy}><span>✦</span> Gunakan sample gunung api</button>
        </div>
        <div className="create-mode-switch" role="group" aria-label="Mode pembuatan project">
          <button type="button" aria-pressed={createMode === "ai"} className={createMode === "ai" ? "selected" : ""} onClick={() => setCreateMode("ai")}>
            <strong>Generate with AI</strong><span>Riset dan storyboard draft dibuat setelah Anda klik.</span>
          </button>
          <button type="button" aria-pressed={createMode === "manual"} className={createMode === "manual" ? "selected" : ""} onClick={() => setCreateMode("manual")}>
            <strong>Buat Manual</strong><span>Tanpa AI. Susun storyboard sendiri di project.</span>
          </button>
        </div>
        <AnimationStyleGallery selectedId={selectedCreateAnimationStyleId} onChange={(styleId) => {
          setSelectedCreateAnimationStyleId(styleId);
          setCreateDraftUnsaved(true);
        }} disabled={busy} description="Pilihan gaya berlaku untuk Generate with AI dan Buat Manual." />
        <section className="create-outro-choice" aria-labelledby="create-outro-title">
          <div className="create-outro-copy"><h2 id="create-outro-title">Outro Video (Opsional)</h2><p>Default library terpilih untuk project baru. Pilih Tanpa Outro kapan saja.</p></div>
          <label>Outro Video
            <select aria-label="Outro Video (Opsional)" value={createOutroId ?? ""} onChange={(event) => setSelectedCreateOutroId(event.target.value || null)} disabled={!outroLibraryLoaded}>
              <option value="">Tanpa Outro</option>
              {outroLibrary.outros.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}{asset.isDefault ? " · Default" : ""} · {asset.durationSec.toFixed(1)} dtk</option>)}
            </select>
          </label>
          {createOutroAsset ? <div className="create-outro-selected">
            <img src={createOutroAsset.posterUrl} alt=""/>
            <div><strong>{createOutroAsset.name}</strong><span>{createOutroAsset.durationSec.toFixed(1)} dtk · {createOutroAsset.width} × {createOutroAsset.height}</span>
              {createOutroAsset.localAvailable ? <video src={createOutroAsset.previewUrl} poster={createOutroAsset.posterUrl} controls playsInline preload="metadata" aria-label={`Pratinjau outro ${createOutroAsset.name}`}/> : <small role="alert">File outro tidak tersedia; tidak ada fallback otomatis.</small>}
            </div>
          </div> : <p className="create-outro-none">{outroLibraryLoaded ? "Tanpa Outro" : "Memuat Outro Library…"}</p>}
          <button type="button" className="button button-light" onClick={() => void openSettings("outro-library")}>Kelola Outro Library</button>
        </section>
        <div hidden={createMode !== "ai"}><AiGenerationPanel
          mode={aiGenerationSettings?.mode ?? null}
          development={aiGenerationSettings?.providers.development ?? null}
          production={aiGenerationSettings?.providers.production ?? null}
          projectBusy={busy}
          onGenerate={generateAiDraft}
          onCreateProject={createAiProject}
          onOpenProject={(id, notice, initialStep) => void openProject(id, notice, false, initialStep)}
          onUnsavedChange={setCreateDraftUnsaved}
        /></div>
        <div hidden={createMode !== "manual"}><ManualProjectPanel
          projectBusy={busy}
          onCreateProject={createManualProject}
          onOpenProject={(id, notice, initialStep) => void openProject(id, notice, false, initialStep)}
          onUnsavedChange={setCreateDraftUnsaved}
        /></div>
        <details className="create-import-advanced"><summary>Advanced · Import Research Package JSON</summary><div className="create-import-content"><div className="import-card">
          <div className="import-toolbar"><div><strong>Import Research Package</strong><p>JSON tersimpan lokal. Konten dianggap data, tidak menjalankan script.</p></div>
            <label className="button button-light file-button">Pilih file JSON<input type="file" accept=".json,application/json" onChange={(event) => void importFile(event.target.files?.[0])} /></label>
          </div>
          <label className="import-json-field"><span>Research Package JSON</span><textarea className="json-editor" value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} spellCheck={false} aria-label="Editor Research Package JSON" /><small>Schema v1.0 otomatis di-upgrade ke v1.1. Maksimal 1 MB; sumber tidak diverifikasi otomatis.</small></label>
          <div className="import-footer"><button className="button button-primary" disabled={busy || !jsonDraft.trim()} onClick={() => void createFromJson()}>Buat storyboard <b>→</b></button></div>
        </div>
        <div className="notice-line"><span className="notice-icon">ⓘ</span><span>Import bukan verifikasi fakta. Tinjau klaim, URL, dan timing sebelum render atau publikasi.</span></div>
        </div></details>
      </section>}

      {view === "settings" && <SettingsPage
        section={route.section}
        onSection={navigateSettingsSection}
        status={status}
        projects={projects}
        projectsLoaded={projectsLoaded}
        settings={aiGenerationSettings}
        busy={aiSettingsBusy}
        error={aiSettingsError}
        onMode={(mode) => void setAiGenerationMode(mode)}
        theme={theme}
        onTheme={setTheme}
        outroLibrary={outroLibrary}
        outroLibraryLoaded={outroLibraryLoaded}
        outroContent={<OutroLibraryPanel assets={outroLibrary.outros} defaultOutroId={outroLibrary.defaultOutroId} busy={outroLibraryBusy} onUpload={(file) => void uploadOutro(file)} onRename={(id, name) => void renameOutro(id, name)} onMakeDefault={(id) => void makeOutroDefault(id)} onDelete={(asset) => void deleteOutro(asset)}/>}
      />}

      {view === "workspace" && project && research && <section className={`page layout-container workspace-page ${activeStep === "video-editor" ? "video-editor-workspace" : ""}`}>
        {activeStep !== "video-editor" && <div className="workspace-heading">
          <div><div className="eyebrow">VIDEO WORKSPACE <span className="crumb-dot">/</span> LANGKAH {currentStepIndex + 1} DARI {workspaceSteps.length}</div>
            <input className="title-input" aria-label="Judul video" value={research.title} onChange={(event) => updateResearch((current) => ({ ...current, title: event.target.value }))} />
            <div className="meta-line"><span>{research.scenes.length} scenes</span><i />{project.audio ? <span>Audio {project.audio.durationSec.toFixed(1)} dtk</span> : <span>Audio belum ditambahkan</span>}<i /><span>9:16 · 1080 × 1920</span></div>
          </div>
        </div>}

        <WorkflowStepper activeStep={activeStep} statuses={stepStatuses} signals={workflowSignals} onSelect={(step) => void goToStep(step)} />
        <div className={`workspace-step-panel ${activeStep === "video-editor" ? "video-editor-step-panel" : ""}`}>
          {activeStep !== "video-editor" && <div className="workspace-step-heading"><div><span className="eyebrow">LANGKAH {currentStepIndex + 1}</span><h2>{currentWorkspaceStep.title}</h2><p>{currentWorkspaceStep.description}</p></div>{activeStep === "preview" && <span className="step-duration">Draft interaktif</span>}</div>}

          {project.visualStoryboardError ? <div className="storyboard-recovery-card" role="alert"><span className="eyebrow">DATA VISUAL DILINDUNGI</span><h2>Visual Storyboard perlu dipulihkan</h2><p>{project.visualStoryboardError}</p><p>Project tidak dimuat dengan visual pengganti. Data asli tetap tersimpan dan semua perubahan ditahan.</p><button type="button" className="button button-primary" onClick={() => {
            const backup = new Blob([JSON.stringify({ id: project.id, researchPackage: project.researchPackage, visualStoryboard: project.visualStoryboard, visualAssets: project.visualAssets }, null, 2)], { type: "application/json" });
            const href = URL.createObjectURL(backup);
            const link = document.createElement("a"); link.href = href; link.download = `${project.id}-visual-storyboard-backup.json`; link.click(); URL.revokeObjectURL(href);
          }}>Unduh backup project</button></div> : <>
          {activeStep === "materials" && <div className="workspace-step-content materials-content">
            <div className="story-column">
              <div className="section-title"><div><h2>Storyboard</h2><p>Pilih scene untuk edit teks, narasi, timing, dan sumber.</p></div><div className="storyboard-actions"><span className="count-chip">{research.scenes.length} SCENES</span><button type="button" className="button button-light" onClick={addResearchScene} disabled={sceneEditingLocked || research.scenes.length >= 30} title={research.scenes.length >= 30 ? "Maksimal 30 scene" : undefined}><Plus size={16} aria-hidden="true"/>Tambah scene</button></div></div>
               {research.scenes.length ? <div className="scene-list">
                  {research.scenes.map((scene, index) => <div className="scene-row-group" key={scene.id}>
                    <button type="button" data-scene-id={scene.id} className={`scene-row ${selectedScene?.id === scene.id ? "chosen" : ""}`} aria-pressed={selectedScene?.id === scene.id} onClick={() => selectScene(scene.id)}>
                      <span className="scene-number">{String(index + 1).padStart(2, "0")}</span><span className="scene-row-copy"><strong>{scene.onScreenText || `Scene ${index + 1} · belum diisi`}</strong><small>{scene.startSec}s — {scene.endSec}s <i /> {scene.templateId.replaceAll("-", " ")}</small></span><span className="scene-chevron" aria-hidden="true">›</span>
                    </button>
                    <div className="scene-reorder-actions">
                      <button type="button" className="button button-light icon-button" aria-label={`Pindahkan scene ${index + 1} ke atas`} title="Pindahkan ke atas" disabled={sceneEditingLocked || index === 0} onClick={() => moveResearchScene(scene.id, -1)}><ArrowUp size={16} aria-hidden="true" /></button>
                      <button type="button" className="button button-light icon-button" aria-label={`Pindahkan scene ${index + 1} ke bawah`} title="Pindahkan ke bawah" disabled={sceneEditingLocked || index === research.scenes.length - 1} onClick={() => moveResearchScene(scene.id, 1)}><ArrowDown size={16} aria-hidden="true" /></button>
                    </div>
                  </div>)}
                </div> : <div className="workflow-empty"><strong>Belum ada scene</strong><p>Tambahkan scene pertama untuk mulai menyusun storyboard.</p><button type="button" className="button button-primary" onClick={addResearchScene} disabled={sceneEditingLocked}>Tambah Scene Pertama</button></div>}
               {selectedScene && <SceneEditor key={`${project.id}:${selectedScene.id}`} scene={selectedScene} references={research.references} onChange={(change) => updateScene(selectedScene.id, change)} onDelete={() => void removeResearchScene(selectedScene.id)} deleteDisabled={sceneEditingLocked || research.scenes.length <= 1} />}
            </div>
            <aside className="materials-aside">
              <div className="project-details-card">
                <div className="section-title compact"><div><h2>Video details</h2><p>Metadata Research Package</p></div></div>
                <div className="details-fields">
                  <label>Kategori<select value={research.category} onChange={(event) => updateResearch((current) => ({ ...current, category: event.target.value as ResearchPackage["category"] }))}>{categories.map((value) => <option key={value}>{value}</option>)}</select></label>
                  <label>Visual preset<select value={research.visualPreset} onChange={(event) => updateResearch((current) => ({ ...current, visualPreset: event.target.value as ResearchPackage["visualPreset"] }))}>{visualPresets.map((value) => <option key={value} value={value}>{value.replaceAll("-", " ")}</option>)}</select></label>
                  <label>Durasi target<input type="number" min="1" max="120" value={research.targetDurationSec} onChange={(event) => updateResearch((current) => ({ ...current, targetDurationSec: Number(event.target.value) }))} /> <small>detik · maks 120</small></label>
                </div>
              </div>
              {project.creationMode === "manual" && <div className="manual-project-brief"><span>ASAL PROJECT · MANUAL</span><strong>Gaya {project.creationBrief?.deliveryStyle ?? "edukatif"}</strong>{project.creationBrief?.additionalInstructions && <p>{project.creationBrief.additionalInstructions}</p>}</div>}
              {research.category === "Fiksi" ? <div className="references-card"><p className="source-warning">Fiksi tidak memakai review klaim atau sitasi faktual. Tinjau naskah, continuity, audio, dan visual secara manual sebelum render.</p></div> : <>
                <ReferencesEditor references={research.references} onChange={updateResearchReferences} />
                <div className="references-card"><p className="source-warning">Status fakta: <b>{project.researchReviewStatus === "verified-by-author" ? "Ditinjau pengguna" : "Belum ditinjau"}</b>. Sumber dan klaim tidak diverifikasi otomatis.</p></div>
              </>}
              {!!researchWarnings(research).length && <div className="workflow-alert attention"><span>{researchWarnings(research).join(" ")}</span></div>}
            </aside>
          </div>}

          {activeStep === "video-editor" && <VideoEditorV2
            research={research}
            storyboard={project.visualStoryboard}
            animationStyleId={project.animationStyleId ?? DEFAULT_ANIMATION_STYLE_ID}
            onAnimationStyleChange={updateProjectAnimationStyle}
            onRegenerateStaleFlowPrompts={regenerateStaleFlowPrompts}
            gate={visualGate!}
            saved={saved}
            busy={busy || project.visualPreparation?.status === "running" || project.motionPreparation?.status === "running"}
            generatingSceneId={generatingVisualSceneId}
            assets={project.visualAssets}
            projectId={project.id}
            outros={outroLibrary.outros}
            outro={project.outro}
            outroAsset={project.outroAsset}
            outroError={project.outroError}
            sceneMediaErrors={sceneMediaErrors}
            audio={project.audio}
            audioMatchesNarration={draftAudioMatches}
            hasPendingAudio={Boolean(project.pendingTts)}
            narrationMode={project.narrationMode}
            selectedSceneId={selectedSceneId}
            onSelectScene={selectScene}
            onTitleChange={(title) => updateResearch((current) => ({ ...current, title }))}
            onOutroChange={updateProjectOutro}
            onOpenOutroLibrary={() => void openSettings("outro-library")}
            onDurationChange={updateSceneDuration}
            onCaptionSegmentsChange={(sceneId, segments) => updateScene(sceneId, (scene) => ({ ...scene, captionSegments: segments }))}
            onOverlaySettingsChange={updateOverlaySettings}
            onBack={() => void goToStep("narration")}
            onOpenNarration={() => void goToStep("narration")}
            onExport={() => void goToStep("review")}
            onSave={() => void saveProject()}
            onChange={updateVisualScene}
            onMotionDirectionChange={(sceneId, motionPlan) => updateScene(sceneId, (current) => ({ ...current, motionCues: motionPlan.map((plan) => plan.cue), motionPlan }))}
            onGenerate={regenerateVisualScene}
            onUseCurrentComposition={useAuthoredComposition}
            onSetSharedVisualWorld={setSharedVisualWorld}
            librarySceneId={librarySceneId}
            onOpenLibrary={(sceneId, tab) => void openVisualLibrary(sceneId, tab)}
            onCloseLibrary={() => setLibrarySceneId(null)}
            onDeleteAsset={(assetId) => void removeVisualAsset(assetId)}
            onUploadAsset={uploadVisualIllustration}
            onUseAsset={(sceneId, assetId, mode) => void selectVisualLibraryAsset(sceneId, assetId, mode)}
            onApplyGeneratedAiImage={(sceneId, asset, fit) => void applyGeneratedAiImage(sceneId, asset, fit)}
            onImportOpenverse={(sceneId, image, mode) => void importOpenverseAsset(sceneId, image, mode)}
            onImportTabler={(sceneId, icon, mode) => void importTablerAsset(sceneId, icon, mode)}
            onUseReusableScene={(sceneId, reusable) => void useReusableScene(sceneId, reusable)}
            onSaveReusableScene={saveReusableScene}
            onConfirmUserAsset={confirmUploadedIllustration}
            aiMode={aiGenerationSettings?.mode ?? null}
            plannerAvailable={Boolean(aiGenerationSettings && (aiGenerationSettings.mode === "development"
              ? aiGenerationSettings.providers.development.models.some((model) => model.id === visualPlannerModel)
              : aiGenerationSettings.providers.production.configured))}
            models={aiGenerationSettings?.providers.development.models.map((model) => ({ id: model.id, name: model.name })) ?? []}
            selectedModel={visualPlannerModel}
            onSelectModel={setVisualPlannerModel}
            planningSceneId={planningVisualSceneId}
            onPlan={planVisualScene}
            vectorAvailable={Boolean(aiGenerationSettings?.mode === "development" && aiGenerationSettings.providers.development.models.some((model) => model.id === visualPlannerModel))}
            vectorizingSceneId={vectorizingVisualSceneId}
            onGenerateVector={generateVectorScene}
            onPrepareIssues={(sceneIds) => void prepareVisualScenes(sceneIds)}
            onGenerateMotion={generateSceneMotion}
            onMotionBeatPreset={applyMotionBeatPreset}
            onPrepareMotion={(intensity) => void prepareMotionScenes(intensity)}
            onCancelMotion={() => void cancelMotionScenes()}
            onRetryMotion={(sceneIds, intensity) => void prepareMotionScenes(intensity, sceneIds)}
            onSelectAiImageSource={selectAiImageSource}
            onGenerateAiImage={generateAiImage}
            onFlowPromptChange={saveFlowPrompt}
            onFlowVisualModeChange={(sceneId, mode) => updateVisualScene(sceneId, { flowVisualMode: mode })}
            onRemoveSceneMedia={(sceneId) => void removeFlowSceneMedia(sceneId)}
            onStyleLockChange={saveFlowStyleLock}
            onPrepareFlowPrompts={prepareFlowPrompts}
            onApplyStyleLock={(prompts) => void applyFlowStyleLock(prompts)}
            onUploadFlowReference={uploadFlowReference}
            onImportFlowIllustration={uploadVisualIllustration}
            onPrepareSceneMedia={prepareFlowSceneMedia}
            onApplySceneMedia={applyFlowSceneMedia}
            onApplyFlowBatch={applyFlowBatch}
            imageProviderCatalog={aiImageProviders}
            preparation={project.visualPreparation}
            motionPreparation={project.motionPreparation}
            libraryInitialTab={libraryInitialTab}
          />}

          {activeStep === "narration" && <div className="workspace-step-content single narration-step">
            <div className="audio-step-intro"><strong>{project.audio ? `Audio aktif · ${project.audio.source === "tts" ? project.audio.tts?.voiceName ?? "AI Voice" : project.audio.name}` : project.narrationMode === "manual" ? "Mode durasi manual aktif" : "Belum ada audio aktif"}</strong><span>Kandidat AI Voice tidak mengganti audio aktif sampai Anda menyetujuinya. Membuka langkah ini tidak menjalankan synthesis.</span></div>
            {!narrationScript(research) && <div className="workflow-alert attention" role="status"><span>Lengkapi narasi pada setiap scene di Materi & Storyboard sebelum membuat TTS atau mengunggah audio.</span><button type="button" onClick={() => void goToStep("materials")}>Edit storyboard</button></div>}
            <section className="audio-source-card">
              <div className="audio-source-tabs" role="group" aria-label="Sumber voice-over">
                <button type="button" aria-pressed={audioMode === "ai"} className={audioMode === "ai" ? "selected" : ""} onClick={() => { setAudioMode("ai"); setTtsMessage(""); }}>Generate dengan AI Voice</button>
                <button type="button" aria-pressed={audioMode === "upload"} className={audioMode === "upload" ? "selected" : ""} onClick={() => setAudioMode("upload")}>Upload audio sendiri</button>
              </div>
              {audioMode === "ai" ? <TtsPanel
                project={project}
                script={narrationScript(research)}
                voices={ttsVoices}
                loading={ttsLoading}
                busy={ttsBusy || busy}
                saved={saved}
                locale={ttsLocale}
                gender={ttsGender}
                voiceId={ttsVoiceId}
                rate={ttsRate}
                style={ttsStyle}
                message={ttsMessage}
                testPreview={testVoicePreview}
                onLocale={(value) => { setTestVoicePreview(null); setTtsVoices(null); setTtsLocale(value); setTtsGender("All"); setTtsVoiceId(""); }}
                onGender={(value) => {
                  setTtsGender(value);
                  const choices = ttsVoices?.voices.filter((voice) => value === "All" || voice.gender === value) ?? [];
                  const next = choices.some((voice) => voice.id === ttsVoiceId) ? ttsVoiceId : choices[0]?.id ?? "";
                  if (next !== ttsVoiceId) setTestVoicePreview(null);
                  setTtsVoiceId(next);
                }}
                onVoice={(value) => {
                  setTestVoicePreview(null);
                  setTtsVoiceId(value);
                  const selected = ttsVoices?.voices.find((voice) => voice.id === value);
                  setTtsGender(selected && selected.gender !== "Unknown" ? selected.gender : "All");
                }}
                onRate={(value) => { setTestVoicePreview(null); setTtsRate(value); }}
                onStyle={(value) => { setTestVoicePreview(null); setTtsStyle(value); }}
                onLoadVoices={() => void loadTtsVoices()}
                onGenerate={(force) => void generateTts(force)}
                onTest={() => void testVoice()}
                onApprove={() => void approveTts()}
                onRemove={() => void removeAudio()}
              /> : <UploadPanel project={project} busy={busy} canUpload={Boolean(narrationScript(research))} onUpload={(file) => void uploadAudio(file)} onRemove={() => void removeAudio()} />}
            </section>
            {!project.audio && <div className="manual-narration-choice"><div><strong>Tanpa narasi?</strong><span>Gunakan durasi manual dari storyboard dan edit timing di Video Editor. Tidak ada request TTS.</span></div><button type="button" className={`button ${project.narrationMode === "manual" ? "button-light" : "button-primary"}`} onClick={() => void chooseManualTiming()} disabled={busy || project.narrationMode === "manual"}>{project.narrationMode === "manual" ? "Durasi manual dipilih" : "Gunakan durasi manual"}</button></div>}
          </div>}

          {activeStep === "review" && <ReviewStep
            research={visualResearch!}
            project={project}
            storyboard={project.visualStoryboard}
            onEditScene={(id) => { selectScene(id); void goToStep("video-editor"); }}
            onEditReferences={() => void goToStep("materials")}
            onEditNarration={() => void goToStep("narration")}
            onReview={(value) => void setReview(value)}
          />}

          {activeStep === "preview" && <div className="interactive-preview">
            <div className="interactive-preview-player">{project.outroError || project.outro?.enabled && (!project.outroAsset || !project.outroAsset.localAvailable)
              ? <div className="workflow-alert danger" role="alert">{project.outroError ?? "Outro aktif hilang dari local storage. Tidak ada fallback; perbaiki Outro Video di Video Editor."}</div>
              : <div className="player-wrap">
              <Player<AnyZodObject, VideoProps>
                ref={previewPlayer}
                component={VersionedVideo}
                inputProps={previewInputProps(visualResearch!, project.audio?.file, project.audio?.durationSec, project.audio?.timingMode, RENDERER_VERSION, renderOutro(project.outro, project.outroAsset))}
                durationInFrames={durationInFrames(research, project.audio?.durationSec, project.audio?.timingMode, project.outro)}
                compositionWidth={1080}
                compositionHeight={1920}
                fps={30}
                controls
                loop
                style={{ width: "100%", aspectRatio: "9 / 16", maxHeight: "min(68vh, 760px)" }}
              />
            </div>}</div>
            <aside className="interactive-preview-note">
              <span className="preview-live"><i /> DRAFT LIVE</span>
              <h3>Preview interaktif</h3>
              <p>Memutar storyboard dan audio aktif saat ini. Perubahan draft tampil langsung; belum membuat snapshot, render job, atau memakai quota produksi.</p>
              <div className="preview-audio-state"><strong>{project.audio ? "Audio aktif" : "Tanpa narasi"}</strong><span>{project.audio ? `${project.audio.name} · ${project.audio.durationSec.toFixed(1)} dtk` : "Render final senyap tetap meminta konfirmasi."}</span></div>
              {!saved && <div className="workflow-alert attention" role="status"><span>Draft belum disimpan. Preview memakai perubahan lokal saat ini.</span></div>}
              {previewReviewed && <div className="workflow-alert success" role="status"><span>Preview sudah ditinjau untuk draft ini.</span></div>}
              <button type="button" className="button button-primary full-button" onClick={completePreviewReview} disabled={!previewStarted || previewReviewed}>{previewReviewed ? "✓ Preview ditinjau" : previewStarted ? "Tandai Preview sudah ditinjau" : "Putar Preview untuk mulai review"}</button>
              <small className="preview-caption-note">Status review otomatis kedaluwarsa saat storyboard atau audio berubah.</small>
            </aside>
          </div>}

          {activeStep === "render" && <div className="render-step">
            <div className="render-quota-card"><div><span className="eyebrow">RENDER QUOTA</span><strong>{renderQuotaValue(status, renderMode)}</strong><small>{renderQuotaNote(status, renderMode)}</small></div><span className={`quota-indicator ${status?.ffmpegAvailable ? "ready" : "attention"}`}>{status?.ffmpegAvailable ? "FFMPEG SIAP" : "FFMPEG BELUM SIAP"}</span></div>
            <div className="render-card">
              <div className="render-card-head"><div><span className="render-icon">↗</span><div><strong>Render final MP4</strong><small>{project.latestJob ? `Job ${project.latestJob.id.slice(0, 8)} · renderer v${project.latestJob.rendererVersion} · percobaan ${project.latestJob.attemptCount}/3` : "Snapshot dibuat hanya saat Anda memulai render final."}</small></div></div><span className={`status-chip ${project.latestJob && !project.latestJobContentCurrent ? "failed" : project.latestJob?.state ?? "idle"}`}>{project.latestJob && !project.latestJobContentCurrent ? "SNAPSHOT LAMA" : project.latestJob?.rendererVersion === LEGACY_RENDERER_VERSION ? "RENDERER V1" : jobLabel(project.latestJob?.state)}</span></div>
              {project.latestJob?.state === "rendering" && <div className="progress-track"><i style={{ width: `${project.latestJob.progress}%` }} /></div>}
              {project.latestJob?.manifest && <div className="manifest-line">{project.latestJob.manifest.width}×{project.latestJob.manifest.height} · H.264 · {audioManifestLabel(project.latestJob.manifest)} · {project.latestJob.manifest.durationSec.toFixed(1)} dtk · renderer v{project.latestJob.manifest.rendererVersion ?? project.latestJob.rendererVersion}</div>}
              {project.latestJob?.error && <p className="render-error">{project.latestJob.error}</p>}
               <div className="render-actions"><button type="button" className="button button-primary full-button" onClick={() => void renderFinal()} disabled={busy || project.latestJob?.state === "rendering" || (currentJob?.state === "rendered") || (currentJob?.state === "failed" && currentJob.attemptCount >= 3)}>{busy ? "Render sedang diproses…" : project.latestJob?.state === "rendering" ? `Rendering ${project.latestJob.progress}%` : currentJob?.state === "rendered" ? "Render selesai" : project.latestJob?.rendererVersion === LEGACY_RENDERER_VERSION && project.latestJobContentCurrent ? `Buat snapshot V${RENDERER_VERSION} & render MP4` : project.latestJob && !project.latestJobContentCurrent ? "Render versi terbaru" : "Buat snapshot & render MP4"}<b>→</b></button>
                {project.latestJob?.downloadUrl && <a className="button button-light download-button" href={project.latestJob.downloadUrl}>{project.latestJobContentCurrent ? "Unduh MP4" : "Unduh render sebelumnya"} ↓</a>}
              </div>
              {!project.audio && <p className="audio-warning">Audio belum tersedia. Render senyap hanya berjalan setelah konfirmasi eksplisit.</p>}
              {project.audio?.source === "tts" && !draftAudioMatches && <p className="tts-stale-warning">Naskah berubah setelah AI Voice disetujui. Setujui preview narasi baru sebelum render.</p>}
              <p className="cloud-note">Render berjalan lokal. File MP4 dan manifest tersedia setelah selesai.</p>
            </div>
          </div>}

          {activeStep !== "video-editor" && <div className="workflow-navigation">
            <span>{saved ? "Semua perubahan tersimpan." : "Perubahan tersimpan saat lanjut dari Materi & Storyboard."}</span>
            <div className="workflow-navigation-actions">
              {currentStepIndex > 0 && <button type="button" className="button button-light" onClick={() => void goToStep(workspaceSteps[currentStepIndex - 1]!.id)} disabled={busy}>← Kembali</button>}
              {currentStepIndex < workspaceSteps.length - 1 && <button type="button" className="button button-primary" onClick={() => void goToStep(workspaceSteps[currentStepIndex + 1]!.id)} disabled={busy}>Lanjut <b>→</b></button>}
            </div>
          </div>}
          </>}
        </div>
      </section>}
    </main>
    {confirmation && <ConfirmationDialog key="confirmation" options={confirmation} onResolve={resolveConfirmation} />}
    {ttsTimingPrompt && <TtsTimingDialog options={ttsTimingPrompt} onResolve={resolveTtsTimingDecision} />}
  </div>;
}

function SettingsPage({ section, onSection, status, projects, projectsLoaded, settings, busy, error, onMode, theme, onTheme, outroLibrary, outroLibraryLoaded, outroContent }: {
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
  status: Status | null;
  projects: Project[];
  projectsLoaded: boolean;
  settings: AiGenerationSettings | null;
  busy: boolean;
  error: string;
  onMode: (mode: AiGenerationMode) => void;
  theme: ThemePreference;
  onTheme: (theme: ThemePreference) => void;
  outroLibrary: OutroLibraryState;
  outroLibraryLoaded: boolean;
  outroContent: React.ReactNode;
}) {
  const sectionDetails: Record<SettingsSection, { label: string; description: string; Icon: typeof Info }> = {
    general: { label: "General", description: "A snapshot of your workspace and available tools.", Icon: Info },
    appearance: { label: "Appearance", description: "Choose how AI Facts Studio looks on this device.", Icon: Sun },
    "ai-generation": { label: "AI Generation", description: "Review generation mode and provider availability.", Icon: Sparkles },
    "outro-library": { label: "Outro Library", description: "Manage reusable video outros for new projects.", Icon: Film },
    preferences: { label: "Preferences", description: "Review defaults already used by your projects.", Icon: SlidersHorizontal },
  };
  const defaultOutro = outroLibrary.outros.find((asset) => asset.id === outroLibrary.defaultOutroId);
  const themeName = theme[0]!.toUpperCase() + theme.slice(1);
  const hrefFor = (target: SettingsSection) => appRouteHref({ view: "settings", section: target });
  const followSection = (target: SettingsSection) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onSection(target);
  };
  const activeDetails = sectionDetails[section];
  const ActiveIcon = activeDetails.Icon;

  return <section className="page layout-container settings-page">
    <header className="settings-page-heading">
      <span className="settings-heading-icon"><SettingsIcon aria-hidden="true" size={21}/></span>
      <div><span className="eyebrow">WORKSPACE SETTINGS</span><h1>Settings</h1><p>Manage appearance, AI generation, and project defaults.</p></div>
    </header>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">
        {settingsSections.map((id) => {
          const { label, Icon } = sectionDetails[id];
          return <a key={id} href={hrefFor(id)} className={`settings-nav-item ${section === id ? "active" : ""}`} aria-current={section === id ? "page" : undefined} onClick={followSection(id)}>
            <Icon aria-hidden="true" size={18}/><span>{label}</span>
          </a>;
        })}
      </nav>
      <div className="settings-content">
        {section === "outro-library" ? outroContent : <>
          <header className="settings-section-heading">
            <span className="settings-section-icon"><ActiveIcon aria-hidden="true" size={20}/></span>
            <div><h2>{activeDetails.label}</h2><p>{activeDetails.description}</p></div>
          </header>
          {section === "general" && <div className="settings-overview-grid">
            <article className="settings-overview-card"><span className="settings-overview-icon"><Film aria-hidden="true" size={18}/></span><div><span>Saved projects</span><strong>{projectsLoaded ? projects.length : "Loading…"}</strong><p>Projects currently stored in this workspace.</p></div></article>
            <article className="settings-overview-card"><span className="settings-overview-icon"><SettingsIcon aria-hidden="true" size={18}/></span><div><span>Local media processing</span><strong className={status ? status.ffmpegAvailable ? "available" : "unavailable" : ""}>{status ? status.ffmpegAvailable ? "Available" : "Unavailable" : "Checking…"}</strong><p>FFmpeg availability for local media and rendering.</p></div></article>
            <article className="settings-overview-card"><span className="settings-overview-icon"><Sparkles aria-hidden="true" size={18}/></span><div><span>GitHub Actions workflow</span><strong className={status ? status.githubWorkflowAvailable ? "available" : "unavailable" : ""}>{status ? status.githubWorkflowAvailable ? "Available" : "Unavailable" : "Checking…"}</strong><p>Current availability of the configured export workflow.</p></div></article>
          </div>}
          {section === "appearance" && <AppearanceSettings preference={theme} onChange={onTheme}/>}
          {section === "ai-generation" && <AiGenerationSettingsPanel settings={settings} busy={busy} error={error} onMode={onMode}/>}
          {section === "preferences" && <div className="settings-preference-list">
            <article className="settings-preference-card">
              <span className="settings-overview-icon"><Film aria-hidden="true" size={18}/></span>
              <div><span className="eyebrow">NEW PROJECTS</span><h3>Default outro</h3><strong>{outroLibraryLoaded ? defaultOutro?.name ?? "Tanpa Outro" : "Loading…"}</strong><p>Changing this default does not alter existing projects.</p></div>
              <a className="button button-light" href={hrefFor("outro-library")} onClick={followSection("outro-library")}>Manage Outro Library</a>
            </article>
            <article className="settings-preference-card">
              <span className="settings-overview-icon"><Sun aria-hidden="true" size={18}/></span>
              <div><span className="eyebrow">DISPLAY</span><h3>Appearance preference</h3><strong>{themeName}</strong><p>{theme === "system" ? "Follows your operating system preference." : "Saved in this browser."}</p></div>
              <a className="button button-light" href={hrefFor("appearance")} onClick={followSection("appearance")}>Change appearance</a>
            </article>
          </div>}
        </>}
      </div>
    </div>
  </section>;
}

function AiGenerationSettingsPanel({ settings, busy, error, onMode }: {
  settings: AiGenerationSettings | null;
  busy: boolean;
  error: string;
  onMode: (mode: AiGenerationMode) => void;
}) {
  const development = settings?.providers.development;
  const production = settings?.providers.production;
  const providerGroups = useMemo(() => {
    const groups = new Map<string, OpenCodeModelGroup>();
    for (const model of development?.models ?? []) {
      let group = groups.get(model.providerID);
      if (!group) {
        group = { id: model.providerID, name: model.name.split(" · ", 1)[0]?.trim() || model.providerID, models: [] };
        groups.set(model.providerID, group);
      }
      group.models.push(model);
    }
    return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [development?.models]);
  const modelCount = development?.models.length ?? 0;
  const openCodeStateText = development ? ({
    "server-unreachable": "Server Unreachable",
    "authentication-failed": "Authentication Failed",
    "unsupported-api-version": "Unsupported API Version",
    "model-unavailable": "Model Unavailable",
    connected: "Connected",
  } as const)[development.state] : "Checking";
  return <div className="settings-ai-generation">
    {error && <div className="workflow-alert danger" role="alert">{error}</div>}
    {!settings ? <div className="workflow-empty" role={error ? undefined : "status"}>{error ? "Pengaturan gagal dimuat." : "Memuat pengaturan AI…"}</div> : <>
      <section className="ai-settings-panel">
        <div className="settings-panel-heading"><div><h2>AI Generation Mode</h2><p>Mode disimpan lokal di SQLite; status koneksi OpenCode diperiksa backend.</p></div><span className={`settings-mode-badge ${settings.mode}`}>{settings.mode === "development" ? "DEVELOPMENT" : "PRODUCTION"}</span></div>
        <div className="ai-mode-switch" role="radiogroup" aria-label="AI Generation Mode">
          <button type="button" role="radio" aria-checked={settings.mode === "development"} className={settings.mode === "development" ? "selected" : ""} onClick={() => onMode("development")} disabled={busy}>
            <strong>Development</strong><span>OpenCode local · manual fallback</span>
          </button>
          <button type="button" role="radio" aria-checked={settings.mode === "production"} className={settings.mode === "production" ? "selected" : ""} onClick={() => onMode("production")} disabled={busy || !production?.configured}>
            <strong>Production</strong><span>Gemini Developer API · backend only</span>
          </button>
        </div>
        <p className="settings-persistence-note">Mengubah mode tidak mengubah project, storyboard, approval audio, snapshot, atau render.</p>
      </section>

      <div className="ai-provider-grid">
        <section className={`ai-provider-card ${settings.mode === "development" ? "active" : ""}`}>
          <div className="ai-provider-card-head"><div><span className="eyebrow">DEVELOPMENT</span><h2>OpenCode local</h2></div></div>
          <p>Generate memakai satu model authorized yang dipilih di Create Video. Tiap request memakai isolated OpenCode server, session sementara, dan tools dinonaktifkan.</p>
          <div className="opencode-summary" aria-label="Ringkasan status OpenCode">
            <div className="opencode-summary-item"><span>Status</span><strong><i className={development?.connected ? "connected" : ""} aria-hidden="true" />{openCodeStateText}</strong></div>
            <div className="opencode-summary-item"><span>Server / API</span><strong>{development?.version ? `${development.version} · ${development.apiVersion?.toUpperCase()} API` : "—"}</strong></div>
            <div className="opencode-summary-item"><span>Provider terhubung</span><strong>{providerGroups.length}</strong></div>
            <div className="opencode-summary-item"><span>Model tersedia</span><strong>{modelCount}</strong></div>
          </div>
          <div className="opencode-provider-groups" aria-label="Model berdasarkan provider">
            {providerGroups.length ? providerGroups.map((group) => <OpenCodeProviderModels key={group.id} group={group} />) : <p className="opencode-model-empty">Tidak ada model authorized.</p>}
          </div>
          {!development?.configured && <div className="workflow-alert attention" role="status">{development?.disabledReason ?? "OpenCode lokal belum dikonfigurasi."} Atur URL loopback dan Basic auth di environment backend.</div>}
          <small>Set <code>OPENCODE_SERVER_URL</code>, <code>OPENCODE_SERVER_USERNAME</code>, dan <code>OPENCODE_SERVER_PASSWORD</code>. Manual prompt/paste JSON tetap tersedia di Advanced pada Create Video.</small>
        </section>

        <section className={`ai-provider-card ${settings.mode === "production" ? "active" : ""}`}>
          <div className="ai-provider-card-head"><div><span className="eyebrow">PRODUCTION</span><h2>Gemini Text API</h2></div><span className={`settings-status-pill ${production?.configured ? "configured" : "unconfigured"}`}>{production?.configured ? "Configured" : "Unconfigured"}</span></div>
          <p>Generator Research & Storyboard memakai model teks Gemini allowlisted; Visual Director terpisah. Tidak ada model fallback.</p>
          <dl className="ai-config-details">
            <div><dt>Text model</dt><dd>{production?.model ?? "Belum dikonfigurasi"}</dd></div>
            <div><dt>Backend API key</dt><dd>{production?.apiKeyConfigured ? "Terbaca · rahasia disembunyikan" : "Tidak terbaca"}</dd></div>
            <div><dt>Free Tier guard</dt><dd>{production?.freeTierOnly ? "Aktif" : "Tidak aktif"}</dd></div>
            <div><dt>Model allowlist</dt><dd>{production?.allowedModels.join(" · ")}</dd></div>
            <div><dt>Batas lokal aplikasi</dt><dd>{production ? `${production.requestsUsed}/${production.dailyLimit} per rolling 24 jam · ${production.requestsRemaining} tersisa` : "—"}</dd></div>
          </dl>
          {production && <GeminiTextQuotaSummary production={production} />}
          {!production?.configured && <div className="workflow-alert attention" role="status">{production?.disabledReason ?? "Gemini Text belum dikonfigurasi."}</div>}
          {production?.configured && <div className="settings-provider-note">Konfigurasi lokal lengkap; koneksi/model belum diuji. Tidak ada paid-model fallback.</div>}
          <small>API key hanya dibaca backend dari <code>GEMINI_API_KEY</code>; tidak ditampilkan atau disimpan di browser/SQLite. Text model dan quota terpisah dari TTS.</small>
        </section>
      </div>

        <div className="ai-settings-footnote"><strong>Generate hanya setelah klik eksplisit.</strong><span>Development mengirim input ke OpenCode lokal dan model terpilih; biaya provider mengikuti akun OpenCode. Production memakai Gemini guard/quota. Keduanya tidak melakukan fact-check independen.</span></div>
    </>}
  </div>;
}

function OpenCodeProviderModels({ group }: { group: OpenCodeModelGroup }) {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const panelId = useId();
  const filteredModels = useMemo(() => {
    if (!expanded) return [];
    const query = search.trim().toLocaleLowerCase();
    if (!query) return group.models;
    return group.models.filter((model) => `${model.name} ${model.id} ${model.modelID}`.toLocaleLowerCase().includes(query));
  }, [expanded, group.models, search]);

  return <section className={`opencode-provider-group ${expanded ? "expanded" : ""}`}>
    <button type="button" className="opencode-provider-toggle" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded((value) => !value)}>
      <span className="opencode-provider-copy"><strong>{group.name}</strong><small>{group.models.length} model</small></span>
      <svg className="opencode-provider-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
    </button>
    <div id={panelId} className="opencode-provider-panel" hidden={!expanded}>
      {expanded && <>
        <label className="opencode-model-search">
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m12.5 12.5 4 4" /></svg>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Cari model ${group.name}`} aria-label={`Cari model ${group.name}`} />
        </label>
        <ul className="opencode-model-list" aria-label={`${group.name}: ${filteredModels.length} model`}>
          {filteredModels.map((model) => {
            const prefix = `${group.name} · `;
            const label = model.name.startsWith(prefix) ? model.name.slice(prefix.length) : model.name;
            return <li key={model.id}><span>{label}</span><code>{model.modelID}</code></li>;
          })}
          {!filteredModels.length && <li className="opencode-model-no-results">Model tidak ditemukan.</li>}
        </ul>
      </>}
    </div>
  </section>;
}

function ConfirmationDialog({ options, onResolve }: { options: PendingConfirmation; onResolve: (confirmed: boolean) => Promise<void> }) {
  const cancelButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const optionsRef = useRef(options);
  const onResolveRef = useRef(onResolve);
  optionsRef.current = options;
  onResolveRef.current = onResolve;
  const ConfirmationIcon = options.tone === "danger" ? CircleAlert : options.tone === "warning" ? TriangleAlert : Info;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (optionsRef.current.pending) return;
        void onResolveRef.current(false);
      } else if (event.key === "Tab") {
        const active = document.activeElement;
        const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])') ?? [])].filter((element) => !element.closest("[hidden],[inert]") && element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first) { event.preventDefault(); dialog.current?.focus(); return; }
        if (first && last && (!dialog.current?.contains(active) || (event.shiftKey && active === first) || (!event.shiftKey && active === last))) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  useEffect(() => { if (options.pending) dialog.current?.focus(); }, [options.pending]);

  return <div className="confirm-backdrop" onMouseDown={(event) => { if (!options.pending && event.target === event.currentTarget) void onResolve(false); }}>
    <section ref={dialog} tabIndex={-1} className="confirm-dialog" role={options.tone === "primary" || !options.tone ? "dialog" : "alertdialog"} aria-modal="true" aria-busy={options.pending || undefined} aria-labelledby="confirm-title" aria-describedby="confirm-message">
      <div className={`confirm-symbol ${options.tone === "danger" ? "danger" : options.tone === "warning" ? "warning" : ""}`} aria-hidden="true"><ConfirmationIcon size={20} strokeWidth={2} /></div>
      <div className="confirm-copy"><span className="confirm-eyebrow">KONFIRMASI</span><h2 id="confirm-title">{options.title}</h2><p id="confirm-message">{options.message}</p></div>
      {options.content && <div className="confirm-content">{options.content}</div>}
      {options.error && <p className="confirm-error" role="alert">{options.error}</p>}
      <div className="confirm-actions">
        <button ref={cancelButton} className="confirm-cancel" onClick={() => void onResolve(false)} disabled={options.pending}>{options.cancelLabel ?? "Batal"}</button>
        <button ref={confirmButton} className={`confirm-submit ${options.tone === "danger" ? "danger" : ""}`} onClick={() => void onResolve(true)} disabled={options.pending}>{options.pending && <span className="confirm-spinner" aria-hidden="true" />}{options.pending ? "Memproses…" : options.confirmLabel}</button>
      </div>
    </section>
  </div>;
}

function TtsTimingDialog({ options, onResolve }: { options: PendingTtsTiming; onResolve: (choice: TtsTimingChoice) => void }) {
  const dialog = useRef<HTMLElement>(null);
  const retimeButton = useRef<HTMLButtonElement>(null);
  const onResolveRef = useRef(onResolve);
  onResolveRef.current = onResolve;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    retimeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onResolveRef.current("cancel");
      } else if (event.key === "Tab") {
        const focusable = [...(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const first = focusable[0];
        const last = focusable.at(-1);
        if (first && last && (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  return <div className="confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onResolve("cancel"); }}>
    <section ref={dialog} tabIndex={-1} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="tts-timing-title" aria-describedby="tts-timing-message">
      <div className="confirm-symbol warning" aria-hidden="true"><Clock3 size={20} /></div>
      <div className="confirm-copy"><span className="confirm-eyebrow">DURASI NARASI BERUBAH</span><h2 id="tts-timing-title">Pilih cara mengatur timeline</h2><p id="tts-timing-message">{options.hadActiveAudio ? "Audio aktif tetap dipakai sampai pilihan disimpan. " : "Timeline saat ini tetap dipakai sampai pilihan disimpan. "}Durasi berubah dari {options.previousDurationSec.toFixed(1)} menjadi {options.nextDurationSec.toFixed(1)} detik.</p></div>
      <div className="confirm-content"><p><strong>Retiming scene</strong> menghitung ulang durasi berbobot dari naskah dan mempertahankan visual, Motion Beat, serta approval.</p><p><strong>Pertahankan timeline</strong> memakai durasi scene saat ini; audio baru mungkin lebih pendek atau panjang.</p></div>
      <div className="confirm-actions">
        <button className="confirm-cancel" onClick={() => onResolve("cancel")}>Batal</button>
        <button className="confirm-cancel" onClick={() => onResolve("keep-timeline")}>Pertahankan timeline</button>
        <button ref={retimeButton} className="confirm-submit" onClick={() => onResolve("retime")}>Retiming scene</button>
      </div>
    </section>
  </div>;
}

function renderQuotaValue(status: Status | null, mode: AiGenerationMode | null) {
  if (!status || !mode) return "Memuat quota…";
  return mode === "development" ? "Render Lokal — Unlimited" : `${status.jobsUsed}/${status.dailyLimit} job per 24 jam`;
}

function renderQuotaNote(status: Status | null, mode: AiGenerationMode | null) {
  if (!status || !mode) return "Memuat status render.";
  if (mode === "development") return "Job lokal tetap dicatat; kuota harian tidak diterapkan.";
  return status.nextAllowedAt
    ? `Slot berikutnya ${new Date(status.nextAllowedAt).toLocaleString("id-ID")}`
    : "Kuota 24 jam bergulir; job Development tetap dihitung.";
}

function Dashboard({ projects, loading, busy, onSample, onOpen, onDelete }: { projects: Project[]; loading: boolean; busy: boolean; onSample: () => void; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const visibleProjects = projects.filter((item) => item.researchPackage.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <section className="page layout-container dashboard-page">
    <div className="dashboard-heading"><div><div className="eyebrow">AI FACTS STUDIO · CREATIVE WORKSPACE</div><h1>Project Saya</h1><p>Buat video baru atau lanjutkan storyboard yang tersimpan.</p></div><span className="project-total">{loading ? "Memuat project…" : `${projects.length} ${projects.length === 1 ? "project" : "projects"}`}</span></div>
    <div className="project-toolbar">
      <label className="project-search"><Search aria-hidden="true" size={17} /><input type="search" aria-label="Cari project" placeholder="Cari project…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      {!loading && !projects.length && <button type="button" className="button button-light" onClick={onSample} disabled={busy}><Film aria-hidden="true" size={16} />Coba sample</button>}
    </div>
    {loading ? <div className="project-grid project-grid-loading" role="status" aria-label="Memuat project"><span className="sr-only">Memuat daftar project…</span>{[0, 1, 2].map((key) => <div className="project-card-skeleton" key={key} aria-hidden="true"><span className="project-skeleton-art" /><span className="project-skeleton-info"><i /><b /><b /><small /></span></div>)}</div>
      : visibleProjects.length ? <div className="project-grid">
      {visibleProjects.map((item) => <article className="project-card" key={item.id}>
        <button type="button" className="project-card-open" onClick={() => onOpen(item.id)} disabled={busy} aria-label={`Buka project ${item.researchPackage.title}`}>
          <span className="project-card-art" aria-hidden="true"><Film size={26} strokeWidth={1.7} /><small>9:16 · VIDEO</small></span>
          <span className="project-card-info">
             <span className="project-card-status"><span className={`status-chip ${item.latestJob && !item.latestJobContentCurrent ? "failed" : item.latestJob?.state ?? "idle"}`}>{item.latestJob && !item.latestJobContentCurrent ? "SNAPSHOT LAMA" : jobLabel(item.latestJob?.state)}</span><span>{item.researchPackage.category}</span>{(item.creationMode === "manual" || item.creationMode === "ai-generated") && <span className="creation-origin-chip">{item.creationMode === "manual" ? "MANUAL" : "AI"}</span>}</span>
            <strong>{item.researchPackage.title}</strong>
            <span className="project-card-meta"><span><Film size={14} aria-hidden="true" />{item.researchPackage.scenes.length} scene</span><span><Clock3 size={14} aria-hidden="true" />{(item.latestJob?.manifest?.durationSec ?? item.researchPackage.targetDurationSec).toFixed(0)} dtk</span></span>
            <small>Diperbarui {new Date(item.updatedAt).toLocaleDateString("id-ID")}</small>
          </span>
          <span className="project-card-arrow" aria-hidden="true">→</span>
        </button>
        <button type="button" className="project-card-delete" onClick={() => onDelete(item.id)} disabled={busy} aria-label={`Hapus ${item.researchPackage.title}`} title="Hapus project"><Trash2 size={16} aria-hidden="true" /></button>
      </article>)}
    </div> : projects.length ? <div className="project-empty filtered-empty"><Search size={22} aria-hidden="true" /><strong>Tidak ada project yang cocok</strong><span>Coba kata kunci lain.</span></div>
      : <div className="project-empty"><span className="project-empty-icon"><Sparkles size={22} aria-hidden="true" /></span><strong>Belum ada project</strong><span>Project video akan muncul di sini setelah Anda membuatnya.</span><button type="button" className="button button-light" onClick={onSample} disabled={busy}><Film size={16} aria-hidden="true" />Buka sample video</button></div>}
  </section>;
}

function TtsPanel({ project, script, voices, loading, busy, saved, locale, gender, voiceId, rate, style, message, testPreview, onLocale, onGender, onVoice, onRate, onStyle, onLoadVoices, onGenerate, onTest, onApprove, onRemove }: {
  project: Project;
  script: string;
  voices: TtsVoices | null;
  loading: boolean;
  busy: boolean;
  saved: boolean;
  locale: string;
  gender: string;
  voiceId: string;
  rate: number;
  style: string;
  message: string;
  testPreview: TtsPreview | null;
  onLocale: (locale: string) => void;
  onGender: (gender: string) => void;
  onVoice: (voiceId: string) => void;
  onRate: (rate: number) => void;
  onStyle: (style: string) => void;
  onLoadVoices: () => void;
  onGenerate: (regenerate: boolean) => void;
  onTest: () => void;
  onApprove: () => void;
  onRemove: () => void;
}) {
  const availableGenders = ["All", ...new Set(voices?.voices.map((voice) => voice.gender) ?? [])];
  const visibleVoices = voices?.voices.filter((voice) => gender === "All" || voice.gender === gender) ?? [];
  const selectedVoice = voices?.voices.find((voice) => voice.id === voiceId);
  return <div className="tts-panel">
    <div className="tts-panel-heading"><div className="audio-icon"><Sparkles size={19} aria-hidden="true" /></div><div className="tts-panel-heading-copy"><strong>AI Voice</strong><span>Gabungkan narrationText tiap scene, lalu dengarkan preview sebelum disetujui.</span><small>{voices?.providerName ?? "Google Gemini TTS"} · {voices?.model ?? "gemini-3.8-flash-lite-tts"}</small></div></div>
    {!voices && !loading && <div className="tts-consent-note">Voice catalog belum dimuat. Audio aktif tetap bisa dipakai tanpa synthesis; pilih Muat daftar Voice hanya jika ingin membuat/mengubah narasi.</div>}
    {voices && !voices.configured && !loading && <div className="tts-config-notice"><strong>Gemini Free Tier belum dibuka</strong><span>Set <code>GEMINI_API_KEY</code> dan <code>GEMINI_TTS_FREE_TIER_ONLY=true</code> setelah pastikan Google project tidak menautkan billing. Model berbayar tidak akan dipakai sebagai fallback.</span><a href="/api/docs/tts" target="_blank" rel="noreferrer">Buka panduan konfigurasi ↗</a></div>}
    {voices?.configured && <div className="tts-consent-note">Test Voice mengirim contoh singkat; naskah storyboard dikirim hanya setelah Preview Narasi Lengkap. Gemini Free Tier dapat memakai input/output untuk peningkatan produk. Pastikan project tetap tier Free. <a href="https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash-lite-tts" target="_blank" rel="noreferrer">Kuota & harga ↗</a></div>}
    {voices?.message && <div className="tts-error">{voices.message}</div>}
    {voices?.catalogSource === "fallback" && <div className="tts-consent-note tts-fallback-warning" role="status">{voices.catalogWarning} Gender opsional. Generate tetap memvalidasi model dan dapat gagal bila project tidak menyediakan voice.</div>}
    <div className="tts-fields">
      <label className="tts-language-field">Bahasa<select aria-label="Bahasa voice" value={locale} onChange={(event) => onLocale(event.target.value)} disabled={loading || busy}>
        {(voices?.locales.length ? voices.locales : [{ locale: "id-ID", localeName: "Bahasa Indonesia" }]).map((item) => <option key={item.locale} value={item.locale}>{item.localeName} ({item.locale})</option>)}
      </select></label>
      <div className="tts-field-row tts-voice-fields">
        <label>Gender filter<select aria-label="Filter gender voice (opsional)" value={gender} onChange={(event) => onGender(event.target.value)} disabled={loading || busy}>
          {availableGenders.map((value) => <option key={value} value={value}>{value === "All" ? "Semua (opsional)" : value === "Unknown" ? "Tidak diketahui" : value}</option>)}
        </select></label>
      <label>Voice<select aria-label="Voice AI" value={voiceId} onChange={(event) => onVoice(event.target.value)} disabled={loading || busy || !visibleVoices.length}>
          {visibleVoices.length ? visibleVoices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name} · {voice.gender}</option>) : <option value="">{loading ? "Memuat voice…" : "Katalog voice kosong"}</option>}
        </select></label>
      </div>
      <label className="tts-style-field">Gaya bicara<select aria-label="Gaya bicara AI" value={style} onChange={(event) => onStyle(event.target.value)} disabled={busy}>
        <option value="documentary">Dokumenter informatif</option><option value="neutral">Netral</option><option value="warm">Hangat</option><option value="energetic">Energik</option><option value="calm">Tenang</option>
      </select></label>
      <label className="rate-control tts-rate-field">Speaking pace · arahan prompt <strong>{rate.toFixed(1)}×</strong><input type="range" min="0.7" max="1.3" step="0.1" value={rate} onChange={(event) => onRate(Number(event.target.value))} disabled={busy} /><span><small>Lebih lambat</small><small>Lebih cepat · perkiraan</small></span></label>
    </div>
    <div className="tts-actions tts-test-actions"><button className="button button-light" onClick={onLoadVoices} disabled={busy || loading}>{loading ? "Memuat daftar voice…" : voices ? "Muat ulang daftar voice" : "Muat daftar voice"}</button><button className="button button-light" onClick={onTest} disabled={busy || loading || !voices?.configured || !voiceId}>Test Voice · contoh singkat</button></div>
    {testPreview && <div className="tts-audio-preview"><span>Test Voice · {testPreview.voiceName} · {testPreview.durationSec.toFixed(1)} dtk</span><audio controls preload="metadata" src={testPreview.audioUrl} aria-label="Pratinjau Test Voice" /></div>}
    <details className="tts-script"><summary>Naskah TTS · {script.length.toLocaleString("id-ID")} / 6.000 karakter</summary><textarea readOnly rows={4} value={script} aria-label="Naskah gabungan dari scene" /></details>
    {project.audio?.source === "tts" && !project.audioMatchesNarration && <div className="tts-stale-warning">Narration storyboard berubah setelah audio dibuat. Generate ulang sebelum membuat job.</div>}
    {project.pendingTts && <div className="tts-audio-preview pending-tts-preview">
      <strong>Audio preview menunggu approval · {project.pendingTts.durationSec.toFixed(1)} dtk</strong>
      <span>{project.pendingTts.voiceName} · {project.pendingTts.locale} · {project.pendingTts.style} · {project.pendingTts.speakingRate.toFixed(1)}×</span>
      <audio controls preload="metadata" src={project.pendingTts.audioUrl} aria-label="Pratinjau narasi lengkap" />
      {!saved && <span className="tts-stale-warning">Simpan perubahan storyboard sebelum memakai preview ini.</span>}
      {project.pendingTtsMatchesNarration && saved && <button className="button button-primary" onClick={onApprove} disabled={busy}>Gunakan Audio Ini</button>}
      {!project.pendingTtsMatchesNarration && <span className="tts-stale-warning">Naskah berubah. Simpan storyboard, lalu buat preview baru.</span>}
    </div>}
    {project.audio?.source === "tts" && <div className="tts-audio-preview"><span>Audio disetujui · {project.audio.tts?.voiceName ?? "AI Voice"} · {project.audio.tts?.locale} · {project.audio.tts?.style} · {project.audio.tts?.speakingRate.toFixed(1)}× · {project.audio.durationSec.toFixed(1)} dtk{project.audio.tts?.approvedAt ? ` · ${new Date(project.audio.tts.approvedAt).toLocaleString("id-ID")}` : ""}</span><audio controls preload="metadata" src={`/${project.audio.file}`} aria-label="Pratinjau AI Voice terpilih" /><button className="text-button danger-text" onClick={onRemove} disabled={busy}>Lepas audio</button></div>}
    {project.audio?.source === "upload" && <div className="tts-audio-preview"><span>Audio aktif · upload manual · {project.audio.name} · {project.audio.durationSec.toFixed(1)} dtk</span><audio controls preload="metadata" src={`/${project.audio.file}`} aria-label="Pratinjau audio upload terpilih" /></div>}
    {message && <div className={message.includes("selesai") || message.includes("cache") || message.includes("disetujui") ? "tts-success" : "tts-error"} role="status">{message}</div>}
    <div className="tts-actions"><button className="button button-primary" onClick={() => onGenerate(false)} disabled={busy || loading || !voices?.configured || !voiceId || !script.trim()}>{busy ? "Menyiapkan preview…" : "Preview Narasi Lengkap"}</button>
      {(project.pendingTts || project.audio?.source === "tts") && <button className="button button-light" onClick={() => onGenerate(true)} disabled={busy || loading || !voices?.configured || !voiceId}>Regenerate preview</button>}
    </div>
    <p className="tts-limit-note">Kuota TTS rolling 24 jam: {voices?.requestsRemaining ?? "—"}/{voices?.dailyLimit ?? 10} tersisa; maks 3 synthesis per teks/setting. Cache dipakai ulang, tidak memakai slot job video. Audio aktif hanya setelah pilih Gunakan Audio Ini.</p>
    {selectedVoice && <span className="sr-only">{selectedVoice.gender}, {selectedVoice.locale}, {selectedVoice.wordsPerMinute} kata/menit</span>}
  </div>;
}

function UploadPanel({ project, busy, canUpload, onUpload, onRemove }: { project: Project; busy: boolean; canUpload: boolean; onUpload: (file?: File) => void; onRemove: () => void }) {
  return <div className="upload-panel">
    <div className="audio-card">
      <div className="audio-icon">♫</div><div className="audio-copy"><strong>{project.audio?.name ?? "Voice-over manual"}</strong><small>{project.audio ? `${project.audio.durationSec.toFixed(1)} detik · ${formatBytes(project.audio.bytes)}` : "MP3, WAV, M4A · maks 100 MB / 120 detik"}</small></div>
      <label className="button button-light upload-button">{project.audio ? "Ganti" : "Pilih audio"}<input type="file" accept="audio/mpeg,audio/wav,audio/mp4,.mp3,.wav,.m4a" disabled={busy || !canUpload} onChange={(event) => onUpload(event.target.files?.[0])} /></label>
    </div>
    {project.audio && <div className="tts-audio-preview"><span>Pratinjau voice-over</span><audio controls preload="metadata" src={`/${project.audio.file}`} aria-label="Pratinjau audio upload" /><button className="text-button danger-text" onClick={onRemove} disabled={busy}>Lepas</button></div>}
    {!canUpload && <p className="workflow-empty">Isi narasi semua scene sebelum mengunggah audio.</p>}
    <p className="upload-note">Audio di-probe dengan ffprobe. Timing awal memakai estimasi berbobot dari naskah; koreksi manual tersedia di Edit Video.</p>
  </div>;
}

type ReferenceFields = Pick<ResearchReference, "title" | "publisher" | "url">;
const emptyReferenceFields: ReferenceFields = { title: "", publisher: "", url: "" };

function ReferencesEditor({ references, onChange }: { references: ResearchPackage["references"]; onChange: (references: ResearchPackage["references"]) => void }) {
  const [draft, setDraft] = useState<ReferenceFields>(emptyReferenceFields);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ReferenceFields>(emptyReferenceFields);
  const [error, setError] = useState("");

  function parseReference(fields: ReferenceFields, id: string) {
    try {
      const url = new URL(fields.url.trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("URL harus memakai HTTP(S) tanpa kredensial.");
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes("HTTP(S)")) throw cause;
      throw new Error("URL sumber tidak valid. Gunakan tautan HTTP atau HTTPS.");
    }
    const parsed = researchReferenceSchema.safeParse({
      id,
      title: fields.title.trim(),
      publisher: fields.publisher.trim(),
      url: fields.url.trim(),
    });
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Referensi tidak valid.");
    return parsed.data;
  }

  function addReference(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (references.length >= 50) { setError("Maksimal 50 referensi per project."); return; }
    try {
      onChange([...references, parseReference(draft, `source-${crypto.randomUUID()}`)]);
      setDraft(emptyReferenceFields);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Referensi tidak valid."); }
  }

  function saveEdit(event: React.FormEvent<HTMLFormElement>, reference: ResearchReference) {
    event.preventDefault();
    try {
      const updated = parseReference(editDraft, reference.id);
      onChange(references.map((item) => item.id === reference.id ? updated : item));
      setEditingId(null);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Referensi tidak valid."); }
  }

  return <section className="references-card">
    <div className="references-heading"><h3>Referensi riset · {references.length}</h3><span>Sumber tidak diverifikasi otomatis.</span></div>
    {references.length ? references.map((reference) => <div className="reference-item" key={reference.id}>
      {editingId === reference.id ? <form className="reference-form" onSubmit={(event) => saveEdit(event, reference)}>
        <label><span>Judul sumber</span><input required maxLength={200} value={editDraft.title} onChange={(event) => setEditDraft((current) => ({ ...current, title: event.target.value }))} /></label>
        <label><span>Penerbit</span><input required maxLength={120} value={editDraft.publisher} onChange={(event) => setEditDraft((current) => ({ ...current, publisher: event.target.value }))} /></label>
        <label><span>URL</span><input required type="url" maxLength={2048} value={editDraft.url} onChange={(event) => setEditDraft((current) => ({ ...current, url: event.target.value }))} /></label>
        <div><button type="submit" className="button button-primary button-small">Simpan referensi</button><button type="button" className="button button-light button-small" onClick={() => { setEditingId(null); setError(""); }}>Batal</button></div>
      </form> : <>
        <strong>{reference.title}</strong><small>{reference.publisher} · {reference.checkedAt ? `ditinjau ${reference.checkedAt}` : "belum ditinjau"}</small><a href={reference.url} target="_blank" rel="noreferrer">Buka sumber ↗</a>
        <div className="reference-actions"><button type="button" className="button button-light button-small" onClick={() => { setEditingId(reference.id); setEditDraft({ title: reference.title, publisher: reference.publisher, url: reference.url }); setError(""); }}>Edit</button><button type="button" className="button button-light button-small" onClick={() => { onChange(references.filter((item) => item.id !== reference.id)); setError(""); }}>Hapus</button></div>
      </>}
    </div>) : <p className="workflow-empty">Belum ada referensi. Referensi baru berstatus belum ditinjau.</p>}
    <details className="reference-add-details"><summary>Tambah referensi</summary>
      <form className="reference-form" onSubmit={addReference}>
        <label><span>Judul sumber</span><input required maxLength={200} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label>
        <label><span>Penerbit</span><input required maxLength={120} value={draft.publisher} onChange={(event) => setDraft((current) => ({ ...current, publisher: event.target.value }))} /></label>
        <label><span>URL</span><input required type="url" maxLength={2048} placeholder="https://..." value={draft.url} onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))} /></label>
        <button type="submit" className="button button-primary button-small" disabled={references.length >= 50}>Tambah referensi</button>
      </form>
    </details>
    {error && <p className="reference-error" role="alert">{error}</p>}
  </section>;
}

function SceneEditor({ scene, references, onChange, onDelete, deleteDisabled }: { scene: Scene; references: ResearchPackage["references"]; onChange: (change: (scene: Scene) => Scene) => void; onDelete: () => void; deleteDisabled: boolean }) {
  const [compositionDraft, setCompositionDraft] = useState(JSON.stringify(scene.visualComposition, null, 2));
  const [compositionError, setCompositionError] = useState("");

  function editComposition(value: string) {
    setCompositionDraft(value);
    try {
      const parsed = visualCompositionSchema.safeParse(JSON.parse(value));
      if (!parsed.success) { setCompositionError(parsed.error.issues[0]?.message ?? "Komposisi visual tidak valid."); return; }
      const layerIds = new Set(parsed.data.layers.map((layer) => layer.id));
      if (scene.motionPlan.some((plan) => !["all", "scene"].includes(plan.targetLayer) && !layerIds.has(plan.targetLayer))) {
        setCompositionError("Layer ini dipakai motionPlan. Ubah target motionPlan sebelum menghapus layer.");
        return;
      }
      setCompositionError("");
      onChange((current) => ({ ...current, visualComposition: parsed.data }));
    } catch { setCompositionError("JSON komposisi belum lengkap/valid."); }
  }

  function changeNarration(value: string) {
    const next = { ...scene, narrationText: value, captionSegments: undefined };
    onChange(() => next);
  }

  function changeOnScreenText(value: string) {
    const next = { ...scene, onScreenText: value };
    onChange(() => next);
  }

  return <div className="scene-editor">
    <div className="scene-editor-title"><div><span className="eyebrow">EDIT SCENE</span><strong>{scene.id}</strong></div><div className="scene-editor-actions"><span className="template-badge">{scene.templateId}</span><button type="button" className="button button-destructive" onClick={onDelete} disabled={deleteDisabled} aria-label={`Hapus scene ${scene.onScreenText || scene.id}`} title={deleteDisabled ? "Storyboard harus memiliki minimal satu scene" : undefined}><Trash2 size={16} aria-hidden="true"/>Hapus scene</button></div></div>
    <section className="scene-editor-section basic-content-section"><div className="editor-section-heading"><h3>Basic content</h3><p>Teks yang tampil dan dibacakan pada scene ini.</p></div>
      <label><span>On-screen text</span><input maxLength={120} placeholder="Tulis teks utama scene" value={scene.onScreenText} onChange={(event) => changeOnScreenText(event.target.value)} /></label>
      <label><span>Narration / caption</span><textarea rows={3} maxLength={2000} placeholder="Tulis narasi untuk scene ini" value={scene.narrationText} onChange={(event) => changeNarration(event.target.value)} /></label>
    </section>
    <fieldset className="scene-reference-picker"><legend>Sumber klaim</legend>{references.length ? references.map((reference) => <label key={reference.id}><input type="checkbox" checked={scene.referenceIds.includes(reference.id)} onChange={(event) => onChange((current) => ({ ...current, referenceIds: event.target.checked ? [...current.referenceIds, reference.id] : current.referenceIds.filter((id) => id !== reference.id) }))} /><span><strong>{reference.title}</strong><small>{reference.publisher}</small></span></label>) : <small>Tambahkan referensi di panel Referensi Riset.</small>}</fieldset>
    <details className="advanced-editor"><summary><span><strong>Advanced scene controls</strong><small>Arahan visual editorial</small></span><b aria-hidden="true">⌄</b></summary>
      <section className="advanced-scene-section"><div className="editor-section-heading"><h3>Visual direction</h3><p>Catatan editorial; bukan prompt generasi gambar.</p></div>
        <label><span>Deskripsi visual</span><textarea rows={3} maxLength={500} placeholder="Contoh: lapisan batuan terlihat dari samping" value={scene.visualDescription} onChange={(event) => onChange((current) => ({ ...current, visualDescription: event.target.value }))} /></label>
      </section>
      <div className="advanced-technical-controls"><details className="visual-json-editor"><summary>Structured visual · {scene.visualComposition.layers.length} layer</summary><textarea rows={10} spellCheck={false} value={compositionDraft} onChange={(event) => editComposition(event.target.value)} aria-label="JSON visual composition" />{compositionError && <span role="alert">{compositionError}</span>}</details></div>
      <div className="cue-line">SFX metadata · belum diputar <span>{scene.sfxCues.join(" · ") || "none"}</span></div>
    </details>
  </div>;
}

function jobLabel(state?: string) {
  const labels: Record<string, string> = { "preview-ready": "PREVIEW READY", rendering: "RENDERING", rendered: "RENDERED", failed: "FAILED", idle: "DRAFT" };
  return labels[state ?? "idle"] ?? state?.toUpperCase() ?? "DRAFT";
}

function audioManifestLabel(manifest: NonNullable<Job>["manifest"]) {
  if (!manifest) return "audio belum divalidasi";
  if (manifest.audioValidation === "silent-expected") return "Video tanpa narasi · track senyap";
  const source = manifest.audioValidation === "pass-media" ? "Audio klip" : manifest.audioProvider === "mock-gemini" ? "Mock tone (bukan ucapan)" : manifest.audioProvider ? "Gemini TTS" : manifest.audioSource === "upload" ? "Upload manual" : "Audio snapshot";
  const level = manifest.audioMeanVolumeDb === null || manifest.audioMeanVolumeDb === undefined ? "level tidak diukur" : `mean ${manifest.audioMeanVolumeDb.toFixed(1)} dB`;
  const status = manifest.audioValidation === "pass-media" ? "aktif; dengarkan isi/sinkronisasi" : manifest.audioValidation === "pass" ? "non-senyap; dengarkan isi" : manifest.audioValidation === "pass-low-level" ? "non-senyap; level rendah" : "validasi belum tersedia";
  return `${source} · ${manifest.audioCodec?.toUpperCase() ?? "audio"} · ${status} · ${level}`;
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
