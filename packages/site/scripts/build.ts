// Builds what the site serves beside its hand-written pages (decision 0006): the module scripts
// bundled from `src/`, written to `public/assets/`, which Git ignores. The entry keeps a stable
// name the pages link (`/assets/site.js`); the chunks it imports carry their content's hash.
//
//   tsx scripts/build.ts            (from packages/site; `pnpm build` runs it)
//
// The checks call `buildSite` into a temporary folder, so `pnpm test` measures what would be
// served without a build having run first.

import { build, type Metafile } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The site package's own folder. */
export const SITE = fileURLToPath(new URL("..", import.meta.url));

/** Where the build writes, relative to `public/`. */
export const ASSETS = "assets";

/** The entry every animated page links, relative to `public/`. */
export const ENTRY = `${ASSETS}/site.js`;

export interface BuildResult {
  /** esbuild's account of what went into each output. */
  readonly metafile: Metafile;
}

/**
 * Bundles `src/site.ts` and what it imports into `<publicDir>/assets/`, replacing what was
 * there: minified ES2022 modules split at dynamic imports, with no source map.
 */
export async function buildSite(publicDir: string): Promise<BuildResult> {
  const outdir = join(publicDir, ASSETS);
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });
  const result = await build({
    absWorkingDir: SITE,
    entryPoints: { site: "src/site.ts" },
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
  return { metafile: result.metafile };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const publicDir = join(SITE, "public");
  const { metafile } = await buildSite(publicDir);
  const outputs = Object.keys(metafile.outputs).length;
  console.log(`Built ${outputs} file(s) into public/${ASSETS}/`);
}
