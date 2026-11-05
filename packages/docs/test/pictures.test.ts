// `scripts/pictures.ts` (specification `docs-portal`, "Pictures from the code"): the fixture's
// three fences of `language/stories.md` with the installed command line, which draws SVG with no
// browser and no network, and the cache, measured with a counting exporter.

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { convertSection } from "../scripts/convert.js";
import {
  addPictures,
  cliExporter,
  inlineSvg,
  textFences,
  type Exporter,
} from "../scripts/pictures.js";
import { fixtureSources } from "../scripts/sources.js";

const caches: string[] = [];
afterAll(() => {
  for (const dir of caches) rmSync(dir, { recursive: true, force: true });
});
const cache = () => {
  const dir = mkdtempSync(join(tmpdir(), "meltemi-pictures-"));
  caches.push(dir);
  return dir;
};

const stories = () => {
  const section = convertSection(fixtureSources().find((t) => t.section === "diagrams")!);
  return section.pages.filter((p) => p.id === "language/stories");
};

describe("pictures from text fences", () => {
  it("finds the three text fences of the Stories page", () => {
    const english = stories().find((p) => p.lang === "en")!;
    const fences = textFences(english.body);
    expect(fences).toHaveLength(3);
    expect(fences[0]!.source).toContain("story purchase for checkout");
    expect(fences[1]!.source).toBe("reveal client, api over 800ms\n");
    expect(fences[2]!.source).toMatch(/^The video is/);
  });

  it("draws the purchase story's diagram under its fence, and leaves the fragment and the prose as code", async () => {
    const pages = stories();
    const report = await addPictures(pages, { exporter: cliExporter(), cache: cache() });
    expect(report).toEqual({ fences: 3, drawn: 1 });
    const body = pages.find((p) => p.lang === "en")!.body;
    const figures = [
      ...body.matchAll(/<figure class="meltemi-picture"[^>]*>\n(<svg[\s\S]*?<\/svg>)\n<\/figure>/g),
    ];
    expect(figures).toHaveLength(1);
    const svg = figures[0]![1]!;
    expect(svg).toContain('data-id="client"');
    expect(svg).toContain('data-id="api"');
    expect(svg).toMatch(/<svg role="img" aria-label="Checkout, a diagram of Stories"/);
    expect(svg, "no blank line inside the HTML block").not.toMatch(/\n\s*\n/);
    // The picture follows its fence; the fragment's fence is followed by prose, not a figure.
    expect(body.indexOf("<figure")).toBeGreaterThan(body.indexOf("story purchase for checkout"));
    expect(body.indexOf("<figure")).toBeLessThan(body.indexOf("## Actions"));
    const afterFragment = body.slice(body.indexOf("reveal client, api over 800ms\n```"));
    expect(afterFragment.indexOf("<figure")).toBe(-1);
  }, 120_000);

  it("draws a fence once and answers the next build from the cache", async () => {
    let calls = 0;
    const counting: Exporter = {
      version: "counting-1",
      async draw(source) {
        calls++;
        return source.includes("story purchase")
          ? `<svg xmlns="http://www.w3.org/2000/svg"><title>T</title></svg>`
          : undefined;
      },
    };
    const dir = cache();
    await addPictures(stories(), { exporter: counting, cache: dir });
    expect(calls).toBe(3);
    expect(
      readdirSync(dir)
        .sort()
        .map((f) => f.split(".")[1]),
    ).toEqual(["none", "none", "svg"]);
    const again = stories();
    const report = await addPictures(again, { exporter: counting, cache: dir });
    expect(calls, "the second build drew nothing").toBe(3);
    expect(report.drawn).toBe(1);
    expect(again.find((p) => p.lang === "en")!.body).toContain(
      '<svg role="img" aria-label="T, a diagram of Stories"',
    );
  });

  it("prefixes the ids of a picture so two on one page never share one", () => {
    const svg = `<svg><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use href="#g"/></svg>`;
    expect(inlineSvg(svg, "A", "p1")).toBe(
      `<svg role="img" aria-label="A"><defs><linearGradient id="p1-g"/></defs><rect fill="url(#p1-g)"/><use href="#p1-g"/></svg>`,
    );
  });
});
