import React from "react";
import { captionSegmentsForScene } from "../domain/captions";
import type { ResearchPackage, Scene } from "../domain/research";

type ReviewProject = {
  audio: { name: string; durationSec: number; source: "upload" | "tts"; timingMode: "scaled" | "estimated"; tts?: { voiceName: string; locale: string; style: string; speakingRate: number } } | null;
  audioMatchesNarration: boolean;
  pendingTts: { voiceName: string; durationSec: number } | null;
  researchReviewStatus: "needs-review" | "verified-by-author";
};

export function ReviewStep({ research, project, onEditScene, onEditReferences, onEditNarration, onReview }: {
  research: ResearchPackage;
  project: ReviewProject;
  onEditScene: (id: string) => void;
  onEditReferences: () => void;
  onEditNarration: () => void;
  onReview: (status: "needs-review" | "verified-by-author") => void;
}) {
  const scenesWithoutSources = research.scenes.filter((scene) => !scene.referenceIds.length);
  const totalDuration = research.scenes.at(-1)?.endSec ?? research.targetDurationSec;
  const voiceSummary = project.audio
    ? project.audio.source === "tts"
      ? `${project.audio.tts?.voiceName ?? "AI Voice"} · ${project.audio.tts?.locale} · ${project.audio.durationSec.toFixed(1)} dtk`
      : `Upload manual · ${project.audio.name} · ${project.audio.durationSec.toFixed(1)} dtk`
    : "Belum ada audio · render perlu konfirmasi tanpa narasi";

  return <div className="review-step">
    <section className="review-summary-card">
      <div><span className="eyebrow">RINGKASAN VIDEO</span><h2>{research.title}</h2><p>{research.category} · {research.scenes.length} scene · {totalDuration.toFixed(1)} dtk · {research.visualPreset}</p></div>
      <div className="review-audio-summary"><span className="review-status-dot"/><div><strong>{project.audio?.source === "tts" ? "Audio disetujui" : project.audio ? "Audio aktif" : "Video tanpa narasi"}</strong><small>{voiceSummary}</small></div></div>
    </section>

    {project.audio?.source === "tts" && !project.audioMatchesNarration && <div className="workflow-alert danger" role="alert"><span>Naskah berubah setelah audio disetujui. Preview ulang narasi diperlukan.</span><button type="button" onClick={() => onEditScene(research.scenes[0]!.id)}>Perbaiki teks di Video Editor →</button></div>}
    {project.pendingTts && <div className="workflow-alert attention"><span>Kandidat narasi {project.pendingTts.voiceName} menunggu persetujuan; audio aktif belum terganti.</span><button type="button" onClick={onEditNarration}>Buka langkah Narasi →</button></div>}
    {!project.audio && <div className="workflow-alert attention"><span>Audio belum tersedia. Render final akan meminta konfirmasi video tanpa narasi.</span></div>}
    {!research.references.length && <div className="workflow-alert attention"><span>Belum ada referensi penelitian.</span><button type="button" onClick={onEditReferences}>Periksa materi & referensi →</button></div>}
    {scenesWithoutSources.map((scene) => <div className="workflow-alert attention" key={scene.id}><span>Scene “{scene.onScreenText || scene.id}” belum terhubung ke referensi.</span><button type="button" onClick={() => onEditScene(scene.id)}>Periksa scene →</button></div>)}

    <section className="review-timeline-card">
      <div className="section-title"><div><h2>Timeline & subtitle</h2><p>{project.audio?.timingMode === "estimated" ? "Estimasi scene dikalibrasi ke durasi audio; timing frasa tetap perkiraan." : "Scene dan frasa subtitle mengikuti timing storyboard. Edit subtitle di Video Editor."}</p></div><span className="count-chip">{project.audio?.timingMode === "estimated" ? "ESTIMASI" : "PER SCENE"}</span></div>
      <ol className="review-timeline">
        {research.scenes.map((scene, index) => <ReviewScene key={scene.id} scene={scene} index={index} totalDuration={totalDuration} onEdit={() => onEditScene(scene.id)} />)}
      </ol>
    </section>

    <section className={`review-author-card ${project.researchReviewStatus === "verified-by-author" ? "verified" : ""}`}>
      <div><strong>Verifikasi materi oleh Anda</strong><small>Periksa referensi dan klaim; aplikasi tidak memverifikasi fakta otomatis.</small></div>
      <button type="button" className="button button-light" onClick={() => onReview(project.researchReviewStatus === "verified-by-author" ? "needs-review" : "verified-by-author")} aria-pressed={project.researchReviewStatus === "verified-by-author"}>{project.researchReviewStatus === "verified-by-author" ? "✓ Materi ditinjau" : "Tandai sudah ditinjau"}</button>
    </section>
  </div>;
}

function ReviewScene({ scene, index, totalDuration, onEdit }: { scene: Scene; index: number; totalDuration: number; onEdit: () => void }) {
  const phrases = captionSegmentsForScene(scene);
  const start = scene.startSec / Math.max(0.001, totalDuration) * 100;
  const width = Math.max(1, (scene.endSec - scene.startSec) / Math.max(0.001, totalDuration) * 100);
  return <li className="review-scene-row">
    <div className="review-scene-top"><span className="scene-number">{String(index + 1).padStart(2, "0")}</span><div><strong>{scene.onScreenText || `Scene ${index + 1}`}</strong><small>{scene.startSec.toFixed(1)}–{scene.endSec.toFixed(1)} dtk · {scene.templateId.replaceAll("-", " ")}</small></div><button type="button" className="text-button" onClick={onEdit}>Buka Video Editor</button></div>
    <div className="review-track" aria-label={`Scene ${index + 1} pada timeline`}><i style={{ left: `${start}%`, width: `${width}%` }}/></div>
    <div className="review-phrases"><span>{phrases.length} frasa</span>{phrases.slice(0, 3).map((phrase, phraseIndex) => <span className="review-phrase" key={`${phraseIndex}-${phrase.text}`}>{phrase.text}</span>)}{phrases.length > 3 && <small>+{phrases.length - 3} frasa</small>}</div>
  </li>;
}
