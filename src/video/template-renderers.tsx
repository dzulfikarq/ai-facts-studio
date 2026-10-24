import React from "react";
import type { TemplateId } from "../domain/research";
import { SceneComposition, type TemplateRendererProps } from "./scene-composition";

function makeTemplateScene(templateId: TemplateId): React.FC<TemplateRendererProps> {
  const TemplateScene: React.FC<TemplateRendererProps> = (props) => {
    if (props.scene.templateId !== templateId) throw new Error(`Renderer '${templateId}' received '${props.scene.templateId}'.`);
    return <SceneComposition {...props}/>;
  };
  TemplateScene.displayName = `${templateId.replaceAll("-", " ")} scene`;
  return TemplateScene;
}

export const MountainRevealScene = makeTemplateScene("mountain-reveal");
export const PlateCollisionScene = makeTemplateScene("plate-collision");
export const FoldingUpliftScene = makeTemplateScene("folding-uplift");
export const HimalayaScene = makeTemplateScene("himalaya");
export const VolcanoScene = makeTemplateScene("volcano");
export const InfographicScene = makeTemplateScene("infographic");
export const SpaceOrbitScene = makeTemplateScene("space-orbit");
export const AnimalHabitatScene = makeTemplateScene("animal-habitat");
