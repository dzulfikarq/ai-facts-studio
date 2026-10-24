import type { ComponentType } from "react";
import { defaultVisualComposition } from "../domain/visual-defaults";
import { templateIds, type TemplateId } from "../domain/research";
import { visualCompositionSchema, type VisualComposition } from "../domain/visual-composition";
import {
  AnimalHabitatScene, FoldingUpliftScene, HimalayaScene, InfographicScene, MountainRevealScene,
  PlateCollisionScene, SpaceOrbitScene, VolcanoScene,
} from "./template-renderers";
import type { TemplateRendererProps } from "./scene-composition";

export type RendererCapability = "layers" | "depth-motion" | "diagram" | "trusted-image" | "character";
type TemplateDefinition = {
  label: string;
  capabilities: readonly RendererCapability[];
  defaultComposition: () => VisualComposition;
  component: ComponentType<TemplateRendererProps>;
};

const defaults = (templateId: TemplateId) => () => visualCompositionSchema.parse(defaultVisualComposition(templateId));

export const rendererRegistry = {
  "mountain-reveal": { label: "Mountain reveal", capabilities: ["layers", "depth-motion", "trusted-image"], defaultComposition: defaults("mountain-reveal"), component: MountainRevealScene },
  "plate-collision": { label: "Plate collision", capabilities: ["layers", "depth-motion", "diagram"], defaultComposition: defaults("plate-collision"), component: PlateCollisionScene },
  "folding-uplift": { label: "Folding uplift", capabilities: ["layers", "depth-motion"], defaultComposition: defaults("folding-uplift"), component: FoldingUpliftScene },
  himalaya: { label: "Himalaya", capabilities: ["layers", "depth-motion", "trusted-image"], defaultComposition: defaults("himalaya"), component: HimalayaScene },
  volcano: { label: "Volcano", capabilities: ["layers", "diagram", "trusted-image"], defaultComposition: defaults("volcano"), component: VolcanoScene },
  infographic: { label: "Infographic", capabilities: ["layers", "diagram"], defaultComposition: defaults("infographic"), component: InfographicScene },
  "space-orbit": { label: "Space orbit", capabilities: ["layers", "depth-motion", "diagram"], defaultComposition: defaults("space-orbit"), component: SpaceOrbitScene },
  "animal-habitat": { label: "Animal habitat", capabilities: ["layers", "depth-motion", "character"], defaultComposition: defaults("animal-habitat"), component: AnimalHabitatScene },
} satisfies Record<TemplateId, TemplateDefinition>;

export function rendererFor(templateId: TemplateId) {
  const definition = rendererRegistry[templateId];
  if (!definition) throw new Error(`No renderer registered for template '${templateId}'.`);
  return definition.component;
}

export function registeredTemplateIds(): TemplateId[] {
  return [...templateIds];
}
