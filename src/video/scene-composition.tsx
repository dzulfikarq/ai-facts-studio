import React from "react";
import type { Scene, VisualPreset } from "../domain/research";
import type { VisualComposition } from "../domain/visual-composition";
import { VisualCompositionView } from "./visual-primitives";
import { visualStyles } from "./style-config";

export type TemplateRendererProps = { scene: Scene; composition: VisualComposition; preset: VisualPreset; frame: number; progress: number };

export function SceneComposition({ scene, composition, preset, frame, progress }: TemplateRendererProps) {
  return <VisualCompositionView scene={scene} composition={composition} style={visualStyles[preset]} preset={preset} frame={frame} progress={progress}/>;
}
