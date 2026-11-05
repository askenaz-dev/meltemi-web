// The conversion of a repository's Markdown into the portal's pages (design decision 3;
// specification `docs-sources`, "Conversion of a page"). One exported function per rule, each with
// its case in test/convert.test.ts:
//
//   readTitle        the first `# Heading` is the title, and leaves the body
//   readDescription  the first paragraph, as plain text, is the description
//   dropTwinLink     a first-line `[Español](…)` or `[English](…)` link to the twin is dropped
//   resolveLink      links to pages inside docs/ become portal routes (anchors kept), links to
//                    files outside it GitHub links at the source's ref, media the copied files;
//                    a link to a page or file that does not exist fails, naming page and link
//   rewriteLinks     applies resolveLink to every link, image and reference of a page, outside code;
//                    a picture from another host becomes its words (the portal loads nothing
//                    from elsewhere)
//   detectLanguage   the language of a page in a repository with no `docs/es/` mirror
//   sidebarOf        the order of the section's own index, then the pages it does not link
//   noticePage       a page that exists in one language only, written to the other locale
//
// Nothing here touches the disk: a tree goes in, pages, media and a sidebar come out.

import { posix } from "node:path";
import { messages, type Lang, type Section } from "../src/messages/index.js";
import type { SourceTree } from "./sources.js";

export class ConvertError extends Error {
  override name = "ConvertError";
}

/** A page of the portal, as `src/content/docs/<file>` will hold it. */
export interface PortalPage {
  readonly section: Section;
  readonly lang: Lang;
  /** Its id inside the section: `player`, `language/stories`, `index`. */
  readonly id: string;
  /** Starlight's slug: `diagrams/player`, `es/diagrams/player`, `diagrams`. */
  readonly slug: string;
  /** Its address: `/diagrams/player/`. */
  readonly url: string;
  /** Its file under `src/content/docs/`. */
  readonly file: string;
  /** The repository file it comes from. */
  readonly source: string;
  readonly title: string;
  readonly description: string | undefined;
  /** "Source on GitHub": the file at the source's ref. */
  readonly editUrl: string;
  /** The Markdown body, converted. */
  body: string;
  /** True for the other language's notice page of a one-language guide. */
  readonly notice: boolean;
  /** Its position in the section's sidebar. */
  order: number;
}

export interface SidebarLink {
  readonly slug: string;
  readonly label?: string;
  readonly translations?: Record<string, string>;
}
export interface SidebarGroup {
  readonly label: string;
  readonly translations?: Record<string, string>;
  readonly collapsed?: boolean;
  readonly items: SidebarNode[];
}
export type SidebarNode = SidebarLink | SidebarGroup;

export interface ConvertedSection {
  readonly section: Section;
  readonly pages: PortalPage[];
  /** The media the pages link, by their path in the portal (`diagrams/media/demo.gif`). */
  readonly media: Map<string, Uint8Array>;
  readonly sidebar: SidebarNode[];
}

const decoder = new TextDecoder("utf-8", { fatal: false });
export const textOf = (bytes: Uint8Array) => decoder.decode(bytes).replace(/\r\n?/g, "\n");

// ---------------------------------------------------------------------------------------------
// Addresses.

/** A path segment as the portal writes it: lower case, letters, digits, dots, dashes. */
export const segmentOf = (segment: string) =>
  segment
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "-";

export const idOfPath = (path: string) => path.split("/").map(segmentOf).join("/");

export function slugOf(section: Section, lang: Lang, id: string): string {
  const base = id === "index" ? section : `${section}/${id}`;
  return lang === "es" ? `es/${base}` : base;
}

export const urlOf = (section: Section, lang: Lang, id: string) => `/${slugOf(section, lang, id)}/`;

export function fileOf(section: Section, lang: Lang, id: string): string {
  const base = `${section}/${id}.md`;
  return lang === "es" ? `es/${base}` : base;
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
export const githubBlob = (repo: string, ref: string, path: string) =>
  `https://github.com/${repo}/blob/${encodeURIComponent(ref)}/${encodePath(path)}`;
export const githubTree = (repo: string, ref: string, path: string) =>
  `https://github.com/${repo}/tree/${encodeURIComponent(ref)}/${encodePath(path)}`;

// ---------------------------------------------------------------------------------------------
// Code: what no rule may touch.

/** The lines of a page with, for each, whether it is inside a fenced block (fences included). */
export function fencedLines(markdown: string): { line: string; code: boolean }[] {
  const out: { line: string; code: boolean }[] = [];
  let fence: { char: string; length: number } | undefined;
  for (const line of markdown.split("\n")) {
    const open = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      out.push({ line, code: true });
      if (
        open &&
        open[1]![0] === fence.char &&
        open[1]!.length >= fence.length &&
        line.trim() === open[1]
      ) {
        fence = undefined;
      }
    } else if (
      open &&
      !(open[1]![0] === "`" && line.slice(line.indexOf(open[1]!) + open[1]!.length).includes("`"))
    ) {
      fence = { char: open[1]![0]!, length: open[1]!.length };
      out.push({ line, code: true });
    } else {
      out.push({ line, code: false });
    }
  }
  return out;
}

/** Applies `rewrite` to the text of a line outside its code spans. */
function outsideCodeSpans(line: string, rewrite: (text: string) => string): string {
  const parts = line.split(/(`+[^`]*?`+)/g);
  return parts
    .map((part, i) => (i % 2 === 1 && /^`+[\s\S]*`+$/.test(part) ? part : rewrite(part)))
    .join("");
}

// ---------------------------------------------------------------------------------------------
// Rules.

/** Inline Markdown as plain text: links, emphasis and code marks removed. */
export function plain(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_]([^*_]+)[*_](?=[^\w*]|$)/g, "$1$2")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The page's title, its first `# Heading` (after blank lines and HTML comments), and the body
 * without it. A page without one fails, naming it.
 */
export function readTitle(markdown: string, where: string): { title: string; body: string } {
  const lines = markdown.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (line === "") {
      i++;
      continue;
    }
    if (line.startsWith("<!--")) {
      while (i < lines.length && !lines[i]!.includes("-->")) i++;
      i++;
      continue;
    }
    break;
  }
  const heading = /^#\s+(.+?)\s*#*\s*$/.exec(lines[i]?.trim() ?? "");
  if (!heading) {
    throw new ConvertError(
      `${where}: no title could be read: the page does not start with a "# Heading"`,
    );
  }
  const title = plain(heading[1]!);
  if (!title) throw new ConvertError(`${where}: no title could be read: its heading is empty`);
  return {
    title,
    body: lines
      .slice(i + 1)
      .join("\n")
      .replace(/^\n+/, ""),
  };
}

const TWIN = /^\[(Español|English|Spanish|Inglés)\]\([^)]*\)\.?$/;

/** The body without its first-line link to the twin in the other language. */
export function dropTwinLink(body: string): string {
  const lines = body.split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first >= 0 && TWIN.test(lines[first]!.trim())) {
    lines.splice(first, 1);
    while (lines[first]?.trim() === "") lines.splice(first, 1);
  }
  return lines.join("\n").replace(/^\n+/, "");
}

/** The first paragraph of the body, as plain text of at most 300 characters. */
export function readDescription(body: string): string | undefined {
  const blocks: string[] = [];
  let current: string[] = [];
  for (const { line, code } of fencedLines(body)) {
    if (code || line.trim() === "") {
      if (current.length) blocks.push(current.join(" "));
      current = [];
      if (code) blocks.push("```");
      continue;
    }
    current.push(line.trim());
  }
  if (current.length) blocks.push(current.join(" "));
  const paragraph = blocks.find(
    (block) =>
      !/^(#|```|\||<|!\[|>|[-*+]\s|\d+[.)]\s|---|\[!\[|:::)/.test(block) &&
      !/^(\[[^\]]*\]\([^)]*\)\s*)+$/.test(block),
  );
  if (!paragraph) return undefined;
  const text = plain(paragraph);
  if (!text) return undefined;
  if (text.length <= 300) return text;
  const cut = text.slice(0, 299);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 200 ? cut.lastIndexOf(" ") : 299)}…`;
}

const EN_WORDS = new Set(
  "the and of to is in that it for with as are on this be by or not you your can which from when".split(
    " ",
  ),
);
const ES_WORDS = new Set(
  "el la los las de que y en un una es por con para del se lo al como más su sus pero esta este".split(
    " ",
  ),
);

/** The language of a text: the one whose commonest words it uses more, outside code. */
export function detectLanguage(markdown: string): Lang {
  let en = 0;
  let es = 0;
  for (const { line, code } of fencedLines(markdown)) {
    if (code) continue;
    const prose = line
      .replace(/`[^`]*`/g, " ")
      .replace(/\]\([^)]*\)/g, "]")
      .toLowerCase();
    for (const word of prose.match(/[a-záéíóúñü]+/g) ?? []) {
      if (EN_WORDS.has(word)) en++;
      if (ES_WORDS.has(word)) es++;
    }
  }
  return es > en ? "es" : "en";
}

// ---------------------------------------------------------------------------------------------
// The section's pages and how links reach them.

interface SourcePage {
  readonly source: string;
  readonly lang: Lang;
  readonly id: string;
}

/**
 * The Markdown pages of a tree with their language and id. With a `docs/es/` mirror, `docs/x.md`
 * is English and `docs/es/x.md` Spanish; without one, each page's language is read from its words.
 * The section's index is `docs/README.md` (per language), else the repository's readmes.
 */
export function sourcePages(tree: SourceTree): SourcePage[] {
  const paths = [...tree.files.keys()]
    .filter((p) => p.startsWith("docs/") && p.toLowerCase().endsWith(".md"))
    .sort();
  const mirrored = paths.some((p) => p.startsWith("docs/es/"));
  const pages: SourcePage[] = [];
  for (const source of paths) {
    let rel = source.slice("docs/".length);
    let lang: Lang;
    if (mirrored) {
      lang = rel.startsWith("es/") ? "es" : "en";
      if (lang === "es") rel = rel.slice(3);
    } else {
      lang = detectLanguage(textOf(tree.files.get(source)!));
    }
    const withoutExt = rel.replace(/\.md$/i, "");
    const base = posix.basename(withoutExt);
    const dir = posix.dirname(withoutExt);
    const id =
      base.toLowerCase() === "readme"
        ? dir === "."
          ? "index"
          : idOfPath(dir)
        : idOfPath(withoutExt);
    pages.push({ source, lang, id });
  }
  const readmes: [string, Lang][] = [
    ["README.md", "en"],
    ["README.es.md", "es"],
    ["LEEME.md", "es"],
  ];
  for (const [source, lang] of readmes) {
    if (!tree.files.has(source)) continue;
    if (pages.some((p) => p.id === "index" && p.lang === lang)) continue;
    pages.push({ source, lang, id: "index" });
  }
  const seen = new Map<string, string>();
  for (const page of pages) {
    const key = `${page.lang}:${page.id}`;
    const other = seen.get(key);
    if (other) {
      throw new ConvertError(
        `${page.source} and ${other} would both be the ${page.lang} page ${page.id}`,
      );
    }
    seen.set(key, page.source);
  }
  return pages;
}

export type Target =
  | { readonly kind: "page"; readonly url: string; readonly lang: Lang; readonly id: string }
  | { readonly kind: "media"; readonly url: string }
  | { readonly kind: "github"; readonly url: string }
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "anchor"; readonly url: string };

export interface LinkContext {
  readonly tree: SourceTree;
  /** The pages by the repository paths that reach them (`docs/x.md`, a folder with a readme). */
  readonly pages: Map<string, { lang: Lang; id: string; url: string }>;
  /** Fills in the media a page links, by portal path. */
  readonly media: Map<string, Uint8Array>;
}

export function linkContext(
  tree: SourceTree,
  pages: readonly SourcePage[],
  media = new Map<string, Uint8Array>(),
): LinkContext {
  const byPath = new Map<string, { lang: Lang; id: string; url: string }>();
  for (const page of pages) {
    const value = { lang: page.lang, id: page.id, url: urlOf(tree.section, page.lang, page.id) };
    byPath.set(page.source, value);
    if (page.source.startsWith("docs/") && /(^|\/)readme\.md$/i.test(page.source)) {
      byPath.set(posix.dirname(page.source), value);
    }
  }
  return { tree, pages: byPath, media };
}

/**
 * Where a link of the page `from` leads in the portal. Pages inside `docs/` become routes (the
 * anchor kept), `docs/media/` files the copied files, any other file GitHub at the source's ref; a
 * page or file inside `docs/` that does not exist fails the build, naming the page and the link.
 */
export function resolveLink(href: string, from: string, ctx: LinkContext): Target {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//"))
    return { kind: "external", url: href };
  if (href.startsWith("#")) return { kind: "anchor", url: href };
  const hashAt = href.indexOf("#");
  const hash = hashAt >= 0 ? href.slice(hashAt) : "";
  let path = (hashAt >= 0 ? href.slice(0, hashAt) : href).replace(/\?.*$/, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep it as written.
  }
  const target = path.startsWith("/")
    ? posix.normalize(path.slice(1))
    : posix.normalize(posix.join(posix.dirname(from), path));
  if (target.startsWith("..")) {
    throw new ConvertError(`${from}: the link ${href} leaves the repository`);
  }
  const { tree } = ctx;
  const trimmed = target.replace(/\/+$/, "") || ".";
  const page = ctx.pages.get(trimmed);
  if (page) return { kind: "page", url: page.url + hash, lang: page.lang, id: page.id };
  const isFolder = (dir: string) => [...tree.files.keys()].some((p) => p.startsWith(`${dir}/`));
  if (trimmed === "docs" || trimmed.startsWith("docs/")) {
    if (tree.files.has(trimmed)) {
      if (trimmed.startsWith("docs/media/")) {
        const portalPath = `${tree.section}/media/${trimmed.slice("docs/media/".length)}`;
        ctx.media.set(portalPath, tree.files.get(trimmed)!);
        return { kind: "media", url: `/${encodePath(portalPath)}` };
      }
      return { kind: "github", url: githubBlob(tree.repo, tree.ref, trimmed) + hash };
    }
    if (trimmed.toLowerCase().endsWith(".md")) {
      // A twin that does not exist reaches the notice page the portal writes in its place.
      const twin = trimmed.startsWith("docs/es/")
        ? `docs/${trimmed.slice(8)}`
        : `docs/es/${trimmed.slice(5)}`;
      const other = ctx.pages.get(twin);
      if (other) {
        const lang: Lang = trimmed.startsWith("docs/es/") ? "es" : "en";
        return {
          kind: "page",
          url: urlOf(tree.section, lang, other.id) + hash,
          lang,
          id: other.id,
        };
      }
    }
    if (isFolder(trimmed)) return { kind: "github", url: githubTree(tree.repo, tree.ref, trimmed) };
    throw new ConvertError(`${from}: the link ${href} leads to no page or file (${trimmed})`);
  }
  if (path.endsWith("/") || isFolder(trimmed))
    return { kind: "github", url: githubTree(tree.repo, tree.ref, trimmed) };
  return { kind: "github", url: githubBlob(tree.repo, tree.ref, trimmed) + hash };
}

const IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const LINK = /(?<!!)\[((?:[^\][]|\[[^\]]*\])*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const DEFINITION = /^( {0,3}\[[^\]]+\]:\s*)<?(\S+?)>?(\s+.*)?$/;
const HTML_LINK = /(<(?:a|img|source|video)\b[^>]*?\s(?:href|src)=")([^"]*)(")/gi;

/** Every link, image, reference and HTML link of a page, outside code, resolved for the portal. */
export function rewriteLinks(body: string, from: string, ctx: LinkContext): string {
  const resolve = (href: string) => resolveLink(href, from, ctx);
  const rewrite = (text: string) =>
    text
      .replace(IMAGE, (_whole, alt: string, href: string) => {
        const target = resolve(href);
        if (target.kind === "external") return alt;
        if (target.kind === "github") return alt ? `[${alt}](${target.url})` : "";
        return `![${alt}](${target.url})`;
      })
      .replace(LINK, (_whole, label: string, href: string) => {
        const url = resolve(href).url;
        // A link whose only words were a picture from another host has nothing left to show.
        return label.trim() === "" ? "" : `[${label}](${url})`;
      })
      .replace(
        HTML_LINK,
        (_whole, start: string, href: string, end: string) => `${start}${resolve(href).url}${end}`,
      );
  return fencedLines(body)
    .map(({ line, code }) => {
      if (code) return line;
      const definition = DEFINITION.exec(line);
      if (definition && !/^\s*\[!/.test(line)) {
        return `${definition[1]}${resolve(definition[2]!).url}${definition[3] ?? ""}`;
      }
      return outsideCodeSpans(line, rewrite);
    })
    .join("\n");
}

// ---------------------------------------------------------------------------------------------
// The sidebar.

interface IndexEntry {
  readonly heading: number;
  readonly id: string;
}

/** The pages an index links, in order, with the `##` heading each sits under (-1 before any). */
export function indexEntries(
  markdown: string,
  from: string,
  ctx: LinkContext,
  byHeading: boolean,
): {
  entries: IndexEntry[];
  headings: string[];
} {
  const entries: IndexEntry[] = [];
  const headings: string[] = [];
  const seen = new Set<string>();
  for (const { line, code } of fencedLines(markdown)) {
    if (code) continue;
    const heading = /^##\s+(.+?)\s*#*$/.exec(line);
    if (heading && byHeading) {
      headings.push(plain(heading[1]!));
      continue;
    }
    outsideCodeSpans(line, (text) => {
      for (const match of text.matchAll(LINK)) {
        const target = resolveLink(match[2]!, from, ctx);
        if (target.kind !== "page" || target.id === "index" || seen.has(target.id)) continue;
        seen.add(target.id);
        entries.push({ heading: headings.length - 1, id: target.id });
      }
      return text;
    });
  }
  return { entries, headings };
}

const humanise = (dir: string) =>
  dir.length <= 3
    ? dir.toUpperCase()
    : dir.charAt(0).toUpperCase() + dir.slice(1).replace(/[-_]/g, " ");

/**
 * The section's sidebar: its index first, then the pages the index links in its order (under
 * the index's `##` headings when the index is `docs/README.md`), then the pages it does not link,
 * in path order: those at the top in "Other pages", those in a folder in a folded group per folder.
 */
export function sidebarOf(
  section: Section,
  ids: readonly string[],
  indexes: Partial<Record<Lang, { entries: IndexEntry[]; headings: string[] }>>,
): SidebarNode[] {
  const primaryLang: Lang = indexes.en ? "en" : "es";
  const primary = indexes[primaryLang] ?? { entries: [], headings: [] };
  const secondary = indexes[primaryLang === "en" ? "es" : "en"];
  const slug = (id: string) => slugOf(section, "en", id);
  const nodes: SidebarNode[] = [];
  if (ids.includes("index")) {
    nodes.push({
      slug: slug("index"),
      label: messages.en.sidebar.overview,
      translations: { es: messages.es.sidebar.overview },
    });
  }
  const linked = new Set<string>();
  const present = new Set(ids);
  const top = primary.entries.filter((e) => e.heading < 0 && present.has(e.id));
  for (const entry of top) {
    nodes.push({ slug: slug(entry.id) });
    linked.add(entry.id);
  }
  primary.headings.forEach((label, h) => {
    const items = primary.entries.filter(
      (e) => e.heading === h && present.has(e.id) && !linked.has(e.id),
    );
    if (!items.length) return;
    const translation =
      secondary && secondary.headings.length === primary.headings.length
        ? secondary.headings[h]
        : undefined;
    const other = primaryLang === "en" ? "es" : "en";
    nodes.push({
      label,
      ...(translation ? { translations: { [other]: translation } } : {}),
      items: items.map((e) => {
        linked.add(e.id);
        return { slug: slug(e.id) };
      }),
    });
  });
  const rest = ids
    .filter((id) => id !== "index" && !linked.has(id))
    .sort((a, b) => a.localeCompare(b, "en"));
  const loose = rest.filter((id) => !id.includes("/"));
  if (loose.length) {
    nodes.push({
      label: messages.en.sidebar.other,
      translations: { es: messages.es.sidebar.other },
      items: loose.map((id) => ({ slug: slug(id) })),
    });
  }
  const folders = [
    ...new Set(rest.filter((id) => id.includes("/")).map((id) => id.split("/")[0]!)),
  ];
  for (const folder of folders) {
    nodes.push({
      label: humanise(folder),
      collapsed: true,
      items: rest.filter((id) => id.startsWith(`${folder}/`)).map((id) => ({ slug: slug(id) })),
    });
  }
  return nodes;
}

/** The slugs of a sidebar, in reading order. */
export function sidebarOrder(nodes: readonly SidebarNode[]): string[] {
  return nodes.flatMap((node) => ("slug" in node ? [node.slug] : sidebarOrder(node.items)));
}

// ---------------------------------------------------------------------------------------------
// The notice page.

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** The other language's page of a one-language guide: its title, one sentence and a link to it. */
export function noticePage(page: PortalPage): PortalPage {
  const lang: Lang = page.lang === "en" ? "es" : "en";
  const words = messages[lang].notice;
  return {
    ...page,
    lang,
    slug: slugOf(page.section, lang, page.id),
    url: urlOf(page.section, lang, page.id),
    file: fileOf(page.section, lang, page.id),
    description: words.only,
    notice: true,
    body: `<p class="portal-notice">${escapeHtml(words.only)} <a href="${page.url}" hreflang="${page.lang}">${escapeHtml(words.read)}</a></p>\n`,
  };
}

// ---------------------------------------------------------------------------------------------
// A whole section.

/** Converts a tree into the section's pages in both languages, its media and its sidebar. */
export function convertSection(tree: SourceTree): ConvertedSection {
  const sources = sourcePages(tree);
  const ctx = linkContext(tree, sources);
  const pages: PortalPage[] = [];
  for (const source of sources) {
    const text = textOf(tree.files.get(source.source)!);
    const { title, body: afterTitle } = readTitle(text, source.source);
    const cleaned = dropTwinLink(afterTitle);
    const body = rewriteLinks(cleaned, source.source, ctx);
    pages.push({
      section: tree.section,
      lang: source.lang,
      id: source.id,
      slug: slugOf(tree.section, source.lang, source.id),
      url: urlOf(tree.section, source.lang, source.id),
      file: fileOf(tree.section, source.lang, source.id),
      source: source.source,
      title,
      description: readDescription(cleaned),
      editUrl: githubBlob(tree.repo, tree.ref, source.source),
      body,
      notice: false,
      order: 0,
    });
  }
  const has = (lang: Lang, id: string) => pages.some((p) => p.lang === lang && p.id === id);
  for (const page of [...pages]) {
    const other: Lang = page.lang === "en" ? "es" : "en";
    if (!has(other, page.id)) pages.push(noticePage(page));
  }
  const indexes: Partial<Record<Lang, { entries: IndexEntry[]; headings: string[] }>> = {};
  for (const lang of ["en", "es"] as const) {
    const index = sources.find((s) => s.lang === lang && s.id === "index");
    if (!index) continue;
    const { body } = readTitle(textOf(tree.files.get(index.source)!), index.source);
    indexes[lang] = indexEntries(body, index.source, ctx, index.source.startsWith("docs/"));
  }
  const ids = [...new Set(pages.map((p) => p.id))];
  const sidebar = sidebarOf(tree.section, ids, indexes);
  const order = sidebarOrder(sidebar);
  for (const page of pages) page.order = order.indexOf(slugOf(page.section, "en", page.id));
  return { section: tree.section, pages, media: ctx.media, sidebar };
}

/** A page's file: Starlight's frontmatter, then the body. */
export function renderPage(page: PortalPage): string {
  const lines = [
    "---",
    `title: ${JSON.stringify(page.title)}`,
    ...(page.description ? [`description: ${JSON.stringify(page.description)}`] : []),
    `slug: ${JSON.stringify(page.slug)}`,
    `editUrl: ${JSON.stringify(page.editUrl)}`,
    `sidebar:`,
    `  order: ${page.order}`,
    ...(page.notice ? ["pagefind: false", "tableOfContents: false"] : []),
    "---",
    "",
  ];
  return `${lines.join("\n")}${page.body.replace(/\s+$/, "")}\n`;
}
