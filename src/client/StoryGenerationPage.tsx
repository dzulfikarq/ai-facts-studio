import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Film, Sparkles } from "lucide-react";
import { z } from "zod";
import { ANIMATION_STYLE_PRESETS } from "../domain/animation-styles";
import {
  storyBibleDraftSchema,
  storyEpisodePlanListSchema,
  storyFlowBudget,
  storySourceSchema,
  type StoryAnalysis,
  type StoryBibleDraft,
  type StoryEpisodePlan,
  type StorySource,
} from "../domain/story-generation";
import { storySeriesPackageSchema, type StorySeriesPackage } from "../domain/story-series";
import type { AiGenerationSettings } from "../server/ai-generation/provider";
import type { AppRoute } from "./routes";
import { appRouteHref } from "./routes";

type SeriesRoute = Extract<AppRoute, { view: "series-library" | "series-detail" | "series-generation" }>;
type SavedDraft = { id: string; title: string; stage: string; seriesId: string | null; updatedAt: string };
type StoryDraft = {
  id: string;
  source: StorySource;
  analysis: StoryAnalysis | null;
  plan: StoryEpisodePlan[] | null;
  approvedPlan: StoryEpisodePlan[] | null;
  bibleDraft: StoryBibleDraft | null;
  approvedBible: StoryBibleDraft | null;
  episodeDrafts: Record<string, { package: StorySeriesPackage; adaptationNotes: string[]; model: string; createdAt: string }>;
  seriesId: string | null;
  stage: string;
};
type ImportedEpisode = { episodeNumber: number; projectId: string | null };
type SeriesDetail = { id: string; episodes: ImportedEpisode[] };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const issues = Array.isArray(body.issues) ? body.issues.slice(0, 5).map((item: { path?: unknown; message?: unknown }) => `${Array.isArray(item.path) ? item.path.join(".") : "input"}: ${String(item.message ?? "invalid")}`).join(" · ") : "";
    throw new Error([typeof body.error === "string" ? body.error : `Request gagal (${response.status})`, issues].filter(Boolean).join(" "));
  }
  return body as T;
}

const initialSource: StorySource = {
  title: "",
  storyText: "",
  language: "id-ID",
  targetDurationSeconds: 62,
  dailyCreditsAvailable: 100,
  animationStyleId: "cinematic-2d-motion-comic",
  additionalInstructions: "",
  sourceUrl: "",
  rightsNotes: "",
};

export function StoryGenerationStart({ onOpenDraft }: { onOpenDraft: (id: string) => void }) {
  const [source, setSource] = useState<StorySource>(initialSource);
  const [drafts, setDrafts] = useState<SavedDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const parsed = useMemo(() => storySourceSchema.safeParse(source), [source]);

  useEffect(() => {
    void request<SavedDraft[]>("/api/story-generation/drafts").then(setDrafts).catch((cause) => setError(cause instanceof Error ? cause.message : "Draft cerita gagal dimuat."));
  }, []);

  function update<K extends keyof StorySource>(key: K, value: StorySource[K]) {
    setSource((current) => ({ ...current, [key]: value }));
    setRequestId(crypto.randomUUID());
  }

  async function createDraft(event: React.FormEvent) {
    event.preventDefault();
    if (!parsed.success || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ id: string }>("/api/story-generation/drafts", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, source: parsed.data }),
      });
      onOpenDraft(result.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Draft cerita gagal disimpan."); }
    finally { setBusy(false); }
  }

  return <div className="series-generation-start series-library-layout">
    <form className="series-panel" onSubmit={(event) => void createDraft(event)}>
      <div className="series-section-heading"><div><span className="eyebrow">SOURCE STORY · NO AI CALL</span><h2>Generate from Story</h2><p>Simpan source utuh dahulu. Analisis, rencana, Story Bible, dan episode selalu menunggu aksi Anda.</p></div><BookOpen aria-hidden="true" size={21}/></div>
      {error && <p className="workflow-alert danger" role="alert">{error}</p>}
      <label className="series-form-field">Judul cerita<input required maxLength={160} value={source.title} onChange={(event) => update("title", event.target.value)} /></label>
      <label className="series-form-field">Isi cerita<textarea required maxLength={100000} rows={15} value={source.storyText} onChange={(event) => update("storyText", event.target.value)} aria-describedby="story-source-note" /></label>
      <small id="story-source-note" className="series-muted">Source disimpan persis seperti dimasukkan, terpisah dari semua output AI. Maksimal 100.000 karakter.</small>
      <div className="series-form-grid">
        <label className="series-form-field">Bahasa <input required value={source.language} pattern="[a-z]{2}-[A-Z]{2}" placeholder="id-ID" onChange={(event) => update("language", event.target.value)} /></label>
        <label className="series-form-field">Durasi target per episode (detik)<input type="number" min={30} max={120} value={source.targetDurationSeconds} onChange={(event) => update("targetDurationSeconds", Number(event.target.value))} /><small>Default 62 detik. Flow: maks 8 klip × 8 detik = 64 detik per episode.</small></label>
        <label className="series-form-field">Kredit harian tersedia<input type="number" min={1} max={1000000} value={source.dailyCreditsAvailable} onChange={(event) => update("dailyCreditsAvailable", Number(event.target.value))} /><small>Input manual. Aplikasi tidak membaca saldo Flow.</small></label>
        <label className="series-form-field">Animation Style<select value={source.animationStyleId} onChange={(event) => update("animationStyleId", event.target.value as StorySource["animationStyleId"])}>{ANIMATION_STYLE_PRESETS.filter((preset) => preset.id !== "stylized-3d-cartoon").map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select><small>2D preset only; 3D/CGI is blocked for this workflow.</small></label>
      </div>
      <label className="series-form-field">Instruksi tambahan (opsional)<textarea rows={3} maxLength={4000} value={source.additionalInstructions} onChange={(event) => update("additionalInstructions", event.target.value)} /></label>
      <label className="series-form-field">URL sumber (opsional)<input type="url" maxLength={2000} value={source.sourceUrl} onChange={(event) => update("sourceUrl", event.target.value)} placeholder="https://…" /></label>
      <label className="series-form-field">Catatan hak penggunaan (opsional)<textarea rows={3} maxLength={4000} value={source.rightsNotes} onChange={(event) => update("rightsNotes", event.target.value)} placeholder="Mis. cerita sendiri, izin adaptasi, atau sumber lisensi yang perlu ditinjau" /></label>
      {source.targetDurationSeconds > 64 && <p className="workflow-alert attention" role="status">{source.targetDurationSeconds} detik membutuhkan {storyFlowBudget(source.targetDurationSeconds, source.dailyCreditsAvailable).plannedClips} klip / {storyFlowBudget(source.targetDurationSeconds, source.dailyCreditsAvailable).estimatedCredits} kredit. Melebihi batas 8 klip; storyboard Flow tidak bisa dibuat sampai target diturunkan atau strategi editing manual dipilih.</p>}
      {!parsed.success && source.title && source.storyText && <p className="workflow-alert attention" role="alert">{parsed.error.issues[0]?.message}</p>}
      <button type="submit" className="button button-primary full-button" disabled={busy || !parsed.success}>{busy ? "Menyimpan source…" : "Simpan source dan mulai review"}<span aria-hidden="true">→</span></button>
      <small className="series-muted">Cerita salinan dari internet tidak otomatis bebas hak cipta. Tinjau hak adaptasi sebelum produksi/publikasi.</small>
    </form>
    <section className="series-panel">
      <div className="series-section-heading"><div><span className="eyebrow">RESUME WORKFLOW</span><h2>Saved Story Drafts</h2></div><span className="count-chip">{drafts.length}</span></div>
      {drafts.length ? <div className="series-library-list">{drafts.map((draft) => <button type="button" className="series-library-card series-draft-card" key={draft.id} onClick={() => onOpenDraft(draft.id)}><span className="series-library-icon"><BookOpen aria-hidden="true" size={19}/></span><span><strong>{draft.title}</strong><small>{stageLabel(draft.stage)} · {new Date(draft.updatedAt).toLocaleString()}</small></span><b aria-hidden="true">→</b></button>)}</div> : <div className="workflow-empty"><strong>Belum ada draft</strong><span>Source dan rencana tersimpan di database lokal.</span></div>}
    </section>
  </div>;
}

export function StoryGenerationWorkspace({ draftId, onNavigate, onOpenProject }: {
  draftId: string;
  onNavigate: (route: SeriesRoute) => void;
  onOpenProject: (id: string) => void;
}) {
  const [draft, setDraft] = useState<StoryDraft | null>(null);
  const [settings, setSettings] = useState<AiGenerationSettings | null>(null);
  const [seriesDetail, setSeriesDetail] = useState<SeriesDetail | null>(null);
  const [model, setModel] = useState("");
  const [bibleText, setBibleText] = useState("");
  const [packageText, setPackageText] = useState("");
  const [selectedEpisode, setSelectedEpisode] = useState(1);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [planDirty, setPlanDirty] = useState(false);
  const [productionSettingsDirty, setProductionSettingsDirty] = useState(false);
  const bibleParsed = useMemo(() => parseJson(bibleText, storyBibleDraftSchema), [bibleText]);
  const packageParsed = useMemo(() => parseJson(packageText, storySeriesPackageSchema), [packageText]);
  const currentPlan = draft?.plan ?? [];
  const selectedPackage = packageParsed?.success ? packageParsed.data : null;
  const selectedRecord = draft?.episodeDrafts[String(selectedEpisode)];
  const importedEpisode = seriesDetail?.episodes.find((item) => item.episodeNumber === selectedEpisode);
  const aiSettings = settings;
  const providerReady = aiSettings?.mode === "development"
    ? Boolean(aiSettings.providers.development.configured && aiSettings.providers.development.models.length && model)
    : Boolean(aiSettings?.providers.production.configured);

  async function loadDraft() {
    const value = await request<StoryDraft>(`/api/story-generation/drafts/${encodeURIComponent(draftId)}`);
    setDraft(value);
    if (value.bibleDraft) setBibleText(JSON.stringify(value.bibleDraft, null, 2));
    else setBibleText("");
    setPlanDirty(false);
    setProductionSettingsDirty(false);
    return value;
  }

  useEffect(() => {
    let current = true;
    setError("");
    void Promise.all([
      request<StoryDraft>(`/api/story-generation/drafts/${encodeURIComponent(draftId)}`),
      request<AiGenerationSettings>("/api/settings/ai-generation"),
    ]).then(([value, ai]) => {
      if (!current) return;
      setDraft(value);
      setBibleText(value.bibleDraft ? JSON.stringify(value.bibleDraft, null, 2) : "");
      setProductionSettingsDirty(false);
      setSettings(ai);
      setModel(ai.providers.development.models[0]?.id ?? "");
      if (value.plan?.length) setSelectedEpisode(Math.min(selectedEpisode, value.plan.length));
    }).catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : "Draft cerita gagal dimuat."); });
    return () => { current = false; };
  }, [draftId]);

  useEffect(() => {
    if (draft?.seriesId) void request<SeriesDetail>(`/api/story-series/${encodeURIComponent(draft.seriesId)}`).then(setSeriesDetail).catch(() => setSeriesDetail(null));
    else setSeriesDetail(null);
  }, [draft?.seriesId]);

  useEffect(() => {
    const episode = draft?.episodeDrafts[String(selectedEpisode)];
    setPackageText(episode ? JSON.stringify(episode.package, null, 2) : "");
  }, [draft?.episodeDrafts, selectedEpisode]);

  function report(cause: unknown) {
    setError(cause instanceof Error ? cause.message : "Story Series action gagal.");
    setNotice("");
  }

  function updateProductionSettings(key: "targetDurationSeconds" | "dailyCreditsAvailable", value: number) {
    if (!draft || draft.approvedPlan || !Number.isInteger(value)) return;
    if (key === "targetDurationSeconds" && (value < 30 || value > 120) || key === "dailyCreditsAvailable" && (value < 1 || value > 1_000_000)) return;
    setDraft({ ...draft, source: { ...draft.source, [key]: value } });
    setProductionSettingsDirty(true);
  }

  async function saveProductionSettings() {
    if (!draft || busy || draft.approvedPlan || !productionSettingsDirty) return;
    const resetAnalysis = Boolean(draft.analysis);
    if (resetAnalysis && !window.confirm("Target produksi berubah. Analisis dan plan yang belum disetujui akan dihapus; source story tetap utuh. Lanjutkan?")) return;
    setBusy("production-settings"); setError(""); setNotice("");
    try {
      await request(`/api/story-generation/drafts/${encodeURIComponent(draft.id)}/production-settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetDurationSeconds: draft.source.targetDurationSeconds, dailyCreditsAvailable: draft.source.dailyCreditsAvailable, resetAnalysis }) });
      await loadDraft(); setNotice(resetAnalysis ? "Target tersimpan. Analisis/plan lama dihapus; source story tetap sama." : "Target dan kapasitas kredit tersimpan.");
    } catch (cause) { report(cause); }
    finally { setBusy(""); }
  }

  function aiRequestBody(requestId = crypto.randomUUID()) {
    return { requestId, ...(settings?.mode === "development" ? { model } : {}) };
  }

  async function analyze(replan = false) {
    if (!draft || busy || !providerReady || productionSettingsDirty) return;
    if (replan && !window.confirm("AI akan menyusun ulang analisis dan episode plan. Perubahan plan yang belum disetujui akan diganti. Lanjutkan?")) return;
    setBusy("analysis"); setError(""); setNotice("");
    try {
      await request(`/api/story-generation/drafts/${encodeURIComponent(draft.id)}/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...aiRequestBody(), ...(replan ? { replan: true } : {}) }) });
      await loadDraft(); setNotice(replan ? "Analisis dan plan baru tersimpan untuk direview." : "Analisis tersimpan. Tinjau rekomendasi sebelum menyetujui.");
    } catch (cause) { report(cause); }
    finally { setBusy(""); }
  }

  function updatePlan(index: number, key: keyof StoryEpisodePlan, value: string | number | boolean) {
    if (!draft?.plan) return;
    const episodes = draft.plan.map((episode, episodeIndex) => {
      if (episodeIndex !== index) return episode;
      const updated = { ...episode, [key]: value } as StoryEpisodePlan;
      const required = [updated.title, updated.synopsis, updated.conflict, updated.openingHook, updated.endingCliffhanger].some((text) => !text.trim() || text.startsWith("TODO:"));
      updated.manualEditRequired = required;
      return updated;
    });
    setDraft({ ...draft, plan: episodes }); setPlanDirty(true);
  }

  function updatePlanDuration(index: number, durationSeconds: number) {
    if (!draft?.plan || !Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 120) return;
    const episodes = draft.plan.map((episode, episodeIndex) => {
      if (episodeIndex !== index) return episode;
      const clips = Math.ceil(durationSeconds / 8);
      const hasTodo = [episode.title, episode.synopsis, episode.conflict, episode.openingHook, episode.endingCliffhanger].some((text) => !text.trim() || text.startsWith("TODO:"));
      return { ...episode, estimatedDurationSeconds: durationSeconds, estimatedScenes: Math.min(8, clips), estimatedFlowClips: clips, estimatedCredits: clips * 10, manualEditRequired: hasTodo };
    });
    setDraft({ ...draft, plan: episodes }); setPlanDirty(true);
  }

  function resizePlan(count: number) {
    if (!draft?.plan || !Number.isInteger(count) || count < 1 || count > 20) return;
    if (count < draft.plan.length && !window.confirm(`Remove ${draft.plan.length - count} episode plan(s) and their unsaved edits?`)) return;
    const episodes = draft.plan.slice(0, count);
    while (episodes.length < count) {
      const number = episodes.length + 1;
      const clips = Math.ceil(draft.source.targetDurationSeconds / 8);
      episodes.push({ episodeNumber: number, title: `TODO: Judul episode ${number}`, synopsis: "TODO: Tulis sinopsis berdasarkan cerita sumber.", conflict: "TODO: Jelaskan konflik dari alur sumber.", openingHook: "TODO: Tulis hook pembuka.", endingCliffhanger: "TODO: Tulis ending/cliffhanger.", estimatedDurationSeconds: draft.source.targetDurationSeconds, estimatedScenes: Math.min(8, clips), estimatedFlowClips: clips, estimatedCredits: clips * 10, resolvesMainConflict: false, manualEditRequired: true });
    }
    setDraft({ ...draft, plan: episodes.map((episode, index) => ({ ...episode, episodeNumber: index + 1 })) }); setPlanDirty(true);
  }

  function splitEpisode(index: number) {
    if (!draft?.plan || draft.plan.length >= 20) return;
    const original = draft.plan[index]!;
    if (original.estimatedDurationSeconds < 2) { setError("Episode must be at least 2 seconds before splitting into two durations."); return; }
    const halfDuration = Math.max(1, Math.floor(original.estimatedDurationSeconds / 2));
    const firstClips = Math.ceil(halfDuration / 8);
    const secondDuration = Math.max(1, original.estimatedDurationSeconds - halfDuration);
    const secondClips = Math.ceil(secondDuration / 8);
    const first = { ...original, title: `TODO: Judul bagian 1 dari ${original.title.replace(/^TODO: /, "")}`, synopsis: "TODO: Ringkas bagian pertama; jangan tambah kejadian baru.", endingCliffhanger: "TODO: Tentukan titik akhir bagian pertama.", estimatedDurationSeconds: halfDuration, estimatedScenes: Math.min(8, firstClips), estimatedFlowClips: firstClips, estimatedCredits: firstClips * 10, resolvesMainConflict: false, manualEditRequired: true };
    const second = { ...original, episodeNumber: original.episodeNumber + 1, title: `TODO: Judul bagian 2 dari ${original.title.replace(/^TODO: /, "")}`, synopsis: "TODO: Ringkas bagian kedua hingga ending dari cerita sumber.", openingHook: "TODO: Tulis hook untuk bagian kedua.", estimatedDurationSeconds: secondDuration, estimatedScenes: Math.min(8, secondClips), estimatedFlowClips: secondClips, estimatedCredits: secondClips * 10, manualEditRequired: true };
    const episodes = [...draft.plan.slice(0, index), first, second, ...draft.plan.slice(index + 1)].map((episode, episodeIndex) => ({ ...episode, episodeNumber: episodeIndex + 1 }));
    setDraft({ ...draft, plan: episodes }); setPlanDirty(true);
  }

  function mergeEpisodes(index: number) {
    if (!draft?.plan || index >= draft.plan.length - 1) return;
    const first = draft.plan[index]!; const second = draft.plan[index + 1]!;
    const duration = first.estimatedDurationSeconds + second.estimatedDurationSeconds;
    if (duration > 120) { setError(`Merged episode needs ${duration} seconds; plan limit is 120 seconds. Reduce one episode duration before merging.`); return; }
    const title = `${first.title} / ${second.title}`;
    const synopsis = `${first.synopsis}\n\n${second.synopsis}`;
    const conflict = `${first.conflict}\n\n${second.conflict}`;
    if (title.length > 160 || synopsis.length > 3000 || conflict.length > 2000) { setError("Merged title, synopsis, or conflict exceeds plan field limit. Shorten source episode fields before merging."); return; }
    const clips = Math.ceil(duration / 8);
    const merged: StoryEpisodePlan = {
      ...first,
      title,
      synopsis,
      conflict,
      endingCliffhanger: second.endingCliffhanger,
      estimatedDurationSeconds: duration,
      estimatedScenes: Math.min(8, clips),
      estimatedFlowClips: clips,
      estimatedCredits: clips * 10,
      resolvesMainConflict: second.resolvesMainConflict,
      manualEditRequired: first.manualEditRequired || second.manualEditRequired,
    };
    const episodes = [...draft.plan.slice(0, index), merged, ...draft.plan.slice(index + 2)].map((episode, episodeIndex) => ({ ...episode, episodeNumber: episodeIndex + 1 }));
    setDraft({ ...draft, plan: episodes }); setPlanDirty(true);
  }

  async function savePlan(approve = false) {
    if (!draft?.plan || busy) return;
    setBusy(approve ? "approve-plan" : "save-plan"); setError(""); setNotice("");
    try {
      await request(`/api/story-generation/drafts/${encodeURIComponent(draft.id)}/plan`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ episodes: draft.plan }) });
      setPlanDirty(false);
      if (approve) {
        await request(`/api/story-generation/drafts/${encodeURIComponent(draft.id)}/approve-plan`, { method: "POST" });
        await loadDraft(); setNotice("Episode plan disetujui dan dikunci. Story Bible belum dibuat sampai Anda klik generate.");
      } else setNotice("Episode plan tersimpan.");
    } catch (cause) { report(cause); }
    finally { setBusy(""); }
  }

  async function generateBible(replaceExisting = false) {
    if (!draft || busy || !providerReady || productionSettingsDirty) return;
    if (replaceExisting && !window.confirm("Ganti Story Bible draft yang ada? Periksa kembali adaptation notes sebelum menyetujui.")) return;
    setBusy("bible"); setError(""); setNotice("");
    try {
      await request(`/api/story-generation/drafts/${encodeURIComponent(draft.id)}/story-bible/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...aiRequestBody(), ...(replaceExisting ? { replaceExisting: true } : {}) }) });
      await loadDraft(); setNotice("Story Bible draft tersimpan. Periksa JSON dan adaptation notes sebelum approval.");
    } catch (cause) { report(cause); }
    finally { setBusy(""); }
  }

  async function approveBible() {
    if (!draft || !bibleParsed?.success || busy) return;
    setBusy("approve-bible"); setError(""); setNotice("");
    try {
      await request(`/api/story-generation/drafts/${encodeURIComponent(draft.id)}/story-bible`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft: bibleParsed.data }) });
      const result = await request<{ seriesId: string }>(`/api/story-generation/drafts/${encodeURIComponent(draft.id)}/story-bible/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft: bibleParsed.data }) });
      await loadDraft(); setNotice("Story Bible disetujui dan tersimpan di Story Series Library.");
      setSeriesDetail(await request<SeriesDetail>(`/api/story-series/${encodeURIComponent(result.seriesId)}`));
    } catch (cause) { report(cause); }
    finally { setBusy(""); }
  }

  async function generateEpisode() {
    if (!draft || busy || !providerReady || productionSettingsDirty) return;
    const current = draft.episodeDrafts[String(selectedEpisode)];
    if (current && !window.confirm("Ganti storyboard draft ini? Prompt hasil generate akan diganti. Episode yang sudah diimpor tidak dapat ditimpa.")) return;
    setBusy("episode"); setError(""); setNotice("");
    try {
      const generated = await request<{ package: StorySeriesPackage; adaptationNotes: string[] }>(`/api/story-generation/drafts/${encodeURIComponent(draft.id)}/episodes/${selectedEpisode}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...aiRequestBody(), requestId: crypto.randomUUID(), ...(current ? { replaceExisting: true } : {}) }) });
      await loadDraft(); setPackageText(JSON.stringify(generated.package, null, 2)); setNotice(`Episode ${selectedEpisode} tersimpan sebagai draft. Tidak ada gambar/video yang dibuat dan Flow credit tidak digunakan.`);
    } catch (cause) { report(cause); }
    finally { setBusy(""); }
  }

  async function saveEpisodePackage() {
    if (!draft || !selectedPackage || busy) return false;
    setBusy("save-episode"); setError(""); setNotice("");
    try {
      await request(`/api/story-generation/drafts/${encodeURIComponent(draft.id)}/episodes/${selectedEpisode}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ package: selectedPackage }) });
      const value = await loadDraft(); setPackageText(JSON.stringify(value.episodeDrafts[String(selectedEpisode)]?.package ?? selectedPackage, null, 2));
      setNotice("Episode draft dan prompt tersimpan. Perubahan tidak menimpa episode yang sudah diimpor.");
      return true;
    } catch (cause) { report(cause); return false; }
    finally { setBusy(""); }
  }

  async function importEpisode() {
    if (!draft || !selectedPackage || busy || importedEpisode) return;
    const saved = await saveEpisodePackage();
    if (!saved) return;
    setBusy("import-episode"); setError(""); setNotice("");
    try {
      const result = await request<{ project: { id: string }; replay: boolean }>("/api/story-series/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ package: selectedPackage, requestId: crypto.randomUUID() }) });
      setNotice(result.replay ? "Episode sudah ada; membuka project production tersimpan." : "Episode diimpor ke production pipeline yang sama dengan Import JSON.");
      onOpenProject(result.project.id);
    } catch (cause) { report(cause); }
    finally { setBusy(""); }
  }

  function updateFlowPrompt(sceneIndex: number, key: "prompt" | "negativePrompt" | "referenceInstructions", value: string) {
    if (!selectedPackage) return;
    const next = structuredClone(selectedPackage);
    next.episode.scenes[sceneIndex]!.googleFlow[key] = value;
    setPackageText(JSON.stringify(next, null, 2));
  }

  if (!draft) return <section className="page layout-container series-page"><p role="status">{error || "Memuat story draft…"}</p></section>;
  const episodesForDisplay = draft.approvedPlan ?? currentPlan;
  const targetBudget = storyFlowBudget(draft.source.targetDurationSeconds, draft.source.dailyCreditsAvailable);
  const selectedPlan = episodesForDisplay.find((episode) => episode.episodeNumber === selectedEpisode);
  const selectedEpisodeBudget = storyFlowBudget(selectedPlan?.estimatedDurationSeconds ?? draft.source.targetDurationSeconds, draft.source.dailyCreditsAvailable);
  const planIsValid = storyEpisodePlanListSchema.safeParse(currentPlan).success;
  const approved = Boolean(draft.approvedPlan);
  const bibleIsApproved = Boolean(draft.approvedBible);
  const stage = stageLabel(draft.stage);
  const dev = settings?.providers.development;
  const prod = settings?.providers.production;

  return <section className="page layout-container series-page">
    <div className="series-page-actions"><button type="button" className="button button-light" onClick={() => onNavigate({ view: "series-library", slug: null })}><ArrowLeft size={16}/>Series Library</button><span className="status-chip">{stage}</span></div>
    <header className="series-heading"><div><span className="eyebrow">GENERATE FROM STORY · {draft.source.language}</span><h1>{draft.source.title}</h1><p>{draft.source.targetDurationSeconds} detik target · {draft.source.animationStyleId === "cinematic-2d-motion-comic" ? "Cinematic 2D Hand-Painted Horror" : draft.source.animationStyleId}</p></div><BookOpen aria-hidden="true" size={32}/></header>
    {error && <p className="workflow-alert danger" role="alert">{error}</p>}{notice && <p className="workflow-alert success" role="status">{notice}</p>}
    <section className="series-panel series-ai-controls">
      <div><span className="eyebrow">AI GENERATION MODE</span><strong>{aiSettings?.mode === "production" ? "Production · Gemini" : "Development · OpenCode"}</strong><small>{aiSettings?.mode === "production" ? prod?.configured ? `Model ${prod.model}; tidak ada fallback otomatis.` : prod?.disabledReason : dev?.configured ? "Pilih model OpenCode yang terhubung." : dev?.disabledReason ?? "Memuat status provider…"}</small></div>
      {aiSettings?.mode === "development" && <label className="series-form-field">Model OpenCode<select value={model} onChange={(event) => setModel(event.target.value)} disabled={!dev?.models.length}>{dev?.models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    </section>
    <details className="series-panel"><summary className="series-details-summary">Source Story (immutable reference) · {draft.source.storyText.length.toLocaleString()} characters</summary><p className="series-source-copy">{draft.source.storyText}</p><p><strong>URL sumber:</strong> {draft.source.sourceUrl || "Tidak dicantumkan"}</p><p><strong>Catatan hak penggunaan:</strong> {draft.source.rightsNotes || "Belum dicantumkan"}</p></details>
    <section className="series-panel">
      <div className="series-section-heading"><div><span className="eyebrow">PRODUCTION LIMITS · MANUAL INPUT</span><h2>Episode duration & Flow budget</h2><p>Google Flow clips max 8 seconds; episode max 8 clips. No video generation or credit spend occurs here.</p></div></div>
      <div className="series-form-grid"><label className="series-form-field">Target duration per episode (seconds)<input type="number" min={30} max={120} value={draft.source.targetDurationSeconds} onChange={(event) => updateProductionSettings("targetDurationSeconds", Number(event.target.value))} disabled={Boolean(draft.approvedPlan)} /></label><label className="series-form-field">Daily credits available (manual)<input type="number" min={1} max={1000000} value={draft.source.dailyCreditsAvailable} onChange={(event) => updateProductionSettings("dailyCreditsAvailable", Number(event.target.value))} disabled={Boolean(draft.approvedPlan)} /></label></div>
      <p><strong>Estimate:</strong> {targetBudget.plannedClips} clips × 10 = {targetBudget.estimatedCredits} credits · reserve {targetBudget.reserveCredits} · available {draft.source.dailyCreditsAvailable}</p>
      {targetBudget.plannedClips > 8 && <p className="workflow-alert attention" role="alert">{draft.source.targetDurationSeconds} seconds needs {targetBudget.plannedClips} Flow clips / {targetBudget.estimatedCredits} credits, above 8-clip episode limit. This workflow does not assume manual holds, loops, or extra shots. Choose ≤64 seconds before analysis or episode generation.</p>}
      {!targetBudget.withinDailyBudget && <p className="workflow-alert attention" role="alert">Estimated episode cost exceeds manually entered daily capacity; no credits are spent automatically.</p>}
      {productionSettingsDirty && <p className="workflow-alert attention" role="status">Settings not saved. If analysis exists, saving resets unapproved analysis and plan; source text remains unchanged.</p>}
      {!draft.approvedPlan && <button type="button" className="button button-light" onClick={() => void saveProductionSettings()} disabled={busy !== "" || !productionSettingsDirty}>{busy === "production-settings" ? "Menyimpan batas produksi…" : "Simpan batas produksi"}</button>}
      {draft.approvedPlan && <small className="series-muted">Approved plan mengunci production settings agar durasi dan budget tidak berubah diam-diam.</small>}
    </section>

    <section className="series-panel">
      <div className="series-section-heading"><div><span className="eyebrow">STEP 1 · EXPLICIT AI ACTION</span><h2>Analisis Cerita</h2><p>Analisis struktur, konflik, karakter, lokasi, peristiwa, ketegangan, hook, durasi, dan jumlah episode.</p></div><Sparkles aria-hidden="true" size={20}/></div>
      {draft.analysis ? <>
        <div className="series-overview-grid"><article><h3>Ringkasan</h3><p>{draft.analysis.summary}</p><h3>Konflik utama</h3><p>{draft.analysis.mainConflict}</p><p>{draft.analysis.conflictDevelopment}</p><h3>Characters</h3><ul>{draft.analysis.characters.map((character, index) => <li key={`${character.name}-${index}`}><strong>{character.name} · {character.role}:</strong> {character.description}</li>)}</ul><h3>Locations</h3><ul>{draft.analysis.locations.map((location, index) => <li key={`${location.name}-${index}`}><strong>{location.name}:</strong> {location.description}</li>)}</ul></article><article><h3>Awal · tengah · akhir</h3><p><strong>Awal:</strong> {draft.analysis.structure.beginning}</p><p><strong>Tengah:</strong> {draft.analysis.structure.middle}</p><p><strong>Akhir:</strong> {draft.analysis.structure.ending}</p><h3>Key events</h3><ul>{draft.analysis.keyEvents.map((event, index) => <li key={index}>{event}</li>)}</ul><h3>Tension points</h3><ul>{draft.analysis.tensionPoints.map((point, index) => <li key={index}>{point}</li>)}</ul><h3>Potential hooks</h3><ul>{draft.analysis.potentialHooks.map((hook, index) => <li key={index}>{hook}</li>)}</ul></article></div>
        <p><strong>Estimasi cerita:</strong> {draft.analysis.estimatedStoryDurationSeconds}s · <strong>Rekomendasi:</strong> {draft.analysis.recommendedEpisodeCount} episode — {draft.analysis.recommendationReason}</p>
        {!!draft.analysis.warnings.length && <div className="workflow-alert attention"><strong>Warnings</strong><ul>{draft.analysis.warnings.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
        <button type="button" className="button button-light" onClick={() => void analyze(true)} disabled={busy !== "" || approved || !providerReady || productionSettingsDirty}>{busy === "analysis" ? "Menganalisis…" : "Susun ulang plan dengan AI"}</button>
      </> : <p>Belum dianalisis. AI call hanya terjadi setelah tombol ditekan.</p>}
      {!draft.analysis && <button type="button" className="button button-primary" onClick={() => void analyze()} disabled={busy !== "" || !providerReady || productionSettingsDirty}>{busy === "analysis" ? "Menganalisis cerita…" : "Analisis Cerita"}</button>}
    </section>

    {draft.analysis && <section className="series-panel">
      <div className="series-section-heading"><div><span className="eyebrow">STEP 2 · USER DECIDES</span><h2>Episode Plan Review</h2><p>AI merekomendasikan; perubahan jumlah, split, merge, judul, sinopsis, konflik, hook, dan ending tetap dapat Anda tinjau.</p></div><span className="count-chip">AI: {draft.analysis.recommendedEpisodeCount} · PLAN: {currentPlan.length}</span></div>
      {!approved && <>
        <label className="series-form-field series-plan-count">Jumlah episode saat ini<input type="number" min={1} max={20} value={currentPlan.length} onChange={(event) => resizePlan(Number(event.target.value))} /></label>
        <div className="series-episode-list">{currentPlan.map((episode, index) => <article className="series-plan-card" key={episode.episodeNumber}>
          <div className="series-section-heading"><div><span className="status-chip">EPISODE {String(episode.episodeNumber).padStart(2, "0")}{episode.manualEditRequired ? " · MANUAL EDIT REQUIRED" : ""}</span><h3>Episode {episode.episodeNumber}</h3></div><span className="series-episode-meta">~{episode.estimatedDurationSeconds}s · {episode.estimatedScenes} scenes · {episode.estimatedFlowClips} clips · {episode.estimatedCredits} credits</span></div>
          <div className="series-form-grid">
            <label className="series-form-field">Judul<input value={episode.title} onChange={(event) => updatePlan(index, "title", event.target.value)} /></label>
            <label className="series-form-field">Estimasi durasi per episode (detik)<input type="number" min={1} max={120} value={episode.estimatedDurationSeconds} onChange={(event) => updatePlanDuration(index, Number(event.target.value))} /><small>{episode.estimatedFlowClips} Flow clips · {episode.estimatedCredits} credits · max 8 clips</small></label>
            <label className="series-form-field">Sinopsis<textarea rows={3} value={episode.synopsis} onChange={(event) => updatePlan(index, "synopsis", event.target.value)} /></label>
            <label className="series-form-field">Konflik episode<textarea rows={2} value={episode.conflict} onChange={(event) => updatePlan(index, "conflict", event.target.value)} /></label>
            <label className="series-form-field">Hook awal<textarea rows={2} value={episode.openingHook} onChange={(event) => updatePlan(index, "openingHook", event.target.value)} /></label>
            <label className="series-form-field">Ending / cliffhanger<textarea rows={2} value={episode.endingCliffhanger} onChange={(event) => updatePlan(index, "endingCliffhanger", event.target.value)} /></label>
          </div>
          {episode.estimatedFlowClips > 8 && <p className="workflow-alert attention" role="alert">Estimasi durasi memerlukan {episode.estimatedFlowClips} klip / {episode.estimatedCredits} kredit. Batas Story Series: 8 klip (64 detik); pendekkan episode atau split plan sebelum approval.</p>}
          {episode.estimatedCredits > draft.source.dailyCreditsAvailable && <p className="workflow-alert attention" role="alert">Episode needs {episode.estimatedCredits} credits; entered daily capacity is {draft.source.dailyCreditsAvailable}. Generation stays blocked until budget capacity or episode duration changes.</p>}
          <div className="series-plan-actions"><button type="button" className="button button-light" onClick={() => splitEpisode(index)} disabled={currentPlan.length >= 20 || busy !== ""}>Bagi episode</button>{index < currentPlan.length - 1 && <button type="button" className="button button-light" onClick={() => mergeEpisodes(index)} disabled={busy !== ""}>Gabung dengan episode berikutnya</button>}<label className="series-checkbox"><input type="checkbox" checked={episode.resolvesMainConflict} onChange={(event) => updatePlan(index, "resolvesMainConflict", event.target.checked)} />Menyelesaikan konflik utama</label></div>
          {episode.manualEditRequired && <small className="series-muted">Lengkapi semua field bertanda TODO. Split/tambah tidak membuat konflik baru otomatis.</small>}
        </article>)}</div>
        <p><strong>Total serial estimate:</strong> {currentPlan.reduce((total, item) => total + item.estimatedFlowClips, 0)} Flow clips · {currentPlan.reduce((total, item) => total + item.estimatedCredits, 0)} credits · daily capacity {draft.source.dailyCreditsAvailable}. Tidak ada saldo Flow/API yang dibaca.</p>
        {planDirty && <p className="workflow-alert attention" role="status">Perubahan plan belum disimpan.</p>}
        <div className="series-plan-actions"><button type="button" className="button button-light" onClick={() => void savePlan()} disabled={busy !== "" || !planIsValid}>Simpan perubahan plan</button><button type="button" className="button button-primary" onClick={() => void savePlan(true)} disabled={busy !== "" || !planIsValid || planDirty && currentPlan.some((item) => item.manualEditRequired)}>{busy === "approve-plan" ? "Menyimpan approval…" : "Setujui Episode Plan"}</button></div>
      </>}
      {approved && <><p>Plan disetujui dan tidak berubah diam-diam. Jumlah episode: {draft.approvedPlan!.length}. Total serial: {draft.approvedPlan!.reduce((total, item) => total + item.estimatedFlowClips, 0)} clips · {draft.approvedPlan!.reduce((total, item) => total + item.estimatedCredits, 0)} credits.</p><div className="series-episode-list">{draft.approvedPlan!.map((episode) => <article className="series-episode-card" key={episode.episodeNumber}><div><span className="status-chip">EPISODE {String(episode.episodeNumber).padStart(2, "0")}</span><h3>{episode.title}</h3><p>{episode.synopsis}</p><small>Konflik: {episode.conflict} · Hook: {episode.openingHook} · Ending: {episode.endingCliffhanger}</small></div><span className="series-episode-meta">{episode.estimatedDurationSeconds}s · {episode.estimatedScenes} scenes · {episode.estimatedCredits} credits</span></article>)}</div></>}
    </section>}

    {approved && <section className="series-panel">
      <div className="series-section-heading"><div><span className="eyebrow">STEP 3 · REVIEW BEFORE APPROVAL</span><h2>Story Bible</h2><p>AI boleh mengusulkan adaptasi. Source tetap acuan; catatan substansial wajib ditinjau.</p></div><BookOpen aria-hidden="true" size={20}/></div>
      {!bibleIsApproved ? <>
        {draft.bibleDraft && <div className="workflow-alert attention"><strong>Adaptation notes — review required</strong>{draft.bibleDraft.adaptationNotes.length ? <ul>{draft.bibleDraft.adaptationNotes.map((note, index) => <li key={index}>{note}</li>)}</ul> : <p>AI tidak melaporkan adaptasi substansial. Tetap tinjau Bible terhadap source.</p>}</div>}
        <label className="series-json-field"><span>Editable Story Bible JSON · story-bible.v1</span><textarea rows={18} value={bibleText} onChange={(event) => setBibleText(event.target.value)} spellCheck={false} aria-label="Editor Story Bible" placeholder="Generate Story Bible setelah plan disetujui" /></label>
        {bibleText && bibleParsed && !bibleParsed.success && <p className="workflow-alert attention" role="alert">Story Bible belum valid: {bibleParsed.error.issues.slice(0, 4).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" · ")}</p>}
        <div className="series-plan-actions"><button type="button" className="button button-primary" onClick={() => void generateBible(Boolean(draft.bibleDraft))} disabled={busy !== "" || !providerReady}>{busy === "bible" ? "Menyusun Story Bible…" : draft.bibleDraft ? "Susun ulang Story Bible (explicit)" : "Generate Story Bible"}</button>{draft.bibleDraft && <button type="button" className="button button-primary" onClick={() => void approveBible()} disabled={busy !== "" || !bibleParsed?.success}>{busy === "approve-bible" ? "Menyimpan approval…" : "Saya sudah meninjau · Setujui Story Bible"}</button>}</div>
      </> : <>
        <p><strong>{draft.approvedBible!.series.title}</strong> · {draft.approvedBible!.series.synopsis}</p><p><strong>World rules:</strong> {draft.approvedBible!.series.storyBible.worldRules.join(" · ")}</p><p><strong>Continuity rules:</strong> {draft.approvedBible!.series.storyBible.continuityRules.join(" · ")}</p>
        <p>Characters {draft.approvedBible!.series.characters.length} · Locations {draft.approvedBible!.series.locations.length} · Props {draft.approvedBible!.series.props.length}. Reference image prompts tersedia sebagai teks; tidak ada gambar yang dibuat otomatis.</p>
        {draft.approvedBible!.adaptationNotes.length > 0 && <div className="workflow-alert attention"><strong>Approved adaptation notes</strong><ul>{draft.approvedBible!.adaptationNotes.map((note, index) => <li key={index}>{note}</li>)}</ul></div>}
        {draft.seriesId && <button type="button" className="button button-light" onClick={() => onNavigate({ view: "series-detail", seriesId: draft.seriesId! })}>Buka Story Series Library</button>}
      </>}
    </section>}

    {bibleIsApproved && <section className="series-panel">
      <div className="series-section-heading"><div><span className="eyebrow">STEP 4 · ONE EPISODE ONLY</span><h2>Generate Selected Episode</h2><p>Story Bible, source, approved plan, continuity handoff, and entity library inform this single draft.</p></div><Film aria-hidden="true" size={20}/></div>
      <label className="series-form-field">Episode<select value={selectedEpisode} onChange={(event) => setSelectedEpisode(Number(event.target.value))}>{episodesForDisplay.map((episode) => <option key={episode.episodeNumber} value={episode.episodeNumber}>Episode {episode.episodeNumber} · {episode.title}{draft.episodeDrafts[String(episode.episodeNumber)] ? " · Draft exists" : ""}</option>)}</select></label>
      <div className="series-import-preview"><strong>Flow budget · no automatic generation</strong><span>Episode target {selectedPlan?.estimatedDurationSeconds ?? draft.source.targetDurationSeconds}s · {selectedEpisodeBudget.plannedClips} clips × 10 = {selectedEpisodeBudget.estimatedCredits} credits · reserve {selectedEpisodeBudget.reserveCredits} / {draft.source.dailyCreditsAvailable} daily credits</span><small>Each Flow clip max 8 seconds. 8-clip ceiling is 64 seconds. No image/video generation or credits are triggered by storyboard creation.</small></div>
      {(selectedPlan?.estimatedDurationSeconds ?? draft.source.targetDurationSeconds) > 64 && <p className="workflow-alert attention" role="alert">Target needs {selectedEpisodeBudget.plannedClips} clips / {selectedEpisodeBudget.estimatedCredits} credits, above 8-clip limit. Manual extension is unsupported; reduce selected episode target to ≤64 seconds before generating.</p>}
      {!selectedEpisodeBudget.withinDailyBudget && <p className="workflow-alert attention" role="alert">Budget shortfall: {selectedEpisodeBudget.estimatedCredits} required vs {draft.source.dailyCreditsAvailable} entered.</p>}
      {selectedEpisode > 1 && !draft.episodeDrafts[String(selectedEpisode - 1)] && !seriesDetail?.episodes.some((episode) => episode.episodeNumber === selectedEpisode - 1) && <p className="workflow-alert attention">Generate Episode {selectedEpisode - 1} first to provide continuity handoff.</p>}
      {importedEpisode?.projectId && <button type="button" className="button button-primary" onClick={() => onOpenProject(importedEpisode.projectId!)}>Open imported episode project</button>}
      {!importedEpisode && <button type="button" className="button button-primary" onClick={() => void generateEpisode()} disabled={busy !== "" || !providerReady || productionSettingsDirty || !selectedEpisodeBudget.withinEightClipLimit || !selectedEpisodeBudget.withinDailyBudget || selectedEpisode > 1 && !draft.episodeDrafts[String(selectedEpisode - 1)] && !seriesDetail?.episodes.some((episode) => episode.episodeNumber === selectedEpisode - 1)}>{busy === "episode" ? "Membuat storyboard…" : selectedRecord ? "Generate ulang episode (explicit)" : `Generate Episode ${selectedEpisode}`}</button>}
      {selectedRecord && <>
        <div className="workflow-alert attention"><strong>Draft only · review required</strong>{selectedRecord.adaptationNotes.length ? <ul>{selectedRecord.adaptationNotes.map((note, index) => <li key={index}>{note}</li>)}</ul> : <p>Tidak ada adaptasi tambahan yang dilaporkan. Tinjau source dan seluruh scene sebelum import.</p>}</div>
        {selectedPackage && <div className="series-episode-list">{selectedPackage.episode.scenes.map((scene, index) => <article className="series-plan-card" key={scene.sceneId}><div className="series-section-heading"><div><span className="status-chip">SCENE {String(scene.order).padStart(2, "0")} · {scene.durationSeconds}s</span><h3>{scene.title}</h3></div><span className="series-episode-meta">{scene.references.characterIds.length + scene.references.locationIds.length + scene.references.propIds.length} continuity refs</span></div><p><strong>Narasi:</strong> {scene.narration}</p><p><strong>Visual/action:</strong> {scene.visual.description} · {scene.visual.primaryAction}</p><label className="series-form-field">Google Flow animation prompt<textarea rows={6} value={scene.googleFlow.prompt} onChange={(event) => updateFlowPrompt(index, "prompt", event.target.value)} /></label><label className="series-form-field">Negative prompt<textarea rows={3} value={scene.googleFlow.negativePrompt} onChange={(event) => updateFlowPrompt(index, "negativePrompt", event.target.value)} /></label><label className="series-form-field">Reference instructions<textarea rows={3} value={scene.googleFlow.referenceInstructions} onChange={(event) => updateFlowPrompt(index, "referenceInstructions", event.target.value)} /></label></article>)}</div>}
        <details className="series-json-advanced"><summary>Advanced · edit full story-series.v1 package</summary><label className="series-json-field"><span>Editable episode production package</span><textarea rows={20} value={packageText} onChange={(event) => setPackageText(event.target.value)} spellCheck={false} aria-label="Editable story-series.v1 episode package" /></label></details>
        {packageText && !packageParsed?.success && <p className="workflow-alert attention" role="alert">Package belum valid: {packageParsed?.error.issues.slice(0, 4).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" · ") || "JSON tidak dapat dibaca."}</p>}
        <div className="series-plan-actions"><button type="button" className="button button-light" onClick={() => void saveEpisodePackage()} disabled={busy !== "" || !selectedPackage || Boolean(importedEpisode)}>Simpan draft & prompt</button><button type="button" className="button button-primary" onClick={() => void importEpisode()} disabled={busy !== "" || !selectedPackage || Boolean(importedEpisode)}>{busy === "import-episode" ? "Mengimpor…" : "Review & import episode to Video Editor"}</button></div>
      </>}
    </section>}
    {seriesDetail?.episodes.length ? <section className="series-panel"><h2>Production episodes</h2><div className="series-library-list">{seriesDetail.episodes.map((episode) => <article className="series-episode-card" key={episode.episodeNumber}><strong>Episode {episode.episodeNumber}</strong>{episode.projectId ? <button type="button" className="button button-light" onClick={() => onOpenProject(episode.projectId!)}>Open project</button> : <span>Imported · project unavailable</span>}</article>)}</div></section> : null}
  </section>;
}

function parseJson<T>(text: string, schema: z.ZodType<T>) {
  if (!text.trim()) return null;
  try { return schema.safeParse(JSON.parse(text) as unknown); }
  catch { return { success: false as const, error: { issues: [{ path: [], message: "JSON tidak dapat dibaca." }] } }; }
}

function stageLabel(stage: string) {
  return ({ source: "SOURCE", "plan-review": "PLAN REVIEW", "bible-generation": "STORY BIBLE", "bible-review": "BIBLE REVIEW", "episode-production": "EPISODE PRODUCTION" } as Record<string, string>)[stage] ?? stage.toUpperCase();
}
