import React from "react";
import type { Scene, VisualPreset } from "../domain/research";
import type { VisualComposition } from "../domain/visual-composition";
import { VisualCompositionView } from "./visual-primitives";
import { visualStyles } from "./style-config";
import type { VideoEditorInteractions } from "./types";

export type TemplateRendererProps = { scene: Scene; composition: VisualComposition; preset: VisualPreset; frame: number; progress: number; editor?: VideoEditorInteractions };

export function SceneComposition({ scene, composition, preset, frame, progress, editor }: TemplateRendererProps) {
  return <VisualCompositionView scene={scene} composition={composition} style={visualStyles[preset]} preset={preset} frame={frame} progress={progress} editor={editor}/>;
}
