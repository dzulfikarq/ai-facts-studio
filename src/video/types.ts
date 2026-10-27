import type { ResearchPackage } from "../domain/research";
import type { VisualImageTransform } from "../domain/visual-composition";

export type VideoEditorInteractions = {
  sceneId: string;
  selectedImageId: string | null;
  onSelectImage: (nodeId: string) => void;
  onTransformImage: (nodeId: string, frame: VisualImageTransform) => void;
};

export type VideoProps = {
  research: ResearchPackage;
  audioFile?: string;
  audioDurationSec?: number;
  audioTimingMode?: "scaled" | "estimated";
  rendererVersion?: number;
  editor?: VideoEditorInteractions;
};
