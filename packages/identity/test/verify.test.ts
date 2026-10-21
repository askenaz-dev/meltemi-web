// The reference verifier of the session (`identity-session`: "A reference verifier for products").
// Every test uses generated keys, a clock passed to `verifySession` and a fetch that answers from
// memory: no test reaches the network.

import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { base64url, utf8 } from "../src/crypto.js";
import { importSigningKeys, signJwt, type JsonWebKeySet } from "../src/jwt.js";
import { signSessionToken, testJwks, testKeys, type TestKeys } from "../src/testing.js";
import {
  parseSessionCookie,
  sessionVerifier,
  verifyEventSignature,
  type SessionVerifierOptions,
} from "../src/verify.js";
import {
  DAY,
  HOUR,
  MINUTE,
  SECOND,
  T0,
  THIRTY_DAYS_SECONDS,
  after,
  craftToken,
  craftWithKid,
  encodePart,
  fullClaims,
  goodHeader,
} from "./support/tokens.js";

const ISSUER = "https://id.meltemi.dev";
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------------------------
// The service as the verifier sees it: a JWKS address and a session check, answered from memory.

interface FakeService {
  readonly fetch: typeof fetch;
  /** Every request made, as `METHOD url`, in order. */
  readonly calls: string[];
  /** What the JWKS address answers with. */
  jwks: unknown;
  /** When set, the JWKS address answers with this text instead. */
  jwksBody: string | undefined;
  jwksStatus: number;
  jwksThrows: boolean;
  /** The status of `GET /sessions/<sid>`. */
  sessionStatus: number;
  sessionThrows: boolean;
  jwksCalls(): number;
  sessionCalls(): number;
}

function fakeService(jwks: unknown): FakeService {
  const service: FakeService = {
    calls: [],
    jwks,
    jwksBody: undefined,
    jwksStatus: 200,
    jwksThrows: false,
    sessionStatus: 204,
    sessionThrows: false,
    jwksCalls: () => service.calls.filter((call) => call === `GET ${JWKS_URL}`).length,
    sessionCalls: () => service.calls.filter((call) => call.includes("/sessions/")).length,
    fetch: async (input, init) => {
      const request = new Request(input as RequestInfo, init);
      service.calls.push(`${request.method} ${request.url}`);
      if (request.url === JWKS_URL) {
        if (service.jwksThrows) throw new TypeError("the JWKS address is unreachable");
        return new Response(service.jwksBody ?? JSON.stringify(service.jwks), {
          status: service.jwksStatus,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (request.url.startsWith(`${ISSUER}/sessions/`)) {
        if (service.sessionThrows) throw new TypeError("the session check is unreachable");
        return new Response(null, { status: service.sessionStatus });
      }
      throw new Error(`The test made a request to ${request.url}: no test reaches the network`);
    },
  };
  return service;
}

/** Keys, a service publishing them, a verifier reading the JWKS from its address, and a token. */
async function fixture(options: Partial<SessionVerifierOptions> = {}) {
  const keys = await testKeys();
  const service = fakeService(testJwks(keys));
  const verifier = sessionVerifier({ jwks: JWKS_URL, fetch: service.fetch, ...options });
  const token = await signSessionToken({ sub: "user-1", name: "Ana" }, keys, T0);
  return { keys, service, verifier, token };
}

/** A verifier on inline keys without a session check, for tests of the token alone. */
async function offline(options: Partial<SessionVerifierOptions> = {}) {
  const keys = await testKeys();
  const verifier = sessionVerifier({ jwks: testJwks(keys), checkSession: false, ...options });
  return { keys, verifier };
}

// ---------------------------------------------------------------------------------------------

describe("a valid token", () => {
  it("returns the claims, and the session check is called once for two verifications within the hour", async () => {
    const { service, verifier, token } = await fixture();
    const sid = JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))).sid;

    const first = await verifier.verifySession(token, T0);
    const second = await verifier.verifySession(token, after(HOUR - SECOND));

    expect(first).toEqual({
      iss: ISSUER,
      aud: "meltemi",
      sub: "user-1",
      sid,
      name: "Ana",
      picture: "",
      email: "",
      email_verified: false,
      iat: Math.floor(T0.getTime() / 1000),
      exp: Math.floor(T0.getTime() / 1000) + THIRTY_DAYS_SECONDS,
    });
    expect(second).toEqual(first);
    expect(service.sessionCalls()).toBe(1);
    expect(service.calls).toContain(`GET ${ISSUER}/sessions/${sid}`);
    expect(service.jwksCalls()).toBe(1);
  });

  it("asks the session check again when an hour has passed", async () => {
    const { service, verifier, token } = await fixture();
    await verifier.verifySession(token, T0);
    await verifier.verifySession(token, after(HOUR - 1));
    expect(service.sessionCalls()).toBe(1);
    await verifier.verifySession(token, after(HOUR));
    expect(service.sessionCalls()).toBe(2);
  });

  it("returns only the claims of the contract, whatever else the token carries", async () => {
    const { keys, verifier } = await offline();
    const token = await craftToken(
      keys,
      goodHeader(keys),
      fullClaims(T0, { admin: true, jti: "x", nbf: 1 }),
    );
    const claims = await verifier.verifySession(token, T0);
    expect(Object.keys(claims ?? {}).sort()).toEqual([
      "aud",
      "email",
      "email_verified",
      "exp",
      "iat",
      "iss",
      "name",
      "picture",
      "sid",
      "sub",
    ]);
  });

  it("uses the current time when none is given", async () => {
    const { keys, verifier } = await offline();
    const fresh = await signSessionToken({ sub: "u1" }, keys, new Date());
    const old = await signSessionToken({ sub: "u1" }, keys, new Date(Date.now() - 31 * DAY));
    expect((await verifier.verifySession(fresh))?.sub).toBe("u1");
    expect(await verifier.verifySession(old)).toBeUndefined();
  });

  it("checks signatures with crypto.subtle.verify, which compares in constant time", async () => {
    const { keys, verifier } = await offline();
    const token = await signSessionToken({ sub: "u1" }, keys, T0);
    const verify = vi.spyOn(crypto.subtle, "verify");
    await verifier.verifySession(token, T0);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls[0]![0]).toMatchObject({ name: "ECDSA", hash: "SHA-256" });
  });

  it("verifies together-started verifications of one token with one key set and one session check", async () => {
    const { service, verifier, token } = await fixture();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => verifier.verifySession(token, T0)),
    );
    expect(results.every((claims) => claims?.sub === "user-1")).toBe(true);
    expect(service.jwksCalls()).toBe(1);
    expect(service.sessionCalls()).toBe(1);
  });
});

describe("algorithm confusion", () => {
  const BAD_ALGS: [string, unknown][] = [
    ["none", "none"],
    ["None", "None"],
    ["NONE", "NONE"],
    ["an empty alg", ""],
    ["a missing alg", undefined],
    ["HS256", "HS256"],
    ["HS384", "HS384"],
    ["RS256", "RS256"],
    ["ES384", "ES384"],
    ["ES512", "ES512"],
    ["a lowercase es256", "es256"],
    ["EdDSA", "EdDSA"],
    ["an array", ["ES256"]],
    ["a number", 256],
    ["null", null],
  ];

  it("refuses alg none with an empty signature, and no key is looked up", async () => {
    const { keys, service, verifier, token } = await fixture();
    const unsecured = `${encodePart({ alg: "none", typ: "JWT", kid: keys.publicJwk.kid })}.${token.split(".")[1]}.`;
    expect(await verifier.verifySession(unsecured, T0)).toBeUndefined();
    expect(service.calls).toEqual([]);
  });

  it.each(BAD_ALGS)(
    "refuses %s even with a valid ES256 signature, before any key is looked up",
    async (_name, alg) => {
      const keys = await testKeys();
      const jwks = vi.fn(async () => testJwks(keys));
      const service = fakeService(testJwks(keys));
      const verifier = sessionVerifier({ jwks, fetch: service.fetch });
      const header: Record<string, unknown> = { typ: "JWT", kid: keys.publicJwk.kid };
      if (alg !== undefined) header["alg"] = alg;
      const token = await craftToken(keys, header, fullClaims(T0));
      expect(await verifier.verifySession(token, T0)).toBeUndefined();
      expect(jwks).not.toHaveBeenCalled();
      expect(service.calls).toEqual([]);
    },
  );

  it("accepts the same token once the header says ES256 (so the refusals above are the alg)", async () => {
    const keys = await testKeys();
    const verifier = sessionVerifier({ jwks: testJwks(keys), checkSession: false });
    const token = await craftToken(keys, goodHeader(keys), fullClaims(T0));
    expect((await verifier.verifySession(token, T0))?.sub).toBe("user-1");
  });

  describe("HS256 with the public key as the secret", () => {
    async function forged(secret: string | Buffer, keys: TestKeys): Promise<string> {
      const header = { alg: "HS256", typ: "JWT", kid: keys.publicJwk.kid };
      const input = `${encodePart(header)}.${encodePart(fullClaims(T0))}`;
      const mac = createHmac("sha256", secret).update(input).digest("base64url");
      return `${input}.${mac}`;
    }

    it.each([
      ["the JWK as JSON", (k: TestKeys) => JSON.stringify(k.publicJwk)],
      ["x and y joined", (k: TestKeys) => k.publicJwk.x + k.publicJwk.y],
      ["x", (k: TestKeys) => k.publicJwk.x],
      [
        "the uncompressed point",
        (k: TestKeys) =>
          Buffer.concat([
            Buffer.from([4]),
            Buffer.from(k.publicJwk.x, "base64url"),
            Buffer.from(k.publicJwk.y, "base64url"),
          ]),
      ],
    ])("is refused when the secret is %s", async (_name, secretOf) => {
      const { keys, service, verifier } = await fixture();
      const token = await forged(secretOf(keys), keys);
      expect(await verifier.verifySession(token, T0)).toBeUndefined();
      expect(service.sessionCalls()).toBe(0);
    });

    it("is refused even when the header says ES256 and the signature is the HMAC", async () => {
      const { keys, verifier } = await fixture();
      const input = `${encodePart(goodHeader(keys))}.${encodePart(fullClaims(T0))}`;
      const mac = createHmac("sha256", JSON.stringify(keys.publicJwk))
        .update(input)
        .digest("base64url");
      expect(await verifier.verifySession(`${input}.${mac}`, T0)).toBeUndefined();
    });
  });
});

describe("the header", () => {
  it.each([
    ["a lowercase typ", "jwt"],
    ["an access token typ", "at+jwt"],
    ["a numeric typ", 1],
    ["a missing typ", undefined],
    ["a null typ", null],
  ])("refuses %s even with a valid signature", async (_name, typ) => {
    const { keys, verifier } = await offline();
    const header: Record<string, unknown> = { alg: "ES256", kid: keys.publicJwk.kid };
    if (typ !== undefined) header["typ"] = typ;
    const token = await craftToken(keys, header, fullClaims(T0));
    expect(await verifier.verifySession(token, T0)).toBeUndefined();
  });

  it.each([
    ["a missing kid", undefined],
    ["a numeric kid", 7],
    ["a null kid", null],
    ["an empty kid", ""],
    ["an array kid", ["x"]],
  ])("refuses %s even with a valid signature", async (_name, kid) => {
    const { keys, verifier } = await offline();
    const header: Record<string, unknown> = { alg: "ES256", typ: "JWT" };
    if (kid !== undefined) header["kid"] = kid;
    const token = await craftToken(keys, header, fullClaims(T0));
    expect(await verifier.verifySession(token, T0)).toBeUndefined();
  });

  it("does not follow a jku, x5u or jwk header: only the configured keys count", async () => {
    const { keys, verifier } = await offline();
    const attacker = await testKeys();
    const header = {
      alg: "ES256",
      typ: "JWT",
      kid: keys.publicJwk.kid,
      jku: "https://evil.example/jwks.json",
      jwk: attacker.publicJwk,
    };
    const token = await craftToken(attacker, header, fullClaims(T0));
    expect(await verifier.verifySession(token, T0)).toBeUndefined();
  });
});

describe("the claims", () => {
  async function verifiedWith(
    overrides: Record<string, unknown>,
    options: Partial<SessionVerifierOptions> = {},
    now: Date = T0,
  ) {
    const { keys, verifier } = await offline(options);
    const token = await craftToken(keys, goodHeader(keys), fullClaims(T0, overrides));
    return verifier.verifySession(token, now);
  }

  it("accepts a token whose claims are all right (the baseline of the refusals below)", async () => {
    expect(await verifiedWith({})).toMatchObject({ sub: "user-1", iss: ISSUER, aud: "meltemi" });
  });

  it("refuses another issuer", async () => {
    expect(await verifiedWith({ iss: "https://evil.example" })).toBeUndefined();
    expect(await verifiedWith({ iss: "http://localhost:8787" })).toBeUndefined();
    expect(await verifiedWith({ iss: `${ISSUER}/` })).toBeUndefined();
    expect(await verifiedWith({ iss: ISSUER.toUpperCase() })).toBeUndefined();
  });

  it("requires the token's iss to equal the issuer option, which may carry a trailing slash", async () => {
    expect(
      await verifiedWith({ iss: "http://localhost:8787" }, { issuer: "http://localhost:8787" }),
    ).toMatchObject({ iss: "http://localhost:8787" });
    expect(await verifiedWith({}, { issuer: "http://localhost:8787" })).toBeUndefined();
    expect(await verifiedWith({}, { issuer: `${ISSUER}/` })).toMatchObject({ iss: ISSUER });
  });

  it("refuses another audience", async () => {
    expect(await verifiedWith({ aud: "other" })).toBeUndefined();
    expect(await verifiedWith({ aud: "Meltemi" })).toBeUndefined();
    expect(await verifiedWith({ aud: ["meltemi"] })).toBeUndefined();
  });

  describe("time", () => {
    const iat = Math.floor(T0.getTime() / 1000);

    it("accepts a token sixty seconds past exp and refuses it a second later", async () => {
      const exp = iat + THIRTY_DAYS_SECONDS;
      expect(await verifiedWith({}, {}, new Date((exp + 60) * 1000))).toBeDefined();
      expect(await verifiedWith({}, {}, new Date((exp + 60) * 1000 + 999))).toBeDefined();
      expect(await verifiedWith({}, {}, new Date((exp + 61) * 1000))).toBeUndefined();
    });

    it("refuses an expired token whatever else is right", async () => {
      expect(await verifiedWith({}, {}, after(31 * DAY))).toBeUndefined();
      expect(await verifiedWith({ exp: iat - 61 })).toBeUndefined();
      expect(await verifiedWith({ exp: iat - 60 })).toBeDefined();
    });

    it("refuses an iat more than sixty seconds in the future", async () => {
      expect(await verifiedWith({ iat: iat + 60 })).toBeDefined();
      expect(await verifiedWith({ iat: iat + 61 })).toBeUndefined();
      expect(await verifiedWith({ iat: iat + 86_400 })).toBeUndefined();
    });

    it("measures the leeway from the clock it is given, not from the real one", async () => {
      const { keys, verifier } = await offline();
      const token = await signSessionToken({ sub: "u1" }, keys, T0);
      expect(await verifier.verifySession(token, after(-61 * SECOND))).toBeUndefined();
      expect(await verifier.verifySession(token, after(-60 * SECOND))).toBeDefined();
    });
  });

  describe("missing and mistyped claims", () => {
    it.each([
      "iss",
      "aud",
      "sub",
      "sid",
      "name",
      "picture",
      "email",
      "email_verified",
      "iat",
      "exp",
    ])("refuses a token without %s", async (claim) => {
      const { keys, verifier } = await offline();
      const claims = fullClaims(T0);
      delete claims[claim];
      const token = await craftToken(keys, goodHeader(keys), claims);
      expect(await verifier.verifySession(token, T0)).toBeUndefined();
    });

    it.each<[string, unknown]>([
      ["sub", 42],
      ["sub", ""],
      ["sub", null],
      ["sid", ""],
      ["sid", null],
      ["sid", 7],
      ["name", 7],
      ["name", null],
      ["picture", null],
      ["picture", {}],
      ["email", false],
      ["email", null],
      ["email_verified", "true"],
      ["email_verified", 1],
      ["email_verified", null],
      ["iat", "1760443200"],
      ["iat", null],
      ["iat", true],
      ["exp", "9999999999"],
      ["exp", null],
      ["exp", [1]],
    ])("refuses %s set to %j", async (claim, value) => {
      const { keys, verifier } = await offline();
      const token = await craftToken(keys, goodHeader(keys), fullClaims(T0, { [claim]: value }));
      expect(await verifier.verifySession(token, T0)).toBeUndefined();
    });

    it("refuses a payload that is not an object of claims", async () => {
      const { keys, verifier } = await offline();
      for (const payload of [[], null, "claims", 7, [fullClaims(T0)]]) {
        const token = await craftToken(keys, goodHeader(keys), payload);
        expect(await verifier.verifySession(token, T0)).toBeUndefined();
      }
    });
  });
});

describe("malformed tokens", () => {
  const keysPromise = testKeys();

  async function signedWithParts(header: string, payload: string): Promise<string> {
    const keys = await keysPromise;
    const signing = (await craftToken(keys, goodHeader(keys), fullClaims(T0))).split(".")[2]!;
    return `${header}.${payload}.${signing}`;
  }

  it("answers undefined, never an exception, for text that is not a token", async () => {
    const keys = await keysPromise;
    const verifier = sessionVerifier({ jwks: testJwks(keys), checkSession: false });
    const good = await craftToken(keys, goodHeader(keys), fullClaims(T0));
    const [header, payload, signature] = good.split(".") as [string, string, string];
    const junk: [string, string][] = [
      ["an empty string", ""],
      ["one part", "abc"],
      ["two parts", `${header}.${payload}`],
      ["four parts", `${good}.extra`],
      ["only dots", ".."],
      ["bad base64 in every part", "!!!.###.$$$"],
      ["padding characters", `${header}=.${payload}.${signature}`],
      ["a standard base64 plus sign", `${header}.${payload}+.${signature}`],
      ["a header that is not JSON", `${base64url(utf8("not json"))}.${payload}.${signature}`],
      ["a header that is an array", `${encodePart(["ES256"])}.${payload}.${signature}`],
      ["a header that is null", `${encodePart(null)}.${payload}.${signature}`],
      ["a payload that is not JSON", `${header}.${base64url(utf8("{broken"))}.${signature}`],
      ["a payload that is an array", `${header}.${encodePart([1, 2])}.${signature}`],
      ["a payload that is null", `${header}.${encodePart(null)}.${signature}`],
      ["a one-character part", `${header}.${payload}.A`],
      ["an empty signature", `${header}.${payload}.`],
      ["a short signature", `${header}.${payload}.${signature.slice(0, 40)}`],
      ["a long signature", `${header}.${payload}.${signature}${signature}`],
      ["a zero signature", `${header}.${payload}.${base64url(new Uint8Array(64))}`],
      ["a whitespace token", "   "],
      ["a bearer prefix", `Bearer ${good}`],
      ["quotes around the token", `"${good}"`],
      ["a newline in the token", `${header}\n.${payload}.${signature}`],
    ];
    for (const [name, token] of junk) {
      expect(await verifier.verifySession(token, T0), name).toBeUndefined();
    }
    // The control: the untouched token passes, so every refusal above came from its own change.
    expect(await verifier.verifySession(good, T0)).toBeDefined();
  });

  it("answers undefined when the token is not even a string", async () => {
    const keys = await keysPromise;
    const verifier = sessionVerifier({ jwks: testJwks(keys), checkSession: false });
    for (const value of [undefined, null, 42, {}, ["a.b.c"]]) {
      expect(await verifier.verifySession(value as unknown as string, T0)).toBeUndefined();
    }
  });

  it("refuses a header and payload that are valid base64url of valid JSON but unsigned", async () => {
    const keys = await keysPromise;
    const verifier = sessionVerifier({ jwks: testJwks(keys), checkSession: false });
    const token = await signedWithParts(
      encodePart(goodHeader(keys)),
      encodePart(fullClaims(T0, { sub: "someone-else" })),
    );
    expect(await verifier.verifySession(token, T0)).toBeUndefined();
  });

  describe("size", () => {
    async function tokenWithNameOf(n: number): Promise<string> {
      const keys = await keysPromise;
      return signSessionToken({ sub: "user-1", name: "n".repeat(n) }, keys, T0);
    }

    it("accepts a token of 4096 characters or fewer and refuses a longer one", async () => {
      const keys = await keysPromise;
      const verifier = sessionVerifier({ jwks: testJwks(keys), checkSession: false });
      let n = Math.floor(((4096 - (await tokenWithNameOf(0)).length) * 3) / 4);
      while ((await tokenWithNameOf(n + 1)).length <= 4096) n++;
      while ((await tokenWithNameOf(n)).length > 4096) n--;

      const fits = await tokenWithNameOf(n);
      const tooLong = await tokenWithNameOf(n + 1);
      expect(fits.length).toBeLessThanOrEqual(4096);
      expect(fits.length).toBeGreaterThan(4090);
      expect(tooLong.length).toBeGreaterThan(4096);
      expect((await verifier.verifySession(fits, T0))?.name).toHaveLength(n);
      expect(await verifier.verifySession(tooLong, T0)).toBeUndefined();
    });

    it("refuses a huge token without reading it or looking up a key", async () => {
      const keys = await keysPromise;
      const jwks = vi.fn(async () => testJwks(keys));
      const verifier = sessionVerifier({ jwks, checkSession: false });
      const huge = await tokenWithNameOf(50_000);
      expect(await verifier.verifySession(huge, T0)).toBeUndefined();
      expect(jwks).not.toHaveBeenCalled();
    });
  });
});

describe("the key set", () => {
  describe("the entries it uses", () => {
    /** A JWKS whose single entry is the real key altered by `change`. */
    async function withEntry(change: Record<string, unknown>) {
      const keys = await testKeys();
      const entry: Record<string, unknown> = { ...keys.publicJwk, ...change };
      for (const [name, value] of Object.entries(change))
        if (value === undefined) delete entry[name];
      const verifier = sessionVerifier({ jwks: { keys: [entry] }, checkSession: false });
      const token = await signSessionToken({ sub: "u1" }, keys, T0);
      return verifier.verifySession(token, T0);
    }

    it.each<[string, Record<string, unknown>]>([
      ["kty RSA", { kty: "RSA" }],
      ["kty oct", { kty: "oct" }],
      ["a missing kty", { kty: undefined }],
      ["crv P-384", { crv: "P-384" }],
      ["crv secp256k1", { crv: "secp256k1" }],
      ["a missing crv", { crv: undefined }],
      ["use enc", { use: "enc" }],
      ["a missing use", { use: undefined }],
      ["alg RS256", { alg: "RS256" }],
      ["alg ES384", { alg: "ES384" }],
      ["alg HS256", { alg: "HS256" }],
      ["x that is not a string", { x: 7 }],
      ["y that is not a string", { y: null }],
      ["a missing x", { x: undefined }],
      ["x that is not a point on the curve", { x: "AAAA" }],
    ])("ignores an entry with %s", async (_name, change) => {
      expect(await withEntry(change)).toBeUndefined();
    });

    it("uses an entry that names sig, with ES256 or without any alg, and only such entries", async () => {
      expect(await withEntry({ use: "sig", alg: "ES256" })).toBeDefined();
      expect(await withEntry({ use: "sig", alg: undefined })).toBeDefined();
      // "use sig (and alg ES256 when present)": alg is optional, use is not.
      expect(await withEntry({ use: undefined, alg: "ES256" })).toBeUndefined();
      expect(await withEntry({ use: undefined, alg: undefined })).toBeUndefined();
    });

    it("lets an ignored entry with the same kid step aside for a good one", async () => {
      const keys = await testKeys();
      const bad = { ...keys.publicJwk, use: "enc" };
      const verifier = sessionVerifier({
        jwks: { keys: [bad, keys.publicJwk] },
        checkSession: false,
      });
      const token = await signSessionToken({ sub: "u1" }, keys, T0);
      expect((await verifier.verifySession(token, T0))?.sub).toBe("u1");
    });

    it("skips entries that are not objects instead of failing on them", async () => {
      const keys = await testKeys();
      const garbage = [null, "key", 7, true, [], undefined];
      const verifier = sessionVerifier({
        jwks: { keys: [...garbage, keys.publicJwk] } as unknown as JsonWebKeySet,
        checkSession: false,
      });
      const token = await signSessionToken({ sub: "u1" }, keys, T0);
      expect((await verifier.verifySession(token, T0))?.sub).toBe("u1");
    });

    it("does not take a private key's d along: it verifies with the public part only", async () => {
      const keys = await testKeys();
      const verifier = sessionVerifier({ jwks: { keys: [keys.privateJwk] }, checkSession: false });
      const token = await signSessionToken({ sub: "u1" }, keys, T0);
      expect((await verifier.verifySession(token, T0))?.sub).toBe("u1");
    });
  });

  describe("what a JWKS answer may be", () => {
    it.each<[string, unknown]>([
      ["null", null],
      ["an empty object", {}],
      ["keys that is not an array", { keys: "none" }],
      ["an array", []],
      ["a string", "keys"],
    ])("treats %s as no keys", async (_name, jwks) => {
      const keys = await testKeys();
      const verifier = sessionVerifier({ jwks: () => jwks as JsonWebKeySet, checkSession: false });
      const token = await signSessionToken({ sub: "u1" }, keys, T0);
      expect(await verifier.verifySession(token, T0)).toBeUndefined();
    });

    it("holds several keys at once, each by its kid", async () => {
      const [a, b, c] = [await testKeys(), await testKeys(), await testKeys()];
      const verifier = sessionVerifier({
        jwks: { keys: [a.publicJwk, b.publicJwk] },
        checkSession: false,
      });
      expect(
        (await verifier.verifySession(await signSessionToken({ sub: "a" }, a, T0), T0))?.sub,
      ).toBe("a");
      expect(
        (await verifier.verifySession(await signSessionToken({ sub: "b" }, b, T0), T0))?.sub,
      ).toBe("b");
      expect(
        await verifier.verifySession(await signSessionToken({ sub: "c" }, c, T0), T0),
      ).toBeUndefined();
    });

    it("refuses a token whose kid names one key and whose signature is another key's", async () => {
      const real = await testKeys();
      const other = await testKeys();
      const verifier = sessionVerifier({ jwks: testJwks(real), checkSession: false });
      const token = await craftWithKid(other, real.publicJwk.kid, fullClaims(T0));
      expect(await verifier.verifySession(token, T0)).toBeUndefined();
    });
  });

  describe("given as an address", () => {
    it("fetches it with the given fetch, once for two verifications", async () => {
      const { service, verifier, token } = await fixture();
      await verifier.verifySession(token, T0);
      await verifier.verifySession(token, after(MINUTE));
      expect(service.jwksCalls()).toBe(1);
      expect(service.calls[0]).toBe(`GET ${JWKS_URL}`);
    });

    it("fetches it again once cacheMs has passed", async () => {
      const { service, verifier, token } = await fixture({ cacheMs: 10 * MINUTE });
      await verifier.verifySession(token, T0);
      await verifier.verifySession(token, after(10 * MINUTE - 1));
      expect(service.jwksCalls()).toBe(1);
      await verifier.verifySession(token, after(10 * MINUTE));
      expect(service.jwksCalls()).toBe(2);
    });

    it("keeps the key set an hour by default", async () => {
      const { service, verifier, token } = await fixture();
      await verifier.verifySession(token, T0);
      await verifier.verifySession(token, after(HOUR - 1));
      expect(service.jwksCalls()).toBe(1);
      await verifier.verifySession(token, after(HOUR));
      expect(service.jwksCalls()).toBe(2);
    });

    it("keeps using the old keys when a refresh fails", async () => {
      const { service, verifier, token } = await fixture();
      await verifier.verifySession(token, T0);
      service.jwksThrows = true;
      expect((await verifier.verifySession(token, after(2 * HOUR)))?.sub).toBe("user-1");
    });

    it("answers undefined when the first fetch fails, and works once the address does", async () => {
      const { service, verifier, token } = await fixture();
      service.jwksThrows = true;
      expect(await verifier.verifySession(token, T0)).toBeUndefined();
      service.jwksThrows = false;
      expect((await verifier.verifySession(token, T0))?.sub).toBe("user-1");
    });

    it.each([404, 500, 503])("answers undefined when the address answers %i", async (status) => {
      const { service, verifier, token } = await fixture();
      service.jwksStatus = status;
      expect(await verifier.verifySession(token, T0)).toBeUndefined();
      service.jwksStatus = 200;
      expect((await verifier.verifySession(token, T0))?.sub).toBe("user-1");
    });

    it("answers undefined when the address answers something that is not JSON", async () => {
      const { service, verifier, token } = await fixture();
      service.jwksBody = "<html>maintenance</html>";
      expect(await verifier.verifySession(token, T0)).toBeUndefined();
    });

    it("does not call the session check when there are no keys", async () => {
      const { service, verifier, token } = await fixture();
      service.jwksThrows = true;
      await verifier.verifySession(token, T0);
      expect(service.sessionCalls()).toBe(0);
    });

    it("uses globalThis.fetch when no fetch is given", async () => {
      const keys = await testKeys();
      const service = fakeService(testJwks(keys));
      vi.stubGlobal("fetch", service.fetch);
      const verifier = sessionVerifier({ jwks: JWKS_URL });
      const token = await signSessionToken({ sub: "u1" }, keys, T0);
      expect((await verifier.verifySession(token, T0))?.sub).toBe("u1");
      expect(service.calls).toEqual([
        `GET ${JWKS_URL}`,
        expect.stringMatching(/^GET https:\/\/id\.meltemi\.dev\/sessions\//),
      ]);
    });
  });

  describe("given as a function", () => {
    it("calls it once for two verifications, and again after cacheMs", async () => {
      const keys = await testKeys();
      const jwks = vi.fn(async () => testJwks(keys));
      const verifier = sessionVerifier({ jwks, checkSession: false, cacheMs: 5 * MINUTE });
      const token = await signSessionToken({ sub: "u1" }, keys, T0);
      await verifier.verifySession(token, T0);
      await verifier.verifySession(token, after(MINUTE));
      expect(jwks).toHaveBeenCalledTimes(1);
      await verifier.verifySession(token, after(5 * MINUTE));
      expect(jwks).toHaveBeenCalledTimes(2);
    });

    it("accepts a function that answers at once, without a promise", async () => {
      const keys = await testKeys();
      const verifier = sessionVerifier({ jwks: () => testJwks(keys), checkSession: false });
      const token = await signSessionToken({ sub: "u1" }, keys, T0);
      expect((await verifier.verifySession(token, T0))?.sub).toBe("u1");
    });

    it("answers undefined when the function throws or rejects, and recovers", async () => {
      const keys = await testKeys();
      let failing: "throw" | "reject" | undefined = "throw";
      const verifier = sessionVerifier({
        jwks: () => {
          if (failing === "throw") throw new Error("keys are unavailable");
          if (failing === "reject") return Promise.reject(new Error("keys are unavailable"));
          return testJwks(keys);
        },
        checkSession: false,
      });
      const token = await signSessionToken({ sub: "u1" }, keys, T0);
      expect(await verifier.verifySession(token, T0)).toBeUndefined();
      failing = "reject";
      expect(await verifier.verifySession(token, T0)).toBeUndefined();
      failing = undefined;
      expect((await verifier.verifySession(token, T0))?.sub).toBe("u1");
    });
  });

  describe("given inline", () => {
    it("never fetches anything for the keys, however old, and an unknown kid costs nothing", async () => {
      const keys = await testKeys();
      const service = fakeService(testJwks(keys));
      const verifier = sessionVerifier({
        jwks: testJwks(keys),
        fetch: service.fetch,
        checkSession: false,
      });
      const token = await signSessionToken({ sub: "u1" }, keys, T0);
      expect((await verifier.verifySession(token, T0))?.sub).toBe("u1");
      expect((await verifier.verifySession(token, after(3 * HOUR)))?.sub).toBe("u1");
      for (let i = 0; i < 5; i++) {
        const stranger = await craftWithKid(keys, `unknown-${i}`, fullClaims(T0));
        expect(
          await verifier.verifySession(stranger, after(3 * HOUR + i * 2 * MINUTE)),
        ).toBeUndefined();
      }
      expect(service.calls).toEqual([]);
    });
  });

  describe("unknown kids", () => {
    it("fetches the key set once more for ten unknown kids within a minute", async () => {
      const { keys, service, verifier, token } = await fixture();
      expect(await verifier.verifySession(token, T0)).toBeDefined();
      expect(service.jwksCalls()).toBe(1);

      const at = after(61 * SECOND);
      const strangers = await Promise.all(
        Array.from({ length: 10 }, (_, i) => craftWithKid(keys, `unknown-kid-${i}`)),
      );
      for (const stranger of strangers) {
        expect(await verifier.verifySession(stranger, at)).toBeUndefined();
      }
      expect(service.jwksCalls()).toBe(2);
    });

    it("keeps to one fetch a minute across a minute of unknown kids, then allows the next", async () => {
      const { keys, service, verifier, token } = await fixture();
      await verifier.verifySession(token, T0);

      const strangers = await Promise.all(
        Array.from({ length: 12 }, (_, i) => craftWithKid(keys, `unknown-kid-${i}`)),
      );
      // One a second from 61 s to 72 s after the first fetch: all inside one minute of the refetch.
      for (const [i, stranger] of strangers.entries()) {
        expect(
          await verifier.verifySession(stranger, after(61 * SECOND + i * SECOND)),
        ).toBeUndefined();
      }
      expect(service.jwksCalls()).toBe(2);

      expect(
        await verifier.verifySession(strangers[0]!, after(61 * SECOND + MINUTE)),
      ).toBeUndefined();
      expect(service.jwksCalls()).toBe(3);
    });

    it("fetches once more, not ten times, for ten unknown kids in the first minute after the fetch", async () => {
      const { keys, service, verifier, token } = await fixture();
      await verifier.verifySession(token, T0);
      expect(service.jwksCalls()).toBe(1);
      for (let i = 0; i < 10; i++) {
        const stranger = await craftWithKid(keys, `unknown-kid-${i}`);
        expect(await verifier.verifySession(stranger, after(i * 5 * SECOND))).toBeUndefined();
      }
      // The first unknown kid looked again at once; the other nine waited for the minute.
      expect(service.jwksCalls()).toBe(2);
    });

    it("does not look again for the unknown kid of the very verification that loaded the key set", async () => {
      const { keys, service, verifier } = await fixture();
      const stranger = await craftWithKid(keys, "unknown-kid");
      expect(await verifier.verifySession(stranger, T0)).toBeUndefined();
      expect(service.jwksCalls()).toBe(1);
      // The next unknown kid, a moment later, is the first to look again.
      expect(
        await verifier.verifySession(await craftWithKid(keys, "another"), after(SECOND)),
      ).toBeUndefined();
      expect(service.jwksCalls()).toBe(2);
    });

    it("loads the key set once when ten unknown kids arrive together on a cold verifier", async () => {
      const { keys, service, verifier } = await fixture();
      const strangers = await Promise.all(
        Array.from({ length: 10 }, (_, i) => craftWithKid(keys, `unknown-kid-${i}`)),
      );
      const results = await Promise.all(strangers.map((t) => verifier.verifySession(t, T0)));
      expect(results.every((claims) => claims === undefined)).toBe(true);
      expect(service.jwksCalls()).toBe(1);
    });

    it("fetches once for ten unknown kids that arrive together after the minute", async () => {
      const { keys, service, verifier, token } = await fixture();
      await verifier.verifySession(token, T0);
      const strangers = await Promise.all(
        Array.from({ length: 10 }, (_, i) => craftWithKid(keys, `unknown-kid-${i}`)),
      );
      const results = await Promise.all(
        strangers.map((t) => verifier.verifySession(t, after(61 * SECOND))),
      );
      expect(results.every((claims) => claims === undefined)).toBe(true);
      expect(service.jwksCalls()).toBe(2);
    });

    it("makes no session check for a token that is refused", async () => {
      const { keys, service, verifier } = await fixture();
      await verifier.verifySession(await craftWithKid(keys, "unknown", fullClaims(T0)), T0);
      expect(service.sessionCalls()).toBe(0);
    });
  });

  describe("a rotated key", () => {
    it("refetches once and verifies the new token", async () => {
      const { keys, service, verifier, token } = await fixture();
      const rotated = await testKeys();
      expect(await verifier.verifySession(token, T0)).toBeDefined();
      expect(service.jwksCalls()).toBe(1);

      service.jwks = { keys: [rotated.publicJwk, keys.publicJwk] };
      const at = after(61 * SECOND);
      const fresh = await signSessionToken({ sub: "user-2" }, rotated, at);
      expect((await verifier.verifySession(fresh, at))?.sub).toBe("user-2");
      expect(service.jwksCalls()).toBe(2);

      // Both keys are published now: the old token still verifies, and nothing is fetched again.
      expect((await verifier.verifySession(token, at))?.sub).toBe("user-1");
      expect((await verifier.verifySession(fresh, at))?.sub).toBe("user-2");
      expect(service.jwksCalls()).toBe(2);
    });

    it("picks up a key published a moment after the last fetch at once: the first unknown kid looks again", async () => {
      const { service, verifier, token } = await fixture();
      const rotated = await testKeys();
      await verifier.verifySession(token, T0);
      service.jwks = { keys: [rotated.publicJwk] };
      const early = after(30 * SECOND);
      const fresh = await signSessionToken({ sub: "user-2" }, rotated, early);
      expect((await verifier.verifySession(fresh, early))?.sub).toBe("user-2");
      expect(service.jwksCalls()).toBe(2);
    });

    it("waits for the minute before it looks again for the next rotation", async () => {
      const { keys, service, verifier, token } = await fixture();
      const second = await testKeys();
      const third = await testKeys();
      await verifier.verifySession(token, T0);

      service.jwks = { keys: [second.publicJwk, keys.publicJwk] };
      const t1 = after(10 * SECOND);
      expect(
        (await verifier.verifySession(await signSessionToken({ sub: "u2" }, second, t1), t1))?.sub,
      ).toBe("u2");
      expect(service.jwksCalls()).toBe(2);

      // Another rotation 20 seconds later: refused until a minute has passed since the last look.
      service.jwks = { keys: [third.publicJwk, second.publicJwk, keys.publicJwk] };
      const t2 = after(30 * SECOND);
      const early = await signSessionToken({ sub: "u3" }, third, t2);
      expect(await verifier.verifySession(early, t2)).toBeUndefined();
      expect(service.jwksCalls()).toBe(2);
      const t3 = after(10 * SECOND + MINUTE);
      expect((await verifier.verifySession(early, t3))?.sub).toBe("u3");
      expect(service.jwksCalls()).toBe(3);
    });

    it("stops accepting a key the service stopped publishing once the key set is refreshed", async () => {
      const { keys, service, verifier, token } = await fixture();
      const rotated = await testKeys();
      await verifier.verifySession(token, T0);
      service.jwks = { keys: [rotated.publicJwk] };
      expect(await verifier.verifySession(token, after(HOUR))).toBeUndefined();
      expect(keys.publicJwk.kid).not.toBe(rotated.publicJwk.kid);
    });
  });
});

describe("the session check", () => {
  it("is a GET of <issuer>/sessions/<sid>, with the sid in the path", async () => {
    const { service, verifier, token } = await fixture();
    const claims = await verifier.verifySession(token, T0);
    expect(service.calls.filter((c) => c.includes("/sessions/"))).toEqual([
      `GET ${ISSUER}/sessions/${claims!.sid}`,
    ]);
  });

  it("goes to the issuer option, without a doubled slash when it ends with one", async () => {
    const keys = await testKeys();
    const seen: string[] = [];
    const fetchStub: typeof fetch = async (input) => {
      seen.push(String(input));
      return new Response(null, { status: 204 });
    };
    const verifier = sessionVerifier({
      issuer: "http://localhost:8787/",
      jwks: testJwks(keys),
      fetch: fetchStub,
    });
    const token = await signSessionToken(
      { sub: "u1", iss: "http://localhost:8787", sid: "abc" },
      keys,
      T0,
    );
    expect((await verifier.verifySession(token, T0))?.sub).toBe("u1");
    expect(seen).toEqual(["http://localhost:8787/sessions/abc"]);
  });

  it("is skipped with checkSession false", async () => {
    const { service, verifier, token } = await fixture({ checkSession: false });
    expect((await verifier.verifySession(token, T0))?.sub).toBe("user-1");
    expect(service.sessionCalls()).toBe(0);
  });

  it("is made with checkSession true, as by default", async () => {
    const { service, verifier, token } = await fixture({ checkSession: true });
    await verifier.verifySession(token, T0);
    expect(service.sessionCalls()).toBe(1);
  });

  describe("when the service says the session is gone", () => {
    it("answers undefined on a 404, and remembers it as denied for the hour", async () => {
      const { service, verifier, token } = await fixture();
      service.sessionStatus = 404;
      expect(await verifier.verifySession(token, T0)).toBeUndefined();
      service.sessionStatus = 204;
      expect(await verifier.verifySession(token, after(30 * MINUTE))).toBeUndefined();
      expect(service.sessionCalls()).toBe(1);
      expect((await verifier.verifySession(token, after(HOUR)))?.sub).toBe("user-1");
      expect(service.sessionCalls()).toBe(2);
    });

    it("sees a revocation an hour after a successful verification", async () => {
      const { service, verifier, token } = await fixture();
      expect(await verifier.verifySession(token, T0)).toBeDefined();
      service.sessionStatus = 404;
      expect(await verifier.verifySession(token, after(HOUR - 1))).toBeDefined();
      expect(await verifier.verifySession(token, after(HOUR))).toBeUndefined();
      expect(service.sessionCalls()).toBe(2);
    });
  });

  describe("when the check fails", () => {
    it("answers undefined when the fetch throws, and does not keep the failure as a success", async () => {
      const { service, verifier, token } = await fixture();
      service.sessionThrows = true;
      expect(await verifier.verifySession(token, T0)).toBeUndefined();
      service.sessionThrows = false;
      expect((await verifier.verifySession(token, after(SECOND)))?.sub).toBe("user-1");
      expect(service.sessionCalls()).toBe(2);
    });

    it("does not keep a throw as a denial either: the next verification asks again", async () => {
      const { service, verifier, token } = await fixture();
      service.sessionThrows = true;
      await verifier.verifySession(token, T0);
      await verifier.verifySession(token, after(SECOND));
      expect(service.sessionCalls()).toBe(2);
    });

    it.each([500, 502, 503, 429, 401, 403, 200, 301])(
      "answers undefined on a %i and does not keep it",
      async (status) => {
        const { service, verifier, token } = await fixture();
        service.sessionStatus = status;
        expect(await verifier.verifySession(token, T0)).toBeUndefined();
        service.sessionStatus = 204;
        expect((await verifier.verifySession(token, after(SECOND)))?.sub).toBe("user-1");
        expect(service.sessionCalls()).toBe(2);
      },
    );

    it("shares one check between verifications that start together, and keeps a failure of it from none of them", async () => {
      const { keys } = await offline();
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let failing = true;
      const check = vi.fn(async (_sid: string) => {
        await gate;
        if (failing) throw new Error("the service is unreachable");
        return true;
      });
      const verifier = sessionVerifier({ jwks: testJwks(keys), checkSession: check });
      const token = await signSessionToken({ sub: "u1" }, keys, T0);

      const together = Array.from({ length: 5 }, () => verifier.verifySession(token, T0));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(check).toHaveBeenCalledTimes(1);
      release();
      expect((await Promise.all(together)).every((claims) => claims === undefined)).toBe(true);

      // Nothing was kept from the failure: the next verification asks again, and succeeds.
      failing = false;
      expect((await verifier.verifySession(token, T0))?.sub).toBe("u1");
      expect(check).toHaveBeenCalledTimes(2);
    });

    it("shares one successful check between verifications that start together", async () => {
      const { keys } = await offline();
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const check = vi.fn(async (_sid: string) => {
        await gate;
        return true;
      });
      const verifier = sessionVerifier({ jwks: testJwks(keys), checkSession: check });
      const token = await signSessionToken({ sub: "u1" }, keys, T0);
      const together = Array.from({ length: 5 }, () => verifier.verifySession(token, T0));
      await new Promise((resolve) => setTimeout(resolve, 50));
      release();
      const results = await Promise.all(together);
      expect(results.every((claims) => claims?.sub === "u1")).toBe(true);
      expect(check).toHaveBeenCalledTimes(1);
    });
  });

  describe("given as a function", () => {
    it("receives the sid and decides", async () => {
      const { keys } = await offline();
      const seen: string[] = [];
      const verifier = sessionVerifier({
        jwks: testJwks(keys),
        checkSession: async (sid) => {
          seen.push(sid);
          return sid === "live";
        },
      });
      const live = await signSessionToken({ sub: "u1", sid: "live" }, keys, T0);
      const dead = await signSessionToken({ sub: "u1", sid: "dead" }, keys, T0);
      expect((await verifier.verifySession(live, T0))?.sid).toBe("live");
      expect(await verifier.verifySession(dead, T0)).toBeUndefined();
      expect(seen).toEqual(["live", "dead"]);
    });

    it("is asked once per hour per session, a denial included", async () => {
      const { keys } = await offline();
      const check = vi.fn(async (sid: string) => sid === "live");
      const verifier = sessionVerifier({ jwks: testJwks(keys), checkSession: check });
      const live = await signSessionToken({ sub: "u1", sid: "live" }, keys, T0);
      const dead = await signSessionToken({ sub: "u1", sid: "dead" }, keys, T0);
      for (const at of [0, 10 * MINUTE, HOUR - 1]) {
        await verifier.verifySession(live, after(at));
        await verifier.verifySession(dead, after(at));
      }
      expect(check).toHaveBeenCalledTimes(2);
      await verifier.verifySession(live, after(HOUR));
      expect(check).toHaveBeenCalledTimes(3);
    });

    it("makes the session invalid when it throws or rejects, without keeping that", async () => {
      const { keys } = await offline();
      let mode: "throw" | "reject" | "ok" = "throw";
      const verifier = sessionVerifier({
        jwks: testJwks(keys),
        checkSession: (_sid) => {
          if (mode === "throw") throw new Error("down");
          if (mode === "reject") return Promise.reject(new Error("down"));
          return Promise.resolve(true);
        },
      });
      const token = await signSessionToken({ sub: "u1" }, keys, T0);
      expect(await verifier.verifySession(token, T0)).toBeUndefined();
      mode = "reject";
      expect(await verifier.verifySession(token, T0)).toBeUndefined();
      mode = "ok";
      expect((await verifier.verifySession(token, T0))?.sub).toBe("u1");
    });

    it("never touches the network", async () => {
      const keys = await testKeys();
      const service = fakeService(testJwks(keys));
      const verifier = sessionVerifier({
        jwks: testJwks(keys),
        fetch: service.fetch,
        checkSession: async () => true,
      });
      await verifier.verifySession(await signSessionToken({ sub: "u1" }, keys, T0), T0);
      expect(service.calls).toEqual([]);
    });
  });

  describe("the cache", () => {
    it("belongs to the verifier instance: a second verifier asks for itself", async () => {
      const keys = await testKeys();
      const service = fakeService(testJwks(keys));
      const make = () => sessionVerifier({ jwks: testJwks(keys), fetch: service.fetch });
      const token = await signSessionToken({ sub: "u1" }, keys, T0);
      const [one, two] = [make(), make()];
      await one.verifySession(token, T0);
      await one.verifySession(token, T0);
      expect(service.sessionCalls()).toBe(1);
      await two.verifySession(token, T0);
      expect(service.sessionCalls()).toBe(2);
    });

    it("is per session: two sessions of one person are two checks", async () => {
      const { keys, service, verifier } = await fixture();
      const a = await signSessionToken({ sub: "u1", sid: "sid-a" }, keys, T0);
      const b = await signSessionToken({ sub: "u1", sid: "sid-b" }, keys, T0);
      await verifier.verifySession(a, T0);
      await verifier.verifySession(b, T0);
      await verifier.verifySession(a, T0);
      await verifier.verifySession(b, T0);
      expect(service.sessionCalls()).toBe(2);
    });

    it("honours cacheMs: a shorter time asks sooner", async () => {
      const { service, verifier, token } = await fixture({ cacheMs: 1000 });
      await verifier.verifySession(token, T0);
      await verifier.verifySession(token, after(999));
      expect(service.sessionCalls()).toBe(1);
      await verifier.verifySession(token, after(1000));
      expect(service.sessionCalls()).toBe(2);
    });

    it("honours cacheMs: a longer time asks later", async () => {
      const { service, verifier, token } = await fixture({ cacheMs: 6 * HOUR });
      await verifier.verifySession(token, T0);
      await verifier.verifySession(token, after(5 * HOUR));
      expect(service.sessionCalls()).toBe(1);
      await verifier.verifySession(token, after(6 * HOUR));
      expect(service.sessionCalls()).toBe(2);
    });

    it("asks every time with a cacheMs of zero", async () => {
      const { service, verifier, token } = await fixture({ cacheMs: 0 });
      await verifier.verifySession(token, T0);
      await verifier.verifySession(token, T0);
      await verifier.verifySession(token, T0);
      expect(service.sessionCalls()).toBe(3);
    });

    it("is bounded: it forgets the oldest sessions instead of growing without limit", async () => {
      const { keys } = await offline();
      const check = vi.fn(async () => true);
      const verifier = sessionVerifier({ jwks: testJwks(keys), checkSession: check });
      const signing = await importSigningKeys(keys.privateJwk, [keys.publicJwk]);
      const tokenFor = (sid: string) => signJwt(signing, fullClaims(T0, { sid }));
      const first = await tokenFor("sid-0");
      await verifier.verifySession(first, T0);
      for (let i = 1; i <= 10_000; i++) {
        await verifier.verifySession(await tokenFor(`sid-${i}`), T0);
      }
      expect(check).toHaveBeenCalledTimes(10_001);
      await verifier.verifySession(first, T0);
      expect(check).toHaveBeenCalledTimes(10_002);
      await verifier.verifySession(await tokenFor("sid-10000"), T0);
      expect(check).toHaveBeenCalledTimes(10_002);
    }, 60_000);
  });
});

describe("parseSessionCookie", () => {
  it("returns the token among several cookies", () => {
    expect(parseSessionCookie("a=1; meltemi_session=abc.def.ghi; b=2")).toBe("abc.def.ghi");
    expect(parseSessionCookie("meltemi_session=abc.def.ghi")).toBe("abc.def.ghi");
    expect(parseSessionCookie("a=1;meltemi_session=x;b=2")).toBe("x");
  });

  it("returns undefined when the cookie is absent", () => {
    expect(parseSessionCookie(null)).toBeUndefined();
    expect(parseSessionCookie("")).toBeUndefined();
    expect(parseSessionCookie("a=1; b=2")).toBeUndefined();
    expect(parseSessionCookie("meltemi_oauth=abc")).toBeUndefined();
  });

  it("returns undefined for an empty value", () => {
    expect(parseSessionCookie("meltemi_session=")).toBeUndefined();
    expect(parseSessionCookie("a=1; meltemi_session=; b=2")).toBeUndefined();
    expect(parseSessionCookie("meltemi_session=  ")).toBeUndefined();
  });

  it("does not take a cookie whose name only ends or starts like it", () => {
    expect(parseSessionCookie("xmeltemi_session=abc")).toBeUndefined();
    expect(parseSessionCookie("meltemi_session_old=abc")).toBeUndefined();
    expect(parseSessionCookie("MELTEMI_SESSION=abc")).toBeUndefined();
  });

  it("keeps the first of a repeated cookie, and tolerates junk around it", () => {
    expect(parseSessionCookie("meltemi_session=first; meltemi_session=second")).toBe("first");
    expect(parseSessionCookie("junk; ;; =novalue; meltemi_session=abc")).toBe("abc");
    expect(parseSessionCookie("  meltemi_session = abc  ")).toBe("abc");
  });

  it("leaves a value that holds an equals sign whole", () => {
    expect(parseSessionCookie("meltemi_session=abc=def")).toBe("abc=def");
  });
});

describe("verifyEventSignature", () => {
  const secret = "events-secret-for-the-test";
  const body =
    '{"id":"evt_abc","type":"user.deleted","sub":"user-1","at":"2026-10-14T12:00:00.000Z"}';
  const sign = (key: string, text: string) => createHmac("sha256", key).update(text).digest("hex");

  it("accepts the signature of the body made with the secret", async () => {
    expect(await verifyEventSignature(secret, body, `v1=${sign(secret, body)}`)).toBe(true);
  });

  it("accepts an empty body and a body with characters outside ASCII, as signed", async () => {
    expect(await verifyEventSignature(secret, "", `v1=${sign(secret, "")}`)).toBe(true);
    const text = '{"name":"José Ñandú 日本 \u{1F600}"}';
    expect(await verifyEventSignature(secret, text, `v1=${sign(secret, text)}`)).toBe(true);
  });

  it("refuses a signature made with another secret", async () => {
    expect(await verifyEventSignature(secret, body, `v1=${sign("another-secret", body)}`)).toBe(
      false,
    );
  });

  it("refuses a tampered body", async () => {
    const header = `v1=${sign(secret, body)}`;
    expect(await verifyEventSignature(secret, body.replace("user-1", "user-2"), header)).toBe(
      false,
    );
    expect(await verifyEventSignature(secret, `${body} `, header)).toBe(false);
    expect(await verifyEventSignature(secret, "", header)).toBe(false);
  });

  it("refuses a missing or empty header", async () => {
    expect(await verifyEventSignature(secret, body, null)).toBe(false);
    expect(await verifyEventSignature(secret, body, "")).toBe(false);
  });

  it("refuses another scheme, even with the right digest", async () => {
    const digest = sign(secret, body);
    expect(await verifyEventSignature(secret, body, `v2=${digest}`)).toBe(false);
    expect(await verifyEventSignature(secret, body, `V1=${digest}`)).toBe(false);
    expect(await verifyEventSignature(secret, body, digest)).toBe(false);
    expect(await verifyEventSignature(secret, body, ` v1=${digest}`)).toBe(false);
    expect(await verifyEventSignature(secret, body, `sha256=${digest}`)).toBe(false);
  });

  it("refuses a signature that is not hexadecimal or not the right length", async () => {
    const digest = sign(secret, body);
    expect(await verifyEventSignature(secret, body, "v1=")).toBe(false);
    expect(await verifyEventSignature(secret, body, `v1=${"z".repeat(64)}`)).toBe(false);
    expect(await verifyEventSignature(secret, body, `v1=${digest.slice(0, -1)}`)).toBe(false);
    expect(await verifyEventSignature(secret, body, `v1=${digest.slice(0, 62)}`)).toBe(false);
    expect(await verifyEventSignature(secret, body, `v1=${digest}00`)).toBe(false);
    expect(await verifyEventSignature(secret, body, `v1=${digest} `)).toBe(false);
    expect(await verifyEventSignature(secret, body, `v1=${digest},v1=${digest}`)).toBe(false);
    expect(await verifyEventSignature(secret, body, `v1=${base64url(utf8(digest))}`)).toBe(false);
  });

  it("refuses a signature that flips one bit of the right one", async () => {
    const digest = sign(secret, body);
    const flipped = (parseInt(digest[0]!, 16) ^ 1).toString(16) + digest.slice(1);
    expect(await verifyEventSignature(secret, body, `v1=${flipped}`)).toBe(false);
  });

  it("compares through crypto.subtle.verify", async () => {
    const verify = vi.spyOn(crypto.subtle, "verify");
    await verifyEventSignature(secret, body, `v1=${sign(secret, body)}`);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls[0]![0]).toBe("HMAC");
  });
});

// ---------------------------------------------------------------------------------------------

describe("the verifier's own requests", () => {
  /** Fakes only the timeout timers: the real event loop still finishes the real cryptography. */
  function useTimeoutTimers() {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  }

  /** Waits (in real time) until the request under test has started its timeout timer. */
  async function timerStarted() {
    const limit = performance.now() + 2_000;
    while (vi.getTimerCount() === 0 && performance.now() < limit) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  }

  /** A fetch that never answers, and that ignores the signal it is given. */
  const hangs: typeof fetch = () => new Promise<Response>(() => {});

  it("gives up on a session check that never answers, after five seconds by default", async () => {
    useTimeoutTimers();
    try {
      const { keys } = await offline();
      const token = await signSessionToken({ sub: "u1" }, keys, T0);
      const verifier = sessionVerifier({ jwks: testJwks(keys), fetch: hangs });
      const result = verifier.verifySession(token, T0);
      let settled = false;
      void result.then(() => (settled = true));
      await timerStarted();
      await vi.advanceTimersByTimeAsync(4_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not keep a timed-out check: the next verification asks again", async () => {
    useTimeoutTimers();
    try {
      const { keys } = await offline();
      const token = await signSessionToken({ sub: "u1" }, keys, T0);
      let hanging = true;
      const calls: string[] = [];
      const fetchStub: typeof fetch = (input) => {
        calls.push(String(input));
        return hanging
          ? new Promise<Response>(() => {})
          : Promise.resolve(new Response(null, { status: 204 }));
      };
      const verifier = sessionVerifier({ jwks: testJwks(keys), fetch: fetchStub });
      const first = verifier.verifySession(token, T0);
      await timerStarted();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await first).toBeUndefined();
      hanging = false;
      expect((await verifier.verifySession(token, after(SECOND)))?.sub).toBe("u1");
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up on a key set address that never answers", async () => {
    useTimeoutTimers();
    try {
      const keys = await testKeys();
      const token = await signSessionToken({ sub: "u1" }, keys, T0);
      const verifier = sessionVerifier({ jwks: JWKS_URL, fetch: hangs, checkSession: false });
      const result = verifier.verifySession(token, T0);
      await timerStarted();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await result).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts the request through the signal it passes to fetch", async () => {
    useTimeoutTimers();
    try {
      const { keys } = await offline();
      const token = await signSessionToken({ sub: "u1" }, keys, T0);
      let signal: AbortSignal | undefined;
      const fetchStub: typeof fetch = (_input, init) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      };
      const verifier = sessionVerifier({ jwks: testJwks(keys), fetch: fetchStub });
      const result = verifier.verifySession(token, T0);
      await timerStarted();
      await vi.advanceTimersByTimeAsync(5_000);
      await result;
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("honours fetchTimeoutMs", async () => {
    useTimeoutTimers();
    try {
      const { keys } = await offline();
      const token = await signSessionToken({ sub: "u1" }, keys, T0);
      const verifier = sessionVerifier({
        jwks: testJwks(keys),
        fetch: hangs,
        fetchTimeoutMs: 250,
      });
      const result = verifier.verifySession(token, T0);
      await timerStarted();
      await vi.advanceTimersByTimeAsync(250);
      expect(await result).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves no timer behind when the answer comes in time", async () => {
    useTimeoutTimers();
    try {
      const { service, verifier, token } = await fixture();
      expect((await verifier.verifySession(token, T0))?.sub).toBe("user-1");
      expect(service.sessionCalls()).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
