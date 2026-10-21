// The bootstrap's own logic, without a terminal, `gh` or Cloudflare: the state bucket's S3
// credentials derived from Terraform's token, the signing key, and the identity configuration's
// public settings written in place.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GITHUB_PAGES,
  identitySettings,
  newSigningPair,
  r2Credentials,
  sortRecords,
  withIdentitySettings,
} from "../scripts/bootstrap.mjs";
import { parseJsonc } from "../scripts/deploy-config.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const config = readFileSync(join(ROOT, "packages", "identity", "wrangler.jsonc"), "utf8");

describe("r2Credentials", () => {
  it("is the token's id and the SHA-256 of its value, as R2 derives them", () => {
    const value = "a-cloudflare-api-token-value";
    expect(r2Credentials("token-id", value)).toEqual({
      accessKeyId: "token-id",
      secretAccessKey: createHash("sha256").update(value).digest("hex"),
    });
  });
});

describe("newSigningPair", () => {
  it("makes a P-256 pair whose public half has no private part and shares the kid", async () => {
    const { publicJwk, privateJwk } = await newSigningPair();
    expect(publicJwk).toMatchObject({ kty: "EC", crv: "P-256", use: "sig", alg: "ES256" });
    expect(publicJwk).not.toHaveProperty("d");
    expect(typeof privateJwk.d).toBe("string");
    expect(privateJwk.kid).toBe(publicJwk.kid);
    // A private JWK fits the Secrets Store's 1,024 bytes.
    expect(JSON.stringify(privateJwk).length).toBeLessThan(400);
  });
});

describe("withIdentitySettings", () => {
  it("publishes the new key first and writes the client ids, keeping the file valid", async () => {
    const { publicJwk } = await newSigningPair();
    const out = withIdentitySettings(config, {
      publicJwk,
      githubClientId: "Iv1.0123456789abcdef",
      googleClientId: "123-abc.apps.googleusercontent.com",
    });
    const vars = (parseJsonc(out) as { vars: Record<string, string> }).vars;
    expect(JSON.parse(vars["SESSION_PUBLIC_KEYS"]!)).toEqual([publicJwk]);
    expect(vars["GITHUB_CLIENT_ID"]).toBe("Iv1.0123456789abcdef");
    expect(vars["GOOGLE_CLIENT_ID"]).toBe("123-abc.apps.googleusercontent.com");
    expect(identitySettings(out).publicKeys).toEqual([publicJwk]);
    // Everything else is as committed.
    expect(
      out.replace(
        /"(SESSION_PUBLIC_KEYS|GITHUB_CLIENT_ID|GOOGLE_CLIENT_ID)": "(?:[^"\\]|\\.)*"/g,
        "",
      ),
    ).toBe(
      config.replace(
        /"(SESSION_PUBLIC_KEYS|GITHUB_CLIENT_ID|GOOGLE_CLIENT_ID)": "(?:[^"\\]|\\.)*"/g,
        "",
      ),
    );
  });

  it("keeps the previous keys after the new one, as a rotation needs", async () => {
    const first = (await newSigningPair()).publicJwk;
    const second = (await newSigningPair()).publicJwk;
    const once = withIdentitySettings(config, { publicJwk: first });
    const twice = withIdentitySettings(once, { publicJwk: second });
    expect(identitySettings(twice).publicKeys).toEqual([second, first]);
  });

  it("changes nothing when it is given nothing", () => {
    expect(withIdentitySettings(config, {})).toBe(config);
  });

  it("never writes a private key", async () => {
    const { publicJwk, privateJwk } = await newSigningPair();
    const out = withIdentitySettings(config, { publicJwk });
    expect(out).not.toContain(privateJwk.d);
  });
});

describe("sortRecords", () => {
  const record = (id: string, type: string, name: string, content: string) => ({
    id,
    type,
    name,
    content,
  });

  it("imports the GitHub Pages records of meltemi.dev's apex by address", () => {
    const records = GITHUB_PAGES.map((ip, i) => record(`r${i}`, "A", "meltemi.dev", ip));
    expect(sortRecords("meltemi.dev", records)).toEqual({
      imported: Object.fromEntries(GITHUB_PAGES.map((ip, i) => [ip, `r${i}`])),
      foreign: [],
    });
  });

  it("names every other record, such as Dynadot's parking page, and leaves NS and SOA alone", () => {
    const parking = record("p", "A", "meltemi.page", "185.53.179.149");
    const www = record("w", "CNAME", "www.meltemi.dev", "meltemi.dev");
    const { imported, foreign } = sortRecords("meltemi.page", [
      parking,
      record("n", "NS", "meltemi.page", "ns1.dyna-ns.net"),
      record("s", "SOA", "meltemi.page", "ns1.dyna-ns.net"),
    ]);
    expect(imported).toEqual({});
    expect(foreign).toEqual([parking]);
    expect(sortRecords("meltemi.dev", [www]).foreign).toEqual([www]);
  });

  it("knows the same GitHub Pages addresses as zones.tf", () => {
    const zones = readFileSync(join(ROOT, "packages", "infra", "zones.tf"), "utf8");
    const declared = /github_pages_addresses\s*=\s*\[([^\]]+)\]/.exec(zones)?.[1] ?? "";
    expect([...declared.matchAll(/"([\d.]+)"/g)].map((m) => m[1])).toEqual(GITHUB_PAGES);
  });
});
