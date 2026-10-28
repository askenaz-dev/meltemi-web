// What the checks of the site read: the files of `public/`, the pages among them, the tags and
// attributes of a page, and where an address leads. Written for the pages as they are (double-
// quoted attributes, one `index.html` per folder) and strict about anything else.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ASSETS, BUILT } from "../scripts/build.js";

export const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));

/** Every file under `public/`, as a path with `/` separators relative to it. */
export function walk(dir = PUBLIC, prefix = ""): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...walk(full, `${prefix}${name}/`));
    else found.push(`${prefix}${name}`);
  }
  return found;
}

/**
 * The files of `public/`: what is committed, and what the build writes into `public/assets/`,
 * whether or not a build has run (`scripts/build.ts` declares its outputs).
 */
export const FILES = [...walk().filter((f) => !f.startsWith(`${ASSETS}/`)), ...BUILT].sort();
export const fileSet = new Set(FILES);

export function read(file: string): string {
  return readFileSync(join(PUBLIC, file), "utf8");
}

/** Every page: an `index.html` per folder, and the 404 page. */
export const PAGES = FILES.filter((f) => f === "index.html" || f.endsWith("/index.html"));
export const ALL_HTML = FILES.filter((f) => f.endsWith(".html"));

/** The address a page answers at: `ide/method/index.html` is `/ide/method/`. */
export function pageUrl(file: string): string {
  if (file === "404.html") return "/404.html";
  return `/${file.replace(/index\.html$/, "")}`;
}

export const isSpanish = (url: string) => url === "/es/" || url.startsWith("/es/");

/** The address of a page's twin in the other language. */
export function twinUrl(url: string): string {
  if (isSpanish(url)) return url === "/es/" ? "/" : url.slice("/es".length);
  return url === "/" ? "/es/" : `/es${url}`;
}

export function fileOfUrl(url: string): string {
  return url.endsWith("/") ? `${url.slice(1)}index.html` : url.slice(1);
}

export interface Tag {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
}

const TAG = /<([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g;
const ATTR = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** The start tags of a document, with their attributes (comments removed first). */
export function tags(html: string): Tag[] {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  const found: Tag[] = [];
  for (const match of withoutComments.matchAll(TAG)) {
    const attrs: Record<string, string> = {};
    for (const a of (match[2] ?? "").matchAll(ATTR)) {
      attrs[a[1]!.toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? "";
    }
    found.push({ name: match[1]!.toLowerCase(), attrs });
  }
  return found;
}

const SITE = "https://site.test";

export type Target =
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "skip" }
  | { readonly kind: "internal"; readonly pathname: string; readonly hash: string };

/** Where an `href` or `src` of a page leads: out of the site, nowhere to check, or a path. */
export function target(value: string, pageAddress: string): Target {
  if (/^(mailto|tel):/i.test(value)) return { kind: "skip" };
  if (/^javascript:/i.test(value)) return { kind: "external", url: value };
  const url = new URL(value, SITE + pageAddress);
  if (url.origin !== SITE) return { kind: "external", url: url.href };
  return { kind: "internal", pathname: url.pathname, hash: url.hash.slice(1) };
}

/** The ids and names an anchor can point at in a document. */
export function anchors(html: string): Set<string> {
  const found = new Set<string>();
  for (const tag of tags(html)) {
    if (tag.attrs["id"]) found.add(tag.attrs["id"]);
    if (tag.name === "a" && tag.attrs["name"]) found.add(tag.attrs["name"]);
  }
  return found;
}

/** The absolute links of a page's `<a>` elements. */
export function externalLinks(html: string, pageAddress: string): string[] {
  const links: string[] = [];
  for (const tag of tags(html)) {
    const href = tag.name === "a" ? tag.attrs["href"] : undefined;
    if (href === undefined) continue;
    const t = target(href, pageAddress);
    if (t.kind === "external") links.push(t.url);
  }
  return links;
}

/** The parsed `_redirects`: one `[from, to, status]` per rule. */
export function redirects(): [string, string, string][] {
  return read("_redirects")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => line.split(/\s+/) as [string, string, string]);
}

/** The rule for a path in `_headers`: the header lines under it. */
export function headersFor(path: string): Record<string, string> {
  const lines = read("_headers").split("\n");
  const result: Record<string, string> = {};
  let inside = false;
  for (const line of lines) {
    if (line.trim() === "") continue;
    if (!/^\s/.test(line)) {
      inside = line.trim() === path;
      continue;
    }
    if (!inside) continue;
    const at = line.indexOf(":");
    result[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return result;
}

/** A JSONC file without trailing commas, parsed; comments are refused. */
export function parseJsonc(text: string): unknown {
  if (/^\s*\/\/|\/\*/m.test(text)) throw new Error("wrangler.jsonc holds comments");
  return JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"));
}
