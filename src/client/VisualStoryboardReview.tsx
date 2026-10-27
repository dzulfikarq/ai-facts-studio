import React, { useEffect, useRef, useState } from "react";
import type { ResearchPackage } from "../domain/research";
import { applyVisualStoryboard, illustrationSourceForScene, type VisualQualityGate, type VisualStoryboard, type VisualStoryboardScene } from "../domain/visual-storyboard";
import { VisualCompositionView } from "../video/visual-primitives";
import { visualStyles } from "../video/style-config";
import type { VisualAsset } from "../domain/visual-assets";
import { buildIllustrationPrompt } from "../domain/illustration-prompt";
import type { VisualPreparationJob } from "../domain/visual-preparation";
import type { MotionPreparationJob } from "../domain/motion-preparation";
import { motionIntensities, type MotionIntensity } from "../domain/motion-director";
import type { OpenverseImage, ReusableSceneInput, TablerIconEntry } from "../domain/asset-library";
import { SmartAssetLibraryDialog, type AssetPlacement, type ReusableSceneEntry } from "./SmartAssetLibraryDialog";

type IllustrationImportInfo = { source: "user-upload" | "ai-generated"; prompt?: string; license: string; provider?: string; model?: string };
type AiImageStatus = "Not Configured" | "Ready" | "Generating" | "Rate Limited" | "Quota Exhausted" | "Failed";
type AiImageProviderCatalog = {
  status: AiImageStatus;
  configured: boolean;
  providers: Array<{ id: string; displayName: string; models: Array<{ id: string; license: string | null }>; selectedModel: string; supportedAspectRatios: string[]; resolutions: string[]; estimatedCost: null; costDisclosure: string }>;
  message: string | null;
  retryAt: string | null;
};

export function VisualStoryboardReview({ research, storyboard, gate, saved, busy, generatingSceneId, onChange, onGenerate, onUseCurrentComposition, assets, projectId, projectTitle, librarySceneId, libraryInitialTab, onOpenLibrary, onCloseLibrary, onDeleteAsset, onUploadAsset, onUseAsset, onApplyGeneratedAiImage, onImportOpenverse, onImportTabler, onUseReusableScene, onSaveReusableScene, onConfirmUserAsset, aiMode, plannerAvailable, models, selectedModel, onSelectModel, planningSceneId, onPlan, vectorAvailable, vectorizingSceneId, onGenerateVector, onPrepareAll, onPrepareIssues, onGenerateMotion, onPrepareMotion, onCancelMotion, onRetryMotion, onSelectAiImageSource, onGenerateAiImage, imageProviderCatalog, preparation, motionPreparation }: {
  research: ResearchPackage;
  storyboard: VisualStoryboard;
  gate: VisualQualityGate;
  saved: boolean;
  busy: boolean;
  generatingSceneId: string | null;
  onChange: (sceneId: string, change: Partial<VisualStoryboardScene>) => void;
  onGenerate: (sceneId: string) => void;
  onUseCurrentComposition: (sceneId: string) => void;
  assets: VisualAsset[];
  projectId: string;
  projectTitle: string;
  librarySceneId: string | null;
  libraryInitialTab: "mine" | "scenes";
  onOpenLibrary: (sceneId: string, tab?: "mine" | "scenes") => void;
  onCloseLibrary: () => void;
  onDeleteAsset: (assetId: string) => void;
  onUploadAsset: (sceneId: string, file: File, metadata: IllustrationImportInfo) => void;
  onUseAsset: (sceneId: string, assetId: string, placement: AssetPlacement) => void;
  onApplyGeneratedAiImage: (sceneId: string, asset: VisualAsset, fit: "cover" | "contain") => void;
  onImportOpenverse: (sceneId: string, image: OpenverseImage, placement: AssetPlacement) => void;
  onImportTabler: (sceneId: string, icon: TablerIconEntry, placement: AssetPlacement) => void;
  onUseReusableScene: (sceneId: string, scene: ReusableSceneEntry) => void;
  onSaveReusableScene: (sceneId: string, scene: Omit<ReusableSceneInput, "thumbnailDataUrl"> & { thumbnailDataUrl: string }) => Promise<void>;
  onConfirmUserAsset: (sceneId: string) => void;
  aiMode: "development" | "production" | null;
  plannerAvailable: boolean;
  models: Array<{ id: string; name: string }>;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  planningSceneId: string | null;
  onPlan: (sceneId: string) => void;
  vectorAvailable: boolean;
  vectorizingSceneId: string | null;
  onGenerateVector: (sceneId: string) => void;
  onPrepareAll: () => void;
  onPrepareIssues: (sceneIds: string[]) => void;
  onGenerateMotion: (sceneId: string, intensity: MotionIntensity) => void;
  onPrepareMotion: (intensity: MotionIntensity) => void;
  onCancelMotion: () => void;
  onRetryMotion: (sceneIds: string[], intensity: MotionIntensity) => void;
  onSelectAiImageSource: (sceneId: string) => Promise<boolean>;
  onGenerateAiImage: (sceneId: string, providerId: string, model: string, prompt: string, resolution: string) => Promise<VisualAsset | null>;
  imageProviderCatalog: AiImageProviderCatalog | null;
  preparation: VisualPreparationJob | null;
  motionPreparation: MotionPreparationJob | null;
}) {
  const [promptSceneId, setPromptSceneId] = useState<string | null>(null);
  const [promptCopiedSceneId, setPromptCopiedSceneId] = useState<string | null>(null);
  const [usePreviousReference, setUsePreviousReference] = useState<Record<string, boolean>>({});
  const [licenses, setLicenses] = useState<Record<string, string>>({});
  const [providers, setProviders] = useState<Record<string, string>>({});
  const [modelsByScene, setModelsByScene] = useState<Record<string, string>>({});
  const [promptsByScene, setPromptsByScene] = useState<Record<string, string>>({});
  const [imageProvidersByScene, setImageProvidersByScene] = useState<Record<string, string>>({});
  const [imageModelsByScene, setImageModelsByScene] = useState<Record<string, string>>({});
  const [imageResolutionsByScene, setImageResolutionsByScene] = useState<Record<string, string>>({});
  const [imageFitsByScene, setImageFitsByScene] = useState<Record<string, "cover" | "contain">>({});
  const [generatedAssetsByScene, setGeneratedAssetsByScene] = useState<Record<string, VisualAsset>>({});
  const [generatingAiImageSceneId, setGeneratingAiImageSceneId] = useState<string | null>(null);
  const [aiImageErrors, setAiImageErrors] = useState<Record<string, string>>({});
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);
  const [previewFrame, setPreviewFrame] = useState(0);
  const [motionIntensity, setMotionIntensity] = useState<MotionIntensity>("balanced");
  const [sourceSceneId, setSourceSceneId] = useState<string | null>(null);
  const previewDialog = useRef<HTMLDialogElement>(null);
  const sourceDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (previewSceneId && previewDialog.current && !previewDialog.current.open) previewDialog.current.showModal(); }, [previewSceneId]);
  useEffect(() => { if (sourceSceneId && sourceDialog.current && !sourceDialog.current.open) sourceDialog.current.showModal(); }, [sourceSceneId]);
  const approvedCount = storyboard.scenes.filter((scene) => scene.approved).length;
  const allApproved = approvedCount === storyboard.scenes.length && gate.ready;
  const previewResearch = applyVisualStoryboard(research, storyboard);
  const previewScene = storyboard.scenes.find((scene) => scene.sceneId === previewSceneId);
  const sourceScene = storyboard.scenes.find((scene) => scene.sceneId === sourceSceneId);
  const libraryScene = storyboard.scenes.find((scene) => scene.sceneId === librarySceneId);
  const previewSceneSource = previewScene ? previewResearch.scenes.find((scene) => scene.id === previewScene.sceneId) : undefined;
  const previewMaxFrame = previewScene ? Math.max(0, Math.floor(previewScene.durationSec * 30) - 1) : 0;
  const activePreviewFrame = Math.min(previewFrame, previewMaxFrame);
  const previewProgress = previewScene ? activePreviewFrame / Math.max(1, previewMaxFrame) : 0;
  const liveAttentionScenes = storyboard.scenes.filter((scene) => !scene.approved && (scene.authoringStatus === "needs_visual_authoring" || (gate.scenes[scene.sceneId]?.length ?? 0) > 0));
  const readyForReviewCount = storyboard.scenes.filter((scene) => !scene.approved && scene.authoringStatus !== "needs_visual_authoring" && !(gate.scenes[scene.sceneId]?.length)).length;
  const repairableSceneIds = liveAttentionScenes.filter((scene) => scene.authoringStatus === "needs_visual_authoring" && !scene.authoringConfirmed && scene.compositionSource !== "manual" && scene.compositionSource !== "ai-vector"
    && !scene.composition.layers.some((layer) => layer.nodes.some((node) => node.type === "image" || node.type === "group" && node.children.some((child) => child.type === "image")))).map((scene) => scene.sceneId);
  const retryableMotionSceneIds = motionPreparation?.scenes.filter((scene) => scene.status === "failed" || scene.status === "cancelled").map((scene) => scene.sceneId) ?? [];
  const sourceActionsDisabled = busy || generatingSceneId !== null || planningSceneId !== null || vectorizingSceneId !== null || generatingAiImageSceneId !== null;
  const closeSourceDialog = () => { sourceDialog.current?.close(); setSourceSceneId(null); };
  useEffect(() => { setPreviewFrame(0); }, [previewSceneId]);
  return <section className="visual-storyboard-review" aria-label="Visual Storyboard Review">
    <header className="visual-workflow-header">
      <div><span className="eyebrow">UNIFIED VISUAL WORKFLOW · SMART HYBRID</span><h2>{projectTitle}</h2><p>{storyboard.scenes.length} scene · review visual tetap wajib sebelum approval.</p></div>
      <div className="visual-workflow-counts" aria-label="Ringkasan status visual"><span><strong>{readyForReviewCount}</strong> Ready for Review</span><span><strong>{liveAttentionScenes.length}</strong> Needs Attention</span><span><strong>{approvedCount}</strong> Approved</span></div>
    </header>
    <div className="visual-preparation-actions">
      <button type="button" className="button button-primary" onClick={onPrepareAll} disabled={!saved || busy || preparation?.status === "running"}>{preparation?.status === "running" ? "Menyiapkan Ilustrasi…" : "Siapkan Semua Ilustrasi"}</button>
      <button type="button" className="button button-light" onClick={() => onPrepareIssues(repairableSceneIds)} disabled={!repairableSceneIds.length || !saved || busy || preparation?.status === "running"}>Perbaiki Scene Bermasalah</button>
      {!saved && <span role="status">Simpan perubahan sebelum menyiapkan ilustrasi.</span>}
    </div>
    {preparation && <div className={`visual-preparation-progress ${preparation.status === "partial_failure" || preparation.status === "failed" ? "attention" : ""}`} aria-live="polite">
      <div><strong>{preparation.status === "running" ? `Menyiapkan scene ${preparation.processed + 1} dari ${preparation.total}` : `Batch terakhir · ${preparation.status === "completed" ? "selesai" : preparation.status === "partial_failure" ? "selesai dengan kendala" : "gagal"}`}</strong><span>{preparation.readyForReview} siap review · {preparation.needsAttention} perlu perhatian · {preparation.failed} gagal · {preparation.approved} approved</span></div>
      {preparation.status === "running" && <progress max={Math.max(1, preparation.total)} value={preparation.processed} aria-label="Progress persiapan ilustrasi"/>}
      {preparation.currentSceneId && <small>Scene aktif: {storyboard.scenes.find((scene) => scene.sceneId === preparation.currentSceneId)?.sceneNumber ?? "—"}. Scene lain tetap diproses jika satu scene gagal.</small>}
    </div>}
    <div className="motion-preparation-panel">
      <div className="motion-preparation-heading"><div><span className="eyebrow">DETERMINISTIC MOTION DIRECTOR</span><strong>Gerak mengikuti narasi dan objek yang tersedia</strong><small>Tidak ada AI request saat preview/render. Raster tunggal hanya bergerak sebagai satu gambar.</small></div>
        <label htmlFor="motion-intensity">Motion Intensity<select id="motion-intensity" value={motionIntensity} onChange={(event) => setMotionIntensity(event.target.value as MotionIntensity)} disabled={busy}>{motionIntensities.map((value) => <option key={value} value={value}>{value === "balanced" ? "Balanced · default" : value[0]!.toUpperCase() + value.slice(1)}</option>)}</select></label>
      </div>
      <div className="motion-preparation-actions">
        <button type="button" className="button button-primary" onClick={() => onPrepareMotion(motionIntensity)} disabled={!saved || busy || motionPreparation?.status === "running"}>Siapkan Animasi Semua Scene</button>
        {motionPreparation?.status === "running" && <button type="button" className="button button-light" onClick={onCancelMotion}>Batalkan batch</button>}
        {retryableMotionSceneIds.length > 0 && motionPreparation?.status !== "running" && <button type="button" className="button button-light" onClick={() => onRetryMotion(retryableMotionSceneIds, motionPreparation?.intensity ?? motionIntensity)} disabled={!saved || busy}>Retry {retryableMotionSceneIds.length} scene gagal/dibatalkan</button>}
        {!saved && <span role="status">Simpan storyboard sebelum Motion Director berjalan.</span>}
      </div>
    </div>
    {motionPreparation && <div className={`visual-preparation-progress motion-preparation-progress ${["partial_failure", "failed"].includes(motionPreparation.status) ? "attention" : ""}`} aria-live="polite">
      <div><strong>{motionPreparation.status === "running" ? `Menyiapkan motion ${motionPreparation.processed + 1} dari ${motionPreparation.total}` : `Motion batch · ${motionPreparation.status === "completed" ? "selesai" : motionPreparation.status === "partial_failure" ? "selesai dengan kendala" : motionPreparation.status === "cancelled" ? "dibatalkan" : "gagal"}`}</strong><span>{motionPreparation.readyForReview} siap review · {motionPreparation.preserved} dipertahankan · {motionPreparation.needsAttention} perlu perhatian · {motionPreparation.failed} gagal</span></div>
      {motionPreparation.status === "running" && <progress max={Math.max(1, motionPreparation.total)} value={motionPreparation.processed} aria-label="Progress persiapan motion"/>}
      {motionPreparation.currentSceneId && <small>Scene aktif: {storyboard.scenes.find((scene) => scene.sceneId === motionPreparation.currentSceneId)?.sceneNumber ?? "—"}. Scene approved/bermotion dipertahankan.</small>}
      {motionPreparation.status === "cancelled" && <small>Scene yang selesai tetap tersimpan; scene lain tidak berubah.</small>}
    </div>}
    <div className={`visual-review-state ${gate.status === "needs_visual_authoring" ? "attention" : allApproved ? "approved" : gate.status === "needs_review" ? "review" : "ready"}`} role="status">
      <strong>{allApproved ? "Approved for Motion" : liveAttentionScenes.length ? "Needs Attention" : "Ready for Review"}</strong>
      <span>{approvedCount} approved · {readyForReviewCount} siap direview · {liveAttentionScenes.length} butuh perhatian.</span>
    </div>
    <div className="visual-art-direction">
      <div><span className="eyebrow">2D ART DIRECTION</span><strong>Clean flat illustration · {storyboard.styleId}</strong><small>Headline: {storyboard.headlineStrategy.replaceAll("-", " ")} · Typography: {storyboard.typographyIntent.heading}; {storyboard.typographyIntent.body}. {storyboard.typographyIntent.hierarchy}</small></div>
      <div className="visual-palette" aria-label="Palet warna">
        {Object.entries(storyboard.palette).map(([name, color]) => <span key={name} title={`${name}: ${color}`} style={{ backgroundColor: color }} />)}
      </div>
      <small>Object berulang: {storyboard.reusableWorldObjects.length ? storyboard.reusableWorldObjects.map((id) => id.replaceAll("-", " ")).join(" · ") : "belum ada"}</small>
      <div className="visual-planner-settings"><span>AI Vector: text-only OpenCode. AI Image: {imageProviderCatalog?.status ?? "memeriksa"}. {imageProviderCatalog?.message ?? "Prompt + import manual tetap tersedia."} Source terpisah dari AI Development/Production mode.</span>{aiMode === "development" ? <label>OpenCode model<select value={selectedModel} onChange={(event) => onSelectModel(event.target.value)} disabled={!models.length}>{models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label> : aiMode === "production" ? <span>AI Vector perlu OpenCode Development mode.</span> : <span>AI planner belum dikonfigurasi.</span>}</div>
    </div>
    {!saved && <div className="workflow-alert attention"><span>Simpan Visual Storyboard sebelum lanjut ke motion preview.</span></div>}
    {gate.issues.length > 0 && <p className="visual-gate-summary" role="status">Quality gate menahan approval pada {liveAttentionScenes.length} scene. Penyebab ditampilkan di kartu scene.</p>}
    {gate.reviewNotes.length > 0 && <details className="visual-review-notes"><summary>{gate.reviewNotes.length} catatan review manusia</summary><ul>{gate.reviewNotes.map((note) => <li key={note}>{note}</li>)}</ul></details>}
    <div className="visual-storyboard-grid">
      {storyboard.scenes.map((scene, index) => {
        const source = previewResearch.scenes[index];
        const issues = gate.scenes[scene.sceneId] ?? [];
        const preparationScene = preparation?.status === "running" ? preparation.scenes.find((item) => item.sceneId === scene.sceneId) : undefined;
        const motionJobScene = motionPreparation?.status === "running" ? motionPreparation.scenes.find((item) => item.sceneId === scene.sceneId) : undefined;
        const userStatus = motionJobScene?.status === "preparing" ? "Planning Motion"
          : preparationScene?.status === "preparing" ? "Preparing"
          : preparationScene?.status === "pending" ? "Pending"
            : scene.approved ? "Approved"
              : scene.authoringStatus === "needs_visual_authoring" || issues.length ? "Needs Attention" : "Ready for Review";
        const illustrationSource = illustrationSourceForScene(scene);
        const imageNodes = scene.composition.layers.flatMap((layer) => layer.nodes.flatMap((node) => node.type === "group" ? node.children : [node])).filter((node) => node.type === "image");
        const previousImageScene = storyboard.scenes.slice(0, index).reverse().map((previous) => {
          const image = previous.composition.layers.flatMap((layer) => layer.nodes.flatMap((node) => node.type === "group" ? node.children : [node])).find((node) => node.type === "image");
          if (!image) return null;
          const asset = assets.find((candidate) => candidate.id === image.asset);
          return { scene: previous, image, asset };
        }).find((value) => value !== null);
        const reference = previousImageScene && usePreviousReference[scene.sceneId] ? {
          sceneNumber: previousImageScene.scene.sceneNumber,
          name: previousImageScene.asset?.name ?? `Built-in ${previousImageScene.image.asset}`,
          style: previousImageScene.asset?.style ?? "clean-flat-2d",
        } : undefined;
        const illustrationPrompt = promptsByScene[scene.sceneId] ?? buildIllustrationPrompt({ research, storyboard, scene, previousReference: reference });
        const imageProvider = imageProviderCatalog?.providers.find((provider) => provider.id === (imageProvidersByScene[scene.sceneId] ?? "huggingface-inference"));
        const imageProviderId = imageProvidersByScene[scene.sceneId] ?? imageProvider?.id ?? "";
        const imageModel = imageModelsByScene[scene.sceneId] ?? (imageProvider?.models.some((model) => model.id === imageProvider.selectedModel) ? imageProvider.selectedModel : "");
        const imageResolution = imageResolutionsByScene[scene.sceneId] ?? imageProvider?.resolutions[0] ?? "";
        const imageFit = imageFitsByScene[scene.sceneId] ?? "contain";
        const generatedCandidate = generatedAssetsByScene[scene.sceneId];
        const providerReady = Boolean(imageProviderCatalog?.configured && imageProvider && imageProvider.models.length);
        const imageRateBlocked = imageProviderCatalog?.status === "Rate Limited" || imageProviderCatalog?.status === "Quota Exhausted" || imageProviderCatalog?.status === "Generating";
        const license = licenses[scene.sceneId] ?? "User-provided; license/provenance not specified";
        const sourceInputDisabled = busy || generatingSceneId !== null || planningSceneId !== null || vectorizingSceneId !== null || generatingAiImageSceneId !== null;
        const thumbnailFrame = Math.floor(scene.durationSec * 30 * 0.42);
        const thumbnailProgress = thumbnailFrame / (scene.durationSec * 30);
        return <article className={`visual-scene-card ${scene.approved ? "scene-approved" : ""}`} key={scene.sceneId} data-visual-scene-id={scene.sceneId}>
          <div className="visual-scene-card-head"><span className="scene-number">{String(scene.sceneNumber).padStart(2, "0")}</span><div><strong>Scene {scene.sceneNumber}</strong><small>{scene.durationSec.toFixed(scene.durationSec % 1 ? 1 : 0)} detik · {scene.layout.replaceAll("-", " ")}</small></div><span className={`visual-approval-chip ${userStatus === "Approved" ? "approved" : userStatus === "Needs Attention" ? "attention" : userStatus === "Preparing" ? "preparing" : userStatus === "Pending" ? "pending" : "review"}`}>{userStatus}</span></div>
          <div className={`visual-scene-thumbnail ${scene.authoringStatus === "needs_visual_authoring" && !scene.authoringConfirmed ? "needs-authoring" : ""}`}>
            {scene.authoringStatus === "needs_visual_authoring" && !scene.authoringConfirmed
              ? <div className="visual-author-placeholder"><strong>Visual belum memadai</strong><span>{scene.missingVisuals.join(" · ") || "Konsep inti belum dapat digambarkan akurat."}</span></div>
              : source && <svg viewBox="0 0 1080 1920" role="img" aria-label={`Thumbnail scene ${scene.sceneNumber}: ${scene.headline}`}>
              <VisualCompositionView scene={source} composition={scene.composition} style={visualStyles[research.visualPreset]} preset={research.visualPreset} frame={thumbnailFrame} progress={thumbnailProgress}/>
              <rect x="45" y="34" width="990" height="450" rx="20" fill={storyboard.palette.canvas} opacity=".96"/>
              <text x="84" y="92" fill={storyboard.palette.primary} fontFamily="Arial,sans-serif" fontSize="24" fontWeight="700" letterSpacing="3">AI FACTS · SCENE {String(scene.sceneNumber).padStart(2, "0")}</text>
              <foreignObject x="80" y="126" width="920" height="290"><div className="visual-thumbnail-headline">{scene.headline}</div></foreignObject>
            </svg>}
          </div>
          <div className="visual-scene-fields">
            <label><span>Headline</span><input maxLength={120} value={scene.headline} onChange={(event) => onChange(scene.sceneId, { headline: event.target.value, approved: false })}/></label>
            <p className="visual-summary">{scene.visualSummary}</p>
            <div className="visual-object-plan"><strong>Objek & aset · {scene.compositionSource}</strong><div>{scene.objects.length ? scene.objects.map((object) => <span key={object.objectId}>{object.label}</span>) : imageNodes.length ? <em>Satu raster ilustrasi mewakili adegan; tinjau kecocokan secara manual.</em> : <em>Belum ada objek visual yang aman.</em>}</div></div>
            {scene.relationships.length > 0 && <div className="visual-relations"><strong>Hubungan divisualkan</strong><span>{scene.relationships.map((relation) => `${relation.from} ${relation.relation} ${relation.to}`).join(" · ")}</span></div>}
            {scene.semanticPlan && <div className="visual-semantic-plan"><strong>Semantic plan · {scene.semanticPlan.primaryVisualConcept}</strong><span>Lingkungan: {scene.semanticPlan.environment}</span><span>Proses: {scene.semanticPlan.processAction}</span><span>Gaya / komposisi: {scene.semanticPlan.illustrationStyle} · {scene.semanticPlan.compositionType}</span><span>Required: {scene.semanticPlan.requiredAssets.join(" · ") || "—"} · Supporting: {scene.semanticPlan.supportingAssets.join(" · ") || "—"}</span></div>}
            <div className="visual-focus"><strong>Visual focus</strong><span>{scene.objects.find((object) => object.objectId === scene.visualFocus)?.label ?? "Belum ditentukan"}</span><small>{scene.illustrationIntent}</small></div>
            <label><span>Narasi</span><textarea rows={3} maxLength={2000} value={scene.narrationText} onChange={(event) => onChange(scene.sceneId, { narrationText: event.target.value, approved: false })}/></label>
            {issues.length > 0 && <div className="visual-repair-guidance" role="status"><strong>{scene.authoringStatus === "needs_visual_authoring" ? "Ilustrasi belum berhasil dibuat" : "Scene perlu diperiksa"}</strong><span>{scene.missingVisuals.join(" · ") || issues[0]}</span><button type="button" className="button button-light" onClick={() => setSourceSceneId(scene.sceneId)} disabled={sourceInputDisabled}>Perbaiki Ilustrasi</button></div>}
            <label className="visual-license-field"><span>Lisensi / provenance aset</span><input maxLength={160} value={license} onChange={(event) => setLicenses((current) => ({ ...current, [scene.sceneId]: event.target.value }))} placeholder="Contoh: dibuat sendiri; lisensi ..."/></label>
            {imageNodes.length > 0 && <div className="visual-asset-review"><span>{imageNodes.length === 1 ? "Ilustrasi raster" : `${imageNodes.length} layer gambar`} · {illustrationSource}</span><small>Asset content-addressed; hash dicek saat snapshot/render. Headline dan subtitle tetap berasal dari Remotion.</small>{!scene.authoringConfirmed && <button type="button" className="button button-light visual-author-button" onClick={() => onConfirmUserAsset(scene.sceneId)} disabled={busy}>Saya sudah meninjau makna, crop, dan provenance</button>}</div>}
            {promptSceneId === scene.sceneId && <div className="illustration-prompt-panel">
              <div><strong>AI Image · {imageProviderCatalog?.status ?? "Not Configured"}</strong><small>{imageProvider?.displayName ?? "Hugging Face Inference Providers"}. {imageProvider?.costDisclosure ?? "Harga dan saldo tidak diketahui; generation dapat dikenai biaya."}</small></div>
              <button type="button" className="button button-light visual-author-button" onClick={() => { setPromptsByScene((current) => { const next = { ...current }; delete next[scene.sceneId]; return next; }); setPromptSceneId(scene.sceneId); setPromptCopiedSceneId(null); }}>Buat Ulang Prompt Ilustrasi</button>
              {previousImageScene && <label className="visual-reference-toggle"><input type="checkbox" checked={Boolean(usePreviousReference[scene.sceneId])} onChange={(event) => setUsePreviousReference((current) => ({ ...current, [scene.sceneId]: event.target.checked }))}/> Gunakan scene {previousImageScene.scene.sceneNumber} sebagai referensi gaya prompt <small>Konsistensi visual dibantu, tidak dijamin.</small></label>}
              <details className="illustration-prompt-details" open>
                <summary>Prompt siap edit · portrait 9:16</summary>
                <textarea rows={8} maxLength={12000} value={illustrationPrompt} onChange={(event) => setPromptsByScene((current) => ({ ...current, [scene.sceneId]: event.target.value }))} aria-label={`Prompt ilustrasi scene ${scene.sceneNumber}`}/>
                <button type="button" className="button button-primary visual-author-button" onClick={() => void navigator.clipboard.writeText(illustrationPrompt).then(() => setPromptCopiedSceneId(scene.sceneId)).catch(() => setPromptCopiedSceneId(null))}>Copy Illustration Prompt</button>
                {promptCopiedSceneId === scene.sceneId && <span className="visual-prompt-copied" role="status">Prompt disalin.</span>}
              </details>
              <label><span>Provider</span><select value={imageProviderId} disabled={!imageProviderCatalog?.providers.length || sourceInputDisabled} onChange={(event) => setImageProvidersByScene((current) => ({ ...current, [scene.sceneId]: event.target.value }))}>{imageProviderCatalog?.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>) ?? <option value="">Tidak tersedia</option>}</select></label>
              <label><span>Model · live HF Inference catalog</span><select value={imageModel} disabled={!providerReady || sourceInputDisabled} onChange={(event) => setImageModelsByScene((current) => ({ ...current, [scene.sceneId]: event.target.value }))}><option value="">Pilih model yang tersedia</option>{imageProvider?.models.map((model) => <option key={model.id} value={model.id}>{model.id}{model.license ? ` · repo ${model.license}` : ""}</option>)}</select></label>
              <label><span>Ukuran gambar · portrait 9:16</span><select value={imageResolution} disabled={!imageProvider?.resolutions.length || sourceInputDisabled} onChange={(event) => setImageResolutionsByScene((current) => ({ ...current, [scene.sceneId]: event.target.value }))}>{imageProvider?.resolutions.map((resolution) => <option key={resolution} value={resolution}>{resolution.replace("x", " × ")}</option>)}</select></label>
              <label><span>Fit / crop aman</span><select value={imageFit} disabled={sourceInputDisabled} onChange={(event) => setImageFitsByScene((current) => ({ ...current, [scene.sceneId]: event.target.value as "cover" | "contain" }))}><option value="contain">Contain · tanpa crop (recommended)</option><option value="cover">Cover · isi frame, periksa crop</option></select></label>
              <small className="ai-image-cost-disclosure">{imageProviderCatalog?.message ?? "Provider belum dikonfigurasi."}</small>
              {imageProviderCatalog?.status === "Rate Limited" && imageProviderCatalog.retryAt && <small role="status">Coba lagi setelah {new Date(imageProviderCatalog.retryAt).toLocaleString("id-ID")}.</small>}
              <button type="button" className="button button-primary visual-author-button" disabled={!providerReady || imageRateBlocked || !imageProvider?.models.some((model) => model.id === imageModel) || !imageResolution || illustrationPrompt.trim().length < 20 || sourceInputDisabled} onClick={() => {
                setGeneratingAiImageSceneId(scene.sceneId);
                setAiImageErrors((current) => ({ ...current, [scene.sceneId]: "" }));
                void onGenerateAiImage(scene.sceneId, imageProviderId, imageModel, illustrationPrompt, imageResolution).then((asset) => {
                  if (asset) setGeneratedAssetsByScene((current) => ({ ...current, [scene.sceneId]: asset }));
                }).catch((error) => setAiImageErrors((current) => ({ ...current, [scene.sceneId]: error instanceof Error ? error.message : "AI Image gagal." })))
                  .finally(() => setGeneratingAiImageSceneId(null));
              }}>{generatingAiImageSceneId === scene.sceneId ? "Generating one image…" : "Generate Illustration"}</button>
              {aiImageErrors[scene.sceneId] && <span className="visual-scene-warning" role="alert">{aiImageErrors[scene.sceneId]}</span>}
              {generatedCandidate && <div className="ai-image-candidate" aria-label={`Preview generated image scene ${scene.sceneNumber}`}>
                <strong>Generated preview · belum diterapkan</strong>
                <img src={`/visual-assets/${generatedCandidate.file}`} alt={`Generated illustration candidate for scene ${scene.sceneNumber}`} style={{ aspectRatio: "9 / 16", objectFit: imageFit }}/>
                <small>{generatedCandidate.width} × {generatedCandidate.height} · SHA-256 {generatedCandidate.sha256.slice(0, 16)}… · {generatedCandidate.provider} · {generatedCandidate.model}</small>
                <small>{new Date(generatedCandidate.createdAt).toLocaleString("id-ID")} · {generatedCandidate.license}</small>
                <small>{generatedCandidate.usageMetadata}</small>
                <button type="button" className="button button-primary visual-author-button" disabled={busy} onClick={() => onApplyGeneratedAiImage(scene.sceneId, generatedCandidate, imageFit)}>Gunakan Ilustrasi</button>
              </div>}
              <label><span>Provider eksternal (opsional)</span><input maxLength={120} value={providers[scene.sceneId] ?? ""} onChange={(event) => setProviders((current) => ({ ...current, [scene.sceneId]: event.target.value }))} placeholder="Contoh: ChatGPT manual"/></label>
              <label><span>Model (opsional)</span><input maxLength={120} value={modelsByScene[scene.sceneId] ?? ""} onChange={(event) => setModelsByScene((current) => ({ ...current, [scene.sceneId]: event.target.value }))} placeholder="Nama model bila diketahui"/></label>
              <label className="button button-primary visual-file-button">Impor AI Image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={sourceInputDisabled} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onUploadAsset(scene.sceneId, file, { source: "ai-generated", prompt: illustrationPrompt, license, provider: providers[scene.sceneId], model: modelsByScene[scene.sceneId] }); event.currentTarget.value = ""; }}/></label>
            </div>}
            <div className="visual-motion-summary"><strong>Motion · {scene.motionStatus.replaceAll("_", " ")} · {scene.motionIntensity}</strong><span>{scene.motionSummary}</span>
              <small>{scene.motionActions.length} action · {scene.motionTiming === "approximate" ? "timing approximate · tidak berasal dari word-level audio" : "narration aligned"}{scene.motionActions.length ? ` · ${scene.motionActions.map((action) => action.kind.replaceAll("-", " ")).join(" / ")}` : ""}</small>
            </div>
            <label><span>Editable notes</span><textarea rows={2} maxLength={500} value={scene.notes} onChange={(event) => onChange(scene.sceneId, { notes: event.target.value })} placeholder="Catatan art direction untuk scene ini"/></label>
          </div>
          {scene.warnings.map((warning) => <p className="visual-scene-warning" key={warning}>{warning}</p>)}
          {scene.missingVisuals.length > 0 && <p className="visual-scene-missing"><strong>Belum terwujud:</strong> {scene.missingVisuals.join(" · ")}</p>}
          <div className="visual-scene-actions"><button type="button" className="button button-light visual-author-button" onClick={() => setPreviewSceneId(scene.sceneId)}>Motion Preview</button><button type="button" className="button button-light visual-author-button" onClick={() => onGenerateMotion(scene.sceneId, motionIntensity)} disabled={busy || scene.approved} title={scene.approved ? "Batalkan approval sebelum mengganti Motion Plan." : undefined}>{scene.motionActions.length ? "Perbaiki Animasi" : "Generate Animasi"}</button><button type="button" className="button button-light visual-author-button" onClick={() => setSourceSceneId(scene.sceneId)} disabled={sourceInputDisabled}>Ubah Ilustrasi</button></div>
          <details className="visual-advanced-controls"><summary>Advanced · composer & semantic planner</summary>
            <button type="button" className="button button-light visual-author-button" onClick={() => onGenerate(scene.sceneId)} disabled={busy || generatingSceneId !== null}>{generatingSceneId === scene.sceneId ? "Menyusun komposisi…" : "Generate / Perbaiki komposisi"}</button>
            <button type="button" className="button button-light visual-author-button" onClick={() => onPlan(scene.sceneId)} disabled={!plannerAvailable || busy || generatingSceneId !== null || planningSceneId !== null}>{planningSceneId === scene.sceneId ? "Merencanakan scene…" : "Plan Semantik dengan AI Text"}</button>
            {scene.authoringStatus === "needs_visual_authoring" && <button type="button" className="button button-light visual-author-button" onClick={() => onUseCurrentComposition(scene.sceneId)} disabled={busy}>Gunakan komposisi manual dari Materials</button>}
          </details>
          {issues.length > 0 && <details className="visual-scene-issues"><summary>{issues.length} pemeriksaan perlu diperhatikan</summary><ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></details>}
          <button type="button" className={`button ${scene.approved ? "button-light" : "button-primary"} full-button visual-approve-button`} onClick={() => onChange(scene.sceneId, { approved: !scene.approved })} disabled={busy || (!scene.approved && issues.length > 0)}>
            {scene.approved ? "Batalkan approval" : "Approve scene"}
          </button>
        </article>;
      })}
    </div>
    {sourceScene && <dialog ref={sourceDialog} className="visual-source-dialog" aria-labelledby="visual-source-title" onClose={() => setSourceSceneId(null)}>
      <div className="visual-source-dialog-head"><div><span className="eyebrow">SCENE {sourceScene.sceneNumber} · SMART HYBRID</span><h2 id="visual-source-title">Ubah Ilustrasi</h2><p>{sourceScene.headline}</p></div><button type="button" className="button button-light" onClick={closeSourceDialog}>Tutup</button></div>
      <p className="visual-source-dialog-note">Smart Hybrid memilih komposisi lokal yang relevan lebih dulu. AI Image tidak pernah dipanggil otomatis.</p>
      <div className="visual-source-options">
        <button type="button" className="button button-primary" onClick={() => { closeSourceDialog(); onPrepareIssues([sourceScene.sceneId]); }} disabled={busy || !saved}><strong>Smart Hybrid</strong><small>Reusable scene → ilustrasi library → composer lokal; tidak mengganti artwork terpilih.</small></button>
        <button type="button" className="button button-light" onClick={() => { closeSourceDialog(); onGenerateVector(sourceScene.sceneId); }} disabled={!vectorAvailable || sourceActionsDisabled}><strong>AI Vector</strong><small>{vectorAvailable ? "OpenCode Development · hasil perlu review." : "OpenCode Development/model belum tersedia."}</small></button>
        <button type="button" className="button button-light" onClick={() => { closeSourceDialog(); onOpenLibrary(sourceScene.sceneId, "mine"); }} disabled={sourceActionsDisabled}><strong>Asset Library</strong><small>Aset lokal terkurasi; license dan kecocokan perlu diperiksa.</small></button>
        <button type="button" className="button button-light" onClick={() => { closeSourceDialog(); onOpenLibrary(sourceScene.sceneId, "scenes"); }} disabled={sourceActionsDisabled}><strong>Reusable Scene</strong><small>Komposisi tersimpan dengan objek dan hubungan yang dapat dicocokkan.</small></button>
        <button type="button" className="button button-light" onClick={() => { void onSelectAiImageSource(sourceScene.sceneId).then((selected) => { if (selected) { setPromptSceneId(sourceScene.sceneId); closeSourceDialog(); } }); }} disabled={sourceActionsDisabled}><strong>AI Image</strong><small>{imageProviderCatalog?.configured ? "Opsional; tiap gambar perlu konfirmasi biaya." : "Belum siap; prompt dan import manual tetap tersedia."}</small></button>
        <label className="button button-light visual-file-button"><strong>Upload</strong><small>PNG, JPEG, atau WebP lokal.</small><input type="file" accept="image/png,image/jpeg,image/webp" aria-label={`Upload ilustrasi untuk scene ${sourceScene.sceneNumber}`} disabled={sourceActionsDisabled} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) { closeSourceDialog(); onUploadAsset(sourceScene.sceneId, file, { source: "user-upload", license: licenses[sourceScene.sceneId] ?? "User-provided; license/provenance not specified" }); } event.currentTarget.value = ""; }}/></label>
      </div>
      <small className="visual-source-dialog-cost">AI Image: {imageProviderCatalog?.message ?? "Provider status memeriksa; no image request occurred."} {imageProviderCatalog?.providers[0]?.costDisclosure ?? "Harga dan saldo tidak diketahui; generation dapat dikenai biaya."}</small>
    </dialog>}
    {libraryScene && <SmartAssetLibraryDialog open={Boolean(librarySceneId)} scene={libraryScene} research={research} storyboard={storyboard} projectId={projectId} busy={busy} onClose={onCloseLibrary}
      initialTab={libraryInitialTab} onUseAsset={onUseAsset} onImportOpenverse={onImportOpenverse} onImportTabler={onImportTabler} onUseReusableScene={onUseReusableScene}
      onSaveReusableScene={onSaveReusableScene} onDeleteAsset={onDeleteAsset}/>}
    {previewScene && previewSceneSource && <dialog ref={previewDialog} className="visual-preview-dialog" aria-labelledby="visual-preview-title" onClose={() => setPreviewSceneId(null)}>
      <div className="visual-preview-head"><div><span className="eyebrow">SCENE {previewScene.sceneNumber} · {illustrationSourceForScene(previewScene)}</span><h2 id="visual-preview-title">{previewScene.headline}</h2></div><button type="button" className="button button-light" onClick={() => previewDialog.current?.close()}>Tutup preview</button></div>
      <div className="motion-scrubber">
        <label htmlFor="motion-frame-scrubber">Seek Motion Preview · frame deterministic</label>
        <input id="motion-frame-scrubber" type="range" min={0} max={previewMaxFrame} step={1} value={activePreviewFrame} onChange={(event) => setPreviewFrame(Number(event.target.value))} aria-valuetext={`${(activePreviewFrame / 30).toFixed(2)} detik`} />
        <output htmlFor="motion-frame-scrubber">{(activePreviewFrame / 30).toFixed(2)}s / {previewScene.durationSec.toFixed(2)}s · frame {activePreviewFrame}</output>
        <small>Timing {previewScene.motionTiming}; scrub tidak memanggil provider AI dan dapat diulang saat render.</small>
      </div>
      <div className="visual-preview-frame"><svg viewBox="0 0 1080 1920" role="img" aria-label={`Preview scene ${previewScene.sceneNumber}: ${previewScene.headline}`}>
        <VisualCompositionView scene={previewSceneSource} composition={previewScene.composition} style={visualStyles[research.visualPreset]} preset={research.visualPreset} frame={activePreviewFrame} progress={previewProgress}/>
        <rect x="45" y="34" width="990" height="450" rx="20" fill={storyboard.palette.canvas} opacity=".96"/>
        <text x="84" y="92" fill={storyboard.palette.primary} fontFamily="Arial,sans-serif" fontSize="24" fontWeight="700">AI FACTS · SCENE {String(previewScene.sceneNumber).padStart(2, "0")}</text>
        <foreignObject x="80" y="126" width="920" height="290"><div className="visual-thumbnail-headline">{previewScene.headline}</div></foreignObject>
        <rect x="45" y="1540" width="990" height="300" rx="20" fill={storyboard.palette.canvas} opacity=".96"/>
        <foreignObject x="80" y="1590" width="920" height="190"><div className="visual-scene-caption">{previewScene.narrationText}</div></foreignObject>
      </svg></div>
      <div className="motion-preview-plan"><strong>{previewScene.motionSummary}</strong>{previewScene.motionActions.length ? <ul>{previewScene.motionActions.map((action) => <li key={action.id}>{action.kind.replaceAll("-", " ")} · {action.targetNode} · frame {action.startFrame}–{action.startFrame + action.durationFrames} ({(action.durationFrames / 30).toFixed(2)}s)</li>)}</ul> : <small>Komposisi dipertahankan statis. Tidak ada animasi objek yang aman/bermakna.</small>}</div>
    </dialog>}
  </section>;
}
