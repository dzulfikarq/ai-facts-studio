import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Download, ExternalLink, FileImage, RefreshCw, Upload, X } from "lucide-react";
import type { ResearchPackage } from "../domain/research";
import type { GoogleFlowStyleLock, GoogleFlowMatchScene } from "../domain/google-flow";
import { googleFlowPromptPack, matchGoogleFlowFiles, recommendedGoogleFlowFilename, stableGoogleFlowSceneToken, validGoogleFlowAssignments } from "../domain/google-flow";
import { buildIllustrationPrompt } from "../domain/illustration-prompt";
import type { VisualAsset } from "../domain/visual-assets";
import type { VisualStoryboard, VisualStoryboardScene } from "../domain/visual-storyboard";
import { compositionForVisualScene } from "../domain/visual-storyboard";

const GOOGLE_FLOW_URL = "https://flow.google.com/";
type BatchRow = { id: string; file: File; previewUrl: string; sceneId: string | null; reason: string; matchStatus: string; skipped: boolean; manual: boolean; validationError?: string; duplicateOf?: string; serverError?: string };
export type FlowBatchItem = { id: string; file: File; sceneId: string; prompt: string };
export type FlowBatchProgress =
  | { stage: "uploading"; percent: number; completedFiles?: number; totalFiles?: number; batchNumber?: number; batchCount?: number }
  | { stage: "processing"; completedFiles?: number; totalFiles?: number; batchNumber?: number; batchCount?: number };

export function GoogleFlowPanel({ research, storyboard, scene, assets, busy, showPanel, onFlowPromptChange, onStyleLockChange, onPreparePrompts, onApplyStyleLock, onUploadReference, onUploadIllustration, onApplyBatch, onRegisterBatchLauncher }: {
  research: ResearchPackage;
  storyboard: VisualStoryboard;
  scene: VisualStoryboardScene;
  assets: VisualAsset[];
  busy: boolean;
  showPanel: boolean;
  onFlowPromptChange: (sceneId: string, prompt: string) => void;
  onStyleLockChange: (styleLock: GoogleFlowStyleLock) => void;
  onPreparePrompts: (prompts: Array<{ sceneId: string; prompt: string }>) => void;
  onApplyStyleLock: (prompts: Array<{ sceneId: string; prompt: string }>) => void;
  onUploadReference: (file: File) => Promise<VisualAsset | null>;
  onUploadIllustration: (sceneId: string, file: File, metadata: { source: "ai-generated"; prompt: string; license: string; provider: string; model: string }) => Promise<boolean>;
  onApplyBatch: (items: FlowBatchItem[], onProgress: (progress: FlowBatchProgress) => void) => Promise<{ appliedIds: string[]; failures: Array<{ id: string; fileName: string; message: string }> }>;
  onRegisterBatchLauncher: (open: (() => void) | null) => void;
}) {
  const [promptDraft, setPromptDraft] = useState<{ sceneId: string; value: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [batchError, setBatchError] = useState("");
  const [batchApplying, setBatchApplying] = useState(false);
  const [batchProgress, setBatchProgress] = useState<FlowBatchProgress | { stage: "complete"; total: number; successful: number; failed: number } | null>(null);
  const [flowNotice, setFlowNotice] = useState("");
  const [promptExpanded, setPromptExpanded] = useState(false);
  const urls = useRef(new Set<string>());
  const batchDialogRef = useRef<HTMLDialogElement>(null);
  const singleInput = useRef<HTMLInputElement>(null);
  const batchInput = useRef<HTMLInputElement>(null);
  const referenceInput = useRef<HTMLInputElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const [singlePreview, setSinglePreview] = useState<{ file: File; url: string } | null>(null);
  const promptReady = Boolean(scene.flowPrompt || promptDraft?.sceneId === scene.sceneId);
  const prompt = promptDraft?.sceneId === scene.sceneId ? promptDraft.value : scene.flowPrompt ?? "";
  const sceneIdentities = storyboard.scenes.map((item): GoogleFlowMatchScene => ({
    sceneId: item.sceneId, sceneNumber: item.sceneNumber, headline: item.headline,
    sceneToken: item.sceneToken ?? stableGoogleFlowSceneToken(item.sceneId),
    recommendedFilename: item.recommendedFilename ?? recommendedGoogleFlowFilename(item),
  }));
  const selectedRefs = assets.filter((asset) => storyboard.styleLock.referenceAssetIds.includes(asset.id));
  const assignments = validGoogleFlowAssignments(batchRows.map((row) => ({ ...row, skipped: row.skipped || Boolean(row.validationError) })));
  const assignedSceneIds = new Set(batchRows.flatMap((row, index) => assignments[index] && row.sceneId ? [row.sceneId] : []));
  const missingScenes = storyboard.scenes.filter((item) => !assignedSceneIds.has(item.sceneId));

  useEffect(() => {
    if (!stagedFile) { setSinglePreview(null); return; }
    const url = URL.createObjectURL(stagedFile);
    setSinglePreview({ file: stagedFile, url });
    return () => URL.revokeObjectURL(url);
  }, [stagedFile]);
  useEffect(() => () => {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
  }, []);
  useEffect(() => {
    const dialog = batchDialogRef.current;
    if (!dialog) return;
    if (batchOpen && !dialog.open) dialog.showModal();
    else if (!batchOpen && dialog.open) dialog.close();
  }, [batchOpen]);
  useEffect(() => {
    onRegisterBatchLauncher(() => {
      setBatchError("");
      setBatchProgress(null);
      setBatchRows([]);
      setBatchOpen(true);
    });
    return () => onRegisterBatchLauncher(null);
  }, [onRegisterBatchLauncher]);

  const setPrompt = (value: string) => {
    setPromptDraft({ sceneId: scene.sceneId, value });
    onFlowPromptChange(scene.sceneId, value);
  };
  const makeAllPrompts = () => storyboard.scenes.map((item) => ({ sceneId: item.sceneId, prompt: buildPrompt(item) }));
  const buildPrompt = (target: VisualStoryboardScene) => {
    const index = storyboard.scenes.findIndex((item) => item.sceneId === target.sceneId);
    const previous = storyboard.scenes.slice(0, index).reverse().find((item) => item.flowPrompt || compositionForVisualScene(storyboard, item).layers.some((layer) => layer.nodes.some((node) => node.type === "image")));
    return buildIllustrationPrompt({ research, storyboard, scene: target, styleLock: storyboard.styleLock,
      ...(previous ? { previousReference: { sceneNumber: previous.sceneNumber, name: previous.headline, style: storyboard.styleLock.illustrationStyle } } : {}),
    });
  };
  const preparePrompt = () => {
    const generated = buildPrompt(scene);
    setPromptDraft({ sceneId: scene.sceneId, value: generated });
    onFlowPromptChange(scene.sceneId, generated);
    setFlowNotice("Prompt scene disiapkan; ilustrasi saat ini tetap.");
  };
  const editPrompt = () => {
    setPromptExpanded(true);
    requestAnimationFrame(() => promptInput.current?.focus());
  };
  const makePack = () => googleFlowPromptPack(research.title, storyboard.styleLock, storyboard.scenes.map((item) => ({
    sceneId: item.sceneId, sceneNumber: item.sceneNumber, sceneToken: item.sceneToken ?? stableGoogleFlowSceneToken(item.sceneId),
    recommendedFilename: item.recommendedFilename ?? recommendedGoogleFlowFilename(item), headline: item.headline,
    narrationText: item.narrationText, prompt: item.flowPrompt || buildPrompt(item),
  })));
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setFlowNotice("Prompt disalin."); }
    catch { setCopied(false); setFlowNotice("Clipboard tidak tersedia. Pilih prompt lalu salin manual."); }
  };
  const download = (format: "md" | "json") => {
    const pack = makePack();
    const blob = new Blob([format === "md" ? pack.markdown : JSON.stringify(pack.json, null, 2)], { type: format === "md" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${research.title.toLocaleLowerCase("id-ID").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "google-flow-prompts"}-flow-prompts.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const addBatchFiles = (files: FileList | readonly File[]) => {
    setBatchError("");
    setBatchProgress(null);
    if (batchRows.length + files.length > 30) { setBatchError("Maksimal 30 file per batch; tidak ada file yang ditambahkan."); return; }
    const candidates = [...files];
    const matches = matchGoogleFlowFiles(candidates, sceneIdentities);
    const rows = candidates.map((file, index): BatchRow => {
      const previewUrl = URL.createObjectURL(file);
      urls.current.add(previewUrl);
      const match = matches[index]!;
      const validationError = !["image/png", "image/jpeg", "image/webp"].includes(file.type) ? "Format tidak didukung. Pilih PNG, JPEG, atau WebP."
        : file.size <= 0 ? "File kosong. Ekspor ulang gambar dari Google Flow."
          : file.size > 10 * 1024 * 1024 ? "Ukuran melebihi 10 MB. Kompres/ekspor ulang file ini; file lain tetap bisa diimpor." : undefined;
      return { id: crypto.randomUUID(), file, previewUrl, sceneId: match.status === "matched" ? match.sceneId : null, reason: match.reason, matchStatus: match.status, skipped: false, manual: false, ...(validationError ? { validationError } : {}) };
    });
    const nextRows = [...batchRows, ...rows];
    setBatchRows(nextRows);
    setBatchOpen(true);
    void (async () => {
      const firstByHash = new Map<string, string>();
      for (const row of nextRows) {
        if (row.validationError || !globalThis.crypto?.subtle) continue;
        try {
          const digest = await crypto.subtle.digest("SHA-256", await row.file.arrayBuffer());
          const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
          const first = firstByHash.get(hash);
          if (first) setBatchRows((current) => current.map((candidate) => candidate.id === row.id ? { ...candidate, duplicateOf: first } : candidate));
          else firstByHash.set(hash, row.id);
        } catch { /* duplicate hint is optional; upload validation stays authoritative */ }
      }
    })();
  };
  const updateBatchRow = (id: string, change: Partial<Pick<BatchRow, "sceneId" | "skipped">>) => setBatchRows((rows) => rows.map((row) => row.id === id ? { ...row, ...change, manual: change.sceneId !== undefined ? true : row.manual } : row));
  const applyBatch = async () => {
    const items = batchRows.flatMap((row, index) => assignments[index] && row.sceneId && !row.validationError ? [{ id: row.id, file: row.file, sceneId: row.sceneId, prompt: buildPrompt(storyboard.scenes.find((item) => item.sceneId === row.sceneId)!) }] : []);
    if (!items.length) return;
    setBatchApplying(true);
    setBatchError("");
    setBatchProgress({ stage: "uploading", percent: 0, completedFiles: 0, totalFiles: items.length, batchNumber: 1, batchCount: Math.ceil(items.length / 3) });
    try {
      const result = await onApplyBatch(items, setBatchProgress);
      setBatchProgress({ stage: "complete", total: items.length, successful: result.appliedIds.length, failed: result.failures.length });
      const success = new Set(result.appliedIds);
      const failuresById = new Map(result.failures.map((failure) => [failure.id, failure.message]));
      setBatchRows((rows) => rows.filter((row) => !success.has(row.id)).map((row) => ({ ...row, ...(failuresById.has(row.id) ? { serverError: failuresById.get(row.id) } : {}) })));
      setBatchError(result.failures.map((failure) => `${failure.fileName}: ${failure.message}`).join(" · "));
      const unresolved = batchRows.some((row) => !success.has(row.id) && !row.skipped);
      if (result.appliedIds.length && !result.failures.length && !unresolved) setBatchOpen(false);
    } catch (error) { setBatchProgress(null); setBatchError(error instanceof Error ? error.message : "Batch import gagal."); }
    finally { setBatchApplying(false); }
  };
  const uploadOne = async () => {
    if (!stagedFile) return;
    setUploading(true);
    try {
      const applied = await onUploadIllustration(scene.sceneId, stagedFile, {
        source: "ai-generated", prompt: prompt || buildPrompt(scene), license: "User-provided; Google Flow output imported manually",
        provider: "Google Flow (manual import)", model: "Google Flow",
      });
      if (applied) setStagedFile(null);
    } finally { setUploading(false); }
  };
  const uploadReference = async (file?: File) => {
    if (!file || !validImageFile(file)) { if (file) setFlowNotice("Pilih PNG, JPEG, atau WebP hingga 10 MB."); return; }
    setReferenceBusy(true);
    try {
      const asset = await onUploadReference(file);
      if (asset) onStyleLockChange({ ...storyboard.styleLock, referenceAssetIds: [...new Set([...storyboard.styleLock.referenceAssetIds, asset.id])].slice(0, 8) });
    } finally { setReferenceBusy(false); }
  };
  const styleField = (key: keyof Omit<GoogleFlowStyleLock, "referenceAssetIds">, label: string, rows = 2) => <label className="editor-field" key={key}>{label}<textarea rows={rows} value={storyboard.styleLock[key]} onChange={(event) => onStyleLockChange({ ...storyboard.styleLock, [key]: event.target.value })}/></label>;

  return <><section className={`google-flow-panel ${showPanel ? "" : "google-flow-panel-hidden"}`} aria-label="Google Flow illustration workflow">
    <header className="google-flow-heading"><div><span className="status-chip">WORKFLOW MANUAL</span><h3>Google Flow</h3><p>Buat ilustrasi dengan Google Flow, lalu impor hasilnya ke scene ini.</p></div></header>
    <div className="google-flow-identity"><strong>Scene {String(scene.sceneNumber).padStart(2, "0")} · {scene.headline}</strong><span>Status: {flowStatusLabel(scene.flowStatus)}</span><small>Nama file: {scene.recommendedFilename ?? recommendedGoogleFlowFilename(scene)}</small></div>
    {!promptReady ? <button type="button" className="button button-primary full-button" onClick={preparePrompt} disabled={busy}><FileImage size={15} aria-hidden="true"/> Buat Prompt Ilustrasi</button> : <div className="google-flow-actions">
      <button type="button" className="button button-light" onClick={editPrompt}>Edit Prompt</button>
      <button type="button" className="button button-light" onClick={() => void copy(prompt)}><Copy size={15} aria-hidden="true"/> Salin Prompt</button>
      <a className="button button-light" href={GOOGLE_FLOW_URL} target="_blank" rel="noreferrer noopener"><ExternalLink size={15} aria-hidden="true"/> Buka Google Flow</a>
      <button type="button" className="button button-primary" onClick={() => singleInput.current?.click()} disabled={busy || uploading}><Upload size={15} aria-hidden="true"/> Import Hasil</button>
    </div>}
    {promptReady && <details className="google-flow-prompt-details" open={promptExpanded} onToggle={(event) => setPromptExpanded(event.currentTarget.open)}>
      <summary>Prompt ilustrasi · satu scene</summary>
      <label className="editor-field"><span className="sr-only">Prompt Google Flow scene</span><textarea ref={promptInput} className="google-flow-prompt" rows={7} maxLength={12000} value={prompt} onChange={(event) => setPrompt(event.target.value)} aria-label="Prompt Google Flow scene"/></label>
      <button type="button" className="button button-light full-button" onClick={preparePrompt}><RefreshCw size={14} aria-hidden="true"/> Generate Ulang Prompt</button>
    </details>}
    <p className="google-flow-note">Satu ilustrasi editorial 2D portrait 9:16 per scene. Style Lock membantu konsistensi, bukan jaminan identik. Google Flow dibuka manual; tidak ada API atau otomasi browser.</p>
    <div className="google-flow-single-import">
      <div className="google-flow-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const files = [...event.dataTransfer.files]; if (files.length === 1 && validImageFile(files[0]!)) setStagedFile(files[0]!); else if (files.length > 1) addBatchFiles(files); else setFlowNotice("Pilih satu PNG, JPEG, atau WebP hingga 10 MB."); }}>
        <Upload size={17} aria-hidden="true"/><strong>Impor hasil untuk scene ini</strong><span>Drop PNG, JPEG, atau WebP. Preview muncul sebelum diterapkan.</span>
        <input ref={singleInput} type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy || uploading} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file && validImageFile(file)) setStagedFile(file); else if (file) setFlowNotice("Pilih PNG, JPEG, atau WebP hingga 10 MB."); event.currentTarget.value = ""; }}/>
        <button type="button" className="button button-light" onClick={() => singleInput.current?.click()} disabled={busy || uploading}>Pilih file</button>
      </div>
      {stagedFile && singlePreview?.file === stagedFile && <div className="google-flow-file-preview"><img src={singlePreview.url} alt={`Preview ${stagedFile.name}`}/><div><strong>{stagedFile.name}</strong><small>{(stagedFile.size / 1024).toFixed(0)} KB · provenance Flow dilaporkan pengguna</small><button type="button" className="button button-primary full-button" onClick={() => void uploadOne()} disabled={busy || uploading}>{uploading ? "Mengimpor…" : "Gunakan Ilustrasi"}</button><button type="button" className="button button-light full-button" onClick={() => setStagedFile(null)} disabled={uploading}>Batal</button></div></div>}
    </div>
    <details className="editor-advanced google-flow-project-tools">
      <summary>Advanced · prompt pack, Style Lock, batch import</summary>
      <div className="google-flow-project-actions">
        <button type="button" className="button button-light" onClick={() => onPreparePrompts(storyboard.scenes.filter((item) => !item.flowPrompt).map((item) => ({ sceneId: item.sceneId, prompt: buildPrompt(item) })))} disabled={busy}><FileImage size={15} aria-hidden="true"/> Siapkan Semua Prompt Google Flow</button>
        <button type="button" className="button button-light" onClick={() => void copy(makePack().markdown)}><Copy size={15} aria-hidden="true"/> Copy Semua Prompt</button>
        <button type="button" className="button button-light" onClick={() => download("md")}><Download size={15} aria-hidden="true"/> Export Markdown</button>
        <button type="button" className="button button-light" onClick={() => download("json")}><Download size={15} aria-hidden="true"/> Export JSON</button>
        <button type="button" className="button button-primary" onClick={() => onApplyStyleLock(makeAllPrompts())} disabled={busy}><RefreshCw size={15} aria-hidden="true"/> Apply Style Lock to All Prompts</button>
      </div>
      <details className="google-flow-style-lock"><summary>Global Style Lock · {storyboard.styleLock.illustrationStyle}</summary>
        <div className="google-flow-style-fields">
          {styleField("illustrationStyle", "Illustration style")}
          {styleField("colorPalette", "Color palette")}
          {styleField("lighting", "Lighting")}
          {styleField("visualComplexity", "Visual complexity")}
          {styleField("outlineShapeStyle", "Outline / shape style")}
          {styleField("compositionGuidelines", "Composition guidelines")}
          {styleField("consistencyInstructions", "Consistency instructions")}
        </div>
        <div className="google-flow-reference"><strong>Referensi visual project · {selectedRefs.length}/8</strong><p>Disimpan lokal; AI Facts Studio tidak mengirim atau melampirkan gambar ini ke Google Flow. Unggah reference secara manual di Flow bila dibutuhkan.</p>
          {selectedRefs.map((asset) => <div className="google-flow-reference-item" key={asset.id}><img src={`/visual-assets/${encodeURIComponent(asset.file)}`} alt={`Referensi visual ${asset.name}`}/><span>{asset.name}</span><button type="button" className="button button-light" onClick={() => onStyleLockChange({ ...storyboard.styleLock, referenceAssetIds: storyboard.styleLock.referenceAssetIds.filter((id) => id !== asset.id) })} aria-label={`Lepas referensi ${asset.name}`}>Lepas</button></div>)}
          <input ref={referenceInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { void uploadReference(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}/>
          <button type="button" className="button button-light" onClick={() => referenceInput.current?.click()} disabled={busy || referenceBusy || selectedRefs.length >= 8}>{referenceBusy ? "Mengunggah reference…" : "Tambah reference image"}</button>
          <button type="button" className="button button-light" onClick={() => void copy(Object.entries(storyboard.styleLock).filter(([key]) => key !== "referenceAssetIds").map(([key, value]) => `${key}: ${value}`).join("\n"))}><Copy size={15} aria-hidden="true"/> Copy Style Lock</button>
        </div>
      </details>
      <small>File rekomendasi menyertakan token stabil supaya mapping tetap merujuk identitas scene walau urutan berubah.</small>
    </details>
    {flowNotice && <p className="google-flow-live" role="status">{flowNotice}</p>}{copied && <span className="sr-only" role="status">Disalin</span>}

  </section>{batchOpen && createPortal(<GoogleFlowBatchDialog ref={batchDialogRef} rows={batchRows} scenes={sceneIdentities} missingScenes={missingScenes} error={batchError} progress={batchProgress} applying={batchApplying || busy} inputRef={batchInput} onFiles={addBatchFiles} onRowChange={updateBatchRow} onApply={() => void applyBatch()} onClose={() => { if (!batchApplying) { setBatchOpen(false); setBatchError(""); } }} validAssignments={assignments}/>, document.body)}
  </>;
}

const GoogleFlowBatchDialog = React.forwardRef<HTMLDialogElement, {
  rows: BatchRow[];
  scenes: GoogleFlowMatchScene[];
  missingScenes: VisualStoryboardScene[];
  error: string;
  progress: FlowBatchProgress | { stage: "complete"; total: number; successful: number; failed: number } | null;
  applying: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList | readonly File[]) => void;
  onRowChange: (id: string, change: Partial<Pick<BatchRow, "sceneId" | "skipped">>) => void;
  onApply: () => void;
  onClose: () => void;
  validAssignments: boolean[];
}>(function GoogleFlowBatchDialog({ rows, scenes, missingScenes, error, progress, applying, inputRef, onFiles, onRowChange, onApply, onClose, validAssignments }, ref) {
  const validCount = validAssignments.filter(Boolean).length;
  const progressLabel = progress?.stage === "uploading"
    ? `Mengirim bagian ${progress.batchNumber ?? 1}/${progress.batchCount ?? 1} · ${progress.completedFiles ?? 0}/${progress.totalFiles ?? 0} file selesai · ${progress.percent}%`
    : progress?.stage === "processing"
      ? `Validasi/optimasi bagian ${progress.batchNumber ?? 1}/${progress.batchCount ?? 1} · ${progress.completedFiles ?? 0}/${progress.totalFiles ?? 0} file selesai`
      : progress?.stage === "complete" ? `Selesai · ${progress.successful} berhasil · ${progress.failed} gagal dari ${progress.total}` : "";
  return <dialog ref={ref} className="google-flow-batch-dialog" aria-labelledby="google-flow-batch-title" aria-busy={applying} onClose={onClose} onCancel={(event) => { if (applying) event.preventDefault(); }}>
      <header><div><span className="google-flow-batch-eyebrow">GOOGLE FLOW · BATCH</span><h3 id="google-flow-batch-title">Tinjau impor ilustrasi</h3><p>{rows.length} file dipilih <span aria-hidden="true">·</span> {validCount} siap diterapkan <span aria-hidden="true">·</span> {missingScenes.length} scene belum dipasangkan</p></div><button type="button" className="button button-light icon-button" onClick={onClose} disabled={applying} aria-label="Tutup batch import"><X size={16} aria-hidden="true"/></button></header>
      <div className={`google-flow-batch-drop ${applying ? "is-disabled" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!applying) onFiles([...event.dataTransfer.files]); }}>
        <FileImage size={21} aria-hidden="true"/><div><strong>Lepas gambar di sini atau pilih file</strong><span>PNG, JPEG, atau WebP · maksimal 30 file, 10 MB per file</span></div>
        <input ref={inputRef} type="file" multiple accept="image/png,image/jpeg,image/webp" hidden disabled={applying} aria-label="Pilih gambar untuk batch import" onChange={(event) => { if (event.currentTarget.files?.length) onFiles(event.currentTarget.files); event.currentTarget.value = ""; }}/>
        <button type="button" className="button button-light" onClick={() => inputRef.current?.click()} disabled={applying}>Pilih file</button>
      </div>
      {progress && <div className={`google-flow-batch-progress ${progress.stage}`}>
        <div className="google-flow-batch-progress-heading"><strong role="status" aria-live="polite">{progress.stage === "uploading" ? "Mengirim batch" : progress.stage === "processing" ? "Memproses ilustrasi" : "Impor selesai"}</strong><span>{progressLabel}</span></div>
        <div className={`google-flow-batch-progress-track ${progress.stage === "processing" ? "indeterminate" : ""}`} role="progressbar" aria-label={progress.stage === "uploading" ? "Progres pengiriman file" : progress.stage === "processing" ? "Proses validasi dan optimasi gambar" : "Hasil batch import"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.stage === "uploading" ? progress.percent : progress.stage === "complete" ? 100 : undefined} aria-valuetext={progressLabel}><i style={progress.stage === "uploading" ? { width: `${progress.percent}%` } : progress.stage === "complete" ? { width: "100%" } : undefined}/></div>
        {progress.stage === "processing" && <small>Validasi tetap berjalan per file. Waktu bergantung ukuran dan format gambar.</small>}
      </div>}
      {rows.length > 0 ? <div className="google-flow-batch-table" role="table" aria-label="Pemetaan ilustrasi batch">
        <div className="google-flow-batch-row google-flow-batch-head" role="row"><span role="columnheader">Pratinjau & nama file</span><span role="columnheader">Scene tujuan</span><span role="columnheader">Pencocokan</span><span role="columnheader">Aksi</span></div>
        {rows.map((row, index) => {
          const valid = validAssignments[index];
          const sceneConflict = !row.skipped && !row.validationError && row.sceneId && !valid;
          const duplicateHint = row.duplicateOf ? ` · duplikat konten, aset dapat dipakai ulang (file ${rows.findIndex((candidate) => candidate.id === row.duplicateOf) + 1})` : "";
          const matchStatus = row.serverError ? `Gagal: ${row.serverError}` : row.validationError ?? (row.skipped ? "Dilewati" : `${valid ? row.manual ? "Assignment manual" : row.reason : sceneConflict ? "Konflik: target scene ganda" : row.reason}${duplicateHint}`);
          return <div className={`google-flow-batch-row ${valid ? "valid" : sceneConflict || row.validationError || row.serverError ? "conflict" : ""}`} role="row" key={row.id}>
            <div role="cell" className="google-flow-batch-file"><img src={row.previewUrl} alt=""/><span title={row.file.name}>{row.file.name}<small>{(row.file.size / 1024).toFixed(0)} KB</small></span></div>
            <div role="cell"><label className="sr-only" htmlFor={`flow-assignment-${row.id}`}>Pasangkan {row.file.name} ke scene</label>
              <select id={`flow-assignment-${row.id}`} value={row.sceneId ?? ""} disabled={applying || row.skipped} onChange={(event) => onRowChange(row.id, { sceneId: event.target.value || null })}>
                <option value="">Pilih scene…</option>{scenes.map((scene) => <option key={scene.sceneId} value={scene.sceneId}>Scene {String(scene.sceneNumber).padStart(2, "0")} · {scene.headline}</option>)}
              </select>
            </div>
            <span role="cell" className="google-flow-match-status" title={matchStatus}>{matchStatus}</span>
            <div role="cell"><button type="button" className="button button-light" disabled={applying} onClick={() => onRowChange(row.id, { skipped: !row.skipped })}>{row.skipped ? "Pulihkan" : "Lewati"}</button></div>
          </div>;
        })}
      </div> : <div className="google-flow-batch-empty"><FileImage size={25} aria-hidden="true"/><strong>Belum ada file</strong><span>Pilih beberapa file atau lepas di area impor.</span></div>}
      <div className={`google-flow-batch-missing ${missingScenes.length ? "needs-match" : "all-matched"}`}><strong>{missingScenes.length ? "Scene belum dipasangkan" : "Semua scene terpasang"}</strong><span>{missingScenes.length ? missingScenes.map((scene) => `Scene ${scene.sceneNumber}`).join(", ") : "Semua file valid punya tujuan unik."}</span></div>
      {error && <p className="google-flow-batch-error" role="alert">{error}</p>}
      <footer><button type="button" className="button button-light" onClick={onClose} disabled={applying}>Batal</button><button type="button" className="button button-primary" onClick={onApply} disabled={!validCount || applying}>{applying ? "Mengimpor…" : `Terapkan Ilustrasi${validCount ? ` (${validCount})` : ""}`}</button></footer>
  </dialog>;
});

function validImageFile(file: File) {
  return ["image/png", "image/jpeg", "image/webp"].includes(file.type) && file.size > 0 && file.size <= 10 * 1024 * 1024;
}

function flowStatusLabel(status: VisualStoryboardScene["flowStatus"]) {
  return ({ "awaiting-illustration": "Menunggu Ilustrasi", "prompt-ready": "Prompt Siap", "illustration-imported": "Ilustrasi Diimport", "ready-for-review": "Siap Ditinjau", approved: "Disetujui" } as const)[status];
}
