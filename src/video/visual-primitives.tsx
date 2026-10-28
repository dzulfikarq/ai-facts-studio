import React from "react";
import { staticFile } from "remotion";
import type { VisualComposition, VisualNode } from "../domain/visual-composition";
import type { Scene, VisualPreset } from "../domain/research";
import { layerMotion } from "./motion";
import { resolveVisualColor, type VisualStyle } from "./style-config";
import { visualBackdropLayerOffset, visualCompositionCamera, visualCompositionFrame } from "../domain/visual-geometry";
import { motionActionProgress, motionPathProgress, type MotionAction } from "../domain/motion-director";
import { carriedMotionProgress, nodeMotion, pointAlongPolyline } from "./motion";
import type { VisualImageTransform } from "../domain/visual-composition";
import type { VideoEditorInteractions } from "./types";

const assetFiles = { cloud: "cloud.svg", lightning: "lightning.svg", sun: "sun.svg" } as const;
const safeId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "-");

function textLines(value: string, width: number, height: number, fontSize: number) {
  const maxChars = Math.max(4, Math.floor(width / (fontSize * 0.58)));
  const maxLines = Math.max(1, Math.floor(height / (fontSize * 1.2)));
  const lines: string[] = [];
  let line = "";
  const words = value.trim().split(/\s+/).flatMap((word) => {
    const chars = [...word];
    return chars.length <= maxChars ? [word] : Array.from({ length: Math.ceil(chars.length / maxChars) }, (_, index) => chars.slice(index * maxChars, (index + 1) * maxChars).join(""));
  });
  for (const word of words) {
    if (line && `${line} ${word}`.length > maxChars) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) lines.length = maxLines;
  if (lines.length && (value.length > lines.join(" ").length)) lines[lines.length - 1] = `${lines.at(-1)!.replace(/[.…]*$/, "")}…`;
  return lines;
}

function IconShape({ icon, color }: { icon: string; color: string }) {
  switch (icon) {
    case "sun": return <><circle cx="50" cy="50" r="22" fill={color}/>{[0,45,90,135].map((angle) => <line key={angle} x1="50" y1="5" x2="50" y2="19" transform={`rotate(${angle} 50 50)`} stroke={color} strokeWidth="8" strokeLinecap="round"/> )}</>;
    case "cloud": return <path d="M21 72a20 20 0 0 1 1-40 30 30 0 0 1 58-4 23 23 0 0 1 1 46H21Z" fill={color}/>;
    case "lightning": return <path d="M57 4 22 55h25l-8 42 41-56H55z" fill={color} stroke="#fff7e7" strokeWidth="3" strokeLinejoin="round"/>;
    case "arrow": return <path d="M10 50h67M57 22l28 28-28 28" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round"/>;
    case "mountain": return <path d="M4 88 37 30l17 27 18-42 24 73Z" fill={color}/>;
    case "planet": return <><ellipse cx="50" cy="50" rx="43" ry="15" fill="none" stroke={color} strokeWidth="6" transform="rotate(-25 50 50)"/><circle cx="50" cy="50" r="24" fill={color}/></>;
    case "water-drop": return <path d="M50 5C39 27 18 46 18 66a32 32 0 0 0 64 0C82 46 61 27 50 5Z" fill={color}/>;
    case "leaf": return <><path d="M14 80C16 28 49 10 89 12 88 52 66 85 23 87Z" fill={color}/><path d="M23 85 75 28" stroke="#fff7e7" strokeWidth="4"/></>;
    case "bear": return <><ellipse cx="48" cy="60" rx="31" ry="25" fill={color}/><circle cx="69" cy="39" r="20" fill={color}/><circle cx="56" cy="22" r="8" fill={color}/><circle cx="80" cy="22" r="8" fill={color}/><circle cx="76" cy="37" r="3" fill="#17323a"/><ellipse cx="87" cy="45" rx="7" ry="5" fill="#17323a"/><path d="M30 77v13m34-13v13" stroke={color} strokeWidth="9" strokeLinecap="round"/></>;
    case "wave": return <path d="M3 55q22-28 44 0t44 0M3 77q22-28 44 0t44 0" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"/>;
    case "rock": return <><path d="m8 78 8-36 18-8 8-22 24 8 9 19 17 11 1 28Z" fill={color}/><path d="m17 48 21-5 13 9 23-3 18 11M24 68l22-6 18 7 20-4" fill="none" stroke="#fff7e7" strokeOpacity=".55" strokeWidth="5" strokeLinecap="round"/><path d="m34 34 10 18 12 5" fill="none" stroke="#17323a" strokeOpacity=".35" strokeWidth="4"/></>;
    case "river": return <><path d="M6 20c34 0 15 23 49 24s16 31 40 32v12c-40 0-22-29-48-30S62 46 6 47Z" fill={color}/><path d="M12 28c20 0 14 12 32 13" fill="none" stroke="#fff7e7" strokeOpacity=".65" strokeWidth="4" strokeLinecap="round"/></>;
    case "crystal": return <><path d="m50 7 19 20 7 40-26 26-26-26 7-40Z" fill={color}/><path d="m50 7 1 86m18-66L33 27M76 67 50 48 24 67" fill="none" stroke="#fff7e7" strokeOpacity=".7" strokeWidth="4" strokeLinejoin="round"/></>;
    case "earth": return <><circle cx="50" cy="50" r="43" fill={color}/><path d="m20 31 13-10 10 6 2 11-10 5-2 12-11 3-7-12Zm34-15 13 5 5 10-8 8-8-5-7-8Zm-5 37 14-7 14 7 4 11-10 8-2 12-13-2-5-12-9-5Z" fill="#7fb68e"/><path d="M10 51a40 40 0 0 0 80 0" fill="none" stroke="#fff" strokeOpacity=".42" strokeWidth="3"/></>;
    case "atmosphere": return <><circle cx="50" cy="50" r="26" fill={color}/><circle cx="50" cy="50" r="36" fill="none" stroke={color} strokeWidth="7" strokeOpacity=".5"/><circle cx="50" cy="50" r="46" fill="none" stroke={color} strokeWidth="3" strokeDasharray="5 5"/></>;
    case "ozone-layer": return <><circle cx="50" cy="50" r="38" fill="none" stroke={color} strokeWidth="10" strokeOpacity=".25"/><circle cx="50" cy="50" r="28" fill="none" stroke={color} strokeWidth="5" strokeDasharray="7 5"/><circle cx="50" cy="50" r="18" fill={color}/></>;
    case "uv-ray": return <><circle cx="22" cy="50" r="13" fill={color}/><path d="M40 30 84 16M42 50h46M40 70l44 14" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"/><path d="m73 8 13 8-15 7m12 19 13 8-13 8m-2 19 13 8-15 7" fill="none" stroke={color} strokeWidth="5" strokeLinejoin="round"/></>;
    case "charged-particle": return <><path d="M13 29c16-23 29 16 44-2s20-15 30-4M12 70c16 20 29-15 43 2s25 15 32 4" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"/><g fill={color} fontFamily="Arial,sans-serif" fontSize="24" fontWeight="800"><text x="18" y="28">+</text><text x="48" y="70">−</text><text x="70" y="34">+</text></g></>;
    case "magnetosphere": return <><circle cx="50" cy="50" r="15" fill={color}/><path d="M50 6C12 8 7 33 16 50 7 67 12 92 50 94M50 6c38 2 43 27 34 44 9 17 4 42-34 44M50 14C25 19 22 35 29 50c-7 15-4 31 21 36m0-72c25 5 28 21 21 36 7 15 4 31-21 36" fill="none" stroke={color} strokeWidth="4" strokeOpacity=".72"/></>;
    case "rain": return <><path d="M20 55a17 17 0 0 1 2-34 26 26 0 0 1 51-4 19 19 0 0 1 4 38H20Z" fill={color}/><path d="m29 67-7 14m28-14-7 14m28-14-7 14" stroke={color} strokeWidth="7" strokeLinecap="round"/></>;
    case "ocean": return <><path d="M6 39q22-25 44 0t44 0v49H6Z" fill={color} opacity=".82"/><path d="M6 42q22-25 44 0t44 0M6 60q22-25 44 0t44 0" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"/></>;
    case "evaporation": return <><path d="M8 72q21-18 42 0t42 0" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"/><path d="M28 57V27m-8 9 8-10 8 10M52 57V15m-8 9 8-10 8 10M76 57V31m-8 9 8-10 8 10" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/></>;
    case "salt-crystal": return <><path d="m50 6 20 19 9 40-29 29-29-29 9-40Z" fill={color}/><path d="m50 6 1 88m19-69L31 25m48 40L50 46 21 65" fill="none" stroke="#fff" strokeOpacity=".82" strokeWidth="5" strokeLinejoin="round"/><path d="M8 84h16m52 0h16" stroke={color} strokeWidth="5" strokeLinecap="round"/></>;
    case "volcano": return <><path d="M6 87 34 34l13 13 8-19 11 17 28 42Z" fill={color}/><path d="M45 47h14l-5 40" fill="none" stroke="#f0aa62" strokeWidth="8" strokeLinecap="round"/><path d="M29 31 24 17m45 14 6-14" stroke={color} strokeWidth="5" strokeLinecap="round"/></>;
    case "magma": return <><path d="M11 76 31 34l13 17 10-30 14 28 21 27Z" fill={color}/><path d="M47 43h14l-6 44H45Z" fill="#ed8653"/><path d="M25 75q25-12 50 0" fill="none" stroke="#ffd27a" strokeWidth="6" strokeLinecap="round"/></>;
    case "tectonic-plates": return <><path d="M7 34 47 43l-4 46L7 83Zm86 0-40 9 4 46 36-6Z" fill={color}/><path d="M50 12v31m-8-8 8 9 8-9" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/><path d="M8 32q20-13 40 0m-36 4 35 8m36-12Q63 19 51 32m38 4-35 8" fill="none" stroke="#fff7e7" strokeWidth="3" opacity=".8"/></>;
    default: return null;
  }
}

function Diagram({ kind, labels, color, accent }: { kind: string; labels: string[]; color: string; accent: string }) {
  const Label = ({ children, x, y }: { children: string; x: number; y: number }) => <g>{textLines(children, 82, 14, 4.6).map((line,index)=><text key={index} x={x} y={y+index*5} textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="4.6" fontWeight="700" fill={color}>{line}</text>)}</g>;
  if (kind === "charge-separation") return <>
    <rect x="4" y="4" width="92" height="92" rx="8" fill={color} opacity=".08"/>
    <g fill={color} fontFamily="Arial, sans-serif" fontWeight="800" fontSize="20"><text x="22" y="28">+</text><text x="43" y="23">+</text><text x="69" y="30">+</text><text x="34" y="78">−</text><text x="62" y="84">−</text></g>
    <path d="M50 34v29m-7-8 7 8 7-8" fill="none" stroke={accent} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/>
    {labels.slice(0,2).map((label,index)=><Label key={label} x={index?73:27} y={index?51:94}>{label}</Label>)}
  </>;
  if (kind === "orbit") return <>
    <circle cx="50" cy="50" r="34" fill="none" stroke={color} strokeWidth="2" opacity=".55"/><circle cx="50" cy="50" r="24" fill="none" stroke={color} strokeWidth="2" opacity=".45"/>
    <circle cx="50" cy="50" r="10" fill={accent}/><circle cx="82" cy="49" r="4" fill={color}/><circle cx="37" cy="28" r="3" fill={accent}/>
    {labels.slice(0,2).map((label,index)=><Label key={label} x={50} y={index?97:12}>{label}</Label>)}
  </>;
  if (kind === "geological-layers") return <>
    {[0,1,2,3].map((index)=><rect key={index} x="8" y={28+index*16} width="84" height="14" rx="3" fill={index%2?color:accent} opacity={.85-index*.08}/>)}
    <path d="M12 25h76" stroke={color} strokeWidth="3" strokeDasharray="5 4"/>
    {labels.slice(0,3).map((label,index)=><Label key={label} x={50} y={36+index*16}>{label}</Label>)}
  </>;
  if (kind === "volcano-cross-section") return <>
    <path d="M8 87 39 35 50 48 61 35 92 87Z" fill={color}/><path d="M46 48h8l-4 39" stroke={accent} strokeWidth="7" fill="none"/>
    {labels.slice(0,2).map((label,index)=><Label key={label} x={50} y={index?97:28}>{label}</Label>)}
  </>;
  if (kind === "process-flow") {
    const steps = labels.slice(0, 4);
    const cardHeight = Math.min(24, (88 - (steps.length - 1) * 8) / steps.length);
    const startY = (100 - (steps.length * cardHeight + (steps.length - 1) * 8)) / 2;
    return <>
      {steps.map((step, index) => {
        const y = startY + index * (cardHeight + 8);
        const lines = textLines(step, 62, cardHeight, 6.5);
        return <g key={`${index}-${step}`}>
          {index < steps.length - 1 && <><path d={`M50 ${y + cardHeight + 1}v5`} stroke={accent} strokeWidth="2.5"/><path d={`m46 ${y + cardHeight + 3} 4 5 4-5`} fill="none" stroke={accent} strokeWidth="2.5" strokeLinejoin="round"/></>}
          <rect x="8" y={y} width="84" height={cardHeight} rx="6" fill={color} opacity=".1" stroke={color} strokeOpacity=".45" strokeWidth="1.5"/>
          <circle cx="18" cy={y + cardHeight / 2} r="5.2" fill={accent}/>
          <text x="18" y={y + cardHeight / 2 + 1.8} textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="5" fontWeight="800" fill="#ffffff">{index + 1}</text>
          {lines.map((line, lineIndex) => <text key={lineIndex} x="55" y={y + cardHeight / 2 + (lineIndex - (lines.length - 1) / 2) * 7 + 2} textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="6.5" fontWeight="700" fill={color}>{line}</text>)}
        </g>;
      })}
    </>;
  }
  if (kind === "water-cycle") return <>
    <circle cx="80" cy="18" r="8" fill={accent}/>
    {[0, 60, 120].map((angle) => <path key={angle} d="M80 5v-3" stroke={accent} strokeWidth="2.5" strokeLinecap="round" transform={`rotate(${angle} 80 18)`}/>)}
    <path d="M7 63 20 44l12 10 11-20 17 29Z" fill={color} opacity=".72"/>
    <path d="M5 72q12-5 24 0t24 0 24 0 24 0v24H5Z" fill={color}/>
    <path d="M5 76q12-5 24 0t24 0 24 0 24 0" fill="none" stroke="#ffffff" strokeOpacity=".7" strokeWidth="2"/>
    <path d="M26 32c-2-8 5-14 13-11 4-9 18-8 21 1 8-2 13 6 9 12H31" fill="#ffffff" fillOpacity=".9" stroke={color} strokeOpacity=".4" strokeWidth="1.5"/>
    <path d="M74 63C77 52 78 43 70 34m-30 2c-1 8-5 13-8 20m-5 11c11 4 21 2 30-2" fill="none" stroke={accent} strokeWidth="2.7" strokeLinecap="round"/>
    <path d="m67 36 3-5 4 5m-44 15-4 6-4-5m26 8 7 1-4 5" fill="none" stroke={accent} strokeWidth="2.5" strokeLinejoin="round"/>
    <text x="78" y="53" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="5.1" fontWeight="700" fill={color}>{labels[0] ?? "UAP"}</text>
    <text x="15" y="42" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="4.8" fontWeight="700" fill={color}>{labels[1] ?? "HUJAN"}</text>
    <text x="30" y="91" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="4.8" fontWeight="700" fill="#ffffff">{labels[2] ?? "LAUT"}</text>
  </>;
  return <>
    <circle cx="50" cy="22" r="10" fill={accent}/><path d="M50 34v26m-7-8 7 8 7-8M45 66c-14-17-28-4-22 8 3 7 11 7 15 3m9-11c14-17 28-4 22 8-3 7-11 7-15 3" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"/>
    {labels.slice(0,3).map((label,index)=><Label key={label} x={50} y={84+index*6}>{label}</Label>)}
  </>;
}

function LeafNode({ node, style, frame, progress, processProgress, id, actions = [], editor }: { node: Exclude<VisualNode, { type: "group" }>; style: VisualStyle; frame: number; progress: number; processProgress?: number; id: string; actions?: MotionAction[]; editor?: VideoEditorInteractions }) {
  const gesture = React.useRef<{ mode: "move" | "resize"; pointerId: number; inverse: DOMMatrix; startPoint: DOMPoint; start: VisualImageTransform; latest: VisualImageTransform } | null>(null);
  const [draftTransform, setDraftTransform] = React.useState<VisualImageTransform | null>(null);
  const image = node.type === "image" ? node : null;
  const imageFrame = image && draftTransform ? { ...image, ...draftTransform } : image;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const parentPoint = (event: React.PointerEvent<SVGElement>, inverse: DOMMatrix) => {
    const point = event.currentTarget.ownerSVGElement?.createSVGPoint();
    if (!point) return null;
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(inverse);
  };
  const beginImageGesture = (event: React.PointerEvent<SVGElement>, mode: "move" | "resize") => {
    if (!image || !editor || !event.isPrimary || event.button !== 0) return;
    const parent = event.currentTarget.parentElement?.parentElement as SVGGraphicsElement | null;
    const transform = parent?.getScreenCTM();
    if (!transform) return;
    const inverse = transform.inverse();
    const startPoint = parentPoint(event, inverse);
    if (!startPoint) return;
    event.preventDefault();
    event.stopPropagation();
    editor.onSelectImage(id);
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = { x: image.x, y: image.y, width: image.width, height: image.height };
    gesture.current = { mode, pointerId: event.pointerId, inverse, startPoint, start, latest: start };
  };
  const moveImageGesture = (event: React.PointerEvent<SVGElement>) => {
    const active = gesture.current;
    if (!image || !active || active.pointerId !== event.pointerId) return;
    const point = parentPoint(event, active.inverse);
    if (!point) return;
    const dx = point.x - active.startPoint.x;
    const dy = point.y - active.startPoint.y;
    const next = active.mode === "move"
      ? { ...active.start, x: clamp(active.start.x + dx, 0, 1080 - active.start.width), y: clamp(active.start.y + dy, 0, 1920 - active.start.height) }
      : (() => {
        const requested = Math.max((active.start.width + dx) / active.start.width, (active.start.height + dy) / active.start.height);
        const minScale = Math.max(1 / active.start.width, 1 / active.start.height);
        const maxScale = Math.min((1080 - active.start.x) / active.start.width, (1920 - active.start.y) / active.start.height);
        const scale = clamp(requested, minScale, maxScale);
        return { ...active.start, width: active.start.width * scale, height: active.start.height * scale };
      })();
    active.latest = next;
    setDraftTransform(next);
  };
  const finishImageGesture = (event: React.PointerEvent<SVGElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    gesture.current = null;
    setDraftTransform(null);
    if (image && editor && Object.keys(active.start).some((key) => active.start[key as keyof VisualImageTransform] !== active.latest[key as keyof VisualImageTransform])) {
      editor.onTransformImage(id, active.latest);
    }
  };
  const nudgeImage = (event: React.KeyboardEvent<SVGRectElement>) => {
    if (!image || !editor || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const distance = event.shiftKey ? 1 : 10;
    editor.onSelectImage(id);
    editor.onTransformImage(id, {
      x: clamp(image.x + (event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0), 0, 1080 - image.width),
      y: clamp(image.y + (event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0), 0, 1920 - image.height),
      width: image.width,
      height: image.height,
    });
  };
  const color = "color" in node ? resolveVisualColor(node.color, style) : resolveVisualColor("text", style);
  const rawFill = "fill" in node ? node.fill : undefined;
  const gradient = rawFill && typeof rawFill === "object" ? rawFill : null;
  const gradientId = `paint-${safeId(id)}`;
  const fill = gradient ? `url(#${gradientId})` : resolveVisualColor(typeof rawFill === "string" ? rawFill : undefined, style, "none");
  const stroke = "stroke" in node ? resolveVisualColor(node.stroke, style, "none") : "none";
  const fillDefinition = gradient ? <defs><linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox" gradientTransform={`rotate(${gradient.angle} .5 .5)`}>
    {gradient.stops.map((stop, index) => <stop key={index} offset={stop.offset} stopColor={resolveVisualColor(stop.color, style)} stopOpacity={stop.opacity ?? 1}/>)}</linearGradient></defs> : null;
  const semanticMotion = nodeMotion(actions, id, node, frame);
  const motionOffset = node.motion === "fall" ? { x: 0, y: progress * 220 }
    : node.motion === "rise" ? { x: 0, y: -progress * 180 }
      : node.motion === "flow" ? { x: progress * 96, y: progress * 56 }
        : node.motion === "drift" ? { x: Math.sin(frame / 22) * 9, y: Math.cos(frame / 26) * 7 } : { x: 0, y: 0 };
  const positionedNode = imageFrame ?? node;
  const transform = `translate(${positionedNode.x + motionOffset.x + semanticMotion.translateX} ${positionedNode.y + motionOffset.y + semanticMotion.translateY}) rotate(${(positionedNode.rotation ?? 0) + semanticMotion.rotation} ${positionedNode.width/2} ${positionedNode.height/2}) translate(${positionedNode.width/2} ${positionedNode.height/2}) scale(${semanticMotion.scale}) translate(${-positionedNode.width/2} ${-positionedNode.height/2})`;
  const wrapperProps = { transform, opacity: (node.opacity ?? 1) * semanticMotion.opacity };
  switch (node.type) {
    case "shape":
      if (node.shape === "ellipse" || node.shape === "circle") return <g {...wrapperProps}>{fillDefinition}<ellipse cx={node.width/2} cy={node.height/2} rx={node.width/2} ry={node.shape === "circle" ? Math.min(node.width,node.height)/2 : node.height/2} fill={fill} stroke={stroke} strokeWidth={node.strokeWidth}/></g>;
      if (node.shape === "line") return <g {...wrapperProps}>{fillDefinition}<line x1="0" y1={node.height/2} x2={node.width} y2={node.height/2} stroke={stroke === "none" ? fill : stroke} strokeWidth={node.strokeWidth ?? 4}/></g>;
      if (node.shape === "polygon") return <g {...wrapperProps}>{fillDefinition}<polygon points={node.points!.map(point=>`${point.x*node.width},${point.y*node.height}`).join(" ")} fill={fill} stroke={stroke} strokeWidth={node.strokeWidth}/></g>;
      return <g {...wrapperProps}>{fillDefinition}<rect width={node.width} height={node.height} rx={node.radius ?? 0} fill={fill} stroke={stroke} strokeWidth={node.strokeWidth}/></g>;
    case "path": {
      const drawProgress = semanticMotion.drawProgress ?? (node.motion === "draw" ? processProgress ?? progress : undefined);
      return <g {...wrapperProps}>{fillDefinition}<svg width={node.width} height={node.height} viewBox="0 0 100 100" preserveAspectRatio="none"><path d={node.d} fill={fill} stroke={stroke} strokeWidth={node.strokeWidth} fillRule={node.fillRule} pathLength={drawProgress !== undefined ? 1 : undefined} strokeDasharray={drawProgress !== undefined ? 1 : undefined} strokeDashoffset={drawProgress !== undefined ? 1 - drawProgress : undefined}/></svg></g>;
    }
    case "text": {
      const lines = textLines(node.text, node.width, node.height, node.fontSize);
      const anchor = node.align === "start" ? "start" : node.align === "end" ? "end" : "middle";
      const x = node.align === "start" ? 0 : node.align === "end" ? node.width : node.width/2;
      return <g {...wrapperProps}>{lines.map((line,index)=><text key={index} x={x} y={node.fontSize*(index+1)} textAnchor={anchor} fontFamily={node.font === "mono" ? "monospace" : node.font === "heading" ? style.headingFont : style.bodyFont} fontSize={node.fontSize} fontWeight={node.weight} fill={color}>{line}</text>)}</g>;
    }
    case "icon": return <g {...wrapperProps}><svg width={node.width} height={node.height} viewBox="0 0 100 100"><IconShape icon={node.icon} color={color}/></svg></g>;
    case "image": {
      const rendered = imageFrame!;
      const file = rendered.asset.startsWith("upload-") ? `visual-assets/${rendered.asset.slice(7)}` : `assets/${assetFiles[rendered.asset as keyof typeof assetFiles]}`;
      const position = rendered.position ?? "center";
      const vertical = position.split("-").find((part) => part === "top" || part === "bottom") ?? "mid";
      const horizontal = position.split("-").find((part) => part === "left" || part === "right") ?? "mid";
      const align = (value: string | undefined) => value === "left" ? "xMin" : value === "right" ? "xMax" : "xMid";
      const verticalAlign = vertical === "top" ? "YMin" : vertical === "bottom" ? "YMax" : "YMid";
      const preserveAspectRatio = `${align(horizontal)}${verticalAlign} ${rendered.fit === "cover" ? "slice" : "meet"}`;
      const selected = editor?.selectedImageId === id;
      const resizeHandleSize = Math.max(24, Math.min(96, Math.min(rendered.width, rendered.height) * 0.12));
      const resizeHandleX = Math.max(0, rendered.width - Math.min(144, rendered.width * 0.25) - resizeHandleSize / 2);
      const resizeHandleY = Math.max(0, rendered.height - Math.min(144, rendered.height * 0.25) - resizeHandleSize / 2);
      return <g {...wrapperProps}>
        <image href={staticFile(file)} width={rendered.width} height={rendered.height} preserveAspectRatio={preserveAspectRatio}/>
        {editor && <rect
          x="0" y="0" width={rendered.width} height={rendered.height} fill="transparent" pointerEvents="all"
          role="button" tabIndex={0}
          aria-label={selected ? "Ilustrasi dipilih. Seret untuk memindahkan; gunakan panah untuk menggeser." : "Pilih dan seret ilustrasi"}
          style={{ cursor: "move", touchAction: "none" }}
          onPointerDown={(event) => beginImageGesture(event, "move")}
          onPointerMove={moveImageGesture} onPointerUp={finishImageGesture} onPointerCancel={finishImageGesture} onKeyDown={nudgeImage}
        />}
        {selected && <><rect x="0" y="0" width={rendered.width} height={rendered.height} fill="none" stroke={style.palette.primary} strokeWidth="8" strokeDasharray="18 12" pointerEvents="none"/><rect x={resizeHandleX} y={resizeHandleY} width={resizeHandleSize} height={resizeHandleSize} rx={resizeHandleSize * 0.2} fill={style.palette.canvas} stroke={style.palette.primary} strokeWidth="8" pointerEvents="all" role="button" tabIndex={0} aria-label="Ubah ukuran ilustrasi" data-editor-handle="resize" style={{ cursor: "nwse-resize", touchAction: "none" }} onPointerDown={(event) => beginImageGesture(event, "resize")} onPointerMove={moveImageGesture} onPointerUp={finishImageGesture} onPointerCancel={finishImageGesture}/></>}
      </g>;
    }
    case "diagram": return <g {...wrapperProps}><svg width={node.width} height={node.height} viewBox="0 0 100 100"><Diagram kind={node.kind} labels={node.labels} color={color} accent={resolveVisualColor(node.accent, style, resolveVisualColor("accent", style))}/></svg></g>;
  }
}

function MotionPathOverlay({ actions, frame, editor, style }: { actions: MotionAction[]; frame: number; editor?: VideoEditorInteractions; style: VisualStyle }) {
  const selected = editor?.selectedMotionPath;
  const [draftPoints, setDraftPoints] = React.useState<NonNullable<MotionAction["path"]> | null>(null);
  const gesture = React.useRef<{ index: number; pointerId: number; inverse: DOMMatrix; start: NonNullable<MotionAction["path"]>[number] } | null>(null);
  React.useEffect(() => setDraftPoints(null), [selected?.actionId]);
  const pointFromEvent = (event: React.PointerEvent<SVGCircleElement>, inverse: DOMMatrix) => {
    const point = event.currentTarget.ownerSVGElement?.createSVGPoint();
    if (!point) return null;
    point.x = event.clientX; point.y = event.clientY;
    const local = point.matrixTransform(inverse);
    return { x: Math.round(Math.max(0, Math.min(1080, local.x))), y: Math.round(Math.max(0, Math.min(1920, local.y))) };
  };
  const movePoint = (index: number, point: { x: number; y: number }) => {
    if (!selected) return;
    setDraftPoints((current) => (current ?? selected.points).map((entry, entryIndex) => entryIndex === index ? point : entry));
  };
  const finishPoint = (event: React.PointerEvent<SVGCircleElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId || !selected) return;
    const point = pointFromEvent(event, active.inverse);
    gesture.current = null;
    if (point && (point.x !== active.start.x || point.y !== active.start.y)) editor?.onTransformMotionPathPoint?.(active.index, point);
    setDraftPoints(null);
  };
  const visiblePoints = selected ? draftPoints ?? selected.points : [];
  return <g className="motion-path-overlays">
    {actions.filter((action) => action.path && action.pathStyle).map((action) => {
      const p = motionPathProgress(action, frame);
      const fadeOut = Math.max(0, Math.min(1, (action.startFrame + action.durationFrames + 12 - frame) / 12));
      if (fadeOut <= 0) return null;
      const points = action.path!.map((point) => `${point.x},${point.y}`).join(" ");
      const color = action.pathStyle === "smoke" ? "#c8d0d8" : action.pathStyle === "highlight" ? style.palette.accent : "#ff7a2d";
      const width = action.pathStyle === "lava" ? 54 : action.pathStyle === "magma" ? 24 : 12;
      if (action.pathStyle === "smoke" || action.pathStyle === "particles") return <g key={action.id} pointerEvents="none">
        {action.pathStyle === "smoke" && Array.from({ length: 6 }, (_, index) => {
          const age = p - index * 0.13;
          if (age < 0 || age > 0.52) return null;
          const life = age / 0.52;
          const point = pointAlongPolyline(action.path!, age);
          return <circle key={index} cx={point.x + Math.sin(frame / 19 + index) * (4 + life * 8)} cy={point.y - life * 12} r={12 + life * 15} fill={color} opacity={Math.sin(life * Math.PI) * 0.48 * fadeOut}/>;
        })}
      </g>;
      return <g key={action.id} pointerEvents="none" style={{ filter: "drop-shadow(0 0 14px rgba(255, 116, 35, .62))" }}>
        <polyline points={points} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - p} opacity={(action.pathStyle === "highlight" ? .72 : .82) * fadeOut}/>
        {action.pathStyle === "magma" && <polyline points={points} fill="none" stroke="#ffd080" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - p} opacity={fadeOut}/>}
      </g>;
    })}
    {selected && visiblePoints.length > 1 && <g aria-label="Titik jalur gerak terpilih">
      <polyline points={visiblePoints.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={style.palette.accent} strokeWidth="8" strokeDasharray="16 12" strokeLinecap="round" strokeLinejoin="round" opacity=".85" pointerEvents="none"/>
      {visiblePoints.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="24" fill={style.palette.canvas} stroke={style.palette.primary} strokeWidth="8" role="slider" aria-valuemin={0} aria-valuemax={1080} aria-valuenow={point.x} aria-valuetext={`x ${point.x}, y ${point.y}`} tabIndex={0} aria-label={`Titik jalur ${index + 1}: x ${point.x}, y ${point.y}. Seret atau gunakan tombol panah untuk mengubah.`} data-motion-path-point={index} style={{ cursor: "grab", touchAction: "none" }}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          const parent = event.currentTarget.parentElement as SVGGraphicsElement | null;
          const transform = parent?.getScreenCTM();
          if (!transform) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          gesture.current = { index, pointerId: event.pointerId, inverse: transform.inverse(), start: point };
        }}
        onPointerMove={(event) => { const active = gesture.current; if (active?.pointerId === event.pointerId) { const next = pointFromEvent(event, active.inverse); if (next) movePoint(index, next); } }}
        onPointerUp={finishPoint} onPointerCancel={(event) => {
          if (gesture.current?.pointerId !== event.pointerId) return;
          gesture.current = null;
          setDraftPoints(null);
        }}
        onKeyDown={(event) => {
          const delta = event.shiftKey ? 1 : 10;
          const x = point.x + (event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0);
          const y = point.y + (event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0);
          if (!event.key.startsWith("Arrow")) return;
          event.preventDefault();
          editor?.onTransformMotionPathPoint?.(index, { x: Math.max(0, Math.min(1080, x)), y: Math.max(0, Math.min(1920, y)) });
        }}
      />)}
    </g>}
  </g>;
}

export function VisualCompositionView({ scene, composition, style, preset, frame, progress, editor }: { scene: Scene; composition: VisualComposition; style: VisualStyle; preset: VisualPreset; frame: number; progress: number; editor?: VideoEditorInteractions }) {
  const layers = [...composition.layers].sort((a,b)=>a.depth-b.depth);
  const foregroundLayers = layers.filter((layer) => layer.depth > 0.1);
  const contentLayers = foregroundLayers.length ? foregroundLayers : layers;
  const backdropLayers = foregroundLayers.length ? layers.filter((layer) => layer.depth <= 0.1) : [];
  const framing = visualCompositionFrame(composition);
  const actions = scene.motionActions ?? [];
  const volcanoWorld = composition.layers.some((layer) => layer.id === "magma-reservoir") && composition.layers.some((layer) => layer.id === "magma-conduit");
  const cameraProgress = volcanoWorld ? Math.max(0, Math.min(1, (scene.order - 1 + progress) / 5)) : progress;
  const camera = visualCompositionCamera(preset, cameraProgress);
  const carried = (order: number, actionId: string) => carriedMotionProgress(scene.order, order, actions.find((action) => action.id === actionId), frame, progress);
  const reservoirProgress = volcanoWorld ? carried(2, "magma-storage-glow") : 0;
  const magmaProgress = volcanoWorld ? carried(3, "magma-rises") : 0;
  const eruptionProgress = volcanoWorld ? carried(4, "eruption-gas-plume") : 0;
  const lavaProgress = volcanoWorld ? carried(5, "lava-and-deposits") : 0;
  const depositProgress = Math.max(0, Math.min(1, (lavaProgress - 0.32) / 0.68));
  const renderLayer = (layer: VisualComposition["layers"][number]) => {
    const motion = layerMotion(scene.motionPlan, layer.id, layer.depth, frame, progress);
    const backdropOffset = visualBackdropLayerOffset(preset, layer.depth, cameraProgress);
    motion.translateX += backdropOffset.x;
    motion.translateY += backdropOffset.y;
    motion.scale = Math.min(1.2, motion.scale * backdropOffset.scale);
    if (volcanoWorld && layer.id === "ash-cloud") {
      const smokeOpacity = scene.order < 4 ? 0 : scene.order === 4 ? 0.08 + eruptionProgress * 0.62 : scene.order === 5 ? 0.7 - lavaProgress * 0.38 : 0.32;
      motion.opacity *= smokeOpacity;
      motion.translateY -= (1 - eruptionProgress) * 36;
    }
    if (style.backdrop === "grid") {
      const entrance = Math.max(0, Math.min(1, (cameraProgress - layer.depth * 0.08) / 0.18));
      motion.opacity *= 0.72 + 0.28 * entrance;
    }
    const clipId = `reveal-${safeId(scene.id)}-${safeId(layer.id)}`;
    const reservoirShapeClipId = `reservoir-shape-${safeId(scene.id)}`;
    const reservoirFillClipId = `reservoir-fill-${safeId(scene.id)}`;
    const processProgress = layer.id === "magma-core" ? magmaProgress : layer.id === "lava-flow" ? lavaProgress : layer.id === "deposits" ? depositProgress : undefined;
    const transform = `translate(${motion.translateX} ${motion.translateY}) translate(540 960) scale(${motion.scale}) translate(-540 -960)`;
    const nodes = layer.nodes.map((node, index) => ({ node, index })).sort((a,b)=>(a.node.zIndex??0)-(b.node.zIndex??0));
    const semanticActions = actions.filter((action) => action.targetNode.split("/")[0] === layer.id);
    const particles = semanticActions.flatMap((action) => {
      const count = action.particleCount ?? 0;
      if (action.kind !== "particle-flow" || !action.path || !count || action.pathStyle === "highlight") return [];
        const actionProgress = motionActionProgress(action, frame);
        if (actionProgress === null) return [];
        return Array.from({ length: count }, (_, index) => {
          const phase = actionProgress * 1.45 - index * 0.14;
          if (phase < 0 || phase > 1) return null;
          const opacity = Math.max(0, Math.min(1, phase / 0.08, (1 - phase) / 0.08, (1 - actionProgress) / 0.12));
          return { action, index, opacity, ...pointAlongPolyline(action.path!, phase) };
        }).filter((particle): particle is NonNullable<typeof particle> => particle !== null);
      });
    const depthShadow = layer.depth > 0.25 ? `drop-shadow(0 ${Math.round(4 + layer.depth * 8)}px ${Math.round(4 + layer.depth * 6)}px rgba(4, 22, 31, 0.2))` : undefined;
    const reservoirGlow = volcanoWorld && layer.id === "magma-reservoir" && reservoirProgress > 0
      ? `drop-shadow(0 0 ${Math.round(8 + reservoirProgress * 18)}px rgba(255, 112, 48, ${0.22 + reservoirProgress * 0.38}))`
      : undefined;
    const filters = [depthShadow, reservoirGlow].filter(Boolean).join(" ");
    const reservoirClip = volcanoWorld && layer.id === "magma-reservoir";
    const fillTop = 1635 - 175 * reservoirProgress;
    return <g key={layer.id} opacity={motion.opacity} transform={transform} style={filters ? { filter: filters } : undefined}>
      {motion.reveal < 1 && <defs><clipPath id={clipId}><rect x="0" y="0" width={1080*motion.reveal} height="1920"/></clipPath></defs>}
      {reservoirClip && <defs>
        <clipPath id={reservoirShapeClipId}><ellipse cx="540" cy="1547.5" rx="170" ry="87.5"/></clipPath>
        <clipPath id={reservoirFillClipId}><rect x="350" y={fillTop} width="380" height={Math.max(0, 175 * reservoirProgress)}/></clipPath>
      </defs>}
      <g clipPath={motion.reveal < 1 ? `url(#${clipId})` : undefined}>
       <g clipPath={reservoirClip ? `url(#${reservoirShapeClipId})` : undefined}>
        <g clipPath={reservoirClip ? `url(#${reservoirFillClipId})` : undefined}>
        {nodes.map(({ node, index })=>{
            if (node.type !== "group") return <LeafNode key={`${node.type}-${index}`} id={`${layer.id}/${index}`} node={node} style={style} frame={frame} progress={progress} processProgress={processProgress} actions={actions} editor={editor}/>;
            const groupRef = `${layer.id}/${index}`;
            const groupMotion = nodeMotion(actions, groupRef, node, frame);
            const groupTransform = `translate(${node.x + groupMotion.translateX} ${node.y + groupMotion.translateY}) rotate(${(node.rotation??0) + groupMotion.rotation} ${node.width/2} ${node.height/2}) translate(${node.width/2} ${node.height/2}) scale(${groupMotion.scale}) translate(${-node.width/2} ${-node.height/2}) scale(${node.width/1080} ${node.height/1920})`;
             return <g key={`group-${index}`} transform={groupTransform} opacity={(node.opacity??1) * groupMotion.opacity}>{node.children.map((child,childIndex)=><LeafNode key={`${child.type}-${childIndex}`} id={`${layer.id}/${index}.${childIndex}`} node={child} style={style} frame={frame} progress={progress} actions={actions} editor={editor}/>)}</g>;
         })}
        {particles.map((particle) => <circle key={`${particle.action.id}-${particle.index}`} cx={particle.x} cy={particle.y} r={particle.action.pathStyle === "magma" || particle.action.pathStyle === "lava" ? 12 : particle.action.pathStyle === "smoke" ? 7 : particle.action.id.includes("uv") ? 6 : 8} fill={particle.action.pathStyle === "magma" || particle.action.pathStyle === "lava" ? "#ffd080" : particle.action.pathStyle === "smoke" ? "#d7dde2" : resolveVisualColor("accent", style)} opacity={particle.opacity * 0.92} pointerEvents="none"/>)}
        </g>
       </g>
      </g>
    </g>;
  };
  return <>
    <rect width="1080" height="1920" fill={resolveVisualColor(composition.background, style)}/>
    {backdropLayers.map(renderLayer)}
    <g transform={`translate(${540 + camera.x} ${990 + camera.y}) scale(${camera.scale}) translate(-540 -990) translate(${framing.translateX} ${framing.translateY}) scale(${framing.scale})`}>
      {contentLayers.map(renderLayer)}
      <MotionPathOverlay actions={scene.motionActions ?? []} frame={frame} editor={editor} style={style}/>
    </g>
  </>;
}

export { IconShape };
