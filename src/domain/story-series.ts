import { z } from "zod";
import { animationStyleIdSchema } from "./animation-styles";
import { defaultMotionPlan, defaultVisualComposition } from "./visual-defaults";
import { parseResearchPackage, type ResearchPackage } from "./research";
import { buildVisualStoryboard, visualStoryboardSchema, type VisualStoryboard } from "./visual-storyboard";

const text = (max: number) => z.string().trim().min(1).max(max);
const assetId = z.string().regex(/^upload-[a-f0-9]{64}\.(png|jpg|webp)$/).optional();

const characterSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/), name: text(120), role: text(120),
  physicalDescription: text(2000), outfit: text(1200), distinguishingFeatures: z.array(text(500)).max(20),
  personality: text(1200), referenceImagePrompt: text(12000), continuityRules: z.array(text(1000)).max(30),
  referenceAssetId: assetId,
}).strict();
const locationSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/), name: text(120), description: text(2000), fixedLayout: text(2000),
  referenceImagePrompt: text(12000), continuityRules: z.array(text(1000)).max(30), referenceAssetId: assetId,
}).strict();
const propSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/), name: text(120), visualDescription: text(2000),
  referenceImagePrompt: text(12000), referenceAssetId: assetId,
}).strict();

const seriesSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80), title: text(120),
  genre: z.array(text(60)).min(1).max(12), language: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),
  logline: text(1000), synopsis: text(6000), plannedEpisodeCount: z.number().int().min(1).max(100),
  visualStyle: z.object({
    presetId: animationStyleIdSchema, description: text(2000), aspectRatio: z.literal("9:16"),
    colorPalette: z.array(text(300)).min(1).max(20), consistencyRules: z.array(text(1000)).max(30),
  }).strict(),
  storyBible: z.object({
    setting: text(3000), centralMystery: text(3000), hiddenTruth: text(10000),
    worldRules: z.array(text(1500)).max(40),
    timeline: z.array(z.object({ date: text(120), event: text(2000) }).strict()).max(100),
    continuityRules: z.array(text(1500)).max(60),
    episodeOutlines: z.array(z.object({ episodeNumber: z.number().int().positive().max(100), title: text(160), summary: text(3000), endingHook: text(2000) }).strict()).min(1).max(100),
  }).strict(),
  characters: z.array(characterSchema).max(40), locations: z.array(locationSchema).max(40), props: z.array(propSchema).max(80),
}).strict();

const sceneSchema = z.object({
  sceneId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/), order: z.number().int().positive().max(30),
  title: text(120), durationSeconds: z.number().positive().max(120), dramaticPurpose: text(2000),
  narration: text(2000), onScreenText: z.string().max(120),
  visual: z.object({ description: text(3000), primaryAction: text(2000), shotType: text(300), cameraMovement: text(500), lighting: text(1200), environmentMotion: text(1200) }).strict(),
  references: z.object({ characterIds: z.array(z.string().max(80)).max(20), locationIds: z.array(z.string().max(80)).max(20), propIds: z.array(z.string().max(80)).max(30) }).strict(),
  googleFlow: z.object({ prompt: text(12000), negativePrompt: text(12000), referenceInstructions: text(12000) }).strict(),
  audio: z.object({ ambience: z.array(text(500)).max(20), soundEffects: z.array(text(500)).max(30), musicMood: text(1200) }).strict(),
  continuityNotes: z.array(text(1200)).max(30),
}).strict();

const episodeSchema = z.object({
  episodeNumber: z.number().int().positive().max(100), title: text(160), synopsis: text(6000),
  targetDurationSeconds: z.number().int().positive().max(120), previousEpisodeSummary: z.string().max(6000).nullable(),
  openingHook: text(2000), endingCliffhanger: text(2000), scenes: z.array(sceneSchema).min(1).max(30),
  continuityHandoff: z.object({
    revealedFacts: z.array(text(1500)).max(40), unresolvedMysteries: z.array(text(1500)).max(40),
    characterStates: z.array(z.object({ characterId: z.string().max(80), state: text(1500) }).strict()).max(40),
    nextEpisodeSetup: text(3000),
  }).strict(),
}).strict();

const productionBudgetSchema = z.object({
  creditsPerClip: z.number().int().positive().max(10000), dailyCreditsAvailable: z.number().int().positive().max(1000000),
  plannedClips: z.number().int().positive().max(30), estimatedCredits: z.number().int().nonnegative().max(1000000),
  reserveCredits: z.number().int().nonnegative().max(1000000),
}).strict();

export const storySeriesPackageSchema = z.object({
  schemaVersion: z.literal("story-series.v1"), packageType: z.literal("series-with-episode"),
  series: seriesSchema, episode: episodeSchema, productionBudget: productionBudgetSchema,
}).strict().superRefine((input, ctx) => {
  const { series, episode, productionBudget } = input;
  const entityIds = new Set<string>();
  for (const [kind, entries] of [["characters", series.characters], ["locations", series.locations], ["props", series.props]] as const) {
    entries.forEach((entry, index) => {
      if (entityIds.has(entry.id)) ctx.addIssue({ code: "custom", message: "ID referensi kontinuitas harus unik lintas jenis.", path: ["series", kind, index, "id"] });
      entityIds.add(entry.id);
    });
  }
  const outline = series.storyBible.episodeOutlines.find((item) => item.episodeNumber === episode.episodeNumber);
  if (episode.episodeNumber > series.plannedEpisodeCount) ctx.addIssue({ code: "custom", message: "Nomor episode melewati jumlah rencana series.", path: ["episode", "episodeNumber"] });
  if (!outline || outline.title !== episode.title) ctx.addIssue({ code: "custom", message: "Episode harus cocok dengan judul outline Story Bible.", path: ["episode", "title"] });
  const outlineNumbers = series.storyBible.episodeOutlines.map((item) => item.episodeNumber);
  if (new Set(outlineNumbers).size !== outlineNumbers.length) ctx.addIssue({ code: "custom", message: "Nomor outline episode harus unik.", path: ["series", "storyBible", "episodeOutlines"] });
  const sceneIds = new Set<string>();
  let seconds = 0;
  episode.scenes.forEach((scene, index) => {
    if (sceneIds.has(scene.sceneId)) ctx.addIssue({ code: "custom", message: "ID scene harus unik dalam episode.", path: ["episode", "scenes", index, "sceneId"] });
    sceneIds.add(scene.sceneId);
    if (scene.order !== index + 1) ctx.addIssue({ code: "custom", message: "Urutan scene harus berurutan mulai dari satu.", path: ["episode", "scenes", index, "order"] });
    const groups = [
      ["characterIds", scene.references.characterIds, new Set(series.characters.map((item) => item.id))],
      ["locationIds", scene.references.locationIds, new Set(series.locations.map((item) => item.id))],
      ["propIds", scene.references.propIds, new Set(series.props.map((item) => item.id))],
    ] as const;
    for (const [kind, ids, known] of groups) for (const id of ids) if (!known.has(id)) {
      ctx.addIssue({ code: "custom", message: `Referensi kontinuitas '${id}' tidak ditemukan.`, path: ["episode", "scenes", index, "references", kind] });
    }
    seconds += scene.durationSeconds;
  });
  if (seconds !== episode.targetDurationSeconds) ctx.addIssue({ code: "custom", message: "Durasi target harus sama dengan jumlah durasi scene.", path: ["episode", "targetDurationSeconds"] });
  if (productionBudget.plannedClips !== episode.scenes.length) ctx.addIssue({ code: "custom", message: "Jumlah clip budget harus sama dengan jumlah scene.", path: ["productionBudget", "plannedClips"] });
  if (productionBudget.estimatedCredits !== productionBudget.plannedClips * productionBudget.creditsPerClip) ctx.addIssue({ code: "custom", message: "Estimasi credits harus sama dengan jumlah clip × credits per clip.", path: ["productionBudget", "estimatedCredits"] });
  if (productionBudget.reserveCredits !== productionBudget.dailyCreditsAvailable - productionBudget.estimatedCredits || productionBudget.reserveCredits < 0) ctx.addIssue({ code: "custom", message: "Reserve credits harus sama dengan kredit harian dikurangi estimasi dan tidak boleh negatif.", path: ["productionBudget", "reserveCredits"] });
});

export type StorySeriesPackage = z.infer<typeof storySeriesPackageSchema>;
export type StorySeries = StorySeriesPackage["series"];
export type StorySeriesEpisode = StorySeriesPackage["episode"];
export type StorySeriesReferenceKind = "characters" | "locations" | "props";
export type StorySeriesProjectLink = {
  seriesId: string;
  episodeId: string;
  slug: string;
  seriesTitle: string;
  episodeNumber: number;
  episodeTitle: string;
  synopsis: string;
  productionBudget: StorySeriesPackage["productionBudget"];
  previousEpisodeSummary: string | null;
  openingHook: string;
  endingCliffhanger: string;
  continuityHandoff: StorySeriesPackage["episode"]["continuityHandoff"];
};

export function adaptStorySeriesEpisode(input: StorySeriesPackage): { researchPackage: ResearchPackage; visualStoryboard: VisualStoryboard } {
  const scenes = input.episode.scenes.map((scene) => {
    const startSec = input.episode.scenes.slice(0, scene.order - 1).reduce((total, prior) => total + prior.durationSeconds, 0);
    return {
      id: scene.sceneId,
      order: scene.order,
      startSec,
      endSec: startSec + scene.durationSeconds,
      narrationText: scene.narration,
      onScreenText: scene.onScreenText,
      templateId: "infographic" as const,
      visualDescription: scene.visual.description.slice(0, 500),
      motionCues: [] as const,
      sfxCues: [] as const,
      motionPlan: defaultMotionPlan([]),
      motionActions: [],
      visualComposition: defaultVisualComposition("infographic"),
      referenceIds: [] as string[],
    };
  });
  const parsed = parseResearchPackage({
    schemaVersion: "1.1",
    id: `story-${input.series.slug}-episode-${input.episode.episodeNumber}`,
    title: `${input.series.title} · E${String(input.episode.episodeNumber).padStart(2, "0")}`,
    category: "Fiksi",
    visualPreset: "cinematic-parallax",
    language: input.series.language,
    targetDurationSec: input.episode.targetDurationSeconds,
    aspectRatio: "9:16",
    narration: input.episode.scenes.map((scene) => scene.narration).join("\n"),
    videoOverlaySettings: { showCategory: true, showTitle: true, showSceneLabel: true, showSubtitles: true, showProgress: true, showBranding: false, brandName: "AI FACTS STUDIO" },
    references: [], scenes,
  });
  if (!parsed.success) throw new Error(`Research Package hasil adapter tidak valid: ${parsed.error.issues.slice(0, 4).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  const researchPackage = parsed.data;
  const base = buildVisualStoryboard(researchPackage);
  const reference = (entry: { id: string; name: string; referenceImagePrompt: string; referenceAssetId?: string }, description: string, continuityRules: string[], details: Record<string, unknown> = {}) => ({
    id: entry.id,
    name: entry.name,
    description,
    referenceImagePrompt: entry.referenceImagePrompt,
    continuityRules,
    ...details,
    ...(entry.referenceAssetId ? { referenceImageUrl: `/visual-assets/${entry.referenceAssetId.slice("upload-".length)}` } : {}),
  });
  const findEntities = (kind: StorySeriesReferenceKind, ids: readonly string[]) => ids.flatMap((id) => {
    if (kind === "characters") {
      const entry = input.series.characters.find((item) => item.id === id);
      return entry ? [reference(entry, entry.physicalDescription, entry.continuityRules, {
        role: entry.role,
        physicalDescription: entry.physicalDescription,
        outfit: entry.outfit,
        distinguishingFeatures: entry.distinguishingFeatures,
        personality: entry.personality,
      })] : [];
    }
    if (kind === "locations") {
      const entry = input.series.locations.find((item) => item.id === id);
      return entry ? [reference(entry, entry.description, entry.continuityRules, { fixedLayout: entry.fixedLayout })] : [];
    }
    const entry = input.series.props.find((item) => item.id === id);
    return entry ? [reference(entry, entry.visualDescription, [], { visualDescription: entry.visualDescription })] : [];
  });
  const allReferenceAssets = [...input.series.characters, ...input.series.locations, ...input.series.props]
    .flatMap((entry) => entry.referenceAssetId ? [entry.referenceAssetId] : []);
  const visualStoryboard = visualStoryboardSchema.parse({
    ...base,
    styleLock: {
      ...base.styleLock,
      illustrationStyle: input.series.visualStyle.description.slice(0, 160),
      colorPalette: input.series.visualStyle.colorPalette.join("; ").slice(0, 500),
      lighting: input.series.visualStyle.description.slice(0, 300),
      visualComplexity: "Cinematic 2D motion comic; preserve authored layout and continuity.",
      compositionGuidelines: "Portrait 9:16. Keep lower third calm for separately rendered subtitles. No generated text.",
      consistencyInstructions: (input.series.visualStyle.consistencyRules.join(" ") || input.series.visualStyle.description).slice(0, 500),
      referenceAssetIds: [...new Set(allReferenceAssets)].slice(0, 8),
    },
    scenes: base.scenes.map((visual, index) => {
      const source = input.episode.scenes[index]!;
      return {
        ...visual,
        headline: source.title,
        narrationText: source.narration,
        visualSummary: source.visual.description.slice(0, 500),
        flowPrompt: source.googleFlow.prompt,
        flowNegativePrompt: source.googleFlow.negativePrompt,
        flowReferenceInstructions: source.googleFlow.referenceInstructions,
        flowPromptMode: "animated-video",
        flowVisualMode: "animated-video",
        flowPromptAnimationStyleId: input.series.visualStyle.presetId,
        flowStatus: "prompt-ready",
        storySeries: {
          title: source.title,
          originalOnScreenText: source.onScreenText,
          dramaticPurpose: source.dramaticPurpose,
          visualDescription: source.visual.description,
          primaryAction: source.visual.primaryAction,
          shotType: source.visual.shotType,
          cameraMovement: source.visual.cameraMovement,
          lighting: source.visual.lighting,
          environmentMotion: source.visual.environmentMotion,
          googleFlow: { negativePrompt: source.googleFlow.negativePrompt, referenceInstructions: source.googleFlow.referenceInstructions },
          audio: source.audio,
          references: {
            characters: findEntities("characters", source.references.characterIds),
            locations: findEntities("locations", source.references.locationIds),
            props: findEntities("props", source.references.propIds),
          },
          continuityNotes: source.continuityNotes,
        },
      };
    }),
  });
  return { researchPackage, visualStoryboard };
}
