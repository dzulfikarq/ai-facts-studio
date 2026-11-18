import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Film, ImagePlus, Upload } from "lucide-react";
import type { AppRoute } from "./routes";
import { appRouteHref } from "./routes";
import { adaptStorySeriesEpisode, storySeriesPackageSchema, type StorySeries, type StorySeriesPackage, type StorySeriesReferenceKind } from "../domain/story-series";

type Route = Extract<AppRoute, { view: "series-library" | "series-detail" }>;
type Episode = {
  id: string;
  episodeNumber: number;
  title: string;
  projectId: string | null;
  synopsis: string;
  previousEpisodeSummary: string | null;
  openingHook: string;
  endingCliffhanger: string;
  continuityHandoff: StorySeriesPackage["episode"]["continuityHandoff"];
  productionBudget: StorySeriesPackage["productionBudget"];
};
type EntityWithImage<T> = T & { referenceImageUrl?: string };
type SeriesEntityRef = { id: string; name: string; referenceImagePrompt: string; referenceAssetId?: string; referenceImageUrl?: string; continuityRules?: string[] };
type SeriesDetail = StorySeries & {
  id: string;
  createdAt: string;
  updatedAt: string;
  characters: Array<EntityWithImage<StorySeries["characters"][number]>>;
  locations: Array<EntityWithImage<StorySeries["locations"][number]>>;
  props: Array<EntityWithImage<StorySeries["props"][number]>>;
  episodes: Episode[];
};
type SeriesListItem = Pick<SeriesDetail, "id" | "slug" | "title" | "logline" | "plannedEpisodeCount" | "episodes"> & { episodeCount: number };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Request gagal (${response.status})`);
  return body as T;
}

export function StorySeriesPage({ route, busy: appBusy, onNavigate, onOpenProject }: {
  route: Route;
  busy: boolean;
  onNavigate: (route: Route) => void;
  onOpenProject: (id: string) => void;
}) {
  const [seriesList, setSeriesList] = useState<SeriesListItem[]>([]);
  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [draft, setDraft] = useState("");
  const packageInput = useRef<HTMLInputElement>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [referenceBusyId, setReferenceBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const parsed = useMemo(() => {
    if (!draft.trim()) return null;
    try {
      const value: unknown = JSON.parse(draft);
      return storySeriesPackageSchema.safeParse(value);
    } catch {
      return { success: false as const, error: { issues: [{ path: [], message: "JSON tidak dapat dibaca." }] } };
    }
  }, [draft]);
  const promptPreview = useMemo(() => {
    if (!parsed?.success) return { scenes: [], error: "" };
    try { return { scenes: adaptStorySeriesEpisode(parsed.data).visualStoryboard.scenes, error: "" }; }
    catch (cause) { return { scenes: [], error: cause instanceof Error ? cause.message : "Preview prompt gagal dibuat." }; }
  }, [parsed]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    const url = route.view === "series-detail" ? `/api/story-series/${encodeURIComponent(route.seriesId)}` : "/api/story-series";
    void request<SeriesDetail | SeriesListItem[]>(url).then((value) => {
      if (!current) return;
      if (route.view === "series-detail") setDetail(value as SeriesDetail);
      else setSeriesList(value as SeriesListItem[]);
    }).catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : "Story Series gagal dimuat."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [route]);

  async function importPackage() {
    if (!parsed?.success || !promptPreview.scenes.length || promptPreview.error || busy || appBusy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await request<{ project: { id: string }; replay: boolean }>("/api/story-series/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: parsed.data, requestId }),
      });
      setNotice(result.replay ? "Episode sudah pernah diimpor; membuka project tersimpan." : "Episode diimpor tanpa AI call.");
      onOpenProject(result.project.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Import Story Series gagal."); }
    finally { setBusy(false); }
  }

  async function uploadReference(kind: StorySeriesReferenceKind, entityId: string, file?: File) {
    if (!file || !detail || busy || appBusy) return;
    if (file.size > 10 * 1024 * 1024) { setError("Reference image dibatasi 10 MB."); return; }
    const key = `${kind}:${entityId}`;
    setReferenceBusyId(key);
    setError("");
    setNotice("");
    try {
      const body = new FormData();
      body.append("illustration", file);
      const result = await request<{ series: SeriesDetail }>(`/api/story-series/${encodeURIComponent(detail.id)}/references/${kind}/${encodeURIComponent(entityId)}`, { method: "POST", body });
      setDetail(result.series);
      setNotice("Reference image tersimpan untuk kontinuitas series dan episode berikutnya.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Reference image gagal disimpan."); }
    finally { setReferenceBusyId(null); }
  }

  function handleLink(event: React.MouseEvent<HTMLAnchorElement>, target: Route) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(target);
  }

  if (route.view === "series-detail") {
    if (loading && !detail) return <section className="page layout-container series-page" role="status">Memuat Story Series…</section>;
    if (!detail) return <section className="page layout-container series-page"><p className="workflow-alert attention">{error || "Story Series tidak ditemukan."}</p><a className="button button-light" href="/series" onClick={(event) => handleLink(event, { view: "series-library", slug: null })}><ArrowLeft size={16}/>Kembali ke Series</a></section>;
    const continueRoute: Route = { view: "series-library", slug: detail.slug };
    const entityGroups: Array<{ kind: StorySeriesReferenceKind; items: SeriesEntityRef[] }> = [
      { kind: "characters", items: detail.characters },
      { kind: "locations", items: detail.locations },
      { kind: "props", items: detail.props },
    ];
    return <section className="page layout-container series-page">
      <div className="series-page-actions"><a className="button button-light" href="/series" onClick={(event) => handleLink(event, { view: "series-library", slug: null })}><ArrowLeft size={16}/>Series Library</a><a className="button button-primary" href={appRouteHref(continueRoute)} onClick={(event) => handleLink(event, continueRoute)}>Import episode JSON</a></div>
      <header className="series-heading"><div><span className="eyebrow">STORY SERIES · {detail.genre.join(" · ").toUpperCase()}</span><h1>{detail.title}</h1><p>{detail.logline}</p></div><span className="project-total">{detail.episodes.length}/{detail.plannedEpisodeCount} episodes</span></header>
      {error && <p className="workflow-alert danger" role="alert">{error}</p>}{notice && <p className="workflow-alert success" role="status">{notice}</p>}
      <section className="series-overview-grid">
        <article className="series-panel"><span className="eyebrow">STORY BIBLE</span><h2>Setting</h2><p>{detail.storyBible.setting}</p><h3>Central mystery</h3><p>{detail.storyBible.centralMystery}</p><h3>Hidden truth</h3><p>{detail.storyBible.hiddenTruth}</p></article>
        <article className="series-panel"><span className="eyebrow">WORLD RULES</span><ul>{detail.storyBible.worldRules.map((rule, index) => <li key={index}>{rule}</li>)}</ul><h3>Continuity rules</h3><ul>{detail.storyBible.continuityRules.map((rule, index) => <li key={index}>{rule}</li>)}</ul></article>
      </section>
      <section className="series-panel"><div className="series-section-heading"><div><span className="eyebrow">VISUAL STYLE</span><h2>{detail.visualStyle.presetId.replaceAll("-", " ")}</h2><p>{detail.visualStyle.description}</p></div><span className="count-chip">9:16</span></div><p><strong>Palette:</strong> {detail.visualStyle.colorPalette.join(" · ")}</p><ul>{detail.visualStyle.consistencyRules.map((rule, index) => <li key={index}>{rule}</li>)}</ul></section>
      <section className="series-panel"><div className="series-section-heading"><div><span className="eyebrow">TIMELINE</span><h2>Continuity history</h2></div></div><ol className="series-timeline">{detail.storyBible.timeline.map((item, index) => <li key={`${item.date}-${index}`}><strong>{item.date}</strong><span>{item.event}</span></li>)}</ol></section>
      <section className="series-panel"><div className="series-section-heading"><div><span className="eyebrow">EPISODES</span><h2>Episode outline & projects</h2></div><span className="count-chip">{detail.episodes.length} IMPORTED</span></div>
        <div className="series-episode-list">{detail.storyBible.episodeOutlines.map((outline) => {
          const episode = detail.episodes.find((entry) => entry.episodeNumber === outline.episodeNumber);
          return <article className="series-episode-card" key={outline.episodeNumber}><div><span className="status-chip">EPISODE {String(outline.episodeNumber).padStart(2, "0")}</span><h3>{outline.title}</h3><p>{outline.summary}</p><small>Ending hook: {outline.endingHook}</small>{episode && <><p>{episode.synopsis}</p><div className="series-episode-meta"><span>{episode.productionBudget.plannedClips} clips</span><span>{episode.productionBudget.estimatedCredits.toLocaleString("id-ID")} credits estimated</span></div><p><strong>Continuity handoff:</strong> {episode.continuityHandoff.nextEpisodeSetup}</p></>}</div>{episode?.projectId ? <button type="button" className="button button-primary" onClick={() => onOpenProject(episode.projectId!)}><Film size={16}/>Open project</button> : <span className="status-chip idle">NOT IMPORTED</span>}</article>;
        })}</div>
      </section>
      {entityGroups.map(({ kind, items }) => <section className="series-panel" key={kind}>
        <div className="series-section-heading"><div><span className="eyebrow">CONTINUITY REFERENCES</span><h2>{kind[0]!.toUpperCase() + kind.slice(1)}</h2></div><span className="count-chip">{items.length}</span></div>
        <div className="series-entity-grid">{items.map((entity) => <SeriesEntityCard key={entity.id} kind={kind} entity={entity} busy={referenceBusyId === `${kind}:${entity.id}` || appBusy} onUpload={uploadReference}/>)}</div>
      </section>)}
    </section>;
  }

  const parsedPackage = parsed?.success ? parsed.data : null;
  return <section className="page layout-container series-page">
    <header className="series-heading"><div><span className="eyebrow">FICTION PRODUCTION</span><h1>Story Series</h1><p>Import Claude Free JSON tanpa AI call. Episode lanjut memakai Story Bible dan pipeline produksi yang sama.</p></div><BookOpen aria-hidden="true" size={32}/></header>
    {route.slug && <div className="workflow-alert success" role="status">Lanjutkan series <strong>{route.slug}</strong>: unggah JSON episode berikutnya dengan Story Bible yang sama.</div>}
    {error && <p className="workflow-alert danger" role="alert">{error}</p>}{notice && <p className="workflow-alert success" role="status">{notice}</p>}
    <div className="series-library-layout">
      <section className="series-panel series-import-panel"><div className="series-section-heading"><div><span className="eyebrow">IMPORT PREVIEW</span><h2>Episode package</h2><p>Validasi lokal dulu; simpan baru setelah Anda konfirmasi.</p></div><Upload aria-hidden="true" size={21}/></div>
        <button type="button" className="button button-light series-file-picker" onClick={() => packageInput.current?.click()} disabled={busy || appBusy}><Upload aria-hidden="true" size={15}/>Pilih JSON</button><input ref={packageInput} className="series-file-input" type="file" accept=".json,application/json" disabled={busy || appBusy} onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          if (file.size > 1024 * 1024) { setError("JSON dibatasi 1 MB."); return; }
          void file.text().then((value) => { setDraft(value); setRequestId(crypto.randomUUID()); setError(""); setNotice(""); }).catch(() => setError("File JSON tidak dapat dibaca."));
        }}/>
        <label className="series-json-field"><span>Story Series v1 JSON</span><textarea value={draft} onChange={(event) => { setDraft(event.target.value); setRequestId(crypto.randomUUID()); setError(""); setNotice(""); }} spellCheck={false} aria-label="Story Series v1 JSON" placeholder="Pilih file .json atau tempel package di sini"/><small>Maks 1 MB. Import deterministik; tidak menghubungi Claude, Gemini, atau generator gambar.</small></label>
        {parsed && !parsed.success && <div className="workflow-alert attention" role="alert"><strong>Package belum valid</strong><ul>{parsed.error.issues.slice(0, 8).map((issue, index) => <li key={index}>{issue.path.join(".") || "JSON"}: {issue.message}</li>)}</ul></div>}
        {parsedPackage && <div className="series-import-preview"><div><span className="status-chip">VALID · STORY SERIES V1</span><h3>{parsedPackage.series.title} · Episode {String(parsedPackage.episode.episodeNumber).padStart(2, "0")}</h3><p>{parsedPackage.episode.title} · {parsedPackage.episode.scenes.length} scenes · {parsedPackage.episode.targetDurationSeconds}s · {parsedPackage.series.genre.join(" / ")}</p></div><dl><div><dt>Production estimate</dt><dd>{parsedPackage.productionBudget.estimatedCredits.toLocaleString("id-ID")} credits</dd></div><div><dt>Reserve</dt><dd>{parsedPackage.productionBudget.reserveCredits.toLocaleString("id-ID")} credits</dd></div><div><dt>Continuity refs</dt><dd>{parsedPackage.series.characters.length} characters · {parsedPackage.series.locations.length} locations · {parsedPackage.series.props.length} props</dd></div><div><dt>Flow & audio cues</dt><dd>{parsedPackage.episode.scenes.length} prompts · {parsedPackage.episode.scenes.reduce((total, scene) => total + scene.audio.soundEffects.length + scene.audio.ambience.length, 0)} cues</dd></div></dl><details><summary>Story Bible & episode preview</summary><p><strong>Logline:</strong> {parsedPackage.series.logline}</p><p><strong>Setting:</strong> {parsedPackage.series.storyBible.setting}</p><p><strong>Opening hook:</strong> {parsedPackage.episode.openingHook}</p><p><strong>Cliffhanger:</strong> {parsedPackage.episode.endingCliffhanger}</p><p><strong>Previous episode:</strong> {parsedPackage.episode.previousEpisodeSummary || "Episode pertama"}</p></details>
          <details className="series-flow-prompt-preview" open><summary>Pratinjau prompt Google Flow · {promptPreview.scenes.length}/{parsedPackage.episode.scenes.length} scene · style lock diterapkan</summary>
            {promptPreview.error ? <p className="workflow-alert danger" role="alert">{promptPreview.error}</p> : <div className="series-flow-prompt-list">{promptPreview.scenes.map((scene) => <details key={scene.sceneId}><summary>Scene {String(scene.sceneNumber).padStart(2, "0")} · {scene.headline} · {scene.sceneId}</summary><textarea readOnly rows={8} value={scene.flowPrompt ?? ""} aria-label={`Pratinjau prompt Google Flow ${scene.sceneId}`}/></details>)}</div>}
          </details>
          <button type="button" className="button button-primary full-button" onClick={() => void importPackage()} disabled={busy || appBusy || !promptPreview.scenes.length || Boolean(promptPreview.error)}>{busy || appBusy ? "Importing episode…" : "Import episode to Video Workspace"}</button></div>}
      </section>
      <section className="series-panel series-library-panel"><div className="series-section-heading"><div><span className="eyebrow">SAVED SERIES</span><h2>Series Library</h2></div><span className="count-chip">{loading ? "…" : seriesList.length}</span></div>
        {loading ? <p role="status">Memuat series…</p> : seriesList.length ? <div className="series-library-list">{seriesList.map((item) => <a className="series-library-card" key={item.id} href={appRouteHref({ view: "series-detail", seriesId: item.id })} onClick={(event) => handleLink(event, { view: "series-detail", seriesId: item.id })}><span className="series-library-icon"><BookOpen aria-hidden="true" size={19}/></span><span><strong>{item.title}</strong><small>{item.episodeCount}/{item.plannedEpisodeCount} episodes · {item.slug}</small><span>{item.logline}</span></span><b aria-hidden="true">→</b></a>)}</div> : <div className="workflow-empty"><strong>No saved series yet</strong><span>Import first Story Series package to start.</span></div>}
      </section>
    </div>
  </section>;
}

function SeriesEntityCard({ kind, entity, busy, onUpload }: {
  kind: StorySeriesReferenceKind;
  entity: { id: string; name: string; referenceImagePrompt: string; referenceImageUrl?: string; referenceAssetId?: string; continuityRules?: string[] };
  busy: boolean;
  onUpload: (kind: StorySeriesReferenceKind, entityId: string, file?: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <article className="series-entity-card">
    {entity.referenceImageUrl ? <img src={entity.referenceImageUrl} alt={`Continuity reference: ${entity.name}`}/> : <span className="series-entity-placeholder"><ImagePlus aria-hidden="true" size={24}/><small>No reference image</small></span>}
    <div><h3>{entity.name}</h3><small>{kind.slice(0, -1)} · {entity.id}</small>{entity.continuityRules?.map((rule, index) => <p key={index}>{rule}</p>)}<details><summary>Reference image prompt</summary><p>{entity.referenceImagePrompt}</p></details><input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy} onChange={(event) => { onUpload(kind, entity.id, event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}/><button type="button" className="button button-light" onClick={() => input.current?.click()} disabled={busy}><ImagePlus size={15}/>{busy ? "Uploading…" : entity.referenceAssetId ? "Replace reference image" : "Upload reference image"}</button></div>
  </article>;
}
