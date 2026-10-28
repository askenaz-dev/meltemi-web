// Builds what the site serves beside its hand-written pages (decision 0006), into
// `public/assets/`, which Git ignores:
//   - the module scripts bundled from `src/`: the entry keeps a stable name the pages link
//     (`/assets/site.js`), and the chunks it imports carry their content's hash;
//   - the still pictures of every sea state, one per scheme, in the colours `site.css` gives the
//     sea from the tokens (`sea-<state>-light.svg`, `sea-<state>-dark.svg`).
//
//   tsx scripts/build.ts            (from packages/site; `pnpm build` runs it)
//
// The checks call `buildSite` into a temporary folder, so `pnpm test` measures what would be
// served without a build having run first.

import { build, type Metafile } from "esbuild";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { STATES, stillPicture, type Scheme, type StillColours } from "../../ocean/src/index.js";

/** The site package's own folder. */
export const SITE = fileURLToPath(new URL("..", import.meta.url));

/** Where the build writes, relative to `public/`. */
export const ASSETS = "assets";

/** The entry every animated page links, relative to `public/`. */
export const ENTRY = `${ASSETS}/site.js`;

export const SCHEMES: readonly Scheme[] = ["light", "dark"];

/** The still picture of a state in a scheme, relative to `public/`. */
export const still = (state: string, scheme: Scheme) => `${ASSETS}/sea-${state}-${scheme}.svg`;

/** The files of `public/` the build writes, which the checks of the pages may link. */
export const BUILT: readonly string[] = [
  ENTRY,
  ...STATES.flatMap((state) => SCHEMES.map((scheme) => still(state, scheme))),
];

/** The sea is bundled from its sources, so a build needs no build of the package first. */
const OCEAN = join(SITE, "..", "ocean", "src", "index.ts");

/** The custom properties a block of CSS declares, as `name -> value`. */
function declarations(block: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) found.set(m[1]!, m[2]!.trim());
  return found;
}

/** A stylesheet's `:root` declarations, in the light scheme and in the dark one. */
function schemes(css: string): Record<Scheme, Map<string, string>> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const dark = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(text);
  const light = new Map<string, string>();
  for (const m of text.matchAll(/(?:^|\})\s*:root\s*\{([^}]*)\}/g)) {
    for (const [k, v] of declarations(m[1]!)) light.set(k, v);
  }
  return { light, dark: declarations(dark?.[1] ?? "") };
}

/**
 * The still pictures' colours for a scheme: `site.css` maps `--sea-*` to tokens, and `tokens.css`
 * gives the tokens their values, the dark scheme falling back to the light one where it says
 * nothing.
 */
export function stillColours(publicDir: string, scheme: Scheme): StillColours {
  const site = schemes(readFileSync(join(publicDir, "site.css"), "utf8"));
  const tokens = schemes(readFileSync(join(publicDir, "tokens.css"), "utf8"));
  const lookup = (map: Record<Scheme, Map<string, string>>, name: string) =>
    (scheme === "dark" ? map.dark.get(name) : undefined) ?? map.light.get(name);
  const resolve = (name: string): string => {
    const value = lookup(site, name);
    const token = value && /^var\((--[\w-]+)\)$/.exec(value)?.[1];
    const resolved = token ? lookup(tokens, token) : undefined;
    if (!resolved)
      throw new Error(`site.css gives ${name} no token value for the ${scheme} scheme`);
    return resolved;
  };
  return {
    point: resolve("--sea-point"),
    crest: resolve("--sea-crest"),
    wind: resolve("--sea-wind"),
  };
}

export interface BuildResult {
  /** esbuild's account of what went into each output. */
  readonly metafile: Metafile;
}

/**
 * Writes `<publicDir>/assets/`, replacing what was there: the scripts, as minified ES2022
 * modules split at dynamic imports with no source map, and the still pictures.
 */
export async function buildSite(publicDir: string, outRoot = publicDir): Promise<BuildResult> {
  const outdir = join(outRoot, ASSETS);
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });
  const result = await build({
    absWorkingDir: SITE,
    entryPoints: { site: "src/site.ts" },
    alias: { "@meltemi/ocean": OCEAN },
    outdir,
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    sourcemap: false,
    entryNames: "[name]",
    chunkNames: "chunk-[hash]",
    legalComments: "eof",
    metafile: true,
    logLevel: "warning",
  });
  for (const scheme of SCHEMES) {
    const colours = stillColours(publicDir, scheme);
    for (const state of STATES) {
      writeFileSync(join(outRoot, still(state, scheme)), stillPicture(state, { scheme, colours }));
    }
  }
  return { metafile: result.metafile };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const publicDir = join(SITE, "public");
  const { metafile } = await buildSite(publicDir);
  const scripts = Object.keys(metafile.outputs).length;
  console.log(
    `Built ${scripts} script(s) and ${BUILT.length - 1} still picture(s) into public/${ASSETS}/`,
  );
}
