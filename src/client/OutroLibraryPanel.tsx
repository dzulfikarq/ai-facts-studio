import React, { useEffect, useRef, useState } from "react";
import { Film, Info, Pencil, Star, Trash2, Upload, X } from "lucide-react";
import type { OutroLibraryAsset } from "../domain/outro";
import "./outro-library.css";

function formatDuration(seconds: number) {
  return `${seconds.toFixed(1)} dtk`;
}

export function OutroLibraryPanel({ assets, defaultOutroId, busy, onUpload, onRename, onMakeDefault, onDelete }: {
  assets: OutroLibraryAsset[];
  defaultOutroId: string | null;
  busy: boolean;
  onUpload: (file: File) => void;
  onRename: (id: string, name: string) => void;
  onMakeDefault: (id: string) => void;
  onDelete: (asset: OutroLibraryAsset) => void;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<OutroLibraryAsset | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const defaultOutro = assets.find((asset) => asset.id === defaultOutroId);
  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (file) onUpload(file);
    event.currentTarget.value = "";
  };

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (preview && !element.open) element.showModal();
    else if (!preview && element.open) element.close();
  }, [preview]);

  return <section className="outro-library" aria-labelledby="outro-library-title">
    <div className="outro-library-heading">
      <div><span className="eyebrow">LOCAL VIDEO ASSETS</span><h2 id="outro-library-title"><Film size={20} aria-hidden="true"/>Outro Library</h2>
        <p>Outro tersimpan lokal dan dipilih per project. Default baru berlaku untuk project baru; project lama tidak berubah.</p>
      </div>
      <label className="button button-primary file-button outro-upload-button"><Upload size={16} aria-hidden="true"/><span>Tambah Outro</span>
        <input type="file" accept="video/mp4,.mp4" disabled={busy} onChange={handleUpload}/>
      </label>
    </div>
    <div className="outro-library-note"><Info size={18} aria-hidden="true"/><p><strong>Default untuk project baru:</strong> {defaultOutro ? <><b>{defaultOutro.name}</b>. Project lama tetap tidak berubah.</> : "Belum diatur; project baru dimulai tanpa outro."}</p></div>
    {!assets.length ? <div className="project-empty outro-library-empty"><span className="project-empty-icon"><Film size={24} aria-hidden="true"/></span><strong>Library outro masih kosong</strong><span>Upload video MP4 lalu tetapkan sebagai default agar project baru memakainya.</span><label className="button button-primary file-button outro-empty-upload"><Upload size={16} aria-hidden="true"/><span>Upload Outro Pertama</span><input type="file" accept="video/mp4,.mp4" disabled={busy} onChange={handleUpload}/></label></div> :
      <div className="outro-card-grid">
        {assets.map((asset) => {
          const name = names[asset.id] ?? asset.name;
          const isDefault = defaultOutroId === asset.id;
          return <article className={`outro-card ${isDefault ? "is-default" : ""}`} key={asset.id}>
            <button type="button" className="outro-card-poster" onClick={() => setPreview(asset)} aria-label={`Pratinjau outro ${asset.name}`} disabled={!asset.localAvailable}>
              {asset.localAvailable ? <img src={asset.posterUrl} alt=""/> : <span className="outro-missing-poster"><Film size={24} aria-hidden="true"/>File tidak tersedia</span>}
              <span className="outro-preview-label">Pratinjau</span>
            </button>
            <div className="outro-card-content">
              <div className="outro-card-title"><strong>{asset.name}</strong>{isDefault && <span className="outro-default-badge"><Star size={13} fill="currentColor" aria-hidden="true"/>Default</span>}</div>
              <p>{formatDuration(asset.durationSec)} <i/> {asset.width} × {asset.height} · H.264</p>
              <div className="outro-rename-row">
                <label className="sr-only" htmlFor={`outro-name-${asset.id}`}>Nama outro {asset.name}</label>
                <input id={`outro-name-${asset.id}`} value={name} maxLength={100} disabled={busy} onChange={(event) => setNames((current) => ({ ...current, [asset.id]: event.target.value }))}/>
                <button type="button" className="button button-light icon-button" aria-label={`Simpan nama ${asset.name}`} title="Simpan nama" disabled={busy || !name.trim() || name.trim() === asset.name} onClick={() => {
                  onRename(asset.id, name.trim());
                  setNames((current) => { const next = { ...current }; delete next[asset.id]; return next; });
                }}><Pencil size={15} aria-hidden="true"/></button>
              </div>
              <div className="outro-card-actions">
                <button type="button" className={`button ${isDefault ? "button-light" : "button-outline"}`} disabled={busy || isDefault} onClick={() => onMakeDefault(asset.id)}>{isDefault ? "Default" : "Jadikan default"}</button>
                <button type="button" className="button button-ghost outro-delete-button" disabled={busy} onClick={() => onDelete(asset)}><Trash2 size={15} aria-hidden="true"/><span>Hapus</span></button>
              </div>
            </div>
          </article>;
        })}
      </div>}
    <dialog ref={dialog} className="outro-preview-dialog" aria-labelledby="outro-preview-title" onClose={() => setPreview(null)}>
      {preview && <>
        <header><div><span className="eyebrow">OUTRO PREVIEW</span><h3 id="outro-preview-title">{preview.name}</h3></div><button type="button" className="button button-light icon-button" aria-label="Tutup pratinjau" onClick={() => setPreview(null)}><X size={17} aria-hidden="true"/></button></header>
        <video src={preview.previewUrl} poster={preview.posterUrl} controls playsInline preload="metadata" aria-label={`Video outro ${preview.name}`}/>
        <p>{formatDuration(preview.durationSec)} · {preview.width} × {preview.height} · audio asli {preview.audioCodec ?? "tidak ada"}</p>
        <footer><button type="button" className="button button-primary" onClick={() => setPreview(null)}>Tutup</button></footer>
      </>}
    </dialog>
  </section>;
}
