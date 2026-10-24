import React from "react";
import { interpolate, spring, useCurrentFrame } from "remotion";
import type { Scene } from "../domain/research";

type Props = { scene: Scene; progress: number };

export const SceneArtwork: React.FC<Props> = ({ scene, progress }) => {
  const frame = useCurrentFrame();
  const fps = 30;
  const reveal = spring({ frame: Math.round(progress * fps * 8), fps, config: { damping: 18, stiffness: 55 }, durationInFrames: fps * 2 });
  const drift = interpolate(progress, [0, 1], [18, -18]);
  const pulse = 1 + Math.sin((frame / fps) * Math.PI * 1.4) * 0.015;

  if (scene.templateId === "plate-collision") {
    return <>
      <rect x="0" y="1220" width="1080" height="700" fill="#173f4a" />
      <path d="M0 1280 Q260 1190 510 1300 L510 1920 H0Z" fill="#bd7952" />
      <path d="M1080 1270 Q820 1195 570 1300 L570 1920 H1080Z" fill="#e0a16e" />
      <path d={`M${interpolate(progress, [0, 1], [0, 435])} 1335 L520 1210 L540 1920 L0 1920Z`} fill="#edb276" opacity=".8" />
      <path d={`M${1080 - interpolate(progress, [0, 1], [0, 435])} 1325 L560 1205 L540 1920 L1080 1920Z`} fill="#d99868" opacity=".85" />
      <path d={`M${440 - reveal * 90} 1310 Q530 ${1250 - reveal * 95} 620 1310`} fill="none" stroke="#ffe6b0" strokeWidth="24" strokeLinecap="round" />
      <path d={`M180 1130 L${420 + drift} 1130`} stroke="#fff1d4" strokeWidth="12" markerEnd="url(#arrow)" />
      <path d={`M900 1130 L${660 - drift} 1130`} stroke="#fff1d4" strokeWidth="12" markerEnd="url(#arrow)" />
      <text x="540" y="1510" textAnchor="middle" className="art-label">TUMBUKAN LEMPENG</text>
    </>;
  }

  if (scene.templateId === "folding-uplift") {
    return <>
      <rect x="0" y="1070" width="1080" height="850" fill="#244956" />
      {[0, 1, 2, 3, 4].map((layer) => {
        const lift = reveal * (layer * 20 + 50);
        return <path key={layer} d={`M-50 ${1590 - lift + layer * 76} C170 ${1370 - lift + layer * 70}, 270 ${1780 - lift + layer * 70}, 500 ${1515 - lift + layer * 70} S820 ${1440 - lift + layer * 70}, 1130 ${1560 - lift + layer * 70}`} fill="none" stroke={layer % 2 ? "#e69c66" : "#f0c07e"} strokeWidth="48" opacity={0.92 - layer * 0.08} />;
      })}
      <path d={`M190 1390 Q540 ${1050 - reveal * 100} 890 1390`} fill="#d9e8e5" />
      <path d={`M365 1300 Q540 ${1000 - reveal * 125} 715 1300`} fill="#f7f2dc" />
      <text x="540" y="1770" textAnchor="middle" className="art-label">LIPATAN TERANGKAT</text>
    </>;
  }

  if (scene.templateId === "volcano") {
    return <>
      <rect x="0" y="1220" width="1080" height="700" fill="#183e4a" />
      <circle cx="540" cy="1050" r={290 * pulse} fill="#ff844f" opacity=".14" />
      <path d="M90 1640 L410 1120 L480 1240 L535 1050 L610 1230 L690 1120 L1000 1640Z" fill="#433949" />
      <path d="M460 1170 Q540 1240 620 1170 L640 1250 Q540 1290 440 1250Z" fill="#ffb15f" />
      <path d="M540 1260 C490 1390 610 1450 530 1630" fill="none" stroke="#ff704c" strokeWidth="28" />
      <circle cx={interpolate(progress, [0, 1], [506, 450])} cy={interpolate(progress, [0, 1], [1020, 850])} r="17" fill="#ffbe6b" />
      <circle cx={interpolate(progress, [0, 1], [580, 650])} cy={interpolate(progress, [0, 1], [980, 790])} r="12" fill="#ffd27d" />
      <text x="540" y="1770" textAnchor="middle" className="art-label">MAGMA MEMBENTUK GUNUNG API</text>
    </>;
  }

  if (scene.templateId === "space-orbit" || scene.templateId === "infographic") {
    return <>
      <circle cx="540" cy="1310" r="310" fill="none" stroke="#9dc8c6" strokeWidth="3" opacity=".35" />
      <circle cx="540" cy="1310" r="220" fill="none" stroke="#9dc8c6" strokeWidth="3" opacity=".45" />
      <circle cx="540" cy="1310" r="102" fill="#ffb568" />
      <circle cx={540 + Math.cos(progress * Math.PI * 2) * 310} cy={1310 + Math.sin(progress * Math.PI * 2) * 310} r="34" fill="#73d3ca" />
      <circle cx={540 + Math.cos(progress * Math.PI * 2 + 2) * 220} cy={1310 + Math.sin(progress * Math.PI * 2 + 2) * 220} r="21" fill="#e8d4a2" />
      <text x="540" y="1770" textAnchor="middle" className="art-label">GERAK + GAYA</text>
    </>;
  }

  if (scene.templateId === "animal-habitat") {
    return <>
      <path d="M0 1350 Q200 1270 400 1360 Q650 1230 1080 1370 V1920 H0Z" fill="#dff1e9" />
      <path d="M0 1530 Q250 1470 540 1550 Q810 1470 1080 1530 V1920 H0Z" fill="#a9dcd5" />
      <g transform={`translate(${drift},0)`}>
        <ellipse cx="535" cy="1380" rx="205" ry="125" fill="#fffdf4" />
        <circle cx="700" cy="1285" r="96" fill="#fffdf4" />
        <circle cx="650" cy="1195" r="39" fill="#fffdf4" />
        <circle cx="740" cy="1198" r="35" fill="#fffdf4" />
        <circle cx="735" cy="1280" r="9" fill="#173c47" />
        <ellipse cx="785" cy="1310" rx="22" ry="15" fill="#173c47" />
        <path d="M420 1450 L390 1580 M630 1460 L650 1580" stroke="#fffdf4" strokeWidth="48" strokeLinecap="round" />
      </g>
      <text x="540" y="1770" textAnchor="middle" className="art-label">ADAPTASI DI LINGKUNGAN</text>
    </>;
  }

  return <>
    <circle cx="540" cy="1230" r={390 * pulse} fill="#f2a86c" opacity=".12" />
    <path d={`M-80 1510 Q180 1170 340 1420 Q470 ${1040 - reveal * 80} 620 1430 Q800 1150 1160 1490 V1920 H-80Z`} fill="#24515a" />
    <path d={`M240 1410 Q425 ${1130 - reveal * 120} 540 1270 Q650 ${1100 - reveal * 95} 860 1450`} fill="none" stroke="#f7f0dc" strokeWidth="14" opacity=".9" />
    <path d="M0 1600 Q230 1510 440 1610 T1080 1580 V1920 H0Z" fill="#142f3a" opacity=".8" />
    <circle cx="850" cy="900" r="120" fill="#ffb56f" opacity=".82" />
    <text x="540" y="1720" textAnchor="middle" className="art-label">BUMI SELALU BERGERAK</text>
  </>;
};
