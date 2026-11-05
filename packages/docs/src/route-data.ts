// Each page carries the sidebar of its own section (specification `docs-portal`, "One portal,
// three sections, two languages"): the configuration holds the three sections as groups, in the
// order of `scripts/sources.ts`, and this keeps the current one's entries, with the previous and
// next links recomputed inside it. The home has no sidebar.

import { defineRouteMiddleware, type StarlightRouteData } from "@astrojs/starlight/route-data";

export const SECTIONS = ["diagrams", "ide", "web"] as const;

type Entry = StarlightRouteData["sidebar"][number];
type Link = Extract<Entry, { type: "link" }>;

/** The links of a sidebar, in reading order. */
export function linksOf(entries: readonly Entry[]): Link[] {
  return entries.flatMap((entry) => (entry.type === "link" ? [entry] : linksOf(entry.entries)));
}

/** The section of a page's id: `es/diagrams/player` is in `diagrams`. */
export function sectionOf(id: string): number {
  const first = id.replace(/^es(\/|$)/, "").split("/")[0] ?? "";
  return (SECTIONS as readonly string[]).indexOf(first);
}

/** Narrows a route's sidebar to its section and the pagination to the section's pages. */
export function narrow(route: Pick<StarlightRouteData, "id" | "sidebar" | "pagination">): void {
  const at = sectionOf(route.id);
  const group = at >= 0 ? route.sidebar[at] : undefined;
  if (!group || group.type !== "group") return;
  route.sidebar = group.entries;
  const links = linksOf(group.entries);
  const current = links.findIndex((link) => link.isCurrent);
  route.pagination = {
    prev: current > 0 ? links[current - 1] : undefined,
    next: current >= 0 ? links[current + 1] : undefined,
  };
}

export const onRequest = defineRouteMiddleware((context) => {
  // Starlight declares `starlightRoute` on Astro's locals for Astro's own checker.
  narrow((context.locals as unknown as { starlightRoute: StarlightRouteData }).starlightRoute);
});
