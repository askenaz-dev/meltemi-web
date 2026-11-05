// The Worker's configuration for `wrangler dev` (`pnpm --filter @meltemi/docs dev` and the browser
// check): `wrangler.jsonc` without the Workers AI binding, which `wrangler dev` can only reach in
// the cloud, and with `ASK_STUB = "fixture"`, so the route answers with the offline embedder and the
// stub model on an index the build made with the same embedder. Nothing here is deployed.
//
//   tsx scripts/dev-config.ts        (writes wrangler.dev.json, which Git ignores)

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PACKAGE } from "./sources.js";

export const DEV_CONFIG = join(PACKAGE, "wrangler.dev.json");

/** `wrangler.jsonc` as an object: its comments and trailing commas removed. */
export function parseJsonc(text: string): Record<string, unknown> {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")) as Record<string, unknown>;
}

export function devConfig(jsonc: string, port?: number): Record<string, unknown> {
  const config = parseJsonc(jsonc);
  delete config["ai"];
  delete config["$schema"];
  // Fixture mode never calls the production identity Worker, including status checks.
  delete config["services"];
  return {
    ...config,
    vars: { ASK_STUB: "fixture" },
    ...(port ? { dev: { port } } : {}),
  };
}

export function writeDevConfig(port?: number): string {
  const config = devConfig(readFileSync(join(PACKAGE, "wrangler.jsonc"), "utf8"), port);
  writeFileSync(DEV_CONFIG, `${JSON.stringify(config, null, 2)}\n`);
  return DEV_CONFIG;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Wrote ${writeDevConfig()}`);
}
