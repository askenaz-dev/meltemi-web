// The specification `ocean-package`, "A package that only draws": the package's manifest, and a
// scan of its sources for anything that reaches beyond the canvas it draws on.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<
  string,
  unknown
>;

/** The calls a drawing has no business making: requests, storage, cookies and beacons. */
const REACHING = [
  { name: "fetch", pattern: /\bfetch\s*\(/ },
  { name: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/ },
  { name: "WebSocket", pattern: /\bWebSocket\b/ },
  { name: "sendBeacon", pattern: /\bsendBeacon\b/ },
  { name: "document.cookie", pattern: /\bdocument\s*\.\s*cookie\b/ },
  { name: "localStorage", pattern: /\blocalStorage\b/ },
  { name: "sessionStorage", pattern: /\bsessionStorage\b/ },
  { name: "indexedDB", pattern: /\bindexedDB\b/ },
];

/** The reaching calls of a source file, comments removed first, each naming the file. */
export function reachingCalls(source: string, file: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  return REACHING.filter(({ pattern }) => pattern.test(code)).map(({ name }) => `${file}: ${name}`);
}

describe("a package that only draws", () => {
  it("is an Apache-2.0 ES module with types and no runtime dependency", () => {
    expect(manifest["name"]).toBe("@meltemi/ocean");
    expect(manifest["license"]).toBe("Apache-2.0");
    expect(manifest["type"]).toBe("module");
    expect(manifest["dependencies"] ?? {}).toEqual({});
    expect(manifest["exports"]).toEqual({
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
    });
    expect(manifest["publishConfig"]).toEqual({ access: "public", provenance: true });
    expect(readFileSync(join(ROOT, "LICENSE"), "utf8")).toMatch(/Apache License\s+Version 2\.0/);
  });

  it("makes no request and keeps nothing", () => {
    const src = join(ROOT, "src");
    const offenders = readdirSync(src)
      .filter((name) => name.endsWith(".ts"))
      .flatMap((name) => reachingCalls(readFileSync(join(src, name), "utf8"), `src/${name}`));
    expect(offenders).toEqual([]);
  });

  it("names the file of a call that reaches out", () => {
    expect(reachingCalls("const r = await fetch(url);", "src/planted.ts")).toEqual([
      "src/planted.ts: fetch",
    ]);
    expect(reachingCalls("localStorage.setItem('k', 'v')", "src/planted.ts")).toEqual([
      "src/planted.ts: localStorage",
    ]);
  });

  it("does not count a call named in a comment", () => {
    expect(reachingCalls("// it never calls fetch( or localStorage\nconst a = 1;", "x")).toEqual(
      [],
    );
  });
});
