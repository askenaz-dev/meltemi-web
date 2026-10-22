// What may depend on what (`identity-session`: "Test support for products" and "A reference
// verifier for products"): the test support is not in the Worker, and the verifier has no
// Cloudflare dependency. The import graph is walked with the TypeScript compiler's own scanner, and
// the Worker is bundled for real to see what ends up in it.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { readJsonc } from "./support/jsonc.js";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(PACKAGE, "src");

// ---------------------------------------------------------------------------------------------
// The walker: the modules a file reaches through its imports, and what it imports from outside.

interface Graph {
  /** Every module reached, the entry included, as paths relative to `src/` with forward slashes. */
  readonly modules: ReadonlySet<string>;
  /** Specifiers that are not relative: packages, `node:` and `cloudflare:` modules. */
  readonly external: ReadonlySet<string>;
  /** Relative imports that name no file. */
  readonly unresolved: readonly string[];
}

type Reader = (path: string) => string | undefined;

/** `./x.js` names `./x.ts`; a specifier without an extension names `./x.ts` or `./x/index.ts`. */
function candidates(from: string, specifier: string): string[] {
  const base = resolve(dirname(from), specifier);
  if (/\.[cm]?js$/.test(base)) return [base.replace(/\.([cm]?)js$/, ".$1ts")];
  if (/\.[cm]?ts$/.test(base)) return [base];
  return [`${base}.ts`, join(base, "index.ts")];
}

function walk(entry: string, root: string, read: Reader): Graph {
  const modules = new Set<string>();
  const external = new Set<string>();
  const unresolved: string[] = [];
  const queue = [resolve(entry)];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = read(file);
    if (text === undefined) continue;
    modules.add(relative(root, file).replaceAll("\\", "/"));
    // `preProcessFile` finds `import`, `export … from`, `import type`, `import()` and `require()`.
    for (const { fileName } of ts.preProcessFile(text, true, true).importedFiles) {
      if (!fileName.startsWith(".")) {
        external.add(fileName);
        continue;
      }
      const found = candidates(file, fileName).find((path) => read(path) !== undefined);
      if (found) queue.push(found);
      else unresolved.push(`${relative(root, file).replaceAll("\\", "/")} -> ${fileName}`);
    }
  }
  return { modules, external, unresolved };
}

const readFromDisk: Reader = (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined);
const graphOf = (file: string) => walk(join(SRC, file), SRC, readFromDisk);

// ---------------------------------------------------------------------------------------------

describe("the import walker", () => {
  const virtual = (name: string) => resolve("/virtual", name);
  const files = new Map<string, string>([
    [virtual("entry.ts"), 'import { a } from "./a.js";\nexport * from "./sub/b.js";\n'],
    [
      virtual("a.ts"),
      'import type { T } from "./c.js";\nimport fs from "node:fs";\nexport const a = 1;\n',
    ],
    [
      virtual("sub/b.ts"),
      'export { z } from "../d.js";\nconst lazy = () => import("./lazy.js");\n',
    ],
    [virtual("sub/lazy.ts"), 'import "cloudflare:workers";\n'],
    [virtual("c.ts"), 'import { a } from "./a.js";\nexport type T = number;\n'],
    [virtual("d.ts"), 'import "some-package";\nimport "./missing.js";\nexport const z = 1;\n'],
    [virtual("never.ts"), "export const never = 1;\n"],
  ]);
  const graph = walk(virtual("entry.ts"), resolve("/virtual"), (path) => files.get(path));

  it("follows imports, re-exports, type imports and dynamic imports, through cycles", () => {
    expect([...graph.modules].sort()).toEqual([
      "a.ts",
      "c.ts",
      "d.ts",
      "entry.ts",
      "sub/b.ts",
      "sub/lazy.ts",
    ]);
  });

  it("does not reach a module nobody imports", () => {
    expect(graph.modules.has("never.ts")).toBe(false);
  });

  it("reports what is imported from outside, and what cannot be found", () => {
    expect([...graph.external].sort()).toEqual(["cloudflare:workers", "node:fs", "some-package"]);
    expect(graph.unresolved).toEqual(["d.ts -> ./missing.js"]);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the Worker entry", () => {
  const worker = graphOf("worker.ts");

  it("reaches the service (the walk is not empty)", () => {
    for (const module of [
      "worker.ts",
      "handler.ts",
      "jwt.ts",
      "session.ts",
      "verify.ts",
      "store/d1.ts",
    ]) {
      expect(worker.modules.has(module), module).toBe(true);
    }
    expect(worker.unresolved).toEqual([]);
  });

  it("does not reach the test support: src/testing.ts is not in its import graph", () => {
    expect(worker.modules.has("testing.ts")).toBe(false);
    expect([...worker.modules].filter((m) => /testing/.test(m))).toEqual([]);
  });

  it("does not import the test support by name from any module of the service", () => {
    for (const module of worker.modules) {
      const text = readFileSync(join(SRC, module), "utf8");
      expect(text, module).not.toMatch(
        /from\s+["'][^"']*testing(\.js)?["']|["']@meltemi\/identity\/testing["']/,
      );
    }
  });

  it("imports no module of the test folder", () => {
    for (const module of worker.modules) {
      const text = readFileSync(join(SRC, module), "utf8");
      expect(text, module).not.toMatch(/from\s+["'](\.\.\/)+test\//);
    }
  });
});

describe("the Worker bundle", () => {
  it("contains no reference to the testing module", async () => {
    // Wrangler's own bundler, as it bundles the Worker for a deployment.
    const wrangler = createRequire(import.meta.url).resolve("wrangler/package.json");
    const esbuild = createRequire(wrangler)("esbuild") as {
      build(options: Record<string, unknown>): Promise<{
        metafile: { inputs: Record<string, unknown> };
        outputFiles: { text: string }[];
      }>;
    };
    const result = await esbuild.build({
      entryPoints: [join(SRC, "worker.ts")],
      bundle: true,
      write: false,
      metafile: true,
      outdir: join(PACKAGE, "dist-test-bundle"),
      format: "esm",
      platform: "neutral",
      target: "es2022",
      external: ["cloudflare:*", "node:*"],
      logLevel: "silent",
    });

    const inputs = Object.keys(result.metafile.inputs).map((path) => path.replaceAll("\\", "/"));
    expect(inputs.some((path) => path.endsWith("src/handler.ts"))).toBe(true);
    expect(inputs.filter((path) => /\/testing\.ts$/.test(path))).toEqual([]);

    const code = result.outputFiles.map((file) => file.text).join("\n");
    expect(code).toContain("identity: unexpected error:"); // the bundle is the service
    for (const name of ["signSessionToken", "testKeys", "testJwks", "@meltemi/identity/testing"]) {
      expect(code, name).not.toContain(name);
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe("the verifier", () => {
  const verifier = graphOf("verify.ts");
  /** The shared primitives, and nothing else: no store, no handler, no Cloudflare. */
  const PRIMITIVES = [
    "account-view.ts",
    "claims.ts",
    "crypto.ts",
    "http.ts",
    "jwt.ts",
    "product-call.ts",
    "verify.ts",
  ];

  it("is an entry that reaches the primitives (the walk is not empty)", () => {
    expect(verifier.modules.has("verify.ts")).toBe(true);
    expect(verifier.modules.has("jwt.ts")).toBe(true);
    expect(verifier.modules.has("crypto.ts")).toBe(true);
    expect(verifier.unresolved).toEqual([]);
  });

  it("imports no node: or cloudflare: module, and no package at all", () => {
    expect([...verifier.external].filter((name) => /^(node|cloudflare):/.test(name))).toEqual([]);
    expect([...verifier.external]).toEqual([]);
  });

  it("does not reach env.ts, the stores, the handler or the Worker entry", () => {
    const reached = [...verifier.modules];
    expect(reached.filter((m) => m === "env.ts")).toEqual([]);
    expect(reached.filter((m) => m.startsWith("store/"))).toEqual([]);
    expect(reached.filter((m) => m === "handler.ts")).toEqual([]);
    expect(reached.filter((m) => m === "worker.ts")).toEqual([]);
  });

  it("reaches only the shared primitives", () => {
    expect([...verifier.modules].sort()).toEqual(PRIMITIVES);
  });

  it("has no use of Node or Cloudflare globals in what it reaches", () => {
    const nodeOrCloudflare =
      /\b(Buffer|__dirname|__filename)\b|\bprocess\.|\brequire\(|\benv\.|D1Database|KVNamespace|ExecutionContext|ScheduledController/;
    for (const module of verifier.modules) {
      expect(readFileSync(join(SRC, module), "utf8"), module).not.toMatch(nodeOrCloudflare);
    }
  });
});

describe("the testing module", () => {
  const testing = graphOf("testing.ts");

  it("reaches only the shared primitives, so a product's tests need nothing of the Worker", () => {
    expect([...testing.modules].sort()).toEqual([
      "claims.ts",
      "crypto.ts",
      "jwt.ts",
      "product-call.ts",
      "testing.ts",
    ]);
    expect([...testing.external]).toEqual([]);
    expect(testing.unresolved).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the package's surface", () => {
  const pkg = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as {
    exports: unknown;
    scripts: Record<string, string>;
  };

  it("exports the verifier as the main entry and the test support as ./testing, from dist", () => {
    expect(pkg.exports).toEqual({
      ".": { types: "./dist/verify.d.ts", default: "./dist/verify.js" },
      "./testing": { types: "./dist/testing.d.ts", default: "./dist/testing.js" },
    });
  });

  it("builds only those two entries (and what they import) into dist", () => {
    const build = readJsonc(readFileSync(join(PACKAGE, "tsconfig.build.json"), "utf8")).value as {
      files: string[];
      compilerOptions: { outDir: string; rootDir: string };
    };
    expect(build.files).toEqual(["src/verify.ts", "src/testing.ts"]);
    expect(build.compilerOptions).toMatchObject({ outDir: "dist", rootDir: "src" });
    // dist/ is emptied first, so a file of an earlier build never reaches the tarball.
    expect(pkg.scripts["build"]).toMatch(/rmSync\('dist'.*&& tsc -p tsconfig\.build\.json$/);
  });
});
