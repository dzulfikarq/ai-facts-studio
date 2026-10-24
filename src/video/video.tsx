import React from "react";
import { AbsoluteFill, Audio, interpolate, staticFile, useCurrentFrame } from "remotion";
import { timelineDuration, sceneTimes } from "../domain/timeline";
import type { ResearchPackage } from "../domain/research";
import type { VideoProps } from "./root";
import { SceneArtwork } from "./artwork";

const wrapCaption = (text: string, max = 38) => {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length > max && line) {
      lines.push(line);
      line = word;
    } else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
};

export const MountainVideo: React.FC<VideoProps> = ({ research, audioFile, audioDurationSec, audioTimingMode }) => {
  const frame = useCurrentFrame();
  const fps = 30;
  const durationSec = timelineDuration(research, audioDurationSec);
  const time = frame / fps;
  if (!research.scenes.length) return <AbsoluteFill style={{ backgroundColor: "#102b38" }} />;
  const foundIndex = research.scenes.findIndex((scene) => {
    const span = sceneTimes(research, scene, durationSec, audioTimingMode);
    return time >= span.startSec && time < span.endSec;
  });
  const nextIndex = research.scenes.findIndex((candidate) => sceneTimes(research, candidate, durationSec, audioTimingMode).startSec > time);
  const activeIndex = foundIndex >= 0 ? foundIndex : nextIndex < 0 ? research.scenes.length - 1 : Math.max(0, nextIndex - 1);
  const scene = research.scenes[activeIndex]!;
  const span = sceneTimes(research, scene, durationSec, audioTimingMode);
  const progress = Math.max(0, Math.min(1, (time - span.startSec) / Math.max(0.01, span.endSec - span.startSec)));
  const entrance = interpolate(time, [span.startSec, span.startSec + 0.55], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const captionLines = wrapCaption(scene.narrationText);
  const tick = `${Math.floor(time / 60).toString().padStart(2, "0")}:${Math.floor(time % 60).toString().padStart(2, "0")}`;

  return <AbsoluteFill style={{ backgroundColor: "#102b38", color: "#fff5df", fontFamily: "Arial, sans-serif", overflow: "hidden" }}>
    <svg width="100%" height="100%" viewBox="0 0 1080 1920" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="sky" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#102b38"/><stop offset=".55" stopColor="#235564"/><stop offset="1" stopColor="#d9875a"/></linearGradient>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#102b38" stopOpacity=".06"/><stop offset=".58" stopColor="#102b38" stopOpacity=".04"/><stop offset="1" stopColor="#071922" stopOpacity=".78"/></linearGradient>
        <marker id="arrow" markerWidth="12" markerHeight="12" refX="8" refY="6" orient="auto"><path d="M0 0 L10 6 L0 12" fill="none" stroke="#fff1d4" strokeWidth="2" /></marker>
      </defs>
      <rect width="1080" height="1920" fill="url(#sky)" />
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((star) => <circle key={star} cx={(star * 173 + 71) % 1080} cy={(star * 211 + 180) % 890} r={(star % 3) * 2 + 2} fill="#fff4d7" opacity=".48" />)}
      <g opacity={entrance} transform={`translate(0 ${interpolate(entrance, [0, 1], [40, 0])})`}>
        <SceneArtwork scene={scene} progress={progress} />
      </g>
      <rect width="1080" height="1920" fill="url(#shade)" />
      <text x="78" y="116" fill="#8ed8cd" fontSize="24" fontWeight="700" letterSpacing="5">AI FACTS STUDIO</text>
      <text x="1002" y="116" textAnchor="end" fill="#d9e9e4" fontSize="23">{tick}</text>
      <text x="78" y="228" fill="#f6b875" fontSize="24" fontWeight="700" letterSpacing="4">{research.category.toUpperCase()}</text>
      <text x="78" y="302" fill="#fff7e7" fontSize="46" fontWeight="700">{scene.onScreenText}</text>
      <rect x="78" y="326" width="94" height="8" rx="4" fill="#6bc7bc" />
      <rect x="78" y="1760" width="924" height="2" fill="#ffffff" opacity=".32" />
      <rect x="78" y="1760" width={924 * Math.max(0, Math.min(1, time / durationSec))} height="4" rx="2" fill="#71d1c2" />
      <text x="78" y="1700" fill="#8ed8cd" fontSize="22" fontWeight="700" letterSpacing="3">{`SCENE ${String(activeIndex + 1).padStart(2, "0")} / ${String(research.scenes.length).padStart(2, "0")}`}</text>
      {captionLines.map((line, index) => <text key={index} x="78" y={1812 + index * 49} fill="#fff9ed" fontSize="32" fontWeight="600" stroke="#102b38" strokeWidth="4" paintOrder="stroke">{line}</text>)}
      <text x="1002" y="1904" textAnchor="end" fill="#c3d5d0" fontSize="20">{research.title}</text>
    </svg>
    {audioFile ? <Audio src={staticFile(audioFile)} /> : null}
  </AbsoluteFill>;
};

export function previewInputProps(research: ResearchPackage, audioFile?: string, audioDurationSec?: number, audioTimingMode?: "scaled" | "estimated"): VideoProps {
  return { research, audioFile, audioDurationSec, audioTimingMode };
}
