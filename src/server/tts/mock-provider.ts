import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SpeechProvider, SpeechRequest, SpeechVoice } from "./provider";

const execFileAsync = promisify(execFile);

export class MockSpeechProvider implements SpeechProvider {
  readonly id = "mock-gemini";
  readonly displayName = "Mock Gemini (test only)";
  readonly model = "test-tone";
  readonly freeTierOnly = true;
  readonly configured = true;
  readonly voices: SpeechVoice[] = [
    { id: "Kore", name: "Kore (mock)", locale: "id-ID", localeName: "Bahasa Indonesia", gender: "Female", description: "Bright mock voice", wordsPerMinute: 150, availability: "api" },
    { id: "Puck", name: "Puck (mock)", locale: "id-ID", localeName: "Bahasa Indonesia", gender: "Male", description: "Upbeat mock voice", wordsPerMinute: 145, availability: "api" },
    { id: "Puck", name: "Puck (mock)", locale: "en-US", localeName: "English (United States)", gender: "Male", description: "Upbeat mock voice", wordsPerMinute: 145, availability: "api" },
  ];

  async listVoices(locale?: string) {
    const voices = locale ? this.voices.filter((voice) => voice.locale === locale) : this.voices;
    return { voices, locales: [{ locale: "id-ID", localeName: "Bahasa Indonesia" }, { locale: "en-US", localeName: "English (United States)" }], source: "api" as const };
  }

  async synthesize(_request: SpeechRequest) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "facts-tts-mock-"));
    const output = path.join(tempDir, "tone.wav");
    try {
      await execFileAsync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:a", "pcm_s16le", output]);
      return { data: await readFile(output), mimeType: "audio/wav" };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
