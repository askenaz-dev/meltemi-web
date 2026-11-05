// Pictures from the code (design decision 4; specification `docs-portal`, "Pictures from the
// code"). Every `text` fence of a page is handed to the Diagrams command line; a fence that exports
// with no error is followed by its picture, inline, and a fence that does not stays code alone
// (the language guides' fragments and the diagnostics guide's deliberate errors).
//
// One export per distinct fence, cached in `.cache/pictures/` by the hash of the command line's
// version and the fence, so a rebuild draws only new fences.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { messagesOf } from "../src/messages/index.js";
import { fencedLines, type PortalPage } from "./convert.js";

export interface Exporter {
  /** A version that changes when the pictures could: the cache's key includes it. */
  readonly version: string;
  /** The SVG of a Meltemi source, or `undefined` when it does not export. */
  draw(source: string): Promise<string | undefined>;
}

/** The installed `@meltemi/diagrams-cli`, run with Node: `export <file> --stdout --fonts system`. */
export function cliExporter(): Exporter {
  // The package exports no `package.json`: it is read where pnpm links it, beside this package.
  const manifest = fileURLToPath(
    new URL("../node_modules/@meltemi/diagrams-cli/package.json", import.meta.url),
  );
  const { version, bin } = JSON.parse(readFileSync(manifest, "utf8")) as {
    version: string;
    bin: Record<string, string>;
  };
  const script = join(dirname(manifest), bin["meltemi-diagrams"]!);
  return {
    version: `@meltemi/diagrams-cli@${version}`,
    async draw(source) {
      const dir = mkdtempSync(join(tmpdir(), "meltemi-picture-"));
      const file = join(dir, "fence.meltemi");
      writeFileSync(file, source);
      try {
        const svg = await new Promise<string | undefined>((resolve) => {
          execFile(
            process.execPath,
            [script, "export", file, "--stdout", "--fonts", "system"],
            { cwd: dir, timeout: 60_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
            (error, stdout) => resolve(error ? undefined : stdout),
          );
        });
        return svg && svg.trimStart().startsWith("<svg") ? svg : undefined;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

export interface Fence {
  /** The line of the opening fence, from 0. */
  readonly start: number;
  /** The line of the closing fence. */
  readonly end: number;
  readonly source: string;
}

/** The `text` fences of a page's body. */
export function textFences(body: string): Fence[] {
  const lines = fencedLines(body);
  const fences: Fence[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(`{3,}|~{3,})\s*text\s*$/.exec(lines[i]!.line);
    if (!open || !lines[i]!.code) continue;
    let j = i + 1;
    while (j < lines.length && !(lines[j]!.code && lines[j]!.line.trim() === open[2])) j++;
    if (j >= lines.length) break;
    const indent = open[1]!.length;
    const source = lines
      .slice(i + 1, j)
      .map(({ line }) => line.slice(Math.min(indent, line.length - line.trimStart().length)))
      .join("\n");
    fences.push({ start: i, end: j, source: `${source}\n` });
    i = j;
  }
  return fences;
}

const keyOf = (version: string, source: string) =>
  createHash("sha256").update(version).update("\n").update(source).digest("hex");

/** Draws a fence once: the cache's answer if it has one, the exporter's otherwise. */
export async function drawCached(
  exporter: Exporter,
  cache: string,
  source: string,
): Promise<string | undefined> {
  const key = keyOf(exporter.version, source);
  const svgFile = join(cache, `${key}.svg`);
  const noneFile = join(cache, `${key}.none`);
  if (existsSync(svgFile)) return readFileSync(svgFile, "utf8");
  if (existsSync(noneFile)) return undefined;
  const svg = await exporter.draw(source);
  mkdirSync(cache, { recursive: true });
  if (svg) writeFileSync(svgFile, svg);
  else writeFileSync(noneFile, "");
  return svg;
}

const escapeAttribute = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/**
 * The SVG as the page holds it: one line per element and no blank line (an HTML block in Markdown
 * ends at one), its ids prefixed so two pictures on a page never share one, and an accessible name.
 */
export function inlineSvg(svg: string, label: string, prefix: string): string {
  const body = svg
    .replace(/<\?xml[^>]*\?>/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(?<![\w-])id="([^"]+)"/g, `id="${prefix}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
    .replace(/(?<![\w-])href="#([^"]+)"/g, `href="#${prefix}-$1"`)
    .replace(/\n\s*\n/g, "\n")
    .trim();
  return body.replace(/^<svg\b/, `<svg role="img" aria-label="${escapeAttribute(label)}"`);
}

/** The title an exported SVG names, if any. */
const svgTitle = (svg: string) => /<title>([^<]*)<\/title>/.exec(svg)?.[1]?.trim() ?? "";

export interface PicturesReport {
  readonly fences: number;
  readonly drawn: number;
}

/**
 * Puts each page's pictures under the fences that draw, in place. Pages are drawn a few at a time;
 * the same fence on two pages (a guide and its twin) is exported once.
 */
export async function addPictures(
  pages: PortalPage[],
  {
    exporter = cliExporter(),
    cache,
    concurrency = 6,
  }: { exporter?: Exporter; cache: string; concurrency?: number },
): Promise<PicturesReport> {
  const queue = pages
    .filter((p) => !p.notice)
    .flatMap((page) => textFences(page.body).map((fence) => ({ page, fence })));
  const distinct = [...new Set(queue.map((q) => q.fence.source))];
  const results = new Map<string, string | undefined>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, distinct.length) }, async () => {
      while (next < distinct.length) {
        const source = distinct[next++]!;
        results.set(source, await drawCached(exporter, cache, source));
      }
    }),
  );
  let drawn = 0;
  for (const page of pages) {
    if (page.notice) continue;
    const fences = textFences(page.body);
    if (!fences.length) continue;
    const lines = page.body.split("\n");
    const words = messagesOf(page.lang).pictures;
    for (const fence of [...fences].reverse()) {
      const svg = results.get(fence.source);
      if (!svg) continue;
      drawn++;
      const prefix = `p${keyOf("", fence.source).slice(0, 8)}`;
      const figure = [
        "",
        `<figure class="meltemi-picture" data-pagefind-ignore>`,
        inlineSvg(svg, words.label(page.title, svgTitle(svg)), prefix),
        `</figure>`,
        "",
      ];
      lines.splice(fence.end + 1, 0, ...figure);
    }
    page.body = lines.join("\n");
  }
  return { fences: queue.length, drawn };
}
