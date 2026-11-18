import { normalizeWorkspaceStep, type WorkspaceStep } from "./workflow";

export const settingsSections = ["general", "appearance", "ai-generation", "outro-library", "preferences"] as const;
export type SettingsSection = typeof settingsSections[number];

export type AppRoute =
  | { view: "dashboard" }
  | { view: "create" }
  | { view: "series-library"; slug: string | null }
  | { view: "series-detail"; seriesId: string }
  | { view: "series-generation"; draftId: string }
  | { view: "settings"; section: SettingsSection }
  | { view: "workspace"; projectId: string; step: WorkspaceStep; sceneId: string | null };

export function parseAppRoute(input: string | URL): AppRoute {
  const url = input instanceof URL ? input : new URL(input, "http://localhost");
  if (url.pathname === "/create") return { view: "create" };
  if (url.pathname === "/series" || url.pathname === "/series/") return { view: "series-library", slug: url.searchParams.get("slug") };
  const generationMatch = url.pathname.match(/^\/series\/generate\/([^/]+)\/?$/);
  if (generationMatch) {
    try {
      const draftId = decodeURIComponent(generationMatch[1]!);
      if (draftId && !draftId.includes("/")) return { view: "series-generation", draftId };
    } catch { return { view: "dashboard" }; }
  }
  const seriesMatch = url.pathname.match(/^\/series\/([^/]+)\/?$/);
  if (seriesMatch) {
    try {
      const seriesId = decodeURIComponent(seriesMatch[1]!);
      if (seriesId && !seriesId.includes("/")) return { view: "series-detail", seriesId };
    } catch { return { view: "dashboard" }; }
  }
  if (url.pathname === "/settings") {
    const section = url.searchParams.get("section");
    return { view: "settings", section: settingsSections.find((value) => value === section) ?? "general" };
  }
  const match = url.pathname.match(/^\/projects\/([^/]+)(\/editor)?\/?$/);
  if (match) {
    try {
      const projectId = decodeURIComponent(match[1]!);
      if (!projectId || projectId.includes("/")) return { view: "dashboard" };
      const step = match[2] ? "video-editor" : normalizeWorkspaceStep(url.searchParams.get("step")) ?? "materials";
      return { view: "workspace", projectId, step, sceneId: url.searchParams.get("scene") };
    } catch { return { view: "dashboard" }; }
  }
  return { view: "dashboard" };
}

export function appRouteHref(route: AppRoute): string {
  if (route.view === "dashboard") return "/";
  if (route.view === "create") return "/create";
  if (route.view === "series-library") return route.slug ? `/series?slug=${encodeURIComponent(route.slug)}` : "/series";
  if (route.view === "series-detail") return `/series/${encodeURIComponent(route.seriesId)}`;
  if (route.view === "series-generation") return `/series/generate/${encodeURIComponent(route.draftId)}`;
  if (route.view === "settings") return route.section === "general" ? "/settings" : `/settings?section=${route.section}`;
  const path = `/projects/${encodeURIComponent(route.projectId)}${route.step === "video-editor" ? "/editor" : ""}`;
  const query = new URLSearchParams();
  if (route.step !== "materials" && route.step !== "video-editor") query.set("step", route.step);
  if (route.sceneId) query.set("scene", route.sceneId);
  const suffix = query.toString();
  return `${path}${suffix ? `?${suffix}` : ""}`;
}
