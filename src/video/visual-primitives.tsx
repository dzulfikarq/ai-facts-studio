import React from "react";
import { staticFile } from "remotion";
import type { VisualComposition, VisualNode } from "../domain/visual-composition";
import type { Scene } from "../domain/research";
import { layerMotion } from "./motion";
import { resolveVisualColor, type VisualStyle } from "./style-config";

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
  return <>
    <circle cx="50" cy="22" r="10" fill={accent}/><path d="M50 34v26m-7-8 7 8 7-8M45 66c-14-17-28-4-22 8 3 7 11 7 15 3m9-11c14-17 28-4 22 8-3 7-11 7-15 3" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"/>
    {labels.slice(0,3).map((label,index)=><Label key={label} x={50} y={84+index*6}>{label}</Label>)}
  </>;
}

function LeafNode({ node, style }: { node: Exclude<VisualNode, { type: "group" }>; style: VisualStyle }) {
  const color = "color" in node ? resolveVisualColor(node.color, style) : resolveVisualColor("text", style);
  const fill = "fill" in node ? resolveVisualColor(node.fill, style, "none") : "none";
  const stroke = "stroke" in node ? resolveVisualColor(node.stroke, style, "none") : "none";
  const transform = `translate(${node.x} ${node.y}) rotate(${node.rotation ?? 0} ${node.width/2} ${node.height/2})`;
  const wrapperProps = { transform, opacity: node.opacity ?? 1 };
  switch (node.type) {
    case "shape":
      if (node.shape === "ellipse" || node.shape === "circle") return <g {...wrapperProps}><ellipse cx={node.width/2} cy={node.height/2} rx={node.width/2} ry={node.shape === "circle" ? Math.min(node.width,node.height)/2 : node.height/2} fill={fill} stroke={stroke} strokeWidth={node.strokeWidth}/></g>;
      if (node.shape === "line") return <g {...wrapperProps}><line x1="0" y1={node.height/2} x2={node.width} y2={node.height/2} stroke={stroke === "none" ? fill : stroke} strokeWidth={node.strokeWidth ?? 4}/></g>;
      if (node.shape === "polygon") return <g {...wrapperProps}><polygon points={node.points!.map(point=>`${point.x*node.width},${point.y*node.height}`).join(" ")} fill={fill} stroke={stroke} strokeWidth={node.strokeWidth}/></g>;
      return <g {...wrapperProps}><rect width={node.width} height={node.height} rx={node.radius ?? 0} fill={fill} stroke={stroke} strokeWidth={node.strokeWidth}/></g>;
    case "path": return <g {...wrapperProps}><svg width={node.width} height={node.height} viewBox="0 0 100 100" preserveAspectRatio="none"><path d={node.d} fill={fill} stroke={stroke} strokeWidth={node.strokeWidth} fillRule={node.fillRule}/></svg></g>;
    case "text": {
      const lines = textLines(node.text, node.width, node.height, node.fontSize);
      const anchor = node.align === "start" ? "start" : node.align === "end" ? "end" : "middle";
      const x = node.align === "start" ? 0 : node.align === "end" ? node.width : node.width/2;
      return <g {...wrapperProps}>{lines.map((line,index)=><text key={index} x={x} y={node.fontSize*(index+1)} textAnchor={anchor} fontFamily={node.font === "mono" ? "monospace" : node.font === "heading" ? style.headingFont : style.bodyFont} fontSize={node.fontSize} fontWeight={node.weight} fill={color}>{line}</text>)}</g>;
    }
    case "icon": return <g {...wrapperProps}><svg width={node.width} height={node.height} viewBox="0 0 100 100"><IconShape icon={node.icon} color={color}/></svg></g>;
    case "image": return <g {...wrapperProps}><image href={staticFile(`assets/${assetFiles[node.asset]}`)} width={node.width} height={node.height} preserveAspectRatio="xMidYMid meet"/></g>;
    case "diagram": return <g {...wrapperProps}><svg width={node.width} height={node.height} viewBox="0 0 100 100"><Diagram kind={node.kind} labels={node.labels} color={color} accent={resolveVisualColor(node.accent, style, resolveVisualColor("accent", style))}/></svg></g>;
  }
}

export function VisualCompositionView({ scene, composition, style, frame, progress }: { scene: Scene; composition: VisualComposition; style: VisualStyle; frame: number; progress: number }) {
  const layers = [...composition.layers].sort((a,b)=>a.depth-b.depth);
  return <>
    <rect width="1080" height="1920" fill={resolveVisualColor(composition.background, style)}/>
    {layers.map((layer)=>{
      const motion = layerMotion(scene.motionPlan, layer.id, layer.depth, frame, progress);
      if (style.backdrop === "flat") {
        motion.translateX += Math.sin(progress * Math.PI * 2) * 7 * (0.5 - layer.depth);
        motion.translateY += Math.sin(progress * Math.PI) * 3 * (0.5 - layer.depth);
      } else if (style.backdrop === "grid") {
        const entrance = Math.max(0, Math.min(1, (progress - layer.depth * 0.08) / 0.18));
        motion.translateY += (1 - entrance) * 12;
        motion.opacity *= 0.76 + 0.24 * entrance;
      } else {
        motion.translateX += (0.5 - layer.depth) * 28 * progress;
        motion.scale = Math.min(1.2, motion.scale * (1 + 0.035 * progress));
      }
      const clipId = `reveal-${safeId(scene.id)}-${safeId(layer.id)}`;
      const transform = `translate(${motion.translateX} ${motion.translateY}) translate(540 960) scale(${motion.scale}) translate(-540 -960)`;
      const nodes = [...layer.nodes].sort((a,b)=>(a.zIndex??0)-(b.zIndex??0));
      return <g key={layer.id} opacity={motion.opacity} transform={transform}>
        {motion.reveal < 1 && <defs><clipPath id={clipId}><rect x="0" y="0" width={1080*motion.reveal} height="1920"/></clipPath></defs>}
        <g clipPath={motion.reveal < 1 ? `url(#${clipId})` : undefined}>
          {nodes.map((node,index)=>{
            if (node.type !== "group") return <LeafNode key={`${node.type}-${index}`} node={node} style={style}/>;
            const groupTransform = `translate(${node.x} ${node.y}) rotate(${node.rotation??0} ${node.width/2} ${node.height/2}) scale(${node.width/1080} ${node.height/1920})`;
            return <g key={`group-${index}`} transform={groupTransform} opacity={node.opacity??1}>{node.children.map((child,childIndex)=><LeafNode key={`${child.type}-${childIndex}`} node={child} style={style}/>)}</g>;
          })}
        </g>
      </g>;
    })}
  </>;
}

export { IconShape };
