// The two scripts the pipelines run: the release tag check (one prefix per package), and the
// configuration the deploy workflow writes from the committed `wrangler.jsonc` and the ids
// Terraform gave.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DATABASE_PLACEHOLDER,
  deployConfig,
  parseJsonc,
  STORE_PLACEHOLDER,
} from "../scripts/deploy-config.mjs";
import { tagMismatch } from "../scripts/release-tag.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const identity = parseJsonc(readFileSync(join(ROOT, "packages/identity/wrangler.jsonc"), "utf8"));
const DATABASE = "6f1c2a52-8d1e-4f7a-9b3c-0a1b2c3d4e5f";
const STORE = "0123456789abcdef0123456789abcdef";

describe("release-tag", () => {
  const manifest = JSON.stringify({ name: "@meltemi/identity", version: "0.1.0" });

  it("accepts the tag of the package's version", () => {
    expect(tagMismatch("v0.1.0", manifest)).toBeUndefined();
  });

  it("refuses another version, naming both", () => {
    expect(tagMismatch("v0.2.0", manifest)).toBe(
      "the tag v0.2.0 does not name the package's version 0.1.0 (expected v0.1.0)",
    );
  });

  it("refuses a tag without the v", () => {
    expect(tagMismatch("0.1.0", manifest)).toMatch(/expected v0\.1\.0/);
  });

  describe("with the ocean's prefix", () => {
    const ocean = JSON.stringify({ name: "@meltemi/ocean", version: "0.1.0" });

    it("accepts ocean-v and the package's version", () => {
      expect(tagMismatch("ocean-v0.1.0", ocean, "ocean-v")).toBeUndefined();
    });

    it("refuses another version, naming both", () => {
      expect(tagMismatch("ocean-v0.2.0", ocean, "ocean-v")).toBe(
        "the tag ocean-v0.2.0 does not name the package's version 0.1.0 (expected ocean-v0.1.0)",
      );
    });

    it("keeps each family to its own package", () => {
      expect(tagMismatch("v0.1.0", ocean, "ocean-v")).toMatch(/expected ocean-v0\.1\.0/);
      expect(tagMismatch("ocean-v0.1.0", manifest)).toMatch(/expected v0\.1\.0/);
    });

    it("takes the prefix from the command line, against the package's manifest", () => {
      const path = join(ROOT, "packages/ocean/package.json");
      const { version } = JSON.parse(readFileSync(path, "utf8")) as { version: string };
      const run = (tag: string) =>
        spawnSync(process.execPath, [join(ROOT, "scripts/release-tag.mjs"), tag, path, "ocean-v"], {
          encoding: "utf8",
        });
      expect(run(`ocean-v${version}`).status).toBe(0);
      const wrong = run("ocean-v99.0.0");
      expect(wrong.status).toBe(1);
      expect(wrong.stderr).toContain(`expected ocean-v${version}`);
    });
  });
});

describe("deploy-config", () => {
  it("reads the committed file, with its placeholders", () => {
    expect(identity.d1_databases[0].database_id).toBe(DATABASE_PLACEHOLDER);
    expect(
      identity.secrets_store_secrets.every(
        (s: { store_id: string }) => s.store_id === STORE_PLACEHOLDER,
      ),
    ).toBe(true);
  });

  it("writes the database and the store Terraform gave into every binding", () => {
    const config = deployConfig(identity, { database: DATABASE, store: STORE });
    expect(config.d1_databases[0].database_id).toBe(DATABASE);
    expect(config.secrets_store_secrets.map((s: { store_id: string }) => s.store_id)).toEqual(
      Array(5).fill(STORE),
    );
    expect(JSON.stringify(config)).not.toContain(STORE_PLACEHOLDER);
  });

  it("keeps everything else as committed: name, entry, variables, no route", () => {
    const config = deployConfig(identity, { database: DATABASE, store: STORE });
    expect(config.name).toBe("meltemi-identity");
    expect(config.main).toBe("src/worker.ts");
    expect(config.vars).toEqual(identity.vars);
    expect(config.workers_dev).toBe(false);
    expect(config).not.toHaveProperty("routes");
  });

  it("does not change the committed configuration", () => {
    deployConfig(identity, { database: DATABASE, store: STORE });
    expect(identity.d1_databases[0].database_id).toBe(DATABASE_PLACEHOLDER);
  });

  it("refuses to deploy a placeholder, naming the missing variable", () => {
    expect(() => deployConfig(identity, { store: STORE })).toThrow(/^D1_DATABASE_ID is not set/);
    expect(() => deployConfig(identity, { database: DATABASE })).toThrow(
      /^SECRETS_STORE_ID is not set/,
    );
  });

  it("leaves a configuration with no placeholder alone", () => {
    const site = { name: "meltemi-site", assets: { directory: "./public" } };
    expect(deployConfig(site, {})).toEqual(site);
  });

  it("reads comments and trailing commas, and keeps them inside strings", () => {
    expect(parseJsonc('{\n  // a comment\n  "a": "x // y",\n  /* b */ "b": [1, 2,],\n}')).toEqual({
      a: "x // y",
      b: [1, 2],
    });
  });
});
