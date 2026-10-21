// The published package: what `npm pack` puts in the tarball (the verifier and the test support
// built into `dist/`, the README and the licence, and nothing of the service), and the manifest
// fields npm and its provenance need.

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const ROOT = join(PACKAGE, "..", "..");
const manifest = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as Record<
  string,
  unknown
>;

/** Runs `npm` through the shell, which finds the Windows `.cmd` shim as it finds the command. */
function npm(command: string): string {
  return execSync(`npm ${command}`, {
    cwd: PACKAGE,
    encoding: "utf8",
    env: { ...process.env, npm_config_loglevel: "error" },
  });
}

let packed: string[] = [];

beforeAll(() => {
  // The tarball holds what the build wrote: build it when this checkout has not yet.
  if (!existsSync(join(PACKAGE, "dist", "verify.js"))) {
    execFileSync(
      process.execPath,
      [join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.build.json"],
      {
        cwd: PACKAGE,
      },
    );
  }
  const report = JSON.parse(npm("pack --dry-run --json --ignore-scripts")) as {
    files: { path: string }[];
  }[];
  packed = report[0]!.files.map((file) => file.path.replace(/\\/g, "/")).sort();
}, 60_000);

describe("the tarball", () => {
  it("holds the manifest, the README, the licence and dist/ only", () => {
    const outside = packed.filter(
      (path) =>
        !["package.json", "README.md", "LICENSE"].includes(path) && !path.startsWith("dist/"),
    );
    expect(outside).toEqual([]);
    expect(packed).toEqual(expect.arrayContaining(["package.json", "README.md", "LICENSE"]));
  });

  it("holds every file the exports name", () => {
    const exportsMap = manifest["exports"] as Record<string, Record<string, string>>;
    for (const entry of Object.values(exportsMap)) {
      for (const target of Object.values(entry)) {
        expect(packed, target).toContain(target.replace(/^\.\//, ""));
      }
    }
  });

  it("holds nothing of the service: no source, configuration, migration or Worker entry", () => {
    const service = packed.filter((path) =>
      /^(src|test|migrations|scripts)\/|wrangler|worker\.|handler\.|\.dev\.vars|\.map$/.test(path),
    );
    expect(service).toEqual([]);
  });

  it("carries the repository's licence, unchanged", () => {
    expect(readFileSync(join(PACKAGE, "LICENSE"), "utf8")).toBe(
      readFileSync(join(ROOT, "LICENSE"), "utf8"),
    );
  });
});

describe("the manifest", () => {
  it("is public, with provenance, under the meltemi organisation", () => {
    expect(manifest["name"]).toBe("@meltemi/identity");
    expect(manifest).not.toHaveProperty("private");
    expect(manifest["publishConfig"]).toEqual({ access: "public", provenance: true });
    expect(manifest["license"]).toBe("Apache-2.0");
  });

  it("names the repository the release workflow runs in, which provenance requires", () => {
    expect(manifest["repository"]).toEqual({
      type: "git",
      url: "git+https://github.com/askenaz-dev/meltemi-web.git",
      directory: "packages/identity",
    });
    expect(manifest["homepage"]).toBe(
      "https://github.com/askenaz-dev/meltemi-web/tree/main/packages/identity#readme",
    );
    expect(manifest["bugs"]).toEqual({ url: "https://github.com/askenaz-dev/meltemi-web/issues" });
  });

  it("runs on the Node versions the products support", () => {
    expect(manifest["engines"]).toEqual({ node: ">=22.12.0" });
  });

  it("has a version the release tag can name", () => {
    expect(manifest["version"]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
