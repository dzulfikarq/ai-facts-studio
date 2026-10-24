import { z } from "zod";

export const captionSegmentSchema = z.object({
  text: z.string().trim().min(1).max(240),
  startProgress: z.number().min(0).max(1),
  endProgress: z.number().min(0).max(1),
  emphasis: z.array(z.string().trim().min(1).max(40)).max(5).default([]),
}).strict().superRefine((segment, ctx) => {
  if (segment.endProgress <= segment.startProgress) ctx.addIssue({ code: "custom", message: "endProgress harus lebih besar daripada startProgress", path: ["endProgress"] });
  for (const word of segment.emphasis) {
    if (!segment.text.toLocaleLowerCase().includes(word.toLocaleLowerCase())) ctx.addIssue({ code: "custom", message: `Emphasis '${word}' harus muncul di teks segmen`, path: ["emphasis"] });
  }
});

export const captionSegmentsSchema = z.array(captionSegmentSchema).min(1).max(30).superRefine((segments, ctx) => {
  if (segments[0]?.startProgress !== 0) ctx.addIssue({ code: "custom", message: "Segmen caption pertama harus mulai dari 0", path: [0, "startProgress"] });
  if (segments.at(-1)?.endProgress !== 1) ctx.addIssue({ code: "custom", message: "Segmen caption terakhir harus berakhir di 1", path: [segments.length - 1, "endProgress"] });
  segments.forEach((segment, index) => {
    if (index && Math.abs(segment.startProgress - segments[index - 1]!.endProgress) > 0.001) {
      ctx.addIssue({ code: "custom", message: "Caption segments harus berurutan tanpa gap/overlap", path: [index, "startProgress"] });
    }
  });
});

export type CaptionSegment = z.infer<typeof captionSegmentSchema>;

export function createCaptionSegments(text: string, emphasisSource = ""): CaptionSegment[] {
  const words = text.trim().split(/\s+/).filter(Boolean).flatMap((word) => {
    const chars = [...word];
    return chars.length <= 48 ? [word] : Array.from({ length: Math.ceil(chars.length / 48) }, (_, index) => chars.slice(index * 48, (index + 1) * 48).join(""));
  });
  if (!words.length) return [];
  const clauses: string[] = [];
  let phrase: string[] = [];
  for (const word of words) {
    const candidate = [...phrase, word];
    const hardStop = /[.!?;,:—–]$/.test(word);
    if (phrase.length && (candidate.length > 6 || candidate.join(" ").length > 48)) {
      clauses.push(phrase.join(" "));
      phrase = [word];
    } else phrase = candidate;
    if (hardStop && phrase.length) { clauses.push(phrase.join(" ")); phrase = []; }
  }
  if (phrase.length) clauses.push(phrase.join(" "));

  const phrases: string[] = [];
  for (const clause of clauses) {
    const previous = phrases.at(-1);
    if (previous && `${previous} ${clause}`.length <= 72) phrases[phrases.length - 1] = `${previous} ${clause}`;
    else phrases.push(clause);
  }
  const danglingWords = new Set(["dan", "atau", "karena", "yang", "untuk", "dengan", "dari", "agar"]);
  for (let index = 0; index < phrases.length - 1; index++) {
    const words = phrases[index]!.split(/\s+/);
    const last = words.at(-1)!;
    if (danglingWords.has(last.toLocaleLowerCase()) && words.length > 1) {
      phrases[index] = words.slice(0, -1).join(" ");
      phrases[index + 1] = `${last} ${phrases[index + 1]}`;
    }
  }

  const titleTerms = new Set((emphasisSource.match(/[\p{L}\p{N}]+/gu) ?? []).map((word) => word.toLocaleLowerCase()).filter((word) => word.length > 3));
  const weights = phrases.map((part) => (part.match(/[\p{L}\p{N}]+/gu)?.length ?? 1) + ((part.match(/[.!?]/g)?.length ?? 0) * 0.35) + ((part.match(/[,;:]/g)?.length ?? 0) * 0.15));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = 0;
  return phrases.map((part, index) => {
    const startProgress = cursor;
    const endProgress = index === phrases.length - 1 ? 1 : Math.round((cursor + weights[index]! / total) * 1000) / 1000;
    cursor = endProgress;
    const emphasis = [...new Set((part.match(/[\p{L}\p{N}]+/gu) ?? []).map((word) => word.toLocaleLowerCase()).filter((word) => titleTerms.has(word)))].slice(0, 5);
    return { text: part, startProgress, endProgress, emphasis };
  });
}

export function captionSegmentsForScene(scene: { narrationText: string; onScreenText: string; captionSegments?: CaptionSegment[] }) {
  return scene.captionSegments?.length ? scene.captionSegments : createCaptionSegments(scene.narrationText, scene.onScreenText);
}
