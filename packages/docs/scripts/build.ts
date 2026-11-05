// The portal's build (design decisions 1 to 6, 9): sources, conversion, pictures, the index of
// passages, the pages written for Starlight, `astro build`, and the policy's hashes.
//
//   pnpm --filter @meltemi/docs build                        local where the siblings exist, else fixture
//   pnpm --filter @meltemi/docs build --from release         GitHub's latest releases (the deploy)
//   pnpm --filter @meltemi/docs build --from fixture --embedder fake
//
// Everything is read and converted before anything is written: a product whose documentation
// cannot be read, or a page that cannot be converted, fails the build with the portal's files as
// they were. The embeddings use Workers AI with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from
// the environment. Disabled/unavailable AI leaves reusable cached vectors in the index and omits
// uncached passages, while static guides and search still build.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { stillPicture } from "../../ocean/src/index.js";
import { stillColours } from "../../site/scripts/build.js";
import { messages } from "../src/messages/index.js";
import { convertSection, renderPage, type ConvertedSection, type PortalPage } from "./convert.js";
import { homePage } from "./home.js";
import { buildIndex, cachedEmbedder, embedderFor, type IndexReport } from "./index.js";
import { addPictures, cliExporter, type Exporter, type PicturesReport } from "./pictures.js";
import {
  chooseMode,
  PACKAGE,
  REPOSITORY_ROOT,
  siblingsExist,
  SourceError,
  sourcesFor,
  sourcesJson,
  type GitHubDeps,
  type Mode,
  type SourceTree,
} from "./sources.js";

export interface Dirs {
  /** Starlight's pages. */
  readonly content: string;
  /** What the components read: sources.json, sidebar.json, ask.json. */
  readonly generated: string;
  /** Copied into the site as is: the brand, the sea, the media, the index. */
  readonly public: string;
  readonly cache: string;
}

export const DIRS: Dirs = {
  content: join(PACKAGE, "src", "content", "docs"),
  generated: join(PACKAGE, "src", "generated"),
  public: join(PACKAGE, "public"),
  cache: join(PACKAGE, ".cache"),
};
export const DIST = join(PACKAGE, "dist");
const SITE_PUBLIC = join(REPOSITORY_ROOT, "packages", "site", "public");
const BRAND = ["meltemi-mark-gradient.svg", "meltemi-lockup-light.svg", "meltemi-lockup-dark.svg"];

export type EmbedderChoice = "fake" | "cloudflare" | "none";

export interface PrepareOptions {
  readonly mode: Mode;
  readonly embedder?: EmbedderChoice | undefined;
  readonly deps?: GitHubDeps;
  readonly siblings?: string;
  readonly root?: string;
  readonly fixtures?: string;
  readonly dirs?: Partial<Dirs>;
  readonly exporter?: Exporter;
  readonly env?: NodeJS.ProcessEnv;
  /** The control read and embeddings API transport; production uses the native fetch. */
  readonly fetch?: typeof fetch;
  readonly log?: (line: string) => void;
}

export interface Prepared {
  readonly trees: readonly SourceTree[];
  readonly sections: readonly ConvertedSection[];
  readonly pages: readonly PortalPage[];
  readonly pictures: PicturesReport;
  readonly index: IndexReport;
  readonly askEnabled: boolean;
}

/** The three sections as Starlight's sidebar: one group each, which the route keeps its own of. */
export function sidebarConfig(sections: readonly ConvertedSection[]) {
  return sections.map((section) => ({
    label: messages.en.sections[section.section].name,
    translations: { es: messages.es.sections[section.section].name },
    items: section.sidebar,
  }));
}

/** Removes a folder's contents but the files named. */
function empty(dir: string, keep: readonly string[] = []): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir))
    if (!keep.includes(name)) rmSync(join(dir, name), { recursive: true, force: true });
}

function write(file: string, data: string | Uint8Array): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
}

/** Reads, converts, draws and indexes everything; then writes what Astro builds from. */
export async function prepare(options: PrepareOptions): Promise<Prepared> {
  const log = options.log ?? (() => {});
  const env = options.env ?? process.env;
  const dirs: Dirs = { ...DIRS, ...options.dirs };

  const trees = await sourcesFor(options.mode, {
    ...(options.deps ? { deps: options.deps } : {}),
    ...(options.siblings ? { siblings: options.siblings } : {}),
    ...(options.root ? { root: options.root } : {}),
    ...(options.fixtures ? { fixtures: options.fixtures } : {}),
  });
  for (const tree of trees)
    log(
      `  ${tree.section}: ${tree.repo} at ${tree.version} (${tree.date}), ${tree.files.size} files`,
    );
  const sections = trees.map(convertSection);
  const pages = sections.flatMap((section) => section.pages);

  const pictures = await addPictures(pages, {
    exporter: options.exporter ?? cliExporter(),
    cache: join(dirs.cache, "pictures"),
  });
  log(`  pictures: ${pictures.drawn} drawn from ${pictures.fences} text fences`);

  const embedder = embedderFor(options.embedder, options.mode, env, options.fetch);
  const index: IndexReport = await buildIndex(
    pages,
    embedder
      ? cachedEmbedder(embedder, join(dirs.cache, "embeddings"), (error) =>
          log(
            `::warning::New embeddings stopped (${error.message}); retaining available cached passages`,
          ),
        )
      : undefined,
  );
  const askEnabled = index.passages > 0;
  log(
    askEnabled
      ? `  index: ${index.passages} passages of ${index.pages} pages, embedded with ${index.model}`
      : "  index: no embedded passage available: Ask the docs is left out",
  );

  // Only caches were written above: from here the portal's sources are replaced.
  empty(dirs.content);
  for (const page of pages) write(join(dirs.content, page.file), renderPage(page));
  const releases = sourcesJson(trees);
  for (const lang of ["en", "es"] as const) {
    const home = homePage(lang, releases, askEnabled);
    write(join(dirs.content, home.file), home.text);
  }

  empty(dirs.generated);
  write(join(dirs.generated, "sources.json"), `${JSON.stringify(releases, null, 2)}\n`);
  write(
    join(dirs.generated, "sidebar.json"),
    `${JSON.stringify(sidebarConfig(sections), null, 2)}\n`,
  );
  write(
    join(dirs.generated, "ask.json"),
    `${JSON.stringify({ enabled: askEnabled, model: index.model, passages: index.passages })}\n`,
  );

  empty(dirs.public, ["_headers"]);
  for (const name of BRAND)
    write(join(dirs.public, "media", name), readFileSync(join(SITE_PUBLIC, "media", name)));
  for (const scheme of ["light", "dark"] as const) {
    write(
      join(dirs.public, "media", `sea-home-${scheme}.svg`),
      stillPicture("home", { scheme, colours: stillColours(SITE_PUBLIC, scheme) }),
    );
  }
  for (const section of sections) {
    for (const [path, bytes] of section.media) write(join(dirs.public, ...path.split("/")), bytes);
  }
  write(join(dirs.public, "ask", "index.bin"), index.bytes);

  return { trees, sections, pages, pictures, index, askEnabled };
}

// ---------------------------------------------------------------------------------------------
// The policy.

/** Every HTML file under a folder. */
function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return htmlFiles(full);
    return name.endsWith(".html") ? [full] : [];
  });
}

/** The CSP sources of every inline script of the built pages: `'sha256-…'`, sorted, each once. */
export function inlineScriptHashes(dist: string): string[] {
  const hashes = new Set<string>();
  for (const file of htmlFiles(dist)) {
    const html = readFileSync(file, "utf8");
    for (const match of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const type = /\btype="([^"]*)"/i.exec(match[1] ?? "")?.[1];
      if (type && type !== "module" && !/javascript/i.test(type)) continue;
      hashes.add(`'sha256-${createHash("sha256").update(match[2]!, "utf8").digest("base64")}'`);
    }
  }
  return [...hashes].sort();
}

const SCRIPT_SRC = "script-src 'self' 'wasm-unsafe-eval'";

/**
 * `dist/_headers` with the hashes of Starlight's inline scripts (its theme, before the first
 * paint) added to `script-src`: the policy stays `'self'` for every file, and admits those exact
 * scripts and no other.
 */
export function writeHeaders(dist: string): string[] {
  const file = join(dist, "_headers");
  const text = readFileSync(file, "utf8");
  if (!text.includes(SCRIPT_SRC))
    throw new Error(`_headers has no "${SCRIPT_SRC}" to add the inline scripts' hashes to`);
  const hashes = inlineScriptHashes(dist);
  if (hashes.length > 24)
    throw new Error(
      `${hashes.length} distinct inline scripts: a page writes one per page, which the policy cannot list`,
    );
  writeFileSync(file, text.replace(SCRIPT_SRC, [SCRIPT_SRC, ...hashes].join(" ")));
  return hashes;
}

// ---------------------------------------------------------------------------------------------
// The whole build.

export interface BuildOptions extends PrepareOptions {
  /** Where Astro writes the site; `dist/` by default. */
  readonly outDir?: string;
}

export async function buildPortal(
  options: BuildOptions,
): Promise<Prepared & { readonly dist: string; readonly hashes: string[] }> {
  const prepared = await prepare(options);
  const dist = options.outDir ?? DIST;
  // Astro asks before it reports anything; this build reports nothing to anyone.
  process.env["ASTRO_TELEMETRY_DISABLED"] = "1";
  const { build } = await import("astro");
  await build({ root: PACKAGE, outDir: dist, logLevel: "warn", mode: "production" });
  const hashes = writeHeaders(dist);
  return { ...prepared, dist, hashes };
}

function optionOf(argv: readonly string[], name: string): string | undefined {
  const at = argv.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
  if (at < 0) return undefined;
  const arg = argv[at]!;
  return arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[at + 1];
}

async function main(argv: readonly string[]): Promise<number> {
  let mode: Mode;
  let given: boolean;
  try {
    const siblingsAt = optionOf(argv, "--siblings");
    ({ mode, given } = chooseMode(argv, siblingsAt ? siblingsExist(siblingsAt) : siblingsExist()));
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }
  const embedder = optionOf(argv, "--embedder");
  if (embedder !== undefined && !["fake", "cloudflare", "none"].includes(embedder)) {
    console.error(`--embedder ${embedder} is not one: use fake, cloudflare or none`);
    return 2;
  }
  const out = optionOf(argv, "--out");
  // Where the sibling checkouts are, for a worktree that does not sit beside them.
  const siblings = optionOf(argv, "--siblings");
  const why = given
    ? "as asked"
    : mode === "local"
      ? "the sibling checkouts exist"
      : "no sibling checkout beside this repository";
  console.log(`Building the portal from ${mode} (${why})`);
  const started = Date.now();
  try {
    const result = await buildPortal({
      mode,
      embedder: embedder as EmbedderChoice | undefined,
      ...(out ? { outDir: out } : {}),
      ...(siblings ? { siblings } : {}),
      log: (line) => console.log(line),
    });
    const sections = result.sections
      .map((s) => `${s.section} ${s.pages.filter((p) => !p.notice).length}`)
      .join(", ");
    console.log(
      `Built ${result.pages.length} pages (${sections} guides, the rest notices) into ${result.dist} in ${Math.round((Date.now() - started) / 1000)} s; ${result.hashes.length} inline script hashes in _headers`,
    );
    return 0;
  } catch (error) {
    if (error instanceof SourceError || (error as Error).name === "ConvertError") {
      console.error(`The portal was not built: ${(error as Error).message}`);
      return 1;
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
