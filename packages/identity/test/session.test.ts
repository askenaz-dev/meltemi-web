// The session cookie and token, the public keys and their rotation (`identity-session`: "The
// session cookie and token" and "Public keys and rotation"), and how the service itself reads a
// session back (`currentSession`). A sign-in is made through `startSession`, the code every
// completed callback runs; the keys are read from `/.well-known/jwks.json` through the handler.

import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";
import type { Ctx } from "../src/context.js";
import { fromBase64url } from "../src/crypto.js";
import { identity } from "../src/handler.js";
import { importSigningKeys, signJwt, thumbprint, type JsonWebKeySet } from "../src/jwt.js";
import {
  clearSessionCookie,
  currentSession,
  sessionCookie,
  sessionLabel,
  startSession,
} from "../src/session.js";
import { signSessionToken, testKeys } from "../src/testing.js";
import type { Deps, Identity, User } from "../src/types.js";
import { sessionVerifier } from "../src/verify.js";
import {
  harness,
  seededRandom,
  setCookieLine,
  signedInPerson,
  type Harness,
} from "./support/index.js";
import { sessionCookies, signIn as providerSignIn } from "./support/signin.js";
import {
  DAY,
  HOUR,
  MINUTE,
  THIRTY_DAYS_SECONDS,
  craftToken,
  craftWithKid,
  decodeToken,
  fullClaims,
  goodHeader,
  withClaims,
  withPayloadCharacterChanged,
} from "./support/tokens.js";

/** The development environment of `.dev.vars.example`. */
const DEV_ENV = {
  DEV: "true",
  ISSUER: "http://localhost:8787",
  SITE_URL: "http://localhost:8789",
  DEV_ORIGINS: "http://localhost:8788,http://localhost:8789",
  PRODUCTS: '[{"name":"diagrams","events":"http://localhost:8788/_identity/events"}]',
};

const EDGE_ON_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

/** A person who signs in now: the user, the identity and what `startSession` returns. */
async function signIn(
  h: Harness,
  userAgent: string | null = EDGE_ON_WINDOWS,
  overrides: Partial<User> = {},
) {
  const at = h.clock.now().toISOString();
  const user: User = {
    id: "user-1",
    name: "Ana Dev",
    picture: "https://avatars.githubusercontent.com/u/4242",
    createdAt: at,
    ...overrides,
  };
  const person: Identity = {
    provider: "github",
    providerId: "4242",
    userId: user.id,
    email: "ana@example.com",
    emailVerified: true,
    verifiedAt: at,
    handle: "ana-dev",
    linkedAt: at,
  };
  await h.store.createUser(user);
  await h.store.addIdentity(person);
  const headers: Record<string, string> = userAgent === null ? {} : { "User-Agent": userAgent };
  const started = await startSession(
    {
      deps: h.deps,
      config: readConfig(h.env),
      request: new Request(h.env.ISSUER, { headers }),
    },
    user,
    person,
  );
  return { user, identity: person, ...started };
}

/** The keys of the service as a product reads them. */
async function publishedKeys(h: Harness, deps: Deps = h.deps): Promise<JsonWebKeySet> {
  const response = await identity(
    new Request(`${h.env.ISSUER}/.well-known/jwks.json`),
    h.env,
    deps,
  );
  return (await response.json()) as JsonWebKeySet;
}

/** What a route receives, for the functions that take a context. */
function contextFor(h: Harness, cookie?: string): Ctx {
  const request = new Request(`${h.env.ISSUER}/account`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  return {
    request,
    url: new URL(request.url),
    env: h.env,
    deps: h.deps,
    config: readConfig(h.env),
    lang: "en",
    params: {},
  };
}

const attributesOf = (cookie: string) => cookie.split("; ").slice(1);

// ---------------------------------------------------------------------------------------------

describe("the session cookie", () => {
  it("carries the attributes of the production configuration", async () => {
    const h = await harness();
    const started = await signIn(h);
    expect(started.cookie).toBe(
      `meltemi_session=${started.token}; Domain=meltemi.dev; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax`,
    );
    expect(attributesOf(started.cookie)).toEqual([
      "Domain=meltemi.dev",
      "Path=/",
      "Max-Age=2592000",
      "Secure",
      "HttpOnly",
      "SameSite=Lax",
    ]);
  });

  it("reads back as the cookie of a response", async () => {
    const h = await harness();
    const started = await signIn(h);
    const response = new Response(null, { headers: { "Set-Cookie": started.cookie } });
    const line = setCookieLine(response, "meltemi_session");
    expect(line).toContain("Domain=meltemi.dev");
    expect(line).toContain("HttpOnly");
    expect(line?.startsWith(`meltemi_session=${started.token};`)).toBe(true);
  });

  it("follows COOKIE_DOMAIN", async () => {
    const h = await harness({ env: { COOKIE_DOMAIN: "family.example" } });
    const started = await signIn(h);
    expect(attributesOf(started.cookie)).toContain("Domain=family.example");
  });

  describe("in development mode", () => {
    it("has no Domain and no Secure on an http issuer, and keeps the rest", async () => {
      const h = await harness({ env: DEV_ENV });
      const started = await signIn(h);
      expect(attributesOf(started.cookie)).toEqual([
        "Path=/",
        "Max-Age=2592000",
        "HttpOnly",
        "SameSite=Lax",
      ]);
    });

    it("keeps Secure when the issuer is https, and still has no Domain", async () => {
      const h = await harness({ env: { ...DEV_ENV, ISSUER: "https://dev.example.test" } });
      const started = await signIn(h);
      expect(attributesOf(started.cookie)).toEqual([
        "Path=/",
        "Max-Age=2592000",
        "Secure",
        "HttpOnly",
        "SameSite=Lax",
      ]);
    });

    it("puts the development issuer in the token", async () => {
      const h = await harness({ env: DEV_ENV });
      const started = await signIn(h);
      expect(decodeToken(started.token).claims["iss"]).toBe("http://localhost:8787");
    });

    it("is not switched on by anything but DEV=true", async () => {
      for (const DEV of ["TRUE", "1", "yes", "false", ""]) {
        const h = await harness({ env: { DEV } });
        const started = await signIn(h);
        expect(attributesOf(started.cookie), `DEV=${DEV}`).toContain("Domain=meltemi.dev");
        expect(attributesOf(started.cookie), `DEV=${DEV}`).toContain("Secure");
      }
    });
  });

  describe("the cookie that clears it", () => {
    it("has the same attributes with Max-Age=0 and no value", async () => {
      const h = await harness();
      const config = readConfig(h.env);
      expect(clearSessionCookie(config)).toBe(
        "meltemi_session=; Domain=meltemi.dev; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax",
      );
    });

    it("matches the cookie it clears in development too", async () => {
      const h = await harness({ env: DEV_ENV });
      const config = readConfig(h.env);
      expect(clearSessionCookie(config)).toBe(
        "meltemi_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
      );
      const withoutValue = (cookie: string) =>
        attributesOf(cookie).filter((a) => !a.startsWith("Max-Age"));
      expect(withoutValue(clearSessionCookie(config))).toEqual(
        withoutValue(sessionCookie(config, "t")),
      );
    });
  });
});

describe("the token", () => {
  it("verifies with the keys of /.well-known/jwks.json and carries every claim", async () => {
    const h = await harness();
    const started = await signIn(h);
    const verifier = sessionVerifier({ jwks: await publishedKeys(h), checkSession: false });

    const claims = await verifier.verifySession(started.token, h.clock.now());
    const iat = Math.floor(h.clock.now().getTime() / 1000);
    expect(claims).toEqual({
      iss: "https://id.meltemi.dev",
      aud: "meltemi",
      sub: "user-1",
      sid: started.session.sid,
      name: "Ana Dev",
      picture: "https://avatars.githubusercontent.com/u/4242",
      email: "ana@example.com",
      email_verified: true,
      iat,
      exp: iat + 2_592_000,
    });
  });

  it("has the header of an ES256 JWT with the published kid", async () => {
    const h = await harness();
    const started = await signIn(h);
    const { header } = decodeToken(started.token);
    expect(header).toEqual({ alg: "ES256", typ: "JWT", kid: h.keys.publicJwk.kid });
    expect((await publishedKeys(h)).keys.map((k) => k["kid"])).toContain(header["kid"]);
  });

  it("takes the email and its verification from the identity used to sign in", async () => {
    const h = await harness();
    const person = await signedInPerson(h, { email: "ana@work.example", emailVerified: false });
    const { claims } = decodeToken(person.token);
    expect(claims["email"]).toBe("ana@work.example");
    expect(claims["email_verified"]).toBe(false);
  });

  it("keeps names with characters outside ASCII intact", async () => {
    const h = await harness();
    const started = await signIn(h, EDGE_ON_WINDOWS, { name: "José Ñandú 日本 \u{1F600}" });
    const verifier = sessionVerifier({ jwks: await publishedKeys(h), checkSession: false });
    expect((await verifier.verifySession(started.token, h.clock.now()))?.name).toBe(
      "José Ñandú 日本 \u{1F600}",
    );
  });

  it("stays far below the 4 KiB of a cookie, even with the longest profile a provider allows", async () => {
    const h = await harness();
    const long = "x".repeat(255);
    const started = await signIn(h, EDGE_ON_WINDOWS, {
      name: long,
      picture: `https://lh3.googleusercontent.com/${"p".repeat(200)}`,
    });
    expect(started.token.length).toBeLessThan(4096);
    expect(started.cookie.length).toBeLessThan(4096);
    const verifier = sessionVerifier({ jwks: await publishedKeys(h), checkSession: false });
    expect((await verifier.verifySession(started.token, h.clock.now()))?.name).toBe(long);
  });

  describe("a tampered token", () => {
    it("fails when one character of the payload is changed", async () => {
      const h = await harness();
      const started = await signIn(h);
      const verifier = sessionVerifier({ jwks: await publishedKeys(h), checkSession: false });
      expect(await verifier.verifySession(started.token, h.clock.now())).toBeDefined();
      const payloadLength = started.token.split(".")[1]!.length;
      for (const index of [0, 1, 10, Math.floor(payloadLength / 2), payloadLength - 2, -1]) {
        const tampered = withPayloadCharacterChanged(started.token, index);
        expect(tampered).not.toBe(started.token);
        expect(
          await verifier.verifySession(tampered, h.clock.now()),
          `index ${index}`,
        ).toBeUndefined();
      }
    });

    it("fails when a claim is replaced and the old signature kept", async () => {
      const h = await harness();
      const started = await signIn(h);
      const verifier = sessionVerifier({ jwks: await publishedKeys(h), checkSession: false });
      const { claims } = decodeToken(started.token);
      for (const change of [
        { sub: "someone-else" },
        { email: "admin@example.com" },
        { exp: (claims["exp"] as number) + 864_000 },
        { sid: "another-session" },
      ]) {
        const forged = withClaims(started.token, { ...claims, ...change });
        expect(
          await verifier.verifySession(forged, h.clock.now()),
          JSON.stringify(change),
        ).toBeUndefined();
      }
    });

    it("fails when the signature is cut short or comes from another token", async () => {
      const h = await harness();
      const first = await signIn(h);
      const second = await signedInPerson(h, { id: "user-2" });
      const verifier = sessionVerifier({ jwks: await publishedKeys(h), checkSession: false });
      const [header, payload] = first.token.split(".");
      const cut = `${header}.${payload}.${first.token.split(".")[2]!.slice(0, 60)}`;
      const swapped = `${header}.${payload}.${second.token.split(".")[2]}`;
      expect(await verifier.verifySession(cut, h.clock.now())).toBeUndefined();
      expect(await verifier.verifySession(swapped, h.clock.now())).toBeUndefined();
    });
  });
});

describe("the session row", () => {
  it("exists with the sid and the expiry of the token, live and unrevoked", async () => {
    const h = await harness();
    const started = await signIn(h);
    const { claims } = decodeToken(started.token);
    const row = await h.store.session(claims["sid"] as string);

    expect(row).toEqual(started.session);
    expect(row).toMatchObject({
      sid: claims["sid"],
      userId: "user-1",
      revokedAt: null,
      createdAt: "2026-10-14T12:00:00.000Z",
      lastSeen: "2026-10-14T12:00:00.000Z",
      label: "Edge on Windows",
    });
    expect(row?.expiresAt).toBe(new Date((claims["exp"] as number) * 1000).toISOString());
    expect(Date.parse(row!.expiresAt) - Date.parse(row!.createdAt)).toBe(
      THIRTY_DAYS_SECONDS * 1000,
    );
    expect(await h.store.sessionsOf("user-1", h.clock.now().toISOString())).toHaveLength(1);
  });

  it("has a sid of 32 random bytes in base64url, a different one for each session", async () => {
    const h = await harness();
    const first = await signIn(h);
    const second = await signedInPerson(h, { id: "user-2" });
    for (const sid of [first.session.sid, second.session.sid]) {
      expect(sid).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(fromBase64url(sid)).toHaveLength(32);
    }
    expect(first.session.sid).not.toBe(second.session.sid);
  });

  it("draws the sid from the injected randomness", async () => {
    const a = await harness();
    const b = await harness();
    const first = await signIn(a);
    const second = await signIn(b);
    expect(first.session.sid).toBe(second.session.sid); // the same seed, the same sid
  });

  it("starts at the clock of the request, to the second", async () => {
    const h = await harness({ start: "2026-03-01T08:30:15.987Z" });
    const started = await signIn(h);
    expect(started.session.createdAt).toBe("2026-03-01T08:30:15.000Z");
    expect(started.session.expiresAt).toBe("2026-03-31T08:30:15.000Z");
    expect(decodeToken(started.token).claims["iat"]).toBe(
      Date.parse("2026-03-01T08:30:15Z") / 1000,
    );
  });

  it("is a new row for each sign-in: signing in again replaces nothing", async () => {
    const h = await harness();
    const first = await signIn(h);
    const again = await startSession(
      { deps: h.deps, config: readConfig(h.env), request: new Request(h.env.ISSUER) },
      first.user,
      first.identity,
    );
    expect(again.session.sid).not.toBe(first.session.sid);
    expect(await h.store.sessionsOf("user-1", h.clock.now().toISOString())).toHaveLength(2);
  });
});

describe("the label of a session", () => {
  const UA = {
    edgeWindows: EDGE_ON_WINDOWS,
    edgeMac:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
    edgeAndroid:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0",
    edgeIos:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/130.0.0.0 Mobile/15E148 Safari/605.1.15",
    edgeLegacy:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.102 Safari/537.36 Edge/18.19041",
    chromeWindows:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    chromeMac:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    chromeLinux:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    chromeAndroid:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
    chromeIos:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1",
    firefoxWindows:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
    firefoxMac:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0",
    firefoxLinux: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
    firefoxAndroid: "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
    firefoxIos:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15",
    safariMac:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    safariIos:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    safariIpad:
      "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    operaWindows:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/114.0.0.0",
    safariConsole:
      "Mozilla/5.0 (PlayStation; PlayStation 5/2.26) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0 Safari/605.1.15",
    chromeCrOS:
      "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    curl: "curl/8.5.0",
  };

  it.each<[string, string | null, string]>([
    ["Edge on Windows", UA.edgeWindows, "Edge on Windows"],
    ["Edge on macOS", UA.edgeMac, "Edge on macOS"],
    ["Edge on Android", UA.edgeAndroid, "Edge on Android"],
    ["Edge on iOS", UA.edgeIos, "Edge on iOS"],
    ["the legacy Edge", UA.edgeLegacy, "Edge on Windows"],
    ["Chrome on Windows", UA.chromeWindows, "Chrome on Windows"],
    ["Chrome on macOS", UA.chromeMac, "Chrome on macOS"],
    ["Chrome on Linux", UA.chromeLinux, "Chrome on Linux"],
    ["Chrome on Android", UA.chromeAndroid, "Chrome on Android"],
    ["Chrome on iOS", UA.chromeIos, "Chrome on iOS"],
    ["Chrome on ChromeOS", UA.chromeCrOS, "Chrome on Linux"],
    ["Firefox on Windows", UA.firefoxWindows, "Firefox on Windows"],
    ["Firefox on macOS", UA.firefoxMac, "Firefox on macOS"],
    ["Firefox on Linux", UA.firefoxLinux, "Firefox on Linux"],
    ["Firefox on Android", UA.firefoxAndroid, "Firefox on Android"],
    ["Firefox on iOS", UA.firefoxIos, "Firefox on iOS"],
    ["Safari on macOS", UA.safariMac, "Safari on macOS"],
    ["Safari on iOS", UA.safariIos, "Safari on iOS"],
    ["Safari on an iPad", UA.safariIpad, "Safari on iOS"],
    ["Opera, which is another browser", UA.operaWindows, "Other browser on Windows"],
    ["Safari on a system that is not listed", UA.safariConsole, "Safari on Other system"],
    ["a tool that is no browser", UA.curl, "Other browser on Other system"],
    ["an empty User-Agent", "", "Other browser on Other system"],
    ["no User-Agent", null, "Other browser on Other system"],
  ])("%s", (_name, userAgent, label) => {
    expect(sessionLabel(userAgent)).toBe(label);
  });

  it("is only ever one of the families, whatever the User-Agent holds", () => {
    const family =
      /^(Edge|Chrome|Firefox|Safari|Other browser) on (Windows|macOS|Linux|Android|iOS|Other system)$/;
    const pieces = [
      "Mozilla/5.0",
      "(Windows NT 10.0)",
      "(Macintosh; Intel Mac OS X 10_15_7)",
      "(X11; Linux)",
      "Android 14",
      "iPhone",
      "Chrome/1",
      "Edg/1",
      "Firefox/1",
      "Safari/1",
      "Version/1",
      "OPR/1",
      "CriOS/1",
      "FxiOS/1",
      "ana@example.com",
      "<script>alert(1)</script>",
      "'; DROP TABLE x;--",
      "\u0000",
      "日本語",
      "x".repeat(300),
    ];
    const random = seededRandom(7);
    for (let i = 0; i < 300; i++) {
      const count = 1 + (random(1)[0]! % 8);
      const ua = Array.from({ length: count }, () => pieces[random(1)[0]! % pieces.length]).join(
        " ",
      );
      expect(sessionLabel(ua), ua).toMatch(family);
    }
  });

  it("gives only the family label for a long User-Agent, and none of its text", () => {
    const long = `${UA.chromeWindows} ${"personal-detail/1.0 ana@example.com ".repeat(2000)}`;
    expect(long.length).toBeGreaterThan(70_000);
    expect(sessionLabel(long)).toBe("Chrome on Windows");
  });

  it("does not store the raw User-Agent anywhere in the store", async () => {
    const h = await harness();
    const secret = "SecretDevice/9.9 (owner=ana@example.com; serial=SN-123456)";
    const ua = `${EDGE_ON_WINDOWS} ${secret}`;
    const started = await signIn(h, ua);

    const stored = JSON.stringify([
      await h.store.session(started.session.sid),
      await h.store.sessionsOf("user-1", h.clock.now().toISOString()),
      await h.store.userById("user-1"),
      await h.store.identitiesOf("user-1"),
    ]);
    expect(stored).toContain("Edge on Windows");
    for (const piece of [
      "SecretDevice",
      "SN-123456",
      "Mozilla",
      "AppleWebKit",
      "Win64",
      "537.36",
      "130.0.0.0",
    ]) {
      expect(stored, piece).not.toContain(piece);
    }
    expect(Object.keys((await h.store.session(started.session.sid))!).sort()).toEqual([
      "createdAt",
      "expiresAt",
      "label",
      "lastSeen",
      "revokedAt",
      "sid",
      "userId",
    ]);
  });

  it("labels a sign-in that sent no User-Agent as an unknown browser", async () => {
    const h = await harness();
    const started = await signIn(h, null);
    expect(started.session.label).toBe("Other browser on Other system");
  });
});

describe("currentSession", () => {
  it("returns the session, the user and the claims of a valid cookie", async () => {
    const h = await harness();
    const started = await signIn(h);
    const current = await currentSession(contextFor(h, `meltemi_session=${started.token}`));
    expect(current?.session).toEqual(started.session);
    expect(current?.user).toEqual(started.user);
    expect(current?.claims).toMatchObject({ sub: "user-1", sid: started.session.sid });
  });

  it("finds the cookie among others, and makes no request to anyone", async () => {
    const h = await harness();
    const started = await signIn(h);
    const cookie = `theme=dark; meltemi_session=${started.token}; meltemi_oauth=x`;
    expect((await currentSession(contextFor(h, cookie)))?.user.id).toBe("user-1");
    expect(h.stub.calls).toEqual([]);
  });

  it("is signed out without a cookie, with another cookie, or with an empty one", async () => {
    const h = await harness();
    await signIn(h);
    expect(await currentSession(contextFor(h))).toBeUndefined();
    expect(await currentSession(contextFor(h, "theme=dark"))).toBeUndefined();
    expect(await currentSession(contextFor(h, "meltemi_session="))).toBeUndefined();
  });

  it("is signed out, not failing, for a cookie that is not a token", async () => {
    const h = await harness();
    await signIn(h);
    for (const junk of ["not-a-token", "a.b.c", "..", "a.b", "x".repeat(5000)]) {
      expect(
        await currentSession(contextFor(h, `meltemi_session=${junk}`)),
        junk.slice(0, 10),
      ).toBeUndefined();
    }
  });

  it("is signed out once the session is revoked, at once", async () => {
    const h = await harness();
    const started = await signIn(h);
    const cookie = `meltemi_session=${started.token}`;
    expect(await currentSession(contextFor(h, cookie))).toBeDefined();
    await h.store.revokeSession(started.session.sid, h.clock.now().toISOString());
    expect(await currentSession(contextFor(h, cookie))).toBeUndefined();
  });

  it("is signed out only for the sessions that were revoked, when the person signs out the others", async () => {
    const h = await harness();
    const mine = await signIn(h);
    const other = await startSession(
      { deps: h.deps, config: readConfig(h.env), request: new Request(h.env.ISSUER) },
      mine.user,
      mine.identity,
    );
    await h.store.revokeOtherSessions("user-1", mine.session.sid, h.clock.now().toISOString());
    expect(await currentSession(contextFor(h, `meltemi_session=${mine.token}`))).toBeDefined();
    expect(await currentSession(contextFor(h, `meltemi_session=${other.token}`))).toBeUndefined();
  });

  describe("when the row expires", () => {
    it("is signed out from the instant the row expires, though the token still has its leeway", async () => {
      const h = await harness();
      const started = await signIn(h);
      const cookie = `meltemi_session=${started.token}`;
      const expiry = Date.parse(started.session.expiresAt);

      h.clock.set(new Date(expiry - 1).toISOString());
      expect(await currentSession(contextFor(h, cookie))).toBeDefined();
      h.clock.set(new Date(expiry).toISOString());
      expect(await currentSession(contextFor(h, cookie))).toBeUndefined();
      // The token alone would still verify: that is the row speaking.
      const verifier = sessionVerifier({ jwks: await publishedKeys(h), checkSession: false });
      expect(await verifier.verifySession(started.token, h.clock.now())).toBeDefined();
    });

    it("follows the row, not the token, when the row ends earlier", async () => {
      const h = await harness();
      const at = h.clock.now().toISOString();
      await h.store.createUser({ id: "user-1", name: "Ana", picture: "", createdAt: at });
      const iat = Math.floor(h.clock.now().getTime() / 1000);
      await h.store.createSession({
        sid: "short-lived",
        userId: "user-1",
        createdAt: at,
        lastSeen: at,
        expiresAt: new Date((iat + 86_400) * 1000).toISOString(),
        label: "Chrome on Linux",
        revokedAt: null,
      });
      const token = await signJwt(h.deps.keys, fullClaims(h.clock.now(), { sid: "short-lived" }));
      const cookie = `meltemi_session=${token}`;
      expect(await currentSession(contextFor(h, cookie))).toBeDefined();
      h.clock.advance(2 * DAY);
      expect(await currentSession(contextFor(h, cookie))).toBeUndefined();
    });

    it("is signed out when the token itself is long expired", async () => {
      const h = await harness();
      const started = await signIn(h);
      h.clock.advance(31 * DAY);
      expect(
        await currentSession(contextFor(h, `meltemi_session=${started.token}`)),
      ).toBeUndefined();
    });
  });

  describe("when the person is gone", () => {
    it("is signed out once the user is deleted, sessions included", async () => {
      const h = await harness();
      const started = await signIn(h);
      await h.store.deleteUser("user-1");
      expect(
        await currentSession(contextFor(h, `meltemi_session=${started.token}`)),
      ).toBeUndefined();
    });

    it("is signed out when the session row stays but the user does not exist", async () => {
      const h = await harness();
      const ghost: User = {
        id: "ghost",
        name: "Ghost",
        picture: "",
        createdAt: h.clock.now().toISOString(),
      };
      const started = await startSession(
        { deps: h.deps, config: readConfig(h.env), request: new Request(h.env.ISSUER) },
        ghost,
        { email: "", emailVerified: false },
      );
      expect(await h.store.session(started.session.sid)).toBeDefined();
      expect(
        await currentSession(contextFor(h, `meltemi_session=${started.token}`)),
      ).toBeUndefined();
    });

    it("is signed out when the row belongs to another user than the token says", async () => {
      const h = await harness();
      const person = await signedInPerson(h, { id: "user-a" });
      await h.store.createUser({
        id: "user-b",
        name: "Bea",
        picture: "",
        createdAt: h.clock.now().toISOString(),
      });
      const token = await signJwt(
        h.deps.keys,
        fullClaims(h.clock.now(), { sub: "user-b", sid: person.session.sid }),
      );
      expect(await currentSession(contextFor(h, `meltemi_session=${token}`))).toBeUndefined();
    });

    it("is signed out for a token whose session was never stored", async () => {
      const h = await harness();
      await signIn(h);
      const token = await signJwt(h.deps.keys, fullClaims(h.clock.now(), { sid: "never-stored" }));
      expect(await currentSession(contextFor(h, `meltemi_session=${token}`))).toBeUndefined();
    });
  });

  describe("when the token is not the service's", () => {
    it("is signed out for a tampered cookie", async () => {
      const h = await harness();
      const started = await signIn(h);
      const tampered = withPayloadCharacterChanged(started.token, 12);
      expect(await currentSession(contextFor(h, `meltemi_session=${tampered}`))).toBeUndefined();
      const forged = withClaims(started.token, {
        ...decodeToken(started.token).claims,
        sub: "admin",
      });
      expect(await currentSession(contextFor(h, `meltemi_session=${forged}`))).toBeUndefined();
    });

    it("is signed out for a kid that is not published, even signed by a valid key of the curve", async () => {
      const h = await harness();
      const started = await signIn(h);
      const stranger = await testKeys();
      const claims = decodeToken(started.token).claims;
      const token = await craftToken(stranger, goodHeader(stranger), claims);
      expect(await currentSession(contextFor(h, `meltemi_session=${token}`))).toBeUndefined();
    });

    it("is signed out for the published kid with a signature from another key", async () => {
      const h = await harness();
      const started = await signIn(h);
      const stranger = await testKeys();
      const claims = decodeToken(started.token).claims;
      const token = await craftWithKid(stranger, h.keys.publicJwk.kid, claims);
      expect(await currentSession(contextFor(h, `meltemi_session=${token}`))).toBeUndefined();
    });

    it("is signed out for a token another issuer made, with the service's key", async () => {
      const h = await harness({ env: DEV_ENV });
      const started = await signIn(h);
      const claims = { ...decodeToken(started.token).claims, iss: "https://id.meltemi.dev" };
      const token = await signJwt(h.deps.keys, claims);
      expect(await currentSession(contextFor(h, `meltemi_session=${token}`))).toBeUndefined();
      expect(await currentSession(contextFor(h, `meltemi_session=${started.token}`))).toBeDefined();
    });

    it("is signed out for an unsecured token naming the published kid", async () => {
      const h = await harness();
      const started = await signIn(h);
      const [, payload] = started.token.split(".");
      const header = Buffer.from(
        JSON.stringify({ alg: "none", typ: "JWT", kid: h.keys.publicJwk.kid }),
      ).toString("base64url");
      expect(
        await currentSession(contextFor(h, `meltemi_session=${header}.${payload}.`)),
      ).toBeUndefined();
    });
  });

  describe("when the store fails", () => {
    it("lets the failure through: a store that is down is an error, not a signed-out person", async () => {
      const h = await harness();
      const started = await signIn(h);
      h.deps.store.session = async () => {
        throw new Error("D1 is down");
      };
      await expect(
        currentSession(contextFor(h, `meltemi_session=${started.token}`)),
      ).rejects.toThrow("D1 is down");
    });

    it("does the same when the user lookup fails", async () => {
      const h = await harness();
      const started = await signIn(h);
      h.deps.store.userById = async () => {
        throw new Error("D1 is down");
      };
      await expect(
        currentSession(contextFor(h, `meltemi_session=${started.token}`)),
      ).rejects.toThrow("D1 is down");
    });

    it("does not touch the store for a cookie that is not a valid token", async () => {
      const h = await harness();
      h.deps.store.session = async () => {
        throw new Error("the store must not be asked");
      };
      expect(await currentSession(contextFor(h, "meltemi_session=garbage"))).toBeUndefined();
      expect(await currentSession(contextFor(h))).toBeUndefined();
    });
  });
});

describe("the public keys", () => {
  it("are served with Cache-Control public, max-age=3600 as JSON", async () => {
    const h = await harness();
    const response = await h.request("/.well-known/jwks.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });

  it("hold every field a verifier needs and nothing private, with the thumbprint as the kid", async () => {
    const h = await harness();
    const [key] = (await publishedKeys(h)).keys;
    expect(Object.keys(key!).sort()).toEqual(["alg", "crv", "kid", "kty", "use", "x", "y"]);
    expect(key).toMatchObject({ kty: "EC", crv: "P-256", use: "sig", alg: "ES256" });
    expect(key!["kid"]).toBe(
      await thumbprint(key as { crv: string; kty: string; x: string; y: string }),
    );
  });

  it("add use and alg to a key configured without them", async () => {
    const h = await harness();
    const { use: _use, alg: _alg, ...bare } = h.keys.publicJwk;
    const deps: Deps = { ...h.deps, keys: await importSigningKeys(h.keys.privateJwk, [bare]) };
    const [key] = (await publishedKeys(h, deps)).keys;
    expect(key).toMatchObject({ use: "sig", alg: "ES256", kid: h.keys.publicJwk.kid });
  });

  it("never publish the private part, even when it was pasted among the public keys", async () => {
    const h = await harness();
    const deps: Deps = {
      ...h.deps,
      keys: await importSigningKeys(h.keys.privateJwk, [h.keys.privateJwk]),
    };
    const response = await identity(
      new Request(`${h.env.ISSUER}/.well-known/jwks.json`),
      h.env,
      deps,
    );
    const text = await response.text();
    expect(text).not.toContain(h.keys.privateJwk.d);
    expect(Object.keys((JSON.parse(text) as JsonWebKeySet).keys[0]!)).not.toContain("d");
  });

  describe("during a rotation", () => {
    async function rotation(h: Harness) {
      const previous = await testKeys();
      const before = new Date(h.clock.now().getTime() - 10 * DAY);
      const earlier = await signSessionToken({ sub: "user-1" }, previous, before);
      const rotated: Deps = {
        ...h.deps,
        keys: await importSigningKeys(h.keys.privateJwk, [h.keys.publicJwk, previous.publicJwk]),
      };
      return { previous, earlier, rotated };
    }

    it("publish both keys, the current one first", async () => {
      const h = await harness();
      const { previous, rotated } = await rotation(h);
      const kids = (await publishedKeys(h, rotated)).keys.map((k) => k["kid"]);
      expect(kids).toEqual([h.keys.publicJwk.kid, previous.publicJwk.kid]);
    });

    it("verify a token signed earlier with the previous key, and carry the new kid in a new one", async () => {
      const h = await harness();
      const { previous, earlier, rotated } = await rotation(h);
      const verifier = sessionVerifier({
        jwks: await publishedKeys(h, rotated),
        checkSession: false,
      });

      expect((await verifier.verifySession(earlier, h.clock.now()))?.sub).toBe("user-1");

      const at = h.clock.now().toISOString();
      const user: User = { id: "user-2", name: "Bea", picture: "", createdAt: at };
      await h.store.createUser(user);
      const started = await startSession(
        { deps: rotated, config: readConfig(h.env), request: new Request(h.env.ISSUER) },
        user,
        { email: "", emailVerified: false },
      );
      const kid = decodeToken(started.token).header["kid"];
      expect(kid).toBe(h.keys.publicJwk.kid);
      expect(kid).not.toBe(previous.publicJwk.kid);
      expect((await verifier.verifySession(started.token, h.clock.now()))?.sub).toBe("user-2");
    });

    it("keep a person signed in across the rotation, until the previous key is removed", async () => {
      const h = await harness();
      const previous = await testKeys();
      const beforeDeps: Deps = {
        ...h.deps,
        keys: await importSigningKeys(previous.privateJwk, [previous.publicJwk]),
      };
      const at = h.clock.now().toISOString();
      const user: User = { id: "user-1", name: "Ana", picture: "", createdAt: at };
      await h.store.createUser(user);
      const started = await startSession(
        { deps: beforeDeps, config: readConfig(h.env), request: new Request(h.env.ISSUER) },
        user,
        { email: "", emailVerified: false },
      );
      const cookie = `meltemi_session=${started.token}`;

      const rotated: Deps = {
        ...h.deps,
        keys: await importSigningKeys(h.keys.privateJwk, [h.keys.publicJwk, previous.publicJwk]),
      };
      expect(await currentSession({ ...contextFor(h, cookie), deps: rotated })).toBeDefined();

      const removed: Deps = {
        ...h.deps,
        keys: await importSigningKeys(h.keys.privateJwk, [h.keys.publicJwk]),
      };
      expect(await currentSession({ ...contextFor(h, cookie), deps: removed })).toBeUndefined();
    });

    it("stop verifying the previous key's tokens once it is no longer published", async () => {
      const h = await harness();
      const { earlier } = await rotation(h);
      const verifier = sessionVerifier({ jwks: await publishedKeys(h), checkSession: false });
      expect(await verifier.verifySession(earlier, h.clock.now())).toBeUndefined();
    });
  });

  describe("an unknown kid", () => {
    it("fails even when the signature was made with a valid key of the same curve", async () => {
      const h = await harness();
      const verifier = sessionVerifier({ jwks: await publishedKeys(h), checkSession: false });
      const stranger = await testKeys();
      const token = await signSessionToken({ sub: "user-1" }, stranger, h.clock.now());

      // The signature is a valid ES256 signature of a valid token: only the kid is wrong.
      const own = sessionVerifier({ jwks: { keys: [stranger.publicJwk] }, checkSession: false });
      expect((await own.verifySession(token, h.clock.now()))?.sub).toBe("user-1");
      expect(await verifier.verifySession(token, h.clock.now())).toBeUndefined();
    });

    it("fails when the kid is a published one but the key that signed is another", async () => {
      const h = await harness();
      const verifier = sessionVerifier({ jwks: await publishedKeys(h), checkSession: false });
      const stranger = await testKeys();
      const token = await craftWithKid(stranger, h.keys.publicJwk.kid, fullClaims(h.clock.now()));
      expect(await verifier.verifySession(token, h.clock.now())).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The same contract end to end: a sign-in through the providers' stubs, and a product's verifier
// asking the service itself for its keys and for the session check.

/** The token of the first `meltemi_session` cookie a response sets. */
function tokenOf(response: Response): string {
  const [line] = sessionCookies(response);
  return line!.split(";")[0]!.slice("meltemi_session=".length);
}

describe("a sign-in that completes", () => {
  it("sets the production cookie and a token that verifies with the keys of the JWKS", async () => {
    const h = await harness();
    const { response } = await providerSignIn(h, "github", {
      query: { return_to: "https://diagrams.meltemi.dev/" },
      headers: { "User-Agent": EDGE_ON_WINDOWS },
    });
    expect(response.status).toBe(302);

    const [line] = sessionCookies(response);
    expect(attributesOf(line!)).toEqual([
      "Domain=meltemi.dev",
      "Path=/",
      "Max-Age=2592000",
      "Secure",
      "HttpOnly",
      "SameSite=Lax",
    ]);

    const verifier = sessionVerifier({ jwks: await publishedKeys(h), checkSession: false });
    const claims = await verifier.verifySession(tokenOf(response), h.clock.now());
    const iat = Math.floor(h.clock.now().getTime() / 1000);
    const stored = (await h.store.identity("github", "4242"))!;
    expect(claims).toEqual({
      iss: "https://id.meltemi.dev",
      aud: "meltemi",
      sub: stored.userId,
      sid: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      name: "Ana Dev",
      picture: "https://avatars.githubusercontent.com/u/4242",
      email: "ana@example.com",
      email_verified: true,
      iat,
      exp: iat + 2_592_000,
    });
    expect(await h.store.session(claims!.sid)).toMatchObject({
      userId: stored.userId,
      expiresAt: new Date((iat + 2_592_000) * 1000).toISOString(),
      label: "Edge on Windows",
      revokedAt: null,
    });
  });

  it("sets the development cookie in development mode: no Domain, no Secure on http", async () => {
    const h = await harness({ env: DEV_ENV });
    const { response } = await providerSignIn(h, "github", {
      query: { return_to: "http://localhost:8788/" },
    });
    expect(response.status).toBe(302);
    expect(attributesOf(sessionCookies(response)[0]!)).toEqual([
      "Path=/",
      "Max-Age=2592000",
      "HttpOnly",
      "SameSite=Lax",
    ]);
    const verifier = sessionVerifier({
      issuer: "http://localhost:8787",
      jwks: await publishedKeys(h),
      checkSession: false,
    });
    expect((await verifier.verifySession(tokenOf(response), h.clock.now()))?.iss).toBe(
      "http://localhost:8787",
    );
  });

  it("is a session the service itself accepts at once", async () => {
    const h = await harness();
    const { response } = await providerSignIn(h, "github");
    const current = await currentSession(contextFor(h, `meltemi_session=${tokenOf(response)}`));
    expect(current?.user.name).toBe("Ana Dev");
  });
});

describe("a product that verifies the service's sessions", () => {
  /** A verifier that reaches the service as a product would: its JWKS and its session check. */
  function productVerifier(h: Harness) {
    const asked: string[] = [];
    const viaService: typeof fetch = async (input, init) => {
      asked.push(String(input));
      return h.request(String(input), init);
    };
    const verifier = sessionVerifier({
      jwks: `${h.env.ISSUER}/.well-known/jwks.json`,
      fetch: viaService,
    });
    return { asked, verifier };
  }

  it("verifies a fresh session with the service's keys and one session check an hour", async () => {
    const h = await harness();
    const { response } = await providerSignIn(h, "github");
    const token = tokenOf(response);
    const { asked, verifier } = productVerifier(h);

    h.clock.advance(10 * MINUTE);
    const first = await verifier.verifySession(token, h.clock.now());
    expect(first?.name).toBe("Ana Dev");
    expect(asked).toEqual([
      "https://id.meltemi.dev/.well-known/jwks.json",
      `https://id.meltemi.dev/sessions/${first!.sid}`,
    ]);
    // The check moved the session's last-seen time to the time of the request.
    expect((await h.store.session(first!.sid))?.lastSeen).toBe(h.clock.now().toISOString());

    h.clock.advance(30 * MINUTE);
    expect(await verifier.verifySession(token, h.clock.now())).toEqual(first);
    expect(asked).toHaveLength(2);
  });

  it("sees a sign-out made by a product's form once the hour has passed", async () => {
    const h = await harness();
    const { response } = await providerSignIn(h, "github");
    const token = tokenOf(response);
    const { verifier } = productVerifier(h);
    const sid = (await verifier.verifySession(token, h.clock.now()))!.sid;

    const out = await h.request("/logout", {
      method: "POST",
      headers: {
        Origin: "https://diagrams.meltemi.dev",
        Cookie: `meltemi_session=${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ return_to: "https://diagrams.meltemi.dev/" }),
    });
    expect(out.status).toBe(302);
    expect((await h.request(`/sessions/${sid}`)).status).toBe(404);

    // The verifier has the answer of the last hour: it learns of the sign-out at the next check.
    h.clock.advance(HOUR - 1);
    expect((await verifier.verifySession(token, h.clock.now()))?.sid).toBe(sid);
    h.clock.advance(1);
    expect(await verifier.verifySession(token, h.clock.now())).toBeUndefined();
  });

  it("learns at once of a session that was revoked before it first looked", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    await h.store.revokeSession(person.session.sid, h.clock.now().toISOString());
    const { verifier } = productVerifier(h);
    expect(await verifier.verifySession(person.token, h.clock.now())).toBeUndefined();
  });

  it("verifies tokens of the previous key while the service still publishes it", async () => {
    const h = await harness();
    const previous = await testKeys();
    const rotated: Deps = {
      ...h.deps,
      keys: await importSigningKeys(h.keys.privateJwk, [h.keys.publicJwk, previous.publicJwk]),
    };
    const earlier = await signSessionToken(
      { sub: "user-1", sid: "a".repeat(43) },
      previous,
      h.clock.now(),
    );
    await h.store.createUser({
      id: "user-1",
      name: "Ana",
      picture: "",
      createdAt: h.clock.now().toISOString(),
    });
    await h.store.createSession({
      sid: "a".repeat(43),
      userId: "user-1",
      createdAt: h.clock.now().toISOString(),
      lastSeen: h.clock.now().toISOString(),
      expiresAt: new Date(h.clock.now().getTime() + 30 * DAY).toISOString(),
      label: "Chrome on Linux",
      revokedAt: null,
    });
    const verifier = sessionVerifier({
      jwks: `${h.env.ISSUER}/.well-known/jwks.json`,
      fetch: async (input, init) => identity(new Request(String(input), init), h.env, rotated),
    });
    expect((await verifier.verifySession(earlier, h.clock.now()))?.sub).toBe("user-1");
  });
});
