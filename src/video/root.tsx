import React from "react";
import { Composition } from "remotion";
import { durationInFrames } from "../domain/timeline";
import { defaultMotionPlan, defaultVisualComposition } from "../domain/visual-defaults";
import { LegacyVideo } from "./legacy-video";
import { MotionGraphicsVideo } from "./video";
import { LEGACY_RENDERER_VERSION, OLDER_RENDERER_VERSION, OLDEST_RENDERER_VERSION, PREVIOUS_RENDERER_VERSION, RENDERER_VERSION } from "./renderer-version";
import type { VideoProps } from "./types";
import { visualCompositionSchema } from "../domain/visual-composition";

export type { VideoProps } from "./types";

const defaultScene: VideoProps["research"]["scenes"][number] = {
  id: "preview-scene", order: 1, startSec: 0, endSec: 56, narrationText: "", onScreenText: "Preview",
  templateId: "mountain-reveal", visualDescription: "Preview renderer", motionCues: [], sfxCues: [], referenceIds: [],
  visualComposition: visualCompositionSchema.parse(defaultVisualComposition("mountain-reveal")), motionPlan: defaultMotionPlan([]), motionActions: [],
};

const defaultProps: VideoProps = {
  rendererVersion: RENDERER_VERSION,
  research: {
    schemaVersion: "1.1", id: "preview", title: "AI Facts Studio", category: "Sains & Antariksa",
    visualPreset: "cinematic-parallax", language: "id-ID", targetDurationSec: 56, aspectRatio: "9:16",
    narration: "", videoOverlaySettings: { showCategory: true, showTitle: true, showSceneLabel: true, showSubtitles: true, showProgress: true, showBranding: false, brandName: "AI FACTS STUDIO" }, references: [], scenes: [defaultScene],
  },
};

export const VersionedVideo: React.FC<VideoProps> = (props) => {
  const rendererVersion = props.rendererVersion ?? LEGACY_RENDERER_VERSION;
  if (rendererVersion === LEGACY_RENDERER_VERSION) return <LegacyVideo {...props}/>;
  if (rendererVersion === OLDEST_RENDERER_VERSION || rendererVersion === OLDER_RENDERER_VERSION || rendererVersion === PREVIOUS_RENDERER_VERSION || rendererVersion === RENDERER_VERSION) return <MotionGraphicsVideo {...props}/>;
  throw new Error(`Unsupported renderer version: ${rendererVersion}`);
};

export const VideoRoot: React.FC = () => (
  <Composition
    id="FactsVideo"
    component={VersionedVideo}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={56 * 30}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => ({ durationInFrames: durationInFrames(props.research, props.audioDurationSec, props.rendererVersion === RENDERER_VERSION ? props.audioTimingMode : "scaled") })}
  />
);
