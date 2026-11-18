import type { StorySource, StoryAnalysis } from "../../domain/story-generation";
import type { StorySeries } from "../../domain/story-series";
import type { AiGenerationProvider, AiGenerationRequest, AiGenerationResult } from "./provider";

function marker<T>(prompt: string, name: string): T {
  const line = prompt.split("\n").find((item) => item.startsWith(`${name}=`));
  if (!line) throw new Error(`Mock Story AI missing ${name}.`);
  return JSON.parse(line.slice(name.length + 1)) as T;
}

function mockAnalysis(source: StorySource): StoryAnalysis {
  const episodeCount = /\bEP2\b|long story/i.test(source.storyText) ? 2 : 1;
  const episodes = Array.from({ length: episodeCount }, (_, index) => ({
    episodeNumber: index + 1,
    title: `${source.title} · Episode ${index + 1}`,
    synopsis: `Mock synopsis ${index + 1} based on preserved source.`,
    conflict: `Source conflict ${index + 1}.`,
    openingHook: `Source hook ${index + 1}.`,
    endingCliffhanger: index + 1 < episodeCount ? `Episode ${index + 1} handoff.` : "Finale resolves the main conflict.",
    estimatedDurationSeconds: source.targetDurationSeconds,
    estimatedScenes: Math.min(8, Math.ceil(source.targetDurationSeconds / 8)),
    estimatedFlowClips: Math.ceil(source.targetDurationSeconds / 8),
    estimatedCredits: Math.ceil(source.targetDurationSeconds / 8) * 10,
    resolvesMainConflict: index + 1 === episodeCount,
    manualEditRequired: false,
  }));
  return {
    schemaVersion: "story-analysis.v1",
    summary: `Mock analysis of ${source.title}.`,
    structure: { beginning: "Source opening.", middle: "Source development.", ending: "Source resolution." },
    mainConflict: "Source-supported central conflict.",
    conflictDevelopment: "Conflict escalates through source events.",
    characters: [{ name: "Mara", role: "Protagonist", description: "A consistent 2D illustrated protagonist." }],
    locations: [{ name: "Old House", description: "An atmospheric source location." }],
    keyEvents: ["Source event one", "Source resolution"],
    tensionPoints: ["A source-supported reveal"],
    potentialHooks: ["A question grounded in the source"],
    estimatedStoryDurationSeconds: source.targetDurationSeconds * episodeCount,
    recommendedEpisodeCount: episodeCount,
    recommendationReason: "Mock test recommendation follows source structure, not word count.",
    episodes,
    warnings: source.targetDurationSeconds > 64 ? ["Requested duration exceeds the eight-clip ceiling."] : [],
  };
}

function mockBible(source: StorySource) {
  return {
    logline: `A source-faithful horror story about ${source.title}.`,
    synopsis: `Reusable mock Bible based on ${source.title}.`,
    genre: ["Horror", "Fiksi"],
    setting: "A hand-painted, atmospheric house based on the source.",
    centralMystery: "The source-supported mystery.",
    hiddenTruth: "The source contains no separate hidden truth in this fixture.",
    worldRules: ["Follow source story events."],
    timeline: [{ date: "Story present", event: "Source events remain in original order." }],
    continuityRules: ["Keep character appearance and location layout stable."],
    visualStyle: { description: "Authentic flat 2D hand-painted horror illustration.", colorPalette: ["dark teal", "dirty green", "muted charcoal"], consistencyRules: ["Painted 2D surfaces only.", "No 3D or photorealistic rendering."] },
    characters: [{ id: "mara", name: "Mara", role: "Protagonist", physicalDescription: "Young adult with tired eyes and short dark hair.", outfit: "Dark coat.", distinguishingFeatures: ["Small scar above left eyebrow."], personality: "Observant and guarded.", referenceImagePrompt: "Flat 2D hand-painted character reference of Mara, dark coat, consistent facial features, atmospheric horror palette.", continuityRules: ["Keep short dark hair and coat consistent."] }],
    locations: [{ id: "old-house", name: "Old House", description: "A narrow old house with a timber hallway.", fixedLayout: "Hallway leads to a closed back room.", referenceImagePrompt: "Flat 2D hand-painted old house reference, fixed timber hallway layout, dark teal palette.", continuityRules: ["Hallway always leads to the same back room."] }],
    props: [{ id: "brass-key", name: "Brass Key", visualDescription: "A tarnished brass key with a split ring.", referenceImagePrompt: "Flat 2D hand-painted tarnished brass key, same split ring, no text." }],
    adaptationNotes: [],
  };
}

function mockEpisode(prompt: string) {
  const source = marker<StorySource>(prompt, "SOURCE_INPUT_JSON");
  const selected = marker<{ episodeNumber: number; title: string; synopsis: string; estimatedDurationSeconds: number }>(prompt, "SELECTED_EPISODE_JSON");
  const series = marker<StorySeries>(prompt, "APPROVED_STORY_BIBLE_JSON");
  const previous = marker<{ title: string; synopsis: string } | null>(prompt, "PREVIOUS_EPISODE_HANDOFF_JSON");
  const targetDurationSeconds = selected.estimatedDurationSeconds ?? source.targetDurationSeconds;
  const clipCount = Math.ceil(targetDurationSeconds / 8);
  let remaining = targetDurationSeconds;
  const scenes = Array.from({ length: clipCount }, (_, index) => {
    const durationSeconds = Math.min(8, remaining);
    remaining -= durationSeconds;
    return {
      sceneId: `ep${String(selected.episodeNumber).padStart(2, "0")}-sc${String(index + 1).padStart(2, "0")}`,
      order: index + 1,
      title: `Source beat ${index + 1}`,
      durationSeconds,
      dramaticPurpose: "Advance one source-supported story beat.",
      narration: `Adegan ${index + 1} mengikuti alur ${selected.title}.`,
      onScreenText: "",
      visual: { description: "Flat hand-painted 2D horror scene in a dark timber hallway.", primaryAction: "Mara pauses and listens.", shotType: "Medium shot", cameraMovement: "Slow 2D push-in only", lighting: "Graphic painted shadows, muted teal", environmentMotion: "Subtle dust drift" },
      references: { characterIds: series.characters.slice(0, 1).map((item) => item.id), locationIds: series.locations.slice(0, 1).map((item) => item.id), propIds: series.props.slice(0, 1).map((item) => item.id) },
      googleFlow: { prompt: "Authentic flat 2D hand-painted horror illustration, limited motion-comic animation, controlled 2D camera. No 3D, CGI, or photorealism.", negativePrompt: "No 3D, CGI, Pixar, glossy plastic, photorealism, Unreal Engine, Blender, or 3D camera movement.", referenceInstructions: "Attach approved character and location references manually in Google Flow." },
      audio: { ambience: ["quiet house tone"], soundEffects: ["soft floorboard creak"], musicMood: "restrained atmospheric tension" },
      continuityNotes: ["Keep Mara appearance and hallway layout consistent."],
    };
  });
  return {
    scenes,
    continuityHandoff: {
      revealedFacts: [`Episode ${selected.episodeNumber} source event revealed.`],
      unresolvedMysteries: selected.episodeNumber === 1 ? ["What waits behind the back room door?"] : [],
      characterStates: [{ characterId: series.characters[0]?.id ?? "mara", state: previous ? `Continues after ${previous.title}.` : "Begins the source story." }],
      nextEpisodeSetup: previous ? `Continue from ${previous.title} handoff.` : "Use this handoff for next episode continuity.",
    },
    adaptationNotes: [],
  };
}

export class StoryGenerationMockProvider implements AiGenerationProvider {
  readonly id = "story-generation-test-mock";
  readonly displayName = "Story Generation Test Mock";
  readonly model = "story-mock-v1";

  async generate(request: AiGenerationRequest): Promise<AiGenerationResult> {
    let value: unknown;
    if (request.outputFormat === "story-analysis.v1") value = mockAnalysis(marker<StorySource>(request.prompt, "SOURCE_INPUT_JSON"));
    else if (request.outputFormat === "story-bible.v1") {
      const source = marker<StorySource>(request.prompt, "SOURCE_INPUT_JSON");
      value = mockBible(source);
    } else if (request.outputFormat === "story-series.v1") value = mockEpisode(request.prompt);
    else throw new Error(`Unsupported mock output format: ${request.outputFormat}`);
    return { text: JSON.stringify(value), model: this.model };
  }
}
