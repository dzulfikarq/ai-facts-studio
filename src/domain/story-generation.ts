import { z } from "zod";
import { animationStyleIdSchema } from "./animation-styles";
import {
  storySeriesCharacterSchema,
  storySeriesLocationSchema,
  storySeriesPropSchema,
  storySeriesSchema,
  storySeriesSceneSchema,
  type StorySeries,
} from "./story-series";

const text = (max: number) => z.string().trim().min(1).max(max);
const language = z.string().regex(/^[a-z]{2}-[A-Z]{2}$/);

// Keep storyText untrimmed: it is the durable source, not AI input to normalize.
export const storySourceSchema = z.object({
  title: text(160),
  storyText: z.string().min(1).max(100_000).refine((value) => value.trim().length > 0, "Isi cerita tidak boleh kosong."),
  language,
  targetDurationSeconds: z.number().int().min(30).max(120),
  dailyCreditsAvailable: z.number().int().positive().max(1_000_000),
  animationStyleId: animationStyleIdSchema,
  additionalInstructions: z.string().max(4000),
  sourceUrl: z.union([z.literal(""), z.string().url().max(2000)]),
  rightsNotes: z.string().max(4000),
}).strict().superRefine((source, ctx) => {
  if (source.animationStyleId === "stylized-3d-cartoon") ctx.addIssue({ code: "custom", message: "Generate from Story mengunci produksi ke gaya 2D; preset 3D tidak tersedia.", path: ["animationStyleId"] });
});

export const storyEpisodePlanSchema = z.object({
  episodeNumber: z.number().int().positive().max(20),
  title: text(160),
  synopsis: text(3000),
  conflict: text(2000),
  openingHook: text(1200),
  endingCliffhanger: text(1500),
  estimatedDurationSeconds: z.number().int().positive().max(120),
  estimatedScenes: z.number().int().positive().max(8),
  estimatedFlowClips: z.number().int().positive().max(30),
  estimatedCredits: z.number().int().nonnegative().max(300),
  resolvesMainConflict: z.boolean(),
  manualEditRequired: z.boolean().default(false),
}).strict().superRefine((episode, ctx) => {
  const expectedClips = Math.ceil(episode.estimatedDurationSeconds / 8);
  if (episode.estimatedFlowClips !== expectedClips) ctx.addIssue({ code: "custom", message: "Estimasi klip harus sama dengan durasi dibagi 8 detik, dibulatkan ke atas.", path: ["estimatedFlowClips"] });
  if (episode.estimatedCredits !== expectedClips * 10) ctx.addIssue({ code: "custom", message: "Estimasi kredit harus sama dengan 10 kredit per klip.", path: ["estimatedCredits"] });
  if (episode.estimatedScenes !== Math.min(8, expectedClips)) ctx.addIssue({ code: "custom", message: "Jumlah scene harus mencerminkan klip yang dapat dibuat, maksimal 8.", path: ["estimatedScenes"] });
});

export const storyEpisodePlanListSchema = z.array(storyEpisodePlanSchema).min(1).max(20).superRefine((episodes, ctx) => {
  episodes.forEach((episode, index) => {
    if (episode.episodeNumber !== index + 1) ctx.addIssue({ code: "custom", message: "Nomor episode harus berurutan mulai dari satu.", path: [index, "episodeNumber"] });
  });
});

export const storyEpisodePlanApprovalSchema = storyEpisodePlanListSchema.superRefine((episodes, ctx) => {
  episodes.forEach((episode, index) => {
    if (episode.manualEditRequired) ctx.addIssue({ code: "custom", message: "Episode hasil split/tambah perlu dilengkapi sebelum disetujui.", path: [index, "manualEditRequired"] });
  });
  if (episodes.length && !episodes.at(-1)?.resolvesMainConflict) ctx.addIssue({ code: "custom", message: "Episode terakhir harus menyelesaikan konflik utama dengan memadai.", path: [episodes.length - 1, "resolvesMainConflict"] });
});

export const storyAnalysisSchema = z.object({
  schemaVersion: z.literal("story-analysis.v1"),
  summary: text(5000),
  structure: z.object({ beginning: text(3000), middle: text(3000), ending: text(3000) }).strict(),
  mainConflict: text(3000),
  conflictDevelopment: text(4000),
  characters: z.array(z.object({ name: text(120), role: text(200), description: text(1200) }).strict()).max(40),
  locations: z.array(z.object({ name: text(120), description: text(1200) }).strict()).max(40),
  keyEvents: z.array(text(1500)).max(60),
  tensionPoints: z.array(text(1500)).max(40),
  potentialHooks: z.array(text(1200)).max(30),
  estimatedStoryDurationSeconds: z.number().int().positive().max(7200),
  recommendedEpisodeCount: z.number().int().positive().max(20),
  recommendationReason: text(3000),
  episodes: storyEpisodePlanApprovalSchema,
  warnings: z.array(text(1500)).max(30),
}).strict().superRefine((analysis, ctx) => {
  if (analysis.recommendedEpisodeCount !== analysis.episodes.length) ctx.addIssue({ code: "custom", message: "Jumlah episode rekomendasi harus sama dengan rencana awal.", path: ["episodes"] });
});

export const storyBibleContentSchema = z.object({
  logline: text(1000),
  synopsis: text(6000),
  genre: z.array(text(60)).min(1).max(12),
  setting: text(3000),
  centralMystery: text(3000),
  hiddenTruth: text(10000),
  worldRules: z.array(text(1500)).max(40),
  timeline: z.array(z.object({ date: text(120), event: text(2000) }).strict()).max(100),
  continuityRules: z.array(text(1500)).max(60),
  visualStyle: z.object({ description: text(2000), colorPalette: z.array(text(300)).min(1).max(20), consistencyRules: z.array(text(1000)).max(30) }).strict(),
  characters: z.array(storySeriesCharacterSchema).max(40),
  locations: z.array(storySeriesLocationSchema).max(40),
  props: z.array(storySeriesPropSchema).max(80),
  adaptationNotes: z.array(text(1500)).max(30),
}).strict();

export const storyBibleDraftSchema = z.object({
  schemaVersion: z.literal("story-bible.v1"),
  series: storySeriesSchema,
  adaptationNotes: z.array(text(1500)).max(30),
}).strict();

export const storyEpisodeGenerationOutputSchema = z.object({
  scenes: z.array(storySeriesSceneSchema.extend({ durationSeconds: z.number().positive().max(8) })).min(1).max(8),
  continuityHandoff: z.object({
    revealedFacts: z.array(text(1500)).max(40),
    unresolvedMysteries: z.array(text(1500)).max(40),
    characterStates: z.array(z.object({ characterId: z.string().max(80), state: text(1500) }).strict()).max(40),
    nextEpisodeSetup: text(3000),
  }).strict(),
  adaptationNotes: z.array(text(1500)).max(30),
}).strict();

export type StorySource = z.infer<typeof storySourceSchema>;
export type StoryEpisodePlan = z.infer<typeof storyEpisodePlanSchema>;
export type StoryAnalysis = z.infer<typeof storyAnalysisSchema>;
export type StoryBibleContent = z.infer<typeof storyBibleContentSchema>;
export type StoryBibleDraft = z.infer<typeof storyBibleDraftSchema>;
export type StoryEpisodeGenerationOutput = z.infer<typeof storyEpisodeGenerationOutputSchema>;

export function buildStoryBibleDraft(source: StorySource, episodes: StoryEpisodePlan[], content: StoryBibleContent, draftId: string): StoryBibleDraft {
  const slug = `${source.title.toLocaleLowerCase("en-US").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "story"}-${draftId.replace(/[^a-f0-9]/gi, "").slice(0, 8).toLowerCase()}`;
  const series: StorySeries = storySeriesSchema.parse({
    slug,
    title: source.title,
    genre: content.genre,
    language: source.language,
    logline: content.logline,
    synopsis: content.synopsis,
    plannedEpisodeCount: episodes.length,
    visualStyle: {
      presetId: source.animationStyleId,
      description: content.visualStyle.description,
      aspectRatio: "9:16",
      colorPalette: content.visualStyle.colorPalette,
      consistencyRules: content.visualStyle.consistencyRules,
    },
    storyBible: {
      setting: content.setting,
      centralMystery: content.centralMystery,
      hiddenTruth: content.hiddenTruth,
      worldRules: content.worldRules,
      timeline: content.timeline,
      continuityRules: content.continuityRules,
      episodeOutlines: episodes.map((episode) => ({
        episodeNumber: episode.episodeNumber,
        title: episode.title,
        summary: episode.synopsis,
        endingHook: episode.endingCliffhanger,
      })),
    },
    characters: content.characters,
    locations: content.locations,
    props: content.props,
  });
  return storyBibleDraftSchema.parse({ schemaVersion: "story-bible.v1", series, adaptationNotes: content.adaptationNotes });
}

export function storyFlowBudget(durationSeconds: number, dailyCreditsAvailable = 100) {
  const plannedClips = Math.ceil(durationSeconds / 8);
  const estimatedCredits = plannedClips * 10;
  return {
    creditsPerClip: 10,
    dailyCreditsAvailable,
    plannedClips,
    estimatedCredits,
    reserveCredits: dailyCreditsAvailable - estimatedCredits,
    withinEightClipLimit: plannedClips <= 8,
    withinDailyBudget: estimatedCredits <= dailyCreditsAvailable,
  };
}
