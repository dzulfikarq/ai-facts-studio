import { visualCompositionSchema, type VisualComposition } from "./visual-composition";
import { visualObjectLibrary, type VisualObjectId } from "./visual-objects";

export type IllustrationType = "full-landscape" | "cross-section" | "hero-object-focus" | "step-by-step-process" | "before-and-after" | "connected-environment" | "scientific-diagram";
type Node = VisualComposition["layers"][number]["nodes"][number];
type Layer = VisualComposition["layers"][number];

const colors = {
  sky: "#e8f3ed", sea: "#287f8c", seaLight: "#55aeb2", land: "#8ebc91", landDark: "#597f68",
  rock: "#866f62", rockLight: "#bd9d76", salt: "#f1b75d", chloride: "#ed826d", ink: "#173740",
  cloud: "#fffaf0", sun: "#f5b95e", ozone: "#8c75c5", atmosphere: "#73b8cf", space: "#173b59",
};

const ellipse = (x: number, y: number, width: number, height: number, fill: string, stroke = "none", strokeWidth = 0, opacity = 1): Node => ({ type: "shape", shape: "ellipse", x, y, width, height, fill, stroke, strokeWidth, opacity });
const polygon = (x: number, y: number, width: number, height: number, points: Array<{ x: number; y: number }>, fill: string, stroke = "none", strokeWidth = 0): Node => ({ type: "shape", shape: "polygon", x, y, width, height, points, fill, stroke, strokeWidth });
const path = (x: number, y: number, width: number, height: number, d: string, fill = "none", stroke = "none", strokeWidth = 0, motion?: "draw" | "fall"): Node => ({ type: "path", x, y, width, height, d, fill, stroke, strokeWidth, ...(motion ? { motion } : {}) });
const icon = (name: "sun" | "cloud" | "mountain" | "earth" | "water-drop" | "uv-ray" | "charged-particle" | "bear", x: number, y: number, width: number, height: number, color: string, motion?: "drift" | "fall" | "flow" | "rise"): Node => ({ type: "icon", icon: name, x, y, width, height, color, ...(motion ? { motion } : {}) });
const text = (value: string, x: number, y: number, width: number, height: number, fontSize = 24, color = colors.ink, motion?: "flow"): Node => ({ type: "text", text: value, x, y, width, height, fontSize, color, font: "heading", weight: "800", align: "middle", ...(motion ? { motion } : {}) });
const layer = (id: string, depth: number, ...nodes: Node[]): Layer => ({ id, depth, nodes });
const composition = (...layers: Layer[]) => visualCompositionSchema.parse({ background: colors.sky, layers }) as VisualComposition;
const point = (x: number, y: number) => ({ x, y });

function mountainWorld(): Node[] {
  return [
    path(0, 640, 720, 700, "M0 100 L20 54 L36 70 L55 8 L73 69 L88 35 L100 100 Z", colors.landDark),
    path(80, 775, 530, 415, "M0 100 L28 25 L45 57 L65 0 L100 100 Z", colors.land),
  ];
}

function ion(x: number, y: number, label: "Na⁺" | "Cl⁻", moving = false): Node[] {
  const fill = label === "Na⁺" ? colors.salt : colors.chloride;
  return [
    { type: "shape", shape: "circle", x, y, width: 58, height: 58, fill, stroke: colors.cloud, strokeWidth: 4, ...(moving ? { motion: "flow" as const } : {}) },
    text(label, x - 6, y + 15, 70, 34, 18, colors.ink, moving ? "flow" : undefined),
  ];
}

function oceanBody(top = 850): Node[] {
  return [
    path(0, top, 1080, 620, "M0 12 Q12 0 24 12 T48 12 T72 12 T100 12 V100 H0Z", colors.sea),
    path(0, top + 56, 1080, 560, "M0 14 Q14 2 28 14 T56 14 T84 14 T100 14", "none", colors.seaLight, 14),
    path(0, top + 170, 1080, 440, "M0 18 Q14 5 28 18 T56 18 T84 18 T100 18", "none", "#9bd6d2", 7),
  ];
}

function seaHero(scientific = false, withSalt = true): VisualComposition {
  const ions = scientific
    ? [...ion(160, 1020, "Na⁺"), ...ion(360, 1190, "Cl⁻"), ...ion(580, 970, "Na⁺"), ...ion(790, 1190, "Cl⁻"), ...ion(890, 1010, "Na⁺")]
    : [...ion(180, 1100, "Na⁺"), ...ion(390, 1280, "Cl⁻"), ...ion(610, 1050, "Na⁺"), ...ion(800, 1240, "Cl⁻"), ...ion(910, 1010, "Na⁺")];
  const layers = [
    layer("ocean-horizon", 0.18,
      ellipse(740, 560, 190, 190, colors.sun),
      path(0, 730, 1080, 380, "M0 60 Q18 25 36 60 T72 60 T100 60", "none", colors.sea, 12),
      ...oceanBody(820)),
    layer("ocean", 0.52,
      path(35, 900, 1010, 470, "M0 22 Q17 0 34 22 T68 22 T100 22", "none", "#d7f3e9", 8),
    ),
  ];
  if (withSalt) layers.push(layer("salt-ions", 0.68, ...ions));
  if (scientific) layers.push(layer("salinity-measure", 0.82,
    text("≈ 35 g GARAM / kg AIR LAUT", 220, 1330, 640, 48, 27),
    path(210, 1290, 660, 26, "M0 50 H100", "none", colors.sun, 5),
  ));
  return composition(...layers);
}

function rainAndWeathering(): VisualComposition {
  return composition(
    layer("rain", 0.08,
      icon("cloud", 145, 555, 245, 130, colors.cloud),
      ...[205, 270, 335, 395, 455].map((x, index) => path(x, 660 + (index % 2) * 24, 32, 230, "M50 0 L50 100", "none", "#3c9db0", 8, "fall"))),
    layer("mountain", 0.25,
      ...mountainWorld(),
      path(0, 1010, 1080, 430, "M0 25 Q18 5 35 30 T70 25 T100 34 V100 H0Z", colors.landDark)),
    layer("rock", 0.58,
      polygon(365, 875, 370, 330, [point(0, .95), point(.16, .35), point(.38, .22), point(.5, 0), point(.72, .2), point(.96, .44), point(1, 1)], colors.rock, colors.rockLight, 12),
      path(450, 940, 210, 220, "M45 0 L54 35 L35 50 L48 72 L30 100 M55 36 L83 48 L68 70 L96 89", "none", "#e5c59a", 7),
    ),
    layer("mineral", 0.72, ...ion(690, 1110, "Na⁺"), ...ion(610, 1170, "Cl⁻")),
    layer("runoff", 0.9,
      path(110, 1170, 830, 250, "M0 0 C20 10 18 35 40 42 S62 65 78 73 S90 93 100 100", "none", colors.sea, 26, "draw"),
      ...[0, 1, 2].map((index) => ellipse(500 + index * 68, 1260 + index * 24, 24, 24, colors.salt, "none", 0, .94))),
  );
}

function connectedRiver(withMinerals = true): VisualComposition {
  return composition(
    layer("sky", 0.06,
      ellipse(820, 560, 145, 145, colors.sun),
      icon("cloud", 560, 560, 190, 105, colors.cloud)),
    layer("mountain", 0.24,
      ...mountainWorld(),
      path(200, 805, 110, 135, "M0 95 L50 0 L100 95 Z", colors.cloud)),
    layer("coast-and-ocean", 0.38,
      path(0, 1080, 1080, 440, "M0 30 Q24 8 48 30 T100 30 V100 H0Z", colors.sea),
      path(0, 1120, 1080, 380, "M0 22 Q15 5 30 22 T60 22 T90 22 T100 22", "none", colors.seaLight, 12)),
    layer("river", 0.64,
      path(0, 760, 845, 475, "M12 0 C35 8 12 28 42 38 S25 60 57 70 S72 91 100 100", "none", colors.seaLight, 18, "draw"),
      path(0, 760, 845, 475, "M12 0 C35 8 12 28 42 38 S25 60 57 70 S72 91 100 100", "none", "#d8f4e9", 3.5, "draw")),
    ...(withMinerals ? [layer("mineral", 0.76,
      ...ion(170, 850, "Na⁺", true), ...ion(365, 955, "Cl⁻", true), ...ion(560, 1060, "Na⁺", true))] : []),
    layer("place-labels", 0.9,
      text("PEGUNUNGAN", 70, 715, 310, 42, 25),
      text("LAUT", 790, 1280, 190, 42, 25)),
  );
}

function evaporation(withSalt = true): VisualComposition {
  return composition(
    layer("sunlight", 0.08,
      icon("sun", 730, 530, 170, 170, colors.sun),
      ...[0, 1, 2].map((index) => path(330 + index * 100, 730, 75, 360, "M50 0 L50 100", "none", "#f6ca75", 7, "draw"))),
    layer("ocean", 0.34,
      ...oceanBody(920),
      path(0, 900, 1080, 120, "M0 55 Q15 20 30 55 T60 55 T90 55 T100 55", "none", "#dbf5e9", 12)),
    ...(withSalt ? [layer("salt-ions", 0.62,
      ...ion(180, 1120, "Na⁺"), ...ion(385, 1290, "Cl⁻"), ...ion(610, 1125, "Na⁺"), ...ion(820, 1290, "Cl⁻")),
    ] : []),
    layer("water-vapor", 0.88,
      icon("water-drop", 315, 770, 62, 88, "#83c9d6", "rise"),
      icon("water-drop", 465, 715, 56, 82, "#83c9d6", "rise"),
      icon("water-drop", 605, 780, 50, 72, "#83c9d6", "rise"),
      text("H₂O KE UDARA", 270, 640, 400, 42, 23),
      ...(withSalt ? [text("ION TETAP TERLARUT", 285, 1390, 510, 38, 22)] : [])),
  );
}

function earthBase(): Node[] {
  return [
    ellipse(470, 800, 360, 360, "#3c9cad", colors.cloud, 7),
    path(490, 835, 310, 270, "M0 24 L23 0 L42 13 L44 34 L30 45 L36 67 L15 82 L4 64 Z M48 14 L69 5 L90 22 L82 43 L65 38 L58 55 L44 39 Z M53 55 L78 42 L99 55 L89 76 L78 82 L73 100 L57 91 L50 73 Z", "#79b777"),
    ellipse(440, 770, 420, 420, "none", colors.atmosphere, 11, .86),
  ];
}

function sunEarthWide(): VisualComposition {
  return composition(
    layer("space", 0.06, ...[[230, 590], [760, 615], [900, 1080], [300, 1290], [620, 1440]].map(([x, y]) => ellipse(x!, y!, 9, 9, colors.cloud, "none", 0, .8))),
    layer("sunlight", 0.34,
      ellipse(95, 690, 205, 205, colors.sun),
      path(290, 755, 360, 260, "M0 5 L100 35 M0 48 L100 53 M0 90 L100 72", "none", "#f4b765", 9, "draw")),
    layer("earth-world", 0.68, ...earthBase()),
  );
}

function atmosphereOnly(): VisualComposition {
  const earth = earthBase().slice(0, 2);
  return composition(
    layer("space", 0.04, ...[[175, 650], [890, 670], [230, 1260], [850, 1320]].map(([x, y]) => ellipse(x!, y!, 8, 8, colors.cloud, "none", 0, .7))),
    layer("earth-world", 0.52, ...earth),
    layer("atmosphere", 0.72,
      ellipse(440, 770, 420, 420, "none", colors.atmosphere, 16, .95),
      text("ATMOSFER", 340, 1260, 400, 44, 24)),
  );
}

function sunEarthRays(includeOzone: boolean): VisualComposition {
  return composition(
    layer("sunlight", 0.05,
      ellipse(120, 600, 190, 190, colors.sun),
      path(305, 680, 270, 170, "M0 50 L100 95 M0 15 L100 60 M0 85 L100 100", "none", "#f4b765", 9, "draw")),
    layer("earth-world", 0.48, ...earthBase()),
    ...(includeOzone ? [layer("ozone", 0.67,
      ellipse(455, 785, 390, 390, "none", colors.ozone, 16, .96),
      path(260, 950, 390, 110, "M0 50 H100", "none", colors.ozone, 10, "draw"))] : []),
    layer("uv-rays", 0.86,
      path(300, 875, 290, 130, "M0 12 L100 80", "none", "#d95f55", 8, "draw"),
      path(300, 1000, 290, 120, "M0 85 L100 20", "none", "#e6a244", 8, "draw"),
      text(includeOzone ? "UV-B / UV-C DISERAP" : "SINAR UV", 210, 1120, 410, 42, 22)),
  );
}

function magnetosphere(): VisualComposition {
  return composition(
    layer("sunlight", 0.05,
      ellipse(90, 620, 120, 120, colors.sun),
      path(205, 670, 265, 230, "M0 20 L100 42 M0 49 L100 55 M0 79 L100 66", "none", colors.sun, 7, "draw")),
    layer("magnetic-field", 0.3,
      path(250, 650, 660, 620, "M50 0 C0 14 0 35 18 50 C0 65 0 86 50 100 M50 0 C100 14 100 35 82 50 C100 65 100 86 50 100", "none", colors.atmosphere, 11),
      path(305, 715, 550, 490, "M50 0 C14 18 14 35 28 50 C14 65 14 82 50 100 M50 0 C86 18 86 35 72 50 C86 65 86 82 50 100", "none", colors.ozone, 5)),
    layer("earth-world", 0.54, ...earthBase()),
    layer("charged-particles", 0.9,
      icon("charged-particle", 270, 780, 80, 80, colors.chloride, "flow"),
      icon("charged-particle", 300, 1040, 72, 72, colors.salt, "flow"),
      icon("charged-particle", 850, 700, 70, 70, colors.chloride, "flow"),
      path(360, 700, 190, 450, "M0 0 C90 12 90 33 50 48 C10 65 30 90 100 100", "none", colors.chloride, 7, "draw"),
      text("PARTIKEL DIBELOKKAN", 225, 1320, 630, 42, 24)),
  );
}

function earthTwoShields(): VisualComposition {
  return composition(
    layer("sunlight", 0.06,
      ellipse(105, 610, 125, 125, colors.sun),
      path(215, 670, 340, 260, "M0 10 L100 45 M0 42 L100 58 M0 78 L100 72", "none", colors.sun, 7, "draw")),
    layer("earth-world", 0.36, ...earthBase()),
    layer("ozone", 0.62,
      ellipse(455, 785, 390, 390, "none", colors.ozone, 16, .96)),
    layer("uv-rays", 0.7,
      path(280, 855, 350, 120, "M0 10 L100 50", "none", "#d95f55", 8, "draw"),
      path(280, 980, 350, 110, "M0 80 L100 50", "none", "#e6a244", 8, "draw")),
    layer("magnetic-field", 0.78,
      path(250, 680, 660, 620, "M50 0 C0 14 0 35 18 50 C0 65 0 86 50 100 M50 0 C100 14 100 35 82 50 C100 65 100 86 50 100", "none", colors.atmosphere, 9)),
    layer("charged-particles", 0.9,
      icon("charged-particle", 285, 720, 66, 66, colors.chloride, "flow"),
      icon("charged-particle", 335, 1050, 66, 66, colors.salt, "flow")),
    layer("annotations", 0.96,
      text("ATMOSFER: LAPISAN GAS", 290, 1150, 500, 38, 21),
      text("OZON: MENYERAP UV", 290, 1210, 500, 38, 21),
      text("MAGNETOSFER: PARTIKEL", 290, 1270, 500, 38, 21)),
  );
}

function geologicalLandscape(): VisualComposition {
  return composition(
    layer("sunlight", 0.08, ellipse(800, 560, 140, 140, colors.sun)),
    layer("mountains", 0.35,
      path(0, 700, 1080, 730, "M0 100 L18 48 L34 70 L50 5 L68 66 L82 28 L100 100 Z", colors.landDark),
      path(0, 1080, 1080, 400, "M0 20 Q20 2 40 20 T80 20 T100 22 V100 H0Z", colors.rockLight)),
    layer("rock", 0.78,
      path(0, 1130, 1080, 350, "M0 18 Q20 0 40 18 T80 18 T100 20 V100 H0Z", colors.rock),
      path(0, 1210, 1080, 270, "M0 30 C18 30 22 8 36 28 S55 55 68 30 S86 15 100 28", "none", colors.rockLight, 12),
      path(0, 1310, 1080, 170, "M0 20 C18 20 22 2 36 19 S55 42 68 20 S86 8 100 19", "none", colors.rockLight, 10)),
  );
}

function mountainAtDawn(): VisualComposition {
  return composition(
    layer("sunlight", 0.08,
      ellipse(790, 560, 155, 155, colors.sun),
      path(755, 730, 230, 120, "M0 45 L100 0 M15 100 L100 48 M65 120 L100 88", "none", colors.sun, 8)),
    layer("cloud", 0.2, icon("cloud", 125, 620, 320, 165, colors.cloud)),
    layer("mountain", 0.4, ...mountainWorld()),
    layer("rock", 0.74,
      polygon(730, 1120, 250, 190, [point(0, .8), point(.18, .35), point(.36, .5), point(.55, 0), point(.8, .34), point(1, .68), point(.9, 1), point(.12, 1)], colors.rock, colors.rockLight, 8),
      path(800, 1180, 90, 95, "M48 0 L38 42 L60 60 L42 100", "none", colors.rockLight, 6)),
  );
}

function foldedRockUplift(): VisualComposition {
  return composition(
    layer("mountain", 0.25,
      path(0, 650, 1080, 650, "M0 100 L18 80 L34 84 L50 12 L66 82 L82 78 L100 100 Z", colors.landDark),
      path(0, 990, 1080, 300, "M0 100 L18 76 L34 80 L50 12 L66 78 L82 75 L100 100 Z", colors.land)),
    layer("rock", 0.72,
      path(0, 1110, 1080, 390, "M0 8 Q20 0 40 8 T80 8 T100 10 V100 H0Z", colors.rock),
      path(0, 1150, 1080, 340, "M0 28 C18 28 22 4 36 26 S55 58 68 28 S86 10 100 26", "none", colors.rockLight, 13),
      path(0, 1240, 1080, 250, "M0 25 C18 25 22 2 36 23 S55 54 68 25 S86 7 100 23", "none", colors.salt, 10),
      path(0, 1320, 1080, 170, "M0 23 C18 23 22 1 36 21 S55 50 68 23 S86 6 100 21", "none", colors.rockLight, 10),
      text("LAPISAN BATUAN TERLIPAT", 245, 1390, 590, 38, 21)),
  );
}

function lightningLandscape(): VisualComposition {
  return composition(
    layer("storm-cloud", 0.15,
      icon("cloud", 280, 600, 520, 250, "#67879b"),
      path(360, 850, 360, 430, "M55 0 L30 45 L55 45 L38 100", "none", colors.sun, 34, "draw")),
    layer("landscape", 0.7,
      path(0, 1200, 1080, 360, "M0 22 Q20 0 40 22 T80 22 T100 24 V100 H0Z", colors.land),
      path(0, 1350, 1080, 260, "M0 40 Q25 0 50 38 T100 34 V100 H0Z", colors.landDark)),
  );
}

function habitatLandscape(): VisualComposition {
  return composition(
    layer("arctic-sky", 0.08, ellipse(820, 570, 130, 130, colors.sun)),
    layer("ice-hills", 0.4,
      path(0, 940, 1080, 560, "M0 56 Q18 20 36 56 T72 56 T100 52 V100 H0Z", "#a9d4d1"),
      path(0, 1160, 1080, 480, "M0 30 Q24 0 48 30 T100 26 V100 H0Z", colors.cloud),
      path(270, 810, 540, 650, "M0 90 Q7 38 25 46 Q32 2 55 36 Q82 10 100 62 L92 95Z", colors.rock),
      icon("bear", 520, 1010, 210, 190, "#806a57")),
  );
}

function rainyLandscape(): VisualComposition {
  return composition(
    layer("rain", 0.12,
      icon("cloud", 350, 560, 360, 190, colors.cloud),
      ...[250, 360, 470, 580, 690].map((x, index) => path(x, 700 + (index % 2) * 22, 28, 260, "M50 0 L50 100", "none", "#3c9db0", 7, "fall"))),
    layer("mountain", 0.5,
      ...mountainWorld(),
      path(0, 1050, 1080, 390, "M0 25 Q18 5 36 25 T72 25 T100 30 V100 H0Z", colors.land)),
    layer("runoff", 0.82,
      path(100, 1120, 850, 300, "M0 0 C22 4 16 25 39 34 S37 58 63 66 S75 88 100 100", "none", colors.seaLight, 10, "draw")),
  );
}

function riverValley(withMinerals = false): VisualComposition {
  return composition(
    layer("mountain", 0.24,
      ...mountainWorld(),
      path(0, 1080, 1080, 420, "M0 22 Q20 0 40 22 T80 22 T100 24 V100 H0Z", colors.land)),
    layer("river", 0.62,
      path(0, 770, 1080, 670, "M10 0 C20 16 82 20 65 38 S20 48 42 62 S92 72 78 88 S35 95 45 100", "none", colors.seaLight, 15, "draw"),
      path(0, 770, 1080, 670, "M10 0 C20 16 82 20 65 38 S20 48 42 62 S92 72 78 88 S35 95 45 100", "none", "#d8f4e9", 3, "draw")),
    ...(withMinerals ? [layer("mineral", 0.78,
      ...ion(250, 875, "Na⁺", true), ...ion(650, 1040, "Cl⁻", true))] : []),
  );
}

function earthHero(): VisualComposition {
  return composition(
    layer("space", 0.06,
      ...[[170, 650], [890, 720], [270, 1160], [900, 1250], [730, 600]].map(([x, y]) => ellipse(x, y, 10, 10, colors.cloud, "none", 0, .8))),
    layer("earth-world", 0.55, ...earthBase()),
  );
}

function mineralFocus(): VisualComposition {
  return composition(
    layer("geological-layers", 0.25,
      path(0, 900, 1080, 600, "M0 15 Q20 0 40 15 T80 15 T100 20 V100 H0Z", colors.rockLight),
      path(0, 1110, 1080, 420, "M0 18 Q20 2 40 18 T80 18 T100 16 V100 H0Z", colors.rock)),
    layer("mineral", 0.72,
      ...[0, 1, 2, 3].flatMap((index) => ion(270 + index * 135, 1000 + (index % 2) * 145, index % 2 ? "Cl⁻" : "Na⁺"))),
  );
}

function volcanoCrossSection(): VisualComposition {
  return composition(
    layer("mountain", 0.18,
      path(170, 640, 740, 800, "M0 100 L18 54 L35 70 L50 5 L66 65 L84 34 L100 100 Z", colors.landDark),
      path(0, 1150, 1080, 360, "M0 20 Q20 2 40 20 T80 20 T100 22 V100 H0Z", colors.rock)),
    layer("volcano", 0.56,
      path(350, 820, 420, 600, "M0 100 L40 30 L47 18 L53 18 L60 30 L100 100 Z", colors.rock, colors.rockLight, 8),
      path(555, 880, 75, 490, "M48 0 L46 40 L52 55 L46 72 L50 100", "none", colors.salt, 18),
      path(455, 1180, 300, 210, "M0 50 Q25 0 50 50 T100 50", "none", colors.chloride, 14)),
    layer("magma", 0.86,
      ellipse(460, 1320, 160, 80, colors.chloride),
      text("MAGMA", 455, 1400, 170, 36, 22)),
  );
}

function tectonicCrossSection(himalaya = false): VisualComposition {
  return composition(
    layer("geological-layers", 0.16,
      path(0, 820, 1080, 610, "M0 18 Q18 3 36 18 T72 18 T100 20 V100 H0Z", colors.landDark),
      path(0, 1120, 1080, 430, "M0 18 Q20 0 40 18 T80 18 T100 20 V100 H0Z", colors.rockLight)),
    layer("tectonic-plates", 0.52,
      polygon(40, 910, 500, 250, [point(0, 0), point(1, 0), point(.84, 1), point(.2, .88)], colors.rock, colors.rockLight, 6),
      polygon(540, 910, 500, 250, [point(0, 0), point(1, 0), point(.8, .88), point(.18, 1)], colors.land, colors.rockLight, 6),
      text(himalaya ? "INDIA → EURASIA" : "LEMPENG BERGERAK", 260, 1205, 560, 42, 22)),
    layer("mountain", 0.68,
      path(355, 750, 360, 430, himalaya ? "M0 90 L12 82 L24 55 L34 70 L45 30 L55 50 L66 5 L75 44 L86 30 L100 90 Z" : "M0 90 L25 72 L40 38 L52 62 L64 5 L78 60 L100 90 Z", colors.landDark),
      ...(himalaya ? [path(355, 750, 360, 430, "M45 30 L66 5 L75 44 L66 34 L63 18 L54 40 Z", colors.cloud)] : []),
      ...(himalaya ? [text("HIMALAYA", 390, 800, 300, 38, 21)] : [])),
  );
}

function himalayaCollision(): VisualComposition {
  return tectonicCrossSection(true);
}

function waterCycle(): VisualComposition {
  return composition(
    layer("rain", 0.1,
      icon("cloud", 600, 565, 290, 150, colors.cloud),
      ...[710, 780, 850].map((x, index) => path(x, 710 + index * 12, 24, 230, "M50 0 L50 100", "none", "#3c9db0", 7, "fall"))),
    layer("mountain", 0.28,
      ...mountainWorld()),
    layer("ocean", 0.4, ...oceanBody(1110)),
    layer("water-vapor", 0.76,
      ...[230, 340, 450].map((x, index) => icon("water-drop", x, 880 - index * 40, 44, 66, "#83c9d6", "rise")),
      path(280, 800, 300, 360, "M50 100 C40 45 70 40 50 0", "none", colors.atmosphere, 8, "draw")),
  );
}

function sunScene(): VisualComposition {
  return composition(
    layer("sun", 0.28,
      icon("sun", 390, 660, 300, 300, colors.sun),
      ...[0, 1, 2, 3].map((index) => path(300 + index * 110, 1010, 70, 240, "M50 0 L50 100", "none", "#f4b765", 8, "draw"))),
  );
}

function cloudScene(): VisualComposition {
  return composition(layer("cloud", 0.35, icon("cloud", 280, 720, 520, 280, colors.cloud)));
}

export function directIllustration(matched: readonly string[], worldObjects: readonly string[], copy: string): {
  type: IllustrationType; composition: VisualComposition; objects: string[]; focus: string; intent: string;
} | undefined {
  const has = (...ids: string[]) => ids.every((id) => matched.includes(id));
  const worldHas = (...ids: string[]) => ids.every((id) => worldObjects.includes(id));
  let type: IllustrationType;
  let visual: VisualComposition;
  let objects = [...matched];
  let focus = matched[0] ?? "";
  let intent = "Ilustrasi 2D berlapis menghubungkan objek utama dengan lingkungannya.";

  if (has("mountain", "river", "ocean")) {
    type = "connected-environment"; visual = connectedRiver(matched.includes("mineral")); objects = ["mountain", "river", ...(matched.includes("mineral") ? ["mineral"] : []), "ocean"]; focus = "river";
    intent = "Satu bentang alam utuh: mineral lepas dari pegunungan, mengikuti sungai, lalu tiba di laut.";
  } else if (has("rain", "rock") && (matched.includes("mineral") || worldHas("mineral"))) {
    type = "cross-section"; visual = rainAndWeathering(); objects = ["rain", "mountain", "rock", "mineral"]; focus = "rock";
    intent = "Hujan jatuh ke batuan; rekahan dan limpasan memperlihatkan mineral terlepas lalu larut.";
  } else if (has("ocean", "sun", "evaporation")) {
    const withSalt = matched.includes("salt-crystal") || matched.includes("mineral");
    type = "cross-section"; visual = evaporation(withSalt); objects = ["sun", "ocean", "evaporation", ...(withSalt ? ["salt-crystal"] : [])]; focus = "evaporation";
    intent = "Penampang laut membedakan uap H₂O yang naik dari ion yang tetap berada di air.";
  } else if (has("earth", "ozone-layer", "magnetosphere") && worldHas("charged-particles", "uv-rays")) {
    type = "scientific-diagram"; visual = earthTwoShields(); objects = ["sun", "earth", "atmosphere", "ozone-layer", "uv-rays", "charged-particles", "magnetosphere"]; focus = "earth";
    intent = "Bumi menampilkan dua perlindungan berbeda: atmosfer/ozon menyaring UV, medan magnet membelokkan partikel.";
  } else if (has("earth", "magnetosphere") && (matched.includes("charged-particles") || worldHas("charged-particles"))) {
    type = "scientific-diagram"; visual = magnetosphere(); objects = ["sun", "earth", "charged-particles", "magnetosphere"]; focus = "magnetosphere";
    intent = "Medan magnet mengarahkan partikel bermuatan mengitari Bumi; bukan sinar UV.";
  } else if (matched.includes("ozone-layer") && (matched.includes("uv-rays") || worldHas("uv-rays")) && worldHas("earth", "atmosphere")) {
    type = "cross-section"; visual = sunEarthRays(true); objects = ["sun", "earth", "atmosphere", "ozone-layer", "uv-rays"]; focus = "ozone-layer";
    intent = "Penampang atmosfer menunjukkan ozon menyerap sebagian besar UV-B dan hampir seluruh UV-C; sebagian UV-A menembus.";
  } else if (has("earth", "atmosphere") && !matched.includes("sun")) {
    type = "scientific-diagram"; visual = atmosphereOnly(); objects = ["earth", "atmosphere"]; focus = "atmosphere";
    intent = "Atmosfer digambar sebagai selubung gas tersendiri yang menyelimuti permukaan Bumi.";
  } else if (has("earth", "sun") && !matched.includes("ozone-layer") && !matched.includes("magnetosphere")) {
    type = "connected-environment"; visual = sunEarthWide(); objects = ["sun", "earth"]; focus = "earth";
    intent = "Satu adegan ruang menghubungkan Matahari sebagai sumber cahaya dengan Bumi sebagai penerima energi.";
  } else if (has("earth", "sun") && matched.includes("atmosphere")) {
    type = "full-landscape"; visual = sunEarthRays(false); objects = ["sun", "earth", "atmosphere", ...(matched.includes("uv-rays") ? ["uv-rays"] : [])]; focus = "earth";
    intent = "Matahari, sinar, atmosfer, dan Bumi berbagi satu adegan ruang angkasa.";
  } else if (has("earth", "magnetosphere") && worldHas("charged-particles")) {
    type = "scientific-diagram"; visual = magnetosphere(); objects = ["sun", "earth", "charged-particles", "magnetosphere"]; focus = "magnetosphere";
  } else if (has("ocean", "salt-crystal") && /35\s*g|rata-rata|salinitas|siklus geologi|tanpa batas/i.test(copy)) {
    type = "scientific-diagram"; visual = seaHero(true); objects = ["ocean", "salt-crystal", ...(matched.includes("mineral") ? ["mineral"] : [])]; focus = "salt-crystal";
    intent = "Ion Na⁺ dan Cl⁻ tetap tersebar dalam laut; angka salinitas rata-rata ditampilkan tanpa grafik kenaikan tak terbatas.";
  } else if (has("ocean", "salt-crystal")) {
    type = "hero-object-focus"; visual = seaHero(); objects = ["ocean", "salt-crystal"]; focus = "ocean";
    intent = "Laut menjadi hero scene; partikel Na⁺ dan Cl⁻ tampak terlarut di antara gelombang.";
  } else if (matched.includes("water-cycle") || (matched.includes("rain") && matched.includes("ocean") && matched.includes("evaporation"))) {
    type = "step-by-step-process"; visual = evaporation(); objects = matched.slice(0, 6); focus = "water-cycle";
  } else if (has("mountain", "rock", "sun", "cloud")) {
    type = "full-landscape"; visual = mountainAtDawn(); objects = ["sun", "cloud", "mountain", "rock"]; focus = "mountain";
    intent = "Puncak gunung, awan, matahari terbit, dan bongkah batu ditampilkan sebagai satu bentang alam.";
  } else if (has("mountain", "rock") && /lipat|terangkat|fold|uplift/.test(copy)) {
    type = "cross-section"; visual = foldedRockUplift(); objects = ["mountain", "rock"]; focus = "rock";
    intent = "Lapisan batuan bergelombang memperlihatkan lipatan yang terangkat menjadi pegunungan.";
  } else if (matched.includes("volcano") || matched.includes("magma")) {
    type = "cross-section"; visual = volcanoCrossSection(); objects = ["volcano", "magma"]; focus = "volcano";
    intent = "Penampang gunung api menunjukkan saluran magma dari bawah tanah menuju kawah.";
  } else if (matched.includes("tectonic-plates")) {
    const himalayan = /himalaya/i.test(copy);
    type = "scientific-diagram"; visual = himalayan ? himalayaCollision() : tectonicCrossSection(); objects = ["tectonic-plates", "mountain"]; focus = "tectonic-plates";
    intent = himalayan ? "India dan Eurasia bertumbukan; rangkaian Himalaya terangkat di batas kedua lempeng." : "Dua lempeng bertemu; penampang memperlihatkan deformasi kerak di batasnya.";
  } else if (matched.includes("mountain") || matched.includes("rock")) {
    type = "full-landscape"; visual = geologicalLandscape(); focus = matched.includes("mountain") ? "mountain" : "rock";
  } else if (matched.includes("lightning") && matched.includes("cloud")) {
    type = "cross-section"; visual = lightningLandscape(); objects = ["cloud", "lightning"]; focus = "lightning";
  } else if (matched.includes("bear")) {
    type = "full-landscape"; visual = habitatLandscape(); focus = "bear";
  } else return undefined;

  return { type, composition: visual, objects: objects.slice(0, 12), focus, intent };
}

export function proceduralIllustration(matched: readonly string[], worldObjects: readonly string[], copy: string, preferredFocus?: string | null): {
  type: IllustrationType; composition: VisualComposition; objects: string[]; focus: string; intent: string;
} | undefined {
  const has = (...ids: string[]) => ids.every((id) => matched.includes(id));
  const worldHas = (...ids: string[]) => ids.every((id) => worldObjects.includes(id));
  const unique = (...ids: string[]) => [...new Set(ids)] as VisualObjectId[];
  const focus = (fallback: VisualObjectId) => preferredFocus && matched.includes(preferredFocus) ? preferredFocus : fallback;
  const result = (type: IllustrationType, visual: VisualComposition, objects: VisualObjectId[], primary: VisualObjectId, intent: string) => ({ type, composition: visual, objects, focus: focus(primary), intent });

  if (has("river", "ocean")) {
    const minerals = matched.includes("mineral") || matched.includes("salt-crystal");
    return result("connected-environment", connectedRiver(minerals), unique("mountain", "river", ...(minerals ? ["mineral"] : []), "ocean"), "river", "Bentang alam menghubungkan hulu sungai ke laut; partikel bergerak hanya jika mineral disebut dalam scene.");
  }
  if (has("ocean", "sun", "evaporation")) {
    const salt = matched.includes("salt-crystal") || matched.includes("mineral");
    return result("cross-section", evaporation(salt), unique("sun", "ocean", "evaporation", ...(salt ? ["salt-crystal"] : [])), "evaporation", "Molekul air naik dari permukaan laut; garam hanya ditampilkan jika narasi menyebut ion/garam.");
  }
  if (matched.includes("ocean")) {
    const salt = matched.includes("salt-crystal") || matched.includes("mineral");
    return result("hero-object-focus", seaHero(false, salt), unique("ocean", ...(salt ? ["salt-crystal"] : [])), "ocean", salt ? "Laut menjadi hero scene dengan ion terlarut di antara gelombang." : "Laut divisualisasikan sebagai lingkungan, tanpa menambahkan zat yang tidak disebut.");
  }
  if (matched.includes("river")) {
    const minerals = matched.includes("mineral") || matched.includes("salt-crystal");
    return result("connected-environment", riverValley(minerals), unique("mountain", "river", ...(minerals ? ["mineral"] : [])), "river", minerals ? "Partikel mineral mengikuti aliran sungai melalui lembah." : "Sungai berkelok melintasi lembah; arah aliran digambar bertahap.");
  }
  if (has("rain", "rock") && (matched.includes("mineral") || worldHas("mineral"))) {
    return result("cross-section", rainAndWeathering(), ["rain", "mountain", "rock", "mineral"], "rock", "Hujan jatuh ke batuan; rekahan dan limpasan menunjukkan mineral terlepas.");
  }
  if (matched.includes("rain")) {
    return result("full-landscape", rainyLandscape(), ["rain", "cloud", "mountain"], "rain", "Garis hujan bergerak turun ke bentang alam; tidak menambahkan proses pelapukan tanpa batuan.");
  }
  if (matched.includes("volcano") || matched.includes("magma")) {
    return result("cross-section", volcanoCrossSection(), ["volcano", "magma"], "volcano", "Penampang gunung api menghubungkan magma bawah tanah ke kawah.");
  }
  if (matched.includes("tectonic-plates")) {
    return result("scientific-diagram", tectonicCrossSection(), ["tectonic-plates", "mountain"], "tectonic-plates", "Penampang menunjukkan dua lempeng dan batas pergerakannya.");
  }
  if (matched.includes("evaporation") || matched.includes("water-cycle")) {
    return result("step-by-step-process", matched.includes("water-cycle") ? waterCycle() : evaporation(false), unique(...matched.filter((id) => ["sun", "ocean", "evaporation", "water-cycle", "cloud", "rain"].includes(id)) as VisualObjectId[]), matched.includes("water-cycle") ? "water-cycle" : "evaporation", "Uap air bergerak naik pada lintasan sederhana yang dapat dibaca per frame.");
  }
  if (matched.includes("magnetosphere") || matched.includes("charged-particles")) {
    if (matched.includes("charged-particles") || worldHas("charged-particles")) return result("scientific-diagram", magnetosphere(), unique("sun", "earth", "charged-particles", "magnetosphere"), "magnetosphere", "Medan magnet mengarahkan partikel bermuatan mengitari Bumi.");
    return result("scientific-diagram", magnetosphere(), ["earth", "magnetosphere"], "magnetosphere", "Garis medan magnet digambar mengelilingi Bumi sebagai konteks magnetosfer.");
  }
  if (matched.includes("ozone-layer") || matched.includes("uv-rays") || (matched.includes("atmosphere") && worldHas("earth"))) {
    const ozone = matched.includes("ozone-layer") || worldHas("ozone-layer");
    if (!matched.includes("uv-rays") && !worldHas("uv-rays") && !ozone) return undefined;
    return result("cross-section", sunEarthRays(ozone), unique("sun", "earth", "atmosphere", ...(ozone ? ["ozone-layer"] : []), "uv-rays"), ozone ? "ozone-layer" : "atmosphere", ozone ? "Penampang menunjukkan lapisan ozon menyerap sebagian radiasi UV." : "Sinar UV dan atmosfer ditampilkan terhadap Bumi sebagai konteks.");
  }
  if (has("earth", "atmosphere") && !matched.includes("sun")) return result("scientific-diagram", atmosphereOnly(), ["earth", "atmosphere"], "atmosphere", "Atmosfer ditampilkan sebagai selubung gas di sekitar Bumi, terpisah dari ozon.");
  if (has("earth", "sun") && !matched.includes("magnetosphere") && !matched.includes("ozone-layer")) return result("connected-environment", sunEarthWide(), ["sun", "earth"], "earth", "Cahaya menghubungkan Matahari dan Bumi dalam satu adegan ruang.");
  if (matched.includes("earth")) return result("hero-object-focus", earthHero(), ["earth"], "earth", "Bumi tampil sebagai objek utama pada latar ruang sederhana.");
  if (matched.includes("sun")) return result("hero-object-focus", sunScene(), ["sun"], "sun", "Matahari tampil sebagai sumber cahaya dengan ray paths." );
  if (matched.includes("lightning")) return result("cross-section", lightningLandscape(), ["cloud", "lightning"], "lightning", "Petir digambar sebagai pelepasan muatan dari awan ke daratan.");
  if (matched.includes("cloud")) return result("full-landscape", cloudScene(), ["cloud"], "cloud", "Awan tunggal menjadi hero illustration tanpa menyatakan hujan atau badai.");
  if (matched.includes("mineral")) return result("cross-section", mineralFocus(), ["mineral"], "mineral", "Partikel mineral divisualisasikan dalam konteks lapisan batuan, bukan sebagai kartu ikon.");
  if (matched.includes("rock")) return result("cross-section", geologicalLandscape(), ["rock", "mountain"], "rock", "Lapisan batuan menjadi fokus penampang geologi.");
  if (matched.includes("mountain")) return result("full-landscape", geologicalLandscape(), ["mountain"], "mountain", "Bentang gunung dibuat dari siluet berlapis dan kaki bukit.");
  if (matched.includes("bear")) return result("full-landscape", habitatLandscape(), ["bear"], "bear", "Beruang tampil pada habitat bersalju yang sederhana.");
  if (matched.includes("planet")) return result("hero-object-focus", earthHero(), ["planet"], "planet", "Planet tampil pada latar ruang sederhana; tanpa menyatakan orbit jika tidak disebut.");
  if (matched.includes("salt-crystal") && worldHas("ocean")) return result("hero-object-focus", seaHero(false, true), ["ocean", "salt-crystal"], "salt-crystal", "Ion garam ditampilkan terlarut dalam laut bersama identitas dunia yang sama.");
  if (matched.includes("salt-crystal")) return undefined;
  return undefined;
}
