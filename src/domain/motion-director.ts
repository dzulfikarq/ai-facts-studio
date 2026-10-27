import { z } from "zod";
import type { VisualComposition, VisualNode } from "./visual-composition";
import { visualObjectLibrary, type VisualObjectId } from "./visual-objects";
import type { VisualRelationship } from "./visual-composer";

export const motionIntensities = ["subtle", "balanced", "expressive"] as const;
export const motionIntensitySchema = z.enum(motionIntensities);
const motionPointSchema = z.object({ x: z.number().min(0).max(1080), y: z.number().min(0).max(1920) }).strict();
const motionKeyframeSchema = z.object({
  at: z.number().min(0).max(1), x: z.number().min(0).max(1080).optional(), y: z.number().min(0).max(1920).optional(),
  scale: z.number().min(0.75).max(1.25).optional(), rotation: z.number().min(-12).max(12).optional(), opacity: z.number().min(0).max(1).optional(),
}).strict();

export const motionActionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  kind: z.enum(["fade", "translate", "scale", "rotate", "follow-path", "draw", "particle-flow", "reveal", "repeat", "focus-shift", "state-transition"]),
  targetNode: z.string().regex(/^[a-z][a-z0-9-]{0,39}\/\d+(?:\.\d+)?$/),
  startFrame: z.number().int().min(0).max(3600),
  durationFrames: z.number().int().min(1).max(3600),
  easing: z.enum(["linear", "easeIn", "easeOut", "easeInOut"]),
  keyframes: z.array(motionKeyframeSchema).max(8).optional(),
  path: z.array(motionPointSchema).min(2).max(8).optional(),
  particleCount: z.number().int().min(1).max(8).optional(),
  repeatCount: z.number().int().min(2).max(6).optional(),
}).strict().superRefine((action, ctx) => {
  const frames = action.keyframes ?? [];
  for (let index = 1; index < frames.length; index++) {
    if (frames[index]!.at <= frames[index - 1]!.at) ctx.addIssue({ code: "custom", message: "Keyframe at harus meningkat tanpa duplikat", path: ["keyframes", index, "at"] });
  }
  if (frames.length && (frames[0]!.at !== 0 || frames.at(-1)!.at !== 1)) ctx.addIssue({ code: "custom", message: "Keyframe pertama/terakhir harus mencakup 0 dan 1", path: ["keyframes"] });
  const needs = (property: "x" | "y" | "scale" | "rotation" | "opacity") => frames.length >= 2 && frames.every((frame) => frame[property] !== undefined);
  if ((action.kind === "translate" || action.kind === "follow-path" || action.kind === "repeat") && action.kind !== "follow-path" && (!needs("x") || !needs("y"))) {
    ctx.addIssue({ code: "custom", message: "Gerak translasi membutuhkan koordinat x/y pada setiap keyframe", path: ["keyframes"] });
  }
  if ((action.kind === "scale" || action.kind === "focus-shift") && !needs("scale")) ctx.addIssue({ code: "custom", message: "Scale membutuhkan nilai scale pada setiap keyframe", path: ["keyframes"] });
  if (action.kind === "rotate" && !needs("rotation")) ctx.addIssue({ code: "custom", message: "Rotate membutuhkan rotation pada setiap keyframe", path: ["keyframes"] });
  if ((action.kind === "fade" || action.kind === "reveal" || action.kind === "state-transition") && !needs("opacity")) {
    ctx.addIssue({ code: "custom", message: "Reveal/state transition membutuhkan opacity pada setiap keyframe", path: ["keyframes"] });
  }
  if ((action.kind === "follow-path" || action.kind === "particle-flow") && (!action.path || action.path.length < 2)) {
    ctx.addIssue({ code: "custom", message: "Gerak path membutuhkan lintasan", path: ["path"] });
  }
  if (action.kind === "particle-flow" && !action.particleCount) ctx.addIssue({ code: "custom", message: "Particle flow membutuhkan jumlah partikel terbatas", path: ["particleCount"] });
  if (action.kind === "repeat" && !action.repeatCount) ctx.addIssue({ code: "custom", message: "Repeated motion membutuhkan repeatCount", path: ["repeatCount"] });
  if (action.kind === "draw" && frames.length) ctx.addIssue({ code: "custom", message: "Path drawing memakai progress action, bukan keyframe", path: ["keyframes"] });
});
export const motionActionsSchema = z.array(motionActionSchema).max(12).superRefine((actions, ctx) => {
  const particles = actions.reduce((total, action) => total + (action.particleCount ?? 0), 0);
  if (particles > 24) ctx.addIssue({ code: "custom", message: "Total partikel motion dibatasi 24", path: [] });
});
export type MotionAction = z.infer<typeof motionActionSchema>;
export type MotionIntensity = z.infer<typeof motionIntensitySchema>;

type MotionScene = {
  durationSec: number; headline: string; narrationText: string; visualSummary: string; illustrationIntent: string;
  visualFocus: VisualObjectId | null; objects: Array<{ objectId: VisualObjectId }>; relationships: VisualRelationship[]; composition: VisualComposition;
};
type NodeEntry = { ref: string; layerId: string; node: VisualNode; center: { x: number; y: number } };
const objectLayerAliases: Partial<Record<VisualObjectId, string[]>> = {
  sun: ["sun", "sunlight"], earth: ["earth", "earth-world"], atmosphere: ["atmosphere"], "ozone-layer": ["ozone"],
  "uv-rays": ["uv-rays"], "charged-particles": ["charged-particles"], magnetosphere: ["magnetic-field", "magnetosphere"],
  rain: ["rain"], rock: ["rock", "geological-layers", "mountain"], mineral: ["mineral", "salt-ions"], river: ["river"],
  ocean: ["ocean", "coast-and-ocean", "ocean-horizon"], evaporation: ["water-vapor", "evaporation"], "salt-crystal": ["salt-ions", "mineral"],
  mountain: ["mountain", "mountains"], volcano: ["volcano"], magma: ["magma"], "tectonic-plates": ["tectonic-plates"],
  lightning: ["lightning"], cloud: ["cloud", "clouds"], "water-cycle": ["water-vapor", "water-cycle"], planet: ["planet"], bear: ["bear"],
};

function nodeEntries(composition: VisualComposition): NodeEntry[] {
  return composition.layers.flatMap((layer) => layer.nodes.map((node, index) => ({
    ref: `${layer.id}/${index}`, layerId: layer.id, node, center: { x: node.x + node.width / 2, y: node.y + node.height / 2 },
  })));
}

function objectEntry(entries: NodeEntry[], objectId: VisualObjectId) {
  const icon = visualObjectLibrary[objectId].icon;
  return entries.find((entry) => entry.node.type === "icon" && entry.node.icon === icon)
    ?? entries.find((entry) => (objectLayerAliases[objectId] ?? [objectId]).some((alias) => entry.layerId.includes(alias)));
}

export function motionKeyframesWithinSafeCanvas(action: MotionAction, target: VisualNode) {
  const rotation = ((target.rotation ?? 0) * Math.PI) / 180;
  return (action.keyframes ?? []).every((frame) => {
    const angle = rotation + ((frame.rotation ?? 0) * Math.PI) / 180;
    const halfWidth = (Math.abs(Math.cos(angle)) * target.width + Math.abs(Math.sin(angle)) * target.height) * (frame.scale ?? 1) / 2;
    const halfHeight = (Math.abs(Math.sin(angle)) * target.width + Math.abs(Math.cos(angle)) * target.height) * (frame.scale ?? 1) / 2;
    const centerX = frame.x ?? target.x + target.width / 2;
    const centerY = frame.y ?? target.y + target.height / 2;
    return centerX - halfWidth >= 0 && centerX + halfWidth <= 1080 && centerY - halfHeight >= 0 && centerY + halfHeight <= 1920;
  });
}

function safeFocusScale(target: VisualNode, requested: number) {
  let low = 1; let high = requested;
  for (let index = 0; index < 16; index++) {
    const scale = (low + high) / 2;
    const valid = motionKeyframesWithinSafeCanvas({ keyframes: [{ at: 0, scale }, { at: 1, scale }] } as MotionAction, target);
    if (valid) low = scale; else high = scale;
  }
  return low;
}

function openPathEntry(entries: NodeEntry[], aliases: string[]) {
  return entries.find((entry) => aliases.some((alias) => entry.layerId.includes(alias)) && entry.node.type === "path"
    && (entry.node.fill === undefined || entry.node.fill === "none") && entry.node.d.toUpperCase().includes("M"))
    ?? entries.find((entry) => aliases.some((alias) => entry.layerId.includes(alias)) && entry.node.type === "path" && entry.node.motion === "draw");
}

function sampledPath(node: Extract<VisualNode, { type: "path" }>) {
  const tokens = node.d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
  const points: Array<{ x: number; y: number }> = [];
  let index = 0; let command = ""; let x = 0; let y = 0; let start = { x: 0, y: 0 };
  const number = () => Number(tokens[index++]);
  const hasNumber = () => index < tokens.length && !/^[a-z]$/i.test(tokens[index]!);
  while (index < tokens.length) {
    if (/^[a-z]$/i.test(tokens[index]!)) command = tokens[index++]!;
    if (!command) break;
    const relative = command === command.toLowerCase(); const op = command.toUpperCase();
    if (op === "Z") { x = start.x; y = start.y; points.push({ x, y }); command = ""; continue; }
    if (op === "M" || op === "L" || op === "T") {
      if (!hasNumber()) { command = ""; continue; }
      const nx = number(); const ny = number(); x = relative ? x + nx : nx; y = relative ? y + ny : ny;
      if (op === "M") { start = { x, y }; command = relative ? "l" : "L"; }
      points.push({ x, y }); continue;
    }
    if (op === "H" || op === "V") {
      if (!hasNumber()) { command = ""; continue; }
      const n = number(); if (op === "H") x = relative ? x + n : n; else y = relative ? y + n : n;
      points.push({ x, y }); continue;
    }
    if (op === "C" || op === "S" || op === "Q") {
      const count = op === "C" ? 6 : 4; if (tokens.length - index < count) { command = ""; continue; }
      const values = Array.from({ length: count }, number); const endX = values.at(-2)!; const endY = values.at(-1)!;
      const nx = relative ? x + endX : endX; const ny = relative ? y + endY : endY;
      const cx = relative ? x + values[0]! : values[0]!; const cy = relative ? y + values[1]! : values[1]!;
      const c2x = op === "C" ? (relative ? x + values[2]! : values[2]!) : cx;
      const c2y = op === "C" ? (relative ? y + values[3]! : values[3]!) : cy;
      const from = { x, y };
      for (let step = 1; step <= 5; step++) {
        const t = step / 5; const u = 1 - t;
        points.push(op === "Q" ? { x: u * u * from.x + 2 * u * t * cx + t * t * nx, y: u * u * from.y + 2 * u * t * cy + t * t * ny }
          : { x: u ** 3 * from.x + 3 * u * u * t * cx + 3 * u * t * t * c2x + t ** 3 * nx, y: u ** 3 * from.y + 3 * u * u * t * cy + 3 * u * t * t * c2y + t ** 3 * ny });
      }
      x = nx; y = ny; continue;
    }
    if (op === "A") {
      if (tokens.length - index < 7) { command = ""; continue; }
      const args = Array.from({ length: 7 }, number); x = relative ? x + args[5]! : args[5]!; y = relative ? y + args[6]! : args[6]!; points.push({ x, y }); continue;
    }
    command = "";
  }
  const bounded = points.length <= 8 ? points : Array.from({ length: 8 }, (_, index) => points[Math.round(index * (points.length - 1) / 7)]!);
  return bounded.map((point) => ({ x: node.x + point.x / 100 * node.width, y: node.y + point.y / 100 * node.height }));
}

const intensityScale: Record<MotionIntensity, number> = { subtle: 0.65, balanced: 1, expressive: 1.2 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const actionFrames = (durationSec: number, start: number, fraction: number) => {
  const total = Math.max(1, Math.floor(durationSec * 30));
  const startFrame = Math.min(total - 1, Math.floor(total * start));
  return { startFrame, durationFrames: Math.max(1, Math.min(total - startFrame - 6, Math.round(total * fraction))) };
};
const point = (x: number, y: number) => ({ x: Math.round(clamp(x, 12, 1068)), y: Math.round(clamp(y, 12, 1908)) });

export function planSceneMotion(scene: MotionScene, intensity: MotionIntensity = "balanced") {
  const entries = nodeEntries(scene.composition);
  const totalFrames = Math.max(1, Math.floor(scene.durationSec * 30));
  const contentNodes = scene.composition.layers.flatMap((layer) => layer.nodes.flatMap((node) => node.type === "group" ? node.children : [node]));
  const rasterNodes = contentNodes.filter((node) => node.type === "image");
  const vectorNodes = contentNodes.filter((node) => node.type !== "image" && node.type !== "text"
    && !(node.type === "shape" && node.shape === "rect" && node.width >= 900 && node.height >= 1200));
  const actions: MotionAction[] = [];
  const scale = intensityScale[intensity];
  const addParticles = (id: string, target: NodeEntry | undefined, path: Array<{ x: number; y: number }>, start: number, fraction: number, count: number) => {
    if (!target || path.length < 2 || actions.length >= 12 || actions.some((action) => action.id === id)) return;
    const timing = actionFrames(scene.durationSec, start, fraction);
    if (timing.durationFrames < 1 || timing.startFrame + timing.durationFrames > totalFrames) return;
    actions.push({ id, kind: "particle-flow", targetNode: target.ref, ...timing, easing: "linear", path: path.slice(0, 8), particleCount: Math.min(8, Math.max(1, count)) });
  };
  const addPathDraw = (id: string, target: NodeEntry | undefined, start: number, fraction: number) => {
    if (!target || target.node.type !== "path" || actions.length >= 12 || actions.some((action) => action.id === id)) return;
    actions.push({ id, kind: "draw", targetNode: target.ref, ...actionFrames(scene.durationSec, start, fraction), easing: "easeInOut" });
  };
  const route = (from: NodeEntry | undefined, to: NodeEntry | undefined, bend = 0) => {
    if (!from || !to) return [];
    return [point(from.center.x, from.center.y), point((from.center.x + to.center.x) / 2, (from.center.y + to.center.y) / 2 + bend), point(to.center.x, to.center.y)];
  };
  const normalizedCopy = `${scene.headline} ${scene.narrationText} ${scene.visualSummary} ${scene.illustrationIntent}`.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("id-ID");

  // ponytail: deterministic rules from visible relationships; add explicit AI planning only when local semantic evidence falls short.
  if (rasterNodes.length && vectorNodes.length === 0) {
    const image = entries.find((entry) => entry.node.type === "image" || entry.node.type === "group" && entry.node.children.some((child) => child.type === "image"));
    if (image) {
    const timing = actionFrames(scene.durationSec, 0.12, 0.72);
    const fromScale = 1;
    const toScale = safeFocusScale(image.node, clamp(1 + 0.05 * scale, 1, 1.12));
    if (toScale > 1.002) actions.push({ id: "raster-focus", kind: "focus-shift", targetNode: image.ref, ...timing, easing: "easeInOut", keyframes: [{ at: 0, scale: fromScale }, { at: 1, scale: toScale }] });
    }
  } else {
    for (const relation of scene.relationships) {
      if (relation.relation === "falls-on") {
        const source = objectEntry(entries, relation.from);
        const destination = objectEntry(entries, relation.to);
        const rainLayer = entries.find((entry) => entry.node.type === "icon" && entry.node.icon === visualObjectLibrary.rain.icon)?.layerId ?? source?.layerId;
        const target = entries.find((entry) => entry.layerId === rainLayer && entry.node.type !== "text") ?? source;
        const end = destination?.center ?? { x: source?.center.x ?? 540, y: (source?.center.y ?? 700) + 280 };
        if (target) addParticles("rain-fall", target, route(source ?? target, { ...target, center: end }, 0), 0.06, 0.62, Math.round(3 * scale));
        addPathDraw("rain-path", openPathEntry(entries, ["rain"]), 0.08, 0.64);
      }
      if (relation.relation === "flows-to" || relation.relation === "carries") {
        const riverPath = openPathEntry(entries, ["river"]);
        if (riverPath?.node.type === "path") {
          const points = sampledPath(riverPath.node);
          if (points.length >= 2) addParticles("river-mineral-flow", riverPath, points, 0.22, 0.68, Math.round(4 * scale));
          addPathDraw("river-path-draw", riverPath, 0.15, 0.7);
        } else {
          const source = objectEntry(entries, "river"); const destination = objectEntry(entries, "ocean");
          addParticles("river-mineral-flow", source, route(source, destination, -38), 0.22, 0.68, Math.round(4 * scale));
        }
      }
      if (relation.relation === "evaporates-from") {
        const ocean = objectEntry(entries, relation.to);
        const vapor = objectEntry(entries, relation.from);
        const target = vapor ?? ocean;
        const from = ocean ? { ...ocean, center: { x: ocean.center.x, y: ocean.center.y - 80 } } : undefined;
        const to = vapor ?? (ocean ? { ...ocean, center: { x: ocean.center.x, y: ocean.center.y - 280 } } : undefined);
        addParticles("water-vapor-rise", target, route(from, to, 0), 0.2, 0.6, Math.round(3 * scale));
      }
      if (relation.relation === "filters") {
        const rays = openPathEntry(entries, ["uv-rays"]);
        const ozone = objectEntry(entries, "ozone-layer");
        const earth = objectEntry(entries, "earth");
        if (rays?.node.type === "path") {
          const incoming = sampledPath(rays.node);
          if (incoming.length >= 2) addParticles("uv-approach-ozone", rays, incoming, 0.12, 0.55, Math.round(4 * scale));
          const start = ozone?.center ?? incoming.at(-1);
          let end = earth?.center ?? (start ? { x: start.x, y: start.y + 140 } : undefined);
          if (start && end && Math.hypot(end.x - start.x, end.y - start.y) < 80) {
            const rayStart = incoming[0]!; const rayEnd = incoming.at(-1)!;
            const direction = { x: rayEnd.x - rayStart.x, y: rayEnd.y - rayStart.y };
            const length = Math.hypot(direction.x, direction.y) || 1;
            end = point(start.x + direction.x / length * 180, start.y + Math.max(90, direction.y / length * 180));
          }
          if (start && end && Math.hypot(end.x - start.x, end.y - start.y) >= 80 && (normalizedCopy.includes("uv-a") || normalizedCopy.includes("menembus"))) {
            addParticles("partial-uv-transmission", rays, route({ ...rays, center: start }, { ...rays, center: end }, 0), 0.56, 0.3, 1);
          }
          addPathDraw("uv-path-draw", rays, 0.08, 0.68);
        }
      }
      if (relation.relation === "deflects") {
        const fieldPath = openPathEntry(entries, ["charged-particles", "magnetic-field", "magnetosphere"]);
        const particles = objectEntry(entries, relation.to);
        if (fieldPath?.node.type === "path") {
          const points = sampledPath(fieldPath.node);
          if (points.length >= 2) addParticles("charged-particle-deflection", fieldPath, points, 0.18, 0.7, Math.round(3 * scale));
        } else if (particles) {
          const cx = scene.composition.layers.find((layer) => layer.id.includes("earth-world"))?.nodes[0];
          const earth = objectEntry(entries, "earth");
          const center = earth?.center ?? (cx ? { x: cx.x + cx.width / 2, y: cx.y + cx.height / 2 } : { x: 540, y: 960 });
          const start = particles.center;
          addParticles("charged-particle-deflection", particles, [point(start.x, start.y), point(center.x - 170, center.y - 170), point(center.x - 205, center.y + 70), point(center.x - 110, center.y + 205)], 0.18, 0.7, Math.round(3 * scale));
        }
      }
    }
    if (!actions.length && scene.visualFocus) {
      const focus = objectEntry(entries, scene.visualFocus);
      if (focus && focus.node.type !== "image" && focus.node.type !== "text") {
        const toScale = safeFocusScale(focus.node, clamp(1 + 0.035 * scale, 1, 1.09));
        if (toScale > 1.002) actions.push({ id: "visual-focus", kind: "focus-shift", targetNode: focus.ref, ...actionFrames(scene.durationSec, 0.16, 0.68), easing: "easeInOut", keyframes: [{ at: 0, scale: 1 }, { at: 1, scale: toScale }] });
      }
    }
  }

  const checked = motionActionsSchema.safeParse(actions);
  if (!checked.success) throw new Error(`Motion plan tidak valid: ${checked.error.issues[0]?.message ?? "schema error"}`);
  const summary = actions.length
    ? actions.map((action) => action.kind === "particle-flow" ? `Aliran partikel: ${action.id.replaceAll("-", " ")}` : action.kind === "draw" ? `Lintasan digambar: ${action.id.replaceAll("-", " ")}` : `Fokus objek: ${action.targetNode}`).join(" · ")
    : "Scene statis; komposisi tidak memiliki objek terpisah yang aman untuk digerakkan.";
  const staticRaster = rasterNodes.length > 0 && vectorNodes.length === 0;
  return {
    motionIntensity: intensity,
    motionTiming: "approximate" as const,
    motionActions: checked.data,
    motionSummary: staticRaster ? `${summary} Raster bergerak sebagai satu gambar; objek internal tidak dipisah.` : summary,
    motionStatus: checked.data.length ? "ready_for_review" as const : "static" as const,
  };
}

export function motionActionProgress(action: MotionAction, frame: number) {
  const elapsed = frame - action.startFrame;
  if (elapsed < 0 || elapsed > action.durationFrames) return null;
  let progress = Math.max(0, Math.min(1, elapsed / action.durationFrames));
  if ((action.repeatCount ?? 1) > 1 && progress < 1) progress = (progress * action.repeatCount!) % 1;
  if (action.easing === "easeIn") progress *= progress;
  else if (action.easing === "easeOut") progress = 1 - (1 - progress) ** 2;
  else if (action.easing === "easeInOut") progress = progress * progress * (3 - 2 * progress);
  return progress;
}

export function motionActionValue(action: MotionAction, frame: number, initial: { x: number; y: number; scale: number; rotation: number; opacity: number }) {
  const progress = motionActionProgress(action, frame);
  if (progress === null) return null;
  const frames = action.keyframes ?? [];
  if (!frames.length) return { ...initial, progress };
  const left = [...frames].reverse().find((key) => key.at <= progress) ?? frames[0]!;
  const right = frames.find((key) => key.at >= progress) ?? frames.at(-1)!;
  const span = right.at - left.at;
  const local = span > 0 ? (progress - left.at) / span : 1;
  const value = (key: "x" | "y" | "scale" | "rotation" | "opacity", fallback: number) => {
    const from = left[key] ?? fallback; const to = right[key] ?? from;
    return from + (to - from) * local;
  };
  return { x: value("x", initial.x), y: value("y", initial.y), scale: value("scale", initial.scale), rotation: value("rotation", initial.rotation), opacity: value("opacity", initial.opacity), progress };
}

export function motionTargetExists(composition: VisualComposition, ref: string) {
  return nodeEntries(composition).some((entry) => entry.ref === ref);
}

export function motionTargetNode(composition: VisualComposition, ref: string) {
  return nodeEntries(composition).find((entry) => entry.ref === ref)?.node;
}
