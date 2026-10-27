import React from "react";
import { AbsoluteFill, Audio, interpolate, staticFile, useCurrentFrame } from "remotion";
import { captionSegmentsForScene } from "../domain/captions";
import { timelineDuration, sceneTimes } from "../domain/timeline";
import type { ResearchPackage, Scene } from "../domain/research";
import type { VideoProps } from "./types";
import type { VideoEditorInteractions } from "./types";
import { sceneTransitionOpacity } from "./motion";
import { rendererRegistry } from "./renderer-registry";
import { visualStyles } from "./style-config";
import { RENDERER_VERSION } from "./renderer-version";

function wrapText(text: string, width: number, maxLines: number) {
  const lines: string[] = [];
  let line = "";
  const words = text.trim().split(/\s+/).flatMap((word) => {
    const chars = [...word];
    return chars.length <= width ? [word] : Array.from({ length: Math.ceil(chars.length / width) }, (_, index) => chars.slice(index * width, (index + 1) * width).join(""));
  });
  for (const word of words) {
    if (line && `${line} ${word}`.length > width) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1]!.replace(/[.…]*$/, "")}…`;
  }
  return lines;
}

function captionLine(line: string, emphasis: string[], accent: string) {
  const tokens = new Set(emphasis.map((word) => word.toLocaleLowerCase()));
  return line.split(/(\s+)/).map((word, index) => {
    const normalized = word.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    return <tspan key={index} fill={tokens.has(normalized) ? accent : undefined} fontWeight={tokens.has(normalized) ? "800" : undefined}>{word}</tspan>;
  });
}

function SceneVisual({ scene, preset, progress, frame, opacity, editor }: { scene: Scene; preset: ResearchPackage["visualPreset"]; progress: number; frame: number; opacity: number; editor?: VideoEditorInteractions }) {
  const definition = rendererRegistry[scene.templateId];
  if (!definition) throw new Error(`No renderer registered for template '${scene.templateId}'.`);
  const Renderer = definition.component;
  const renderScene = scene.visualComposition ? scene : { ...scene, visualComposition: definition.defaultComposition() };
  return <g opacity={opacity}>
    <Renderer scene={renderScene} composition={renderScene.visualComposition} preset={preset} frame={frame} progress={progress} editor={editor}/>
  </g>;
}

function PresetDecorations({ preset, time }: { preset: ResearchPackage["visualPreset"]; time: number }) {
  if (preset === "animated-infographic") return <g pointerEvents="none" opacity=".12">
    <defs><pattern id="engine-grid" width="80" height="80" patternUnits="userSpaceOnUse"><path d="M80 0H0V80" fill="none" stroke="#087f8c" strokeWidth="1"/></pattern></defs>
    <rect width="1080" height="1920" fill="url(#engine-grid)"/>
    <path d="M82 380H210M870 1480H998" stroke="#ed8653" strokeWidth="8" strokeLinecap="round"/>
  </g>;
  if (preset === "cinematic-parallax") return <g pointerEvents="none">
    <defs><linearGradient id="engine-light" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#ffffff" stopOpacity=".04"/><stop offset=".6" stopColor="#0a1921" stopOpacity=".02"/><stop offset="1" stopColor="#07131d" stopOpacity=".44"/></linearGradient></defs>
    {[0,1,2,3,4,5,6,7].map((star)=><circle key={star} cx={(star*191+73)%1080} cy={(star*233+101)%590} r={star%3+2} fill="#fff8e6" opacity={.3+((star%2)*.14)}/>) }
    <rect width="1080" height="1920" fill="url(#engine-light)"/>
  </g>;
  return <g pointerEvents="none" opacity=".08"><path d={`M0 ${760+Math.sin(time*.2)*10} Q540 690 1080 ${760-Math.sin(time*.2)*10}`} fill="none" stroke="#ffffff" strokeWidth="2"/></g>;
}

function findSceneIndex(research: ResearchPackage, durationSec: number, time: number, audioTimingMode?: "scaled" | "estimated") {
  const current = research.scenes.findIndex((scene) => {
    const span = sceneTimes(research, scene, durationSec, audioTimingMode);
    return time >= span.startSec && time < span.endSec;
  });
  if (current >= 0) return current;
  const next = research.scenes.findIndex((scene) => sceneTimes(research, scene, durationSec, audioTimingMode).startSec > time);
  return next < 0 ? research.scenes.length - 1 : Math.max(0, next - 1);
}

export const MotionGraphicsVideo: React.FC<VideoProps> = ({ research, audioFile, audioDurationSec, audioTimingMode, editor }) => {
  const frame = useCurrentFrame();
  const fps = 30;
  const durationSec = timelineDuration(research, audioDurationSec);
  const time = frame / fps;
  const style = visualStyles[research.visualPreset];
  if (!research.scenes.length) return <AbsoluteFill style={{ backgroundColor: style.palette.canvas }} />;

  const activeIndex = findSceneIndex(research, durationSec, time, audioTimingMode);
  const scene = research.scenes[activeIndex]!;
  const span = sceneTimes(research, scene, durationSec, audioTimingMode);
  const localFrame = Math.max(0, frame - Math.floor(span.startSec * fps));
  const progress = Math.max(0, Math.min(1, (time - span.startSec) / Math.max(.01, span.endSec - span.startSec)));
  const transitionPlan = scene.motionPlan.find((plan) => plan.cue === "dissolve");
  const transition = sceneTransitionOpacity(scene.motionPlan, localFrame);
  const titleLines = wrapText(scene.onScreenText, 42, 3);
  const captionSegments = captionSegmentsForScene(scene);
  const activeCaption = captionSegments.find((segment) => progress >= segment.startProgress && progress < segment.endProgress) ?? captionSegments.at(-1);
  const captionLines = activeCaption ? wrapText(activeCaption.text, 36, 2) : [];
  const captionSpan = activeCaption ? activeCaption.endProgress - activeCaption.startProgress : 1;
  const captionFade = activeCaption ? Math.min(0.08, captionSpan / 3) : 1;
  const captionOpacity = activeCaption ? Math.min(
    Math.max(0, Math.min(1, (progress - activeCaption.startProgress) / captionFade)),
    Math.max(0, Math.min(1, (activeCaption.endProgress - progress) / captionFade)),
  ) : 0;
  const titleY = style.safeArea.top + style.spacing.titleTopOffset;
  const titleFontSize = titleLines.length > 2 ? 32 : titleLines.length > 1 ? 38 : style.titleFontSize;
  const headerY = style.safeArea.top + style.spacing.headerTopOffset;
  const categoryY = style.safeArea.top + style.spacing.categoryTopOffset;
  const sceneLabelY = 1920 - style.safeArea.bottom + style.spacing.sceneLabelOffset;
  const captionY = sceneLabelY + style.spacing.captionOffset;
  const progressY = 1920 - style.spacing.progressBottomInset;
  const footerY = 1920 - style.spacing.footerBottomInset;
  const titleEntrance = interpolate(frame, [span.startSec * fps, span.startSec * fps + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const previous = activeIndex > 0 && transitionPlan && transition < 1 ? research.scenes[activeIndex - 1] : undefined;

  return <AbsoluteFill style={{ backgroundColor: style.palette.canvas, color: style.palette.text, fontFamily: style.bodyFont, overflow: "hidden" }}>
    <svg width="100%" height="100%" viewBox="0 0 1080 1920" preserveAspectRatio="xMidYMid slice" aria-label={`${research.title}, scene ${activeIndex + 1}`}>
      <defs>
        <linearGradient id="engine-sky" x1="0" y1="0" x2="0" y2="1"><stop stopColor={style.palette.canvas}/><stop offset="1" stopColor={style.palette.surface}/></linearGradient>
        <linearGradient id="caption-shade" x1="0" y1="0" x2="0" y2="1"><stop stopColor={style.palette.canvas} stopOpacity="0"/><stop offset="1" stopColor={style.palette.canvas} stopOpacity=".92"/></linearGradient>
      </defs>
      <rect width="1080" height="1920" fill="url(#engine-sky)"/>
       {previous && <SceneVisual key={`prev-${previous.id}`} scene={previous} preset={research.visualPreset} progress={1} frame={Math.max(0, Math.floor((sceneTimes(research, previous, durationSec, audioTimingMode).endSec)*fps))} opacity={1-transition}/>}
       <SceneVisual key={scene.id} scene={scene} preset={research.visualPreset} progress={progress} frame={localFrame} opacity={transition} editor={editor?.sceneId === scene.id ? editor : undefined}/>
      <PresetDecorations preset={research.visualPreset} time={time}/>
      <rect x="0" y="0" width="1080" height="510" fill="url(#caption-shade)" opacity=".72"/>
      <rect x="0" y="1510" width="1080" height="410" fill="url(#caption-shade)"/>
      <text x={style.safeArea.left} y={headerY} fill={style.palette.primary} fontSize="23" fontWeight="700" letterSpacing="4">AI FACTS STUDIO</text>
      <text x={1080-style.safeArea.right} y={headerY} textAnchor="end" fill={style.palette.muted} fontSize="21">{`${String(Math.floor(time/60)).padStart(2,"0")}:${String(Math.floor(time%60)).padStart(2,"0")}`}</text>
      <g opacity={titleEntrance} transform={`translate(0 ${interpolate(titleEntrance,[0,1],[24,0])})`}>
        <text x={style.safeArea.left} y={categoryY} fill={style.palette.accent} fontSize="22" fontWeight="700" letterSpacing="3">{research.category.toUpperCase()}</text>
        {titleLines.map((line,index)=><text key={index} x={style.safeArea.left} y={titleY+index*(titleFontSize+style.spacing.titleLineGap)} fill={style.palette.text} fontFamily={style.headingFont} fontSize={titleFontSize} fontWeight="800" stroke={style.palette.canvas} strokeOpacity=".28" strokeWidth="2" paintOrder="stroke">{line}</text>)}
      </g>
      <text x={style.safeArea.left} y={sceneLabelY} fill={style.palette.primary} fontSize="20" fontWeight="700" letterSpacing="3">{`SCENE ${String(activeIndex+1).padStart(2,"0")} / ${String(research.scenes.length).padStart(2,"0")}`}</text>
      <g opacity={captionOpacity} transform={`translate(0 ${interpolate(captionOpacity,[0,1],[8,0])})`}>
        {captionLines.map((line,index)=><text key={index} x={style.safeArea.left} y={captionY+index*style.spacing.captionLineGap} fill={style.palette.text} fontSize={style.captionFontSize+8} fontWeight="600" stroke={style.palette.canvas} strokeWidth="4" paintOrder="stroke">{captionLine(line, activeCaption?.emphasis ?? [], style.palette.accent)}</text>)}
      </g>
      <rect x={style.safeArea.left} y={progressY} width={1080-style.safeArea.left-style.safeArea.right} height="3" rx="2" fill={style.palette.muted} opacity=".35"/>
      <rect x={style.safeArea.left} y={progressY-2} width={(1080-style.safeArea.left-style.safeArea.right)*Math.max(0,Math.min(1,time/durationSec))} height="6" rx="3" fill={style.palette.accent}/>
      <text x={1080-style.safeArea.right} y={footerY} textAnchor="end" fill={style.palette.muted} fontSize="17">{research.title}</text>
    </svg>
    {audioFile ? <Audio src={staticFile(audioFile)} /> : null}
  </AbsoluteFill>;
};

export function previewInputProps(research: ResearchPackage, audioFile?: string, audioDurationSec?: number, audioTimingMode?: "scaled" | "estimated", rendererVersion = RENDERER_VERSION): VideoProps {
  return { research, audioFile, audioDurationSec, audioTimingMode, rendererVersion };
}
