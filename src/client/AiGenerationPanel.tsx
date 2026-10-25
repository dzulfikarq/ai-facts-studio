import React, { useEffect, useRef, useState } from "react";
import { categories, motionCues, templateIds, visualPresets, type ResearchPackage, type Scene } from "../domain/research";
import { aiGenerationInputSchema, buildDevelopmentPrompt, parseManualAiResultText, researchPackageWithConfirmedSources, restoreAiGenerationDraft, type AiGenerationDraft, type AiGenerationInput, type AiSourceCandidate } from "../domain/ai-generation";
import { defaultMotionPlan, defaultVisualComposition } from "../domain/visual-defaults";
import { visualCompositionSchema } from "../domain/visual-composition";

type ProductionStatus = { model: string | null; allowedModels: string[]; configured: boolean; disabledReason: string | null; freeTierOnly: boolean; dailyLimit: number; requestsUsed: number; requestsRemaining: number };
type DevelopmentStatus = { configured: boolean; connected: boolean; version: string | null; models: Array<{ id: string; providerID: string; modelID: string; name: string }>; disabledReason: string | null };
type ValidationIssue = { path?: string; message: string };
type GenerationPhase = "idle" | "connecting" | "generating" | "validating" | "repairing";
type Props = {
  mode: "development" | "production" | null;
  development: DevelopmentStatus | null;
  production: ProductionStatus | null;
  projectBusy: boolean;
  onGenerate: (input: AiGenerationInput, model: string | undefined, signal: AbortSignal, onProgress: (phase: GenerationPhase) => void) => Promise<AiGenerationDraft>;
  onCreateProject: (researchPackage: ResearchPackage, requestId: string) => Promise<{ id: string; title: string } | null>;
  onOpenProject: (id: string) => void;
};

const draftStorageKey = "ai-facts-studio:ai-generation-draft:v1";
const inputStorageKey = "ai-facts-studio:ai-generation-input:v1";
const modelStorageKey = "ai-facts-studio:opencode-model:v1";
const maxAiResultCharacters = 1_000_000;
const defaultInput: AiGenerationInput = { topic: "", language: "id-ID", targetDurationSec: 30, deliveryStyle: "edukatif", additionalInstructions: "", sourceUrls: [] };

function loadInput(): AiGenerationInput {
  try {
    const parsed = aiGenerationInputSchema.safeParse(JSON.parse(localStorage.getItem(inputStorageKey) ?? "null"));
    if (parsed.success) return parsed.data;
  } catch { /* Invalid/missing local draft uses defaults. */ }
  return defaultInput;
}

function loadDraft() {
  try { return restoreAiGenerationDraft(JSON.parse(localStorage.getItem(draftStorageKey) ?? "null")); }
  catch { return null; }
}

function readableIssues(issues: ValidationIssue[]) {
  return issues.slice(0, 8).map((issue) => `${issue.path || "JSON"}: ${issue.message}`);
}

function newId() {
  return globalThis.crypto.randomUUID();
}

export function AiGenerationPanel({ mode, development, production, projectBusy, onGenerate, onCreateProject, onOpenProject }: Props) {
  const [initialInput] = useState(loadInput);
  const [input, setInput] = useState<AiGenerationInput>(initialInput);
  const [sourceText, setSourceText] = useState(initialInput.sourceUrls.join("\n"));
  const [draft, setDraft] = useState<AiGenerationDraft | null>(loadDraft);
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem(modelStorageKey) ?? "");
  const [manualPrompt, setManualPrompt] = useState("");
  const [pasteResult, setPasteResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<GenerationPhase>("idle");
  const [waitingForOutput, setWaitingForOutput] = useState(false);
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const [savedNotice, setSavedNotice] = useState("");
  const generationController = useRef<AbortController | null>(null);

  useEffect(() => {
    try { localStorage.setItem(inputStorageKey, JSON.stringify(input)); } catch { /* Local persistence is best effort. */ }
  }, [input]);
  useEffect(() => {
    try {
      if (draft) localStorage.setItem(draftStorageKey, JSON.stringify(draft));
      else localStorage.removeItem(draftStorageKey);
    } catch { setSavedNotice("Draft lokal tidak dapat disimpan; salin hasil JSON untuk cadangan."); }
  }, [draft]);
  useEffect(() => {
    try { if (selectedModel) localStorage.setItem(modelStorageKey, selectedModel); else localStorage.removeItem(modelStorageKey); } catch { /* Model preference is best effort. */ }
  }, [selectedModel]);
  useEffect(() => {
    if (development && selectedModel && !development.models.some((model) => model.id === selectedModel)) setSelectedModel("");
  }, [development, selectedModel]);

  const status = busy ? phase : issues.length || error ? "validation-failed" : draft?.status ?? (waitingForOutput ? "waiting-for-output" : "draft-input");
  const generating = busy && phase !== "idle";
  const statusText: Record<string, string> = {
    "draft-input": "Draft Input",
    "waiting-for-output": "Menunggu Output AI",
    connecting: "Menghubungi provider",
    generating: "Menyusun riset & storyboard",
    validating: "Memvalidasi output",
    repairing: "Memperbaiki struktur output",
    "validation-failed": "Validation Failed",
    "ready-for-review": "Ready for Review",
    approved: "Approved",
    "project-created": "Project Created",
  };

  function validateInput() {
    const result = aiGenerationInputSchema.safeParse({ ...input, sourceUrls: sourceText.split(/\r?\n/).map((url) => url.trim()).filter(Boolean) });
    if (!result.success) {
      setIssues(readableIssues(result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))));
      setError("Perbaiki input sebelum melanjutkan.");
      return null;
    }
    setInput(result.data);
    setSourceText(result.data.sourceUrls.join("\n"));
    setIssues([]);
    setError("");
    return result.data;
  }

  function showManualPrompt() {
    const validInput = validateInput();
    if (!validInput) return;
    setManualPrompt(buildDevelopmentPrompt(validInput));
    setWaitingForOutput(true);
    setError("");
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(manualPrompt);
      setSavedNotice("Prompt disalin. Tempel di ChatGPT/OpenCode, lalu paste hasil JSON di bawah.");
    } catch { setError("Clipboard tidak tersedia. Pilih dan salin prompt secara manual."); }
  }

  function validateManualResult() {
    const validInput = validateInput();
    if (!validInput) return;
    if (pasteResult.length > maxAiResultCharacters) { setIssues(["JSON: Maksimal 1 MB."]); setError("Output AI melewati batas 1 MB."); return; }
    const result = parseManualAiResultText(pasteResult, validInput, newId());
    if (!result.success) {
      setIssues(readableIssues(result.issues));
      setError("Validation Failed: periksa format JSON dan Research Package schema.");
      return;
    }
    setDraft(result.draft);
    setWaitingForOutput(false);
    setIssues([]);
    setError("");
    setSavedNotice("Research Package tervalidasi dan tersimpan sebagai draft lokal.");
  }

  async function generateProductionResult() {
    if (generationController.current || busy || projectBusy || !mode) return;
    const validInput = validateInput();
    if (!validInput || (mode === "production" && !production?.configured) || (mode === "development" && (!development?.configured || !development.models.some((model) => model.id === selectedModel)))) return;
    const controller = new AbortController();
    generationController.current = controller;
    setBusy(true);
    setPhase("connecting");
    setWaitingForOutput(false);
    setIssues([]);
    setError("");
    setSavedNotice("");
    try {
      const generated = await onGenerate(validInput, mode === "development" ? selectedModel : undefined, controller.signal, setPhase);
      setDraft(generated);
      setSavedNotice(`${mode === "development" ? "OpenCode" : "Gemini"} output tervalidasi; periksa sumber, klaim, dan scene sebelum membuat project.`);
    } catch (cause) {
      const failure = cause as Error & { issues?: ValidationIssue[] };
      if (controller.signal.aborted || failure.name === "AbortError") setSavedNotice("Generation dibatalkan. Draft sebelumnya tetap tersimpan.");
      else {
        if (failure.issues?.length) setIssues(readableIssues(failure.issues));
        setError(failure.message);
      }
    } finally { generationController.current = null; setPhase("idle"); setBusy(false); }
  }

  function cancelGeneration() { generationController.current?.abort(); }

  function saveDraft() {
    try {
      if (draft) localStorage.setItem(draftStorageKey, JSON.stringify(draft));
      localStorage.setItem(inputStorageKey, JSON.stringify(input));
      setSavedNotice("Draft dan input tersimpan di perangkat ini.");
    } catch { setError("Draft tidak dapat disimpan di local storage."); }
  }

  function startNewTopic() {
    setDraft(null);
    setManualPrompt("");
    setPasteResult("");
    setWaitingForOutput(false);
    setIssues([]);
    setError("");
    setSavedNotice("");
  }

  function approveReview() {
    if (!draft) return;
    const packageResult = researchPackageWithConfirmedSources(draft);
    if (!packageResult.success) {
      setIssues(readableIssues(packageResult.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))));
      setError("Storyboard belum valid. Perbaiki field yang ditandai sebelum Create Project.");
      return;
    }
    setDraft({ ...draft, researchPackage: packageResult.data, status: "approved" });
    setIssues([]);
    setError("");
  }

  async function createProject() {
    if (!draft || draft.status !== "approved" || busy || projectBusy) return;
    const packageResult = researchPackageWithConfirmedSources(draft);
    if (!packageResult.success) {
      setIssues(readableIssues(packageResult.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))));
      setError("Storyboard berubah atau tidak valid. Tinjau ulang sebelum Create Project.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await onCreateProject(packageResult.data, draft.researchPackage.id);
      if (created) setDraft({ ...draft, researchPackage: packageResult.data, status: "project-created", projectId: created.id });
      else setError("Project belum dibuat. Perbaiki error di halaman atau coba kembali.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Project gagal dibuat."); }
    finally { setBusy(false); }
  }

  return <div className="ai-generate-panel">
    <section className="ai-generation-form ai-settings-panel">
      <div className="settings-panel-heading"><div><h2>Generate with AI</h2><p>Topik bebas → riset dan storyboard draft. Tidak ada TTS atau render otomatis.</p></div><span className={`settings-mode-badge ${mode ?? "development"}`}>{mode ? mode.toUpperCase() : "MEMUAT MODE"}</span></div>
      {!mode && <div className="workflow-empty" role="status">Memuat AI Generation Mode dari backend lokal…</div>}
      <div className="ai-form-grid">
        <label className="ai-topic-field"><span>Judul / topik <b>*</b></span><input maxLength={120} placeholder="Contoh: Kenapa langit berwarna biru?" value={input.topic} onChange={(event) => setInput((current) => ({ ...current, topic: event.target.value }))} disabled={!mode || busy || projectBusy} /></label>
        <label><span>Bahasa</span><select value={input.language} onChange={(event) => setInput((current) => ({ ...current, language: event.target.value }))} disabled={!mode || busy || projectBusy}><option value="id-ID">Bahasa Indonesia</option><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option></select></label>
        <label><span>Durasi target</span><select value={input.targetDurationSec} onChange={(event) => setInput((current) => ({ ...current, targetDurationSec: Number(event.target.value) as 30 | 45 | 60 }))} disabled={!mode || busy || projectBusy}><option value={30}>30 detik</option><option value={45}>45 detik</option><option value={60}>60 detik</option></select></label>
        <label><span>Gaya penyampaian</span><select value={input.deliveryStyle} onChange={(event) => setInput((current) => ({ ...current, deliveryStyle: event.target.value as AiGenerationInput["deliveryStyle"] }))} disabled={!mode || busy || projectBusy}><option value="edukatif">Edukatif</option><option value="storytelling">Storytelling</option><option value="santai">Santai</option></select></label>
        <label className="ai-source-field"><span>URL sumber opsional <small>satu URL per baris; aplikasi tidak fetch/verify</small></span><textarea rows={3} placeholder="https://..." value={sourceText} onChange={(event) => { setSourceText(event.target.value); setInput((current) => ({ ...current, sourceUrls: event.target.value.split(/\r?\n/).map((url) => url.trim()).filter(Boolean) })); }} disabled={!mode || busy || projectBusy} /></label>
        <label className="ai-instructions-field"><span>Instruksi tambahan</span><textarea rows={3} maxLength={1000} placeholder="Contoh: gunakan analogi sederhana untuk anak SMP" value={input.additionalInstructions} onChange={(event) => setInput((current) => ({ ...current, additionalInstructions: event.target.value }))} disabled={!mode || busy || projectBusy} /></label>
      </div>

      {mode === "development" && <div className="ai-development-flow">
        <div className={`ai-opencode-status ${development?.configured ? "configured" : "unconfigured"}`}>
          <div><span className={`settings-status-pill ${development?.configured ? "configured" : "unconfigured"}`}>{development?.configured ? "OpenCode connected" : "OpenCode unavailable"}</span><small>{development?.version ? `Server ${development.version}` : development?.disabledReason ?? "Memeriksa OpenCode lokal…"}</small></div>
          <label><span>Model OpenCode</span><select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} disabled={!development?.configured || busy || projectBusy}><option value="">Pilih model authorized…</option>{development?.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
        </div>
        <div className="ai-opencode-disclosure">Topik, instruksi, dan URL yang Anda isi dikirim ke OpenCode lokal setelah klik. Session memakai direktori kosong dan tool dinonaktifkan; model/provider tetap mengikuti pilihan Anda di OpenCode dan dapat memiliki biaya sendiri. Tidak ada fallback model.</div>
        <div className="ai-generation-actions">
          <button type="button" className="button button-primary" onClick={() => void generateProductionResult()} disabled={!development?.configured || !selectedModel || !mode || busy || projectBusy}>{generating ? statusText[phase] ?? "Generating…" : "Generate Research & Storyboard"}</button>
          {generating && <button type="button" className="button button-light" onClick={cancelGeneration}>Batalkan</button>}
          {generating && <span className="ai-progress-copy" role="status">{statusText[phase] ?? "Menyiapkan generation…"}</span>}
        </div>
        {!development?.configured && <div className="workflow-empty">{development?.disabledReason ?? "OpenCode status belum tersedia."} Manual prompt tetap bisa digunakan dari Advanced.</div>}
        <details className="ai-advanced-flow">
          <summary>Advanced · prompt manual / paste JSON</summary>
          <div className="ai-manual-flow">
            <div className="ai-manual-actions"><button type="button" className="button button-light" onClick={showManualPrompt} disabled={busy || projectBusy}>Buat Prompt Manual</button><span>Fallback manual; tidak memanggil provider dari aplikasi.</span></div>
            {manualPrompt && <label><span>Prompt untuk ChatGPT / OpenCode</span><textarea className="manual-prompt" readOnly rows={8} value={manualPrompt} /><button type="button" className="button button-light" onClick={() => void copyPrompt()}>Copy Prompt</button></label>}
            {waitingForOutput && <div className="workflow-alert attention" role="status">Menunggu output AI eksternal. Tempel JSON hasilnya di bawah.</div>}
            <label><span>Paste AI Result / Research Package JSON</span><textarea className="manual-prompt-result" maxLength={maxAiResultCharacters} rows={10} spellCheck={false} placeholder="Paste JSON Research Package v1.0/v1.1 atau ai-generated content envelope." value={pasteResult} onChange={(event) => setPasteResult(event.target.value)} disabled={busy || projectBusy} /><small>Maksimal 1 MB.</small></label>
            <button type="button" className="button button-light" onClick={validateManualResult} disabled={!pasteResult.trim() || busy || projectBusy}>Validate & Review</button>
          </div>
        </details>
      </div>}

      {mode === "production" && <div className="ai-production-flow">
        <div className={`ai-production-config ${production?.configured ? "configured" : "unconfigured"}`}>
          <span className={`settings-status-pill ${production?.configured ? "configured" : "unconfigured"}`}>{production?.configured ? "Gemini Text configured" : "Gemini Text unconfigured"}</span>
          <span>{production?.model ?? "Model belum dikonfigurasi"} · Free Tier guard {production?.freeTierOnly ? "aktif" : "tidak aktif"} · quota {production ? `${production.requestsUsed}/${production.dailyLimit}` : "—"}</span>
          {production?.disabledReason && <small>{production.disabledReason}</small>}
        </div>
        <div className="tts-consent-note">Generate akan mengirim topik, instruksi, dan URL sumber yang Anda isi ke Gemini setelah klik. URL tidak di-fetch oleh aplikasi; semua klaim tetap perlu review manusia. Tidak ada paid model fallback.</div>
        <div className="ai-generation-actions"><button type="button" className="button button-primary" onClick={() => void generateProductionResult()} disabled={!production?.configured || !mode || busy || projectBusy}>{generating ? statusText[phase] ?? "Generating…" : "Generate Research & Storyboard"}</button>{generating && <button type="button" className="button button-light" onClick={cancelGeneration}>Batalkan</button>}{generating && <span className="ai-progress-copy" role="status">{statusText[phase] ?? "Menyiapkan generation…"}</span>}</div>
      </div>}

      {mode === "production" && !production?.configured && <div className="workflow-empty">Pilih Development untuk OpenCode lokal/manual fallback, atau lengkapi Gemini backend. API key tidak dimasukkan di browser.</div>}
      {error && <div className="workflow-alert danger" role="alert">{error}{issues.length > 0 && <ul>{issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul>}</div>}
      {savedNotice && <div className="workflow-alert success" role="status">{savedNotice}</div>}
      {!draft && !busy && <div className="ai-generation-status-row"><span className={`settings-status-pill ${status === "validation-failed" ? "unconfigured" : "configured"}`}>{statusText[status] ?? statusText["draft-input"]}</span></div>}
    </section>

    {draft && <AiDraftReview draft={draft} busy={busy || projectBusy} onChange={setDraft} onSave={saveDraft} onApprove={approveReview} onCreate={() => void createProject()} onNewTopic={startNewTopic} onOpenProject={onOpenProject} />}
  </div>;
}

function AiDraftReview({ draft, busy, onChange, onSave, onApprove, onCreate, onNewTopic, onOpenProject }: {
  draft: AiGenerationDraft;
  busy: boolean;
  onChange: (draft: AiGenerationDraft) => void;
  onSave: () => void;
  onApprove: () => void;
  onCreate: () => void;
  onNewTopic: () => void;
  onOpenProject: (id: string) => void;
}) {
  const selectedSources = new Set(draft.selectedSourceIds);
  function revise(change: (current: AiGenerationDraft) => AiGenerationDraft) {
    const changed = change(draft);
    onChange({ ...changed, researchPackage: { ...changed.researchPackage, id: newId() }, status: "ready-for-review" });
  }
  function updateScene(sceneId: string, change: (scene: Scene) => Scene) {
    revise((current) => {
      const scenes = current.researchPackage.scenes.map((scene) => scene.id === sceneId ? change(scene) : scene);
      return { ...current, researchPackage: { ...current.researchPackage, scenes, narration: scenes.map((scene) => scene.narrationText.trim()).filter(Boolean).join("\n\n") } };
    });
  }
  function updateDuration(value: string) {
    const targetDurationSec = Number(value) as 30 | 45 | 60;
    revise((current) => {
      const slice = targetDurationSec / current.researchPackage.scenes.length;
      const scenes = current.researchPackage.scenes.map((scene, index) => ({ ...scene, startSec: Math.round(index * slice * 1000) / 1000, endSec: index === current.researchPackage.scenes.length - 1 ? targetDurationSec : Math.round((index + 1) * slice * 1000) / 1000 }));
      return { ...current, input: { ...current.input, targetDurationSec }, researchPackage: { ...current.researchPackage, targetDurationSec, scenes } };
    });
  }
  function toggleSource(sourceId: string, checked: boolean) {
    revise((current) => ({ ...current, selectedSourceIds: checked ? [...new Set([...current.selectedSourceIds, sourceId])] : current.selectedSourceIds.filter((id) => id !== sourceId) }));
  }
  function toggleSceneSource(sceneId: string, sourceId: string, checked: boolean) {
    revise((current) => {
      const ids = current.sceneSourceIds[sceneId] ?? [];
      return { ...current, sceneSourceIds: { ...current.sceneSourceIds, [sceneId]: checked ? [...new Set([...ids, sourceId])] : ids.filter((id) => id !== sourceId) } };
    });
  }
  function addScene() {
    revise((current) => {
      const sceneId = `scene-ai-${newId().slice(0, 8)}`;
      const cues = ["fadeIn"] as Scene["motionCues"];
      const scenes = [...current.researchPackage.scenes, {
        id: sceneId,
        order: current.researchPackage.scenes.length + 1,
        startSec: 0,
        endSec: 1,
        narrationText: "Tulis narasi scene baru.",
        onScreenText: "Teks scene baru",
        templateId: "infographic" as const,
        visualDescription: "Tambahkan arahan visual editorial.",
        motionCues: cues,
        sfxCues: [] as Scene["sfxCues"],
        referenceIds: [],
        visualComposition: visualCompositionSchema.parse(defaultVisualComposition("infographic")),
        motionPlan: defaultMotionPlan(cues),
      }];
      const slice = current.researchPackage.targetDurationSec / scenes.length;
      return {
        ...current,
        sceneSourceIds: { ...current.sceneSourceIds, [sceneId]: [] },
        researchPackage: { ...current.researchPackage, scenes: scenes.map((scene, index) => ({ ...scene, order: index + 1, startSec: Math.round(index * slice * 1000) / 1000, endSec: index === scenes.length - 1 ? current.researchPackage.targetDurationSec : Math.round((index + 1) * slice * 1000) / 1000 })) },
      };
    });
  }
  function removeScene(sceneId: string) {
    if (draft.researchPackage.scenes.length <= 1) return;
    revise((current) => {
      const scenes = current.researchPackage.scenes.filter((scene) => scene.id !== sceneId);
      const slice = current.researchPackage.targetDurationSec / scenes.length;
      return {
        ...current,
        sceneSourceIds: Object.fromEntries(Object.entries(current.sceneSourceIds).filter(([id]) => id !== sceneId)),
        researchPackage: { ...current.researchPackage, scenes: scenes.map((scene, index) => ({ ...scene, order: index + 1, startSec: Math.round(index * slice * 1000) / 1000, endSec: index === scenes.length - 1 ? current.researchPackage.targetDurationSec : Math.round((index + 1) * slice * 1000) / 1000 })) },
      };
    });
  }
  function changeTemplate(sceneId: string, templateId: Scene["templateId"]) {
    updateScene(sceneId, (scene) => ({ ...scene, templateId, visualComposition: visualCompositionSchema.parse(defaultVisualComposition(templateId)), motionPlan: defaultMotionPlan(scene.motionCues) }));
  }
  function toggleMotion(sceneId: string, cue: typeof motionCues[number], checked: boolean) {
    updateScene(sceneId, (scene) => {
      const motionCues = checked ? [...scene.motionCues, cue] : scene.motionCues.filter((item) => item !== cue);
      return { ...scene, motionCues, motionPlan: defaultMotionPlan(motionCues) };
    });
  }

  const packageCheck = researchPackageWithConfirmedSources(draft);
  const statusLabel = draft.status === "project-created" ? "Project Created" : draft.status === "approved" ? "Approved" : "Ready for Review";
  return <section className="ai-draft-review ai-settings-panel">
    <div className="settings-panel-heading"><div><span className="eyebrow">REVIEW SEBELUM CREATE</span><h2>{draft.researchPackage.title}</h2><p>{draft.review.summary}</p></div><span className={`settings-status-pill ${draft.status === "project-created" || draft.status === "approved" ? "configured" : "unconfigured"}`}>{statusLabel}</span></div>
    <div className="ai-review-meta"><span>{draft.provider === "opencode-local" ? `OpenCode · ${draft.model ?? "model terpilih"}` : draft.provider === "manual-prompt" ? "Manual Development" : "Gemini Production"}</span><span>{draft.researchPackage.scenes.length} scenes</span><span>{draft.researchPackage.targetDurationSec} detik</span><span>{draft.sourceCandidates.length} kandidat sumber</span></div>
    <div className="ai-review-title-row">
      <label><span>Judul project</span><input maxLength={120} value={draft.researchPackage.title} disabled={busy || draft.status === "project-created"} onChange={(event) => revise((current) => ({ ...current, researchPackage: { ...current.researchPackage, title: event.target.value } }))} /></label>
      <label><span>Durasi target</span><select value={draft.researchPackage.targetDurationSec} disabled={busy || draft.status === "project-created"} onChange={(event) => updateDuration(event.target.value)}>{[30, 45, 60].map((value) => <option key={value} value={value}>{value} detik</option>)}</select></label>
    </div>
    <div className="ai-review-title-row ai-review-package-options">
      <label><span>Kategori</span><select value={draft.researchPackage.category} disabled={busy || draft.status === "project-created"} onChange={(event) => revise((current) => ({ ...current, researchPackage: { ...current.researchPackage, category: event.target.value as ResearchPackage["category"] } }))}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
      <label><span>Visual preset</span><select value={draft.researchPackage.visualPreset} disabled={busy || draft.status === "project-created"} onChange={(event) => revise((current) => ({ ...current, researchPackage: { ...current.researchPackage, visualPreset: event.target.value as ResearchPackage["visualPreset"] } }))}>{visualPresets.map((preset) => <option key={preset} value={preset}>{preset.replaceAll("-", " ")}</option>)}</select></label>
    </div>

    <section className="ai-review-block"><div className="ai-review-block-head"><div><h3>Riset & fakta</h3><p>Classification dari output AI; bukan fact-check independen.</p></div></div>
      <div className="ai-facts-list">{draft.review.facts.map((fact, index) => {
        const sourcesCheckedByUser = fact.sourceIds.length > 0 && fact.sourceIds.every((id) => selectedSources.has(id));
        return <article className="ai-fact-row" key={`${index}-${fact.claim}`}><div><strong>{fact.claim}</strong>{fact.uncertaintyNote && <small>{fact.uncertaintyNote}</small>}<span>{fact.classification === "interpretation" ? "Interpretasi" : fact.classification === "unclassified" ? "Klaim perlu diklasifikasi" : sourcesCheckedByUser ? "Sumber ditandai ditinjau pengguna; klaim tetap perlu fact-check" : fact.sourceIds.length ? "Referensi kandidat · belum ditinjau" : "Fakta belum terverifikasi"}</span></div></article>;
      })}</div>
      {!!draft.review.uncertainties.length && <ul className="ai-uncertainty-list">{draft.review.uncertainties.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>}
      {draft.review.warnings.map((warning) => <div className="workflow-alert attention" key={warning}>{warning}</div>)}
    </section>

    <section className="ai-review-block"><div className="ai-review-block-head"><div><h3>Sumber & referensi</h3><p>Hanya sumber yang Anda periksa ditambahkan ke Research Package. Aplikasi tidak mengambil isi halaman.</p></div></div>
      {draft.sourceCandidates.length ? <div className="ai-source-candidate-list">{draft.sourceCandidates.map((source: AiSourceCandidate) => <div className="ai-source-candidate" key={source.id}><label><input type="checkbox" checked={selectedSources.has(source.id)} disabled={busy || draft.status === "project-created"} onChange={(event) => toggleSource(source.id, event.target.checked)} /><span><strong>{source.title}</strong><small>{source.url}</small><em>{selectedSources.has(source.id) ? "Ditandai sudah diperiksa pengguna" : "Kandidat · belum diperiksa"}</em></span></label><a href={source.url} target="_blank" rel="noreferrer">Buka sumber ↗</a></div>)}</div> : <div className="workflow-empty">Belum ada referensi. Tambahkan URL pada form input atau edit Research Package setelah project dibuat. Klaim tetap berstatus unverified.</div>}
    </section>

    <section className="ai-review-block"><div className="ai-review-block-head"><div><h3>Storyboard</h3><p>Arahan visual bersifat editorial; renderer tidak membuat art topic-specific otomatis.</p></div><button type="button" className="button button-light" onClick={addScene} disabled={busy || draft.status === "project-created" || draft.researchPackage.scenes.length >= 30}>Tambah scene</button></div>
      <div className="ai-review-scenes">{draft.researchPackage.scenes.map((scene, index) => <article className="ai-review-scene" key={scene.id}>
        <div className="ai-review-scene-head"><span className="scene-number">{String(index + 1).padStart(2, "0")}</span><strong>Scene {index + 1}</strong><button type="button" className="text-button danger-text" onClick={() => removeScene(scene.id)} disabled={busy || draft.status === "project-created" || draft.researchPackage.scenes.length <= 1}>Hapus scene</button></div>
        <label><span>On-screen text</span><input maxLength={120} value={scene.onScreenText} disabled={busy || draft.status === "project-created"} onChange={(event) => updateScene(scene.id, (current) => ({ ...current, onScreenText: event.target.value }))} /></label>
        <label><span>Narasi</span><textarea rows={3} maxLength={2000} value={scene.narrationText} disabled={busy || draft.status === "project-created"} onChange={(event) => updateScene(scene.id, (current) => ({ ...current, narrationText: event.target.value }))} /></label>
        <label><span>Visual direction · editorial</span><textarea rows={2} maxLength={500} value={scene.visualDescription} disabled={busy || draft.status === "project-created"} onChange={(event) => updateScene(scene.id, (current) => ({ ...current, visualDescription: event.target.value }))} /></label>
        <label><span>Template</span><select value={scene.templateId} disabled={busy || draft.status === "project-created"} onChange={(event) => changeTemplate(scene.id, event.target.value as Scene["templateId"])}>{templateIds.map((id) => <option key={id} value={id}>{id.replaceAll("-", " ")}</option>)}</select></label>
        <div className="ai-review-timing-row"><label><span>Mulai (detik)</span><input type="number" min="0" max="120" step="0.1" value={scene.startSec} disabled={busy || draft.status === "project-created"} onChange={(event) => updateScene(scene.id, (current) => ({ ...current, startSec: Number(event.target.value) }))} /></label><label><span>Akhir (detik)</span><input type="number" min="0.1" max="120" step="0.1" value={scene.endSec} disabled={busy || draft.status === "project-created"} onChange={(event) => updateScene(scene.id, (current) => ({ ...current, endSec: Number(event.target.value) }))} /></label></div>
        <fieldset className="ai-review-motion"><legend>Motion direction</legend>{motionCues.map((cue) => <label key={cue}><input type="checkbox" checked={scene.motionCues.includes(cue)} disabled={busy || draft.status === "project-created"} onChange={(event) => toggleMotion(scene.id, cue, event.target.checked)} /><span>{cue.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())}</span></label>)}</fieldset>
        {draft.sourceCandidates.length > 0 && <fieldset className="ai-scene-source-links"><legend>Sumber klaim · pilih yang cocok</legend>{draft.sourceCandidates.map((source) => <label key={source.id}><input type="checkbox" checked={(draft.sceneSourceIds[scene.id] ?? []).includes(source.id)} disabled={!selectedSources.has(source.id) || busy || draft.status === "project-created"} onChange={(event) => toggleSceneSource(scene.id, source.id, event.target.checked)} /><span>{source.title}</span></label>)}</fieldset>}
      </article>)}</div>
    </section>

    {packageCheck.success === false && <div className="workflow-alert danger" role="alert">{packageCheck.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" · ")}</div>}
    <div className="ai-review-actions"><small>Draft tersimpan lokal. Tidak ada TTS atau render di tahap ini.</small><div className="ai-review-action-buttons">
      <button type="button" className="button button-light" onClick={onSave}>Simpan draft</button>
      {draft.status !== "project-created" && <button type="button" className="button button-light" onClick={onApprove} disabled={busy || !packageCheck.success}>Tandai review selesai</button>}
      {draft.status === "approved" && <button type="button" className="button button-primary" onClick={onCreate} disabled={busy || !packageCheck.success}>Create Project <b>→</b></button>}
      {draft.status === "project-created" && draft.projectId && <button type="button" className="button button-primary" onClick={() => onOpenProject(draft.projectId!)}>Buka project <b>→</b></button>}
      <button type="button" className="text-button" onClick={onNewTopic} disabled={busy}>Topik baru</button>
    </div></div>
  </section>;
}
