import type { AiImageProvider } from "./provider";

export const DEFAULT_HF_IMAGE_MODEL = "stabilityai/stable-diffusion-3-medium-diffusers";
export const HF_IMAGE_RESOLUTIONS = ["576x1024", "720x1280"] as const;
const modelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const maxImageBytes = 10 * 1024 * 1024;

export type HuggingFaceImageModel = { id: string; license: string | null };
export type HuggingFaceImageErrorCode = "ai-image-not-configured" | "ai-image-model-unavailable" | "ai-image-rate-limited" | "ai-image-quota-exhausted" | "ai-image-provider-failed";

export class HuggingFaceImageError extends Error {
  constructor(message: string, readonly code: HuggingFaceImageErrorCode, readonly retryAfterMs?: number) {
    super(message);
    this.name = "HuggingFaceImageError";
  }
}

export function huggingFaceImageConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const token = env.HF_TOKEN?.trim() ?? "";
  const enabled = env.HF_IMAGE_GENERATION_ENABLED === "true";
  const allowPaid = env.HF_IMAGE_ALLOW_PAID === "true";
  return {
    token,
    enabled,
    allowPaid,
    model: env.HF_IMAGE_MODEL?.trim() || DEFAULT_HF_IMAGE_MODEL,
    configured: Boolean(token && enabled && allowPaid),
  };
}

export function parseHuggingFaceImageModels(value: unknown): HuggingFaceImageModel[] {
  if (!Array.isArray(value)) return [];
  const models = new Map<string, HuggingFaceImageModel>();
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const model = row as { id?: unknown; tags?: unknown; inferenceProviderMapping?: unknown };
    if (typeof model.id !== "string" || model.id.length > 120 || !modelIdPattern.test(model.id)) continue;
    const rawMapping = model.inferenceProviderMapping;
    const mappings = Array.isArray(rawMapping) ? rawMapping : rawMapping && typeof rawMapping === "object"
      ? Object.entries(rawMapping).map(([provider, mapping]) => ({ provider, ...(mapping as object) })) : [];
    const available = mappings.some((item) => {
      if (!item || typeof item !== "object") return false;
      const mapping = item as { provider?: unknown; status?: unknown; task?: unknown };
      return mapping.provider === "hf-inference" && mapping.status === "live" && mapping.task === "text-to-image";
    });
    if (!available) continue;
    const tags = Array.isArray(model.tags) ? model.tags : [];
    const licenseTag = tags.find((tag): tag is string => typeof tag === "string" && tag.startsWith("license:"));
    models.set(model.id, { id: model.id, license: licenseTag?.slice("license:".length, "license:".length + 80) ?? null });
  }
  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function discoverHuggingFaceImageModels(fetcher: typeof fetch = fetch): Promise<HuggingFaceImageModel[]> {
  let response: Response;
  try {
    response = await fetcher("https://huggingface.co/api/models?inference_provider=hf-inference&pipeline_tag=text-to-image&limit=100&expand%5B%5D=inferenceProviderMapping", {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new HuggingFaceImageError(`Katalog Hugging Face tidak dapat diperiksa: ${error instanceof Error ? error.message : "network error"}`, "ai-image-provider-failed");
  }
  if (!response.ok) throw new HuggingFaceImageError(`Katalog Hugging Face gagal (${response.status}).`, "ai-image-provider-failed");
  try { return parseHuggingFaceImageModels(await response.json()); }
  catch { throw new HuggingFaceImageError("Respons katalog Hugging Face tidak valid.", "ai-image-provider-failed"); }
}

function dimensions(resolution: string) {
  if (!(HF_IMAGE_RESOLUTIONS as readonly string[]).includes(resolution)) throw new HuggingFaceImageError("Resolusi AI Image tidak didukung.", "ai-image-provider-failed");
  const [width, height] = resolution.split("x").map(Number);
  return { width: width!, height: height! };
}

async function readImageBody(response: Response) {
  if (!response.body) throw new HuggingFaceImageError("Provider tidak mengembalikan image body.", "ai-image-provider-failed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxImageBytes) {
        await reader.cancel();
        throw new HuggingFaceImageError("Hasil AI Image melebihi batas 10 MB.", "ai-image-provider-failed");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new HuggingFaceImageError("Provider mengembalikan gambar kosong.", "ai-image-provider-failed");
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size);
}

export class HuggingFaceInferenceImageProvider implements AiImageProvider {
  readonly id = "huggingface-inference";
  readonly displayName = "Hugging Face Inference Providers · hf-inference";

  constructor(private readonly token: string, private readonly fetcher: typeof fetch = fetch) {}

  async generate(request: Parameters<AiImageProvider["generate"]>[0]) {
    if (request.userConfirmed !== true || request.costAcknowledged !== true) {
      throw new HuggingFaceImageError("Generate memerlukan konfirmasi biaya per gambar.", "ai-image-not-configured");
    }
    if (!this.token) throw new HuggingFaceImageError("HF_TOKEN belum dikonfigurasi.", "ai-image-not-configured");
    if (!modelIdPattern.test(request.model)) throw new HuggingFaceImageError("Model Hugging Face tidak valid.", "ai-image-model-unavailable");
    const { width, height } = dimensions(request.resolution);
    const modelPath = request.model.split("/").map(encodeURIComponent).join("/");
    let response: Response;
    try {
      const signal = request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000);
      response = await this.fetcher(`https://router.huggingface.co/hf-inference/models/${modelPath}`, {
        method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", Accept: "image/png,image/jpeg,image/webp" },
        body: JSON.stringify({ inputs: request.prompt, parameters: { width, height } }), signal,
      });
    } catch (error) {
      if (error instanceof HuggingFaceImageError) throw error;
      throw new HuggingFaceImageError(`Koneksi Hugging Face gagal: ${error instanceof Error ? error.message : "network error"}`, "ai-image-provider-failed");
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).replaceAll(this.token, "[redacted]").slice(0, 1000);
      const retryHeader = Number(response.headers.get("retry-after"));
      const retryAfterMs = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader * 1000 : undefined;
      if (response.status === 429) throw new HuggingFaceImageError("Hugging Face membatasi request. Tunggu sebelum mencoba lagi.", "ai-image-rate-limited", retryAfterMs);
      if (response.status === 402 || /quota|credit|billing|insufficient balance/i.test(detail)) {
        throw new HuggingFaceImageError("Hugging Face melaporkan kuota/kredit tidak tersedia. Periksa akun dan billing secara manual.", "ai-image-quota-exhausted");
      }
      if (response.status === 404) throw new HuggingFaceImageError("Model tidak lagi tersedia pada hf-inference.", "ai-image-model-unavailable");
      throw new HuggingFaceImageError(`Hugging Face generation gagal (${response.status})${detail ? `: ${detail}` : ""}`, "ai-image-provider-failed");
    }
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (mimeType !== "image/png" && mimeType !== "image/jpeg" && mimeType !== "image/webp") {
      throw new HuggingFaceImageError("Hugging Face tidak mengembalikan PNG, JPEG, atau WebP.", "ai-image-provider-failed");
    }
    const usageMetadata = Object.fromEntries(["x-compute-type", "x-compute-time", "x-rate-limit-limit", "x-rate-limit-remaining", "x-rate-limit-reset", "x-request-id"]
      .flatMap((name) => { const value = response.headers.get(name); return value ? [[name, value.slice(0, 160)]] : []; }));
    return { bytes: await readImageBody(response), mimeType: mimeType as "image/png" | "image/jpeg" | "image/webp", ...(Object.keys(usageMetadata).length ? { usageMetadata } : {}) };
  }
}
