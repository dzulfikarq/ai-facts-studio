import React from "react";
import { Composition } from "remotion";
import { durationInFrames } from "../domain/timeline";
import type { ResearchPackage } from "../domain/research";
import { MountainVideo } from "./video";

export type VideoProps = { research: ResearchPackage; audioFile?: string; audioDurationSec?: number; audioTimingMode?: "scaled" | "estimated" };

const defaultProps: VideoProps = {
  research: {
    schemaVersion: "1.0", id: "preview", title: "AI Facts Studio", category: "Sains & Antariksa",
    visualPreset: "cinematic-parallax", language: "id-ID", targetDurationSec: 56, aspectRatio: "9:16",
    narration: "", references: [], scenes: [],
  },
};

export const VideoRoot: React.FC = () => (
  <Composition
    id="FactsVideo"
    component={MountainVideo}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={56 * 30}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => ({ durationInFrames: durationInFrames(props.research, props.audioDurationSec) })}
  />
);
