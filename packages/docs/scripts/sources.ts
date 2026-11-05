// Where the portal's pages come from (design decision 2; specification `docs-sources`). Three
// modes, one shape: a tree of each repository's `docs/` and the readmes its pages link.
//
//   release  each product's latest published GitHub release (its `main` when it has none), read
//            from the release's archive; this repository's own docs from the checkout being built.
//   local    the sibling checkouts beside this repository (C:\meltemi\diagrams, C:\meltemi\ide).
//   fixture  test/fixtures/, which `pnpm test` and CI build: no network.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Section } from "../src/messages/index.js";
import { readTarGz, type TarArchive } from "./tar.js";

export type Mode = "release" | "local" | "fixture";
export const MODES: readonly Mode[] = ["release", "local", "fixture"];

/** The docs package's folder, and this repository's root. */
export const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
export const REPOSITORY_ROOT = resolve(PACKAGE, "..", "..");
/** Where the owner's sibling checkouts live: the folder that holds this repository. */
export const SIBLINGS = resolve(REPOSITORY_ROOT, "..");
export const FIXTURES = join(PACKAGE, "test", "fixtures");

export interface Product {
  readonly section: Section;
  readonly repo: string;
  /** The folder of its checkout beside this repository's, in `local` mode. */
  readonly folder: string;
}

/** The three sections, in the order the portal shows them. */
export const PRODUCTS: readonly Product[] = [
  { section: "diagrams", repo: "askenaz-dev/meltemi-diagrams", folder: "diagrams" },
  { section: "ide", repo: "askenaz-dev/meltemi", folder: "ide" },
  { section: "web", repo: "askenaz-dev/meltemi-web", folder: "web" },
];

/** The files outside `docs/` the build reads: the readmes that index a repository's pages. */
export const ROOT_FILES = [
  "README.md",
  "README.es.md",
  "LEEME.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
];

/** Whether a path of a repository is one the portal reads. */
export const keep = (path: string): boolean =>
  path.startsWith("docs/") || ROOT_FILES.includes(path);

export interface Release {
  /** The git ref links point at: a tag, a commit or `main`. */
  readonly ref: string;
  /** What the footer names: `v1.11.0`, `main`, a short commit. */
  readonly version: string;
  /** The day the release was published, or the commit's day, `YYYY-MM-DD`. */
  readonly date: string;
}

export interface SourceTree extends Release {
  readonly section: Section;
  readonly repo: string;
  /** The files kept, by their path in the repository (`docs/player.md`, `README.md`). */
  readonly files: Map<string, Uint8Array>;
}

export class SourceError extends Error {
  override name = "SourceError";
}

// ---------------------------------------------------------------------------------------------
// The mode.

/**
 * The mode the arguments name with `--from`, or, when they name none, `local` where the sibling
 * checkouts exist and `fixture` elsewhere. An unknown mode is refused with the three named.
 */
export function chooseMode(
  argv: readonly string[],
  siblingsExist: boolean,
): { mode: Mode; given: boolean } {
  const at = argv.findIndex((arg) => arg === "--from" || arg.startsWith("--from="));
  if (at < 0) return { mode: siblingsExist ? "local" : "fixture", given: false };
  const arg = argv[at]!;
  const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[at + 1];
  if (!value || !(MODES as readonly string[]).includes(value)) {
    throw new SourceError(
      `--from ${value ?? "(nothing)"} is not a mode: use one of ${MODES.join(", ")}`,
    );
  }
  return { mode: value as Mode, given: true };
}

/** Whether the owner's sibling checkouts of Diagrams and the IDE exist beside this repository. */
export function siblingsExist(siblings = SIBLINGS): boolean {
  return PRODUCTS.filter((p) => p.section !== "web").every((p) =>
    existsSync(join(siblings, p.folder, "docs")),
  );
}

// ---------------------------------------------------------------------------------------------
// Folders: a checkout or a fixture.

/** The files of a folder the portal reads (`docs/**` and the readmes), by repository path. */
export function readTree(root: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const stats = statSync(full);
      if (stats.isDirectory()) walk(full);
      else if (stats.isFile())
        files.set(relative(root, full).split(sep).join("/"), readFileSync(full));
    }
  };
  if (existsSync(join(root, "docs"))) walk(join(root, "docs"));
  for (const name of ROOT_FILES) {
    const full = join(root, name);
    if (existsSync(full)) files.set(name, readFileSync(full));
  }
  return files;
}

/** What git says of a checkout: its commit, a description of it and the commit's day. */
export function gitRelease(dir: string, describe: boolean): Release | undefined {
  try {
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", dir, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    const sha = git("rev-parse", "HEAD");
    const date = git("log", "-1", "--format=%cs");
    const version = describe ? git("describe", "--tags", "--always") : sha.slice(0, 7);
    return { ref: sha, version, date };
  } catch {
    return undefined;
  }
}

const today = () => new Date().toISOString().slice(0, 10);

/** This repository's own section, from the checkout being built. */
export function webSource(
  root = REPOSITORY_ROOT,
  env: NodeJS.ProcessEnv = process.env,
): SourceTree {
  const product = PRODUCTS.find((p) => p.section === "web")!;
  const git = gitRelease(root, false);
  const sha = env["SOURCE_SHA"] ?? git?.ref;
  return {
    section: "web",
    repo: product.repo,
    ref: sha ?? "main",
    version: sha ? sha.slice(0, 7) : "main",
    date: git?.date ?? today(),
    files: readTree(root),
  };
}

/** `local` mode: the sibling checkouts, and this repository. */
export function localSources(siblings = SIBLINGS, root = REPOSITORY_ROOT): SourceTree[] {
  return PRODUCTS.map((product) => {
    if (product.section === "web") return webSource(root);
    const dir = join(siblings, product.folder);
    if (!existsSync(join(dir, "docs"))) {
      throw new SourceError(`${product.repo}: no checkout with docs/ at ${dir}`);
    }
    const git = gitRelease(dir, true) ?? { ref: "main", version: "local", date: today() };
    return { section: product.section, repo: product.repo, ...git, files: readTree(dir) };
  });
}

/** `fixture` mode: test/fixtures/<section>, each with the release its `release.json` names. */
export function fixtureSources(fixtures = FIXTURES): SourceTree[] {
  return PRODUCTS.map((product) => {
    const dir = join(fixtures, product.section);
    const file = join(dir, "release.json");
    const release = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as Release)
      : { ref: "main", version: "fixture", date: "2026-11-04" };
    return { section: product.section, repo: product.repo, ...release, files: readTree(dir) };
  });
}

// ---------------------------------------------------------------------------------------------
// GitHub: the latest release and its archive.

export interface GitHubDeps {
  readonly fetch: typeof fetch;
  /** A token for GitHub's API (its rate limit); the archives of public repositories need none. */
  readonly token?: string | undefined;
}

export const latestReleaseUrl = (repo: string) =>
  `https://api.github.com/repos/${repo}/releases/latest`;

/** The archive of a ref: a tag (`refs/tags/v1.2.3`) or `main` (`refs/heads/main`). */
export const archiveUrl = (repo: string, ref: string) =>
  `https://codeload.github.com/${repo}/tar.gz/${ref === "main" ? "refs/heads/main" : `refs/tags/${ref}`}`;

const VERSION_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * The latest published release of a repository, or `undefined` when GitHub answers 404 (no
 * release yet). Any other answer, or one that names no published version, is an error.
 */
export async function latestRelease(
  repo: string,
  deps: GitHubDeps,
): Promise<{ tag: string; date: string } | undefined> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "meltemi-docs-build",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (deps.token) headers["Authorization"] = `Bearer ${deps.token}`;
  const response = await deps.fetch(latestReleaseUrl(repo), { headers });
  if (response.status === 404) return undefined;
  if (!response.ok)
    throw new SourceError(`GitHub answered ${response.status} for the latest release`);
  const json = (await response.json()) as Record<string, unknown>;
  const tag = json["tag_name"];
  const published = json["published_at"];
  if (
    json["draft"] === true ||
    json["prerelease"] === true ||
    typeof tag !== "string" ||
    !VERSION_TAG.test(tag)
  ) {
    throw new SourceError(`the latest release is not a published version (${JSON.stringify(tag)})`);
  }
  const date =
    typeof published === "string" ? /^\d{4}-\d{2}-\d{2}/.exec(published)?.[0] : undefined;
  if (!date) throw new SourceError(`the latest release ${tag} has no publication date`);
  return { tag, date };
}

/** Downloads and reads a ref's archive, keeping what the portal reads. */
export async function fetchArchive(
  repo: string,
  ref: string,
  deps: GitHubDeps,
): Promise<TarArchive> {
  const response = await deps.fetch(archiveUrl(repo, ref), {
    headers: { "User-Agent": "meltemi-docs-build" },
  });
  if (!response.ok || !response.body)
    throw new SourceError(`the archive of ${ref} answered ${response.status}`);
  const body = response.body as unknown as AsyncIterable<Uint8Array>;
  return readTarGz(body, keep);
}

/** One product's tree at its latest release, or at `main` when it has none. */
export async function releaseSource(product: Product, deps: GitHubDeps): Promise<SourceTree> {
  try {
    const release = await latestRelease(product.repo, deps);
    const ref = release?.tag ?? "main";
    const archive = await fetchArchive(product.repo, ref, deps);
    if (![...archive.files.keys()].some((path) => path.startsWith("docs/"))) {
      throw new SourceError(`the archive of ${ref} holds no docs/ folder`);
    }
    const date = release?.date ?? new Date(archive.mtime * 1000).toISOString().slice(0, 10);
    return {
      section: product.section,
      repo: product.repo,
      ref,
      version: ref,
      date,
      files: archive.files,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SourceError(
      `Cannot read the documentation of ${product.repo} (${product.section}): ${reason}`,
    );
  }
}

/** `release` mode: the products from GitHub, this repository from its checkout. */
export async function releaseSources(
  deps: GitHubDeps,
  root = REPOSITORY_ROOT,
): Promise<SourceTree[]> {
  const trees: SourceTree[] = [];
  for (const product of PRODUCTS) {
    trees.push(product.section === "web" ? webSource(root) : await releaseSource(product, deps));
  }
  return trees;
}

/** Every mode's trees. */
export async function sourcesFor(
  mode: Mode,
  options: { deps?: GitHubDeps; siblings?: string; root?: string; fixtures?: string } = {},
): Promise<SourceTree[]> {
  if (mode === "fixture") return fixtureSources(options.fixtures);
  if (mode === "local") return localSources(options.siblings, options.root);
  return releaseSources(options.deps ?? { fetch, token: process.env["GH_TOKEN"] }, options.root);
}

/** `sources.json`: what the footers and the home name, by section. */
export function sourcesJson(
  trees: readonly SourceTree[],
): Record<Section, Release & { repo: string }> {
  return Object.fromEntries(
    trees.map((t) => [t.section, { repo: t.repo, ref: t.ref, version: t.version, date: t.date }]),
  ) as Record<Section, Release & { repo: string }>;
}
