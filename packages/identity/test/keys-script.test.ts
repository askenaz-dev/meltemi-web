// `pnpm identity:keys` (`scripts/keys.mjs`): prints a new signing pair and writes nothing
// (`identity-session`: "Public keys and rotation"). The script runs as the owner runs it, with
// node and no shell, and its output is used the way the service reads it.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { identity } from "../src/handler.js";
import {
  importSigningKeys,
  signJwt,
  thumbprint,
  type JsonWebKeySet,
  type PrivateJwk,
  type PublicJwk,
} from "../src/jwt.js";
import { readConfig } from "../src/config.js";
import { startSession } from "../src/session.js";
import { sessionVerifier } from "../src/verify.js";
import { harness } from "./support/index.js";
import { T0, fullClaims } from "./support/tokens.js";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(PACKAGE, "scripts", "keys.mjs");
const ROOT = join(PACKAGE, "..", "..");

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function run(cwd: string = PACKAGE): string {
  return execFileSync(process.execPath, [SCRIPT], { cwd, encoding: "utf8" });
}

interface Printed {
  readonly output: string;
  readonly privateLine: string;
  readonly publicLine: string;
  readonly privateJwk: PrivateJwk;
  readonly publicJwk: PublicJwk;
}

function printed(output: string = run()): Printed {
  const lines = output.split(/\r?\n/).filter((line) => line.startsWith("{"));
  expect(lines, "the script prints exactly two JSON lines").toHaveLength(2);
  const [privateLine, publicLine] = lines as [string, string];
  return {
    output,
    privateLine,
    publicLine,
    privateJwk: JSON.parse(privateLine) as PrivateJwk,
    publicJwk: JSON.parse(publicLine) as PublicJwk,
  };
}

/** What a folder holds, one level deep: the names, and with `details` the sizes and times too. */
function snapshot(dir: string, details = false): string[] {
  return readdirSync(dir)
    .sort()
    .map((name) => {
      if (!details) return name;
      const stat = statSync(join(dir, name));
      return `${name} ${stat.isDirectory() ? "dir" : `${stat.size} ${stat.mtimeMs}`}`;
    });
}

describe("scripts/keys.mjs", () => {
  it("prints a private JWK for SESSION_PRIVATE_KEY and a public JWK for SESSION_PUBLIC_KEYS", () => {
    const { output, privateJwk, publicJwk } = printed();
    expect(output).toContain("SESSION_PRIVATE_KEY");
    expect(output).toContain("SESSION_PUBLIC_KEYS");
    expect(privateJwk).toMatchObject({ kty: "EC", crv: "P-256", use: "sig", alg: "ES256" });
    expect(publicJwk).toMatchObject({ kty: "EC", crv: "P-256", use: "sig", alg: "ES256" });
    expect(typeof privateJwk.d).toBe("string");
    expect(privateJwk.d.length).toBeGreaterThan(20);
    expect(Object.keys(publicJwk).sort()).toEqual(["alg", "crv", "kid", "kty", "use", "x", "y"]);
  });

  it("puts the private line before the public one, each under its own heading", () => {
    const { output, privateLine, publicLine } = printed();
    expect(output.indexOf("SESSION_PRIVATE_KEY")).toBeLessThan(output.indexOf(privateLine));
    expect(output.indexOf(privateLine)).toBeLessThan(output.indexOf("SESSION_PUBLIC_KEYS"));
    expect(output.indexOf("SESSION_PUBLIC_KEYS")).toBeLessThan(output.indexOf(publicLine));
  });

  it("gives both JWKs the same kid and the same public point", () => {
    const { privateJwk, publicJwk } = printed();
    expect(privateJwk.kid).toBe(publicJwk.kid);
    expect(privateJwk.x).toBe(publicJwk.x);
    expect(privateJwk.y).toBe(publicJwk.y);
  });

  it("names the key by its RFC 7638 thumbprint", async () => {
    const { publicJwk } = printed();
    const canonical = `{"crv":"P-256","kty":"EC","x":"${publicJwk.x}","y":"${publicJwk.y}"}`;
    expect(publicJwk.kid).toBe(createHash("sha256").update(canonical).digest("base64url"));
    expect(publicJwk.kid).toBe(await thumbprint(publicJwk));
    expect(publicJwk.kid).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("prints a new pair every time", () => {
    const [a, b] = [printed(), printed()];
    expect(a.publicJwk.kid).not.toBe(b.publicJwk.kid);
    expect(a.privateJwk.d).not.toBe(b.privateJwk.d);
  });

  it("prints a private JWK that imports for signing and a public one that verifies what it signs", async () => {
    const { privateJwk, publicJwk } = printed();
    const keys = await importSigningKeys(privateJwk, [publicJwk]);
    expect(keys.kid).toBe(publicJwk.kid);
    const token = await signJwt(keys, fullClaims(T0));
    const verifier = sessionVerifier({ jwks: { keys: [publicJwk] }, checkSession: false });
    expect((await verifier.verifySession(token, T0))?.sub).toBe("user-1");
  });

  it("prints values the Worker reads: JSON for SESSION_PRIVATE_KEY and an array for SESSION_PUBLIC_KEYS", async () => {
    const { privateLine, publicJwk } = printed();
    // What `src/worker.ts` does with the two settings.
    const privateKey = JSON.parse(privateLine) as PrivateJwk;
    const publicKeys = JSON.parse(JSON.stringify([publicJwk])) as PublicJwk[];
    const h = await harness();
    const deps = { ...h.deps, keys: await importSigningKeys(privateKey, publicKeys) };

    const published = (await (
      await identity(new Request(`${h.env.ISSUER}/.well-known/jwks.json`), h.env, deps)
    ).json()) as JsonWebKeySet;
    expect(published.keys.map((k) => k["kid"])).toEqual([publicJwk.kid]);

    const at = h.clock.now().toISOString();
    const user = { id: "user-1", name: "Ana", picture: "", createdAt: at };
    await h.store.createUser(user);
    const started = await startSession(
      { deps, config: readConfig(h.env), request: new Request(h.env.ISSUER) },
      user,
      { email: "", emailVerified: false },
    );
    const verifier = sessionVerifier({ jwks: published, checkSession: false });
    expect((await verifier.verifySession(started.token, h.clock.now()))?.sub).toBe("user-1");
  });

  it("exits cleanly and says nothing on the error stream", () => {
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: PACKAGE, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  describe("writes nothing to a file", () => {
    it("leaves the package folder and the scripts folder as they were", () => {
      const scripts = join(PACKAGE, "scripts");
      const before = { root: snapshot(PACKAGE), scripts: snapshot(scripts, true) };
      printed();
      expect({ root: snapshot(PACKAGE), scripts: snapshot(scripts, true) }).toEqual(before);
    });

    it("leaves the folder it runs from empty", () => {
      const cwd = mkdtempSync(join(tmpdir(), "meltemi-keys-"));
      scratch.push(cwd);
      printed(run(cwd));
      expect(readdirSync(cwd)).toEqual([]);
    });

    it("imports nothing but node:crypto, so it has no way to write a file", () => {
      const source = readFileSync(SCRIPT, "utf8");
      const imports = [...source.matchAll(/^\s*import\b[^;]*?from\s+["']([^"']+)["']/gm)].map(
        (m) => m[1],
      );
      expect(imports).toEqual(["node:crypto"]);
      expect(source).not.toMatch(
        /\bfs\b|writeFile|appendFile|createWriteStream|\bmkdir|process\.stdout\.fd/,
      );
    });
  });

  it("is what `pnpm identity:keys` runs", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["identity:keys"]).toBe("node packages/identity/scripts/keys.mjs");
  });
});
