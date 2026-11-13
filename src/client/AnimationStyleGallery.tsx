import React, { useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { ANIMATION_STYLE_PRESETS, type AnimationStyleId, type AnimationStylePreset } from "../domain/animation-styles";

export function AnimationStyleGallery({ selectedId, onChange, disabled = false, heading = "Gaya Animasi", description = "Pilih gaya visual untuk prompt animasi Google Flow." }: {
  selectedId: AnimationStyleId;
  onChange: (styleId: AnimationStyleId) => void;
  disabled?: boolean;
  heading?: string;
  description?: string;
}) {
  const headingId = useId();
  const previewHeadingId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [previewId, setPreviewId] = useState<AnimationStyleId | null>(null);
  const preview = previewId ? ANIMATION_STYLE_PRESETS.find((preset) => preset.id === previewId) : undefined;

  function openPreview(preset: AnimationStylePreset) {
    setPreviewId(preset.id);
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }

  function closePreview() {
    video.current?.pause();
    if (dialog.current?.open) dialog.current.close();
  }

  function choosePreviewStyle() {
    if (!preview) return;
    onChange(preview.id);
    closePreview();
  }

  return <section className="animation-style-gallery" aria-labelledby={headingId}>
    <div className="animation-style-gallery-heading"><div><h2 id={headingId}>{heading}</h2><p>{description}</p></div></div>
    <div className="animation-style-grid" role="group" aria-label="Pilihan gaya animasi">
      {ANIMATION_STYLE_PRESETS.map((preset) => <article className={`animation-style-card ${selectedId === preset.id ? "selected" : ""}`} data-animation-style-id={preset.id} key={preset.id}>
        <button type="button" className="animation-style-choice" aria-pressed={selectedId === preset.id} onClick={() => onChange(preset.id)} disabled={disabled}>
          <img src={preset.thumbnail} alt={`Poster ${preset.name}`} loading="lazy" />
          <span className="animation-style-card-copy"><strong>{preset.name}</strong><small>{preset.description}</small></span>
          {selectedId === preset.id && <span className="animation-style-selected">Dipilih</span>}
        </button>
        <button type="button" className="button button-light animation-style-preview-button" onClick={() => openPreview(preset)}>Lihat Preview</button>
      </article>)}
    </div>
    <dialog ref={dialog} className="animation-style-dialog" aria-labelledby={previewHeadingId} onClose={() => { video.current?.pause(); setPreviewId(null); }}>
      {preview && <div className="animation-style-dialog-content">
        <header className="animation-style-dialog-heading"><div><span className="animation-style-example-label">Contoh Animasi</span><h2 id={previewHeadingId}>{preview.name}</h2><p>{preview.description}</p></div><button type="button" className="button button-light icon-button" aria-label="Tutup preview animasi" onClick={closePreview}><X size={16} aria-hidden="true"/></button></header>
        {preview.previewVideo ? <div className="animation-style-preview-media">
          <video ref={video} src={preview.previewVideo} poster={preview.thumbnail} controls muted loop playsInline preload="none" aria-label={`Contoh Animasi ${preview.name}`}/>
          <button type="button" className="button button-light" onClick={() => { if (video.current) { video.current.currentTime = 0; void video.current.play(); } }}>Putar Ulang</button>
        </div> : <div className="animation-style-preview-unavailable"><img src={preview.thumbnail} alt=""/><p>Preview belum tersedia</p><small>Poster ini tetap; preview MP4 lokal belum disediakan.</small></div>}
        <div className="animation-style-dialog-actions"><button type="button" className="button button-light" onClick={closePreview}>Tutup</button><button type="button" className="button button-primary" onClick={choosePreviewStyle} disabled={disabled}>Pilih Gaya Ini</button></div>
      </div>}
    </dialog>
  </section>;
}
