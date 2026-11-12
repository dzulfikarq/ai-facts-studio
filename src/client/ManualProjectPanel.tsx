import React, { useRef, useState } from "react";
import { buildManualResearchPackage, manualProjectInputSchema, type ManualProjectBrief, type ManualProjectInput } from "../domain/manual-project";
import type { ResearchPackage } from "../domain/research";
import type { WorkspaceStep } from "./workflow";

type Props = {
  projectBusy: boolean;
  onCreateProject: (researchPackage: ResearchPackage, requestId: string, brief: ManualProjectBrief) => Promise<{ id: string; title: string } | null>;
  onOpenProject: (id: string, notice?: string, initialStep?: WorkspaceStep) => void;
  onUnsavedChange: (hasUnsavedDraft: boolean) => void;
};

const initialInput: ManualProjectInput = {
  topic: "",
  language: "id-ID",
  targetDurationSec: 30,
  deliveryStyle: "edukatif",
  additionalInstructions: "",
  sourceUrls: [],
};

export function ManualProjectPanel({ projectBusy, onCreateProject, onOpenProject, onUnsavedChange }: Props) {
  const [input, setInput] = useState(initialInput);
  const [sourceText, setSourceText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const pendingCreation = useRef<{ requestId: string; researchPackage: ResearchPackage } | null>(null);
  const inFlight = useRef(false);
  const locked = busy || projectBusy;

  function updateInput<Key extends keyof ManualProjectInput>(key: Key, value: ManualProjectInput[Key]) {
    pendingCreation.current = null;
    setInput((current) => ({ ...current, [key]: value }));
    setError("");
    setIssues([]);
    onUnsavedChange(true);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || locked) return;
    const result = manualProjectInputSchema.safeParse({
      ...input,
      sourceUrls: sourceText.split(/\r?\n/).map((url) => url.trim()).filter(Boolean),
    });
    if (!result.success) {
      setIssues(result.error.issues.map((issue) => `${issue.path.join(".") || "Form"}: ${issue.message}`).slice(0, 8));
      setError("Perbaiki input sebelum membuat project.");
      return;
    }

    let creation = pendingCreation.current;
    try {
      if (!creation) {
        const requestId = globalThis.crypto.randomUUID();
        creation = { requestId, researchPackage: buildManualResearchPackage(result.data, requestId) };
        pendingCreation.current = creation;
      }
      inFlight.current = true;
      setBusy(true);
      setError("");
      setIssues([]);
      const created = await onCreateProject(creation.researchPackage, creation.requestId, {
        deliveryStyle: result.data.deliveryStyle,
        additionalInstructions: result.data.additionalInstructions,
      });
      if (!created) throw new Error("Project belum dibuat. Coba simpan ulang.");
      pendingCreation.current = null;
      onUnsavedChange(false);
      onOpenProject(created.id, `Project manual “${created.title}” tersimpan. Lanjutkan di Materi & Storyboard.`, "materials");
    } catch (cause) {
      setError(`Project manual gagal dibuat: ${cause instanceof Error ? cause.message : "Coba lagi."}`);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <form className="manual-create-panel" onSubmit={(event) => void submit(event)}>
    <section className="ai-settings-panel manual-generation-form">
      <div className="settings-panel-heading"><div><h2>Buat Manual</h2><p>Buat draft tanpa AI. Tulis storyboard sendiri setelah project dibuka.</p></div><span className="settings-mode-badge development">DRAFT MANUAL</span></div>
      <div className="ai-form-grid">
        <label className="ai-topic-field"><span>Judul / Topik <b>*</b></span><input required minLength={3} maxLength={120} placeholder="Contoh: Mengapa langit berwarna biru?" value={input.topic} onChange={(event) => updateInput("topic", event.target.value)} disabled={locked} /></label>
        <label className="ai-choice-field"><span>Bahasa</span><select value={input.language} onChange={(event) => updateInput("language", event.target.value as ManualProjectInput["language"])} disabled={locked}><option value="id-ID">Bahasa Indonesia</option><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option></select></label>
        <label className="ai-choice-field"><span>Durasi Target</span><select value={input.targetDurationSec} onChange={(event) => updateInput("targetDurationSec", Number(event.target.value) as ManualProjectInput["targetDurationSec"])} disabled={locked}><option value={30}>30 detik</option><option value={45}>45 detik</option><option value={60}>60 detik</option></select></label>
        <label className="ai-choice-field"><span>Gaya Penyampaian</span><select value={input.deliveryStyle} onChange={(event) => updateInput("deliveryStyle", event.target.value as ManualProjectInput["deliveryStyle"])} disabled={locked}><option value="edukatif">Edukatif</option><option value="storytelling">Storytelling</option><option value="santai">Santai</option></select></label>
        <label className="ai-wide-field ai-instructions-field"><span>Instruksi Tambahan</span><textarea rows={3} maxLength={1000} placeholder="Catatan untuk project manual (opsional)" value={input.additionalInstructions} onChange={(event) => updateInput("additionalInstructions", event.target.value)} disabled={locked} /></label>
        <details className="manual-source-advanced ai-wide-field">
          <summary>Advanced · URL sumber opsional</summary>
          <label><span>URL Sumber</span><textarea rows={3} placeholder="https://..." value={sourceText} onChange={(event) => {
            setSourceText(event.target.value);
            updateInput("sourceUrls", event.target.value.split(/\r?\n/).map((url) => url.trim()).filter(Boolean));
          }} disabled={locked} /><small className="ai-field-help">Satu URL per baris. Sumber tidak di-fetch atau diverifikasi otomatis.</small></label>
        </details>
      </div>
      {error && <div className="workflow-alert danger" role="alert"><span>{error}{issues.length > 0 && <ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</span></div>}
      <div className="manual-create-actions"><span>Storyboard awal hanya placeholder kosong. Tidak ada fakta, audio, visual Flow, atau approval yang dibuat.</span><button type="submit" className="button button-primary" disabled={locked}>{busy || projectBusy ? "Menyimpan project…" : "Buat Project Manual"}</button></div>
    </section>
  </form>;
}
