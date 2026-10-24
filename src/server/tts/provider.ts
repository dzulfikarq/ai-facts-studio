import { createHash } from "node:crypto";

export type SpeechVoice = {
  id: string;
  name: string;
  locale: string;
  localeName: string;
  gender: string;
  description: string;
  wordsPerMinute: number;
  availability: "api" | "fallback";
};

export type SpeechVoiceCatalog = {
  voices: SpeechVoice[];
  locales: Array<{ locale: string; localeName: string }>;
  source: "api" | "fallback";
  warning?: string;
};

export type SpeechRequest = {
  text: string;
  locale: string;
  voiceId: string;
  style: string;
  speakingRate: number;
};

export type SpeechAudio = { data: Buffer; mimeType: string };

export interface SpeechProvider {
  id: string;
  displayName: string;
  model: string;
  freeTierOnly: boolean;
  configured: boolean;
  disabledReason?: string;
  listVoices(locale?: string): Promise<SpeechVoiceCatalog>;
  synthesize(request: SpeechRequest): Promise<SpeechAudio>;
}

export class SpeechProviderError extends Error {
  constructor(message: string, public readonly code: string, public readonly httpStatus = 502) {
    super(message);
    this.name = "SpeechProviderError";
  }
}

export const FREE_TIER_TTS_MODELS = ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"] as const;
export const DEFAULT_TTS_MODEL = "gemini-3.8-flash-lite-tts";
export const GEMINI_TTS_LOCALES = [
  { locale: "id-ID", localeName: "Bahasa Indonesia" },
  { locale: "en-US", localeName: "English (United States)" },
  { locale: "en-GB", localeName: "English (United Kingdom)" },
  { locale: "es-ES", localeName: "Spanish" },
  { locale: "fr-FR", localeName: "French" },
  { locale: "de-DE", localeName: "German" },
  { locale: "ja-JP", localeName: "Japanese" },
  { locale: "ko-KR", localeName: "Korean" },
  { locale: "zh-CN", localeName: "Chinese (Simplified)" },
  { locale: "hi-IN", localeName: "Hindi" },
  { locale: "pt-BR", localeName: "Portuguese (Brazil)" },
  { locale: "it-IT", localeName: "Italian" },
  { locale: "ar-EG", localeName: "Arabic" },
  { locale: "vi-VN", localeName: "Vietnamese" },
  { locale: "th-TH", localeName: "Thai" },
  { locale: "ru-RU", localeName: "Russian" },
  { locale: "ms-MY", localeName: "Malay" },
  { locale: "jv-ID", localeName: "Javanese" },
];

export function ttsCacheKey(input: { provider: string; model: string; scriptSha256: string; locale: string; voiceId: string; style: string; speakingRate: number }) {
  return createHash("sha256").update(JSON.stringify({
    provider: input.provider,
    model: input.model,
    scriptSha256: input.scriptSha256,
    locale: input.locale,
    voiceId: input.voiceId,
    style: input.style,
    speakingRate: Number(input.speakingRate.toFixed(2)),
  })).digest("hex");
}

export async function createSpeechProvider(): Promise<SpeechProvider> {
  if (process.env.NODE_ENV === "test" && process.env.TTS_MOCK_PROVIDER === "1") {
    const { MockSpeechProvider } = await import("./mock-provider");
    return new MockSpeechProvider();
  }
  const { GeminiSpeechProvider } = await import("./gemini-provider");
  return new GeminiSpeechProvider();
}
