import { visualIconIds } from "./visual-composition";

export const visualObjectIds = [
  "sun", "earth", "atmosphere", "ozone-layer", "uv-rays", "charged-particles", "magnetosphere",
  "rain", "rock", "mineral", "river", "ocean", "evaporation", "salt-crystal",
  "mountain", "volcano", "magma", "tectonic-plates", "lightning", "cloud", "water-cycle", "planet", "bear",
] as const;
export type VisualObjectId = typeof visualObjectIds[number];

export type ObjectDefinition = { label: string; role: string; keywords: string[]; icon: typeof visualIconIds[number] };
export const visualObjectLibrary: Record<VisualObjectId, ObjectDefinition> = {
  sun: { label: "MATAHARI", role: "Sumber energi", keywords: ["matahari", "sinar matahari", "solar"], icon: "sun" },
  earth: { label: "BUMI", role: "Planet", keywords: ["bumi", "planet bumi", "earth"], icon: "earth" },
  atmosphere: { label: "ATMOSFER", role: "Pelindung gas", keywords: ["atmosfer", "atmosphere"], icon: "atmosphere" },
  "ozone-layer": { label: "LAPISAN OZON", role: "Penyaring UV", keywords: ["lapisan ozon", "ozon", "ozone"], icon: "ozone-layer" },
  "uv-rays": { label: "SINAR UV", role: "Radiasi ultraviolet", keywords: ["sinar uv", "uv-c", "uv-b", "uv-a", "ultraviolet", "radiasi uv"], icon: "uv-ray" },
  "charged-particles": { label: "PARTIKEL BERMUATAN", role: "Partikel dari Matahari", keywords: ["partikel bermuatan", "partikel matahari", "angin surya", "solar wind", "charged particles"], icon: "charged-particle" },
  magnetosphere: { label: "MAGNETOSFER", role: "Pembelok partikel", keywords: ["magnetosfer", "magnetosphere", "medan magnet", "sabuk radiasi"], icon: "magnetosphere" },
  rain: { label: "HUJAN", role: "Pelapukan alami", keywords: ["hujan", "air hujan", "presipitasi", "rain"], icon: "rain" },
  rock: { label: "BATUAN", role: "Lapisan kerak", keywords: ["batuan", "batu", "rock", "pelapukan batu", "kerak", "lapisan kerak"], icon: "rock" },
  mineral: { label: "MINERAL", role: "Ion terlarut", keywords: ["mineral", "ion", "natrium", "klorida", "kristal"], icon: "crystal" },
  river: { label: "SUNGAI", role: "Pengangkut mineral", keywords: ["sungai", "aliran sungai", "river"], icon: "river" },
  ocean: { label: "LAUT", role: "Tempat garam terkumpul", keywords: ["air laut", "laut", "samudra", "ocean", "seawater"], icon: "ocean" },
  evaporation: { label: "PENGUAPAN", role: "Air naik sebagai uap", keywords: ["penguapan", "menguap", "evaporasi", "uap air", "evaporation"], icon: "evaporation" },
  "salt-crystal": { label: "GARAM TERTINGGAL", role: "Garam terlarut", keywords: ["garam", "salinitas", "salt", "na+", "cl-", "natrium klorida"], icon: "salt-crystal" },
  mountain: { label: "PEGUNUNGAN", role: "Bentang alam", keywords: ["gunung", "pegunungan", "mountain", "himalaya"], icon: "mountain" },
  volcano: { label: "GUNUNG API", role: "Sumber magma", keywords: ["gunung api", "vulkanik", "volcano", "erupsi"], icon: "volcano" },
  magma: { label: "MAGMA", role: "Material batuan cair", keywords: ["magma", "lava", "batuan cair"], icon: "magma" },
  "tectonic-plates": { label: "LEMPENG TEKTONIK", role: "Kerak yang bergerak", keywords: ["lempeng", "tektonik", "tumbukan benua", "tumbukan", "plate boundary"], icon: "tectonic-plates" },
  lightning: { label: "PETIR", role: "Pelepasan muatan", keywords: ["petir", "kilat", "lightning", "muatan listrik"], icon: "lightning" },
  cloud: { label: "AWAN", role: "Kondensasi air", keywords: ["awan", "cloud", "kondensasi"], icon: "cloud" },
  "water-cycle": { label: "SIKLUS AIR", role: "Perputaran air", keywords: ["siklus air", "water cycle"], icon: "water-drop" },
  planet: { label: "PLANET", role: "Benda langit", keywords: ["planet", "orbit", "tata surya"], icon: "planet" },
  bear: { label: "BERUANG", role: "Satwa", keywords: ["beruang", "bear", "arktik"], icon: "bear" },
};

const normalized = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("id-ID").replace(/[^\p{L}\p{N}+]+/gu, " ").trim();
export function visualObjectsForText(text: string): VisualObjectId[] {
  const haystack = ` ${normalized(text)} `;
  return visualObjectIds.filter((id) => visualObjectLibrary[id].keywords.some((keyword) => haystack.includes(` ${normalized(keyword)} `)));
}
