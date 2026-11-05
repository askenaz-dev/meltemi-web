// `scripts/sources.ts` and the preparation of `scripts/build.ts` (specification `docs-sources`, "The
// sources are the latest releases" and "Local and fixture modes"): GitHub's answers are stubs and
// the archives are written by the test, into temporary folders. Nothing reaches the network.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decodeIndex, EMBEDDING_MODEL } from "../src/ask-index.js";
import { prepare, type Dirs } from "../scripts/build.js";
import type { Exporter } from "../scripts/pictures.js";
import {
  archiveUrl,
  chooseMode,
  FIXTURES,
  latestReleaseUrl,
  localSources,
  PACKAGE,
  releaseSources,
  siblingsExist,
  sourcesJson,
  type GitHubDeps,
} from "../scripts/sources.js";
import { archive } from "./support/tar.js";

const folders: string[] = [];
afterAll(() => folders.forEach((f) => rmSync(f, { recursive: true, force: true })));
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  folders.push(dir);
  return dir;
};

/** A product's files as the release archive holds them: the fixture's tree. */
function filesOf(section: string): Record<string, Uint8Array> {
  const root = join(FIXTURES, section);
  const files: Record<string, Uint8Array> = {};
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.name === "release.json") continue;
      const path = `${prefix}${name.name}`;
      if (name.isDirectory()) walk(join(dir, name.name), `${path}/`);
      else files[path] = readFileSync(join(dir, name.name));
    }
  };
  walk(root, "");
  files["src/main.rs"] = Buffer.from("fn main() {}\n");
  return files;
}

/** GitHub as the stubs say: the IDE released v0.2.29, Diagrams has no release (404). */
function github({ truncateIde = false } = {}): GitHubDeps & { readonly requests: string[] } {
  const requests: string[] = [];
  const ide = archive(filesOf("ide"), { top: "askenaz-dev-meltemi-9f8e7d6", mtime: 1_793_750_000 });
  const diagrams = archive(filesOf("diagrams"), {
    top: "askenaz-dev-meltemi-diagrams-502c1a1",
    mtime: 1_793_832_000,
  });
  const answers: Record<string, () => Response> = {
    [latestReleaseUrl("askenaz-dev/meltemi")]: () =>
      Response.json({
        tag_name: "v0.2.29",
        published_at: "2026-11-03T21:54:30Z",
        draft: false,
        prerelease: false,
      }),
    [latestReleaseUrl("askenaz-dev/meltemi-diagrams")]: () => new Response("{}", { status: 404 }),
    [archiveUrl("askenaz-dev/meltemi", "v0.2.29")]: () =>
      new Response(truncateIde ? ide.slice(0, ide.length >> 1) : ide.slice()),
    [archiveUrl("askenaz-dev/meltemi-diagrams", "main")]: () => new Response(diagrams.slice()),
  };
  return {
    requests,
    token: "stub-token",
    fetch: (async (url: string) => {
      requests.push(url);
      const answer = answers[url];
      if (!answer) throw new Error(`no stub for ${url}`);
      return answer();
    }) as unknown as typeof fetch,
  };
}

/** An exporter that draws nothing, so these tests never run the command line. */
const noPictures: Exporter = { version: "none", draw: async () => undefined };

describe("the sources are the latest releases", () => {
  it("names v0.2.29 for the IDE and main for Diagrams, with their dates", async () => {
    const deps = github();
    const trees = await releaseSources(deps, join(FIXTURES, "web"));
    const json = sourcesJson(trees);
    expect(json.ide).toMatchObject({
      repo: "askenaz-dev/meltemi",
      ref: "v0.2.29",
      version: "v0.2.29",
      date: "2026-11-03",
    });
    expect(json.diagrams).toMatchObject({
      repo: "askenaz-dev/meltemi-diagrams",
      ref: "main",
      version: "main",
      date: "2026-11-04",
    });
    expect(deps.requests).toEqual([
      "https://api.github.com/repos/askenaz-dev/meltemi-diagrams/releases/latest",
      "https://codeload.github.com/askenaz-dev/meltemi-diagrams/tar.gz/refs/heads/main",
      "https://api.github.com/repos/askenaz-dev/meltemi/releases/latest",
      "https://codeload.github.com/askenaz-dev/meltemi/tar.gz/refs/tags/v0.2.29",
    ]);
    const ide = trees.find((t) => t.section === "ide")!;
    expect([...ide.files.keys()].sort()).toEqual([
      "LEEME.md",
      "README.md",
      "docs/local-models.md",
      "docs/quickstart.md",
    ]);
    expect(trees.find((t) => t.section === "web")!.files.has("docs/repositories.md")).toBe(true);
  });

  it("fails naming the IDE when its archive is truncated, and writes no page", async () => {
    const dir = temp("meltemi-docs-prepare-");
    const dirs: Dirs = {
      content: join(dir, "content"),
      generated: join(dir, "generated"),
      public: join(dir, "public"),
      cache: join(dir, "cache"),
    };
    await expect(
      prepare({
        mode: "release",
        deps: github({ truncateIde: true }),
        root: join(FIXTURES, "web"),
        dirs,
        exporter: noPictures,
        env: {},
      }),
    ).rejects.toThrow(/Cannot read the documentation of askenaz-dev\/meltemi \(ide\)/);
    expect(existsSync(dirs.content), "no page was written").toBe(false);
    expect(existsSync(dirs.generated)).toBe(false);
  });

  it("refuses a latest release that is not a published version", async () => {
    const deps: GitHubDeps = {
      fetch: (async () =>
        Response.json({
          tag_name: "nightly",
          published_at: "2026-11-03T00:00:00Z",
        })) as unknown as typeof fetch,
    };
    await expect(releaseSources(deps, join(FIXTURES, "web"))).rejects.toThrow(
      /meltemi-diagrams \(diagrams\): the latest release is not a published version/,
    );
  });
});

describe("the build's modes", () => {
  it("builds the fixture where no sibling checkout exists, and local where they do", () => {
    expect(chooseMode([], false)).toEqual({ mode: "fixture", given: false });
    expect(chooseMode([], true)).toEqual({ mode: "local", given: false });
    expect(chooseMode(["--from", "release"], false)).toEqual({ mode: "release", given: true });
    expect(chooseMode(["--from=fixture"], true)).toEqual({ mode: "fixture", given: true });
    expect(siblingsExist(temp("meltemi-no-siblings-"))).toBe(false);
  });

  it("refuses an unknown mode, naming the three", () => {
    expect(() => chooseMode(["--from", "elsewhere"], false)).toThrow(
      "--from elsewhere is not a mode: use one of release, local, fixture",
    );
    let failure: { status: number; stderr: string } | undefined;
    try {
      execFileSync(
        process.execPath,
        ["--import", "tsx", join(PACKAGE, "scripts", "build.ts"), "--from", "elsewhere"],
        {
          cwd: PACKAGE,
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf8",
        },
      );
    } catch (error) {
      failure = error as { status: number; stderr: string };
    }
    expect(failure?.status).toBe(2);
    expect(failure?.stderr).toContain("use one of release, local, fixture");
  });

  it("reads sibling checkouts in local mode, each at what git says of it", () => {
    const siblings = temp("meltemi-siblings-");
    for (const product of ["diagrams", "ide"]) {
      for (const [path, bytes] of Object.entries(filesOf(product))) {
        const file = join(siblings, product, ...path.split("/"));
        mkdirSync(join(file, ".."), { recursive: true });
        writeFileSync(file, bytes);
      }
    }
    expect(siblingsExist(siblings)).toBe(true);
    const trees = localSources(siblings, join(FIXTURES, "web"));
    expect(trees.map((t) => t.section)).toEqual(["diagrams", "ide", "web"]);
    expect(trees[0]!.files.has("docs/player.md")).toBe(true);
    // Not a git checkout: the build still names it.
    expect(trees[0]!.version).toBe("local");
  });

  it("leaves Ask the docs out and writes an index with no passage when the build has no token", async () => {
    const dir = temp("meltemi-docs-no-token-");
    const dirs: Dirs = {
      content: join(dir, "content"),
      generated: join(dir, "generated"),
      public: join(dir, "public"),
      cache: join(dir, "cache"),
    };
    const prepared = await prepare({
      mode: "local",
      siblings: FIXTURES,
      root: join(FIXTURES, "web"),
      dirs,
      exporter: noPictures,
      env: {},
    });
    expect(prepared.askEnabled).toBe(false);
    expect(JSON.parse(readFileSync(join(dirs.generated, "ask.json"), "utf8"))).toMatchObject({
      enabled: false,
      passages: 0,
    });
    const index = decodeIndex(readFileSync(join(dirs.public, "ask", "index.bin")));
    expect(index).toMatchObject({ model: EMBEDDING_MODEL, count: 0 });
    expect(existsSync(join(dirs.content, "diagrams", "player.md"))).toBe(true);
    expect(existsSync(join(dirs.content, "es", "ide", "quickstart.md"))).toBe(true);
    expect(readFileSync(join(dirs.content, "index.mdx"), "utf8")).not.toContain("Ask the docs");
  });
});
