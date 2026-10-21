// `pnpm site:tokens`: the comparison of the site's tokens with the IDE client's
// (specification `product-site`, "The tokens stay the IDE's"). The script is run as a command, on
// fixtures in a temporary folder; one extra check runs it on the real IDE repository when
// MELTEMI_IDE names it.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../scripts/tokens.mjs", import.meta.url));
const SITE_TOKENS = fileURLToPath(new URL("../public/tokens.css", import.meta.url));

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A throwaway "IDE repository" whose client stylesheet is `css`; returns its path and a site file. */
function fixture(client: string, site: string): { ide: string; site: string } {
  const root = mkdtempSync(join(tmpdir(), "meltemi-tokens-"));
  folders.push(root);
  mkdirSync(join(root, "ide", "desktop", "ui", "src"), { recursive: true });
  writeFileSync(join(root, "ide", "desktop", "ui", "src", "app.css"), client);
  writeFileSync(join(root, "tokens.css"), site);
  return { ide: join(root, "ide"), site: join(root, "tokens.css") };
}

interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(args: string[]): Run {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return { status: failure.status, stdout: failure.stdout, stderr: failure.stderr };
  }
}

/** The site's real tokens, which the client fixtures start from. */
const REAL = readFileSync(SITE_TOKENS, "utf8");

/** A stylesheet of `count` tokens named --t1…--tN, each with the value `#00000N`. */
function sheet(count: number): string {
  const lines = Array.from({ length: count }, (_, i) => `  --t${i + 1}: #00000${i % 10};`);
  return `:root {\n${lines.join("\n")}\n}\n`;
}

describe("pnpm site:tokens", () => {
  it("passes when the client declares every token of the site, --bg and --text included", () => {
    // The client is the site's tokens plus what a client adds: more themes, more tokens.
    const client = `${REAL}\n:root[data-theme="dark"] { --bg: #0b1220; --text: #e2e8f0; --client-only: 1px; }\n`;
    const { ide, site } = fixture(client, REAL);
    const result = run(["--ide", ide, "--site", site]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Compared (\d+) tokens/);
    const count = Number(/Compared (\d+) tokens/.exec(result.stdout)![1]);
    expect(count).toBeGreaterThanOrEqual(30);
    // It compares the design tokens, not only the two --mel-* ones.
    expect(REAL).toContain("--bg:");
    expect(REAL.match(/--mel-/g)!.length).toBeLessThan(count);
  });

  it("fails naming a token whose value differs, with both values", () => {
    const client = REAL.replace("--bg: #f8fafc;", "--bg: #f8fafd;");
    const { ide, site } = fixture(client, REAL);
    const result = run(["--ide", ide, "--site", site]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--bg");
    expect(result.stderr).toContain("#f8fafc");
    expect(result.stderr).toContain("#f8fafd");
  });

  it("compares a --mel-* token too", () => {
    const client = REAL.replace("--mel-aegean: #2563eb;", "--mel-aegean: #2563ec;");
    const { ide, site } = fixture(client, REAL);
    const result = run(["--ide", ide, "--site", site]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--mel-aegean");
  });

  it("accepts a value the client declares for another theme of the same token", () => {
    // The dark block of the site repeats names with other values; the client lists them all.
    const { ide, site } = fixture(REAL, REAL);
    expect(run(["--ide", ide, "--site", site]).status).toBe(0);
    const darkOnly = REAL.replace("--bg: #f8fafc;", "--bg: #0b1220;");
    const swapped = fixture(REAL, darkOnly);
    expect(run(["--ide", swapped.ide, "--site", swapped.site]).status).toBe(0);
  });

  it("fails naming a site token the client lacks", () => {
    const site = REAL.replace(":root {", ":root {\n  --site-only: #fff;");
    const { ide, site: file } = fixture(REAL, site);
    const result = run(["--ide", ide, "--site", file]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--site-only: missing in the client");
  });

  it("names every divergence, not only the first", () => {
    const site = REAL.replace("--bg: #f8fafc;", "--bg: #111111;").replace(
      "--text: #0f172a;",
      "--text: #222222;",
    );
    const { ide, site: file } = fixture(REAL, site);
    const result = run(["--ide", ide, "--site", file]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--bg");
    expect(result.stderr).toContain("--text");
  });

  it("refuses a site file with fewer than 30 tokens, naming the count and the floor", () => {
    const { ide, site } = fixture(sheet(29), sheet(29));
    const result = run(["--ide", ide, "--site", site]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/only 29 tokens/);
    expect(result.stderr).toContain("floor is 30");
  });

  it("accepts exactly 30 tokens", () => {
    const { ide, site } = fixture(sheet(30), sheet(30));
    expect(run(["--ide", ide, "--site", site]).status).toBe(0);
  });

  it("ignores a token written in a comment", () => {
    const site = `${sheet(30)}/* --commented-out: #123456; */\n`;
    const { ide, site: file } = fixture(sheet(30), site);
    expect(run(["--ide", ide, "--site", file]).status).toBe(0);
  });

  it("collapses white space inside a value before comparing", () => {
    const client = `${sheet(29)}:root { --spaced:   rgb(0   0  0 / 0.18); }\n`;
    const site = `${sheet(29)}:root { --spaced: rgb(0 0 0 / 0.18); }\n`;
    const { ide, site: file } = fixture(client, site);
    expect(run(["--ide", ide, "--site", file]).status).toBe(0);
  });

  it("exits 2 with usage when --ide is missing", () => {
    const result = run([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--ide");
  });

  it("exits 2 when the client stylesheet cannot be read", () => {
    const { site } = fixture(REAL, REAL);
    const result = run(["--ide", join(tmpdir(), "no-such-ide-repository"), "--site", site]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Cannot read/);
  });

  it.skipIf(!process.env["MELTEMI_IDE"])("matches the real IDE repository (MELTEMI_IDE)", () => {
    const result = run(["--ide", process.env["MELTEMI_IDE"]!]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
