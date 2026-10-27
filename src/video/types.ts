import type { ResearchPackage } from "../domain/research";
import type { VisualImageTransform } from "../domain/visual-composition";
import type { MotionAction } from "../domain/motion-director";

export type EditorMotionPath = {
  actionId: string;
  points: NonNullable<MotionAction["path"]>;
  pathStyle?: MotionAction["pathStyle"];
};

export type VideoEditorInteractions = {
  sceneId: string;
  selectedImageId: string | null;
  onSelectImage: (nodeId: string) => void;
  onTransformImage: (nodeId: string, frame: VisualImageTransform) => void;
  selectedMotionPath?: EditorMotionPath | null;
  onTransformMotionPathPoint?: (index: number, point: { x: number; y: number }) => void;
};

export type VideoProps = {
  research: ResearchPackage;
  audioFile?: string;
  audioDurationSec?: number;
  audioTimingMode?: "scaled" | "estimated";
  rendererVersion?: number;
  editor?: VideoEditorInteractions;
};
