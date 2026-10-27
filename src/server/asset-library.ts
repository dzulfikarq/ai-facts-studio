import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { existsSync, readFileSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import { BlockList, isIP } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import { openverseLicenseIds, type OpenverseImage, type TablerIconEntry } from "../domain/asset-library";
import { inspectRasterImage, visualAssetSchema, type VisualAsset } from "../domain/visual-assets";

const tablerRoot = path.resolve(process.cwd(), "node_modules/@tabler/icons");
const tablerPackage = JSON.parse(readFileSync(path.join(tablerRoot, "package.json"), "utf8")) as { version: string; license: string };
const tablerMetadata = JSON.parse(readFileSync(path.join(tablerRoot, "icons.json"), "utf8")) as Record<string, { category: string; tags?: string[] }>;
const tablerNodes = JSON.parse(readFileSync(path.join(tablerRoot, "tabler-nodes-outline.json"), "utf8")) as Record<string, Array<[string, Record<string, string | number>]>>;

export function indexTablerIcons(db: DatabaseSync) {
  const indexed = db.prepare("SELECT package_version FROM asset_pack_icons WHERE pack = 'tabler-outline' LIMIT 1").get() as { package_version: string } | undefined;
  const count = (db.prepare("SELECT COUNT(*) AS count FROM asset_pack_icons WHERE pack = 'tabler-outline'").get() as { count: number }).count;
  if (indexed?.package_version === tablerPackage.version && count > 0) return;
  db.exec("DELETE FROM asset_pack_icons_fts; DELETE FROM asset_pack_icons WHERE pack = 'tabler-outline';");
  const insert = db.prepare("INSERT INTO asset_pack_icons (pack, icon_id, category, tags, package_version) VALUES ('tabler-outline', ?, ?, ?, ?)");
  const insertSearch = db.prepare("INSERT INTO asset_pack_icons_fts (icon_id, category, tags) VALUES (?, ?, ?)");
  const items = Object.entries(tablerMetadata);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [iconId, entry] of items) {
      if (!existsSync(path.join(tablerRoot, "icons/outline", `${iconId}.svg`)) || !tablerNodes[iconId]) continue;
      const tags = [...new Set((entry.tags ?? []).map((tag) => String(tag).trim()).filter(Boolean))];
      insert.run(iconId, entry.category ?? "Other", JSON.stringify(tags), tablerPackage.version);
      insertSearch.run(iconId, entry.category ?? "Other", tags.join(" "));
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function assetFtsExpression(value: string) {
  const terms = value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? [];
  return terms.slice(0, 8).map((term) => `"${term.replaceAll('"', '""')}"*`).join(" OR ");
}

export function searchTablerIcons(db: DatabaseSync, query: string, category: string, page: number, pageSize: number): { icons: TablerIconEntry[]; total: number; page: number; pageSize: number; categories: string[] } {
  const categories = (db.prepare("SELECT DISTINCT category FROM asset_pack_icons WHERE pack = 'tabler-outline' ORDER BY category").all() as Array<{ category: string }>).map((row) => row.category);
  const match = assetFtsExpression(query);
  const conditions = ["i.pack = 'tabler-outline'", ...(category ? ["i.category = ?"] : []), ...(match ? ["asset_pack_icons_fts MATCH ?"] : [])].join(" AND ");
  const params = [...(category ? [category] : []), ...(match ? [match] : [])];
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM asset_pack_icons i JOIN asset_pack_icons_fts f ON f.icon_id = i.icon_id WHERE ${conditions}`).get(...params) as { count: number }).count;
  const rows = db.prepare(`SELECT i.icon_id, i.category, i.tags, i.package_version FROM asset_pack_icons i JOIN asset_pack_icons_fts f ON f.icon_id = i.icon_id WHERE ${conditions} ORDER BY i.icon_id LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as Array<{ icon_id: string; category: string; tags: string; package_version: string }>;
  return { icons: rows.map((row) => ({ id: row.icon_id, category: row.category, tags: JSON.parse(row.tags) as string[], license: "MIT", packageVersion: row.package_version, previewUrl: `/api/asset-packs/tabler/icons/${row.icon_id}.svg` })), total, page, pageSize, categories };
}

const svgTags = new Set(["path", "circle", "ellipse", "line", "polyline", "polygon", "rect"]);
const svgAttributes = new Set(["d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2", "width", "height", "points", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "fill-rule", "clip-rule"]);
const svgValuePattern = /^[A-Za-z0-9#.,+\-\s]+$/;

export function sanitizedTablerSvg(iconId: string) {
  if (!/^[a-z0-9-]{1,80}$/.test(iconId)) throw new Error("Tabler icon ID tidak valid.");
  const nodes = tablerNodes[iconId];
  if (!nodes || !existsSync(path.join(tablerRoot, "icons/outline", `${iconId}.svg`))) throw new Error("Ikon Tabler tidak ditemukan di pack lokal.");
  const parts = nodes.map(([tag, attributes]) => {
    if (!svgTags.has(tag)) throw new Error("Elemen SVG ikon tidak didukung.");
    const attrs = Object.entries(attributes).map(([name, value]) => {
      if (!svgAttributes.has(name) || typeof value !== "string" && typeof value !== "number") throw new Error("Atribut SVG ikon tidak didukung.");
      const text = String(value);
      if (text.length > 4096 || !svgValuePattern.test(text) || /url\s*\(|javascript:|data:/i.test(text)) throw new Error("Konten SVG ikon tidak aman.");
      return `${name}="${text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")}"`;
    }).join(" ");
    return `<${tag}${attrs ? ` ${attrs}` : ""}/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${parts}</svg>`;
}

export function upsertVisualAssetCatalog(db: DatabaseSync, asset: VisualAsset, availableLocal = true) {
  db.prepare(`INSERT INTO visual_asset_catalog (asset_id, metadata_json, asset_type, category, source, provider, style, format, license, available_local, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(asset_id) DO UPDATE SET metadata_json = excluded.metadata_json, asset_type = excluded.asset_type, category = excluded.category, source = excluded.source, provider = excluded.provider, style = excluded.style, format = excluded.format, license = excluded.license, available_local = excluded.available_local`)
    .run(asset.id, JSON.stringify(asset), asset.assetType, asset.visualCategory, asset.source, asset.provider ?? "", asset.style, asset.format, asset.license, Number(availableLocal), asset.createdAt);
  db.prepare("DELETE FROM visual_asset_catalog_fts WHERE asset_id = ?").run(asset.id);
  db.prepare("INSERT INTO visual_asset_catalog_fts (asset_id, name, tags, concepts, creator) VALUES (?, ?, ?, ?, ?)")
    .run(asset.id, asset.name, asset.semanticTags.join(" "), asset.supportedConcepts.join(" "), asset.creator ?? "");
}

export function backfillVisualAssetCatalog(db: DatabaseSync, assetPath: (asset: VisualAsset) => string) {
  const rows = db.prepare("SELECT data_json FROM projects").all() as Array<{ data_json: string }>;
  for (const row of rows) {
    try {
      const stored = JSON.parse(row.data_json) as { visualAssets?: unknown[] };
      for (const candidate of stored.visualAssets ?? []) {
        const parsed = visualAssetSchema.safeParse(candidate);
        if (parsed.success) upsertVisualAssetCatalog(db, parsed.data, existsSync(assetPath(parsed.data)));
      }
    } catch { /* keep malformed legacy rows out of search index */ }
  }
}

const allowedLicenses = new Set<string>(openverseLicenseIds);
const openverseBaseUrl = "https://api.openverse.org/v1";
const openverseCache = new Map<string, { expiresAt: number; value: unknown }>();
let openverseLastRequest = 0;
let openverseRequestQueue = Promise.resolve();
let openverseDownloadQueue = Promise.resolve();
const maxExternalBytes = 10 * 1024 * 1024;
const blockedNetworks = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedNetworks.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blockedNetworks.addSubnet(network, prefix, "ipv6");

type HttpsResult = { status: number; headers: import("node:http").IncomingHttpHeaders; body: Buffer };

export function isPublicInternetAddress(address: string) {
  const ip = address.toLowerCase().split("%")[0]!;
  if (isIP(ip) === 4) {
    return !blockedNetworks.check(ip, "ipv4");
  }
  if (isIP(ip) === 6) {
    if (ip.startsWith("::ffff:")) return isPublicInternetAddress(ip.slice(7));
    return /^[23]/.test(ip) && !blockedNetworks.check(ip, "ipv6");
  }
  return false;
}

async function publicHttpsGet(input: string, maxBytes: number, timeoutMs: number): Promise<HttpsResult> {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") throw new Error("Sumber eksternal harus HTTPS publik pada port standar.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || isIP(host)) throw new Error("Host eksternal tidak diizinkan.");
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicInternetAddress(address))) throw new Error("Host eksternal mengarah ke alamat nonpublik; request diblokir.");
    const address = addresses[0]!;
  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: HttpsResult) => {
      if (settled) return;
      settled = true;
      error ? reject(error) : resolve(result!);
    };
    const req = https.request(url, {
      method: "GET",
      headers: { "user-agent": "AI-Facts-Studio/1.0 (Openverse asset search; local import)", accept: "application/json,image/png,image/jpeg,image/webp" },
      servername: host,
      autoSelectFamily: true,
      autoSelectFamilyAttemptTimeout: 300,
      lookup: (_hostname, options, callback) => options.all
        ? callback(null, addresses)
        : callback(null, address.address, address.family),
    } as https.RequestOptions & { autoSelectFamily: boolean; autoSelectFamilyAttemptTimeout: number }, (res) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) { req.destroy(new Error("Response eksternal melewati batas ukuran.")); return; }
        chunks.push(chunk);
      });
      res.on("end", () => finish(undefined, { status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", (error) => finish(error));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("Request eksternal timeout.")));
    req.on("error", (error) => finish(error));
    req.end();
  });
}

async function openverseGet(url: string, maxBytes = 2 * 1024 * 1024) {
  const execute = async () => {
    const wait = Math.max(0, 1000 - (Date.now() - openverseLastRequest));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    openverseLastRequest = Date.now();
    const result = await publicHttpsGet(url, maxBytes, 12_000);
    if (result.status < 200 || result.status >= 300) throw new Error(`Openverse merespons HTTP ${result.status}.`);
    return JSON.parse(result.body.toString("utf8")) as Record<string, unknown>;
  };
  const operation = openverseRequestQueue.then(execute, execute);
  openverseRequestQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function secureOpenverseUrl(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") return "";
    const result = url.toString();
    return result.length <= 2000 ? result : "";
  } catch { return ""; }
}

function normalizeOpenverseResult(value: Record<string, unknown>): OpenverseImage | null {
  const license = typeof value.license === "string" ? value.license.toLowerCase() : "";
  const licenseVersion = typeof value.license_version === "string" ? value.license_version.trim() : "";
  const thumbnail = secureOpenverseUrl(value.thumbnail);
  const url = secureOpenverseUrl(value.url);
  const landingUrl = secureOpenverseUrl(value.foreign_landing_url);
  const allowedVersion = ["1.0", "2.0", "2.5", "3.0", "4.0"].includes(licenseVersion);
  const licenseUrl = license === "cc0" ? "https://creativecommons.org/publicdomain/zero/1.0/"
    : license === "pdm" ? "https://creativecommons.org/publicdomain/mark/1.0/"
      : ["by", "by-sa"].includes(license) && allowedVersion ? `https://creativecommons.org/licenses/${license}/${licenseVersion}/` : "";
  if (!allowedLicenses.has(license) || !thumbnail || !url || !landingUrl || !licenseUrl || value.category !== "illustration") return null;
  const numeric = (input: unknown) => Number.isFinite(Number(input)) ? Number(input) : 0;
  const text = (input: unknown, fallback = "") => typeof input === "string" ? input.slice(0, 1000) : fallback;
  return {
    id: text(value.id, "").slice(0, 100), title: text(value.title, "Untitled illustration"), thumbnail, url, landingUrl,
    creator: text(value.creator, "Creator not listed"), creatorUrl: secureOpenverseUrl(value.creator_url),
    license, licenseVersion: license === "cc0" || license === "pdm" ? "1.0" : licenseVersion, licenseUrl, attribution: text(value.attribution),
    provider: text(value.provider).slice(0, 120), source: text(value.source).slice(0, 120), category: "illustration", width: numeric(value.width), height: numeric(value.height),
    filetype: text(value.filetype).toLowerCase(), filesize: value.filesize == null ? null : numeric(value.filesize),
  };
}

export async function searchOpenverse(query: string, license: string, page: number, pageSize: number) {
  const normalizedQuery = query.trim().slice(0, 200);
  if (!normalizedQuery) throw new Error("Masukkan kata kunci sebelum mencari Openverse.");
  const licenses = license.split(",").filter((item) => allowedLicenses.has(item));
  if (!licenses.length) throw new Error("Pilih lisensi publikasi yang diizinkan.");
  const params = new URLSearchParams({ q: normalizedQuery, category: "illustration", license: licenses.join(","), extension: "jpg,png,webp", page: String(page), page_size: String(pageSize), filter_dead: "true", mature: "false" });
  const key = params.toString();
  const cached = openverseCache.get(key);
  let value: { results: OpenverseImage[]; resultCount: number; pageCount: number; page: number; pageSize: number; licenseIds: string[] };
  if (cached && cached.expiresAt > Date.now()) value = cached.value as typeof value;
  else {
    const payload = await openverseGet(`${openverseBaseUrl}/images/?${key}`);
    const rawResults = Array.isArray(payload.results) ? payload.results as Array<Record<string, unknown>> : [];
    value = {
      results: rawResults.map(normalizeOpenverseResult).filter((item): item is OpenverseImage => item !== null),
      resultCount: Number(payload.result_count ?? 0), pageCount: Number(payload.page_count ?? 0), page: Number(payload.page ?? page), pageSize: Number(payload.page_size ?? pageSize),
      licenseIds: licenses,
    };
    openverseCache.set(key, { expiresAt: Date.now() + 120_000, value });
    while (openverseCache.size > 80) openverseCache.delete(openverseCache.keys().next().value!);
  }
  return { ...value, results: value.results.map((image) => ({ ...image, thumbnail: `/api/openverse/thumbnail?url=${encodeURIComponent(image.thumbnail)}` })) };
}

export function openverseThumbnailIsCached(url: string) {
  return [...openverseCache.values()].some(({ expiresAt, value }) => expiresAt > Date.now()
    && ((value as { results?: OpenverseImage[] }).results ?? []).some((image) => image.thumbnail === url));
}

export function openverseResultIsCached(imageId: string) {
  return [...openverseCache.values()].some(({ expiresAt, value }) => expiresAt > Date.now()
    && ((value as { results?: OpenverseImage[] }).results ?? []).some((image) => image.id === imageId));
}

export async function fetchOpenverseThumbnail(url: string) {
  if (!openverseThumbnailIsCached(url)) throw new Error("Thumbnail bukan bagian dari hasil Openverse aktif.");
  let current = url;
  let response: HttpsResult | undefined;
  for (let redirect = 0; redirect <= 3; redirect++) {
    response = await publicHttpsGet(current, 2 * 1024 * 1024, 12_000);
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.location;
    if (!location || redirect === 3) throw new Error("Redirect thumbnail Openverse tidak valid atau terlalu banyak.");
    current = new URL(location, current).toString();
  }
  if (!response || response.status < 200 || response.status >= 300) throw new Error(`Thumbnail Openverse merespons HTTP ${response?.status ?? 0}.`);
  const mimeType = String(response.headers["content-type"] ?? "").split(";")[0]!.toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) throw new Error("Thumbnail harus raster; SVG ditolak.");
  const image = inspectRasterImage(response.body);
  if (mimeType !== `image/${image.format}`) throw new Error("MIME thumbnail tidak cocok dengan signature.");
  return { buffer: response.body, mimeType };
}

async function downloadOpenverseImageNow(imageId: string) {
  if (!/^[a-z0-9-]{8,100}$/i.test(imageId)) throw new Error("Openverse image ID tidak valid.");
  if (!openverseResultIsCached(imageId)) throw new Error("Pilih ulang gambar dari hasil pencarian Openverse yang masih aktif.");
  const detail = await openverseGet(`${openverseBaseUrl}/images/${encodeURIComponent(imageId)}/`);
  const image = normalizeOpenverseResult(detail);
  if (!image) throw new Error("Lisensi atau kategori hasil Openverse tidak memenuhi kebijakan import.");
  if (image.filesize !== null && image.filesize > maxExternalBytes) throw new Error("Openverse image metadata melebihi batas 10 MB.");
  let current = image.url;
  let response: HttpsResult | undefined;
  for (let redirect = 0; redirect <= 3; redirect++) {
    response = await publicHttpsGet(current, maxExternalBytes, 15_000);
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.location;
    if (!location || redirect === 3) throw new Error("Redirect gambar Openverse tidak valid atau terlalu banyak.");
    current = new URL(location, current).toString();
  }
  if (!response || response.status < 200 || response.status >= 300) throw new Error(`Unduh gambar Openverse gagal: HTTP ${response?.status ?? 0}.`);
  const contentType = String(response.headers["content-type"] ?? "").split(";")[0]!.toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) throw new Error("Openverse result bukan JPEG, PNG, atau WebP yang didukung; SVG ditolak.");
  return { image, buffer: response.body, mimeType: contentType, sha256: createHash("sha256").update(response.body).digest("hex") };
}

export function downloadOpenverseImage(imageId: string) {
  const operation = openverseDownloadQueue.then(() => downloadOpenverseImageNow(imageId), () => downloadOpenverseImageNow(imageId));
  openverseDownloadQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
