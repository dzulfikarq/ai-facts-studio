import type { ResearchPackage } from "../domain/research";

export type VideoProps = {
  research: ResearchPackage;
  audioFile?: string;
  audioDurationSec?: number;
  audioTimingMode?: "scaled" | "estimated";
  rendererVersion?: number;
};
