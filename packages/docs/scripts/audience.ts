// Repository documentation also holds implementation notes and internal evidence. Keep those
// sources available for pinned GitHub links, but do not turn them into public product guides.

import type { Section } from "../src/messages/index.js";

const INTERNAL_FOLDERS = new Set([
  "decisions",
  "qa",
  "quality",
  "verification",
  "research",
  "ux",
  "operaciones",
  "operations",
  "pilot",
  "launch",
]);

const INTERNAL_PAGES: Record<Section, ReadonlySet<string>> = {
  diagrams: new Set(["quality.md", "roadmap-1.0.md", "central-administration-service.md"]),
  ide: new Set([
    "plan-de-cambios.md",
    "arquitectura.md",
    "conformidad-manual.md",
    "e2e-manual.md",
    "hito-v01.md",
    "paridad-nucleo.md",
    "politica-spdx.md",
    "prueba-de-uno.md",
    "verificacion-fase-0.md",
  ]),
  web: new Set(["central-administration.md"]),
};

/** Whether a Markdown source under docs/ is intended for a person using the product. */
export function isUserGuide(section: Section, source: string): boolean {
  const path = source.replace(/^docs\/(?:es\/)?/, "");
  return !INTERNAL_FOLDERS.has(path.split("/")[0]!) && !INTERNAL_PAGES[section].has(path);
}
