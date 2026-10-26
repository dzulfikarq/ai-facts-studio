import React from "react";
import type { ResearchPackage } from "../domain/research";
import { applyVisualStoryboard, type VisualQualityGate, type VisualStoryboard, type VisualStoryboardScene } from "../domain/visual-storyboard";
import { VisualCompositionView } from "../video/visual-primitives";
import { visualStyles } from "../video/style-config";
import type { VisualAsset } from "../domain/visual-assets";

export function VisualStoryboardReview({ research, storyboard, gate, saved, busy, generatingSceneId, onChange, onGenerate, onUseCurrentComposition, assets, onUploadAsset, onUseAsset, onConfirmUserAsset, aiMode, plannerAvailable, models, selectedModel, onSelectModel, planningSceneId, onPlan }: {
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
  onUploadAsset: (sceneId: string, file: File) => void;
  onUseAsset: (sceneId: string, assetId: string) => void;
  onConfirmUserAsset: (sceneId: string) => void;
  aiMode: "development" | "production" | null;
  plannerAvailable: boolean;
  models: Array<{ id: string; name: string }>;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  planningSceneId: string | null;
  onPlan: (sceneId: string) => void;
}) {
  const approvedCount = storyboard.scenes.filter((scene) => scene.approved).length;
  const allApproved = approvedCount === storyboard.scenes.length && gate.ready;
  const previewResearch = applyVisualStoryboard(research, storyboard);
  return <section className="visual-storyboard-review" aria-label="Visual Storyboard Review">
    <div className={`visual-review-state ${gate.status === "needs_visual_authoring" ? "attention" : allApproved ? "approved" : gate.status === "needs_review" ? "review" : "ready"}`} role="status">
      <strong>{gate.status === "needs_visual_authoring" ? "Needs Visual Authoring" : allApproved ? "Approved for Motion" : gate.status === "needs_review" ? "Needs Human Visual Review" : "Ready for Review"}</strong>
      <span>{gate.status === "needs_visual_authoring" ? `${gate.issues.length} konsep/aturan belum terpenuhi.` : gate.status === "needs_review" ? `${gate.reviewNotes.length || gate.issues.length} scene perlu diperiksa atau disesuaikan.` : `${approvedCount}/${storyboard.scenes.length} scene disetujui.`}</span>
    </div>
    <div className="visual-art-direction">
      <div><span className="eyebrow">2D ART DIRECTION</span><strong>Clean flat illustration · {storyboard.styleId}</strong><small>Headline: {storyboard.headlineStrategy.replaceAll("-", " ")} · Typography: {storyboard.typographyIntent.heading}; {storyboard.typographyIntent.body}. {storyboard.typographyIntent.hierarchy}</small></div>
      <div className="visual-palette" aria-label="Palet warna">
        {Object.entries(storyboard.palette).map(([name, color]) => <span key={name} title={`${name}: ${color}`} style={{ backgroundColor: color }} />)}
      </div>
      <small>Object berulang: {storyboard.reusableWorldObjects.length ? storyboard.reusableWorldObjects.map((id) => id.replaceAll("-", " ")).join(" · ") : "belum ada"}</small>
      <div className="visual-planner-settings"><span>AI planner: text only · request runs only on click · plans cached per exact input.</span>{aiMode === "development" ? <label>OpenCode model<select value={selectedModel} onChange={(event) => onSelectModel(event.target.value)} disabled={!models.length}>{models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label> : aiMode === "production" ? <span>Gemini Text terpilih · no image API</span> : <span>AI planner belum dikonfigurasi.</span>}</div>
    </div>
    {!saved && <div className="workflow-alert attention"><span>Simpan Visual Storyboard sebelum lanjut ke motion preview.</span></div>}
    {gate.issues.length > 0 && <div className="visual-gate-issues" role="alert"><strong>Quality gate menahan approval</strong><ul>{gate.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
    {gate.reviewNotes.length > 0 && <div className="visual-review-notes" role="status"><strong>Komposisi otomatis perlu inspeksi manusia</strong><ul>{gate.reviewNotes.map((note) => <li key={note}>{note}</li>)}</ul></div>}
    <div className="visual-storyboard-grid">
      {storyboard.scenes.map((scene, index) => {
        const source = previewResearch.scenes[index];
        const issues = gate.scenes[scene.sceneId] ?? [];
        const uploadedAsset = scene.composition.layers.some((layer) => layer.nodes.some((node) => node.type === "image" && node.asset.startsWith("upload-")));
        return <article className={`visual-scene-card ${scene.approved ? "scene-approved" : ""}`} key={scene.sceneId}>
          <div className="visual-scene-card-head"><span className="scene-number">{String(scene.sceneNumber).padStart(2, "0")}</span><div><strong>Scene {scene.sceneNumber}</strong><small>{scene.durationSec.toFixed(scene.durationSec % 1 ? 1 : 0)} detik · {scene.layout.replaceAll("-", " ")}</small></div><span className={`visual-approval-chip ${scene.approved ? "approved" : scene.authoringStatus === "needs_visual_authoring" ? "attention" : scene.authoringStatus === "needs_review" ? "review" : "pending"}`}>{scene.approved ? "APPROVED" : scene.authoringStatus === "needs_visual_authoring" ? "AUTHOR" : scene.authoringStatus === "needs_review" ? "REVIEW" : "READY"}</span></div>
          <div className={`visual-scene-thumbnail ${scene.authoringStatus === "needs_visual_authoring" && !scene.authoringConfirmed ? "needs-authoring" : ""}`}>
            {scene.authoringStatus === "needs_visual_authoring" && !scene.authoringConfirmed
              ? <div className="visual-author-placeholder"><strong>Visual belum memadai</strong><span>{scene.missingVisuals.join(" · ") || "Konsep inti belum dapat digambarkan akurat."}</span></div>
              : source && <svg viewBox="0 0 1080 1920" role="img" aria-label={`Thumbnail scene ${scene.sceneNumber}: ${scene.headline}`}>
              <VisualCompositionView scene={source} composition={scene.composition} style={visualStyles[research.visualPreset]} preset={research.visualPreset} frame={45} progress={0.42}/>
              <rect x="45" y="34" width="990" height="450" rx="20" fill={storyboard.palette.canvas} opacity=".96"/>
              <text x="84" y="92" fill={storyboard.palette.primary} fontFamily="Arial,sans-serif" fontSize="24" fontWeight="700" letterSpacing="3">AI FACTS · SCENE {String(scene.sceneNumber).padStart(2, "0")}</text>
              <foreignObject x="80" y="126" width="920" height="290"><div className="visual-thumbnail-headline">{scene.headline}</div></foreignObject>
            </svg>}
          </div>
          <div className="visual-scene-fields">
            <label><span>Headline</span><input maxLength={120} value={scene.headline} onChange={(event) => onChange(scene.sceneId, { headline: event.target.value, approved: false })}/></label>
            <p className="visual-summary">{scene.visualSummary}</p>
            <div className="visual-object-plan"><strong>Objek & aset · {scene.compositionSource}</strong><div>{scene.objects.length ? scene.objects.map((object) => <span key={object.objectId}>{object.label}</span>) : <em>Belum ada objek visual yang aman.</em>}</div></div>
            {scene.relationships.length > 0 && <div className="visual-relations"><strong>Hubungan divisualkan</strong><span>{scene.relationships.map((relation) => `${relation.from} ${relation.relation} ${relation.to}`).join(" · ")}</span></div>}
            {scene.semanticPlan && <div className="visual-semantic-plan"><strong>Semantic plan · {scene.semanticPlan.primaryVisualConcept}</strong><span>Lingkungan: {scene.semanticPlan.environment}</span><span>Proses: {scene.semanticPlan.processAction}</span><span>Gaya / komposisi: {scene.semanticPlan.illustrationStyle} · {scene.semanticPlan.compositionType}</span><span>Required: {scene.semanticPlan.requiredAssets.join(" · ") || "—"} · Supporting: {scene.semanticPlan.supportingAssets.join(" · ") || "—"}</span></div>}
            <div className="visual-focus"><strong>Visual focus</strong><span>{scene.objects.find((object) => object.objectId === scene.visualFocus)?.label ?? "Belum ditentukan"}</span><small>{scene.illustrationIntent}</small></div>
            <label><span>Narasi</span><textarea rows={3} maxLength={2000} value={scene.narrationText} onChange={(event) => onChange(scene.sceneId, { narrationText: event.target.value, approved: false })}/></label>
            <div className="visual-user-assets">
              <strong>Aset ilustrasi sendiri</strong>
              {assets.length > 0 && <label><span>Pakai aset tersimpan ulang</span><select value="" onChange={(event) => { if (event.target.value) onUseAsset(scene.sceneId, event.target.value); }}><option value="">Pilih aset project…</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.format.toUpperCase()}</option>)}</select></label>}
              <label><span>Unggah PNG, JPEG, WebP (maks. 10 MB)</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || generatingSceneId !== null} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onUploadAsset(scene.sceneId, file); event.currentTarget.value = ""; }}/></label>
              {uploadedAsset && <><small>Aset tersimpan lokal dan immutable; kecocokan konsep/hubungan wajib ditinjau manusia.</small>{!scene.authoringConfirmed && <button type="button" className="button button-light visual-author-button" onClick={() => onConfirmUserAsset(scene.sceneId)} disabled={busy || generatingSceneId !== null}>Saya sudah meninjau kecocokan aset</button>}</>}
            </div>
            <div className="visual-motion-summary"><strong>Motion · {scene.motionIntent.replaceAll("-", " ")}</strong><span>{scene.motionSummary}</span></div>
            <label><span>Editable notes</span><textarea rows={2} maxLength={500} value={scene.notes} onChange={(event) => onChange(scene.sceneId, { notes: event.target.value })} placeholder="Catatan art direction untuk scene ini"/></label>
          </div>
          {scene.warnings.map((warning) => <p className="visual-scene-warning" key={warning}>{warning}</p>)}
          {scene.missingVisuals.length > 0 && <p className="visual-scene-missing"><strong>Belum terwujud:</strong> {scene.missingVisuals.join(" · ")}</p>}
          <button type="button" className="button button-light visual-author-button" onClick={() => onGenerate(scene.sceneId)} disabled={busy || generatingSceneId !== null}>
            {generatingSceneId === scene.sceneId ? <><span className="visual-spinner" aria-hidden="true"/> Menyusun komposisi…</> : "Generate / Perbaiki Ilustrasi Otomatis"}
          </button>
          <button type="button" className="button button-light visual-author-button" onClick={() => onPlan(scene.sceneId)} disabled={!plannerAvailable || busy || generatingSceneId !== null || planningSceneId !== null} title="Memanggil provider AI Text terpilih hanya setelah klik.">
            {planningSceneId === scene.sceneId ? <><span className="visual-spinner" aria-hidden="true"/> Merencanakan makna scene…</> : "Plan Semantik dengan AI Text"}
          </button>
          {scene.authoringStatus === "needs_visual_authoring" && <button type="button" className="button button-light visual-author-button" onClick={() => onUseCurrentComposition(scene.sceneId)} disabled={busy || generatingSceneId !== null}>
            Gunakan komposisi manual dari Materials
          </button>}
          {issues.length > 0 && <ul className="visual-scene-issues">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
          <button type="button" className={`button ${scene.approved ? "button-light" : "button-primary"} full-button visual-approve-button`} onClick={() => onChange(scene.sceneId, { approved: !scene.approved })} disabled={busy || (!scene.approved && issues.length > 0)}>
            {scene.approved ? "Batalkan approval" : "Approve scene"}
          </button>
        </article>;
      })}
    </div>
  </section>;
}
