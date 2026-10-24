import { ApiError, GoogleGenAI } from "@google/genai";
import { DEFAULT_TTS_MODEL, FREE_TIER_TTS_MODELS, GEMINI_TTS_LOCALES, SpeechProviderError, type SpeechAudio, type SpeechProvider, type SpeechRequest, type SpeechVoice, type SpeechVoiceCatalog } from "./provider";

export type GeminiSdkClient = Pick<GoogleGenAI, "models" | "voices" | "interactions">;
export type GeminiClientFactory = (apiKey: string) => GeminiSdkClient;

const languageNames: Record<string, string> = {
  "id-ID": "Bahasa Indonesia", "en-US": "English (United States)", "en-GB": "English (United Kingdom)",
  "ja-JP": "Japanese", "es-ES": "Spanish", "fr-FR": "French",
};

const speakingStyles: Record<string, string> = {
  neutral: "clear, neutral, natural narration",
  warm: "warm and friendly narration",
  energetic: "bright and energetic narration",
  calm: "calm and soothing narration",
  documentary: "informative documentary narration",
};

const prebuiltVoiceTraits = [
  ["Zephyr", "Bright"], ["Puck", "Upbeat"], ["Charon", "Informative"], ["Kore", "Firm"], ["Fenrir", "Excitable"],
  ["Leda", "Youthful"], ["Orus", "Firm"], ["Aoede", "Breezy"], ["Callirrhoe", "Easy-going"], ["Autonoe", "Bright"],
  ["Enceladus", "Breathy"], ["Iapetus", "Clear"], ["Umbriel", "Easy-going"], ["Algieba", "Smooth"], ["Despina", "Smooth"],
  ["Erinome", "Clear"], ["Algenib", "Gravelly"], ["Rasalgethi", "Informative"], ["Laomedeia", "Upbeat"], ["Achernar", "Soft"],
  ["Alnilam", "Firm"], ["Schedar", "Even"], ["Gacrux", "Mature"], ["Pulcherrima", "Forward"], ["Achird", "Friendly"],
  ["Zubenelgenubi", "Casual"], ["Vindemiatrix", "Gentle"], ["Sadachbia", "Lively"], ["Sadaltager", "Knowledgeable"], ["Sulafat", "Warm"],
] as const;

function fallbackVoiceCatalog(reason: string): SpeechVoiceCatalog {
  return {
    voices: prebuiltVoiceTraits.map(([id, trait]) => ({
      id,
      name: id,
      locale: "multilingual",
      localeName: "Gemini prebuilt",
      gender: "Unknown",
      description: `${trait}; gender/locale availability not verified by live API`,
      wordsPerMinute: 150,
      availability: "fallback",
    })),
    locales: GEMINI_TTS_LOCALES,
    source: "fallback",
    warning: `Gemini voice catalog unavailable (${reason}). Official prebuilt voice names shown as fallback; availability for this project/locale is unverified.`,
  };
}

export class GeminiSpeechProvider implements SpeechProvider {
  readonly id = "gemini-developer-api";
  readonly displayName = "Google Gemini TTS Free Tier";
  readonly model: string;
  readonly freeTierOnly: boolean;
  readonly configured: boolean;
  readonly disabledReason?: string;
  private readonly ai: GeminiSdkClient | null;
  private modelCheckedAt = 0;
  private voiceCache: { expiresAt: number; catalog: SpeechVoiceCatalog } | null = null;

  constructor(options: {
    apiKey?: string;
    model?: string;
    freeTierOnly?: boolean;
    clientFactory?: GeminiClientFactory;
  } = {}) {
    const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY?.trim() ?? "";
    this.model = options.model ?? process.env.GEMINI_TTS_MODEL?.trim() ?? DEFAULT_TTS_MODEL;
    const freeTierOnly = options.freeTierOnly ?? process.env.GEMINI_TTS_FREE_TIER_ONLY === "true";
    this.freeTierOnly = freeTierOnly;
    const modelIsFreeAllowlisted = (FREE_TIER_TTS_MODELS as readonly string[]).includes(this.model);
    this.disabledReason = !apiKey
      ? "GEMINI_API_KEY belum dikonfigurasi."
      : !freeTierOnly
        ? "AI Voice terkunci. Pakai project Free Tier tanpa billing dan set GEMINI_TTS_FREE_TIER_ONLY=true."
        : !modelIsFreeAllowlisted
          ? "Model tidak ada di allowlist Gemini TTS Free Tier; tidak ada fallback model otomatis."
          : undefined;
    this.configured = this.disabledReason === undefined;
    const clientFactory = options.clientFactory ?? ((key: string) => new GoogleGenAI({ apiKey: key, enterprise: false, vertexai: false }));
    this.ai = this.configured ? clientFactory(apiKey) : null;
  }

  async listVoices(locale?: string): Promise<SpeechVoiceCatalog> {
    if (!this.configured) return fallbackVoiceCatalog(this.disabledReason ?? "Free Tier disabled");
    if (this.voiceCache && this.voiceCache.expiresAt > Date.now()) return this.voiceCache.catalog;
    try {
      await this.verifyModel();
      const response = await this.ai!.voices.list({ type: ["prebuilt"], page_size: 1000 });
      const voices = (response.voices ?? []).flatMap((voice): SpeechVoice[] => {
        if (!voice.id || voice.type !== "prebuilt") return [];
        const voiceLocale = voice.language_code ?? "multilingual";
        const gender = voice.gender?.toLowerCase() ?? "neutral";
        return [{
          id: voice.id,
          name: voice.display_name ?? voice.id,
          locale: voiceLocale,
          localeName: languageNames[voiceLocale] ?? voiceLocale,
          gender: gender === "female" ? "Female" : gender === "male" ? "Male" : "Neutral",
          description: voice.description ?? voice.persona ?? "Gemini prebuilt voice",
          // Gemini's prebuilt voice list doesn't publish WPM; used only to weight estimates before duration normalization.
          wordsPerMinute: 150,
          availability: "api",
        }];
      });
      if (!voices.length) return fallbackVoiceCatalog("catalog returned no prebuilt voices");
      const catalog: SpeechVoiceCatalog = { voices, locales: GEMINI_TTS_LOCALES, source: "api" };
      this.voiceCache = { catalog, expiresAt: Date.now() + 15 * 60 * 1000 };
      return catalog;
    } catch (error) {
      const mapped = error instanceof SpeechProviderError ? error : this.mapError(error);
      return fallbackVoiceCatalog(mapped.message);
    }
  }

  async synthesize(request: SpeechRequest): Promise<SpeechAudio> {
    this.assertConfigured();
    await this.verifyModel();
    const style = speakingStyles[request.style];
    if (!style) throw new SpeechProviderError("Gaya bicara tidak didukung.", "invalid-style", 400);
    const pace = request.speakingRate <= 0.8
      ? "speaking slowly"
      : request.speakingRate <= 0.95
        ? "speaking slightly slower than normal"
        : request.speakingRate < 1.05
          ? "speaking at a natural, steady pace"
          : request.speakingRate < 1.2
            ? "speaking slightly faster than normal"
            : "speaking briskly";
    try {
      const interaction = await this.ai!.interactions.create({
        model: this.model,
        input: [{
          type: "user_input",
          content: [{
            type: "text",
            text: request.text,
            annotations: [{ type: "speech_metadata", style: `${style}; ${request.locale}; ${pace}` }],
          }],
        }],
        response_format: { type: "audio" },
        generation_config: { speech_config: [{ voice: request.voiceId, language: request.locale }] },
      });
      if (!interaction.output_audio?.data) throw new SpeechProviderError("Gemini tidak mengembalikan audio.", "missing-audio");
      const data = Buffer.from(interaction.output_audio.data, "base64");
      if (!data.length || data.length > 25 * 1024 * 1024) throw new SpeechProviderError("Ukuran audio Gemini kosong atau melebihi 25 MB.", "invalid-audio", 502);
      return { data, mimeType: interaction.output_audio.mime_type ?? "audio/wav" };
    } catch (error) {
      if (error instanceof SpeechProviderError) throw error;
      throw this.mapError(error);
    }
  }

  private assertConfigured() {
    if (!this.configured) throw new SpeechProviderError(this.disabledReason ?? "Gemini TTS nonaktif.", "not-configured", 503);
  }

  private async verifyModel() {
    if (Date.now() - this.modelCheckedAt < 15 * 60 * 1000) return;
    try {
      await this.ai!.models.get({ model: this.model });
      this.modelCheckedAt = Date.now();
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private mapError(error: unknown) {
    if (!(error instanceof ApiError)) return new SpeechProviderError("Gemini API request gagal. Periksa koneksi lalu coba lagi.", "network");
    if (error.status === 429) return new SpeechProviderError("Gemini Free Tier quota/rate limit habis. Tunggu reset atau pakai upload manual; billing/model tidak diubah.", "free-tier-quota", 429);
    if (error.status === 404) return new SpeechProviderError(`Model ${this.model} tidak tersedia untuk project/key ini. Pilih model resmi Free Tier; tidak ada fallback.`, "model-unavailable", 503);
    if (error.status === 401 || error.status === 403) return new SpeechProviderError("Gemini key ditolak atau akses Free Tier tidak tersedia. Periksa key dan project tier.", "access-denied", 403);
    if (error.status === 400) return new SpeechProviderError("Gemini menolak voice, bahasa, atau format speech.", "invalid-request", 400);
    return new SpeechProviderError(`Gemini API gagal (HTTP ${error.status}).`, "provider-error", 502);
  }
}
