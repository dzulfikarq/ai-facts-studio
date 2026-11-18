import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player } from "@remotion/player";
import type { PlayerRef } from "@remotion/player";
import type { AnyZodObject } from "remotion";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Film, ImagePlus, Pause, Play, Plus, RotateCcw, SlidersHorizontal, Trash2, Upload, X } from "lucide-react";
import { applyVisualStoryboard, compositionForVisualScene, illustrationSourceForScene, type VisualQualityGate, type VisualStoryboard, type VisualStoryboardScene } from "../domain/visual-storyboard";
import type { GoogleFlowStyleLock } from "../domain/google-flow";
import { animationStylePromptIsStale, ANIMATION_STYLE_PRESETS, type AnimationStyleId } from "../domain/animation-styles";
import { buildIllustrationPrompt } from "../domain/illustration-prompt";
import { captionSegmentsForScene, captionSegmentsSchema } from "../domain/captions";
import { durationInFrames, FPS, sceneTimes, timelineDuration } from "../domain/timeline";
import { defaultMotionPlan } from "../domain/visual-defaults";
import { visualImageNodes, updateVisualImageNode, type VisualImageNode, type VisualImageTransform, type VisualImageUpdate } from "../domain/visual-composition";
import type { ResearchPackage } from "../domain/research";
import { motionCueIds, motionCuePlanSchema, type MotionCuePlan } from "../domain/visual-composition";
import type { MotionIntensity } from "../domain/motion-director";
import { motionActionSchema } from "../domain/motion-director";
import { isSceneTransitionPlan } from "../video/motion";
import { motionBeatFromAction, updateMotionBeat, type MotionBeat } from "../domain/motion-beats";
import type { VisualAsset } from "../domain/visual-assets";
import type { OpenverseImage, ReusableSceneInput, TablerIconEntry } from "../domain/asset-library";
import type { MotionPreparationJob } from "../domain/motion-preparation";
import type { VisualPreparationJob } from "../domain/visual-preparation";
import type { SceneMedia } from "../domain/scene-media";
import { outroTrimFrames, type OutroLibraryAsset, type OutroSelection } from "../domain/outro";
import { SmartAssetLibraryDialog, type AssetPlacement, type ReusableSceneEntry } from "./SmartAssetLibraryDialog";
import { GoogleFlowPanel, type FlowBatchItem, type FlowBatchProgress } from "./GoogleFlowPanel";
import { visualStyles } from "../video/style-config";
import { VisualCompositionView } from "../video/visual-primitives";
import { VersionedVideo, type VideoProps } from "../video/root";
import { previewInputProps } from "../video/video";
import type { EditorMotionPath, VideoEditorInteractions } from "../video/types";
import "./video-editor-v2.css";

type IllustrationImportInfo = { source: "user-upload" | "ai-generated"; prompt?: string; license: string; provider?: string; model?: string };
type AiImageProviderCatalog = {
  status: "Not Configured" | "Ready" | "Generating" | "Rate Limited" | "Quota Exhausted" | "Failed";
  configured: boolean;
  providers: Array<{ id: string; displayName: string; models: Array<{ id: string; license: string | null }>; selectedModel: string; supportedAspectRatios: string[]; resolutions: string[]; estimatedCost: null; costDisclosure: string }>;
  message: string | null;
  retryAt: string | null;
};
type EditorAudio = { file: string; name: string; durationSec: number; timingMode: "scaled" | "estimated"; source: "upload" | "tts"; tts?: { voiceName: string; locale: string } } | null;
type InspectorTab = "visual" | "motion" | "clip" | "text" | "transition" | "audio";
type MotionBeatPreset = "static" | "gentle" | "pan-zoom" | "process" | "particles";
type MotionEffectCue = Exclude<MotionCuePlan["cue"], "cut" | "dissolve" | "slide-transition" | "wipe">;
type TransitionCue = "cut" | "dissolve" | "slide-transition" | "wipe";
type IllustrationWorkflow = VisualStoryboardScene["illustrationWorkflow"];
type ImageBaseline = VisualImageTransform & Pick<VisualImageNode, "fit" | "position">;

const motionEffects: Array<{ cue: MotionEffectCue; label: string }> = [
  { cue: "fadeIn", label: "Fade In" }, { cue: "slide", label: "Slide" }, { cue: "scale", label: "Scale" }, { cue: "pan", label: "Pan" },
  { cue: "zoom", label: "Zoom" }, { cue: "parallax", label: "Parallax" }, { cue: "reveal", label: "Reveal" }, { cue: "pulse", label: "Pulse" },
];
const motionEasingLabels: Record<MotionCuePlan["easing"], string> = { linear: "Linear", easeIn: "Masuk perlahan", easeOut: "Keluar perlahan", easeInOut: "Masuk-keluar", spring: "Spring" };
const isMotionEffect = (cue: MotionCuePlan["cue"]): cue is MotionEffectCue => cue !== "cut" && cue !== "dissolve" && cue !== "slide-transition" && cue !== "wipe";
const isMotionEffectPlan = (plan: MotionCuePlan) => isMotionEffect(plan.cue) && !isSceneTransitionPlan(plan);

export function VideoEditorV2({ research, storyboard, animationStyleId, onAnimationStyleChange, onRegenerateStaleFlowPrompts, gate, saved, busy, generatingSceneId, assets, projectId, outros, outro, outroAsset, outroError, audio, audioMatchesNarration, hasPendingAudio, narrationMode, selectedSceneId, sceneMediaErrors, imageProviderCatalog, preparation, motionPreparation, aiMode, plannerAvailable, models, selectedModel, planningSceneId, vectorAvailable, vectorizingSceneId, librarySceneId, libraryInitialTab, onChange, onMotionDirectionChange, onTitleChange, onOutroChange, onOpenOutroLibrary, onDurationChange, onCaptionSegmentsChange, onOverlaySettingsChange, onSelectScene, onBack, onOpenNarration, onExport, onSave, onGenerate, onUseCurrentComposition, onSetSharedVisualWorld, onOpenLibrary, onCloseLibrary, onDeleteAsset, onUploadAsset, onUseAsset, onApplyGeneratedAiImage, onImportOpenverse, onImportTabler, onUseReusableScene, onSaveReusableScene, onConfirmUserAsset, onSelectModel, onPlan, onGenerateVector, onPrepareIssues, onGenerateMotion, onMotionBeatPreset, onPrepareMotion, onCancelMotion, onRetryMotion, onSelectAiImageSource, onGenerateAiImage, onFlowPromptChange, onFlowVisualModeChange, onRemoveSceneMedia, onStyleLockChange, onPrepareFlowPrompts, onApplyStyleLock, onUploadFlowReference, onImportFlowIllustration, onPrepareSceneMedia, onApplySceneMedia, onApplyFlowBatch }: {
  research: ResearchPackage;
  storyboard: VisualStoryboard;
  animationStyleId: AnimationStyleId;
  onAnimationStyleChange: (styleId: AnimationStyleId) => void;
  onRegenerateStaleFlowPrompts: () => void;
  gate: VisualQualityGate;
  saved: boolean;
  busy: boolean;
  generatingSceneId: string | null;
  assets: VisualAsset[];
  projectId: string;
  outros: OutroLibraryAsset[];
  outro: OutroSelection | null;
  outroAsset: OutroLibraryAsset | null;
  outroError?: string;
  audio: EditorAudio;
  audioMatchesNarration: boolean;
  hasPendingAudio: boolean;
  narrationMode: "unset" | "audio" | "manual";
  sceneMediaErrors: Record<string, string>;
  selectedSceneId: string | null;
  imageProviderCatalog: AiImageProviderCatalog | null;
  preparation: VisualPreparationJob | null;
  motionPreparation: MotionPreparationJob | null;
  aiMode: "development" | "production" | null;
  plannerAvailable: boolean;
  models: Array<{ id: string; name: string }>;
  selectedModel: string;
  planningSceneId: string | null;
  vectorAvailable: boolean;
  vectorizingSceneId: string | null;
  librarySceneId: string | null;
  libraryInitialTab: "mine" | "scenes";
  onChange: (sceneId: string, change: Partial<VisualStoryboardScene>) => void;
  onMotionDirectionChange: (sceneId: string, motionPlan: MotionCuePlan[]) => void;
  onTitleChange: (title: string) => void;
  onOutroChange: (outro: OutroSelection | null) => void;
  onOpenOutroLibrary: () => void;
  onDurationChange: (sceneId: string, durationSec: number) => void;
  onCaptionSegmentsChange: (sceneId: string, segments: ResearchPackage["scenes"][number]["captionSegments"]) => void;
  onOverlaySettingsChange: (change: Partial<ResearchPackage["videoOverlaySettings"]>) => void;
  onSelectScene: (sceneId: string) => void;
  onBack: () => void;
  onOpenNarration: () => void;
  onExport: () => void;
  onSave: () => void;
  onGenerate: (sceneId: string) => void;
  onUseCurrentComposition: (sceneId: string) => void;
  onSetSharedVisualWorld: (sceneId: string) => void;
  onOpenLibrary: (sceneId: string, tab?: "mine" | "scenes") => void;
  onCloseLibrary: () => void;
  onDeleteAsset: (assetId: string) => void;
  onUploadAsset: (sceneId: string, file: File, metadata: IllustrationImportInfo) => Promise<boolean>;
  onUseAsset: (sceneId: string, assetId: string, placement: AssetPlacement) => void;
  onApplyGeneratedAiImage: (sceneId: string, asset: VisualAsset, fit: "cover" | "contain") => void;
  onImportOpenverse: (sceneId: string, image: OpenverseImage, placement: AssetPlacement) => void;
  onImportTabler: (sceneId: string, icon: TablerIconEntry, placement: AssetPlacement) => void;
  onUseReusableScene: (sceneId: string, scene: ReusableSceneEntry) => void;
  onSaveReusableScene: (sceneId: string, scene: Omit<ReusableSceneInput, "thumbnailDataUrl"> & { thumbnailDataUrl: string }) => Promise<void>;
  onConfirmUserAsset: (sceneId: string) => void;
  onSelectModel: (model: string) => void;
  onPlan: (sceneId: string) => void;
  onGenerateVector: (sceneId: string) => void;
  onPrepareIssues: (sceneIds: string[]) => void;
  onGenerateMotion: (sceneId: string, intensity: MotionIntensity) => void;
  onMotionBeatPreset: (sceneId: string, preset: MotionBeatPreset) => void;
  onPrepareMotion: (intensity: MotionIntensity) => void;
  onCancelMotion: () => void;
  onRetryMotion: (sceneIds: string[], intensity: MotionIntensity) => void;
  onSelectAiImageSource: (sceneId: string) => Promise<boolean>;
  onGenerateAiImage: (sceneId: string, provider: string, model: string, prompt: string, resolution: string) => Promise<VisualAsset | null>;
  onFlowPromptChange: (sceneId: string, prompt: string, generatedAnimationStyleId?: AnimationStyleId | null) => void;
  onFlowVisualModeChange: (sceneId: string, mode: "still-image" | "animated-video") => void;
  onRemoveSceneMedia: (sceneId: string) => void;
  onStyleLockChange: (styleLock: GoogleFlowStyleLock) => void;
  onPrepareFlowPrompts: (prompts: Array<{ sceneId: string; prompt: string }>) => void;
  onApplyStyleLock: (prompts: Array<{ sceneId: string; prompt: string }>) => void;
  onUploadFlowReference: (file: File) => Promise<VisualAsset | null>;
  onImportFlowIllustration: (sceneId: string, file: File, metadata: { source: "ai-generated"; prompt: string; license: string; provider: string; model: string }) => Promise<boolean>;
  onPrepareSceneMedia: (sceneId: string, file: File) => Promise<SceneMedia | null>;
  onApplySceneMedia: (sceneId: string, media: SceneMedia) => Promise<boolean>;
  onApplyFlowBatch: (items: FlowBatchItem[], onProgress: (progress: FlowBatchProgress) => void) => Promise<{ appliedIds: string[]; failures: Array<{ id: string; fileName: string; message: string }> }>;
}) {
  const [tab, setTab] = useState<InspectorTab>("visual");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [videoSettingsOpen, setVideoSettingsOpen] = useState(false);
  const [batchLauncher, setBatchLauncher] = useState<(() => void) | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedMotionBeatRef, setSelectedMotionBeatRef] = useState<{ sceneId: string; actionId: string } | null>(null);
  const [imageBaseline, setImageBaseline] = useState<ImageBaseline | null>(null);
  const [safeGuides, setSafeGuides] = useState(false);
  const [sourceSceneId, setSourceSceneId] = useState<string | null>(null);
  const [selectedMotionCue, setSelectedMotionCue] = useState<MotionEffectCue>("fadeIn");
  const [motionBeatPreset, setMotionBeatPreset] = useState<MotionBeatPreset>("gentle");
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [providers, setProviders] = useState<Record<string, string>>({});
  const [modelsByScene, setModelsByScene] = useState<Record<string, string>>({});
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [imageFits, setImageFits] = useState<Record<string, "cover" | "contain">>({});
  const [candidates, setCandidates] = useState<Record<string, VisualAsset>>({});
  const [generatingImage, setGeneratingImage] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [scenePreviewEnd, setScenePreviewEnd] = useState<number | null>(null);
  const transitionPreviewLock = useRef(false);
  const playerRef = useRef<PlayerRef>(null);
  const selectedSceneRef = useRef(selectedSceneId);
  const lastUiFrame = useRef(0);
  const uploadInput = useRef<HTMLInputElement>(null);
  const motionClipGesture = useRef<{ pointerId: number; actionId: string; startX: number; railWidth: number; startTimeSec: number; timingScale: number } | null>(null);
  const selectedScene = storyboard.scenes.find((scene) => scene.sceneId === selectedSceneId) ?? storyboard.scenes[0]!;
  const staleAnimationPromptCount = storyboard.scenes.filter((scene) => scene.flowVisualMode === "animated-video" && scene.flowPromptMode === "animated-video" && animationStylePromptIsStale(scene.flowPrompt, scene.flowPromptAnimationStyleId, animationStyleId)).length;
  const selectedComposition = useMemo(() => compositionForVisualScene(storyboard, selectedScene), [storyboard, selectedScene]);
  const registerBatchLauncher = useCallback((open: (() => void) | null) => setBatchLauncher(() => open), []);
  const selectedMotionAction = selectedMotionBeatRef?.sceneId === selectedScene.sceneId
    ? selectedScene.motionActions.find((action) => action.id === selectedMotionBeatRef.actionId) ?? selectedScene.motionActions[0]
    : selectedScene.motionActions[0];
  const selectedPathAction = selectedMotionBeatRef?.sceneId === selectedScene.sceneId
    ? selectedScene.motionActions.find((action) => action.id === selectedMotionBeatRef.actionId)
    : undefined;
  const selectedBeat = selectedMotionAction ? motionBeatFromAction(selectedMotionAction) : null;
  const visualResearch = useMemo(() => applyVisualStoryboard(research, storyboard), [research, storyboard]);
  const sourceResearchScene = visualResearch.scenes.find((scene) => scene.id === selectedScene.sceneId)!;
  const sceneImages = useMemo(() => visualImageNodes(selectedComposition), [selectedComposition]);
  const selectedImage = sceneImages.find((entry) => entry.id === selectedImageId) ?? sceneImages[0];
  const selectedAsset = assets.find((asset) => asset.id === selectedImage?.node.asset);
  const mainDurationSec = timelineDuration(research, audio?.durationSec, audio?.timingMode);
  const frameCount = durationInFrames(research, audio?.durationSec, audio?.timingMode, outro);
  const previewDurationSec = frameCount / FPS;
  const outroDurationFrames = outroTrimFrames(outro, FPS);
  const mainDurationFrames = Math.max(1, Math.ceil(mainDurationSec * FPS));
  const outroPreviewError = outroError ?? (outro?.enabled && (!outroAsset || !outroAsset.localAvailable) ? "Outro aktif tidak tersedia di local storage. Tidak ada fallback outro otomatis." : "");
  const currentTime = Math.min(previewDurationSec, frame / FPS);
  const sceneSpan = (scene: ResearchPackage["scenes"][number]) => sceneTimes(research, scene, mainDurationSec, audio?.timingMode);
  const selectedSpan = sceneSpan(sourceResearchScene);
  const scenePreviewFrame = (span: { startSec: number; endSec: number }) => Math.min(frameCount - 1, Math.floor((span.startSec + Math.min(1, (span.endSec - span.startSec) / 2)) * FPS));
  const selectedMediaError = sceneMediaErrors[selectedScene.sceneId];
  const sceneIssueList = [...(gate.scenes[selectedScene.sceneId] ?? []), ...(selectedMediaError ? [selectedMediaError] : [])];
  const hasPrimaryArtwork = sceneHasPrimaryIllustration(selectedScene, storyboard);
  const needsArtwork = !hasPrimaryArtwork;
  const primaryIllustrationsReady = gate.ready && storyboard.scenes.every((scene) => sceneHasPrimaryIllustration(scene, storyboard));
  const illustrationStatus = selectedScene.approved ? "Approved"
    : !hasPrimaryArtwork ? "Perlu Ilustrasi"
      : selectedScene.flowStatus === "illustration-imported" ? "Ilustrasi Diimport"
        : selectedScene.authoringConfirmed ? "Siap Ditinjau" : "Perlu Ditinjau";
  const selectedPrompt = prompts[selectedScene.sceneId] ?? buildIllustrationPrompt({ research, storyboard, scene: selectedScene });
  const providerId = providers[selectedScene.sceneId] ?? imageProviderCatalog?.providers[0]?.id ?? "";
  const provider = imageProviderCatalog?.providers.find((entry) => entry.id === providerId);
  const imageModel = modelsByScene[selectedScene.sceneId] ?? provider?.selectedModel ?? "";
  const imageResolution = resolutions[selectedScene.sceneId] ?? provider?.resolutions[0] ?? "";
  const selectedFit = imageFits[selectedScene.sceneId] ?? "contain";
  const candidate = candidates[selectedScene.sceneId];
  const libraryScene = storyboard.scenes.find((scene) => scene.sceneId === librarySceneId);
  const safe = visualStyles[research.visualPreset].safeArea;
  const captionsAvailable = research.scenes.some((scene) => Boolean(scene.narrationText.trim()));
  const sceneMotionPlan = sourceResearchScene.motionPlan;
  const selectedMotionPlan = sceneMotionPlan.find((plan) => plan.cue === selectedMotionCue && isMotionEffectPlan(plan));
  const activeMotionEffects = sceneMotionPlan.filter(isMotionEffectPlan);
  const activeTransitionPlan = sceneMotionPlan.find(isSceneTransitionPlan);
  const transitionCue: TransitionCue = (activeTransitionPlan?.cue as TransitionCue | undefined) ?? "cut";
  const emitMotionPlan = (plans: MotionCuePlan[]) => onMotionDirectionChange(selectedScene.sceneId, [...plans].sort((left, right) => motionCueIds.indexOf(left.cue) - motionCueIds.indexOf(right.cue)));
  const toggleMotionEffect = (cue: MotionEffectCue, enabled: boolean) => {
    if (enabled) {
      if (sceneMotionPlan.some((plan) => plan.cue === cue)) return;
      const plan = defaultMotionPlan([cue])[0]!;
      emitMotionPlan([...sceneMotionPlan, { ...plan, targetLayer: selectedScene.sceneMedia ? "all" : plan.targetLayer }]);
      setSelectedMotionCue(cue);
      return;
    }
    emitMotionPlan(sceneMotionPlan.filter((plan) => plan.cue !== cue));
  };
  const editMotionEffect = (cue: MotionCuePlan["cue"], change: Partial<MotionCuePlan>) => {
    const current = sceneMotionPlan.find((plan) => plan.cue === cue && isMotionEffectPlan(plan));
    if (!current) return;
    const updated = motionCuePlanSchema.parse({ ...current, ...change });
    emitMotionPlan(sceneMotionPlan.map((plan) => plan.cue === cue ? updated : plan));
  };
  const changeTransition = (cue: TransitionCue) => {
    const plan = defaultMotionPlan([cue])[0]!;
    emitMotionPlan([...sceneMotionPlan.filter((item) => !isSceneTransitionPlan(item)), { ...plan, targetLayer: "scene", ...(cue === "slide-transition" ? { direction: "right" as const } : {}) }]);
  };
  const editTransition = (change: Partial<MotionCuePlan>) => {
    if (!activeTransitionPlan) return;
    const updated = motionCuePlanSchema.parse({ ...activeTransitionPlan, ...change });
    emitMotionPlan(sceneMotionPlan.map((plan) => plan === activeTransitionPlan ? updated : plan));
  };

  useEffect(() => { selectedSceneRef.current = selectedSceneId; }, [selectedSceneId]);
  useEffect(() => {
    const images = visualImageNodes(selectedComposition);
    const first = images[0];
    if (!first) { setSelectedImageId(null); setImageBaseline(null); return; }
    if (!images.some((image) => image.id === selectedImageId)) setSelectedImageId(first.id);
  }, [selectedScene.sceneId, selectedComposition, selectedImageId]);
  useEffect(() => {
    if (!selectedImage) { setImageBaseline(null); return; }
    setImageBaseline({ x: selectedImage.node.x, y: selectedImage.node.y, width: selectedImage.node.width, height: selectedImage.node.height, fit: selectedImage.node.fit, position: selectedImage.node.position });
  }, [selectedImage?.id, selectedScene.sceneId]);
  useEffect(() => {
    setMotionBeatPreset(selectedScene.motionStatus === "static" && !selectedScene.motionActions.length ? "static"
      : selectedScene.motionIntent === "focus-shift" ? "pan-zoom"
      : selectedScene.motionIntent === "path-animation" ? "process"
        : selectedScene.motionIntent === "particle-flow" ? "particles" : "gentle");
  }, [selectedScene.sceneId, selectedScene.motionActions.length, selectedScene.motionIntent, selectedScene.motionStatus]);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = ({ detail }: { detail: { frame: number } }) => {
      if (!player.isPlaying() || Math.abs(detail.frame - lastUiFrame.current) >= 3) {
        lastUiFrame.current = detail.frame;
        setFrame(detail.frame);
      }
      const time = detail.frame / FPS;
      const scene = research.scenes.find((item) => {
        const span = sceneTimes(research, item, mainDurationSec, audio?.timingMode);
        return time >= span.startSec && time < span.endSec;
      }) ?? research.scenes.at(-1);
      if (scene && scene.id !== selectedSceneRef.current && !transitionPreviewLock.current) {
        selectedSceneRef.current = scene.id;
        onSelectScene(scene.id);
      }
      if (scenePreviewEnd !== null && detail.frame >= scenePreviewEnd) {
        transitionPreviewLock.current = false;
        player.pause();
        setScenePreviewEnd(null);
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => { transitionPreviewLock.current = false; setPlaying(false); };
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    onFrame({ detail: { frame: player.getCurrentFrame() } });
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
    };
  }, [audio?.timingMode, mainDurationSec, onSelectScene, previewDurationSec, research, scenePreviewEnd]);

  const seekTo = useCallback((nextFrame: number) => {
    const safeFrame = Math.max(0, Math.min(frameCount - 1, Math.round(nextFrame)));
    lastUiFrame.current = safeFrame;
    setFrame(safeFrame);
    playerRef.current?.seekTo(safeFrame);
  }, [frameCount]);
  const selectScene = (sceneId: string) => {
    const scene = research.scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    if (gate.scenes[sceneId]?.length || sceneMediaErrors[sceneId]) setTab("visual");
    transitionPreviewLock.current = false;
    setScenePreviewEnd(null);
    onSelectScene(sceneId);
    setInspectorOpen(true);
    selectedSceneRef.current = sceneId;
    const span = sceneSpan(scene);
    seekTo(scenePreviewFrame(span));
    setSelectedImageId(null);
    setSelectedMotionBeatRef(null);
  };
  const editImage = useCallback((nodeId: string, update: VisualImageUpdate) => {
    const scene = storyboard.scenes.find((item) => item.sceneId === selectedSceneRef.current);
    if (!scene) return;
    onChange(scene.sceneId, { composition: updateVisualImageNode(compositionForVisualScene(storyboard, scene), nodeId, update) });
  }, [onChange, storyboard]);
  const editMotionBeat = useCallback((actionId: string, change: Partial<Pick<MotionBeat, "description" | "targetLayerId" | "targetNode" | "targetRole" | "startTimeSec" | "durationSec" | "easing" | "path" | "pathStyle">>) => {
    const action = selectedScene.motionActions.find((item) => item.id === actionId);
    if (!action) return;
    try {
      const updated = updateMotionBeat(action, change, selectedScene.durationSec);
      onChange(selectedScene.sceneId, {
        motionActions: selectedScene.motionActions.map((item) => item.id === actionId ? updated : item),
        motionStatus: "ready_for_review",
        motionSummary: `${selectedScene.motionActions.length} Motion Beat · timing perkiraan`,
      });
    } catch { /* Invalid intermediate field value stays local until next valid edit. */ }
  }, [onChange, selectedScene]);
  const editorInteractions = useMemo<VideoEditorInteractions>(() => ({
    sceneId: selectedScene.sceneId,
    selectedImageId: tab === "visual" ? selectedImageId : null,
    onSelectImage: tab === "visual" ? setSelectedImageId : () => undefined,
    onTransformImage: (nodeId, transform) => { if (tab === "visual") editImage(nodeId, transform); },
    selectedMotionPath: tab === "motion" && selectedPathAction?.path ? { actionId: selectedPathAction.id, points: selectedPathAction.path, pathStyle: selectedPathAction.pathStyle } satisfies EditorMotionPath : null,
    onTransformMotionPathPoint: (index, point) => {
      if (tab !== "motion") return;
      if (!selectedMotionAction?.path || index >= selectedMotionAction.path.length) return;
      const path = selectedMotionAction.path.map((entry, pointIndex) => pointIndex === index ? point : entry);
      editMotionBeat(selectedMotionAction.id, { path });
    },
  }), [editImage, editMotionBeat, selectedImageId, selectedPathAction, selectedScene.sceneId, selectedMotionAction, tab]);
  const playerInputProps = useMemo<VideoProps>(() => ({
    ...previewInputProps(visualResearch, audio?.file, audio?.durationSec, audio?.timingMode, undefined, outro?.enabled && outroAsset ? {
      assetId: outroAsset.id, name: outroAsset.name, file: `outros/${outroAsset.file}`, sha256: outroAsset.sha256, bytes: outroAsset.bytes,
      durationSec: outroAsset.durationSec, trimInSec: outro.trimInSec, trimOutSec: outro.trimOutSec, audioEnabled: outro.audioEnabled,
    } : undefined),
    editor: editorInteractions,
  }), [audio?.durationSec, audio?.file, audio?.timingMode, editorInteractions, outro, outroAsset, visualResearch]);
  const setImage = (update: VisualImageUpdate) => selectedImage && editImage(selectedImage.id, update);
  const setImageFit = (fit: "cover" | "contain") => {
    setImage({ fit });
    setImageFits((current) => ({ ...current, [selectedScene.sceneId]: fit }));
  };
  const chooseIllustrationWorkflow = (workflow: IllustrationWorkflow) => {
    if (workflow === "ai-image-api") {
      void onSelectAiImageSource(selectedScene.sceneId);
      return;
    }
    onChange(selectedScene.sceneId, { illustrationWorkflow: workflow });
  };
  const seekScene = (direction: -1 | 1) => {
    const index = research.scenes.findIndex((scene) => scene.id === selectedScene.sceneId);
    const next = research.scenes[Math.max(0, Math.min(research.scenes.length - 1, index + direction))];
    if (next) selectScene(next.id);
  };
  const selectMotionBeat = (sceneId: string, actionId: string) => {
    const scene = research.scenes.find((item) => item.id === sceneId);
    const visual = storyboard.scenes.find((item) => item.sceneId === sceneId);
    const action = visual?.motionActions.find((item) => item.id === actionId);
    if (!scene || !visual || !action) return;
    selectScene(sceneId);
    setSelectedMotionBeatRef({ sceneId, actionId });
    setTab("motion");
    const span = sceneSpan(scene);
    const scaledOffset = action.startFrame / FPS * ((span.endSec - span.startSec) / visual.durationSec);
    seekTo((span.startSec + scaledOffset) * FPS);
  };
  const addMotionBeat = () => {
    if (!selectedImage || selectedScene.motionActions.length >= 12) return;
    const node = selectedImage.node;
    const x = Math.round(Math.max(12, Math.min(1068, node.x + node.width / 2)));
    const low = Math.max(18, Math.min(1902, node.y + node.height * .82));
    const high = Math.max(18, Math.min(1902, node.y + node.height * .35));
    const id = `motion-beat-${Array.from({ length: 13 }, (_, index) => index + 1).find((number) => !selectedScene.motionActions.some((action) => action.id === `motion-beat-${number}`)) ?? 13}`;
    const totalFrames = Math.max(1, Math.floor(selectedScene.durationSec * FPS));
    const startFrame = Math.min(Math.floor(totalFrames * .18), totalFrames - 1);
    const durationFrames = Math.max(1, Math.min(Math.floor(3 * FPS), totalFrames - startFrame));
    const action = motionActionSchema.parse({
      id,
      description: "Magma naik mengikuti conduit",
      kind: "particle-flow",
      targetNode: selectedImage.id,
      targetLayerId: selectedImage.layerId,
      targetRole: "magma",
      startFrame,
      durationFrames,
      easing: "linear",
      path: [{ x, y: low }, { x: Math.round(x + node.width * .035), y: Math.round((low + high) / 2) }, { x, y: high }],
      motionPathRef: `path-${id}`,
      pathStyle: "magma",
      particleCount: 5,
    });
    onChange(selectedScene.sceneId, {
      motionActions: [...selectedScene.motionActions, action],
      motionStatus: "ready_for_review",
      motionSummary: `${selectedScene.motionActions.length + 1} Motion Beat · timing perkiraan`,
    });
    setSelectedMotionBeatRef({ sceneId: selectedScene.sceneId, actionId: action.id });
    setTab("motion");
  };
  const previewSingleScene = () => {
    transitionPreviewLock.current = false;
    const start = Math.floor(selectedSpan.startSec * FPS);
    setScenePreviewEnd(Math.floor(selectedSpan.endSec * FPS));
    seekTo(start);
    playerRef.current?.play();
  };
  const imageScale = selectedImage && imageBaseline ? Math.round(Math.min(selectedImage.node.width / imageBaseline.width, selectedImage.node.height / imageBaseline.height) * 100) : 100;
  const setImageScale = (value: number) => {
    if (!selectedImage || !imageBaseline) return;
    const factor = value / 100;
    const width = Math.min(1080, imageBaseline.width * factor);
    const height = Math.min(1920, imageBaseline.height * factor);
    const x = Math.max(0, Math.min(1080 - width, imageBaseline.x + imageBaseline.width / 2 - width / 2));
    const y = Math.max(0, Math.min(1920 - height, imageBaseline.y + imageBaseline.height / 2 - height / 2));
    setImage({ x, y, width, height });
  };
  const updateSceneMedia = (change: Partial<SceneMedia>) => {
    if (selectedScene.sceneMedia) onChange(selectedScene.sceneId, { sceneMedia: { ...selectedScene.sceneMedia, ...change } });
  };
  const startAiImage = async () => {
    setGeneratingImage(true);
    setGenerationError("");
    try {
      const asset = await onGenerateAiImage(selectedScene.sceneId, providerId, imageModel, selectedPrompt, imageResolution);
      if (asset) setCandidates((current) => ({ ...current, [selectedScene.sceneId]: asset }));
    } catch (error) { setGenerationError(error instanceof Error ? error.message : "Generasi ilustrasi gagal."); }
    finally { setGeneratingImage(false); }
  };
  const selectedTrackIndex = research.scenes.findIndex((scene) => scene.id === selectedScene.sceneId);
  const previousScene = research.scenes[selectedTrackIndex - 1];
  const previousSpan = previousScene ? sceneSpan(previousScene) : null;
  const inspectorTabs: ReadonlyArray<readonly [InspectorTab, string]> = [["visual", "Visual"], ["motion", "Gerak"], ["clip", "Klip"], ["text", "Teks"], ["transition", "Transisi"], ["audio", "Audio"]];
  const previewTransition = () => {
    if (!previousScene || !previousSpan) return;
    const incomingStart = Math.floor(selectedSpan.startSec * FPS);
    const incomingEnd = Math.max(incomingStart, Math.floor(selectedSpan.endSec * FPS) - 1);
    const start = Math.max(Math.floor(previousSpan.startSec * FPS), incomingStart - Math.round(FPS / 2));
    const duration = transitionCue === "cut" ? Math.round(FPS / 2) : Math.max(1, activeTransitionPlan?.durationFrames ?? FPS);
    const transitionEnd = incomingStart + (transitionCue === "cut" ? 0 : activeTransitionPlan?.delayFrames ?? 0) + duration;
    transitionPreviewLock.current = true;
    setScenePreviewEnd(Math.min(frameCount - 1, incomingEnd, transitionEnd));
    seekTo(start);
    playerRef.current?.play();
  };

  return <section className="video-editor-v2" aria-label="Editor video">
    <header className="video-editor-toolbar">
      <div className="video-editor-title-group">
         <button type="button" className="button button-light editor-back-button" onClick={onBack}><ArrowLeft size={16} aria-hidden="true"/><span>Kembali ke Narasi</span></button>
        <label className="video-editor-title"><span className="sr-only">Judul video</span><input maxLength={120} value={research.title} onChange={(event) => onTitleChange(event.target.value)} aria-label="Judul video" /></label>
        <span className={`editor-save-state ${saved ? "saved" : "unsaved"}`} role="status"><i />{saved ? "Tersimpan" : "Belum disimpan"}</span>
      </div>
      <div className="video-editor-toolbar-actions">
        <button type="button" className={`button button-light ${videoSettingsOpen ? "selected" : ""}`} aria-expanded={videoSettingsOpen} aria-controls="editor-video-settings" onClick={() => setVideoSettingsOpen((open) => !open)}><Film size={15} aria-hidden="true"/>Pengaturan Video</button>
        <button type="button" className="button button-light editor-inspector-toggle" aria-expanded={inspectorOpen} aria-controls="video-editor-inspector" onClick={() => setInspectorOpen((open) => !open)}><SlidersHorizontal size={15} aria-hidden="true"/>{inspectorOpen ? "Tutup Inspector" : "Inspector"}</button>
        <button type="button" className="button button-light" onClick={onSave} disabled={saved || busy}><Check size={15} aria-hidden="true"/> Simpan</button>
        <button type="button" className="button button-light" onClick={() => playerRef.current?.toggle()}><Play size={15} aria-hidden="true"/>{playing ? "Jeda" : "Pratinjau video"}</button>
        <button type="button" className="button button-primary" onClick={onExport} disabled={busy}>Lanjut ke Review <span aria-hidden="true">→</span></button>
      </div>
    </header>

    {videoSettingsOpen && <section id="editor-video-settings" className="editor-video-settings" aria-labelledby="editor-video-settings-title">
       <div className="editor-video-settings-heading"><div><span className="eyebrow">PENGATURAN LEVEL VIDEO</span><h2 id="editor-video-settings-title">Gaya Animasi & Outro</h2><p>Gaya berlaku untuk prompt baru semua scene; perubahan tidak membuat ulang prompt atau media otomatis.</p></div><button type="button" className="button button-light icon-button" aria-label="Tutup pengaturan video" onClick={() => setVideoSettingsOpen(false)}><X size={16} aria-hidden="true"/></button></div>
       <div className="editor-animation-style-controls">
         <label className="editor-field">Gaya Animasi<select value={animationStyleId} onChange={(event) => onAnimationStyleChange(event.target.value as AnimationStyleId)} disabled={busy}>{ANIMATION_STYLE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
         {staleAnimationPromptCount > 0 && <div className="editor-animation-style-stale" role="status"><span>{staleAnimationPromptCount} prompt lama belum memakai gaya ini. Media impor dan approval tetap.</span><button type="button" className="button button-light" onClick={onRegenerateStaleFlowPrompts} disabled={busy}><RotateCcw size={14} aria-hidden="true"/>Buat Ulang Prompt dengan Gaya Baru</button></div>}
       </div>
       <div className="editor-outro-controls">
        <label className="editor-field">Outro Video<select aria-label="Pilih outro video" value={outro?.assetId ?? ""} onChange={(event) => {
          const asset = outros.find((item) => item.id === event.target.value);
          onOutroChange(asset ? { assetId: asset.id, enabled: true, trimInSec: 0, trimOutSec: asset.durationSec, audioEnabled: false } : null);
        }}>
          <option value="">Tanpa Outro</option>
          {outro && <option value={outro.assetId}>{outroAsset ? `${outroAsset.name}${outroAsset.archived ? " · Diarsipkan (project ini)" : outroAsset.localAvailable ? " · Terpilih" : " · File tidak tersedia"}` : "Outro tidak ditemukan (project ini)"}</option>}
          {outros.filter((asset) => asset.id !== outro?.assetId).map((asset) => <option key={asset.id} value={asset.id}>{asset.name}{asset.isDefault ? " · Default" : ""} · {asset.durationSec.toFixed(1)} dtk</option>)}
        </select></label>
        {outro && <label className="editor-outro-toggle"><input type="checkbox" checked={outro.enabled} onChange={(event) => onOutroChange({ ...outro, enabled: event.target.checked })}/><span>Gunakan outro di preview dan render</span></label>}
        {outro && <>
          {outroPreviewError && <div className="workflow-alert danger" role="alert">{outroPreviewError}</div>}
          <div className="editor-outro-preview">
            {outroAsset?.localAvailable ? <video src={outroAsset.previewUrl} poster={outroAsset.posterUrl} controls playsInline preload="metadata" aria-label={`Pratinjau outro ${outroAsset.name}`}/> : <span className="editor-outro-missing"><Film size={18} aria-hidden="true"/>File outro tidak tersedia</span>}
            <div><strong>{outroAsset?.name ?? "Outro tidak ditemukan"}</strong><small>{outroAsset ? `${outroAsset.durationSec.toFixed(1)} dtk · ${outroAsset.width} × ${outroAsset.height}${outroAsset.archived ? " · Diarsipkan, tetap tersedia untuk project ini" : ""}` : "Tidak ada fallback outro otomatis."}</small></div>
          </div>
          <div className="editor-outro-trim">
            <label className="editor-field">Trim masuk · detik<input type="number" min="0" max={Math.max(0, outro.trimOutSec - 0.1)} step="0.1" value={outro.trimInSec} disabled={!outroAsset} onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && outroAsset) onOutroChange({ ...outro, trimInSec: Math.max(0, Math.min(value, outro.trimOutSec - 0.1)) });
            }}/></label>
            <label className="editor-field">Trim keluar · detik<input type="number" min={outro.trimInSec + 0.1} max={outroAsset?.durationSec ?? 120} step="0.1" value={outro.trimOutSec} disabled={!outroAsset} onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && outroAsset) onOutroChange({ ...outro, trimOutSec: Math.max(outro.trimInSec + 0.1, Math.min(value, outroAsset.durationSec)) });
            }}/></label>
          </div>
          <label className="editor-outro-toggle"><input type="checkbox" checked={outro.audioEnabled} disabled={!outroAsset} onChange={(event) => onOutroChange({ ...outro, audioEnabled: event.target.checked })}/><span>Gunakan audio asli outro</span></label>
          <p className="editor-outro-total">Durasi outro {((outro.trimOutSec - outro.trimInSec)).toFixed(1)} dtk · total video {previewDurationSec.toFixed(1)} dtk</p>
        </>}
        {!outros.length && <p className="editor-outro-empty">Outro Library kosong. Project tetap tanpa outro sampai Anda memilih asset.</p>}
        <button type="button" className="button button-light editor-outro-library-link" onClick={onOpenOutroLibrary}>Kelola Outro Library</button>
      </div>
    </section>}

    {(preparation || motionPreparation) && <div className="editor-job-status" role="status" aria-live="polite">
      {preparation && <span>{preparation.status === "running" ? `Menyiapkan ilustrasi ${preparation.processed}/${preparation.total}` : `Persiapan ilustrasi: ${preparation.status === "completed" ? "selesai" : preparation.status.replaceAll("_", " ")}`}</span>}
      {motionPreparation && <span>{motionPreparation.status === "running" ? `Menyiapkan gerak ${motionPreparation.processed}/${motionPreparation.total}` : `Motion Director: ${motionPreparation.status === "completed" ? "selesai" : motionPreparation.status.replaceAll("_", " ")}`}</span>}
    </div>}

    <div className={`video-editor-layout inspector-${inspectorOpen ? "open" : "closed"}`}>
      <aside className="video-editor-scenes" aria-label="Daftar scene">
         <div className="editor-panel-heading"><div><h2>Scene</h2><span>{research.scenes.length} bagian</span></div><div className="editor-scene-heading-actions"><button type="button" className="button button-light editor-batch-launch" onClick={() => batchLauncher?.()} disabled={busy || !batchLauncher} title={batchLauncher ? "Impor beberapa gambar atau klip Google Flow ke scene" : "Buka Visual untuk mengaktifkan import batch Google Flow"}><Upload size={14} aria-hidden="true"/><span>Import Semua Media</span></button><button type="button" className="button button-light icon-button" aria-label="Siapkan ilustrasi yang perlu diperbaiki" title="Siapkan ilustrasi yang perlu diperbaiki" onClick={() => onPrepareIssues(storyboard.scenes.filter((scene) => scene.authoringStatus === "needs_visual_authoring").map((scene) => scene.sceneId))} disabled={!saved || busy || !storyboard.scenes.some((scene) => scene.authoringStatus === "needs_visual_authoring")}><ImagePlus size={16} aria-hidden="true"/></button></div></div>
        <div className="editor-scene-list">
          {storyboard.scenes.map((scene, index) => {
            const source = visualResearch.scenes[index]!;
            const issueCount = (gate.scenes[scene.sceneId]?.length ?? 0) + Number(Boolean(sceneMediaErrors[scene.sceneId]));
            const status = sceneMediaErrors[scene.sceneId] ? "Media error" : issueCount ? `${issueCount} masalah visual` : sceneIllustrationStatus(scene, storyboard);
            const span = sceneSpan(source);
             return <button type="button" key={scene.sceneId} className={`editor-scene-item ${issueCount ? "has-issues" : ""} ${scene.sceneId === selectedScene.sceneId ? "selected" : ""}`} aria-pressed={scene.sceneId === selectedScene.sceneId} onClick={() => selectScene(scene.sceneId)}>
              <SceneThumbnail scene={source} storyboard={storyboard} preset={research.visualPreset} mediaError={sceneMediaErrors[scene.sceneId]} />
              <span className="editor-scene-copy"><strong>{String(index + 1).padStart(2, "0")} · {scene.headline}</strong><small>{(span.endSec - span.startSec).toFixed(1)} dtk · {sceneMediaErrors[scene.sceneId] ? "Media error" : status}</small></span>
            </button>;
          })}
        </div>
         <div className="editor-approval-summary"><span>{storyboard.scenes.filter((scene) => scene.approved).length} / {storyboard.scenes.length} scene disetujui</span><span className={primaryIllustrationsReady ? "ready" : "attention"}>{primaryIllustrationsReady ? "Ilustrasi siap" : "Perlu perbaikan"}</span></div>
      </aside>

      <main className="video-editor-center">
        <div className="editor-canvas-toolbar"><div><strong>Pratinjau video</strong><span>9:16 · 1080 × 1920</span></div><button type="button" className={`button button-light ${safeGuides ? "selected" : ""}`} aria-pressed={safeGuides} onClick={() => setSafeGuides((value) => !value)}>Panduan aman</button></div>
        <div className="editor-canvas-shell">
          <Player<AnyZodObject, VideoProps> ref={playerRef} component={VersionedVideo} inputProps={playerInputProps} durationInFrames={frameCount} compositionWidth={1080} compositionHeight={1920} fps={FPS} initialFrame={scenePreviewFrame(selectedSpan)} loop={false} controls={false} clickToPlay={false} style={{ width: "100%", height: "100%" }} />
          {outroPreviewError && <div className="editor-outro-error" role="alert">{outroPreviewError}</div>}
          {selectedMediaError && <div className="editor-media-error" role="alert"><strong>Media Flow tidak tersedia atau rusak</strong><span>{selectedMediaError}</span><small>Komposisi tidak dipakai sebagai fallback. Impor ulang klip atau lepas media bermasalah.</small></div>}
          {safeGuides && <div className="editor-safe-guide" aria-hidden="true" style={{ left: `${safe.left / 1080 * 100}%`, right: `${safe.right / 1080 * 100}%`, top: `${safe.top / 1920 * 100}%`, bottom: `${safe.bottom / 1920 * 100}%` }} />}
        </div>
        <div className="editor-transport">
          <button type="button" className="button button-light icon-button" onClick={() => seekScene(-1)} aria-label="Scene sebelumnya" title="Scene sebelumnya"><ChevronLeft size={17} aria-hidden="true"/></button>
          <button type="button" className="button button-primary editor-play-button" onClick={() => playerRef.current?.toggle()} aria-label={playing ? "Jeda video" : "Putar video"}>{playing ? <Pause size={17} aria-hidden="true"/> : <Play size={17} aria-hidden="true"/>}</button>
          <button type="button" className="button button-light icon-button" onClick={() => seekScene(1)} aria-label="Scene berikutnya" title="Scene berikutnya"><ChevronRight size={17} aria-hidden="true"/></button>
          <span className="editor-time-readout">{formatTime(currentTime)} <i>/</i> {formatTime(previewDurationSec)}</span>
          <button type="button" className="button button-light" onClick={previewSingleScene}>Pratinjau scene</button>
        </div>

        <section className="editor-timeline" aria-label="Timeline video">
          <div className="editor-timeline-heading"><strong>Timeline</strong><span>{formatTime(currentTime)} / {formatTime(previewDurationSec)}</span></div>
          <label className="sr-only" htmlFor="editor-playhead">Geser playhead</label>
          <input id="editor-playhead" className="editor-playhead" type="range" min={0} max={Math.max(0, frameCount - 1)} step={1} value={Math.min(frame, frameCount - 1)} onChange={(event) => seekTo(Number(event.target.value))} aria-valuetext={`${formatTime(currentTime)} dari ${formatTime(previewDurationSec)}`} />
          <div className="editor-timeline-ruler" aria-hidden="true">{Array.from({ length: Math.ceil(previewDurationSec / 5) + 1 }, (_, index) => <span key={index} style={{ left: `${Math.min(100, index * 5 / previewDurationSec * 100)}%` }}>{formatTime(Math.min(previewDurationSec, index * 5))}</span>)}</div>
          <div className="editor-track-row"><span>Scene</span><div className="editor-track-rail">{research.scenes.map((scene, index) => {
            const span = sceneSpan(scene);
            return <button type="button" key={scene.id} className={`editor-track-clip ${scene.id === selectedScene.sceneId ? "selected" : ""}`} style={{ left: `${span.startSec / previewDurationSec * 100}%`, width: `${Math.max(0.5, (span.endSec - span.startSec) / previewDurationSec * 100)}%` }} onClick={() => selectScene(scene.id)} aria-label={`Pilih scene ${index + 1}: ${scene.onScreenText}`}><strong>{String(index + 1).padStart(2, "0")}</strong><small>{(span.endSec - span.startSec).toFixed(1)}s</small></button>;
           })}<i className="editor-playhead-line" style={{ left: `${currentTime / previewDurationSec * 100}%` }} aria-hidden="true"/></div></div>
           {outro?.enabled && <div className="editor-track-row"><span>Outro</span><div className="editor-track-rail editor-outro-rail">{outroAsset && <button type="button" className="editor-outro-clip" style={{ left: `${mainDurationFrames / frameCount * 100}%`, width: `${outroDurationFrames / frameCount * 100}%` }} onClick={() => seekTo(mainDurationFrames)} aria-label={`Pilih segmen outro ${outroAsset.name}, ${((outro.trimOutSec - outro.trimInSec)).toFixed(1)} detik`} title={`${outroAsset.name} · ${((outro.trimOutSec - outro.trimInSec)).toFixed(1)}s`}><strong>{outroAsset.name}</strong><small>{((outro.trimOutSec - outro.trimInSec)).toFixed(1)}s</small></button>}<i className="editor-playhead-line" style={{ left: `${currentTime / previewDurationSec * 100}%` }} aria-hidden="true"/></div></div>}
            <div className="editor-track-row"><span>Media</span><div className="editor-track-rail editor-media-rail">{storyboard.scenes.flatMap((visual) => {
             const scene = research.scenes.find((item) => item.id === visual.sceneId);
             if (!scene?.sceneMedia) return [];
             const span = sceneSpan(scene);
             return [<button type="button" key={scene.id} className={`editor-media-clip ${scene.id === selectedScene.sceneId ? "selected" : ""}`} style={{ left: `${span.startSec / previewDurationSec * 100}%`, width: `${Math.max(0.5, (span.endSec - span.startSec) / previewDurationSec * 100)}%` }} onClick={() => selectScene(scene.id)} aria-label={`Klip ${scene.sceneMedia.sourceFormat.toUpperCase()} scene ${visual.sceneNumber}: ${scene.sceneMedia.name}`} title={`${scene.sceneMedia.name} · trim ${scene.sceneMedia.trimInSec.toFixed(1)}–${scene.sceneMedia.trimOutSec.toFixed(1)}s`}><strong>{scene.sceneMedia.sourceFormat.toUpperCase()}</strong><small>{scene.sceneMedia.shortClip === "loop" ? "loop" : "freeze"}</small></button>];
           })}<i className="editor-playhead-line" style={{ left: `${currentTime / previewDurationSec * 100}%` }} aria-hidden="true"/></div></div>
             <div className="editor-track-row"><span>Motion Beat</span><div className="editor-motion-rail" aria-label="Timeline motion beats">
            {storyboard.scenes.flatMap((visual) => {
              const scene = research.scenes.find((item) => item.id === visual.sceneId);
              if (!scene) return [];
              const span = sceneSpan(scene);
              const timingScale = (span.endSec - span.startSec) / visual.durationSec;
              return visual.motionActions.map((action) => {
                const beat = motionBeatFromAction(action);
                const startSec = span.startSec + beat.startTimeSec * timingScale;
                const durationSec = beat.durationSec * timingScale;
                const width = Math.max(1.2, durationSec / previewDurationSec * 100);
                const left = Math.max(0, Math.min(100 - width, startSec / previewDurationSec * 100));
                const selected = selectedMotionBeatRef?.sceneId === visual.sceneId && selectedMotionBeatRef.actionId === action.id;
                return <button type="button" key={`${visual.sceneId}-${action.id}`} className={`editor-motion-clip ${selected ? "selected" : ""}`} style={{ left: `${left}%`, width: `${width}%` }} aria-pressed={selected} aria-label={`Motion Beat scene ${visual.sceneNumber}: ${beat.description}, mulai ${beat.startTimeSec.toFixed(1)} detik, durasi ${beat.durationSec.toFixed(1)} detik. Seret atau gunakan panah untuk menggeser waktu.`} title={`${beat.description} · ${beat.startTimeSec.toFixed(1)}s + ${beat.durationSec.toFixed(1)}s`} onClick={() => selectMotionBeat(visual.sceneId, action.id)}
                  onPointerDown={(event) => {
                    if (visual.sceneId !== selectedScene.sceneId || !event.isPrimary || event.button !== 0) return;
                    const railWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 0;
                    if (!railWidth) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    motionClipGesture.current = { pointerId: event.pointerId, actionId: action.id, startX: event.clientX, railWidth, startTimeSec: beat.startTimeSec, timingScale };
                  }}
                  onPointerUp={(event) => {
                    const active = motionClipGesture.current;
                    if (!active || active.pointerId !== event.pointerId || active.actionId !== action.id) return;
                    motionClipGesture.current = null;
                    const deltaX = event.clientX - active.startX;
                    if (Math.abs(deltaX) > 4) editMotionBeat(action.id, { startTimeSec: active.startTimeSec + deltaX / active.railWidth * previewDurationSec / active.timingScale });
                  }}
                  onPointerCancel={(event) => { if (motionClipGesture.current?.pointerId === event.pointerId) motionClipGesture.current = null; }}
                  onKeyDown={(event) => {
                    if (visual.sceneId !== selectedScene.sceneId || event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                    event.preventDefault();
                    const delta = event.shiftKey ? 1 / FPS : 0.1;
                    editMotionBeat(action.id, { startTimeSec: beat.startTimeSec + (event.key === "ArrowLeft" ? -delta : delta) });
                  }}><span>{beat.description}</span></button>;
              });
            })}
            <i className="editor-playhead-line" style={{ left: `${currentTime / previewDurationSec * 100}%` }} aria-hidden="true"/>
            </div></div>
          {audio && <div className="editor-track-row"><span>Narasi</span><div className="editor-track-rail"><div className="editor-audio-clip" style={{ left: 0, width: `${Math.min(100, audio.durationSec / previewDurationSec * 100)}%` }} title={audio.name}>{audio.name}</div></div></div>}
          {captionsAvailable && <div className="editor-track-row"><span>Subtitle</span><div className="editor-track-rail">{research.scenes.map((scene) => {
            const span = sceneSpan(scene);
            return captionSegmentsForScene(scene).map((segment, index) => <i key={`${scene.id}-${index}`} className="editor-caption-clip" style={{ left: `${(span.startSec + (span.endSec - span.startSec) * segment.startProgress) / previewDurationSec * 100}%`, width: `${Math.max(0.2, (span.endSec - span.startSec) * (segment.endProgress - segment.startProgress) / previewDurationSec * 100)}%` }} title={segment.text}/>);
          })}</div></div>}
        </section>
      </main>

      <aside id="video-editor-inspector" className="video-editor-inspector" aria-label="Pengaturan scene terpilih" aria-hidden={!inspectorOpen}>
        <header className="editor-inspector-header"><div className="editor-inspector-scene"><span>SCENE {String(selectedTrackIndex + 1).padStart(2, "0")}</span><strong>{selectedScene.headline}</strong><small>{selectedScene.durationSec.toFixed(1)} detik</small></div><button type="button" className="button button-light icon-button" onClick={() => setInspectorOpen(false)} aria-label="Tutup inspector"><X size={16} aria-hidden="true"/></button></header>
        <div className="editor-inspector-tabs" role="tablist" aria-label="Panel scene" onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const current = inspectorTabs.findIndex(([id]) => id === tab);
          const next = event.key === "Home" ? 0 : event.key === "End" ? inspectorTabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : inspectorTabs.length - 1)) % inspectorTabs.length;
          setTab(inspectorTabs[next]![0]);
          event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
        }}>
          {inspectorTabs.map(([id, label]) => <button type="button" role="tab" id={`editor-tab-${id}`} aria-controls="editor-inspector-panel" tabIndex={tab === id ? 0 : -1} key={id} aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}
        </div>
        <div id="editor-inspector-panel" className="editor-inspector-content" role="tabpanel" aria-labelledby={`editor-tab-${tab}`} tabIndex={0}>
          {tab === "visual" && <>
            <section className="editor-illustration-section" aria-labelledby="editor-illustration-title">
              <div className="editor-illustration-heading"><h3 id="editor-illustration-title">Ilustrasi Scene</h3><span className={selectedScene.approved ? "approved" : needsArtwork ? "attention" : "review"}>{illustrationStatus}</span></div>
              <label className="editor-field">Sumber ilustrasi<select value={selectedScene.illustrationWorkflow} onChange={(event) => chooseIllustrationWorkflow(event.target.value as IllustrationWorkflow)}>
                <option value="google-flow">Google Flow</option><option value="asset-library">Asset Library</option><option value="upload-image">Upload Gambar</option><option value="ai-vector">AI Vector</option><option value="ai-image-api">AI Image API (Advanced)</option>
              </select></label>
              <div className="editor-illustration-current">
                <SceneThumbnail scene={sourceResearchScene} storyboard={storyboard} preset={research.visualPreset}/>
                <div><strong>{illustrationStatus}</strong>{needsArtwork ? <small>Visual draft tersedia; belum menjadi ilustrasi utama.</small> : <small>{selectedScene.approved ? "Versi visual ini telah disetujui." : "Tinjau gambar, crop, dan akurasi sebelum approval."}</small>}</div>
              </div>
              {storyboard.visualWorld ? <>
                <div className="editor-info-box"><strong>Shared VisualWorld · {storyboard.visualWorld.elements.length} stable layer</strong><span>{storyboard.visualWorld.name}. Scene tanpa override memakai base bersama; ilustrasi scene khusus hanya mengubah scene aktif. Motion Beat tetap tersimpan per scene.{storyboard.visualWorld.composition.layers.every((layer) => layer.nodes.every((node) => node.type !== "image" && (node.type !== "group" || node.children.every((child) => child.type !== "image")))) ? " Draft prosedural, bukan ilustrasi Flow final." : ""}</span></div>
                <details className="editor-advanced">
                  <summary>Layer & peran Visual World</summary>
                  <ul>{storyboard.visualWorld.elements.map((element) => {
                    const layer = storyboard.visualWorld!.composition.layers.find((item) => item.id === element.layerId)!;
                    return <li key={element.layerId}><strong>{element.layerId}</strong> · {element.semanticRole.replaceAll("-", " ")} · {layer.nodes.length} node</li>;
                  })}</ul>
                </details>
              </> : null}
              {sceneImages.length > 0 && <button type="button" className="button button-light full-button" onClick={() => onSetSharedVisualWorld(selectedScene.sceneId)} disabled={busy}>Gunakan untuk Semua Scene</button>}
              {needsArtwork && selectedScene.illustrationWorkflow !== "google-flow" && <button type="button" className="button button-primary full-button" onClick={() => chooseIllustrationWorkflow("google-flow")}><ImagePlus size={15} aria-hidden="true"/> Buat dengan Google Flow</button>}
            </section>

            {selectedScene.illustrationWorkflow === "asset-library" && <div className="editor-source-card"><strong>Asset Library</strong><span>Pilih ilustrasi yang tersimpan atau gunakan aset project.</span><button type="button" className="button button-primary full-button" onClick={() => onOpenLibrary(selectedScene.sceneId, "mine")} disabled={busy}><ImagePlus size={15} aria-hidden="true"/> Pilih dari Asset Library</button></div>}
            {selectedScene.illustrationWorkflow === "upload-image" && <div className="editor-source-card"><strong>Upload Gambar</strong><span>PNG, JPEG, atau WebP. File divalidasi dan disimpan melalui pipeline aset project.</span><input ref={uploadInput} type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void onUploadAsset(selectedScene.sceneId, file, { source: "user-upload", license: "User-provided; license/provenance not specified" }); event.currentTarget.value = ""; }}/><button type="button" className="button button-primary full-button" onClick={() => uploadInput.current?.click()} disabled={busy}><Upload size={15} aria-hidden="true"/> Pilih gambar</button></div>}
            {selectedScene.illustrationWorkflow === "ai-vector" && <div className="editor-source-card"><strong>AI Vector</strong><span>{vectorAvailable ? "Buat diagram atau visual proses yang dapat diedit sebagai vector." : "AI Vector memerlukan model OpenCode Development yang tersedia."}</span><button type="button" className="button button-primary full-button" onClick={() => onGenerateVector(selectedScene.sceneId)} disabled={!vectorAvailable || busy || vectorizingSceneId !== null}>{vectorizingSceneId === selectedScene.sceneId ? "Membuat AI Vector…" : "Buat AI Vector"}</button></div>}
            {selectedScene.illustrationWorkflow === "ai-image-api" && <details className="editor-advanced editor-ai-advanced" open>
              <summary>AI Image API · Advanced</summary>
              <IllustrationPromptPanel prompt={selectedPrompt} providerCatalog={imageProviderCatalog} providerId={providerId} model={imageModel} resolution={imageResolution} candidate={candidate} fit={selectedFit} generating={generatingImage} error={generationError} copied={copiedPrompt} onPrompt={(value) => setPrompts((current) => ({ ...current, [selectedScene.sceneId]: value }))} onProvider={(value) => setProviders((current) => ({ ...current, [selectedScene.sceneId]: value }))} onModel={(value) => setModelsByScene((current) => ({ ...current, [selectedScene.sceneId]: value }))} onResolution={(value) => setResolutions((current) => ({ ...current, [selectedScene.sceneId]: value }))} onFit={(value) => setImageFits((current) => ({ ...current, [selectedScene.sceneId]: value }))} onGenerate={() => void startAiImage()} onCopy={() => void navigator.clipboard.writeText(selectedPrompt).then(() => setCopiedPrompt(true)).catch(() => setCopiedPrompt(false))} onApply={() => candidate && onApplyGeneratedAiImage(selectedScene.sceneId, candidate, selectedFit)}/>
            </details>}

              {(sceneImages.length > 0 || selectedScene.sceneMedia) && !selectedScene.authoringConfirmed && <button type="button" className="button button-light full-button" onClick={() => onConfirmUserAsset(selectedScene.sceneId)} disabled={busy}>Saya sudah meninjau visual</button>}
            {sceneImages.length > 0 && <details className="editor-advanced editor-image-controls"><summary>Posisi, skala & crop</summary>
              {sceneImages.length > 1 && <label className="editor-field">Layer ilustrasi<select value={selectedImage?.id ?? ""} onChange={(event) => setSelectedImageId(event.target.value)}>{sceneImages.map((entry) => <option key={entry.id} value={entry.id}>{entry.layerId.replaceAll("-", " ")} · gambar</option>)}</select></label>}
              <label className="editor-field">Tampilan gambar<select value={selectedImage?.node.fit ?? "contain"} onChange={(event) => setImageFit(event.target.value as "cover" | "contain")}><option value="contain">Contain · seluruh gambar</option><option value="cover">Cover · isi area, crop gambar</option></select></label>
              <label className="editor-field">Posisi gambar<select value={selectedImage?.node.position ?? "center"} onChange={(event) => setImage({ position: event.target.value as NonNullable<typeof selectedImage.node.position> })}>{["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"].map((position) => <option key={position} value={position}>{position.replaceAll("-", " ")}</option>)}</select></label>
              <label className="editor-range-field">Skala · {imageScale}%<input type="range" min={25} max={200} step={1} value={Math.max(25, Math.min(200, imageScale))} onChange={(event) => setImageScale(Number(event.target.value))} aria-label="Skala ilustrasi"/></label>
              <small className="editor-hint">Klik dan seret gambar pada canvas untuk memindahkan. Tarik handle sudut untuk mengubah ukuran; rasio gambar dipertahankan.</small>
               <button type="button" className="button button-light full-button" onClick={() => { if (selectedImage && imageBaseline) setImage({ x: imageBaseline.x, y: imageBaseline.y, width: imageBaseline.width, height: imageBaseline.height, fit: imageBaseline.fit, position: imageBaseline.position }); }} disabled={!imageBaseline}><RotateCcw size={14} aria-hidden="true"/> Reset transform</button>
             </details>}

              {selectedScene.sceneMedia && <section className="editor-scene-media-controls" aria-label="Media Google Flow">
                <div className="editor-info-box"><strong>Video Clip · {selectedScene.sceneMedia.sourceFormat.toUpperCase()}</strong><span>{selectedScene.sceneMedia.sourceWidth}×{selectedScene.sceneMedia.sourceHeight} · {selectedScene.sceneMedia.sourceDurationSec.toFixed(2)}s asli · {selectedScene.sceneMedia.sourceVideoCodec} → H.264/30 fps.</span></div>
                <label className="editor-field">Fit video<select value={selectedScene.sceneMedia.fit} onChange={(event) => updateSceneMedia({ fit: event.target.value as SceneMedia["fit"] })}><option value="cover">Cover · crop aman</option><option value="contain">Contain · tanpa crop</option></select></label>
               <label className="editor-field">Posisi video<select value={selectedScene.sceneMedia.position} onChange={(event) => updateSceneMedia({ position: event.target.value as SceneMedia["position"] })}>{["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"].map((position) => <option key={position} value={position}>{position.replaceAll("-", " ")}</option>)}</select></label>
                <label className="editor-field editor-media-audio"><input type="checkbox" checked={selectedScene.sceneMedia.audioEnabled} disabled={!selectedScene.sceneMedia.audioCodec} onChange={(event) => updateSceneMedia({ audioEnabled: event.target.checked })}/> Gunakan audio klip{selectedScene.sceneMedia.audioCodec ? " · default nonaktif" : " · klip tanpa audio"}</label>
               <button type="button" className="button button-light full-button" onClick={() => onRemoveSceneMedia(selectedScene.sceneId)} disabled={busy}>Gunakan gambar/komposisi statis</button>
             </section>}

            <details className="editor-advanced"><summary>Advanced · diagnostics & authoring</summary>
              <p>Sumber aktif: {illustrationSourceForScene(selectedScene)} · {selectedScene.compositionSource}</p>
              {selectedAsset && <p>Asset: {selectedAsset.name} · {selectedAsset.provider ?? "provider lokal"}{selectedAsset.model ? ` · ${selectedAsset.model}` : ""}</p>}
              {sceneIssueList.length > 0 && <ul>{sceneIssueList.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
              {selectedScene.warnings.map((warning) => <p key={warning}>{warning}</p>)}
              <button type="button" className="button button-light full-button" onClick={() => onGenerate(selectedScene.sceneId)} disabled={busy || generatingSceneId !== null}>{generatingSceneId === selectedScene.sceneId ? "Menyiapkan…" : "Composer lokal"}</button>
              <button type="button" className="button button-light full-button" onClick={() => onUseCurrentComposition(selectedScene.sceneId)} disabled={busy}>Gunakan visual dari Materi</button>
              <label className="editor-field">Model perencana AI<select value={selectedModel} onChange={(event) => onSelectModel(event.target.value)} disabled={!models.length}>{models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
              <small>{aiMode === "development" ? plannerAvailable ? "AI Text tersedia setelah tindakan eksplisit." : "Pilih model OpenCode yang tersedia." : "AI planner perlu konfigurasi Development."}</small>
              <button type="button" className="button button-light full-button" onClick={() => onPlan(selectedScene.sceneId)} disabled={!plannerAvailable || busy || planningSceneId !== null}>{planningSceneId === selectedScene.sceneId ? "Merencanakan…" : "Rencana visual AI Text"}</button>
             </details>
           </>}

          {tab === "clip" && <>
            <label className="editor-field">Durasi scene · detik<input type="number" min="0.1" max="120" step="0.1" value={selectedScene.durationSec} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) onDurationChange(selectedScene.sceneId, value); }}/></label>
            {selectedScene.sceneMedia ? <section className="editor-scene-media-controls" aria-label="Trim klip">
               <div className="editor-info-box"><strong>Klip · {selectedScene.sceneMedia.sourceFormat.toUpperCase()}</strong><span>{selectedScene.sceneMedia.name} · {selectedScene.sceneMedia.sourceDurationSec.toFixed(2)}s durasi asli · {selectedScene.sceneMedia.shortClip === "loop" ? "diulang" : "frame akhir dibekukan"}.</span></div>
               <label className="editor-field">Trim masuk · detik<input type="number" min={0} max={Math.max(0, selectedScene.sceneMedia.trimOutSec - 0.1)} step={0.1} value={selectedScene.sceneMedia.trimInSec} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) updateSceneMedia({ trimInSec: Math.max(0, Math.min(value, selectedScene.sceneMedia!.trimOutSec - 0.1)) }); }}/></label>
               <label className="editor-field">Trim keluar · detik<input type="number" min={selectedScene.sceneMedia.trimInSec + 0.1} max={selectedScene.sceneMedia.durationSec} step={0.1} value={selectedScene.sceneMedia.trimOutSec} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) updateSceneMedia({ trimOutSec: Math.min(selectedScene.sceneMedia!.durationSec, Math.max(value, selectedScene.sceneMedia!.trimInSec + 0.1)) }); }}/></label>
               <label className="editor-field">Jika klip lebih pendek<select value={selectedScene.sceneMedia.shortClip} onChange={(event) => updateSceneMedia({ shortClip: event.target.value as SceneMedia["shortClip"] })}><option value="loop">Ulangi klip</option><option value="freeze-last-frame">Bekukan frame terakhir</option></select></label>
               <div className="editor-info-box"><strong>Timing scene · {selectedSpan.startSec.toFixed(1)}–{selectedSpan.endSec.toFixed(1)} dtk</strong><span>{audio ? `${audio.timingMode === "estimated" ? "Sinkronisasi estimasi" : "Timing disesuaikan"} terhadap audio ${audio.durationSec.toFixed(1)} dtk.` : "Timing manual dari durasi scene."} Ubah durasi tidak mengganti media atau mengubah audio.</span></div>
               <small>Fit, posisi, dan import media di tab Visual.</small>
             </section> : <div className="editor-info-box"><strong>Scene memakai visual statis</strong><span>Import atau ganti klip Google Flow di tab Visual.</span></div>}
          </>}

          {tab === "text" && <>
            <label className="editor-field">Headline<input maxLength={120} value={selectedScene.headline} onChange={(event) => onChange(selectedScene.sceneId, { headline: event.target.value })}/></label>
            <label className="editor-field">Narasi<textarea rows={8} maxLength={2000} value={selectedScene.narrationText} onChange={(event) => onChange(selectedScene.sceneId, { narrationText: event.target.value })}/></label>
            <CaptionSegmentsEditor key={sourceResearchScene.id} scene={sourceResearchScene} onChange={(captionSegments) => onCaptionSegmentsChange(sourceResearchScene.id, captionSegments)}/>
            <fieldset className="editor-overlay-settings"><legend>Judul, subtitle & branding</legend>
              {([["showCategory", "Tampilkan kategori"], ["showTitle", "Tampilkan headline"], ["showSceneLabel", "Tampilkan nomor scene"], ["showSubtitles", "Tampilkan subtitle"], ["showProgress", "Tampilkan progress video"], ["showBranding", "Tampilkan branding"]] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={research.videoOverlaySettings[key]} onChange={(event) => onOverlaySettingsChange({ [key]: event.target.checked })}/>{label}</label>)}
              <label className="editor-field">Nama branding<input maxLength={40} value={research.videoOverlaySettings.brandName} disabled={!research.videoOverlaySettings.showBranding} onChange={(event) => onOverlaySettingsChange({ brandName: event.target.value })}/></label>
            </fieldset>
            <div className="editor-info-box"><strong>Tampilan teks</strong><span>Headline dan subtitle mengikuti template Remotion aktif. Mengubah naskah dapat membuat audio AI perlu disetujui ulang.</span></div>
          </>}

          {tab === "motion" && <>
            <section className="editor-motion-direction" aria-labelledby="editor-motion-direction-title">
              <div className="editor-section-heading"><h3 id="editor-motion-direction-title">Motion Direction</h3><p>Atur efek visual scene ini. Efek dapat digabung; transisi antar-scene ada di tab Transisi.</p></div>
              <div className="editor-motion-effects" aria-label="Animasi Scene">
                <strong>Animasi Scene</strong>
                {motionEffects.map(({ cue, label }) => {
                  const active = sceneMotionPlan.some((plan) => plan.cue === cue);
                  return <div className={`editor-motion-effect ${selectedMotionCue === cue ? "selected" : ""}`} data-cue={cue} key={cue}>
                    <label><input type="checkbox" checked={active} aria-label={`Aktifkan ${label}`} disabled={busy} onChange={(event) => toggleMotionEffect(cue, event.target.checked)}/><span>{label}</span></label>
                    <button type="button" className="button button-light" aria-pressed={selectedMotionCue === cue} onClick={() => setSelectedMotionCue(cue)}>{active ? "Edit" : "Pilih"}</button>
                  </div>;
                })}
              </div>
              {selectedMotionPlan ? <div className="editor-motion-parameters" aria-label={`Parameter ${motionEffects.find((effect) => effect.cue === selectedMotionCue)?.label}`}>
                <strong>Edit {motionEffects.find((effect) => effect.cue === selectedMotionCue)?.label}</strong>
                {selectedMotionCue === "slide" || selectedMotionCue === "pan" || selectedMotionCue === "zoom" || selectedMotionCue === "parallax" ? <label className="editor-field">Arah<select value={selectedMotionPlan.direction ?? (selectedMotionCue === "slide" ? "up" : selectedMotionCue === "pan" ? "left" : selectedMotionCue === "zoom" ? "in" : "both")} disabled={busy} onChange={(event) => editMotionEffect(selectedMotionCue, { direction: event.target.value as MotionCuePlan["direction"] })}>
                  {(selectedMotionCue === "zoom" ? [["in", "Zoom In"], ["out", "Zoom Out"]] : selectedMotionCue === "parallax" ? [["both", "Dua arah"], ["left", "Kiri"], ["right", "Kanan"], ["up", "Atas"], ["down", "Bawah"]] : [["left", "Kiri"], ["right", "Kanan"], ["up", "Atas"], ["down", "Bawah"]]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select></label> : null}
                <div className="editor-motion-timing-fields">
                  <label className="editor-field">Durasi · detik<input type="number" aria-label={`Durasi ${motionEffects.find((effect) => effect.cue === selectedMotionCue)?.label} (detik)`} min="0.1" max="10" step="0.1" value={(selectedMotionPlan.durationFrames / FPS).toFixed(1)} disabled={busy} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) editMotionEffect(selectedMotionCue, { durationFrames: Math.max(1, Math.min(300, Math.round(value * FPS))) }); }}/></label>
                  <label className="editor-field">Delay · detik<input type="number" aria-label={`Delay ${motionEffects.find((effect) => effect.cue === selectedMotionCue)?.label} (detik)`} min="0" max="30" step="0.1" value={(selectedMotionPlan.delayFrames / FPS).toFixed(1)} disabled={busy} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) editMotionEffect(selectedMotionCue, { delayFrames: Math.max(0, Math.min(900, Math.round(value * FPS))) }); }}/></label>
                </div>
                <label className="editor-field">Easing<select value={selectedMotionPlan.easing} disabled={busy} onChange={(event) => editMotionEffect(selectedMotionCue, { easing: event.target.value as MotionCuePlan["easing"] })}>{Object.entries(motionEasingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                {["slide", "scale", "pan", "zoom", "parallax", "pulse"].includes(selectedMotionCue) && <label className="editor-range-field">Intensitas · {Math.round((selectedMotionPlan.intensity ?? 1) * 100)}%<input type="range" min="0.25" max="2" step="0.05" value={selectedMotionPlan.intensity ?? 1} disabled={busy} aria-label={`Intensitas ${motionEffects.find((effect) => effect.cue === selectedMotionCue)?.label}`} onChange={(event) => editMotionEffect(selectedMotionCue, { intensity: Number(event.target.value) })}/></label>}
                <label className="editor-field">Target<select value={selectedScene.sceneMedia ? "all" : selectedMotionPlan.targetLayer} disabled={busy || Boolean(selectedScene.sceneMedia)} onChange={(event) => editMotionEffect(selectedMotionCue, { targetLayer: event.target.value })}>
                  {selectedScene.sceneMedia ? <option value="all">Seluruh klip</option> : <><option value="all">Semua layer scene</option>{selectedComposition.layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.id}</option>)}</>}
                </select></label>
                <button type="button" className="button button-light full-button editor-motion-delete" onClick={() => toggleMotionEffect(selectedMotionCue, false)} disabled={busy}><Trash2 size={14} aria-hidden="true"/> Hapus efek {motionEffects.find((effect) => effect.cue === selectedMotionCue)?.label}</button>
              </div> : <div className="editor-info-box"><strong>Pilih efek untuk mengedit</strong><span>Aktifkan checkbox, lalu atur timing, easing, arah, intensitas, dan target.</span></div>}
              <div className="editor-motion-direction-actions">
                <button type="button" className="button button-primary full-button" onClick={previewSingleScene}>Pratinjau Efek{selectedMotionPlan ? ` · ${motionEffects.find((effect) => effect.cue === selectedMotionCue)?.label}` : " Scene"}</button>
                <button type="button" className="button button-light" onClick={() => emitMotionPlan(sceneMotionPlan.filter(isSceneTransitionPlan))} disabled={busy}><RotateCcw size={14} aria-hidden="true"/> Hapus semua efek</button>
              </div>
              <div className="editor-info-box"><strong>{activeMotionEffects.length ? activeMotionEffects.map((plan) => motionEffects.find((effect) => effect.cue === plan.cue)?.label).join(" · ") : "Tanpa gerakan tambahan"}</strong><span>{selectedScene.sceneMedia ? "GIF/MP4 Flow tetap menjadi visual utama; efek diterapkan langsung pada klip, tanpa procedural fallback." : "Raster bergerak sebagai satu layer; vector/layer terpisah dapat ditargetkan."} Preview dan MP4 memakai renderer Remotion yang sama.</span></div>
            </section>
            <section className="editor-motion-beats" aria-label="Motion Beats scene">
               {selectedScene.sceneMedia && <div className="editor-info-box"><strong>Klip Flow bergerak sendiri</strong><span>Motion Beat lama tetap tersimpan, tetapi tidak ditumpuk otomatis di atas video.</span></div>}
               <div className="editor-info-box"><strong>{selectedScene.motionActions.length} Motion Beat</strong><span>Beat memakai target/layer stabil dan waktu relatif scene. Timing narasi tetap perkiraan kecuali ada alignment kata.</span></div>
               <div className="editor-info-box"><strong>Preset Motion Beat · overlay/proses</strong><span>Terpisah dari Motion Direction. Preset membuat Motion Beat baru pada scene ini.</span></div>
               <label className="editor-field">Preset Motion Beat<select value={motionBeatPreset} onChange={(event) => setMotionBeatPreset(event.target.value as MotionBeatPreset)}><option value="static">Statis · tanpa Motion Beat</option><option value="gentle">Gerak lembut</option><option value="pan-zoom">Pan & zoom objek</option><option value="process">Animasi proses</option><option value="particles">Aliran partikel</option></select></label>
               <button type="button" className="button button-light full-button" onClick={() => onMotionBeatPreset(selectedScene.sceneId, motionBeatPreset)} disabled={busy || Boolean(selectedScene.sceneMedia)}>Terapkan preset Motion Beat</button>
               <button type="button" className="button button-light full-button" onClick={addMotionBeat} disabled={!selectedImage || Boolean(selectedScene.sceneMedia) || selectedScene.motionActions.length >= 12}><Plus size={14} aria-hidden="true"/> Tambah beat jalur magma</button>
              {!selectedMotionAction && <small>Impor ilustrasi dasar untuk menambah overlay jalur yang bisa dikoreksi di canvas.</small>}
              {selectedMotionAction && selectedBeat && <>
                <label className="editor-field">Kejadian<input maxLength={180} value={selectedMotionAction.description ?? selectedBeat.description} onChange={(event) => editMotionBeat(selectedMotionAction.id, { description: event.target.value })}/></label>
                <label className="editor-field">Layer target<select value={selectedBeat.targetLayerId} onChange={(event) => {
                  const layer = selectedComposition.layers.find((item) => item.id === event.target.value);
                  if (!layer?.nodes.length) return;
                  const role = storyboard.visualWorld?.elements.find((element) => element.layerId === layer.id)?.semanticRole ?? layer.id.replaceAll("-", " ");
                  editMotionBeat(selectedMotionAction.id, { targetLayerId: layer.id, targetNode: `${layer.id}/0`, targetRole: role });
                }}>{selectedComposition.layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.id} · {storyboard.visualWorld?.elements.find((element) => element.layerId === layer.id)?.semanticRole ?? layer.nodes[0]?.type ?? "layer"}</option>)}</select></label>
                <div className="editor-motion-timing-fields">
                  <label className="editor-field">Mulai · detik<input type="number" min="0" max={selectedScene.durationSec} step="0.1" value={selectedBeat.startTimeSec.toFixed(1)} onChange={(event) => editMotionBeat(selectedMotionAction.id, { startTimeSec: Number(event.target.value) })}/></label>
                  <label className="editor-field">Durasi · detik<input type="number" min="0.1" max={selectedScene.durationSec} step="0.1" value={selectedBeat.durationSec.toFixed(1)} onChange={(event) => editMotionBeat(selectedMotionAction.id, { durationSec: Number(event.target.value) })}/></label>
                </div>
                <label className="editor-field">Preset animasi<select value={selectedMotionAction.pathStyle ?? "particles"} onChange={(event) => editMotionBeat(selectedMotionAction.id, { pathStyle: event.target.value as NonNullable<MotionBeat["pathStyle"]> })}><option value="magma">Magma glow</option><option value="lava">Lava reveal</option><option value="smoke">Smoke puffs</option><option value="highlight">Highlight path</option><option value="particles">Particles</option></select></label>
                <label className="editor-field">Easing<select value={selectedMotionAction.easing} onChange={(event) => editMotionBeat(selectedMotionAction.id, { easing: event.target.value as MotionBeat["easing"] })}><option value="linear">Linear</option><option value="easeIn">Masuk perlahan</option><option value="easeOut">Keluar perlahan</option><option value="easeInOut">Masuk-keluar</option></select></label>
                <div className="editor-info-box"><strong>{selectedMotionAction.kind.replaceAll("-", " ")} · {selectedBeat.targetRole}</strong><span>{selectedMotionAction.path?.length ?? 0} titik jalur{selectedBeat.motionPathRef ? ` · ${selectedBeat.motionPathRef}` : ""}. Seret titik pada canvas; panah keyboard juga bisa. Perubahan tersimpan bersama scene.</span></div>
                {selectedMotionAction.path && <button type="button" className="button button-light full-button" onClick={() => setSelectedMotionBeatRef({ sceneId: selectedScene.sceneId, actionId: selectedMotionAction.id })}>Pilih jalur di canvas</button>}
                <button type="button" className="button button-light full-button editor-motion-delete" onClick={() => {
                  const remaining = selectedScene.motionActions.filter((action) => action.id !== selectedMotionAction.id);
                  onChange(selectedScene.sceneId, { motionActions: remaining, motionStatus: remaining.length ? "ready_for_review" : "static", motionSummary: remaining.length ? `${remaining.length} Motion Beat tersimpan.` : "Belum ada Motion Beat." });
                  setSelectedMotionBeatRef(null);
                }}><Trash2 size={14} aria-hidden="true"/> Hapus beat</button>
              </>}
            </section>
            <label className="editor-field">Intensitas Motion Beat<select id="editor-motion-intensity" value={selectedScene.motionIntensity} onChange={(event) => onGenerateMotion(selectedScene.sceneId, event.target.value as MotionIntensity)} disabled={busy}><option value="subtle">Subtle</option><option value="balanced">Balanced</option><option value="expressive">Expressive</option></select></label>
            <button type="button" className="button button-light full-button" onClick={() => onPrepareMotion(selectedScene.motionIntensity)} disabled={!saved || busy || motionPreparation?.status === "running"}>Siapkan gerak semua scene</button>
            {motionPreparation?.status === "running" && <button type="button" className="button button-light full-button" onClick={onCancelMotion}>Batalkan persiapan gerak</button>}
            {motionPreparation && ["failed", "partial_failure", "cancelled"].includes(motionPreparation.status) && <button type="button" className="button button-light full-button" onClick={() => onRetryMotion(motionPreparation.scenes.filter((item) => ["failed", "cancelled"].includes(item.status)).map((item) => item.sceneId), motionPreparation.intensity)} disabled={!saved || busy}>Coba ulang scene gagal</button>}
          </>}

          {tab === "transition" && <section className="editor-motion-transition-panel" aria-labelledby="editor-transition-title">
            <div className="editor-section-heading"><h3 id="editor-transition-title">Transisi Antar Scene</h3><p>Pilih transition untuk scene masuk. Preview menampilkan scene keluar dan masuk pada timeline Remotion.</p></div>
            <div className="editor-transition-pair" aria-label="Pasangan scene transisi"><span>{previousScene?.onScreenText ?? "Awal video"}</span><b aria-hidden="true">→</b><span>{selectedScene.headline}</span></div>
            {!previousScene && <div className="editor-info-box"><strong>Scene pertama</strong><span>Tidak punya scene sebelumnya; transisi masuk tidak berlaku.</span></div>}
            <fieldset className="editor-motion-transition"><legend>Efek transisi</legend><div>
              {([ ["cut", "Cut"], ["dissolve", "Crossfade"], ["slide-transition", "Slide"], ["wipe", "Wipe"] ] as const).map(([cue, label]) => <button type="button" key={cue} className={`button ${transitionCue === cue ? "button-primary" : "button-light"}`} aria-pressed={transitionCue === cue} onClick={() => changeTransition(cue)} disabled={busy || !previousScene}>{label}</button>)}
            </div></fieldset>
            {activeTransitionPlan && transitionCue !== "cut" && <div className="editor-motion-timing-fields">
              <label className="editor-field">Durasi transisi · detik<input type="number" aria-label="Durasi transisi (detik)" min="0.1" max="10" step="0.1" value={(activeTransitionPlan.durationFrames / FPS).toFixed(1)} disabled={busy || !previousScene} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) editTransition({ durationFrames: Math.max(1, Math.min(300, Math.round(value * FPS))) }); }}/></label>
              <label className="editor-field">Delay · detik<input type="number" aria-label="Delay transisi (detik)" min="0" max="30" step="0.1" value={(activeTransitionPlan.delayFrames / FPS).toFixed(1)} disabled={busy || !previousScene} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) editTransition({ delayFrames: Math.max(0, Math.min(900, Math.round(value * FPS))) }); }}/></label>
              {transitionCue === "slide-transition" && <label className="editor-field">Arah Slide<select value={activeTransitionPlan.direction ?? "right"} disabled={busy || !previousScene} onChange={(event) => editTransition({ direction: event.target.value as MotionCuePlan["direction"] })}>{[["left", "Dari kiri"], ["right", "Dari kanan"], ["up", "Dari atas"], ["down", "Dari bawah"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
              <label className="editor-field">Easing<select value={activeTransitionPlan.easing} disabled={busy || !previousScene} onChange={(event) => editTransition({ easing: event.target.value as MotionCuePlan["easing"] })}>{Object.entries(motionEasingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            </div>}
            {previousScene && <button type="button" className="button button-primary full-button" onClick={previewTransition}>Pratinjau transisi · 2 scene</button>}
          </section>}

          {tab === "audio" && <>
            {audio ? <><div className="editor-info-box"><strong>{audio.source === "tts" ? audio.tts?.voiceName ?? "AI Voice" : audio.name}</strong><span>{audio.durationSec.toFixed(1)} detik · {audio.timingMode === "estimated" ? "timing perkiraan" : "durasi disesuaikan"}</span></div><audio className="editor-audio-preview" controls preload="metadata" src={`/${audio.file.split("/").map(encodeURIComponent).join("/")}`} aria-label="Pratinjau audio narasi"/><small>Audio aktif project. Timing per kata tidak tersedia untuk semua sumber.</small></> : <div className="editor-info-box"><strong>Audio belum tersedia</strong><span>{narrationMode === "manual" ? "Mode durasi manual aktif; render senyap tetap perlu konfirmasi." : "Render tanpa narasi memerlukan konfirmasi eksplisit."}</span></div>}
            <div className="editor-info-box"><strong>{audio?.source === "tts" ? audioMatchesNarration ? "Approval TTS aktif" : "Naskah berubah · perlu review TTS" : audio ? "Audio upload aktif" : hasPendingAudio ? "Preview TTS menunggu approval" : "Belum ada audio disetujui"}</strong><span>{hasPendingAudio ? "Kandidat TTS baru menunggu approval. " : ""}{audio ? `Scene ${selectedTrackIndex + 1}: ${selectedSpan.startSec.toFixed(1)}–${selectedSpan.endSec.toFixed(1)} dtk · audio ${audio.durationSec.toFixed(1)} dtk.` : hasPendingAudio ? "Setujui atau ganti kandidat di langkah Narasi." : "Generate, upload, atau setujui narasi di langkah Narasi."}</span></div>
            <div className="editor-info-box"><strong>Subtitle scene</strong><span>{sourceResearchScene.captionSegments?.length ? `${sourceResearchScene.captionSegments.length} segmen tersimpan.` : "Dibentuk dari narasi scene saat preview dan render."}</span></div>
            <button type="button" className="button button-light full-button" onClick={onOpenNarration}>Kelola audio dan suara di Narasi</button>
          </>}

          {tab === "visual" && selectedScene.illustrationWorkflow === "google-flow" && <GoogleFlowPanel research={research} storyboard={storyboard} scene={selectedScene} assets={assets} animationStyleId={animationStyleId} busy={busy} showPanel onFlowPromptChange={onFlowPromptChange} onFlowVisualModeChange={onFlowVisualModeChange} onStyleLockChange={onStyleLockChange} onPreparePrompts={onPrepareFlowPrompts} onApplyStyleLock={onApplyStyleLock} onUploadReference={onUploadFlowReference} onUploadIllustration={onImportFlowIllustration} onPrepareSceneMedia={onPrepareSceneMedia} onApplySceneMedia={onApplySceneMedia} onApplyBatch={onApplyFlowBatch} onRegisterBatchLauncher={registerBatchLauncher}/>}
        </div>
        {tab === "visual" && <footer className="editor-inspector-footer">
          {sceneIssueList.length > 0 && <details className="editor-advanced editor-validation"><summary>{needsArtwork ? "Masalah visual" : `${sceneIssueList.length} pemeriksaan`}</summary>{needsArtwork && <p>Ilustrasi belum tersedia.</p>}{!needsArtwork && <ul>{sceneIssueList.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</details>}
          <button type="button" className={`button ${selectedScene.approved ? "button-light" : "button-primary"} full-button`} onClick={() => onChange(selectedScene.sceneId, { approved: !selectedScene.approved })} disabled={busy || (!selectedScene.approved && (needsArtwork || sceneIssueList.length > 0))}>{selectedScene.approved ? "Batalkan persetujuan" : "Setujui scene"}</button>
        </footer>}
      </aside>
    </div>

    {libraryScene && <SmartAssetLibraryDialog open={Boolean(librarySceneId)} scene={libraryScene} research={research} storyboard={storyboard} projectId={projectId} busy={busy} initialTab={libraryInitialTab} onClose={onCloseLibrary} onUseAsset={onUseAsset} onImportOpenverse={onImportOpenverse} onImportTabler={onImportTabler} onUseReusableScene={onUseReusableScene} onSaveReusableScene={onSaveReusableScene} onDeleteAsset={onDeleteAsset}/>}
  </section>;
}

function formatTime(seconds: number) {
  const whole = Math.floor(Math.max(0, seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

function sceneIllustrationStatus(scene: VisualStoryboardScene, storyboard: VisualStoryboard) {
  if (scene.approved) return "Approved";
  if (!sceneHasPrimaryIllustration(scene, storyboard)) return "Perlu Ilustrasi";
  if (scene.flowStatus === "illustration-imported") return "Ilustrasi Diimport";
  return scene.authoringConfirmed ? "Siap Ditinjau" : "Perlu Ditinjau";
}

function sceneHasPrimaryIllustration(scene: VisualStoryboardScene, storyboard: VisualStoryboard) {
  return Boolean(scene.sceneMedia) || visualImageNodes(compositionForVisualScene(storyboard, scene)).length > 0 || scene.compositionSource === "ai-vector";
}

const SceneThumbnail = React.memo(function SceneThumbnail({ scene, storyboard, preset, mediaError }: { scene: ResearchPackage["scenes"][number]; storyboard: VisualStoryboard; preset: ResearchPackage["visualPreset"]; mediaError?: string }) {
  const visual = storyboard.scenes.find((item) => item.sceneId === scene.id)!;
  const composition = compositionForVisualScene(storyboard, visual);
  return <svg className="editor-scene-thumbnail" viewBox="0 0 1080 1920" role="img" aria-label={`Ilustrasi scene: ${scene.onScreenText}`}>
    {mediaError ? <><rect width="1080" height="1920" fill="var(--surface-muted)"/><foreignObject x="100" y="800" width="880" height="300"><div className="editor-thumbnail-media-error">MEDIA ERROR<br/>{mediaError}</div></foreignObject></> : scene.sceneMedia ? <image href={`/scene-media/${encodeURIComponent(scene.sceneMedia.posterFile)}`} x="0" y="0" width="1080" height="1920" preserveAspectRatio={scene.sceneMedia.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"}/> : <VisualCompositionView scene={scene} composition={composition} style={visualStyles[preset]} preset={preset} frame={Math.floor(scene.endSec * FPS * .4)} progress={.4}/>}
    <rect x="50" y="40" width="980" height="400" rx="30" fill={storyboard.palette.canvas} opacity=".94"/>
    <foreignObject x="80" y="82" width="920" height="320"><div className="editor-thumbnail-headline">{visual.headline}</div></foreignObject>
  </svg>;
});

function CaptionSegmentsEditor({ scene, onChange }: { scene: ResearchPackage["scenes"][number]; onChange: (segments: ResearchPackage["scenes"][number]["captionSegments"]) => void }) {
  const [draft, setDraft] = useState(() => JSON.stringify(captionSegmentsForScene(scene), null, 2));
  const [error, setError] = useState("");

  function edit(value: string) {
    setDraft(value);
    try {
      const parsed = captionSegmentsSchema.safeParse(JSON.parse(value));
      if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Caption segments tidak valid."); return; }
      setError("");
      onChange(parsed.data);
    } catch { setError("JSON caption segments belum lengkap/valid."); }
  }

  function reset() {
    const generated = captionSegmentsForScene({ ...scene, captionSegments: undefined });
    setDraft(JSON.stringify(generated, null, 2));
    setError("");
    onChange(undefined);
  }

  return <details className="visual-json-editor"><summary>{scene.captionSegments ? "Edit caption phrases" : "Atur caption phrases"} · {scene.captionSegments ? "manual timing" : "estimasi otomatis"}</summary><textarea rows={7} spellCheck={false} value={draft} onChange={(event) => edit(event.target.value)} aria-label="JSON caption phrases"/><div className="caption-editor-note">Timing frasa 0–1 dalam scene; bukan word-level sync. <button type="button" className="text-button" onClick={reset}>Pakai segmentasi otomatis</button></div>{error && <span role="alert">{error}</span>}</details>;
}

function IllustrationPromptPanel({ prompt, providerCatalog, providerId, model, resolution, candidate, fit, generating, error, copied, onPrompt, onProvider, onModel, onResolution, onFit, onGenerate, onCopy, onApply }: {
  prompt: string;
  providerCatalog: AiImageProviderCatalog | null;
  providerId: string;
  model: string;
  resolution: string;
  candidate?: VisualAsset;
  fit: "cover" | "contain";
  generating: boolean;
  error: string;
  copied: boolean;
  onPrompt: (value: string) => void;
  onProvider: (value: string) => void;
  onModel: (value: string) => void;
  onResolution: (value: string) => void;
  onFit: (value: "cover" | "contain") => void;
  onGenerate: () => void;
  onCopy: () => void;
  onApply: () => void;
}) {
  const provider = providerCatalog?.providers.find((entry) => entry.id === providerId);
  const ready = Boolean(providerCatalog?.configured && provider?.models.some((entry) => entry.id === model));
  return <section className="editor-ai-image-panel" aria-label="Buat ilustrasi AI Image">
    <div><strong>Prompt ilustrasi</strong><small>AI Image API hanya berjalan setelah konfigurasi dan konfirmasi biaya.</small></div>
    <label className="editor-field">Prompt<textarea rows={7} maxLength={12000} value={prompt} onChange={(event) => onPrompt(event.target.value)}/></label>
    <button type="button" className="button button-light full-button" onClick={onCopy}>Salin prompt</button>{copied && <small role="status">Prompt disalin.</small>}
    {!providerCatalog && <p className="editor-ai-config-message" role="status">Memeriksa konfigurasi AI Image API…</p>}
    {providerCatalog && !providerCatalog.configured && <p className="editor-ai-config-message" role="status">AI Image API belum dikonfigurasi. Atur `HF_TOKEN`, `HF_IMAGE_GENERATION_ENABLED=true`, dan `HF_IMAGE_ALLOW_PAID=true` di server. Google Flow manual tidak perlu HF_TOKEN.</p>}
    {providerCatalog?.configured && !providerCatalog.providers.length && <p className="editor-ai-config-message" role="status">Provider belum menyediakan model yang bisa digunakan. Periksa konfigurasi Hugging Face di server.</p>}
    {providerCatalog?.configured && providerCatalog.providers.length > 0 && <>
      {providerCatalog.providers.length > 1 && <label className="editor-field">Provider<select value={providerId} onChange={(event) => onProvider(event.target.value)}>{providerCatalog.providers.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}</select></label>}
      {provider?.models.length ? <label className="editor-field">Model<select value={model} onChange={(event) => onModel(event.target.value)}>{provider.models.map((entry) => <option key={entry.id} value={entry.id}>{entry.id}</option>)}</select></label> : <p className="editor-ai-config-message">Provider ini belum punya model tersedia.</p>}
      {provider?.resolutions.length ? <label className="editor-field">Resolusi<select value={resolution} onChange={(event) => onResolution(event.target.value)}>{provider.resolutions.map((entry) => <option key={entry} value={entry}>{entry.replace("x", " × ")}</option>)}</select></label> : <p className="editor-ai-config-message">Provider ini belum menyediakan resolusi.</p>}
      <label className="editor-field">Fit gambar<select value={fit} onChange={(event) => onFit(event.target.value as "cover" | "contain")}><option value="contain">Contain</option><option value="cover">Cover</option></select></label>
      <small>{provider?.costDisclosure ?? providerCatalog.message ?? "Harga, saldo, dan kredit tidak dapat diverifikasi; request dapat dikenai biaya."}</small>
      <button type="button" className="button button-primary full-button" onClick={onGenerate} disabled={!ready || generating || !resolution || prompt.trim().length < 20}>{generating ? "Membuat satu gambar…" : "Generate satu gambar"}</button>
    </>}
    {error && <p role="alert">{error}</p>}
    {candidate && <div className="editor-ai-candidate"><strong>Preview kandidat · belum diterapkan</strong><img src={`/visual-assets/${candidate.file}`} alt="Kandidat ilustrasi yang dihasilkan"/><small>{candidate.width}×{candidate.height} · {candidate.provider} · {candidate.model}</small><button type="button" className="button button-primary full-button" onClick={onApply}>Gunakan ilustrasi</button></div>}
  </section>;
}
