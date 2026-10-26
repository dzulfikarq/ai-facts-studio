import type { VisualComposition, VisualNode } from "./visual-composition";
import type { VisualPreset } from "./research";

export type VisualBounds = { left: number; top: number; right: number; bottom: number };

const emptyBounds = (): VisualBounds => ({ left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
const isBackground = (node: VisualNode) => node.type === "shape" && node.shape === "rect" && node.width >= 900 && node.height >= 1200;

function rotatedBounds(node: Pick<VisualNode, "x" | "y" | "width" | "height" | "rotation">): VisualBounds {
  const angle = (node.rotation ?? 0) * Math.PI / 180;
  const width = Math.abs(node.width * Math.cos(angle)) + Math.abs(node.height * Math.sin(angle));
  const height = Math.abs(node.width * Math.sin(angle)) + Math.abs(node.height * Math.cos(angle));
  return { left: node.x + (node.width - width) / 2, top: node.y + (node.height - height) / 2, right: node.x + (node.width + width) / 2, bottom: node.y + (node.height + height) / 2 };
}

function union(bounds: VisualBounds, next: VisualBounds): VisualBounds {
  return { left: Math.min(bounds.left, next.left), top: Math.min(bounds.top, next.top), right: Math.max(bounds.right, next.right), bottom: Math.max(bounds.bottom, next.bottom) };
}

export function visualCompositionFrame(composition: VisualComposition) {
  const foreground = composition.layers.filter((layer) => layer.depth > 0.1);
  const nodes = (foreground.length ? foreground : composition.layers).flatMap((layer) => layer.nodes).filter((node) => !isBackground(node));
  if (!nodes.length) return { scale: 1, translateX: 0, translateY: 0 };
  const bounds = nodes.reduce((box, node) => union(box, rotatedBounds(node)), emptyBounds());
  const width = Math.max(1, bounds.right - bounds.left);
  const height = Math.max(1, bounds.bottom - bounds.top);
  const scale = Math.min(1.3, 1080 / width, 1100 / height);
  return { scale, translateX: 540 - ((bounds.left + bounds.right) / 2) * scale, translateY: 990 - ((bounds.top + bounds.bottom) / 2) * scale };
}

export function visualCompositionCamera(preset: VisualPreset, progress: number) {
  return preset === "cinematic-parallax"
    ? { x: -24 + 48 * progress, y: Math.sin(progress * Math.PI) * 16, scale: 1 + 0.055 * progress }
    : preset === "animated-infographic"
      ? { x: Math.sin(progress * Math.PI * 2) * 8, y: Math.sin(progress * Math.PI) * 8, scale: 1 + 0.035 * progress }
      : { x: Math.sin(progress * Math.PI) * 10, y: -Math.sin(progress * Math.PI) * 4, scale: 1 + 0.018 * progress };
}

export function visualBackdropLayerOffset(preset: VisualPreset, depth: number, progress: number) {
  if (preset === "flat-2d-storytelling") return { x: Math.sin(progress * Math.PI * 2) * 11 * (0.5 - depth), y: Math.sin(progress * Math.PI) * 5 * (0.5 - depth), scale: 1 };
  if (preset === "animated-infographic") {
    const entrance = Math.max(0, Math.min(1, (progress - depth * 0.08) / 0.18));
    return { x: 0, y: (1 - entrance) * 26, scale: 1 };
  }
  return { x: (0.5 - depth) * 66 * progress, y: (0.5 - depth) * 24 * progress, scale: Math.min(1.2, 1 + 0.06 * progress) };
}

function nodeOffset(node: VisualNode, frame: number, progress: number) {
  return node.type === "group" ? { x: 0, y: 0 }
    : node.motion === "fall" ? { x: 0, y: progress * 220 }
      : node.motion === "rise" ? { x: 0, y: -progress * 180 }
        : node.motion === "flow" ? { x: progress * 96, y: progress * 56 }
          : node.motion === "drift" ? { x: Math.sin(frame / 22) * 9, y: Math.cos(frame / 26) * 7 } : { x: 0, y: 0 };
}

function groupedBounds(group: Extract<VisualNode, { type: "group" }>, child: Exclude<VisualNode, { type: "group" }>, frame: number, progress: number) {
  const local = rotatedBounds(child);
  const moving = nodeOffset(child, frame, progress);
  const sx = group.width / 1080;
  const sy = group.height / 1920;
  const angle = (group.rotation ?? 0) * Math.PI / 180;
  const corners = [
    [local.left + moving.x, local.top + moving.y], [local.right + moving.x, local.top + moving.y],
    [local.right + moving.x, local.bottom + moving.y], [local.left + moving.x, local.bottom + moving.y],
  ].map(([x, y]) => {
    const scaledX = x! * sx;
    const scaledY = y! * sy;
    const dx = scaledX - group.width / 2;
    const dy = scaledY - group.height / 2;
    return { x: group.x + group.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle), y: group.y + group.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle) };
  });
  return corners.reduce((bounds, point) => ({ left: Math.min(bounds.left, point.x), top: Math.min(bounds.top, point.y), right: Math.max(bounds.right, point.x), bottom: Math.max(bounds.bottom, point.y) }), emptyBounds());
}

/** Bounds match VisualCompositionView's content framing and camera at review midpoint. */
export function renderedVisualBounds(composition: VisualComposition, preset: VisualPreset, options: { progress?: number; frame?: number; layerMotions?: ReadonlyMap<string, { translateX: number; translateY: number; scale: number }> } = {}) {
  const progress = options.progress ?? 0.5;
  const frame = options.frame ?? 45;
  const foreground = composition.layers.filter((layer) => layer.depth > 0.1);
  const layers = foreground.length ? foreground : composition.layers;
  const framing = visualCompositionFrame(composition);
  const view = visualCompositionCamera(preset, progress);
  const result = new Map<VisualNode, VisualBounds>();
  for (const layer of layers) {
    const backdrop = visualBackdropLayerOffset(preset, layer.depth, progress);
    const motion = options.layerMotions?.get(layer.id) ?? { translateX: 0, translateY: 0, scale: 1 };
    const offset = { x: backdrop.x + motion.translateX, y: backdrop.y + motion.translateY, scale: Math.min(1.2, backdrop.scale * motion.scale) };
    for (const parent of layer.nodes) {
      const nodes = parent.type === "group" ? parent.children.map((node) => ({ node, bounds: groupedBounds(parent, node, frame, progress) })) : [{ node: parent, bounds: rotatedBounds(parent) }];
      for (const { node, bounds: local } of nodes) {
      if (isBackground(node)) continue;
      const moving = parent.type === "group" ? { x: 0, y: 0 } : nodeOffset(node, frame, progress);
      const left = local.left + moving.x;
      const right = local.right + moving.x;
      const top = local.top + moving.y;
      const bottom = local.bottom + moving.y;
      const x = (value: number) => 540 + view.x + (540 + offset.x + (value * framing.scale + framing.translateX - 540) * offset.scale - 540) * view.scale;
      const y = (value: number) => 990 + view.y + (960 + offset.y + (value * framing.scale + framing.translateY - 960) * offset.scale - 990) * view.scale;
      result.set(node, { left: x(left), right: x(right), top: y(top), bottom: y(bottom) });
      }
    }
  }
  return result;
}
