import type { TemplateId } from "./research";
import { motionCueIds, type MotionCuePlan, type VisualCompositionInput, type VisualLayerInput } from "./visual-composition";

const rect = (x: number, y: number, width: number, height: number, fill: string, radius?: number) => ({ type: "shape" as const, shape: "rect" as const, x, y, width, height, fill, radius });
const ellipse = (x: number, y: number, width: number, height: number, fill: string, opacity?: number) => ({ type: "shape" as const, shape: "ellipse" as const, x, y, width, height, fill, opacity });
const polygon = (x: number, y: number, width: number, height: number, points: Array<{ x: number; y: number }>, fill: string) => ({ type: "shape" as const, shape: "polygon" as const, x, y, width, height, points, fill });
const path = (x: number, y: number, width: number, height: number, d: string, fill: string, stroke?: string, strokeWidth?: number) => ({ type: "path" as const, x, y, width, height, d, fill, stroke, strokeWidth });
const text = (x: number, y: number, width: number, height: number, value: string, color: string, fontSize: number, align: "start" | "middle" | "end" = "middle") => ({ type: "text" as const, x, y, width, height, text: value, color, fontSize, align, font: "heading" as const, weight: "700" as const });
const icon = (x: number, y: number, width: number, height: number, name: "sun" | "cloud" | "lightning" | "arrow" | "mountain" | "planet" | "water-drop" | "leaf" | "bear" | "wave" | "rock" | "river" | "crystal", color: string) => ({ type: "icon" as const, x, y, width, height, icon: name, color });
const diagram = (x: number, y: number, width: number, height: number, kind: "charge-separation" | "orbit" | "geological-layers" | "volcano-cross-section" | "water-cycle" | "process-flow", labels: string[] = []) => ({ type: "diagram" as const, x, y, width, height, kind, labels, color: "primary" as const, accent: "accent" as const });
const layer = (id: string, depth: number, ...nodes: VisualLayerInput["nodes"]): VisualLayerInput => ({ id, depth, nodes });

export function defaultVisualComposition(templateId: TemplateId): VisualCompositionInput {
  const sky = layer("sky", 0.05,
    rect(0, 300, 1080, 1400, "canvas"),
    icon(785, 390, 185, 185, "sun", "accent"),
    icon(95, 520, 220, 115, "cloud", "snow"),
    icon(760, 660, 245, 120, "cloud", "surface"),
  );

  switch (templateId) {
    case "mountain-reveal":
      return { background: "canvas", layers: [sky,
        layer("distant-ridge", 0.25, path(0, 820, 1080, 680, "M0 100 L24 46 L40 68 L57 28 L79 63 L100 38 L100 100 Z", "surface")),
        layer("main-peaks", 0.62, path(0, 930, 1080, 690, "M0 100 L18 57 L34 74 L53 14 L72 70 L86 42 L100 100 Z", "primary"), path(260, 1015, 560, 280, "M0 100 L50 0 L100 100 Z", "snow")),
        layer("foreground", 0.92, rect(0, 1460, 1080, 260, "surface"), ellipse(70, 1510, 420, 85, "primary", 0.6)),
      ] };
    case "plate-collision":
      return { background: "canvas", layers: [
        layer("mantle", 0.1, rect(0, 850, 1080, 870, "surface"), path(0, 1100, 1080, 500, "M0 40 Q50 25 100 40 L100 100 L0 100 Z", "accent")),
        layer("plates", 0.5,
          polygon(0, 1000, 540, 600, [{ x: 0, y: 0.15 }, { x: 1, y: 0.2 }, { x: 1, y: 1 }, { x: 0, y: 1 }], "primary"),
          polygon(540, 1000, 540, 600, [{ x: 0, y: 0.2 }, { x: 1, y: 0.15 }, { x: 1, y: 1 }, { x: 0, y: 1 }], "accent"),
          icon(205, 860, 210, 100, "arrow", "text"), { ...icon(665, 860, 210, 100, "arrow", "text"), rotation: 180 }),
        layer("uplift", 0.8, path(375, 690, 330, 500, "M0 100 Q30 0 55 75 Q78 5 100 100 Z", "snow"), text(260, 1350, 560, 70, "KERAK TERTEKAN", "text", 34)),
      ] };
    case "folding-uplift":
      return { background: "canvas", layers: [
        layer("rock-bed", 0.15, rect(0, 970, 1080, 750, "surface")),
        layer("rock-layers", 0.48,
          path(0, 1170, 1080, 420, "M0 55 Q20 0 40 55 T80 55 T100 55 L100 100 L0 100 Z", "accent"),
          path(0, 1060, 1080, 420, "M0 55 Q20 0 40 55 T80 55 T100 55 L100 100 L0 100 Z", "primary"),
          path(0, 950, 1080, 420, "M0 55 Q20 0 40 55 T80 55 T100 55 L100 100 L0 100 Z", "snow")),
        layer("uplifted-crest", 0.8, polygon(250, 700, 580, 440, [{ x: 0, y: 1 }, { x: 0.24, y: 0.48 }, { x: 0.42, y: 0.72 }, { x: 0.66, y: 0.05 }, { x: 1, y: 1 }], "primary")),
      ] };
    case "himalaya":
      return { background: "canvas", layers: [sky,
        layer("range-back", 0.22, path(0, 790, 1080, 670, "M0 100 L18 42 L29 60 L47 18 L62 58 L77 25 L100 100 Z", "surface")),
        layer("himalayan-peaks", 0.68,
          polygon(80, 820, 920, 720, [{ x: 0, y: 1 }, { x: 0.16, y: 0.5 }, { x: 0.26, y: 0.68 }, { x: 0.48, y: 0.02 }, { x: 0.65, y: 0.62 }, { x: 0.82, y: 0.22 }, { x: 1, y: 1 }], "primary"),
          polygon(510, 832, 170, 215, [{ x: 0, y: 0.9 }, { x: 0.5, y: 0 }, { x: 1, y: 0.9 }, { x: 0.66, y: 0.72 }, { x: 0.5, y: 0.9 }, { x: 0.28, y: 0.7 }], "snow")),
        layer("valley", 0.9, path(0, 1410, 1080, 310, "M0 10 Q50 35 100 0 L100 100 L0 100 Z", "surface")),
      ] };
    case "volcano":
      return { background: "canvas", layers: [
        layer("volcanic-sky", 0.05, rect(0, 400, 1080, 1300, "canvas"), ellipse(350, 690, 380, 380, "danger", 0.18)),
        layer("volcano-cone", 0.55, polygon(130, 760, 820, 850, [{ x: 0, y: 1 }, { x: 0.34, y: 0.3 }, { x: 0.44, y: 0.42 }, { x: 0.51, y: 0.12 }, { x: 0.6, y: 0.42 }, { x: 0.68, y: 0.3 }, { x: 1, y: 1 }], "surface"),
          path(475, 910, 130, 160, "M0 15 Q50 90 100 15 L85 100 Q50 120 15 100 Z", "accent")),
        layer("magma", 0.88, path(505, 1050, 100, 450, "M45 0 Q5 35 53 55 T45 100", "danger", "accent", 9), ellipse(446, 705, 34, 34, "accent"), ellipse(590, 665, 24, 24, "danger")),
      ] };
    case "infographic":
      return { background: "canvas", layers: [
        layer("diagram-panel", 0.2, rect(90, 600, 900, 850, "surface", 40), diagram(150, 680, 780, 650, "geological-layers", ["KERAK", "MANTEL", "ARAH GERAK"])),
        layer("callouts", 0.85, text(120, 1420, 840, 80, "DIAGRAM PENJELAS", "text", 34)),
      ] };
    case "space-orbit":
      return { background: "canvas", layers: [
        layer("orbit-diagram", 0.45, diagram(100, 600, 880, 850, "orbit", ["MATAHARI", "ORBIT", "PLANET"])),
        layer("stars", 0.9, icon(180, 750, 62, 62, "sun", "snow"), icon(850, 1200, 52, 52, "planet", "accent")),
      ] };
    case "animal-habitat":
      return { background: "canvas", layers: [
        layer("arctic-sky", 0.05, rect(0, 430, 1080, 1280, "canvas"), icon(770, 560, 175, 175, "sun", "snow")),
        layer("ice-hills", 0.35, path(0, 1050, 1080, 500, "M0 55 Q18 20 36 55 T70 44 T100 48 L100 100 L0 100 Z", "surface"), path(0, 1250, 1080, 470, "M0 28 Q28 52 48 25 T100 36 L100 100 L0 100 Z", "snow")),
        layer("animal", 0.78, icon(330, 820, 440, 540, "bear", "text"), text(260, 1400, 560, 70, "ADAPTASI ARKTIK", "primary", 32)),
      ] };
  }
}

export function defaultMotionPlan(cues: readonly string[]): MotionCuePlan[] {
  return cues.map((cue) => {
    const durationFrames = cue === "cut" ? 1 : cue === "dissolve" ? 18 : cue === "pulse" ? 36 : 24;
    const easing: MotionCuePlan["easing"] = cue === "cut" || cue === "pan" || cue === "pulse" ? "linear" : cue === "scale" || cue === "reveal" || cue === "fadeIn" ? "spring" : "easeInOut";
    if (!motionCueIds.includes(cue as typeof motionCueIds[number])) throw new Error(`Unsupported motion cue: ${cue}`);
    return { cue: cue as MotionCuePlan["cue"], targetLayer: cue === "cut" || cue === "dissolve" || cue === "slide-transition" || cue === "wipe" ? "scene" : "all", delayFrames: 0, durationFrames, easing };
  });
}
