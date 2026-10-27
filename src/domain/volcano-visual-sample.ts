import { motionActionSchema } from "./motion-director";
import { visualCompositionSchema } from "./visual-composition";
import { visualStoryboardSchema, type VisualStoryboard } from "./visual-storyboard";

const composition = visualCompositionSchema.parse({
  background: "canvas",
  layers: [
    { id: "background", depth: 0.02, nodes: [{ type: "shape", shape: "rect", x: 0, y: 0, width: 1080, height: 1920, fill: "canvas" }] },
    { id: "sky-haze", depth: 0.08, nodes: [{ type: "shape", shape: "ellipse", x: 315, y: 570, width: 450, height: 450, fill: "accent", opacity: 0.14 }] },
    { id: "distant-ridge", depth: 0.2, nodes: [{ type: "path", x: 0, y: 1030, width: 1080, height: 500, d: "M0 75 Q20 35 40 70 T78 55 T100 70 L100 100 L0 100 Z", fill: "surface" }] },
    { id: "volcanic-edifice", depth: 0.4, nodes: [
      { type: "shape", shape: "polygon", x: 130, y: 620, width: 820, height: 980, points: [{ x: 0, y: 1 }, { x: 0.2, y: 0.67 }, { x: 0.34, y: 0.46 }, { x: 0.44, y: 0.28 }, { x: 0.48, y: 0.25 }, { x: 0.5, y: 0.31 }, { x: 0.53, y: 0.25 }, { x: 0.58, y: 0.3 }, { x: 0.68, y: 0.49 }, { x: 0.82, y: 0.68 }, { x: 1, y: 1 }], fill: "primary" },
    ] },
    { id: "geologic-strata", depth: 0.58, nodes: [
      { type: "shape", shape: "rect", x: 0, y: 1320, width: 1080, height: 600, fill: "surface" },
      { type: "path", x: 0, y: 1370, width: 1080, height: 180, d: "M0 38 Q25 18 50 38 T100 35", fill: "none", stroke: "primary", strokeWidth: 7 },
      { type: "path", x: 0, y: 1515, width: 1080, height: 190, d: "M0 35 Q25 55 50 35 T100 42", fill: "none", stroke: "accent", strokeWidth: 7 },
    ] },
    { id: "magma-reservoir", depth: 0.72, nodes: [
      { type: "shape", shape: "ellipse", x: 370, y: 1460, width: 340, height: 175, fill: "danger" },
      { type: "shape", shape: "ellipse", x: 405, y: 1490, width: 270, height: 115, fill: "accent", opacity: 0.72 },
    ] },
    { id: "magma-conduit", depth: 0.76, nodes: [{ type: "path", x: 490, y: 825, width: 100, height: 700, d: "M50 100 C35 82 65 64 50 48 C35 32 64 18 50 0", fill: "none", stroke: "muted", strokeWidth: 16 }] },
    { id: "magma-core", depth: 0.77, nodes: [{ type: "path", x: 490, y: 825, width: 100, height: 700, d: "M50 100 C35 82 65 64 50 48 C35 32 64 18 50 0", fill: "none", stroke: "danger", strokeWidth: 9, motion: "draw" }] },
    { id: "surface-crater", depth: 0.82, nodes: [{ type: "shape", shape: "ellipse", x: 466, y: 800, width: 148, height: 34, fill: "text" }] },
    { id: "lava-flow", depth: 0.88, nodes: [{ type: "path", x: 565, y: 815, width: 300, height: 570, d: "M10 0 C18 18 38 28 43 47 C48 68 70 77 92 100", fill: "none", stroke: "accent", strokeWidth: 18, opacity: 0.72, motion: "draw" }] },
    { id: "deposits", depth: 0.9, nodes: [{ type: "path", x: 215, y: 1300, width: 650, height: 145, d: "M0 62 Q18 42 36 57 T70 52 T100 47", fill: "none", stroke: "text", strokeWidth: 8, opacity: 0.48, motion: "draw" }] },
    { id: "ash-cloud", depth: 0.92, nodes: [
      { type: "shape", shape: "ellipse", x: 430, y: 485, width: 220, height: 130, fill: "muted", opacity: 0.3 },
      { type: "shape", shape: "ellipse", x: 470, y: 445, width: 165, height: 120, fill: "muted", opacity: 0.27 },
      { type: "shape", shape: "ellipse", x: 505, y: 470, width: 150, height: 110, fill: "muted", opacity: 0.22 },
    ] },
  ],
});

const elements = [
  ["background", "background"],
  ["sky-haze", "background"],
  ["distant-ridge", "mountain-exterior"],
  ["volcanic-edifice", "mountain-exterior"],
  ["geologic-strata", "ground-cross-section"],
  ["magma-reservoir", "magma-reservoir"],
  ["magma-conduit", "magma-conduit"],
  ["magma-core", "magma-conduit"],
  ["surface-crater", "surface-crater"],
  ["lava-flow", "lava"],
  ["deposits", "ground-cross-section"],
  ["ash-cloud", "smoke"],
] as const;

const beats = [
  { id: "volcano-intro-outline", description: "Kenali kerucut gunung api", kind: "particle-flow", startFrame: 8, durationFrames: 108, targetLayerId: "volcanic-edifice", targetNode: "volcanic-edifice/0", targetRole: "mountain-exterior", easing: "easeInOut", pathStyle: "highlight", particleCount: 1, path: [{ x: 255, y: 1400 }, { x: 385, y: 1110 }, { x: 500, y: 900 }, { x: 540, y: 850 }, { x: 695, y: 1110 }, { x: 825, y: 1400 }] },
  { id: "magma-storage-glow", description: "Magma terkumpul sementara di zona penyimpanan", kind: "particle-flow", startFrame: 10, durationFrames: 112, targetLayerId: "magma-reservoir", targetNode: "magma-reservoir/0", targetRole: "magma-reservoir", easing: "easeInOut", pathStyle: "magma", particleCount: 3, path: [{ x: 430, y: 1530 }, { x: 480, y: 1490 }, { x: 560, y: 1480 }, { x: 645, y: 1515 }, { x: 610, y: 1570 }, { x: 500, y: 1580 }, { x: 430, y: 1530 }] },
  { id: "magma-rises", description: "Sebagian magma naik melalui retakan dan conduit", kind: "particle-flow", startFrame: 8, durationFrames: 116, targetLayerId: "magma-conduit", targetNode: "magma-conduit/0", targetRole: "magma-conduit", easing: "linear", pathStyle: "magma", particleCount: 4, path: [{ x: 540, y: 1525 }, { x: 525, y: 1395 }, { x: 555, y: 1160 }, { x: 525, y: 1045 }, { x: 540, y: 825 }] },
  { id: "eruption-gas-plume", description: "Gas mengembang dan material keluar saat erupsi", kind: "particle-flow", startFrame: 6, durationFrames: 112, targetLayerId: "ash-cloud", targetNode: "ash-cloud/0", targetRole: "smoke", easing: "easeOut", pathStyle: "smoke", particleCount: 4, path: [{ x: 540, y: 820 }, { x: 490, y: 730 }, { x: 570, y: 650 }, { x: 500, y: 560 }, { x: 560, y: 490 }] },
  { id: "lava-and-deposits", description: "Lava mengalir; abu dan fragmen membentuk endapan", kind: "particle-flow", startFrame: 10, durationFrames: 108, targetLayerId: "lava-flow", targetNode: "lava-flow/0", targetRole: "lava", easing: "easeInOut", pathStyle: "lava", particleCount: 4, path: [{ x: 595, y: 815 }, { x: 619, y: 918 }, { x: 679, y: 975 }, { x: 694, y: 1083 }, { x: 709, y: 1203 }, { x: 775, y: 1254 }, { x: 841, y: 1385 }] },
  { id: "volcano-conclusion", description: "Skema sederhana; sistem gunung api nyata beragam", kind: "focus-shift", startFrame: 14, durationFrames: 100, targetLayerId: "volcanic-edifice", targetNode: "volcanic-edifice/0", targetRole: "mountain-exterior", easing: "easeInOut", keyframes: [{ at: 0, scale: 1 }, { at: 1, scale: 1.035 }] },
].map((beat) => motionActionSchema.parse({ motionPathRef: "path" in beat ? `path-${beat.id}` : undefined, ...beat }));

export function seedVolcanoVisualSample(storyboard: VisualStoryboard): VisualStoryboard {
  if (storyboard.scenes.length !== beats.length || storyboard.scenes.some((scene) => scene.durationSec !== 5)) {
    throw new Error("Sample gunung api harus berisi enam scene berdurasi lima detik.");
  }
  return visualStoryboardSchema.parse({
    ...storyboard,
    visualWorld: {
      id: "volcano-shared-world",
      name: "Gunung Api · Draft Prosedural",
      sourceSceneId: storyboard.scenes[0]!.sceneId,
      composition,
      elements: elements.map(([layerId, semanticRole]) => ({ layerId, semanticRole })),
    },
    scenes: storyboard.scenes.map((scene, index) => ({
      ...scene,
      composition,
      compositionSource: "procedural",
      illustrationSource: "procedural",
      authoringConfirmed: false,
      authoringStatus: "needs_review",
      approved: false,
      approvedFingerprint: null,
      motionActions: [beats[index]!],
      motionStatus: "ready_for_review",
      motionTiming: "approximate",
      motionSummary: `${beats[index]!.description} · timing perkiraan.`,
      flowStatus: "awaiting-illustration",
      warnings: [...scene.warnings.slice(0, 6), "Draft Visual World prosedural; ilustrasi Google Flow belum diimpor."],
    })),
  });
}
