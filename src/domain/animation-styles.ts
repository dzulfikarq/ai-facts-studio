import { z } from "zod";

export const animationStyleRegistry = {
  "expressive-2d-cartoon": {
    name: "Kartun 2D Ekspresif",
    description: "Warna cerah, ekspresi hidup, dan gerak playful untuk edukasi.",
    prompt: {
      style: "Expressive 2D cartoon animation with lively character expressions, vibrant balanced colors, clean rounded outlines, and friendly educational appeal.",
      motion: "Use natural, playful hand-animated movement with gentle anticipation, readable squash-and-stretch, and lively secondary motion. Animate the stated process, not only the camera.",
      negative: "Avoid 3D, photorealism, stiff poses, flat lifeless motion, harsh outlines, visual clutter, and style changes between frames.",
    },
  },
  "2d-motion-graphics": {
    name: "Motion Graphics 2D",
    description: "Grafik vektor dan diagram bergerak untuk menjelaskan proses ilmiah.",
    prompt: {
      style: "Flat vector educational motion graphics with crisp geometric shapes, clean scientific diagrams, simplified objects, and a restrained high-contrast palette.",
      motion: "Visualize the scientific process through purposeful shape transitions, directional paths, and connected stages. Keep diagram elements coherent; animate the process rather than relying on zoom.",
      negative: "Avoid 3D, photorealism, painterly textures, character acting, decorative clutter, tiny labels, and style changes between frames.",
    },
  },
  "2d-cinematic": {
    name: "Sinematik 2D",
    description: "Ilustrasi hand-painted kaya detail dengan atmosfer dan kamera halus.",
    prompt: {
      style: "Cinematic hand-painted 2D animation with richly illustrated environments, layered painterly detail, atmospheric depth, and dramatic but readable lighting.",
      motion: "Show the main process with controlled natural movement and subtle camera drift. Use light, atmosphere, and environmental motion as support; never replace subject action with camera movement.",
      negative: "Avoid 3D, photorealistic rendering, frantic cuts, excessive camera shake, muddy silhouettes, and style changes between frames.",
    },
  },
  "cinematic-2d-motion-comic": {
    name: "Cinematic 2D Hand-Painted Horror",
    description: "Horor sinematik 2D datar dengan tekstur kuas, bayangan lukis, dan gerak terbatas; bukan CGI atau objek model.",
    prompt: {
      style: "Traditional flat 2D hand-painted horror animation. Visible brush textures, illustrated outlines, hand-painted shadows, muted dark teal and dirty green palette, graphic painted lighting, flat illustrated surfaces, and mature eerie animated-film atmosphere. Every object stays drawn, never modeled; preserve identical hand-painted 2D style across every frame.",
      motion: "Use subtle limited 2D animation: move only the stated scene action and secondary water/light details where present. Preserve the original painted perspective and layout; allow only gentle 2D pan, tilt, or push-in/out explicitly requested by the scene. No realistic camera orbit, 3D parallax, or invented action.",
      negative: "Absolutely no 3D rendering, CGI, Unreal Engine, Blender render, photorealism, realistic reflections, glossy plastic, physically simulated lighting, volumetric lighting, realistic camera orbit, Pixar-style animation, clay render, childish cartoon style, modeled objects, style drift, subtitles, text, or watermark.",
    },
  },
  "2d-hand-drawn": {
    name: "Hand-Drawn 2D",
    description: "Tekstur pensil, tinta, atau cat air dengan gerakan organik.",
    prompt: {
      style: "Traditional hand-drawn 2D animation with expressive pencil or ink outlines, visible watercolor or paper grain, and imperfect organic linework.",
      motion: "Use fluid frame-by-frame movement with slight line boil and organic timing while keeping shapes and scientific relationships readable.",
      negative: "Avoid 3D, vector-perfect edges, glossy CGI, mechanical motion, excessive sketch clutter, and style changes between frames.",
    },
  },
  "2d-paper-cutout": {
    name: "Paper Cutout 2D",
    description: "Lapisan kertas bertekstur dengan gerak cutout atau stop-motion.",
    prompt: {
      style: "Layered 2D paper cutout animation with tactile paper fibers, visible stacked edges, handcrafted shapes, and gentle cast shadows.",
      motion: "Move articulated paper layers with charming stop-motion timing and small deliberate increments. Keep layers attached to the same subjects and show the stated process clearly.",
      negative: "Avoid 3D CGI, photorealism, smooth vector gradients, floating detached layers, jitter that harms readability, and style changes between frames.",
    },
  },
  "stylized-3d-cartoon": {
    name: "Kartun 3D Stylized",
    description: "Karakter 3D membulat, pencahayaan lembut, dan gerak ekspresif.",
    prompt: {
      style: "Stylized 3D cartoon animation with rounded expressive characters and objects, appealing dimensional forms, polished materials, and soft global illumination.",
      motion: "Use expressive cartoon timing, clear anticipation, smooth arcs, and gentle secondary motion. Animate the described process while preserving 3D volume and spatial continuity.",
      negative: "Avoid photorealism, live action, flat 2D/vector rendering, harsh specular lighting, uncanny detail, and style changes between frames.",
    },
  },
} as const;

export type AnimationStyleId = keyof typeof animationStyleRegistry;
export type AnimationStylePreset = {
  id: AnimationStyleId;
  name: string;
  description: string;
  prompt: { style: string; motion: string; negative: string };
};

export const ANIMATION_STYLE_IDS = Object.keys(animationStyleRegistry) as [AnimationStyleId, ...AnimationStyleId[]];
export const animationStyleIdSchema = z.enum(ANIMATION_STYLE_IDS);
export const DEFAULT_ANIMATION_STYLE_ID: AnimationStyleId = "expressive-2d-cartoon";
export const ANIMATION_STYLE_PRESETS: AnimationStylePreset[] = ANIMATION_STYLE_IDS.map((id) => ({ id, ...animationStyleRegistry[id] }));

export function getAnimationStylePreset(id?: string | null): AnimationStylePreset {
  const safeId = id && Object.hasOwn(animationStyleRegistry, id) ? id as AnimationStyleId : DEFAULT_ANIMATION_STYLE_ID;
  return { id: safeId, ...animationStyleRegistry[safeId] };
}

export function animationStylePromptIsStale(prompt: string | undefined, savedStyleId: string | undefined, currentStyleId?: string | null) {
  if (!prompt) return false;
  const current = getAnimationStylePreset(currentStyleId);
  return savedStyleId !== current.id || !Object.values(current.prompt).every((instruction) => prompt.includes(instruction));
}
