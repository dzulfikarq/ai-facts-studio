import { z } from "zod";

export const animationStyleRegistry = {
  "expressive-2d-cartoon": {
    name: "Kartun 2D Ekspresif",
    description: "Warna cerah, ekspresi hidup, dan gerak playful untuk edukasi.",
    thumbnail: "/animation-styles/expressive-2d-cartoon.jpg",
    previewVideo: "/animation-styles/expressive-2d-cartoon.mp4",
    source: {
      title: "Afternoon Class (2014)",
      creator: "Osro (Seoro Oh)",
      url: "https://commons.wikimedia.org/wiki/File:Afternoon_Class_-_Animation_Short_Film_(2014).webm",
      license: "CC BY 3.0",
      licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
      changes: "Cuplikan 00:35–00:41; audio dihapus, video di-encode ulang sebagai MP4 H.264, poster diambil dari frame cuplikan.",
    },
    showcaseNote: null,
    prompt: {
      style: "Expressive 2D cartoon animation with lively character expressions, vibrant balanced colors, clean rounded outlines, and friendly educational appeal.",
      motion: "Use natural, playful hand-animated movement with gentle anticipation, readable squash-and-stretch, and lively secondary motion. Animate the stated process, not only the camera.",
      negative: "Avoid 3D, photorealism, stiff poses, flat lifeless motion, harsh outlines, visual clutter, and style changes between frames.",
    },
  },
  "2d-motion-graphics": {
    name: "Motion Graphics 2D",
    description: "Grafik vektor dan diagram bergerak untuk menjelaskan proses ilmiah.",
    thumbnail: null,
    previewVideo: null,
    source: null,
    showcaseNote: "Belum ada aset profesional berlisensi yang sesuai. Gaya tetap bisa dipilih; showcase belum siap.",
    prompt: {
      style: "Flat vector educational motion graphics with crisp geometric shapes, clean scientific diagrams, simplified objects, and a restrained high-contrast palette.",
      motion: "Visualize the scientific process through purposeful shape transitions, directional paths, and connected stages. Keep diagram elements coherent; animate the process rather than relying on zoom.",
      negative: "Avoid 3D, photorealism, painterly textures, character acting, decorative clutter, tiny labels, and style changes between frames.",
    },
  },
  "2d-cinematic": {
    name: "Sinematik 2D",
    description: "Ilustrasi hand-painted kaya detail dengan atmosfer dan kamera halus.",
    thumbnail: "/animation-styles/2d-cinematic.jpg",
    previewVideo: "/animation-styles/2d-cinematic.mp4",
    source: {
      title: "You Imagined (2013)",
      creator: "Matthew Yang",
      url: "https://commons.wikimedia.org/wiki/File:Matthew_Yang_-_You_Imagined_(2013).webm",
      license: "CC BY 3.0",
      licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
      changes: "Cuplikan 00:43–00:49; audio dihapus, video di-encode ulang sebagai MP4 H.264, poster diambil dari frame cuplikan.",
    },
    showcaseNote: null,
    prompt: {
      style: "Cinematic hand-painted 2D animation with richly illustrated environments, layered painterly detail, atmospheric depth, and dramatic but readable lighting.",
      motion: "Show the main process with controlled natural movement and subtle camera drift. Use light, atmosphere, and environmental motion as support; never replace subject action with camera movement.",
      negative: "Avoid 3D, photorealistic rendering, frantic cuts, excessive camera shake, muddy silhouettes, and style changes between frames.",
    },
  },
  "2d-hand-drawn": {
    name: "Hand-Drawn 2D",
    description: "Tekstur pensil, tinta, atau cat air dengan gerakan organik.",
    thumbnail: "/animation-styles/2d-hand-drawn.jpg",
    previewVideo: "/animation-styles/2d-hand-drawn.mp4",
    source: {
      title: "Urraca (2011)",
      creator: "Philip Piaget",
      url: "https://commons.wikimedia.org/wiki/File:Philip_Piaget_-_Urraca_(2011).webm",
      license: "CC BY 3.0",
      licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
      changes: "Cuplikan 00:34–00:40; audio dihapus, video di-encode ulang sebagai MP4 H.264, poster diambil dari frame cuplikan.",
    },
    showcaseNote: null,
    prompt: {
      style: "Traditional hand-drawn 2D animation with expressive pencil or ink outlines, visible watercolor or paper grain, and imperfect organic linework.",
      motion: "Use fluid frame-by-frame movement with slight line boil and organic timing while keeping shapes and scientific relationships readable.",
      negative: "Avoid 3D, vector-perfect edges, glossy CGI, mechanical motion, excessive sketch clutter, and style changes between frames.",
    },
  },
  "2d-paper-cutout": {
    name: "Paper Cutout 2D",
    description: "Lapisan kertas bertekstur dengan gerak cutout atau stop-motion.",
    thumbnail: null,
    previewVideo: null,
    source: null,
    showcaseNote: "Kandidat berlisensi yang ditinjau belum memenuhi standar kualitas showcase. Gaya tetap bisa dipilih; showcase belum siap.",
    prompt: {
      style: "Layered 2D paper cutout animation with tactile paper fibers, visible stacked edges, handcrafted shapes, and gentle cast shadows.",
      motion: "Move articulated paper layers with charming stop-motion timing and small deliberate increments. Keep layers attached to the same subjects and show the stated process clearly.",
      negative: "Avoid 3D CGI, photorealism, smooth vector gradients, floating detached layers, jitter that harms readability, and style changes between frames.",
    },
  },
  "stylized-3d-cartoon": {
    name: "Kartun 3D Stylized",
    description: "Karakter 3D membulat, pencahayaan lembut, dan gerak ekspresif.",
    thumbnail: "/animation-styles/stylized-3d-cartoon.jpg",
    previewVideo: "/animation-styles/stylized-3d-cartoon.mp4",
    source: {
      title: "Caminandes 3: Llamigos (2016)",
      creator: "Blender Foundation; director Pablo Vazquez",
      url: "https://commons.wikimedia.org/wiki/File:Caminandes_3_-_Llamigos_-_Blender_Animated_Short.webm",
      license: "CC BY 3.0",
      licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
      changes: "Cuplikan 00:35–00:41; audio dihapus, video di-encode ulang sebagai MP4 H.264, poster diambil dari frame cuplikan.",
    },
    showcaseNote: null,
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
  thumbnail: string | null;
  previewVideo: string | null;
  source: { title: string; creator: string; url: string; license: string; licenseUrl: string; changes: string } | null;
  showcaseNote: string | null;
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
