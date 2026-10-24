import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Player } from "@remotion/player";
import type { AnyZodObject } from "remotion";
import { categories, motionCues, visualPresets, type ResearchPackage, type Scene } from "../domain/research";
import { captionSegmentsForScene, captionSegmentsSchema } from "../domain/captions";
import { defaultMotionPlan } from "../domain/visual-defaults";
import { motionCuePlanSchema, visualCompositionSchema } from "../domain/visual-composition";
import { durationInFrames } from "../domain/timeline";
import { narrationScript } from "../domain/voice-timing";
import { previewInputProps } from "../video/video";
import { VersionedVideo, type VideoProps } from "../video/root";
import { LEGACY_RENDERER_VERSION, RENDERER_VERSION } from "../video/renderer-version";
import "./styles.css";
import "./tts.css";

type Job = {
  id: string;
  projectId: string;
  state: string;
  createdAt: string;
  error: string | null;
  progress: number;
  attemptCount: number;
  rendererVersion: number;
  manifest: { width: number; height: number; durationSec: number; videoCodec: string; audioCodec: string | null; bytes: number; sha256: string; rendererVersion?: number } | null;
  downloadUrl: string | null;
} | null;

type Project = {
  id: string;
  researchPackage: ResearchPackage;
  audio: {
    file: string; name: string; durationSec: number; bytes: number; sha256: string;
    source: "upload" | "tts"; timingMode: "scaled" | "estimated";
    tts?: { provider: string; model: string; cacheKey: string; scriptSha256: string; locale: string; voiceId: string; voiceName: string; gender: string; voiceAvailability: "api" | "fallback"; speakingRate: number; style: string; generatedAt: string; alignment: "estimated" };
  } | null;
  pendingTts: { cacheKey: string; scriptSha256: string; audioUrl: string; durationSec: number; bytes: number; voiceName: string; locale: string; style: string; speakingRate: number; generatedAt: string } | null;
  pendingTtsMatchesNarration: boolean;
  audioMatchesNarration: boolean;
  researchReviewStatus: "needs-review" | "verified-by-author";
  latestJobCurrent: boolean;
  latestJobContentCurrent: boolean;
  createdAt: string;
  updatedAt: string;
  latestJob: Job;
};

type Status = { ffmpegAvailable: boolean; githubWorkflowAvailable: boolean; dailyLimit: number; jobsUsed: number; nextAllowedAt: string | null };
type TtsVoice = { id: string; name: string; locale: string; localeName: string; gender: string; description?: string; wordsPerMinute: number; availability: "api" | "fallback" };
type TtsVoices = { provider: string; providerName?: string; model?: string; freeTierOnly?: boolean; configured: boolean; disabledReason?: string; locales: Array<{ locale: string; localeName: string }>; voices: TtsVoice[]; catalogSource?: "api" | "fallback"; catalogWarning?: string; message?: string };
type TtsPreview = { cacheKey: string; scriptSha256: string; audioUrl: string; durationSec: number; bytes: number; voiceName: string; locale: string; style: string; speakingRate: number; generatedAt: string; text?: string };
type Failure = Error & { issues?: Array<{ path: Array<string | number>; message: string }>; nextAllowedAt?: string | null };
type ConfirmationOptions = { title: string; message: string; confirmLabel: string; cancelLabel?: string; tone?: "primary" | "danger" };
type PendingConfirmation = ConfirmationOptions & { resolve: (confirmed: boolean) => void };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error ?? `Request gagal (${response.status})`) as Failure;
    error.issues = body.issues;
    error.nextAllowedAt = body.nextAllowedAt;
    throw error;
  }
  return body as T;
}

const jsonRequest = (method: string, payload: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

function friendlyError(error: unknown) {
  if (!(error instanceof Error)) return "Ada kendala. Coba lagi.";
  const failure = error as Failure;
  if (failure.issues?.length) return `${failure.message} ${failure.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" · ")}`;
  if (failure.nextAllowedAt) return `${failure.message} Berikutnya ${new Date(failure.nextAllowedAt).toLocaleString("id-ID")}.`;
  return error.message;
}

function App() {
  const [view, setView] = useState<"dashboard" | "create" | "workspace">("dashboard");
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [research, setResearch] = useState<ResearchPackage | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [jsonDraft, setJsonDraft] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(true);
  const [audioMode, setAudioMode] = useState<"ai" | "upload">("upload");
  const [ttsLocale, setTtsLocale] = useState("id-ID");
  const [ttsGender, setTtsGender] = useState("All");
  const [ttsVoiceId, setTtsVoiceId] = useState("");
  const [ttsStyle, setTtsStyle] = useState("documentary");
  const [ttsRate, setTtsRate] = useState(1);
  const [ttsVoices, setTtsVoices] = useState<TtsVoices | null>(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsBusy, setTtsBusy] = useState(false);
  const [ttsMessage, setTtsMessage] = useState("");
  const [testVoicePreview, setTestVoicePreview] = useState<TtsPreview | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const confirmationRef = useRef<PendingConfirmation | null>(null);

  const selectedScene = useMemo(() => research?.scenes.find((scene) => scene.id === selectedSceneId) ?? research?.scenes[0], [research, selectedSceneId]);

  async function refresh() {
    const [list, serverStatus] = await Promise.all([
      api<Project[]>("/api/projects"),
      api<Status>("/api/status"),
    ]);
    setProjects(list);
    setStatus(serverStatus);
  }

  function askConfirmation(options: ConfirmationOptions) {
    return new Promise<boolean>((resolve) => {
      confirmationRef.current?.resolve(false);
      const next = { ...options, resolve };
      confirmationRef.current = next;
      setConfirmation(next);
    });
  }

  function resolveConfirmation(confirmed: boolean) {
    const pending = confirmationRef.current;
    confirmationRef.current = null;
    setConfirmation(null);
    pending?.resolve(confirmed);
  }

  useEffect(() => { void refresh().catch((error) => setMessage(friendlyError(error))); }, []);

  useEffect(() => {
    if (view !== "workspace" || !project || audioMode !== "ai") return;
    let cancelled = false;
    setTtsLoading(true);
    api<TtsVoices>(`/api/tts/voices?locale=${encodeURIComponent(ttsLocale)}`)
      .then((result) => {
        if (cancelled) return;
        setTtsVoices(result);
        const genderVoices = ttsGender === "All" ? result.voices : result.voices.filter((voice) => voice.gender === ttsGender);
        const fallback = genderVoices[0] ?? result.voices[0];
        setTtsVoiceId((current) => result.voices.some((voice) => voice.id === current) ? current : fallback?.id ?? "");
        if (ttsGender !== "All" && !genderVoices.length) setTtsGender("All");
      })
      .catch((error) => {
        if (!cancelled) setTtsVoices({ provider: "gemini-developer-api", providerName: "Google Gemini TTS", configured: true, locales: [], voices: [], catalogSource: "fallback", catalogWarning: friendlyError(error) });
      })
      .finally(() => { if (!cancelled) setTtsLoading(false); });
    return () => { cancelled = true; };
  }, [view, project?.id, audioMode, ttsLocale, ttsGender]);

  async function openProject(id: string) {
    try {
      const loaded = await api<Project>(`/api/projects/${id}`);
      setProject(loaded);
      setResearch(loaded.researchPackage);
      setSelectedSceneId(loaded.researchPackage.scenes[0]?.id ?? null);
      setAudioMode(loaded.audio?.source === "tts" ? "ai" : "upload");
      setTtsLocale(loaded.audio?.tts?.locale ?? "id-ID");
      setTtsGender(loaded.audio?.tts?.gender ?? "All");
      setTtsVoiceId(loaded.audio?.tts?.voiceId ?? "");
      setTtsStyle(loaded.audio?.tts?.style ?? "documentary");
      setTtsRate(loaded.audio?.tts?.speakingRate ?? 1);
      setTestVoicePreview(null);
      setSaved(true);
      setMessage("");
      setView("workspace");
    } catch (error) { setMessage(friendlyError(error)); }
  }

  async function openCreate() {
    setView("create");
    setMessage("");
    if (!jsonDraft) {
      try {
        const sample = await api<ResearchPackage>("/api/sample");
        setJsonDraft(JSON.stringify(sample, null, 2));
      } catch (error) { setMessage(friendlyError(error)); }
    }
  }

  async function loadSample() {
    setBusy(true);
    try {
      const researchPackage = await api<ResearchPackage>("/api/sample");
      const created = await api<Project>("/api/projects", jsonRequest("POST", { researchPackage }));
      await refresh();
      await openProject(created.id);
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  async function importFile(file?: File) {
    if (!file) return;
    if (file.size > 1024 * 1024) { setMessage("JSON dibatasi 1 MB."); return; }
    setJsonDraft(await file.text());
    setMessage(`Diimpor: ${file.name}. Tinjau isi, lalu buat storyboard.`);
  }

  async function createFromJson() {
    setBusy(true);
    try {
      const researchPackage = JSON.parse(jsonDraft) as ResearchPackage;
      const created = await api<Project>("/api/projects", jsonRequest("POST", { researchPackage }));
      await refresh();
      await openProject(created.id);
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  function updateResearch(change: (current: ResearchPackage) => ResearchPackage) {
    setResearch((current) => current ? change(current) : current);
    setSaved(false);
  }

  function updateScene(sceneId: string, change: (scene: Scene) => Scene) {
    updateResearch((current) => ({ ...current, scenes: current.scenes.map((scene) => scene.id === sceneId ? change(scene) : scene) }));
  }

  async function saveProject() {
    if (!project || !research) return;
    setBusy(true);
    try {
      const updated = await api<Project>(`/api/projects/${project.id}`, jsonRequest("PUT", { researchPackage: research }));
      setProject(updated);
      setResearch(updated.researchPackage);
      setSaved(true);
      await refresh();
      setMessage("Storyboard tersimpan.");
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  async function uploadAudio(file?: File) {
    if (!project || !file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("audio", file);
      const updated = await api<Project>(`/api/projects/${project.id}/audio`, { method: "POST", body: form });
      setProject(updated);
      setAudioMode("upload");
      await refresh();
      setMessage(`Audio siap · ${updated.audio?.durationSec.toFixed(1)} dtk. Timing scene disesuaikan secara proporsional; caption tetap per-scene.`);
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  async function removeAudio() {
    if (!project) return;
    setBusy(true);
    try {
      const updated = await api<Project>(`/api/projects/${project.id}/audio`, { method: "DELETE" });
      setProject(updated);
      await refresh();
      setMessage("Audio dilepas.");
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  async function generateTts(regenerate = false) {
    if (!project || !research || ttsBusy || !ttsVoiceId) return;
    setTtsBusy(true);
    setTtsMessage("");
    try {
      if (!saved) {
        const updated = await api<Project>(`/api/projects/${project.id}`, jsonRequest("PUT", { researchPackage: research }));
        setProject(updated);
        setResearch(updated.researchPackage);
        setSaved(true);
      }
      const result = await api<{ project: Project; preview: TtsPreview; cacheHit: boolean }>(`/api/projects/${project.id}/tts`, jsonRequest("POST", {
        locale: ttsLocale,
        voiceId: ttsVoiceId,
        style: ttsStyle,
        speakingRate: ttsRate,
        regenerate,
      }));
      setProject(result.project);
      setResearch(result.project.researchPackage);
      setSaved(true);
      setAudioMode("ai");
      setTestVoicePreview(null);
      await refresh();
      setTtsMessage(`${result.cacheHit ? "Preview diambil dari cache" : "Preview narasi selesai"} · ${result.preview.durationSec.toFixed(1)} dtk. Dengarkan, lalu pilih Gunakan Audio Ini.`);
    } catch (error) { setTtsMessage(friendlyError(error)); }
    finally { setTtsBusy(false); }
  }

  async function testVoice() {
    if (ttsBusy || !ttsVoiceId) return;
    setTtsBusy(true);
    setTtsMessage("");
    try {
      const preview = await api<{ preview: TtsPreview; cacheHit: boolean }>("/api/tts/test-voice", jsonRequest("POST", {
        locale: ttsLocale, voiceId: ttsVoiceId, style: ttsStyle, speakingRate: ttsRate,
      }));
      setTestVoicePreview(preview.preview);
      setTtsMessage(`Test Voice ${preview.cacheHit ? "diambil dari cache" : "selesai"} · ${preview.preview.durationSec.toFixed(1)} dtk.`);
    } catch (error) { setTtsMessage(friendlyError(error)); }
    finally { setTtsBusy(false); }
  }

  async function approveTts() {
    if (!project || !project.pendingTts || !project.pendingTtsMatchesNarration || !saved || ttsBusy) return;
    setTtsBusy(true);
    setTtsMessage("");
    try {
      const result = await api<{ project: Project }>(`/api/projects/${project.id}/tts/approve`, { method: "POST" });
      setProject(result.project);
      setResearch(result.project.researchPackage);
      setSaved(true);
      setTestVoicePreview(null);
      await refresh();
      setTtsMessage("Audio disetujui dan dipakai untuk preview video. Buat snapshot baru sebelum render.");
    } catch (error) { setTtsMessage(friendlyError(error)); }
    finally { setTtsBusy(false); }
  }

  async function generatePreview() {
    if (!project || !research) return;
    if (project.audio?.source === "tts" && !project.audioMatchesNarration) {
      setMessage("Naskah berubah setelah AI Voice dibuat. Generate ulang AI Voice atau ganti ke upload audio sebelum membuat snapshot.");
      return;
    }
    setBusy(true);
    try {
      let latest = project;
      if (!saved) {
        latest = await api<Project>(`/api/projects/${project.id}`, jsonRequest("PUT", { researchPackage: research }));
        setProject(latest);
        setSaved(true);
      }
      const result = await api<{ job: NonNullable<Job>; warnings: string[] }>(`/api/projects/${project.id}/generate`, { method: "POST" });
      const updated = { ...latest, latestJob: result.job, latestJobCurrent: result.job.rendererVersion === RENDERER_VERSION, latestJobContentCurrent: true };
      setProject(updated);
      await refresh();
      await api<Status>("/api/status").then(setStatus);
      setMessage(result.warnings.length ? result.warnings.join(" ") : "Snapshot job dibuat. Preview siap; tidak ada panggilan AI.");
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  async function renderFinal() {
    const job = project?.latestJob;
    if (!job || !project) return;
    if (!saved || !project.latestJobContentCurrent) {
      setMessage("Storyboard atau audio berubah. Generate preview untuk membuat snapshot baru sebelum render.");
      return;
    }
    if (!project.audio && !await askConfirmation({ title: "Render tanpa narasi?", message: "Project ini belum memiliki voice-over. Tetap render MP4 dengan audio senyap?", confirmLabel: "Tetap render", tone: "primary" })) return;
    setBusy(true);
    try {
      await api<Job>(`/api/jobs/${job.id}/render`, { method: "POST" });
      setMessage("Render berjalan lokal. Progress mengikuti Remotion; ini bisa memakan waktu.");
      for (let check = 0; check < 900; check++) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const updatedJob = await api<NonNullable<Job>>(`/api/jobs/${job.id}`);
        setProject((current) => current ? { ...current, latestJob: updatedJob } : current);
        if (updatedJob.state !== "rendering") {
          setMessage(updatedJob.state === "rendered" ? "MP4 selesai dan metadata terverifikasi." : updatedJob.error ?? "Render gagal.");
          await refresh();
          return;
        }
      }
      setMessage("Render masih berjalan. Status tersimpan; buka kembali job beberapa saat lagi.");
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  async function setReview(statusValue: "needs-review" | "verified-by-author") {
    if (!project) return;
    try {
      const updated = await api<Project>(`/api/projects/${project.id}/review`, jsonRequest("POST", { status: statusValue }));
      setProject(updated);
      await refresh();
    } catch (error) { setMessage(friendlyError(error)); }
  }

  async function deleteProject(id: string) {
    const target = projects.find((item) => item.id === id);
    if (!target || busy) return;
    if (!await askConfirmation({ title: "Hapus video project?", message: `“${target.researchPackage.title}” beserta storyboard, job, dan hasil render akan dihapus permanen.`, confirmLabel: "Hapus video", tone: "danger" })) return;
    setBusy(true);
    try {
      const result = await api<{ deleted: boolean; cleanupPending: number | null }>(`/api/projects/${id}`, { method: "DELETE" });
      if (project?.id === id) {
        setProject(null);
        setResearch(null);
        setSelectedSceneId(null);
        setTestVoicePreview(null);
        setTtsVoices(null);
        setView("dashboard");
        setAudioMode("upload");
      }
      await refresh();
      setMessage(result.cleanupPending === null
        ? `Project “${target.researchPackage.title}” dihapus. Cleanup file masih antre dan akan dicoba ulang otomatis.`
        : result.cleanupPending > 0
          ? `Project “${target.researchPackage.title}” dihapus. ${result.cleanupPending} cleanup file akan dicoba ulang otomatis.`
          : `Project “${target.researchPackage.title}” dihapus.`);
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => setView("dashboard")} aria-label="Kembali ke dashboard">
        <span className="brand-mark">AF</span><span><strong>AI Facts</strong><small>STUDIO</small></span>
      </button>
      <div className="side-label">WORKSPACE</div>
      <button className={`nav-item ${view === "dashboard" ? "active" : ""}`} onClick={() => setView("dashboard")}><span className="nav-glyph">⌂</span> Dashboard</button>
      <button className={`nav-item ${view === "create" ? "active" : ""}`} onClick={() => void openCreate()}><span className="nav-glyph">＋</span> Create video</button>
      <div className="side-label library-label">VIDEO LIBRARY <span>{projects.length}</span></div>
      <div className="project-nav">
        {projects.map((item) => <div className="project-nav-row" key={item.id}>
          <button className={`project-link ${project?.id === item.id ? "selected" : ""}`} onClick={() => void openProject(item.id)} disabled={busy}>
            <span className="project-dot" /> <span>{item.researchPackage.title}</span>
          </button>
          <button className="project-delete" onClick={() => void deleteProject(item.id)} disabled={busy} aria-label={`Hapus ${item.researchPackage.title}`} title="Hapus project">×</button>
        </div>)}
        {!projects.length && <p className="empty-nav">Video yang dibuat muncul di sini.</p>}
      </div>
      <div className="sidebar-bottom">
        <div className="local-pill"><i /> DATA TERSIMPAN LOKAL</div>
        <div className="sidebar-note">Data disimpan lokal; AI Voice mengirim naskah ke provider saat diminta.</div>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <div className="breadcrumb"><span>AI Facts Studio</span><b>/</b><strong>{view === "workspace" ? "Storyboard" : view === "create" ? "Create video" : "Dashboard"}</strong></div>
        <div className="topbar-right"><span className="local-indicator"><i /> LOCAL MODE</span><button className="avatar" aria-label="Pengguna lokal">AF</button></div>
      </header>

      {message && <div className="toast" role="status"><span>{message}</span><button onClick={() => setMessage("")} aria-label="Tutup">×</button></div>}

      {view === "dashboard" && <Dashboard status={status} projects={projects} busy={busy} onCreate={() => void openCreate()} onSample={() => void loadSample()} onOpen={(id) => void openProject(id)} onDelete={(id) => void deleteProject(id)} />}
      {view === "create" && <section className="page create-page">
        <div className="page-heading"><div><div className="eyebrow">MULAI DARI RISET</div><h1>Create video</h1><p>Impor Research Package v1.0 atau v1.1. Versi lama otomatis di-upgrade.</p></div>
          <button className="button button-light" onClick={() => void loadSample()} disabled={busy}><span>✦</span> Gunakan sample gunung</button>
        </div>
        <div className="import-card">
          <div className="import-toolbar"><div><strong>Research package</strong><p>JSON tersimpan lokal. Konten dianggap data, tidak menjalankan script.</p></div>
            <label className="button button-light file-button">Pilih file JSON<input type="file" accept=".json,application/json" onChange={(event) => void importFile(event.target.files?.[0])} /></label>
          </div>
          <textarea className="json-editor" value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} spellCheck={false} aria-label="Editor Research Package JSON" />
          <div className="import-footer"><span>Schema v1.0 (auto-upgrade) / v1.1 <i /> Maks 1 MB <i /> Sumber tidak diverifikasi otomatis</span><button className="button button-primary" disabled={busy || !jsonDraft.trim()} onClick={() => void createFromJson()}>Buat storyboard <b>→</b></button></div>
        </div>
        <div className="notice-line"><span className="notice-icon">ⓘ</span><span>Import bukan verifikasi fakta. Tinjau klaim, URL, dan timing sebelum render atau publikasi.</span></div>
      </section>}

      {view === "workspace" && project && research && <section className="page workspace-page">
        <div className="workspace-heading">
          <div><div className="eyebrow">STORYBOARD <span className="crumb-dot">/</span> DRAFT</div>
            <input className="title-input" aria-label="Judul video" value={research.title} onChange={(event) => updateResearch((current) => ({ ...current, title: event.target.value }))} />
            <div className="meta-line"><span>{research.scenes.length} scenes</span><i />{project.audio ? <span>Audio {project.audio.durationSec.toFixed(1)} dtk</span> : <span>Audio belum ditambahkan</span>}<i /><span>9:16 · 1080 × 1920</span></div>
          </div>
          <div className="heading-actions"><button className={`button button-light save-button ${saved ? "saved" : ""}`} onClick={() => void saveProject()} disabled={busy || saved}>{saved ? "✓ Tersimpan" : "Simpan perubahan"}</button><button className="button button-primary" onClick={() => void generatePreview()} disabled={busy || !saved && !research.title.trim()}><span>✦</span> Generate preview</button></div>
        </div>

        <div className="workspace-grid">
          <div className="story-column">
            <div className="section-title"><div><h2>Storyboard</h2><p>Urutkan dan edit narasi tiap scene.</p></div><span className="count-chip">{research.scenes.length} SCENES</span></div>
            <div className="scene-list">
              {research.scenes.map((scene, index) => <button key={scene.id} className={`scene-row ${selectedScene?.id === scene.id ? "chosen" : ""}`} onClick={() => setSelectedSceneId(scene.id)}>
                <span className="scene-number">{String(index + 1).padStart(2, "0")}</span><span className="scene-row-copy"><strong>{scene.onScreenText || `Scene ${index + 1}`}</strong><small>{scene.startSec}s — {scene.endSec}s <i /> {scene.templateId.replaceAll("-", " ")}</small></span><span className="scene-chevron">›</span>
              </button>)}
            </div>
            {selectedScene && <SceneEditor key={`${project.id}:${selectedScene.id}`} scene={selectedScene} onChange={(change) => updateScene(selectedScene.id, change)} />}
            <div className="project-details-card">
              <div className="section-title compact"><div><h2>Video details</h2><p>Metadata Research Package</p></div></div>
              <div className="details-fields">
                <label>Kategori<select value={research.category} onChange={(event) => updateResearch((current) => ({ ...current, category: event.target.value as ResearchPackage["category"] }))}>{categories.map((value) => <option key={value}>{value}</option>)}</select></label>
                <label>Visual preset<select value={research.visualPreset} onChange={(event) => updateResearch((current) => ({ ...current, visualPreset: event.target.value as ResearchPackage["visualPreset"] }))}>{visualPresets.map((value) => <option key={value} value={value}>{value.replaceAll("-", " ")}</option>)}</select></label>
                <label>Durasi target<input type="number" min="1" max="120" value={research.targetDurationSec} onChange={(event) => updateResearch((current) => ({ ...current, targetDurationSec: Number(event.target.value) }))} /> <small>detik · maks 120</small></label>
              </div>
              <p className="source-warning">{research.references.length} sumber · status <b>{project.researchReviewStatus === "verified-by-author" ? "Reviewed by author" : "Needs review"}</b></p>
            </div>
          </div>

          <div className="preview-column">
    <div className="preview-top"><div><h2>Preview</h2><p>Animasi template · audio pilihan Anda</p></div><span className="preview-live"><i /> LIVE</span></div>
            <div className="player-wrap">
              <Player<AnyZodObject, VideoProps>
                component={VersionedVideo}
                inputProps={previewInputProps(research, project.audio?.file, project.audio?.durationSec, project.audio?.timingMode, saved && project.latestJobContentCurrent ? project.latestJob?.rendererVersion : undefined)}
                durationInFrames={durationInFrames(research, project.audio?.durationSec)}
                compositionWidth={1080}
                compositionHeight={1920}
                fps={30}
                controls
                loop
                style={{ width: "100%", aspectRatio: "9 / 16", maxHeight: "min(62vh, 680px)" }}
              />
            </div>
            <div className="preview-caption"><span className="wave-icon">⌁</span><span>CAPTIONS</span><small>{project.audio?.timingMode === "estimated" ? "Estimasi scene · koreksi manual tersedia" : "Timing scene diskalakan dari durasi audio"}</small></div>
            <section className="audio-source-card">
              <div className="audio-source-tabs" role="group" aria-label="Sumber voice-over">
                <button aria-pressed={audioMode === "ai"} className={audioMode === "ai" ? "selected" : ""} onClick={() => { setAudioMode("ai"); setTtsMessage(""); }}>Generate dengan AI Voice</button>
                <button aria-pressed={audioMode === "upload"} className={audioMode === "upload" ? "selected" : ""} onClick={() => setAudioMode("upload")}>Upload audio sendiri</button>
              </div>
              {audioMode === "ai" ? <TtsPanel
                project={project}
                script={narrationScript(research)}
                voices={ttsVoices}
                loading={ttsLoading}
                busy={ttsBusy || busy}
                saved={saved}
                locale={ttsLocale}
                gender={ttsGender}
                voiceId={ttsVoiceId}
                rate={ttsRate}
                style={ttsStyle}
                message={ttsMessage}
                testPreview={testVoicePreview}
                onLocale={(value) => { setTestVoicePreview(null); setTtsLocale(value); setTtsGender("All"); setTtsVoiceId(""); }}
                onGender={(value) => {
                  setTtsGender(value);
                  const choices = ttsVoices?.voices.filter((voice) => value === "All" || voice.gender === value) ?? [];
                  const next = choices.some((voice) => voice.id === ttsVoiceId) ? ttsVoiceId : choices[0]?.id ?? "";
                  if (next !== ttsVoiceId) setTestVoicePreview(null);
                  setTtsVoiceId(next);
                }}
                onVoice={(value) => {
                  setTestVoicePreview(null);
                  setTtsVoiceId(value);
                  const selected = ttsVoices?.voices.find((voice) => voice.id === value);
                  setTtsGender(selected && selected.gender !== "Unknown" ? selected.gender : "All");
                }}
                onRate={(value) => { setTestVoicePreview(null); setTtsRate(value); }}
                onStyle={(value) => { setTestVoicePreview(null); setTtsStyle(value); }}
                onGenerate={(force) => void generateTts(force)}
                onTest={() => void testVoice()}
                onApprove={() => void approveTts()}
                onRemove={() => void removeAudio()}
              /> : <UploadPanel project={project} busy={busy} onUpload={(file) => void uploadAudio(file)} onRemove={() => void removeAudio()} />}
            </section>
            {!project.audio && <div className="audio-warning">Belum ada audio. Preview tetap bisa diputar; render senyap butuh konfirmasi.</div>}

            <div className="render-card">
              <div className="render-card-head"><div><span className="render-icon">↗</span><div><strong>Render final</strong><small>{project.latestJob ? `Job ${project.latestJob.id.slice(0, 8)} · renderer v${project.latestJob.rendererVersion} · percobaan ${project.latestJob.attemptCount}/3` : "Buat snapshot dahulu"}</small></div></div><span className={`status-chip ${project.latestJob && !project.latestJobContentCurrent ? "failed" : project.latestJob?.state ?? "idle"}`}>{project.latestJob && !project.latestJobContentCurrent ? "SNAPSHOT LAMA" : project.latestJob?.rendererVersion === LEGACY_RENDERER_VERSION ? "RENDERER V1" : jobLabel(project.latestJob?.state)}</span></div>
              {project.latestJob?.state === "rendering" && <div className="progress-track"><i style={{ width: `${project.latestJob.progress}%` }} /></div>}
              {project.latestJob?.manifest && <div className="manifest-line">{project.latestJob.manifest.width}×{project.latestJob.manifest.height} · H.264{project.audio ? ` + ${project.latestJob.manifest.audioCodec?.toUpperCase() ?? "audio"}` : " · track senyap"} · {(project.latestJob.manifest.durationSec).toFixed(1)} dtk · renderer v{project.latestJob.manifest.rendererVersion ?? project.latestJob.rendererVersion}</div>}
              <div className="render-actions"><button className="button button-primary full-button" onClick={() => project.latestJob && !project.latestJobContentCurrent ? void generatePreview() : void renderFinal()} disabled={busy || !project.latestJob || project.latestJob.state === "rendering"}>{project.latestJob && !project.latestJobContentCurrent ? "Generate preview untuk perubahan" : project.latestJob?.rendererVersion === LEGACY_RENDERER_VERSION ? "Render snapshot V1" : project.latestJob?.state === "rendered" ? "Render ulang MP4" : project.latestJob?.state === "rendering" ? `Rendering ${project.latestJob.progress}%` : "Render MP4 lokal"}<b>→</b></button>
                {project.latestJob?.rendererVersion === LEGACY_RENDERER_VERSION && project.latestJobContentCurrent && <button className="button button-light download-button" onClick={() => void generatePreview()} disabled={busy}>Buat preview renderer V2</button>}
                {project.latestJob?.downloadUrl && <a className="button button-light download-button" href={project.latestJob.downloadUrl}>Unduh MP4 ↓</a>}
              </div>
              {project.latestJob?.error && <p className="render-error">{project.latestJob.error}</p>}
              <p className="cloud-note">GitHub Actions workflow tersedia untuk render package yang sudah ada di repo. Upload project dari UI ke cloud belum dihubungkan.</p>
            </div>

            <div className="review-row"><div><strong>Review fakta sebelum publikasi</strong><small>Tidak ada auto-publish.</small></div><button className={`review-toggle ${project.researchReviewStatus === "verified-by-author" ? "is-reviewed" : ""}`} onClick={() => void setReview(project.researchReviewStatus === "verified-by-author" ? "needs-review" : "verified-by-author")}>{project.researchReviewStatus === "verified-by-author" ? "✓ Reviewed" : "Mark reviewed"}</button></div>
          </div>
        </div>
      </section>}
    </main>
    {confirmation && <ConfirmationDialog key="confirmation" options={confirmation} onResolve={resolveConfirmation} />}
  </div>;
}

function ConfirmationDialog({ options, onResolve }: { options: PendingConfirmation; onResolve: (confirmed: boolean) => void }) {
  const cancelButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onResolve(false);
      } else if (event.key === "Tab") {
        const active = document.activeElement;
        if (!dialog.current?.contains(active)) {
          event.preventDefault();
          cancelButton.current?.focus();
        } else if (event.shiftKey && active === cancelButton.current) {
          event.preventDefault();
          confirmButton.current?.focus();
        } else if (!event.shiftKey && active === confirmButton.current) {
          event.preventDefault();
          cancelButton.current?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  return <div className="confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onResolve(false); }}>
    <section ref={dialog} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
      <div className={`confirm-symbol ${options.tone === "danger" ? "danger" : ""}`} aria-hidden="true">{options.tone === "danger" ? "!" : "?"}</div>
      <div className="confirm-copy"><span className="confirm-eyebrow">KONFIRMASI</span><h2 id="confirm-title">{options.title}</h2><p id="confirm-message">{options.message}</p></div>
      <div className="confirm-actions">
        <button ref={cancelButton} className="confirm-cancel" onClick={() => onResolve(false)}>{options.cancelLabel ?? "Batal"}</button>
        <button ref={confirmButton} className={`confirm-submit ${options.tone === "danger" ? "danger" : ""}`} onClick={() => onResolve(true)}>{options.confirmLabel}</button>
      </div>
    </section>
  </div>;
}

function Dashboard({ status, projects, busy, onCreate, onSample, onOpen, onDelete }: { status: Status | null; projects: Project[]; busy: boolean; onCreate: () => void; onSample: () => void; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
  const latest = projects[0];
  return <section className="page dashboard-page">
    <div className="dashboard-heading"><div><div className="eyebrow">LOCAL CREATOR WORKSPACE</div><h1>Selamat datang di<br /><em>AI Facts Studio.</em></h1><p>Ubah riset terverifikasi menjadi animasi edukasi 2D, satu cerita dalam satu waktu.</p></div><button className="button button-primary create-cta" onClick={onCreate}>＋ Create video</button></div>

    <div className="hero-card">
      <div className="hero-copy"><span className="hero-kicker"><i /> ZERO AI CALLS · TEMPLATE-BASED</span><h2>Fakta bagus layak<br />diceritakan bergerak.</h2><p>Mulai dari package sample. Edit storyboard, tinjau sumber, lalu render MP4 9:16.</p><div className="hero-buttons"><button className="button button-primary" onClick={onSample} disabled={busy}>Buka sample gunung <span>→</span></button><button className="hero-link" onClick={onCreate}>Impor riset sendiri <span>↗</span></button></div></div>
      <div className="hero-art" aria-hidden="true"><div className="sun"/><div className="hill hill-back"/><div className="hill hill-front"/><div className="hero-stamp"><span>01</span><small>2D MOTION<br />TEMPLATE</small></div><div className="hero-caption">BUMI SELALU BERGERAK <span>▰ ▰ ▰</span></div></div>
    </div>

    <div className="stat-grid">
      <div className="stat-card"><span className="stat-icon teal">◷</span><div><small>DAILY JOB LIMIT</small><strong>{status ? `${Math.max(0, status.dailyLimit - status.jobsUsed)} / ${status.dailyLimit}` : "—"}</strong><p>{status?.jobsUsed ? `Slot berikutnya ${status.nextAllowedAt ? new Date(status.nextAllowedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "tersedia"}` : "Slot job video baru tersedia"}</p></div></div>
      <div className="stat-card"><span className="stat-icon orange">▣</span><div><small>VIDEO PROJECTS</small><strong>{projects.length.toString().padStart(2, "0")}</strong><p>Draft tersimpan di perangkat</p></div></div>
      <div className="stat-card"><span className={`stat-icon ${status?.ffmpegAvailable ? "teal" : "orange"}`}>⌘</span><div><small>LOCAL RENDER ENGINE</small><strong className="engine-status">{status?.ffmpegAvailable ? "Ready" : "Setup needed"}</strong><p>{status?.ffmpegAvailable ? "FFmpeg tersedia" : "Install FFmpeg untuk render"}</p></div></div>
    </div>

    <div className="section-title recent-title"><div><h2>Recent projects</h2><p>Storyboard dan hasil render terbaru.</p></div><span className="recent-count">{projects.length} TOTAL</span></div>
    {projects.length ? <div className="recent-list">{projects.slice(0, 5).map((item, index) => <div className="recent-row" key={item.id}>
      <button className="recent-item" onClick={() => onOpen(item.id)} disabled={busy}><span className={`recent-thumb thumb-${index % 3}`}><i>✦</i></span><span className="recent-copy"><strong>{item.researchPackage.title}</strong><small>{item.researchPackage.category} <i /> {item.researchPackage.scenes.length} scenes <i /> {new Date(item.updatedAt).toLocaleDateString("id-ID")}</small></span><span className={`status-chip ${item.latestJob?.state ?? "idle"}`}>{jobLabel(item.latestJob?.state)}</span><span className="recent-arrow">→</span></button>
      <button className="recent-delete" onClick={() => onDelete(item.id)} disabled={busy} aria-label={`Hapus ${item.researchPackage.title}`} title="Hapus project">×</button>
    </div>)}</div> : <button className="empty-projects" onClick={onSample}><span className="empty-plus">＋</span><strong>Belum ada project</strong><small>Mulai dengan sample animasi gunung 7 scene.</small></button>}
    <div className="setup-strip"><div className="setup-mark">GH</div><div><strong>GitHub Actions render</strong><small>{status?.githubWorkflowAvailable ? "Workflow tersedia · setup manual dibutuhkan untuk cloud render." : "Workflow belum ditemukan."}</small></div><a href="/api/docs/github-actions" target="_blank" rel="noreferrer">Setup guide ↗</a></div>
    {latest && <span className="sr-only">Latest project: {latest.researchPackage.title}</span>}
  </section>;
}

function TtsPanel({ project, script, voices, loading, busy, saved, locale, gender, voiceId, rate, style, message, testPreview, onLocale, onGender, onVoice, onRate, onStyle, onGenerate, onTest, onApprove, onRemove }: {
  project: Project;
  script: string;
  voices: TtsVoices | null;
  loading: boolean;
  busy: boolean;
  saved: boolean;
  locale: string;
  gender: string;
  voiceId: string;
  rate: number;
  style: string;
  message: string;
  testPreview: TtsPreview | null;
  onLocale: (locale: string) => void;
  onGender: (gender: string) => void;
  onVoice: (voiceId: string) => void;
  onRate: (rate: number) => void;
  onStyle: (style: string) => void;
  onGenerate: (regenerate: boolean) => void;
  onTest: () => void;
  onApprove: () => void;
  onRemove: () => void;
}) {
  const availableGenders = ["All", ...new Set(voices?.voices.map((voice) => voice.gender) ?? [])];
  const visibleVoices = voices?.voices.filter((voice) => gender === "All" || voice.gender === gender) ?? [];
  const selectedVoice = voices?.voices.find((voice) => voice.id === voiceId);
  return <div className="tts-panel">
    <div className="tts-panel-heading"><div className="audio-icon">✦</div><div><strong>AI Voice Generator</strong><small>{voices?.providerName ?? "Google Gemini TTS"} · {voices?.model ?? "gemini-3.8-flash-lite-tts"} · narrationText tiap scene</small></div></div>
    {!voices?.configured && !loading && <div className="tts-config-notice"><strong>Gemini Free Tier belum dibuka</strong><span>Set <code>GEMINI_API_KEY</code> dan <code>GEMINI_TTS_FREE_TIER_ONLY=true</code> setelah pastikan Google project tidak menautkan billing. Model berbayar tidak akan dipakai sebagai fallback.</span><a href="/api/docs/tts" target="_blank" rel="noreferrer">Buka panduan konfigurasi ↗</a></div>}
    {voices?.configured && <div className="tts-consent-note">Test Voice mengirim contoh singkat; naskah storyboard dikirim hanya setelah Preview Narasi Lengkap. Gemini Free Tier dapat memakai input/output untuk peningkatan produk. Pastikan project tetap tier Free. <a href="https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash-lite-tts" target="_blank" rel="noreferrer">Kuota & harga ↗</a></div>}
    {voices?.message && <div className="tts-error">{voices.message}</div>}
    {voices?.catalogSource === "fallback" && <div className="tts-consent-note tts-fallback-warning" role="status">{voices.catalogWarning} Gender opsional. Generate tetap memvalidasi model dan dapat gagal bila project tidak menyediakan voice.</div>}
    <div className="tts-fields">
      <label>Bahasa<select aria-label="Bahasa voice" value={locale} onChange={(event) => onLocale(event.target.value)} disabled={loading || busy}>
        {(voices?.locales.length ? voices.locales : [{ locale: "id-ID", localeName: "Bahasa Indonesia" }]).map((item) => <option key={item.locale} value={item.locale}>{item.localeName} ({item.locale})</option>)}
      </select></label>
      <div className="tts-field-row">
        <label>Gender filter<select aria-label="Filter gender voice (opsional)" value={gender} onChange={(event) => onGender(event.target.value)} disabled={loading || busy}>
          {availableGenders.map((value) => <option key={value} value={value}>{value === "All" ? "Semua (opsional)" : value === "Unknown" ? "Tidak diketahui" : value}</option>)}
        </select></label>
      <label>Voice<select aria-label="Voice AI" value={voiceId} onChange={(event) => onVoice(event.target.value)} disabled={loading || busy || !visibleVoices.length}>
          {visibleVoices.length ? visibleVoices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name} · {voice.gender}</option>) : <option value="">{loading ? "Memuat voice…" : "Katalog voice kosong"}</option>}
        </select></label>
      </div>
      <label>Gaya bicara<select aria-label="Gaya bicara AI" value={style} onChange={(event) => onStyle(event.target.value)} disabled={busy}>
        <option value="documentary">Dokumenter informatif</option><option value="neutral">Netral</option><option value="warm">Hangat</option><option value="energetic">Energik</option><option value="calm">Tenang</option>
      </select></label>
      <label className="rate-control">Speaking pace · arahan prompt <strong>{rate.toFixed(1)}×</strong><input type="range" min="0.7" max="1.3" step="0.1" value={rate} onChange={(event) => onRate(Number(event.target.value))} disabled={busy} /><span><small>Lebih lambat</small><small>Lebih cepat · perkiraan</small></span></label>
    </div>
    <div className="tts-actions tts-test-actions"><button className="button button-light" onClick={onTest} disabled={busy || loading || !voices?.configured || !voiceId}>Test Voice · contoh singkat</button></div>
    {testPreview && <div className="tts-audio-preview"><span>Test Voice · {testPreview.voiceName} · {testPreview.durationSec.toFixed(1)} dtk</span><audio controls preload="metadata" src={testPreview.audioUrl} aria-label="Pratinjau Test Voice" /></div>}
    <details className="tts-script"><summary>Naskah TTS · {script.length.toLocaleString("id-ID")} / 6.000 karakter</summary><textarea readOnly rows={4} value={script} aria-label="Naskah gabungan dari scene" /></details>
    {project.audio?.source === "tts" && !project.audioMatchesNarration && <div className="tts-stale-warning">Narration storyboard berubah setelah audio dibuat. Generate ulang sebelum membuat job.</div>}
    {project.pendingTts && <div className="tts-audio-preview pending-tts-preview">
      <strong>Preview Narasi Lengkap · {project.pendingTts.voiceName} · {project.pendingTts.durationSec.toFixed(1)} dtk</strong>
      <audio controls preload="metadata" src={project.pendingTts.audioUrl} aria-label="Pratinjau narasi lengkap" />
      {!saved && <span className="tts-stale-warning">Simpan perubahan storyboard sebelum memakai preview ini.</span>}
      {project.pendingTtsMatchesNarration && saved && <button className="button button-primary" onClick={onApprove} disabled={busy}>Gunakan Audio Ini</button>}
      {!project.pendingTtsMatchesNarration && <span className="tts-stale-warning">Naskah berubah. Simpan storyboard, lalu buat preview baru.</span>}
    </div>}
    {project.audio?.source === "tts" && <div className="tts-audio-preview"><span>Audio terpilih · {project.audio.tts?.voiceName ?? "AI Voice"} · {project.audio.tts?.locale} · {project.audio.tts?.style} · {project.audio.tts?.speakingRate.toFixed(1)}× · {project.audio.durationSec.toFixed(1)} dtk</span><audio controls preload="metadata" src={`/${project.audio.file}`} aria-label="Pratinjau AI Voice terpilih" /><button className="text-button danger-text" onClick={onRemove} disabled={busy}>Lepas audio</button></div>}
    {project.audio?.source === "upload" && <div className="tts-audio-preview"><span>Audio terpilih · {project.audio.name} · {project.audio.durationSec.toFixed(1)} dtk</span><audio controls preload="metadata" src={`/${project.audio.file}`} aria-label="Pratinjau audio upload terpilih" /></div>}
    {message && <div className={message.includes("selesai") || message.includes("cache") || message.includes("disetujui") ? "tts-success" : "tts-error"} role="status">{message}</div>}
    <div className="tts-actions"><button className="button button-primary" onClick={() => onGenerate(false)} disabled={busy || loading || !voices?.configured || !voiceId || !script.trim()}>{busy ? "Menyiapkan preview…" : "Preview Narasi Lengkap"}</button>
      {(project.pendingTts || project.audio?.source === "tts") && <button className="button button-light" onClick={() => onGenerate(true)} disabled={busy || loading || !voices?.configured || !voiceId}>Regenerate preview</button>}
    </div>
    <p className="tts-limit-note">Test Voice dan preview penuh memakai kuota yang sama: maks 3 synthesis per teks/setting dan 10 per 24 jam. Cache dipakai ulang; tidak memakai slot job video. Audio baru aktif setelah Anda pilih Gunakan Audio Ini.</p>
    {selectedVoice && <span className="sr-only">{selectedVoice.gender}, {selectedVoice.locale}, {selectedVoice.wordsPerMinute} kata/menit</span>}
  </div>;
}

function UploadPanel({ project, busy, onUpload, onRemove }: { project: Project; busy: boolean; onUpload: (file?: File) => void; onRemove: () => void }) {
  return <div className="upload-panel">
    <div className="audio-card">
      <div className="audio-icon">♫</div><div className="audio-copy"><strong>{project.audio?.name ?? "Voice-over manual"}</strong><small>{project.audio ? `${project.audio.durationSec.toFixed(1)} detik · ${formatBytes(project.audio.bytes)}` : "MP3, WAV, M4A · maks 100 MB / 120 detik"}</small></div>
      <label className="button button-light upload-button">{project.audio ? "Ganti" : "Pilih audio"}<input type="file" accept="audio/mpeg,audio/wav,audio/mp4,.mp3,.wav,.m4a" disabled={busy} onChange={(event) => onUpload(event.target.files?.[0])} /></label>
    </div>
    {project.audio && <div className="tts-audio-preview"><span>Pratinjau voice-over</span><audio controls preload="metadata" src={`/${project.audio.file}`} aria-label="Pratinjau audio upload" /><button className="text-button danger-text" onClick={onRemove} disabled={busy}>Lepas</button></div>}
    <p className="upload-note">Audio di-probe dengan ffprobe. Timing scene diskalakan memakai durasi aktual; koreksi manual tersedia.</p>
  </div>;
}

function SceneEditor({ scene, onChange }: { scene: Scene; onChange: (change: (scene: Scene) => Scene) => void }) {
  const [compositionDraft, setCompositionDraft] = useState(JSON.stringify(scene.visualComposition, null, 2));
  const [compositionError, setCompositionError] = useState("");
  const [motionDraft, setMotionDraft] = useState(JSON.stringify(scene.motionPlan, null, 2));
  const [motionError, setMotionError] = useState("");
  const [captionDraft, setCaptionDraft] = useState(JSON.stringify(captionSegmentsForScene(scene), null, 2));
  const [captionError, setCaptionError] = useState("");

  function editComposition(value: string) {
    setCompositionDraft(value);
    try {
      const parsed = visualCompositionSchema.safeParse(JSON.parse(value));
      if (!parsed.success) { setCompositionError(parsed.error.issues[0]?.message ?? "Komposisi visual tidak valid."); return; }
      const layerIds = new Set(parsed.data.layers.map((layer) => layer.id));
      if (scene.motionPlan.some((plan) => !["all", "scene"].includes(plan.targetLayer) && !layerIds.has(plan.targetLayer))) {
        setCompositionError("Layer ini dipakai motionPlan. Ubah target motionPlan sebelum menghapus layer.");
        return;
      }
      setCompositionError("");
      onChange((current) => ({ ...current, visualComposition: parsed.data }));
    } catch { setCompositionError("JSON komposisi belum lengkap/valid."); }
  }

  function editMotionPlan(value: string) {
    setMotionDraft(value);
    try {
      const parsed = motionCuePlanSchema.array().max(8).safeParse(JSON.parse(value));
      if (!parsed.success) { setMotionError(parsed.error.issues[0]?.message ?? "Motion plan tidak valid."); return; }
      if (parsed.data.length !== scene.motionCues.length || parsed.data.some((plan, index) => plan.cue !== scene.motionCues[index])) {
        setMotionError("Motion plan harus memuat satu entry per cue, urutan harus sama.");
        return;
      }
      const layerIds = new Set(scene.visualComposition.layers.map((layer) => layer.id));
      if (parsed.data.some((plan) => !["all", "scene"].includes(plan.targetLayer) && !layerIds.has(plan.targetLayer))) {
        setMotionError("Target motion harus all, scene, atau ID layer yang ada.");
        return;
      }
      setMotionError("");
      onChange((current) => ({ ...current, motionPlan: parsed.data }));
    } catch { setMotionError("JSON motion plan belum lengkap/valid."); }
  }

  function editCaptionSegments(value: string) {
    setCaptionDraft(value);
    try {
      const parsed = captionSegmentsSchema.safeParse(JSON.parse(value));
      if (!parsed.success) { setCaptionError(parsed.error.issues[0]?.message ?? "Caption segments tidak valid."); return; }
      setCaptionError("");
      onChange((current) => ({ ...current, captionSegments: parsed.data }));
    } catch { setCaptionError("JSON caption segments belum lengkap/valid."); }
  }

  function useAutoCaptionSegments() {
    const generated = captionSegmentsForScene({ ...scene, captionSegments: undefined });
    setCaptionDraft(JSON.stringify(generated, null, 2));
    setCaptionError("");
    onChange((current) => ({ ...current, captionSegments: undefined }));
  }

  function changeNarration(value: string) {
    const next = { ...scene, narrationText: value, captionSegments: undefined };
    const generated = captionSegmentsForScene(next);
    setCaptionDraft(JSON.stringify(generated, null, 2));
    setCaptionError("");
    onChange(() => next);
  }

  function changeOnScreenText(value: string) {
    const next = { ...scene, onScreenText: value };
    if (!scene.captionSegments) setCaptionDraft(JSON.stringify(captionSegmentsForScene(next), null, 2));
    onChange(() => next);
  }

  function toggleCue(cue: typeof motionCues[number], checked: boolean) {
    if (checked && scene.motionCues.length >= 8) { setMotionError("Maksimal 8 motion cues per scene."); return; }
    const next = checked ? [...scene.motionCues, cue] : scene.motionCues.filter((item) => item !== cue);
    const motionPlan = defaultMotionPlan(next);
    setMotionDraft(JSON.stringify(motionPlan, null, 2));
    setMotionError("");
    onChange((current) => ({ ...current, motionCues: next, motionPlan }));
  }

  return <div className="scene-editor">
    <div className="scene-editor-title"><div><span className="eyebrow">EDIT SCENE</span><strong>{scene.id}</strong></div><span className="template-badge">{scene.templateId}</span></div>
    <label>On-screen text<input maxLength={120} value={scene.onScreenText} onChange={(event) => changeOnScreenText(event.target.value)} /></label>
    <label>Narration / caption<textarea rows={3} maxLength={2000} value={scene.narrationText} onChange={(event) => changeNarration(event.target.value)} /></label>
    <label>Visual direction · editorial only<textarea rows={2} maxLength={500} value={scene.visualDescription} onChange={(event) => onChange((current) => ({ ...current, visualDescription: event.target.value }))} /></label>
    <div className="timing-fields"><label>Mulai (detik)<input type="number" min="0" max="120" step="0.5" value={scene.startSec} onChange={(event) => onChange((current) => ({ ...current, startSec: Number(event.target.value) }))} /></label><span>→</span><label>Akhir (detik)<input type="number" min="0.5" max="120" step="0.5" value={scene.endSec} onChange={(event) => onChange((current) => ({ ...current, endSec: Number(event.target.value) }))} /></label></div>
    <fieldset className="motion-cue-grid"><legend>Motion cues</legend>{motionCues.map((cue) => <label key={cue}><input type="checkbox" checked={scene.motionCues.includes(cue)} onChange={(event) => toggleCue(cue, event.target.checked)} />{cue}</label>)}</fieldset>
    <details className="visual-json-editor"><summary>Caption phrases · {scene.captionSegments ? "manual timing" : "deterministic estimate"}</summary><textarea rows={7} spellCheck={false} value={captionDraft} onChange={(event) => editCaptionSegments(event.target.value)} aria-label="JSON caption phrases" /><div className="caption-editor-note">startProgress/endProgress 0–1 dalam scene; tidak menjanjikan word-level sync. <button type="button" className="text-button" onClick={useAutoCaptionSegments}>Pakai segmentasi otomatis</button></div>{captionError && <span role="alert">{captionError}</span>}</details>
    <details className="visual-json-editor"><summary>Visual composition terstruktur · {scene.visualComposition.layers.length} layer</summary><textarea rows={10} spellCheck={false} value={compositionDraft} onChange={(event) => editComposition(event.target.value)} aria-label="JSON visual composition" />{compositionError && <span role="alert">{compositionError}</span>}</details>
    <details className="visual-json-editor"><summary>Motion plan · target, delay, durasi, easing</summary><textarea rows={8} spellCheck={false} value={motionDraft} onChange={(event) => editMotionPlan(event.target.value)} aria-label="JSON motion plan" />{motionError && <span role="alert">{motionError}</span>}</details>
    <div className="cue-line">SFX metadata · belum diputar <span>{scene.sfxCues.join(" · ") || "none"}</span></div>
  </div>;
}

function jobLabel(state?: string) {
  const labels: Record<string, string> = { "preview-ready": "PREVIEW READY", rendering: "RENDERING", rendered: "RENDERED", failed: "FAILED", idle: "DRAFT" };
  return labels[state ?? "idle"] ?? state?.toUpperCase() ?? "DRAFT";
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
