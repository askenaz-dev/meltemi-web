// What the public repository holds: the licence at its root, and an ignore file that keeps every
// local secret, every build and Terraform's local files out of a commit, while the examples of the
// secrets files and the providers' lock file stay in.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (...path: string[]) => readFileSync(join(ROOT, ...path), "utf8");

interface Rule {
  readonly negated: boolean;
  readonly directory: boolean;
  readonly pattern: RegExp;
  readonly anchored: boolean;
}

/** The rules of a `.gitignore`, as far as this repository writes them: globs, `!`, a trailing `/`. */
function rulesOf(text: string): Rule[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const negated = line.startsWith("!");
      let body = negated ? line.slice(1) : line;
      const directory = body.endsWith("/");
      if (directory) body = body.slice(0, -1);
      const anchored = body.includes("/");
      if (body.startsWith("/")) body = body.slice(1);
      const source = body
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*");
      return { negated, directory, anchored, pattern: new RegExp(`^${source}$`) };
    });
}

/** Whether Git would ignore a file at `path` (forward slashes, relative to the root). */
function ignored(rules: readonly Rule[], path: string): boolean {
  const segments = path.split("/");
  let result = false;
  for (const rule of rules) {
    const candidates = rule.directory
      ? segments.slice(0, -1).map((_, i) => segments.slice(rule.anchored ? 0 : i, i + 1).join("/"))
      : rule.anchored
        ? [path]
        : [segments.at(-1)!];
    if (candidates.some((candidate) => rule.pattern.test(candidate))) result = !rule.negated;
  }
  return result;
}

describe("the public repository", () => {
  const rules = rulesOf(read(".gitignore"));

  it("carries the Apache-2.0 licence at its root", () => {
    const licence = read("LICENSE");
    expect(licence).toMatch(/Apache License\s+Version 2\.0, January 2004/);
    expect(licence).toContain("END OF TERMS AND CONDITIONS");
  });

  it.each([
    "node_modules/wrangler/package.json",
    "packages/identity/dist/verify.js",
    "packages/identity/.wrangler/state/v3/d1/db.sqlite",
    ".vitest/results.json",
    "packages/identity/tsconfig.tsbuildinfo",
    "packages/identity/.dev.vars",
    "packages/identity/.dev.vars.local",
    "packages/site/.dev.vars.production",
    "packages/infra/.terraform/providers/registry.terraform.io/cloudflare/cloudflare/x",
    "packages/infra/terraform.tfstate",
    "packages/infra/terraform.tfstate.backup",
    "packages/infra/plan.tfplan",
    "packages/infra/crash.log",
    "packages/infra/terraform.tfvars",
    "packages/infra/secrets.auto.tfvars",
    "packages/infra/values.tfvars.json",
    "Thumbs.db",
    ".DS_Store",
    "packages/identity/wrangler.deploy.json",
    "packages/site/public/assets/site.js",
    "packages/site/public/assets/sea-home.svg",
  ])("ignores %s", (path) => {
    expect(ignored(rules, path)).toBe(true);
  });

  it.each([
    "packages/identity/.dev.vars.example",
    "packages/infra/.terraform.lock.hcl",
    "packages/infra/terraform.auto.tfvars.example",
    "packages/infra/main.tf",
    "packages/identity/wrangler.jsonc",
    "packages/identity/src/worker.ts",
    "packages/site/public/index.html",
    "packages/site/public/media/meltemi-mark-gradient.svg",
    "packages/site/src/site.ts",
    "LICENSE",
  ])("keeps %s", (path) => {
    expect(ignored(rules, path)).toBe(false);
  });
});
