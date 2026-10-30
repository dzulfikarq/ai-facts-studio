import React, { useEffect, useRef, useState } from "react";
import type { ResearchPackage } from "../domain/research";
import { aiGenerationInputSchema, buildDevelopmentPrompt, parseManualAiResultText, researchPackageWithConfirmedSources, type AiGenerationDraft, type AiGenerationInput } from "../domain/ai-generation";
import type { WorkspaceStep } from "./workflow";

export type ProductionStatus = {
  model: string | null; allowedModels: string[]; configured: boolean; disabledReason: string | null; apiKeyConfigured: boolean;
  freeTierOnly: boolean; dailyLimit: number; requestsUsed: number; requestsRemaining: number;
  projectLimits: { rpm: number | null; rpd: number | null; tpm: number | null };
  quotaMonitoring: {
    usageSource: "local-records"; limitSource: "operator-configured-ai-studio"; model: string | null;
    rpm: QuotaWindow; rpd: QuotaWindow; tpm: QuotaWindow;
  };
};
type QuotaWindow = { used: number | null; limit: number | null; estimatedRemaining: number | null; cooldownUntil: string | null };
type DevelopmentStatus = { configured: boolean; connected: boolean; state: "server-unreachable" | "authentication-failed" | "unsupported-api-version" | "model-unavailable" | "connected"; apiVersion: "v1" | "v2" | null; version: string | null; models: Array<{ id: string; providerID: string; modelID: string; name: string }>; disabledReason: string | null };
type ValidationIssue = { path?: string; message: string };
type GenerationPhase = "idle" | "connecting" | "generating" | "validating" | "repairing" | "saving";
type Props = {
  mode: "development" | "production" | null;
  development: DevelopmentStatus | null;
  production: ProductionStatus | null;
  projectBusy: boolean;
  onGenerate: (input: AiGenerationInput, model: string | undefined, signal: AbortSignal, onProgress: (phase: GenerationPhase) => void) => Promise<AiGenerationDraft>;
  onCreateProject: (researchPackage: ResearchPackage, requestId: string) => Promise<{ id: string; title: string } | null>;
  onOpenProject: (id: string, notice?: string, initialStep?: WorkspaceStep) => void;
  onUnsavedChange: (hasUnsavedDraft: boolean) => void;
};

const legacyDraftStorageKey = "ai-facts-studio:ai-generation-draft:v1";
const legacyInputStorageKey = "ai-facts-studio:ai-generation-input:v1";
const modelStorageKey = "ai-facts-studio:opencode-model:v1";
const maxAiResultCharacters = 1_000_000;
const defaultInput: AiGenerationInput = { topic: "", language: "id-ID", targetDurationSec: 30, deliveryStyle: "edukatif", additionalInstructions: "", sourceUrls: [] };

function readableIssues(issues: ValidationIssue[]) {
  return issues.slice(0, 8).map((issue) => `${issue.path || "JSON"}: ${issue.message}`);
}

function newId() {
  return globalThis.crypto.randomUUID();
}

export function AiGenerationPanel({ mode, development, production, projectBusy, onGenerate, onCreateProject, onOpenProject, onUnsavedChange }: Props) {
  const [input, setInput] = useState<AiGenerationInput>(() => ({ ...defaultInput, sourceUrls: [] }));
  const [sourceText, setSourceText] = useState("");
  const [pendingDraft, setPendingDraft] = useState<AiGenerationDraft | null>(null);
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
  const projectCreationInFlight = useRef(false);

  useEffect(() => {
    try { localStorage.removeItem(legacyInputStorageKey); localStorage.removeItem(legacyDraftStorageKey); } catch { /* Legacy browser drafts are never restored. */ }
  }, []);
  useEffect(() => {
    onUnsavedChange(Boolean(pendingDraft));
    return () => onUnsavedChange(false);
  }, [pendingDraft, onUnsavedChange]);
  useEffect(() => {
    try { if (selectedModel) localStorage.setItem(modelStorageKey, selectedModel); else localStorage.removeItem(modelStorageKey); } catch { /* Model preference is best effort. */ }
  }, [selectedModel]);
  useEffect(() => {
    if (development && selectedModel && !development.models.some((model) => model.id === selectedModel)) setSelectedModel("");
  }, [development, selectedModel]);

  const status = busy ? phase : issues.length ? "validation-failed" : error ? "generation-failed" : waitingForOutput ? "waiting-for-output" : "draft-input";
  const generating = busy && phase !== "idle";
  const locked = busy || projectBusy || Boolean(pendingDraft);
  const openCodeStatusText: Record<DevelopmentStatus["state"], string> = {
    "server-unreachable": "Server Unreachable",
    "authentication-failed": "Authentication Failed",
    "unsupported-api-version": "Unsupported API Version",
    "model-unavailable": "Model Unavailable",
    connected: "OpenCode connected",
  };
  const statusText: Record<string, string> = {
    "draft-input": "Draft Input",
    "waiting-for-output": "Menunggu Output AI",
    connecting: "Menghubungi provider",
    generating: "Menyusun riset & storyboard",
    validating: "Memvalidasi output",
    repairing: "Memperbaiki struktur output",
    saving: "Menyimpan project",
    "validation-failed": "Validation Failed",
    "generation-failed": "Generation Failed",
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

  async function saveValidatedProject(candidate: AiGenerationDraft) {
    if (projectCreationInFlight.current || projectBusy) return;
    const packageResult = researchPackageWithConfirmedSources(candidate);
    if (!packageResult.success) {
      setIssues(readableIssues(packageResult.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))));
      setError("Output belum valid untuk disimpan. Periksa error validasi.");
      return;
    }
    projectCreationInFlight.current = true;
    setBusy(true);
    setPhase("saving");
    setIssues([]);
    setError("");
    setSavedNotice("");
    try {
      const created = await onCreateProject(packageResult.data, candidate.researchPackage.id);
      if (!created) throw new Error("Project belum dibuat. Coba simpan ulang.");
      onUnsavedChange(false);
      setPendingDraft(null);
      onOpenProject(created.id, `Video “${created.title}” tersimpan. Lanjutkan dari Materi & Storyboard.`, "materials");
    } catch (cause) {
      setPendingDraft(candidate);
      setError(`Output tervalidasi, tetapi project gagal disimpan: ${cause instanceof Error ? cause.message : "Coba lagi."}`);
    } finally {
      projectCreationInFlight.current = false;
      setPhase("idle");
      setBusy(false);
    }
  }

  async function validateManualResult() {
    const validInput = validateInput();
    if (!validInput) return;
    if (pasteResult.length > maxAiResultCharacters) { setIssues(["JSON: Maksimal 1 MB."]); setError("Output AI melewati batas 1 MB."); return; }
    const result = parseManualAiResultText(pasteResult, validInput, newId());
    if (!result.success) {
      setIssues(readableIssues(result.issues));
      setError("Validation Failed: periksa format JSON dan Research Package schema.");
      return;
    }
    setWaitingForOutput(false);
    setIssues([]);
    setError("");
    await saveValidatedProject(result.draft);
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
      await saveValidatedProject(generated);
    } catch (cause) {
      const failure = cause as Error & { issues?: ValidationIssue[]; nextAllowedAt?: string | null; retryAt?: string | null; quotaType?: string | null };
      if (controller.signal.aborted || failure.name === "AbortError") setSavedNotice("Generation dibatalkan. Form masih dapat diedit.");
      else {
        if (failure.issues?.length) setIssues(readableIssues(failure.issues));
        const retryAt = failure.retryAt ?? failure.nextAllowedAt;
        const retryNotice = retryAt && Number.isFinite(Date.parse(retryAt)) ? ` Coba lagi setelah ${new Date(retryAt).toLocaleString("id-ID")}.` : "";
        setError(`${failure.message}${retryNotice}`);
      }
    } finally { generationController.current = null; setPhase("idle"); setBusy(false); }
  }

  function cancelGeneration() { generationController.current?.abort(); }

  return <div className="ai-generate-panel">
    <section className="ai-generation-form ai-settings-panel">
      <div className="settings-panel-heading"><div><h2>Generate with AI</h2><p>Topik bebas → riset dan storyboard draft. Tidak ada TTS atau render otomatis.</p></div><span className={`settings-mode-badge ${mode ?? "development"}`}>{mode ? mode.toUpperCase() : "MEMUAT MODE"}</span></div>
      {!mode && <div className="workflow-empty" role="status">Memuat AI Generation Mode dari backend lokal…</div>}
      <div className="ai-form-grid">
         <label className="ai-topic-field"><span>Judul / topik <b>*</b></span><input maxLength={120} placeholder="Contoh: Kenapa langit berwarna biru?" value={input.topic} onChange={(event) => setInput((current) => ({ ...current, topic: event.target.value }))} disabled={!mode || locked} /></label>
         <label className="ai-choice-field"><span>Bahasa</span><select value={input.language} onChange={(event) => setInput((current) => ({ ...current, language: event.target.value }))} disabled={!mode || locked}><option value="id-ID">Bahasa Indonesia</option><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option></select></label>
         <label className="ai-choice-field"><span>Durasi target</span><select value={input.targetDurationSec} onChange={(event) => setInput((current) => ({ ...current, targetDurationSec: Number(event.target.value) as 30 | 45 | 60 }))} disabled={!mode || locked}><option value={30}>30 detik</option><option value={45}>45 detik</option><option value={60}>60 detik</option></select></label>
         <label className="ai-choice-field"><span>Gaya penyampaian</span><select value={input.deliveryStyle} onChange={(event) => setInput((current) => ({ ...current, deliveryStyle: event.target.value as AiGenerationInput["deliveryStyle"] }))} disabled={!mode || locked}><option value="edukatif">Edukatif</option><option value="storytelling">Storytelling</option><option value="santai">Santai</option></select></label>
         <label className="ai-wide-field ai-instructions-field"><span>Instruksi tambahan</span><textarea rows={3} maxLength={1000} placeholder="Contoh: gunakan analogi sederhana untuk anak SMP" value={input.additionalInstructions} onChange={(event) => setInput((current) => ({ ...current, additionalInstructions: event.target.value }))} disabled={!mode || locked} /></label>
         <label className="ai-wide-field ai-source-field"><span>URL sumber opsional</span><textarea rows={3} placeholder="https://..." value={sourceText} onChange={(event) => { setSourceText(event.target.value); setInput((current) => ({ ...current, sourceUrls: event.target.value.split(/\r?\n/).map((url) => url.trim()).filter(Boolean) })); }} disabled={!mode || locked} /><small className="ai-field-help">Satu URL per baris. Aplikasi tidak fetch atau memverifikasi URL.</small></label>
      </div>

      {mode === "development" && <section className="ai-provider-section">
        <div className="ai-provider-section-heading"><h3>AI Provider &amp; Model</h3><p>Pilih model OpenCode lokal untuk generate research dan storyboard.</p></div>
        <div className="ai-development-flow">
        <div className={`ai-opencode-status ${development?.configured ? "configured" : "unconfigured"}`}>
          <div><span className={`settings-status-pill ${development?.configured ? "configured" : "unconfigured"}`}>{development ? openCodeStatusText[development.state] : "Memeriksa OpenCode lokal…"}</span><small>{development?.version ? `Server ${development.version} · ${development.apiVersion?.toUpperCase()} API` : development?.disabledReason ?? "Memeriksa OpenCode lokal…"}</small></div>
          <label><span>Model OpenCode</span><select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} disabled={!development?.configured || locked}><option value="">Pilih model authorized…</option>{development?.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
        </div>
        <div className="ai-opencode-disclosure">Setelah klik, input dikirim ke OpenCode lokal melalui isolated server tanpa plugin eksternal, di direktori kosong, dengan semua tools dinonaktifkan. Model/provider tetap pilihan Anda di OpenCode dan dapat memiliki biaya sendiri. Tidak ada fallback model.</div>
        <div className="ai-generation-actions">
          <button type="button" className="button button-primary" onClick={() => void generateProductionResult()} disabled={!development?.configured || !selectedModel || !mode || locked}>{generating ? statusText[phase] ?? "Generating…" : "Generate Research & Storyboard"}</button>
          {generating && <button type="button" className="button button-light" onClick={cancelGeneration}>Batalkan</button>}
          {generating && <span className="ai-progress-copy" role="status">{statusText[phase] ?? "Menyiapkan generation…"}</span>}
        </div>
        {!development?.configured && <div className="workflow-empty">{development?.disabledReason ?? "OpenCode status belum tersedia."} Manual prompt tetap bisa digunakan dari Advanced.</div>}
        <details className="ai-advanced-flow">
          <summary>Advanced · prompt manual / paste JSON</summary>
          <div className="ai-manual-flow">
            <div className="ai-manual-actions"><button type="button" className="button button-light" onClick={showManualPrompt} disabled={locked}>Buat Prompt Manual</button><span>Fallback manual; tidak memanggil provider dari aplikasi.</span></div>
            {manualPrompt && <label><span>Prompt untuk ChatGPT / OpenCode</span><textarea className="manual-prompt" readOnly rows={8} value={manualPrompt} /><button type="button" className="button button-light" onClick={() => void copyPrompt()}>Copy Prompt</button></label>}
            {waitingForOutput && <div className="workflow-alert attention" role="status">Menunggu output AI eksternal. Tempel JSON hasilnya di bawah.</div>}
            <label><span>Paste AI Result / Research Package JSON</span><textarea className="manual-prompt-result" maxLength={maxAiResultCharacters} rows={10} spellCheck={false} placeholder="Paste JSON Research Package v1.0/v1.1 atau ai-generated content envelope." value={pasteResult} onChange={(event) => setPasteResult(event.target.value)} disabled={locked} /><small>Maksimal 1 MB.</small></label>
            <button type="button" className="button button-light" onClick={() => void validateManualResult()} disabled={!pasteResult.trim() || locked}>Validate &amp; Create Project</button>
          </div>
        </details>
        </div>
      </section>}

      {mode === "production" && <section className="ai-provider-section">
        <div className="ai-provider-section-heading"><h3>AI Provider &amp; Model</h3><p>Status Gemini Text dan batas penggunaan untuk model aktif.</p></div>
        <div className="ai-production-flow">
        <div className={`ai-production-config ${production?.configured ? "configured" : "unconfigured"}`}>
          <span className={`settings-status-pill ${production?.configured ? "configured" : "unconfigured"}`}>{production?.configured ? "Gemini Text configured" : "Gemini Text unconfigured"}</span>
          <span>{production?.model ?? "Model belum dikonfigurasi"} · Free Tier guard {production?.freeTierOnly ? "aktif" : "tidak aktif"} · batas aplikasi {production ? `${production.requestsUsed}/${production.dailyLimit}` : "—"}</span>
          {production?.disabledReason && <small>{production.disabledReason}</small>}
        </div>
        {production && <GeminiTextQuotaSummary production={production} compact />}
        <div className="tts-consent-note">Generate akan mengirim topik, instruksi, dan URL sumber yang Anda isi ke Gemini setelah klik. URL tidak di-fetch oleh aplikasi; semua klaim tetap perlu review manusia. Tidak ada paid model fallback.</div>
        <div className="ai-generation-actions"><button type="button" className="button button-primary" onClick={() => void generateProductionResult()} disabled={!production?.configured || !mode || locked}>{generating ? statusText[phase] ?? "Generating…" : "Generate Research & Storyboard"}</button>{generating && <button type="button" className="button button-light" onClick={cancelGeneration}>Batalkan</button>}{generating && <span className="ai-progress-copy" role="status">{statusText[phase] ?? "Menyiapkan generation…"}</span>}</div>
        </div>
      </section>}

      {mode === "production" && !production?.configured && <div className="workflow-empty">Pilih Development untuk OpenCode lokal/manual fallback, atau lengkapi Gemini backend. API key tidak dimasukkan di browser.</div>}
      {error && <div className="workflow-alert danger" role="alert">{error}{issues.length > 0 && <ul>{issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul>}</div>}
      {savedNotice && <div className="workflow-alert success" role="status">{savedNotice}</div>}
      {!busy && <div className="ai-generation-status-row"><span className={`settings-status-pill ${status === "validation-failed" || status === "generation-failed" ? "unconfigured" : "configured"}`}>{statusText[status] ?? statusText["draft-input"]}</span></div>}
    </section>

    {pendingDraft && error && !busy && <button type="button" className="button button-primary" onClick={() => void saveValidatedProject(pendingDraft)} disabled={projectBusy}>Coba simpan ulang</button>}
  </div>;
}

export function GeminiTextQuotaSummary({ production, compact = false }: { production: ProductionStatus; compact?: boolean }) {
  const metrics = [
    ["rpm", "RPM · rolling 60 detik", production.quotaMonitoring.rpm],
    ["rpd", "RPD · rolling 24 jam", production.quotaMonitoring.rpd],
    ["tpm", "TPM · rolling 60 detik", production.quotaMonitoring.tpm],
  ] as const;
  return <section className={`gemini-quota-summary ${compact ? "compact" : ""}`} aria-label="Monitoring kuota Gemini Text">
    <div className="gemini-quota-caption"><strong>Kuota Gemini Text per model</strong><span>Pemakaian dari catatan lokal; limit diisi operator berdasarkan batas project Google AI Studio. Sisa kuota aktual Google tidak tersedia. TPM tercatat setelah respons, jadi request aktif dapat melewati limit.</span></div>
    <div className="gemini-quota-grid">
      {metrics.map(([key, label, metric]) => <div className="gemini-quota-metric" key={key}>
        <span>{label}</span>
        <strong>{metric.used === null ? "—" : metric.used.toLocaleString("id-ID")} / {metric.limit === null ? "limit belum diatur" : metric.limit.toLocaleString("id-ID")}</strong>
        <small>{metric.estimatedRemaining === null ? "Sisa estimasi lokal belum tersedia" : `≈ ${metric.estimatedRemaining.toLocaleString("id-ID")} tersisa (lokal)`}</small>
        {metric.cooldownUntil && <em>Cooldown lokal hingga {new Date(metric.cooldownUntil).toLocaleString("id-ID")}</em>}
      </div>)}
    </div>
  </section>;
}
