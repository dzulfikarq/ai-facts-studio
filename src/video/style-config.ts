import type { VisualPreset } from "../domain/research";
import type { VisualColor } from "../domain/visual-composition";

export type VisualStyle = {
  palette: Record<"canvas" | "surface" | "primary" | "accent" | "text" | "muted" | "snow" | "danger", string>;
  headingFont: string;
  bodyFont: string;
  captionFontSize: number;
  titleFontSize: number;
  backdrop: "flat" | "grid" | "cinematic";
  safeArea: { left: number; right: number; top: number; bottom: number };
  spacing: { headerTopOffset: number; categoryTopOffset: number; titleTopOffset: number; titleLineGap: number; sceneLabelOffset: number; captionOffset: number; captionLineGap: number; progressBottomInset: number; footerBottomInset: number };
};

const base = {
  safeArea: { left: 84, right: 84, top: 170, bottom: 260 },
  spacing: { headerTopOffset: -62, categoryTopOffset: 54, titleTopOffset: 116, titleLineGap: 9, sceneLabelOffset: 0, captionOffset: 55, captionLineGap: 43, progressBottomInset: 20, footerBottomInset: 60 },
};

export const visualStyles: Record<VisualPreset, VisualStyle> = {
  "flat-2d-storytelling": {
    ...base,
    palette: { canvas: "#d9ebe6", surface: "#9dc9c2", primary: "#267a76", accent: "#eea45e", text: "#17323a", muted: "#58747a", snow: "#fff9ed", danger: "#d85f51" },
    headingFont: "Arial, sans-serif", bodyFont: "Arial, sans-serif", captionFontSize: 30, titleFontSize: 45, backdrop: "flat",
  },
  "animated-infographic": {
    ...base,
    palette: { canvas: "#edf3ef", surface: "#c7e0dc", primary: "#087f8c", accent: "#ed8653", text: "#173740", muted: "#55717b", snow: "#ffffff", danger: "#c94f55" },
    headingFont: "Arial, sans-serif", bodyFont: "Arial, sans-serif", captionFontSize: 28, titleFontSize: 42, backdrop: "grid",
  },
  "cinematic-parallax": {
    ...base,
    palette: { canvas: "#102735", surface: "#244d5c", primary: "#4eaaa4", accent: "#f0aa62", text: "#fff5df", muted: "#c1d2cf", snow: "#f1eee2", danger: "#ff7054" },
    headingFont: "Arial, sans-serif", bodyFont: "Arial, sans-serif", captionFontSize: 30, titleFontSize: 46, backdrop: "cinematic",
  },
};

export function resolveVisualColor(color: VisualColor | undefined, style: VisualStyle, fallback = "#ffffff") {
  if (!color) return fallback;
  if (color === "none") return "none";
  return color.startsWith("#") ? color : style.palette[color as keyof VisualStyle["palette"]] ?? fallback;
}
