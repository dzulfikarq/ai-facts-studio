import React, { useEffect, useMemo, useRef, useState } from "react";
import type { VisualAsset } from "../domain/visual-assets";
import type { OpenverseImage, ReusableSceneInput, TablerIconEntry } from "../domain/asset-library";
import type { ResearchPackage } from "../domain/research";
import { compositionForVisualScene, type VisualStoryboard, type VisualStoryboardScene } from "../domain/visual-storyboard";

type Tab = "mine" | "packs" | "online" | "scenes";
type UseMode = "background" | "hero" | "layer";
export type AssetPlacement = { mode: UseMode; fit: "contain" | "cover"; position: "center" | "top" | "bottom" | "left" | "right" | "top-left" | "top-right" | "bottom-left" | "bottom-right" };
type SearchableLibraryAsset = VisualAsset & { projectIds: string[]; previewUrl: string; localAvailable: boolean; referenceCount: number };
export type ReusableSceneEntry = ReusableSceneInput & { id: string; version: number; usageCount: number; createdAt: string; updatedAt: string };
type Paginated<T> = { assets?: T[]; icons?: T[]; scenes?: T[]; total: number; page: number; pageSize: number; pageCount: number; facets?: Record<string, string[]>; categories?: string[] };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Request gagal (${response.status}).`);
  return payload as T;
}

export function SmartAssetLibraryDialog({ open, scene, research, storyboard, projectId, busy, initialTab = "scenes", onClose, onUseAsset, onImportOpenverse, onImportTabler, onUseReusableScene, onSaveReusableScene, onDeleteAsset }: {
  open: boolean;
  scene: VisualStoryboardScene;
  research: ResearchPackage;
  storyboard: VisualStoryboard;
  projectId: string;
  busy: boolean;
  initialTab?: "mine" | "scenes";
  onClose: () => void;
  onUseAsset: (sceneId: string, assetId: string, placement: AssetPlacement) => void;
  onImportOpenverse: (sceneId: string, image: OpenverseImage, placement: AssetPlacement) => void;
  onImportTabler: (sceneId: string, icon: TablerIconEntry, placement: AssetPlacement) => void;
  onUseReusableScene: (sceneId: string, reusable: ReusableSceneEntry) => void;
  onSaveReusableScene: (sceneId: string, data: Omit<ReusableSceneInput, "thumbnailDataUrl"> & { thumbnailDataUrl: string }) => Promise<void>;
  onDeleteAsset: (assetId: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<UseMode>("hero");
  const [fit, setFit] = useState<AssetPlacement["fit"]>("contain");
  const [position, setPosition] = useState<AssetPlacement["position"]>("center");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStyle, setFilterStyle] = useState("");
  const [filterProvider, setFilterProvider] = useState("");
  const [filterLicense, setFilterLicense] = useState("");
  const [packCategory, setPackCategory] = useState("");
  const [licenseFilter, setLicenseFilter] = useState("cc0,pdm,by,by-sa");
  const [local, setLocal] = useState<Paginated<SearchableLibraryAsset>>({ assets: [], total: 0, page: 1, pageSize: 18, pageCount: 0 });
  const [pack, setPack] = useState<Paginated<TablerIconEntry>>({ icons: [], total: 0, page: 1, pageSize: 24, pageCount: 0, categories: [] });
  const [online, setOnline] = useState<{ results: OpenverseImage[]; resultCount: number; pageCount: number; page: number; pageSize: number; licenseIds: string[] } | null>(null);
  const [scenes, setScenes] = useState<Paginated<ReusableSceneEntry>>({ scenes: [], total: 0, page: 1, pageSize: 12, pageCount: 0, facets: {} });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [onlineSearched, setOnlineSearched] = useState(false);
  const [reusableName, setReusableName] = useState(scene.visualSummary.slice(0, 120));
  const [reusableTags, setReusableTags] = useState(scene.objects.map((object) => object.label).join(", "));
  const [reusableConcepts, setReusableConcepts] = useState(scene.visualSummary);
  const [savingReusable, setSavingReusable] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const recommendedQuery = useMemo(() => [...new Set([
    scene.visualFocus ?? "", ...(scene.semanticPlan?.requiredAssets ?? []), ...scene.objects.map((object) => object.label),
    scene.visualSummary, scene.narrationText, scene.semanticPlan?.primaryVisualConcept ?? "",
    ...scene.relationships.map((relationship) => `${relationship.from} ${relationship.relation} ${relationship.to}`),
  ].map((value) => value.trim()).filter(Boolean))].join(" ").slice(0, 180), [scene]);

  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab); setQuery(recommendedQuery); setPage(1); setError(""); setOnlineSearched(false);
    setReusableName(scene.visualSummary.slice(0, 120));
    setReusableTags(scene.objects.map((object) => object.label).join(", "));
    setReusableConcepts(scene.visualSummary);
  }, [open, scene.sceneId, recommendedQuery, initialTab]);

  useEffect(() => {
    if (!open || tab !== "mine") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setError("");
      const params = new URLSearchParams({ q: query, page: String(page), pageSize: "18", category: filterCategory, type: filterType, style: filterStyle, provider: filterProvider, license: filterLicense });
      void request<Paginated<SearchableLibraryAsset>>(`/api/visual-assets/library?${params}`, { signal: controller.signal }).then(setLocal).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Library lokal gagal dimuat.");
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, tab, query, page, filterCategory, filterType, filterStyle, filterProvider, filterLicense, refreshToken]);

  useEffect(() => {
    if (!open || tab !== "packs") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setError("");
      const params = new URLSearchParams({ q: query, page: String(page), pageSize: "24", category: packCategory });
      void request<Paginated<TablerIconEntry>>(`/api/asset-packs/tabler?${params}`, { signal: controller.signal }).then(setPack).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Asset Pack gagal dimuat.");
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, tab, query, page, packCategory, refreshToken]);

  useEffect(() => {
    if (!open || tab !== "scenes") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setError("");
      const params = new URLSearchParams({ q: query, page: String(page), pageSize: "12" });
      void request<Paginated<ReusableSceneEntry>>(`/api/reusable-scenes?${params}`, { signal: controller.signal }).then(setScenes).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Reusable Scenes gagal dimuat.");
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, tab, query, page, refreshToken]);

  async function searchOnline(nextPage = 1) {
    setPage(nextPage); setLoading(true); setError(""); setOnlineSearched(true);
    const params = new URLSearchParams({ q: query, page: String(nextPage), pageSize: "18", license: licenseFilter });
    try { setOnline(await request<{ results: OpenverseImage[]; resultCount: number; pageCount: number; page: number; pageSize: number; licenseIds: string[] }>(`/api/openverse/images?${params}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Openverse search gagal."); setOnline(null); }
    finally { setLoading(false); }
  }

  async function saveScene() {
    setSavingReusable(true); setError("");
    try {
      const svg = document.querySelector<SVGSVGElement>(`[data-visual-scene-id="${CSS.escape(scene.sceneId)}"] .visual-scene-thumbnail svg`);
      if (!svg) throw new Error("Thumbnail scene tidak ditemukan.");
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", "320"); clone.setAttribute("height", "568");
      clone.querySelectorAll("foreignObject").forEach((element) => element.remove());
      clone.querySelectorAll("image").forEach((image) => {
        const href = image.getAttribute("href") ?? image.getAttributeNS("http://www.w3.org/1999/xlink", "href");
        if (href && !href.startsWith("data:")) image.setAttribute("href", new URL(href, window.location.href).href);
      });
      const objectUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" }));
      try {
        const image = new Image(); image.src = objectUrl; await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 568;
        const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas thumbnail tidak tersedia.");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const thumbnailDataUrl = canvas.toDataURL("image/png");
        const researchScene = research.scenes.find((item) => item.id === scene.sceneId);
        if (!researchScene) throw new Error("Research scene tidak ditemukan.");
        const composition = compositionForVisualScene(storyboard, scene);
        const imageIds = [...new Set(composition.layers.flatMap((layer) => layer.nodes.flatMap((node) => node.type === "group" ? node.children : [node])).flatMap((node) => node.type === "image" && node.asset.startsWith("upload-") ? [node.asset] : []))];
        await onSaveReusableScene(scene.sceneId, {
          name: reusableName.trim(), tags: reusableTags.split(",").map((tag) => tag.trim()).filter(Boolean),
          concepts: reusableConcepts.split(",").map((concept) => concept.trim()).filter(Boolean), styleId: storyboard.styleId,
           layout: scene.layout, ...(scene.compositionType ? { compositionType: scene.compositionType } : {}), composition,
          palette: storyboard.palette, motionIntent: scene.motionIntent, motionSummary: scene.motionSummary,
          motionPlan: researchScene.motionPlan, objects: scene.objects, relationships: scene.relationships, visualFocus: scene.visualFocus,
          assetIds: imageIds, thumbnailDataUrl, provenance: "Saved from Visual Storyboard; source scene copy excluded from reusable template.",
        });
        setRefreshToken((current) => current + 1);
      } finally { URL.revokeObjectURL(objectUrl); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Reusable scene gagal disimpan."); }
    finally { setSavingReusable(false); }
  }

  function changeTab(next: Tab) { setTab(next); setPage(1); setError(""); }
  const placement: AssetPlacement = { mode, fit, position };
  const currentPageCount = tab === "mine" ? local.pageCount : tab === "packs" ? pack.pageCount : tab === "scenes" ? scenes.pageCount : online?.pageCount ?? 0;
  const sceneIsAlreadyUsed = compositionForVisualScene(storyboard, scene).layers.some((layer) => layer.nodes.some((node) => node.type === "image" && node.asset.startsWith("upload-")));

  return <dialog ref={dialog} className="smart-asset-dialog" aria-labelledby="smart-asset-title" onClose={onClose}>
    <header className="smart-asset-head">
      <div><span className="eyebrow">SMART ASSET LIBRARY · SCENE {scene.sceneNumber}</span><h2 id="smart-asset-title">Pilih Ilustrasi</h2><p>Mulai dari komposisi reusable lokal yang cocok, lalu library dan Tabler. AI Vector tetap lewat kontrol storyboard yang sudah ada; Openverse hanya dicari atas permintaan. Konteks: {recommendedQuery || scene.visualSummary}. Aset online hanya diunduh setelah Anda memilih.</p></div>
      <button type="button" className="button button-light" onClick={() => dialog.current?.close()}>Tutup</button>
    </header>
    <div className="smart-asset-toolbar">
      <label><span>Cara gunakan</span><select value={mode} onChange={(event) => { const next = event.target.value as UseMode; setMode(next); setFit(next === "background" ? "cover" : "contain"); }}><option value="background">Background</option><option value="hero">Hero illustration</option><option value="layer">Layer</option></select></label>
      <label><span>Fit gambar</span><select value={fit} onChange={(event) => setFit(event.target.value as AssetPlacement["fit"])}><option value="contain">Contain · utuh</option><option value="cover">Cover · isi frame</option></select></label>
      <label><span>Posisi gambar</span><select value={position} onChange={(event) => setPosition(event.target.value as AssetPlacement["position"])}>{(["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"] as const).map((value) => <option value={value} key={value}>{value.replaceAll("-", " ")}</option>)}</select></label>
      <label className="smart-asset-search"><span>Cari aset</span><input value={query} maxLength={200} onChange={(event) => { setQuery(event.target.value); setPage(1); setOnlineSearched(false); setOnline(null); }} placeholder="Konsep, objek, atau narasi scene"/></label>
    </div>
    <div className="smart-asset-tabs" role="tablist" aria-label="Sumber aset visual">
      {([ ["mine", "Library Saya"], ["packs", "Asset Packs"], ["online", "Cari Online"], ["scenes", "Reusable Scenes"] ] as Array<[Tab, string]>).map(([id, title]) => <button type="button" role="tab" aria-selected={tab === id} className={tab === id ? "selected" : ""} key={id} onClick={() => changeTab(id)}>{title}</button>)}
    </div>
    {tab === "mine" && <>
      <div className="smart-asset-filters">
        <label><span>Kategori</span><select value={filterCategory} onChange={(event) => { setFilterCategory(event.target.value); setPage(1); }}><option value="">Semua</option>{(local.facets?.category ?? []).map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Tipe</span><select value={filterType} onChange={(event) => { setFilterType(event.target.value); setPage(1); }}><option value="">Semua</option><option value="illustration">Illustration</option><option value="icon-object">Icon & Object</option></select></label>
        <label><span>Style</span><select value={filterStyle} onChange={(event) => { setFilterStyle(event.target.value); setPage(1); }}><option value="">Semua</option>{(local.facets?.style ?? []).map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Provider</span><select value={filterProvider} onChange={(event) => { setFilterProvider(event.target.value); setPage(1); }}><option value="">Semua</option>{(local.facets?.provider ?? []).filter(Boolean).map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Lisensi</span><select value={filterLicense} onChange={(event) => { setFilterLicense(event.target.value); setPage(1); }}><option value="">Semua</option>{(local.facets?.license ?? []).map((value) => <option key={value}>{value}</option>)}</select></label>
      </div>
      <p className="smart-asset-result-count">{local.total} aset terindeks · halaman {local.page || 1} / {local.pageCount || 1}</p>
      {loading ? <p className="workflow-empty" role="status">Mencari library lokal…</p> : <div className="smart-asset-grid">{(local.assets ?? []).map((asset) => <article className="smart-asset-card" key={asset.id}>
        <img src={asset.previewUrl} alt={`Preview ${asset.name}`} loading="lazy"/>
        <strong>{asset.name}</strong><small>{asset.assetType} · {asset.source} · {asset.format.toUpperCase()} · {asset.width}×{asset.height}</small>
        <small>{asset.provider ?? "Local"} · {asset.license}</small><small>{asset.referenceCount} penggunaan · {asset.localAvailable ? "tersedia lokal" : "file hilang"}</small>
        <small>{asset.semanticTags.slice(0, 5).join(" · ") || asset.supportedConcepts.slice(0, 3).join(" · ")}</small>
        {!asset.localAvailable && <span role="alert">File lokal tidak tersedia setelah restart; pilih aset lain.</span>}
        <button type="button" className="button button-primary" onClick={() => onUseAsset(scene.sceneId, asset.id, placement)} disabled={busy || !asset.localAvailable}>Gunakan di scene</button>
        {asset.projectIds.includes(projectId) && !sceneIsAlreadyUsed && <button type="button" className="button button-light" onClick={() => onDeleteAsset(asset.id)} disabled={busy}>Lepas dari Library Saya</button>}
      </article>)}</div>}
      {!loading && !local.total && <p className="workflow-empty">Belum ada aset lokal yang cocok. Komposisi reusable dicari lebih dulu; coba Asset Packs, AI Vector, atau cari ilustrasi legal di Openverse.</p>}
    </>}
    {tab === "packs" && <>
      <div className="smart-asset-inline-filters"><span>Tabler Icons · MIT · {pack.total.toLocaleString()} ikon terindeks. Icon membantu objek kecil, bukan ilustrasi scene lengkap.</span><label><span>Kategori pack</span><select value={packCategory} onChange={(event) => { setPackCategory(event.target.value); setPage(1); }}><option value="">Semua kategori</option>{(pack.categories ?? []).map((value) => <option key={value}>{value}</option>)}</select></label></div>
      {loading ? <p className="workflow-empty" role="status">Mencari Tabler Icons…</p> : <div className="smart-asset-grid smart-icon-grid">{(pack.icons ?? []).map((icon) => <article className="smart-asset-card" key={icon.id}>
        <img src={icon.previewUrl} alt={`Tabler ${icon.id}`} loading="lazy"/><strong>{icon.id.replaceAll("-", " ")}</strong><small>{icon.category} · {icon.tags.slice(0, 4).join(" · ")}</small><small>Tabler Icons {icon.packageVersion} · MIT</small>
        <button type="button" className="button button-primary" onClick={() => onImportTabler(scene.sceneId, icon, placement)} disabled={busy}>Tambahkan ke Library & gunakan</button>
      </article>)}</div>}
      {!loading && !pack.total && <p className="workflow-empty">Ikon tidak ditemukan. Pencarian hanya memuat 24 preview per halaman.</p>}
    </>}
    {tab === "online" && <>
      <div className="smart-openverse-notice"><strong>Openverse · ilustrasi berlisensi</strong><span>Hasil pencarian bukan jaminan hak cipta, lisensi, atau akurasi. Import menyalin satu aset pilihan ke storage lokal; NC, ND, dan lisensi tidak dikenal tidak ditawarkan.</span><a href="https://openverse.org/" target="_blank" rel="noreferrer">Openverse Terms of Service ↗</a></div>
      <div className="smart-asset-inline-filters"><label><span>Lisensi publikasi</span><select value={licenseFilter} onChange={(event) => setLicenseFilter(event.target.value)}><option value="cc0,pdm,by,by-sa">CC0, Public Domain, CC BY, CC BY-SA</option><option value="cc0,pdm">CC0 + Public Domain</option><option value="by">CC BY only</option><option value="by-sa">CC BY-SA only</option></select></label><button type="button" className="button button-primary" onClick={() => void searchOnline(1)} disabled={loading || !query.trim()}>Cari Openverse</button></div>
      {licenseFilter.includes("by-sa") && <p className="smart-license-warning" role="note">CC BY-SA mewajibkan atribusi dan share-alike untuk adaptasi. Verifikasi lisensi asli sebelum publikasi.</p>}
      {loading ? <p className="workflow-empty" role="status">Mencari Openverse… Tidak mengunduh aset.</p> : online && online.results.length > 0 ? <div className="smart-asset-grid">{online.results.map((image) => <article className="smart-asset-card" key={image.id}>
        <img src={image.thumbnail} alt={`Preview ${image.title}`} loading="lazy" referrerPolicy="no-referrer"/><strong>{image.title}</strong>
        <small>{image.creator} · {image.provider || image.source}</small><small>{image.license.toUpperCase()} {image.licenseVersion} · {image.width}×{image.height}</small>
        <small>{image.attribution}</small><a href={image.landingUrl} target="_blank" rel="noreferrer">Lihat sumber & lisensi ↗</a>
        <button type="button" className="button button-primary" onClick={() => onImportOpenverse(scene.sceneId, image, placement)} disabled={busy}>Tambahkan ke Library & gunakan</button>
      </article>)}</div> : onlineSearched ? <p className="workflow-empty">Tidak ada ilustrasi berlisensi yang cocok. Perluas kata kunci atau gunakan ilustrasi lokal.</p> : <p className="workflow-empty">Cari hanya berjalan setelah tombol Cari Openverse ditekan.</p>}
      {online && <p className="smart-asset-result-count">{online.resultCount.toLocaleString()} hasil · halaman {online.page} dari {online.pageCount}. Preview saja; tidak ada bulk download.</p>}
    </>}
    {tab === "scenes" && <>
      <div className="smart-reusable-save"><div><strong>Simpan scene ini untuk dipakai ulang</strong><small>Template menyimpan komposisi, layer/assets, layout, palet, motion, tags, konsep, dan thumbnail—tanpa menyalin judul/narasi sumber.</small></div>
        <label><span>Nama komposisi</span><input value={reusableName} maxLength={120} onChange={(event) => setReusableName(event.target.value)}/></label>
        <label><span>Tags (pisahkan koma)</span><input value={reusableTags} onChange={(event) => setReusableTags(event.target.value)}/></label>
        <label><span>Konsep (pisahkan koma)</span><input value={reusableConcepts} onChange={(event) => setReusableConcepts(event.target.value)}/></label>
        <button type="button" className="button button-primary" onClick={() => void saveScene()} disabled={busy || savingReusable || !reusableName.trim()}>{savingReusable ? "Menyimpan reusable scene…" : "Simpan komposisi reusable"}</button>
      </div>
      <p className="smart-asset-result-count">{scenes.total} komposisi tersimpan · layout/style bisa difilter.</p>
      {loading ? <p className="workflow-empty" role="status">Mencari reusable scenes…</p> : <div className="smart-asset-grid">{(scenes.scenes ?? []).map((reusable) => <article className="smart-asset-card" key={reusable.id}>
        <img src={reusable.thumbnailDataUrl} alt={`Thumbnail ${reusable.name}`} loading="lazy"/><strong>{reusable.name}</strong><small>{reusable.layout.replaceAll("-", " ")} · {reusable.styleId} · v{reusable.version}</small>
        <small>{reusable.tags.join(" · ")}</small><small>{reusable.concepts.join(" · ")}</small><small>{reusable.usageCount} penggunaan · {reusable.provenance}</small>
        <button type="button" className="button button-primary" onClick={() => onUseReusableScene(scene.sceneId, reusable)} disabled={busy}>Salin ke scene ini</button>
      </article>)}</div>}
      {!loading && !scenes.total && <div className="workflow-empty"><p>Belum ada reusable scene yang cocok. Komposisi lokal dicari lebih dulu; lanjut ke aset lokal atau AI Vector yang sudah tersedia. Tidak ada AI request otomatis.</p><button type="button" className="button button-light" onClick={() => changeTab("mine")}>Cari Library Saya</button></div>}
    </>}
    {error && <p className="smart-asset-error" role="alert">{error}</p>}
    <footer className="smart-asset-footer"><span>{tab === "online" ? "Hanya aset yang dipilih diunduh. File render tetap lokal." : `${local.total.toLocaleString()} aset lokal terindeks; tiap pencarian memuat halaman terbatas.`}</span>
      <a className="button button-light" href={`/api/projects/${projectId}/visual-assets/credits.csv`}>Attribution / Credits Export</a>
      {tab !== "online" && <div><button type="button" className="button button-light" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading}>Sebelumnya</button><span>Halaman {page} / {currentPageCount || 1}</span><button type="button" className="button button-light" onClick={() => setPage((current) => current + 1)} disabled={page >= currentPageCount || loading}>Berikutnya</button></div>}
      {tab === "online" && online && <div><button type="button" className="button button-light" onClick={() => void searchOnline(Math.max(1, online.page - 1))} disabled={online.page <= 1 || loading}>Sebelumnya</button><span>Halaman {online.page} / {online.pageCount || 1}</span><button type="button" className="button button-light" onClick={() => void searchOnline(online.page + 1)} disabled={online.page >= online.pageCount || loading}>Berikutnya</button></div>}
    </footer>
  </dialog>;
}
