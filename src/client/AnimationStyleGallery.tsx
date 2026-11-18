import React, { useId } from "react";
import { Check, Layers3 } from "lucide-react";
import { ANIMATION_STYLE_PRESETS, type AnimationStyleId } from "../domain/animation-styles";

export function AnimationStyleGallery({ selectedId, onChange, disabled = false, heading = "Gaya Animasi", description = "Pilihan gaya berlaku untuk Generate with AI dan Buat Manual." }: {
  selectedId: AnimationStyleId;
  onChange: (styleId: AnimationStyleId) => void;
  disabled?: boolean;
  heading?: string;
  description?: string;
}) {
  const headingId = useId();

  return <section className="animation-style-gallery" aria-labelledby={headingId}>
    <div className="animation-style-gallery-heading"><span className="create-option-icon"><Layers3 aria-hidden="true" size={19}/></span><div><h2 id={headingId}>{heading}</h2><p>{description}</p></div></div>
    <div className="animation-style-grid" role="group" aria-label="Pilihan gaya animasi">
      {ANIMATION_STYLE_PRESETS.map((preset) => <article className={`animation-style-card ${selectedId === preset.id ? "selected" : ""}`} data-animation-style-id={preset.id} key={preset.id}>
        <button type="button" className="animation-style-choice" aria-pressed={selectedId === preset.id} onClick={() => onChange(preset.id)} disabled={disabled}>
          <span className="animation-style-preview"><Layers3 aria-hidden="true" size={19}/></span><span className="animation-style-card-copy"><span className="animation-style-card-title"><strong>{preset.name}</strong>{selectedId === preset.id && <span className="animation-style-selected"><Check aria-hidden="true" size={12}/>Dipilih</span>}</span><small>{preset.description}</small></span>
        </button>
      </article>)}
    </div>
  </section>;
}
