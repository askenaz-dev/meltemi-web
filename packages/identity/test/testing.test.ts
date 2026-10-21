// `@meltemi/identity/testing`: what a product's own tests use to be somebody without the service
// running (`identity-session`: "Test support for products").

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { thumbprint } from "../src/jwt.js";
import { signSessionToken, testJwks, testKeys, type SessionClaims } from "../src/testing.js";
import { sessionVerifier } from "../src/verify.js";
import { SECOND, T0, THIRTY_DAYS_SECONDS, after, decodeToken } from "./support/tokens.js";

const DEFAULT_ISSUER = "https://id.meltemi.dev";
const iatOf = (now: Date) => Math.floor(now.getTime() / 1000);

describe("testKeys", () => {
  it("gives a pair of JWKs for ES256 that carry the same kid", async () => {
    const { privateJwk, publicJwk } = await testKeys();
    expect(publicJwk).toMatchObject({ kty: "EC", crv: "P-256", use: "sig", alg: "ES256" });
    expect(typeof publicJwk.kid).toBe("string");
    expect(publicJwk.kid.length).toBeGreaterThan(20);
    expect(privateJwk.kid).toBe(publicJwk.kid);
    expect(privateJwk.x).toBe(publicJwk.x);
    expect(privateJwk.y).toBe(publicJwk.y);
  });

  it("keeps the secret half in the private JWK only", async () => {
    const { privateJwk, publicJwk } = await testKeys();
    expect(typeof privateJwk.d).toBe("string");
    expect(privateJwk.d.length).toBeGreaterThan(20);
    expect(Object.keys(publicJwk)).not.toContain("d");
    expect(JSON.stringify(publicJwk)).not.toContain(privateJwk.d);
  });

  it("names the key by its RFC 7638 thumbprint", async () => {
    const { publicJwk } = await testKeys();
    const canonical = JSON.stringify({
      crv: publicJwk.crv,
      kty: publicJwk.kty,
      x: publicJwk.x,
      y: publicJwk.y,
    });
    expect(publicJwk.kid).toBe(createHash("sha256").update(canonical).digest("base64url"));
    expect(publicJwk.kid).toBe(await thumbprint(publicJwk));
  });

  it("gives different keys each time, with different kids", async () => {
    const pairs = await Promise.all([testKeys(), testKeys(), testKeys()]);
    expect(new Set(pairs.map((k) => k.publicJwk.kid)).size).toBe(3);
    expect(new Set(pairs.map((k) => k.privateJwk.d)).size).toBe(3);
    expect(new Set(pairs.map((k) => k.publicJwk.x)).size).toBe(3);
  });
});

describe("testJwks", () => {
  it("is the key set the service would publish for these keys, with no private part", async () => {
    const keys = await testKeys();
    const jwks = testJwks(keys);
    expect(jwks).toEqual({ keys: [keys.publicJwk] });
    expect(JSON.stringify(jwks)).not.toContain(keys.privateJwk.d);
  });
});

describe("signSessionToken", () => {
  describe("a product mints a test session", () => {
    it("verifies with the real verifier, with every default filled", async () => {
      const keys = await testKeys();
      const now = new Date("2026-10-14T12:00:00.000Z");
      const token = await signSessionToken({ sub: "u1", name: "Ana" }, keys, now);
      const verifier = sessionVerifier({
        jwks: () => Promise.resolve(testJwks(keys)),
        checkSession: false,
      });

      const claims = await verifier.verifySession(token, now);
      expect(claims).toMatchObject({
        sub: "u1",
        name: "Ana",
        iss: DEFAULT_ISSUER,
        aud: "meltemi",
        picture: "",
        email: "",
        email_verified: false,
        iat: iatOf(now),
        exp: iatOf(now) + THIRTY_DAYS_SECONDS,
      });
      expect(claims?.sid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it("writes the header the service writes", async () => {
      const keys = await testKeys();
      const { header } = decodeToken(await signSessionToken({ sub: "u1" }, keys, T0));
      expect(header).toEqual({ alg: "ES256", typ: "JWT", kid: keys.publicJwk.kid });
    });

    it("draws a new sid for every token", async () => {
      const keys = await testKeys();
      const sids = await Promise.all(
        Array.from(
          { length: 5 },
          async () => decodeToken(await signSessionToken({ sub: "u1" }, keys, T0)).claims["sid"],
        ),
      );
      expect(new Set(sids).size).toBe(5);
    });

    it("takes iat from the time given, to the second, and expires thirty days later", async () => {
      const keys = await testKeys();
      const now = new Date("2026-10-14T12:00:00.789Z");
      const { claims } = decodeToken(await signSessionToken({ sub: "u1" }, keys, now));
      expect(claims["iat"]).toBe(iatOf(now));
      expect(claims["exp"]).toBe(iatOf(now) + 2_592_000);
    });

    it("is refused after its thirty days and sixty seconds, like any token", async () => {
      const keys = await testKeys();
      const token = await signSessionToken({ sub: "u1" }, keys, T0);
      const verifier = sessionVerifier({ jwks: testJwks(keys), checkSession: false });
      const end = THIRTY_DAYS_SECONDS * SECOND;
      expect(await verifier.verifySession(token, after(end + 60 * SECOND))).toBeDefined();
      expect(await verifier.verifySession(token, after(end + 61 * SECOND))).toBeUndefined();
    });

    it("is verified with a session check too, when a product leaves the default on", async () => {
      const keys = await testKeys();
      const token = await signSessionToken({ sub: "u1", sid: "known" }, keys, T0);
      const asked: string[] = [];
      const verifier = sessionVerifier({
        jwks: testJwks(keys),
        checkSession: async (sid) => {
          asked.push(sid);
          return true;
        },
      });
      expect((await verifier.verifySession(token, T0))?.sid).toBe("known");
      expect(asked).toEqual(["known"]);
    });
  });

  describe("a product passes its own issuer", () => {
    it("carries that issuer and picture, and fails with the default issuer", async () => {
      const keys = await testKeys();
      const now = T0;
      const token = await signSessionToken(
        { sub: "u1", iss: "http://localhost:8787", picture: "http://localhost:8788/avatar.png" },
        keys,
        now,
      );

      const own = sessionVerifier({
        issuer: "http://localhost:8787",
        jwks: testJwks(keys),
        checkSession: false,
      });
      expect(await own.verifySession(token, now)).toMatchObject({
        sub: "u1",
        iss: "http://localhost:8787",
        picture: "http://localhost:8788/avatar.png",
      });

      const byDefault = sessionVerifier({ jwks: testJwks(keys), checkSession: false });
      expect(await byDefault.verifySession(token, now)).toBeUndefined();
    });
  });

  describe("a claim given overrides its default", () => {
    const overrides: [keyof SessionClaims, SessionClaims[keyof SessionClaims]][] = [
      ["iss", "https://other.example"],
      ["aud", "other"],
      ["sub", "someone"],
      ["sid", "my-own-sid"],
      ["name", "Ana Dev"],
      ["picture", "https://avatars.githubusercontent.com/u/1"],
      ["email", "ana@example.com"],
      ["email_verified", true],
      ["iat", iatOf(T0) - 5],
      ["exp", iatOf(T0) + 3600],
    ];

    it.each(overrides)("%s", async (claim, value) => {
      const keys = await testKeys();
      const token = await signSessionToken({ sub: "u1", [claim]: value }, keys, T0);
      expect(decodeToken(token).claims[claim]).toBe(value);
    });

    it("lets a test make a token that is already expired, to try its own refusal", async () => {
      const keys = await testKeys();
      const token = await signSessionToken({ sub: "u1", exp: iatOf(T0) - 3600 }, keys, T0);
      const verifier = sessionVerifier({ jwks: testJwks(keys), checkSession: false });
      expect(await verifier.verifySession(token, T0)).toBeUndefined();
    });

    it("keeps the default of a claim that is given as undefined", async () => {
      const keys = await testKeys();
      const token = await signSessionToken(
        { sub: "u1", picture: undefined, name: undefined, exp: undefined, sid: undefined },
        keys,
        T0,
      );
      const verifier = sessionVerifier({ jwks: testJwks(keys), checkSession: false });
      const claims = await verifier.verifySession(token, T0);
      expect(claims).toMatchObject({ sub: "u1", name: "", picture: "" });
      expect(claims?.exp).toBe(iatOf(T0) + THIRTY_DAYS_SECONDS);
      expect(claims?.sid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it("keeps the verifier's refusal of a claim a test got wrong on purpose", async () => {
      const keys = await testKeys();
      const verifier = sessionVerifier({ jwks: testJwks(keys), checkSession: false });
      const wrongAudience = await signSessionToken({ sub: "u1", aud: "other" }, keys, T0);
      expect(await verifier.verifySession(wrongAudience, T0)).toBeUndefined();
    });
  });

  describe("the keys", () => {
    it("is signed by the keys given: other keys do not verify it", async () => {
      const [mine, theirs] = [await testKeys(), await testKeys()];
      const token = await signSessionToken({ sub: "u1" }, mine, T0);
      const verifier = sessionVerifier({ jwks: testJwks(theirs), checkSession: false });
      expect(await verifier.verifySession(token, T0)).toBeUndefined();
    });

    it("signs with the key that testJwks publishes, whatever else the set holds", async () => {
      const [mine, other] = [await testKeys(), await testKeys()];
      const token = await signSessionToken({ sub: "u1" }, mine, T0);
      const verifier = sessionVerifier({
        jwks: { keys: [other.publicJwk, mine.publicJwk] },
        checkSession: false,
      });
      expect((await verifier.verifySession(token, T0))?.sub).toBe("u1");
    });
  });
});
