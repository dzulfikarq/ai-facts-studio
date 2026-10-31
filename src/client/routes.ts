import { normalizeWorkspaceStep, type WorkspaceStep } from "./workflow";

export type AppRoute =
  | { view: "dashboard" }
  | { view: "create" }
  | { view: "settings" }
  | { view: "workspace"; projectId: string; step: WorkspaceStep; sceneId: string | null };

export function parseAppRoute(input: string | URL): AppRoute {
  const url = input instanceof URL ? input : new URL(input, "http://localhost");
  if (url.pathname === "/create") return { view: "create" };
  if (url.pathname === "/settings") return { view: "settings" };
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
  if (route.view === "create" || route.view === "settings") return `/${route.view}`;
  const path = `/projects/${encodeURIComponent(route.projectId)}${route.step === "video-editor" ? "/editor" : ""}`;
  const query = new URLSearchParams();
  if (route.step !== "materials" && route.step !== "video-editor") query.set("step", route.step);
  if (route.sceneId) query.set("scene", route.sceneId);
  const suffix = query.toString();
  return `${path}${suffix ? `?${suffix}` : ""}`;
}
