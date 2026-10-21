import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { base64url, hmacSha256, sha256, utf8 } from "../src/crypto.js";
import { en } from "../src/messages/en.js";
import { es } from "../src/messages/es.js";
import { OAUTH_COOKIE, signOauthCookie, type OAuthState } from "../src/oauth-cookie.js";
import { PROVIDERS, type Provider } from "../src/types.js";
import { sessionVerifier, type JsonWebKeySet } from "../src/verify.js";
import { harness, signedInPerson, textOf, type Harness } from "./support/index.js";
import {
  CLEARED_OAUTH,
  DEV_ENV,
  callback,
  captureConsole,
  decodeOauth,
  hrefsOf,
  interceptFetch,
  langOf,
  sessionCookies,
  signIn,
  startFlow,
} from "./support/signin.js";

const STATE_SECRET = "test-state-secret";
const DAY = 24 * 60 * 60 * 1000;
const EDGE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

let log: ReturnType<typeof captureConsole>;
beforeEach(() => {
  log = captureConsole();
});
afterEach(() => {
  log.restore();
});

/** The attributes of a `Set-Cookie` line, without the name and value. */
function attributes(line: string | undefined): string[] {
  return (line ?? "").split("; ").slice(1);
}

/** What every answer of the callback has in common: the flow's cookie cleared, nothing cached. */
function expectEnded(response: Response): void {
  expect(response.headers.getSetCookie()).toContain(CLEARED_OAUTH);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
}

/** Watches the writes a sign-in could make, calling through to the store. */
function watchWrites(h: Harness) {
  return {
    users: vi.spyOn(h.store, "createUser"),
    identities: vi.spyOn(h.store, "addIdentity"),
    sessions: vi.spyOn(h.store, "createSession"),
  };
}

function expectNoWrites(writes: ReturnType<typeof watchWrites>): void {
  expect(writes.users).not.toHaveBeenCalled();
  expect(writes.identities).not.toHaveBeenCalled();
  expect(writes.sessions).not.toHaveBeenCalled();
}

/** The claims of the session a response sets, verified with the keys the service publishes. */
async function sessionOf(h: Harness, response: Response) {
  const line = sessionCookies(response)[0]!;
  const token = line.split(";")[0]!.slice("meltemi_session=".length);
  const jwks = (await (await h.request("/.well-known/jwks.json")).json()) as JsonWebKeySet;
  const verifier = sessionVerifier({ issuer: h.env.ISSUER, jwks, checkSession: false });
  return { token, line, claims: await verifier.verifySession(token, h.clock.now()) };
}

/** Everything the store holds about a user, as one text a test can search. */
async function heldAbout(h: Harness, userId: string): Promise<string> {
  const far = "9999-12-31T00:00:00.000Z";
  return JSON.stringify({
    user: await h.store.userById(userId),
    identities: await h.store.identitiesOf(userId),
    sessions: await h.store.sessionsOf(userId, h.clock.now().toISOString()),
    outbox: await h.store.dueEvents(far, 1000),
  });
}

/** A text signed the way the service signs the cookie, whatever it says. */
async function signRaw(secret: string, text: string): Promise<string> {
  const payload = base64url(utf8(text));
  return `${payload}.${base64url(await hmacSha256(secret, payload))}`;
}

const flowState = (over: Partial<OAuthState> = {}): OAuthState => ({
  provider: "github",
  returnTo: "https://diagrams.meltemi.dev/",
  state: "known-state-value",
  issued: "2026-10-14T12:00:00.000Z",
  ...over,
});

describe("a GitHub sign-in, end to end", () => {
  it("creates the account and redirects to exactly the return address", async () => {
    const h = await harness();
    const returnTo = "https://diagrams.meltemi.dev/p/abc?x=1";
    const { response } = await signIn(h, "github", {
      query: { return_to: returnTo },
      headers: { "User-Agent": EDGE_UA },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(returnTo);
    expectEnded(response);

    const identity = await h.store.identity("github", "4242");
    expect(identity).toEqual({
      provider: "github",
      providerId: "4242",
      userId: expect.any(String),
      email: "ana@example.com",
      emailVerified: true,
      verifiedAt: "2026-10-14T12:00:00.000Z",
      handle: "ana-dev",
      linkedAt: "2026-10-14T12:00:00.000Z",
    });
    const user = await h.store.userById(identity!.userId);
    expect(user).toEqual({
      id: identity!.userId,
      name: "Ana Dev",
      picture: "https://avatars.githubusercontent.com/u/4242",
      createdAt: "2026-10-14T12:00:00.000Z",
    });
    expect(user!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(await h.store.identitiesOf(user!.id)).toHaveLength(1);
    // A sign-in that works says nothing to the log: no person's data goes there.
    expect(log.lines()).toBe("");
  });

  it("sets the session cookie of the family and a session row that names the user", async () => {
    const h = await harness();
    const { response } = await signIn(h, "github", { headers: { "User-Agent": EDGE_UA } });
    const { claims, line } = await sessionOf(h, response);
    expect(attributes(line).sort()).toEqual(
      [
        "Domain=meltemi.dev",
        "Path=/",
        "Max-Age=2592000",
        "Secure",
        "HttpOnly",
        "SameSite=Lax",
      ].sort(),
    );
    const identity = await h.store.identity("github", "4242");
    const sessions = await h.store.sessionsOf(identity!.userId, h.clock.now().toISOString());
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      userId: identity!.userId,
      label: "Edge on Windows",
      revokedAt: null,
      expiresAt: "2026-11-13T12:00:00.000Z",
    });
    expect(claims).toMatchObject({
      sub: identity!.userId,
      sid: sessions[0]!.sid,
      name: "Ana Dev",
      picture: "https://avatars.githubusercontent.com/u/4242",
      email: "ana@example.com",
      email_verified: true,
      iss: "https://id.meltemi.dev",
      aud: "meltemi",
    });
    expect(claims!.exp).toBe(claims!.iat + 2592000);
  });

  it("returns to the site when the flow had no return address", async () => {
    const h = await harness();
    const { response } = await signIn(h, "github");
    // The address the flow remembered, as the parsed address the browser will follow.
    expect(response.headers.get("Location")).toBe("https://meltemi.dev/");
  });

  it("makes exactly the documented requests, and nothing else", async () => {
    const h = await harness();
    const flow = await startFlow(h, "github");
    await callback(h, "github", flow, { code: "the code & more=1" });
    const [exchange, user, emails, ...rest] = h.stub.calls;
    expect(rest).toEqual([]);

    expect(exchange!.method).toBe("POST");
    expect(exchange!.url).toBe(GITHUB_TOKEN_URL);
    expect(exchange!.headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
    expect(exchange!.headers.get("Accept")).toBe("application/json");
    expect(exchange!.headers.get("User-Agent")).toBe("meltemi-identity");
    expect(Object.fromEntries(new URLSearchParams(exchange!.body))).toEqual({
      client_id: "test-github-client",
      client_secret: "test-github-secret",
      code: "the code & more=1",
      redirect_uri: "https://id.meltemi.dev/callback/github",
    });
    // The callback address of the exchange is the one the authorization used.
    expect(flow.location.searchParams.get("redirect_uri")).toBe(
      "https://id.meltemi.dev/callback/github",
    );

    for (const [call, url] of [
      [user!, GITHUB_USER_URL],
      [emails!, GITHUB_EMAILS_URL],
    ] as const) {
      expect(call.method).toBe("GET");
      expect(call.url).toBe(url);
      expect(call.headers.get("Authorization")).toBe(`Bearer ${h.stub.github.token}`);
      expect(call.headers.get("User-Agent")).toBe("meltemi-identity");
      expect(call.headers.get("Accept")).toBe("application/vnd.github+json");
      expect(call.body).toBe("");
    }
  });

  it("gives a session cookie that verifies with the published keys and works for the service", async () => {
    const h = await harness();
    const { response } = await signIn(h, "github");
    const { token, claims } = await sessionOf(h, response);
    expect(claims).toBeDefined();
    const root = await h.request("/", { headers: { Cookie: `meltemi_session=${token}` } });
    expect(root.headers.get("Location")).toBe("/account");

    // One character of the payload changed: the signature no longer holds.
    const [header, payload, signature] = token.split(".") as [string, string, string];
    const flipped = (payload[5] === "A" ? "B" : "A") + "";
    const tampered = [header, payload.slice(0, 5) + flipped + payload.slice(6), signature].join(
      ".",
    );
    const jwks = (await (await h.request("/.well-known/jwks.json")).json()) as JsonWebKeySet;
    const verifier = sessionVerifier({ issuer: h.env.ISSUER, jwks, checkSession: false });
    expect(await verifier.verifySession(tampered, h.clock.now())).toBeUndefined();
  });

  it("answers in Spanish to a Spanish browser", async () => {
    const h = await harness();
    const flow = await startFlow(h, "github");
    const response = await callback(h, "github", flow, {
      state: "wrong",
      headers: { "Accept-Language": "es-CL,es;q=0.9" },
    });
    expect(langOf(await textOf(response))).toBe("es");
  });
});

describe("a Google sign-in, end to end", () => {
  it("creates the account from userinfo and redirects to the return address", async () => {
    const h = await harness();
    const { response } = await signIn(h, "google", {
      query: { return_to: "https://diagrams.meltemi.dev/p/abc?x=1" },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://diagrams.meltemi.dev/p/abc?x=1");
    expectEnded(response);

    const identity = await h.store.identity("google", "g-7777");
    expect(identity).toEqual({
      provider: "google",
      providerId: "g-7777",
      userId: expect.any(String),
      email: "ana@example.com",
      emailVerified: true,
      verifiedAt: "2026-10-14T12:00:00.000Z",
      handle: "",
      linkedAt: "2026-10-14T12:00:00.000Z",
    });
    expect(await h.store.userById(identity!.userId)).toMatchObject({
      name: "Ana Dev",
      picture: "https://lh3.googleusercontent.com/a/ana",
    });
    const { claims } = await sessionOf(h, response);
    expect(claims).toMatchObject({ sub: identity!.userId, email: "ana@example.com" });
  });

  it("makes exactly the documented requests, with the PKCE verifier of the flow", async () => {
    const h = await harness();
    const flow = await startFlow(h, "google");
    await callback(h, "google", flow);
    const [exchange, userinfo, ...rest] = h.stub.calls;
    expect(rest).toEqual([]);

    const verifier = decodeOauth(flow.value).payload["verifier"] as string;
    expect(exchange!.method).toBe("POST");
    expect(exchange!.url).toBe(GOOGLE_TOKEN_URL);
    expect(exchange!.headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
    expect(exchange!.headers.get("Accept")).toBe("application/json");
    expect(exchange!.headers.get("User-Agent")).toBe("meltemi-identity");
    expect(Object.fromEntries(new URLSearchParams(exchange!.body))).toEqual({
      client_id: "test-google-client",
      client_secret: "test-google-secret",
      code: "stub-code",
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: "https://id.meltemi.dev/callback/google",
    });
    // The verifier sent to Google is the one whose SHA-256 started the flow.
    expect(base64url(await sha256(verifier))).toBe(
      flow.location.searchParams.get("code_challenge"),
    );

    expect(userinfo!.method).toBe("GET");
    expect(userinfo!.url).toBe(GOOGLE_USERINFO_URL);
    expect(userinfo!.headers.get("Authorization")).toBe(`Bearer ${h.stub.google.token}`);
    expect(userinfo!.headers.get("User-Agent")).toBe("meltemi-identity");
    expect(userinfo!.headers.get("Accept")).toBe("application/json");
  });

  it("a Google email that is not verified is kept, marked unverified, with no verified_at", async () => {
    const h = await harness();
    h.stub.google.userinfo = { ...h.stub.google.userinfo, email_verified: false };
    const { response } = await signIn(h, "google");
    expect(response.status).toBe(302);
    expect(await h.store.identity("google", "g-7777")).toMatchObject({
      email: "ana@example.com",
      emailVerified: false,
      verifiedAt: null,
    });
    expect((await sessionOf(h, response)).claims).toMatchObject({ email_verified: false });
  });
});

describe("development mode", () => {
  it("signs in with a cookie that has no Domain and no Secure on http, and returns to a development origin", async () => {
    const h = await harness({ env: DEV_ENV });
    const { flow, response } = await signIn(h, "github", {
      query: { return_to: "http://localhost:8788/" },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("http://localhost:8788/");
    expect(attributes(sessionCookies(response)[0]).sort()).toEqual(
      ["Path=/", "Max-Age=2592000", "HttpOnly", "SameSite=Lax"].sort(),
    );
    expect(response.headers.getSetCookie()).toContain(
      "meltemi_oauth=; Path=/callback; Max-Age=0; HttpOnly; SameSite=Lax",
    );
    expect(Object.fromEntries(new URLSearchParams(h.stub.calls[0]!.body))).toMatchObject({
      redirect_uri: "http://localhost:8787/callback/github",
    });
    expect(flow.location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:8787/callback/github",
    );
    const { claims } = await sessionOf(h, response);
    expect(claims!.iss).toBe("http://localhost:8787");
  });
});

describe("no provider token is kept", () => {
  const TOKENS = ["stub-github-access-token", "stub-google-access-token"];
  const SECRETS = ["test-github-secret", "test-google-secret", STATE_SECRET];

  it.each(["github", "google"] as const)(
    "%s: the store holds no field for it and no stored value contains it",
    async (provider) => {
      const h = await harness();
      const { flow, response } = await signIn(h, provider, {
        query: { return_to: "https://diagrams.meltemi.dev/" },
      });
      expect(response.status).toBe(302);
      const identity = (await h.store.identity(
        provider,
        provider === "github" ? "4242" : "g-7777",
      ))!;
      const userId = identity.userId;

      // Exactly the fields of the inventory: there is no place for a token.
      expect(Object.keys(identity).sort()).toEqual([
        "email",
        "emailVerified",
        "handle",
        "linkedAt",
        "provider",
        "providerId",
        "userId",
        "verifiedAt",
      ]);
      expect(Object.keys((await h.store.userById(userId))!).sort()).toEqual([
        "createdAt",
        "id",
        "name",
        "picture",
      ]);
      const [session] = await h.store.sessionsOf(userId, h.clock.now().toISOString());
      expect(Object.keys(session!).sort()).toEqual([
        "createdAt",
        "expiresAt",
        "label",
        "lastSeen",
        "revokedAt",
        "sid",
        "userId",
      ]);

      // And no value anywhere: the store, the answer, the headers, the cookie, the logs.
      const everything = [
        await heldAbout(h, userId),
        await textOf(response),
        [...response.headers].flat().join("\n"),
        flow.value,
        JSON.stringify(decodeOauth(flow.value).payload),
        log.lines(),
      ].join("\n");
      for (const secret of [...TOKENS, ...SECRETS]) {
        expect(everything).not.toContain(secret);
      }
    },
  );

  it("a refused flow shows and logs no token either", async () => {
    const h = await harness();
    h.stub.github.userStatus = 500;
    const { response } = await signIn(h, "github");
    expect(response.status).toBe(502);
    const everything = [
      await textOf(response),
      [...response.headers].flat().join("\n"),
      log.lines(),
    ];
    for (const secret of [...TOKENS, ...SECRETS]) {
      expect(everything.join("\n")).not.toContain(secret);
    }
  });
});

describe("the callback refuses what is not ours", () => {
  it("a state that differs from the cookie's: 400 state.mismatch, cookie cleared, no session, no exchange", async () => {
    const h = await harness();
    const writes = watchWrites(h);
    const flow = await startFlow(h, "github");
    const response = await callback(h, "github", flow, { state: "some-other-state" });
    expect(response.status).toBe(400);
    expect(await textOf(response)).toContain("state.mismatch");
    expectEnded(response);
    expect(sessionCookies(response)).toEqual([]);
    expectNoWrites(writes);
    expect(h.stub.calls).toEqual([]);
    expect(await h.store.identity("github", "4242")).toBeUndefined();
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["a prefix of the right one", "PREFIX"],
    ["the right one with one more character", "EXTRA"],
    ["the right one in another case", "UPPER"],
  ])("a state that is %s", async (_name, kind) => {
    const h = await harness();
    const flow = await startFlow(h, "github");
    const state =
      kind === "PREFIX"
        ? flow.state.slice(0, 20)
        : kind === "EXTRA"
          ? flow.state + "x"
          : kind === "UPPER"
            ? flow.state.toUpperCase()
            : kind;
    const response = await callback(h, "github", flow, { state });
    expect(response.status).toBe(400);
    expect(await textOf(response)).toContain("state.mismatch");
    expectEnded(response);
    expect(h.stub.calls).toEqual([]);
  });

  it("no cookie at all", async () => {
    const h = await harness();
    const flow = await startFlow(h, "github");
    const response = await callback(h, "github", flow, { cookie: null });
    expect(response.status).toBe(400);
    expect(await textOf(response)).toContain("state.mismatch");
    expectEnded(response);
    expect(h.stub.calls).toEqual([]);
  });

  it("a cookie whose signature was altered", async () => {
    const h = await harness();
    const flow = await startFlow(h, "github");
    const { payloadPart, signaturePart } = decodeOauth(flow.value);
    // The first character carries six significant bits: the signature changes for certain.
    const first = signaturePart[0] === "A" ? "B" : "A";
    const response = await callback(h, "github", flow, {
      cookie: `${OAUTH_COOKIE}=${payloadPart}.${first}${signaturePart.slice(1)}`,
    });
    expect(response.status).toBe(400);
    expect(await textOf(response)).toContain("state.mismatch");
    expectEnded(response);
    expect(h.stub.calls).toEqual([]);
  });

  it("a cookie whose content was altered under the old signature", async () => {
    const h = await harness();
    const flow = await startFlow(h, "github", {
      query: { return_to: "https://diagrams.meltemi.dev/" },
    });
    const { payload, signaturePart } = decodeOauth(flow.value);
    const forged = base64url(
      utf8(JSON.stringify({ ...payload, returnTo: "https://meltemi.dev/evil" })),
    );
    const response = await callback(h, "github", flow, {
      cookie: `${OAUTH_COOKIE}=${forged}.${signaturePart}`,
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("Location")).toBeNull();
    expect(await textOf(response)).toContain("state.mismatch");
    expect(h.stub.calls).toEqual([]);
  });

  it("a cookie signed with another secret", async () => {
    const h = await harness();
    const flow = await startFlow(h, "github");
    const forged = await signOauthCookie("another-secret", flowState({ state: flow.state }));
    const response = await callback(h, "github", flow, { cookie: `${OAUTH_COOKIE}=${forged}` });
    expect(response.status).toBe(400);
    expect(await textOf(response)).toContain("state.mismatch");
    expect(h.stub.calls).toEqual([]);
  });

  it("a cookie that belongs to the other provider's flow", async () => {
    const h = await harness();
    const github = await startFlow(h, "github");
    const response = await callback(h, "google", github, { state: github.state });
    expect(response.status).toBe(400);
    expect(await textOf(response)).toContain("state.mismatch");
    expectEnded(response);
    expect(h.stub.calls).toEqual([]);
  });

  it.each([
    ["not a cookie of ours", "garbage"],
    ["a dot and nothing else", "."],
    ["two dots", "a.b.c"],
    ["an empty value", ""],
    ["a payload without a signature", "eyJhIjoxfQ"],
    ["a value as long as no cookie can be", "A".repeat(5000) + "." + "B".repeat(43)],
  ])("a cookie value that is %s", async (_name, value) => {
    const h = await harness();
    const flow = await startFlow(h, "github");
    const response = await callback(h, "github", flow, { cookie: `${OAUTH_COOKIE}=${value}` });
    expect(response.status).toBe(400);
    expect(await textOf(response)).toContain("state.mismatch");
    expectEnded(response);
    expect(h.stub.calls).toEqual([]);
  });

  const shapes: [string, () => Promise<string>][] = [
    ["JSON that is not an object", () => signRaw(STATE_SECRET, "[1,2]")],
    ["text that is not JSON", () => signRaw(STATE_SECRET, "not json")],
    [
      "an unknown provider",
      () => signOauthCookie(STATE_SECRET, flowState({ provider: "facebook" as Provider })),
    ],
    ["no state", () => signOauthCookie(STATE_SECRET, flowState({ state: "" }))],
    ["no return address", () => signOauthCookie(STATE_SECRET, flowState({ returnTo: "" }))],
    [
      "a verifier that is not text",
      () => signOauthCookie(STATE_SECRET, flowState({ verifier: 7 as unknown as string })),
    ],
    ["a link without a user", () => signOauthCookie(STATE_SECRET, flowState({ link: true }))],
    [
      "a link flag that is not a boolean",
      () => signOauthCookie(STATE_SECRET, flowState({ link: "yes" as unknown as boolean })),
    ],
    [
      "a time that is not a time",
      () => signOauthCookie(STATE_SECRET, flowState({ issued: "yesterday" })),
    ],
    [
      "no time",
      () =>
        signRaw(
          STATE_SECRET,
          JSON.stringify({ provider: "github", returnTo: "https://meltemi.dev/", state: "s" }),
        ),
    ],
  ];

  it.each(shapes)("a signed cookie with %s", async (_name, make) => {
    const h = await harness();
    const flow = await startFlow(h, "github");
    const value = await make();
    const state = "known-state-value";
    const response = await callback(h, "github", flow, {
      cookie: `${OAUTH_COOKIE}=${value}`,
      state,
    });
    expect(response.status).toBe(400);
    expect(await textOf(response)).toContain("state.mismatch");
    expectEnded(response);
    expect(h.stub.calls).toEqual([]);
  });

  it("a signed cookie with a return address that is no longer allowed: return_to.invalid, nothing asked", async () => {
    const h = await harness();
    const flow = await startFlow(h, "github");
    const forged = await signOauthCookie(
      STATE_SECRET,
      flowState({ returnTo: "https://evil.example/", state: flow.state }),
    );
    const response = await callback(h, "github", flow, { cookie: `${OAUTH_COOKIE}=${forged}` });
    expect(response.status).toBe(400);
    expect(await textOf(response)).toContain("return_to.invalid");
    expectEnded(response);
    expect(response.headers.get("Location")).toBeNull();
    expect(h.stub.calls).toEqual([]);
  });

  it("answers only the two providers' callbacks, and only GET", async () => {
    const h = await harness();
    expect((await h.request("/callback/facebook?code=x&state=y")).status).toBe(404);
    expect((await h.request("/callback/github/extra")).status).toBe(404);
    expect((await h.request("/callback")).status).toBe(404);
    expect((await h.request("/callback/GitHub?code=x&state=y")).status).toBe(404);
    expect((await h.request("/callback/github", { method: "POST" })).status).toBe(404);
  });
});

describe("how long a flow may take", () => {
  it("accepts the callback after ten minutes exactly and refuses it a moment later", async () => {
    const h = await harness();
    const early = await startFlow(h, "github");
    h.clock.advance(10 * 60 * 1000);
    expect((await callback(h, "github", early)).status).toBe(302);

    const late = await startFlow(h, "github");
    h.clock.advance(10 * 60 * 1000 + 1);
    const response = await callback(h, "github", late);
    expect(response.status).toBe(400);
    expect(await textOf(response)).toContain("state.mismatch");
    expectEnded(response);
  });

  it("refuses a flow issued an hour ago, even with the right state and signature", async () => {
    const h = await harness();
    const flow = await startFlow(h, "google");
    h.clock.advance(60 * 60 * 1000);
    const callsBefore = h.stub.calls.length;
    const response = await callback(h, "google", flow);
    expect(response.status).toBe(400);
    expect(await textOf(response)).toContain("state.mismatch");
    expect(h.stub.calls.length).toBe(callsBefore);
  });
});

describe("what the provider says before any code", () => {
  it("checks the state before it looks at the error", async () => {
    const h = await harness();
    const flow = await startFlow(h, "github");
    const wrongState = await callback(h, "github", flow, {
      state: "wrong",
      error: "access_denied",
    });
    expect(wrongState.status).toBe(400);
    const html = await textOf(wrongState);
    expect(html).toContain("state.mismatch");
    expect(html).not.toContain("provider.denied");

    const noCookie = await callback(h, "github", flow, { cookie: null, error: "access_denied" });
    expect(await textOf(noCookie)).toContain("state.mismatch");
  });

  it("the person declined: a provider.denied page with a link to /login and the same return address", async () => {
    const h = await harness();
    const writes = watchWrites(h);
    const returnTo = "https://diagrams.meltemi.dev/p/abc?x=1";
    const flow = await startFlow(h, "github", { query: { return_to: returnTo } });
    const response = await callback(h, "github", flow, { code: undefined, error: "access_denied" });
    expect(response.status).toBe(400);
    const html = await textOf(response);
    expect(html).toContain("provider.denied");
    expect(hrefsOf(html)).toEqual(
      expect.arrayContaining([`/login?return_to=${encodeURIComponent(returnTo)}`, returnTo]),
    );
    expectEnded(response);
    expect(sessionCookies(response)).toEqual([]);
    expectNoWrites(writes);
    expect(h.stub.calls).toEqual([]);
  });

  it("a denial wins over a code that came with it", async () => {
    const h = await harness();
    const flow = await startFlow(h, "google");
    const response = await callback(h, "google", flow, { error: "access_denied" });
    expect(await textOf(response)).toContain("provider.denied");
    expect(h.stub.calls).toEqual([]);
  });

  it("says nothing the provider said: a hostile description is not shown", async () => {
    const h = await harness();
    const flow = await startFlow(h, "github");
    const query = new URLSearchParams({
      state: flow.state,
      error: "access_denied",
      error_description: "<script>alert(1)</script>",
      error_uri: "https://evil.example/",
    });
    const response = await h.request(`/callback/github?${query}`, {
      headers: { Cookie: flow.cookie },
    });
    const html = await textOf(response);
    expect(html).toContain("provider.denied");
    expect(html).not.toContain("script");
    expect(html).not.toContain("evil.example");
  });

  it.each(["server_error", "temporarily_unavailable", "invalid_scope", "access_denied_x", ""])(
    "any other error (%j) is a 502 provider.unavailable",
    async (error) => {
      const h = await harness();
      const flow = await startFlow(h, "google");
      const response = await callback(h, "google", flow, { error });
      expect(response.status).toBe(502);
      expect(await textOf(response)).toContain("provider.unavailable");
      expectEnded(response);
      expect(h.stub.calls).toEqual([]);
    },
  );

  it.each([undefined, ""])(
    "a callback without a code (%j) is a 400 state.mismatch",
    async (code) => {
      const h = await harness();
      const flow = await startFlow(h, "github", {
        query: { return_to: "https://diagrams.meltemi.dev/" },
      });
      const response = await callback(h, "github", flow, { code });
      expect(response.status).toBe(400);
      const html = await textOf(response);
      expect(html).toContain("state.mismatch");
      expectEnded(response);
      expect(h.stub.calls).toEqual([]);
      // The way forward keeps the return address of the flow, which is ours to trust.
      expect(hrefsOf(html)).toContain(
        `/login?return_to=${encodeURIComponent("https://diagrams.meltemi.dev/")}`,
      );
    },
  );

  it("the error pages of a callback in Spanish say the same code in Spanish words", async () => {
    const h = await harness();
    const flow = await startFlow(h, "github");
    const response = await callback(h, "github", flow, {
      error: "access_denied",
      headers: { "Accept-Language": "es" },
    });
    const html = await textOf(response);
    expect(langOf(html)).toBe("es");
    expect(html).toContain("provider.denied");
    expect(html).toContain("Código");
  });
});

describe("the provider is down", () => {
  const failures: [string, Provider, (h: Harness) => void][] = [
    [
      "GitHub's token endpoint answers 503",
      "github",
      (h) => void (h.stub.github.tokenStatus = 503),
    ],
    [
      "GitHub's token endpoint answers 401",
      "github",
      (h) => void (h.stub.github.tokenStatus = 401),
    ],
    [
      "GitHub's token endpoint answers 200 with an error",
      "github",
      (h) =>
        interceptFetch(h, (url) =>
          url === GITHUB_TOKEN_URL ? json({ error: "bad_verification_code" }) : undefined,
        ),
    ],
    [
      "GitHub's token endpoint answers something that is not JSON",
      "github",
      (h) =>
        interceptFetch(h, (url) =>
          url === GITHUB_TOKEN_URL ? new Response("<html>oops</html>") : undefined,
        ),
    ],
    [
      "GitHub's token endpoint answers JSON without a token",
      "github",
      (h) => interceptFetch(h, (url) => (url === GITHUB_TOKEN_URL ? json({}) : undefined)),
    ],
    [
      "GitHub's token endpoint cannot be reached",
      "github",
      (h) =>
        interceptFetch(h, (url) => {
          if (url === GITHUB_TOKEN_URL)
            throw new TypeError("fetch failed stub-github-access-token");
          return undefined;
        }),
    ],
    ["GitHub's user endpoint answers 500", "github", (h) => void (h.stub.github.userStatus = 500)],
    [
      "GitHub's user has no id",
      "github",
      (h) =>
        interceptFetch(h, (url) => (url === GITHUB_USER_URL ? json({ login: "x" }) : undefined)),
    ],
    [
      "GitHub's user is not an object",
      "github",
      (h) => interceptFetch(h, (url) => (url === GITHUB_USER_URL ? json([1]) : undefined)),
    ],
    [
      "GitHub's user is not JSON",
      "github",
      (h) =>
        interceptFetch(h, (url) => (url === GITHUB_USER_URL ? new Response("nope") : undefined)),
    ],
    [
      "GitHub's user id is 129 characters long",
      "github",
      (h) =>
        interceptFetch(h, (url) =>
          url === GITHUB_USER_URL ? json({ id: "9".repeat(129), login: "x" }) : undefined,
        ),
    ],
    [
      "GitHub's user id holds a control character",
      "github",
      (h) =>
        interceptFetch(h, (url) =>
          url === GITHUB_USER_URL ? json({ id: "9\n9", login: "x" }) : undefined,
        ),
    ],
    ["GitHub's emails answer 500", "github", (h) => void (h.stub.github.emailsStatus = 500)],
    [
      "GitHub's emails are not a list",
      "github",
      (h) =>
        interceptFetch(h, (url) =>
          url === GITHUB_EMAILS_URL ? json({ message: "Not Found" }) : undefined,
        ),
    ],
    [
      "Google's token endpoint answers 503",
      "google",
      (h) => void (h.stub.google.tokenStatus = 503),
    ],
    [
      "Google's token endpoint answers without a token",
      "google",
      (h) =>
        interceptFetch(h, (url) =>
          url === GOOGLE_TOKEN_URL ? json({ id_token: "x" }) : undefined,
        ),
    ],
    [
      "Google's token endpoint cannot be reached",
      "google",
      (h) =>
        interceptFetch(h, (url) => {
          if (url === GOOGLE_TOKEN_URL) throw new Error("socket hang up");
          return undefined;
        }),
    ],
    ["Google's userinfo answers 500", "google", (h) => void (h.stub.google.userinfoStatus = 500)],
    [
      "Google's sub is 129 characters long",
      "google",
      (h) =>
        interceptFetch(h, (url) =>
          url === GOOGLE_USERINFO_URL
            ? json({ sub: "s".repeat(129), email: "ana@example.com" })
            : undefined,
        ),
    ],
    [
      "Google's sub holds a control character",
      "google",
      (h) =>
        interceptFetch(h, (url) =>
          url === GOOGLE_USERINFO_URL
            ? json({ sub: "s\u0000s", email: "ana@example.com" })
            : undefined,
        ),
    ],
    [
      "Google's userinfo has no sub",
      "google",
      (h) =>
        interceptFetch(h, (url) =>
          url === GOOGLE_USERINFO_URL ? json({ email: "ana@example.com" }) : undefined,
        ),
    ],
    [
      "Google's userinfo is not JSON",
      "google",
      (h) =>
        interceptFetch(h, (url) => (url === GOOGLE_USERINFO_URL ? new Response("") : undefined)),
    ],
  ];

  it.each(failures)(
    "%s: a 502 provider.unavailable, no user, no session, the cookie cleared",
    async (_name, provider, arrange) => {
      const h = await harness();
      arrange(h);
      const writes = watchWrites(h);
      const returnTo = "https://diagrams.meltemi.dev/p/abc";
      const { response } = await signIn(h, provider, { query: { return_to: returnTo } });
      expect(response.status).toBe(502);
      const html = await textOf(response);
      expect(html).toContain("provider.unavailable");
      expectEnded(response);
      expect(sessionCookies(response)).toEqual([]);
      expect(response.headers.get("Location")).toBeNull();
      expectNoWrites(writes);
      expect(await h.store.identity("github", "4242")).toBeUndefined();
      expect(await h.store.identity("google", "g-7777")).toBeUndefined();
      // A way forward: try the same provider again, or choose, with the same return address.
      expect(hrefsOf(html)).toEqual(
        expect.arrayContaining([
          `/login?provider=${provider}&return_to=${encodeURIComponent(returnTo)}`,
          `/login?return_to=${encodeURIComponent(returnTo)}`,
        ]),
      );
      // The failure is logged for the operator, with no token and no secret.
      expect(log.lines()).toContain(`identity: ${provider} sign-in failed`);
      for (const secret of [
        "stub-github-access-token",
        "stub-google-access-token",
        "test-github-secret",
        "test-google-secret",
        "stub-code",
      ]) {
        expect(log.lines()).not.toContain(secret);
        expect(html).not.toContain(secret);
      }
    },
  );

  it("a provider that never answers is given up on after ten seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const h = await harness();
      const flow = await startFlow(h, "github");
      let started!: () => void;
      const asked = new Promise<void>((resolve) => (started = resolve));
      interceptFetch(h, (url, init) => {
        if (url !== GITHUB_TOKEN_URL) return undefined;
        started();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      });
      let settled = false;
      const pending = callback(h, "github", flow);
      void pending.then(() => (settled = true));
      await asked;
      await vi.advanceTimersByTimeAsync(9_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const response = await pending;
      expect(response.status).toBe(502);
      expect(await textOf(response)).toContain("provider.unavailable");
      expectEnded(response);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("an unusable provider id", () => {
  it.each([
    ["github", GITHUB_USER_URL, { id: "9".repeat(129), login: "ana-dev", name: "Ana" }],
    ["google", GOOGLE_USERINFO_URL, { sub: "s".repeat(129), email: "ana@example.com" }],
  ] as const)(
    "%s: a 502 before anything is looked up, created or stored, and the id is not repeated",
    async (provider, address, answer) => {
      const h = await harness();
      interceptFetch(h, (url) => (url === address ? json(answer) : undefined));
      const writes = watchWrites(h);
      const lookups = vi.spyOn(h.store, "identity");
      const updates = vi.spyOn(h.store, "updateIdentity");
      const { response } = await signIn(h, provider);

      expect(response.status).toBe(502);
      const html = await textOf(response);
      expect(html).toContain("provider.unavailable");
      expectEnded(response);
      expect(sessionCookies(response)).toEqual([]);
      expectNoWrites(writes);
      expect(lookups).not.toHaveBeenCalled();
      expect(updates).not.toHaveBeenCalled();
      expect(log.lines()).toContain(
        `identity: ${provider} sign-in failed: ${provider === "github" ? "GitHub" : "Google"}: the account id is not usable`,
      );
      expect(log.lines() + html).not.toMatch(/9{20}|s{20}/);
    },
  );

  it("an id of exactly 128 characters signs in and is stored whole", async () => {
    const h = await harness();
    h.stub.google.userinfo = { ...h.stub.google.userinfo, sub: "s".repeat(128) };
    const { response } = await signIn(h, "google");
    expect(response.status).toBe(302);
    expect(await h.store.identity("google", "s".repeat(128))).toBeDefined();
  });
});

describe("a profile with no limits", () => {
  // Every field at its limit, written to cost the most in the token: a name of characters that
  // take four bytes, an address of characters that take three, and a picture whose every
  // character JSON writes with a backslash.
  const origin = "https://a.example/";
  const WORST = {
    name: "😀".repeat(100),
    email: `a@${"€".repeat(252)}`,
    picture: origin + '"'.repeat(512 - origin.length),
    handle: "h".repeat(100),
  };
  const COOKIE_PREFIX = "meltemi_session=";

  /** The same person for both providers, from the numbers a test chooses. */
  function arrange(h: Harness, provider: Provider, p: typeof WORST & { providerId?: string }) {
    if (provider === "github") {
      h.stub.github.user = {
        id: 4242,
        login: p.handle,
        name: p.name,
        avatar_url: p.picture,
      };
      h.stub.github.emails = [{ email: p.email, primary: true, verified: true }];
    } else {
      h.stub.google.userinfo = {
        sub: p.providerId ?? "s".repeat(128),
        email: p.email,
        email_verified: true,
        name: p.name,
        picture: p.picture,
      };
    }
  }

  async function storedUser(h: Harness, provider: Provider) {
    const identity = (await h.store.identity(
      provider,
      provider === "github" ? "4242" : "s".repeat(128),
    ))!;
    return { identity, user: (await h.store.userById(identity.userId))! };
  }

  it.each(PROVIDERS)(
    "%s: the worst profile that is accepted signs in, and its token fits a cookie and verifies",
    async (provider) => {
      const h = await harness();
      arrange(h, provider, WORST);
      const { response } = await signIn(h, provider);
      expect(response.status).toBe(302);

      const { token, claims } = await sessionOf(h, response);
      expect(token.length).toBeLessThan(4096);
      // A browser counts the name of a cookie too.
      expect(COOKIE_PREFIX.length + token.length).toBeLessThanOrEqual(4096);
      expect(claims).toMatchObject({
        name: WORST.name,
        picture: WORST.picture,
        email: WORST.email,
        email_verified: true,
      });

      // Nothing was cut: the profile was at its limits, not over them.
      const { identity, user } = await storedUser(h, provider);
      expect([...user.name]).toHaveLength(100);
      expect(user.picture).toHaveLength(512);
      expect(identity.email).toHaveLength(254);
      expect(identity.handle).toBe(provider === "github" ? WORST.handle : "");

      // The person is signed in, not signed out at once.
      const account = await h.request("/account", {
        headers: { Cookie: `${COOKIE_PREFIX}${token}` },
      });
      expect(account.status).toBe(200);
    },
  );

  it.each(PROVIDERS)(
    "%s: a profile of several thousand characters per field still signs the person in",
    async (provider) => {
      const h = await harness();
      arrange(h, provider, {
        name: "ñ".repeat(5000),
        email: `${"e".repeat(5000)}@example.com`,
        picture: origin + "p".repeat(5000),
        handle: "h".repeat(5000),
      });
      const { response } = await signIn(h, provider);
      expect(response.status).toBe(302);

      const { token, claims } = await sessionOf(h, response);
      // The name is cut, the address and the picture are no address and no picture.
      expect(claims).toMatchObject({
        name: "ñ".repeat(100),
        picture: "",
        email: "",
        email_verified: false,
      });
      expect(token.length).toBeLessThan(1500);

      const { identity, user } = await storedUser(h, provider);
      expect(user).toMatchObject({ name: "ñ".repeat(100), picture: "" });
      expect(identity).toMatchObject({ email: "", emailVerified: false, verifiedAt: null });
      expect(identity.handle).toBe("");

      const account = await h.request("/account", {
        headers: { Cookie: `${COOKIE_PREFIX}${token}` },
      });
      expect(account.status).toBe(200);
    },
  );

  it.each(PROVIDERS)(
    "%s: control characters, a picture that is not https and an address with spaces are cleaned before anything is stored",
    async (provider) => {
      const h = await harness();
      arrange(h, provider, {
        name: "  Ana\u0000 \u0007Dev\n",
        email: "ana @example.com",
        picture: "http://avatars.example.com/u/1",
        handle: "ana\u0000-dev",
      });
      const { response } = await signIn(h, provider);
      expect(response.status).toBe(302);

      const { claims } = await sessionOf(h, response);
      expect(claims).toMatchObject({
        name: "Ana Dev",
        picture: "",
        email: "",
        email_verified: false,
      });
      const { identity, user } = await storedUser(h, provider);
      expect(user).toMatchObject({ name: "Ana Dev", picture: "" });
      expect(identity).toMatchObject({ email: "", emailVerified: false, verifiedAt: null });
      expect(identity.handle).toBe(provider === "github" ? "ana-dev" : "");
      expect(await heldAbout(h, user.id)).not.toMatch(/\\u0000|\\u0007/);
    },
  );

  it("an address with a control character is never repaired into the one it resembles", async () => {
    // GitHub reports a verified "ana@example.com\n": it is no email at all. Had the newline been
    // dropped, it would be the address Google verified and the two identities would merge.
    const h = await harness();
    const first = await signIn(h, "google");
    expect(first.response.status).toBe(302);
    h.stub.github.emails = [{ email: "ana@example.com\n", primary: true, verified: true }];
    const second = await signIn(h, "github");
    expect(second.response.status).toBe(302);
    const google = (await h.store.identity("google", "g-7777"))!;
    const github = (await h.store.identity("github", "4242"))!;
    expect(github.userId).not.toBe(google.userId);
    expect(github).toMatchObject({ email: "", emailVerified: false, verifiedAt: null });
  });

  it("the same identity again: a picture the rules refuse leaves the one the user has", async () => {
    const h = await harness();
    await signIn(h, "github");
    const identity = (await h.store.identity("github", "4242"))!;
    h.clock.advance(DAY);
    h.stub.github.user = { ...h.stub.github.user, avatar_url: "http://example.com/a.png" };
    const second = await signIn(h, "github");
    expect(second.response.status).toBe(302);
    expect(await h.store.userById(identity.userId)).toMatchObject({
      picture: "https://avatars.githubusercontent.com/u/4242",
    });
  });
});

describe("a failure of the service itself", () => {
  it("is a 500 page with no detail, and the cookie is still cleared", async () => {
    const h = await harness();
    const flow = await startFlow(h, "github");
    h.store.createUser = async () => {
      throw new Error("disk full: ana@example.com");
    };
    const response = await callback(h, "github", flow);
    expect(response.status).toBe(500);
    const html = await textOf(response);
    expect(html).toContain("internal");
    expect(html).not.toContain("disk full");
    expect(html).not.toContain("ana@example.com");
    expectEnded(response);
    expect(sessionCookies(response)).toEqual([]);
    expect(hrefsOf(html)).toContain("/login");
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(log.lines()).not.toContain("stub-github-access-token");
  });
});

describe("the same identity again", () => {
  it("creates no user, refreshes the profile and opens a new session", async () => {
    const h = await harness();
    const first = await signIn(h, "github");
    const identity = (await h.store.identity("github", "4242"))!;

    h.clock.advance(3 * DAY);
    h.stub.github.user = {
      ...h.stub.github.user,
      name: "Ana Renamed",
      login: "ana-renamed",
      avatar_url: "https://avatars.githubusercontent.com/u/4242?v=2",
    };
    h.stub.github.emails = [{ email: "new@example.com", primary: true, verified: true }];
    const writes = watchWrites(h);
    const second = await signIn(h, "github");

    expect(second.response.status).toBe(302);
    expect(writes.users).not.toHaveBeenCalled();
    expect(writes.identities).not.toHaveBeenCalled();
    expect(writes.sessions).toHaveBeenCalledTimes(1);
    expect(await h.store.userById(identity.userId)).toEqual({
      id: identity.userId,
      name: "Ana Renamed",
      picture: "https://avatars.githubusercontent.com/u/4242?v=2",
      createdAt: "2026-10-14T12:00:00.000Z",
    });
    expect(await h.store.identity("github", "4242")).toEqual({
      ...identity,
      email: "new@example.com",
      handle: "ana-renamed",
      verifiedAt: "2026-10-17T12:00:00.000Z",
      linkedAt: identity.linkedAt,
    });
    const a = await sessionOf(h, first.response);
    const b = await sessionOf(h, second.response);
    expect(b.claims!.sub).toBe(a.claims!.sub);
    expect(b.claims!.sid).not.toBe(a.claims!.sid);
    expect(b.claims).toMatchObject({ name: "Ana Renamed", email: "new@example.com" });
  });

  it("marks the email unverified, and clears verified_at, when the provider stops vouching", async () => {
    const h = await harness();
    await signIn(h, "github");
    h.clock.advance(DAY);
    h.stub.github.emails = [{ email: "ana@example.com", primary: true, verified: false }];
    await signIn(h, "github");
    expect(await h.store.identity("github", "4242")).toMatchObject({
      email: "ana@example.com",
      emailVerified: false,
      verifiedAt: null,
    });
  });

  it("a new sign-in replaces the session of the browser", async () => {
    const h = await harness();
    const person = await signedInPerson(h, { provider: "github", providerId: "4242" });
    const { response } = await signIn(h, "github", { cookies: [person.cookie] });
    expect(response.status).toBe(302);
    const { claims } = await sessionOf(h, response);
    expect(claims!.sub).toBe(person.user.id);
    expect(claims!.sid).not.toBe(person.session.sid);
    expect(sessionCookies(response)).toHaveLength(1);
  });

  it("a signed-in person who signs in as someone else is that someone else", async () => {
    const h = await harness();
    const first = await signedInPerson(h, {
      id: "user-first",
      providerId: "other-github",
      email: "first@example.com",
    });
    const { response } = await signIn(h, "github", { cookies: [first.cookie] });
    const { claims } = await sessionOf(h, response);
    expect(claims!.sub).not.toBe("user-first");
    expect((await h.store.identity("github", "4242"))!.userId).toBe(claims!.sub);
  });
});

describe("emails", () => {
  it("GitHub with no verified email: the primary one is kept, marked unverified", async () => {
    const h = await harness();
    h.stub.github.emails = [
      { email: "other@example.com", primary: false, verified: true },
      { email: "ana@example.com", primary: true, verified: false },
    ];
    const { response } = await signIn(h, "github");
    expect(response.status).toBe(302);
    expect(await h.store.identity("github", "4242")).toMatchObject({
      email: "ana@example.com",
      emailVerified: false,
      verifiedAt: null,
    });
    expect((await sessionOf(h, response)).claims).toMatchObject({
      email: "ana@example.com",
      email_verified: false,
    });
  });

  it("GitHub with no email at all: the account has none", async () => {
    const h = await harness();
    h.stub.github.emails = [];
    const { response } = await signIn(h, "github");
    expect(response.status).toBe(302);
    expect(await h.store.identity("github", "4242")).toMatchObject({
      email: "",
      emailVerified: false,
      verifiedAt: null,
    });
    expect((await sessionOf(h, response)).claims).toMatchObject({
      email: "",
      email_verified: false,
    });
  });

  it("an unverified email never merges, even into the account that holds it", async () => {
    const h = await harness();
    const owner = await signedInPerson(h, {
      provider: "github",
      providerId: "someone",
      email: "ana@example.com",
    });
    h.stub.google.userinfo = { ...h.stub.google.userinfo, email_verified: false };
    const { response } = await signIn(h, "google");
    expect(response.status).toBe(302); // no account-exists page: nothing matched
    const identity = (await h.store.identity("google", "g-7777"))!;
    expect(identity.userId).not.toBe(owner.user.id);
    expect(await h.store.identitiesOf(owner.user.id)).toHaveLength(1);
  });

  it("an existing identity that was never verified does not take part either", async () => {
    const h = await harness();
    const owner = await signedInPerson(h, {
      provider: "github",
      providerId: "someone",
      email: "ana@example.com",
      emailVerified: false,
    });
    const { response } = await signIn(h, "google");
    expect(response.status).toBe(302);
    expect((await h.store.identity("google", "g-7777"))!.userId).not.toBe(owner.user.id);
  });
});

describe("two providers, one mailbox", () => {
  it("attaches a verified Google identity to the user whose GitHub identity verified the same email ten days ago", async () => {
    const h = await harness();
    const owner = await signedInPerson(h, {
      provider: "github",
      providerId: "gh-owner",
      email: "ana@example.com",
      name: "Ana Dev",
    });
    h.clock.advance(10 * DAY);
    h.stub.google.userinfo = { ...h.stub.google.userinfo, name: "Ana from Google" };
    const writes = watchWrites(h);
    const { response } = await signIn(h, "google", {
      query: { return_to: "https://diagrams.meltemi.dev/" },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://diagrams.meltemi.dev/");
    expect(writes.users).not.toHaveBeenCalled();
    const identity = (await h.store.identity("google", "g-7777"))!;
    expect(identity.userId).toBe(owner.user.id);
    expect(identity.verifiedAt).toBe("2026-10-24T12:00:00.000Z");
    expect((await h.store.identitiesOf(owner.user.id)).map((i) => i.provider)).toEqual([
      "github",
      "google",
    ]);
    // The person signs in as the existing user, whose profile is not overwritten.
    const { claims } = await sessionOf(h, response);
    expect(claims).toMatchObject({ sub: owner.user.id, name: "Ana Dev" });
    expect((await h.store.userById(owner.user.id))!.name).toBe("Ana Dev");
  });

  it("matches the email whatever its case", async () => {
    const h = await harness();
    const owner = await signedInPerson(h, {
      provider: "github",
      providerId: "gh-owner",
      email: "ANA@Example.COM",
    });
    const { response } = await signIn(h, "google");
    expect(response.status).toBe(302);
    expect((await h.store.identity("google", "g-7777"))!.userId).toBe(owner.user.id);

    const other = await harness();
    const second = await signedInPerson(other, {
      provider: "github",
      providerId: "gh-owner",
      email: "ana@example.com",
    });
    other.stub.google.userinfo = { ...other.stub.google.userinfo, email: "Ana@EXAMPLE.com" };
    await signIn(other, "google");
    expect((await other.store.identity("google", "g-7777"))!.userId).toBe(second.user.id);
  });

  it("a stale verified email creates a new user, signs it in and says an account exists", async () => {
    const h = await harness();
    const owner = await signedInPerson(h, {
      provider: "github",
      providerId: "gh-owner",
      email: "ana@example.com",
    });
    h.clock.advance(91 * DAY);
    const returnTo = "https://diagrams.meltemi.dev/p/abc";
    const { response } = await signIn(h, "google", { query: { return_to: returnTo } });

    expect(response.status).toBe(200);
    expectEnded(response);
    expect(response.headers.get("Location")).toBeNull();
    const html = await textOf(response);
    expect(html).toContain("An account with this email already exists");
    expect(html).toContain("GitHub");
    expect(hrefsOf(html)).toEqual(
      expect.arrayContaining([
        `/login?provider=github&return_to=${encodeURIComponent(returnTo)}`,
        "/account",
        returnTo,
      ]),
    );
    expect(langOf(html)).toBe("en");

    // A new user holds the Google identity and is the one signed in; the old account is untouched.
    const identity = (await h.store.identity("google", "g-7777"))!;
    expect(identity.userId).not.toBe(owner.user.id);
    expect(await h.store.identitiesOf(owner.user.id)).toHaveLength(1);
    const { claims } = await sessionOf(h, response);
    expect(claims).toMatchObject({ sub: identity.userId, email: "ana@example.com" });
    expect(await h.store.identitiesOf(identity.userId)).toHaveLength(1);
  });

  it("the account-exists page is personal, under the policy, and in Spanish for a Spanish browser", async () => {
    const h = await harness();
    await signedInPerson(h, {
      provider: "github",
      providerId: "gh-owner",
      email: "ana@example.com",
    });
    h.clock.advance(120 * DAY);
    const { response } = await signIn(h, "google", {
      headers: { "Accept-Language": "es-CL,es;q=0.9" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "form-action 'self' https://meltemi.dev",
    );
    const html = await textOf(response);
    expect(langOf(html)).toBe("es");
    expect(html).toContain("Ya existe una cuenta con este correo");
    expect(html).toContain("Iniciar sesión con GitHub");
    expect(hrefsOf(html)).toEqual(
      expect.arrayContaining(["https://meltemi.dev/es/privacy/", "https://meltemi.dev/es/terms/"]),
    );
  });

  it("escapes a hostile name and email in the account-exists page", async () => {
    const h = await harness();
    const hostile = `a"b<i>@example.com`;
    await signedInPerson(h, { provider: "github", providerId: "gh-owner", email: hostile });
    h.clock.advance(100 * DAY);
    h.stub.google.userinfo = {
      ...h.stub.google.userinfo,
      name: "<b>x</b>",
      email: hostile,
      picture: `https://lh3.googleusercontent.com/a/"><script>alert(1)</script>`,
    };
    const { response } = await signIn(h, "google");
    expect(response.status).toBe(200);
    const html = await textOf(response);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("a&quot;b&lt;i&gt;@example.com");
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<i>");
    expect(html).not.toContain("<script");
    expect(response.headers.get("Content-Security-Policy")).toMatch(/^default-src 'none'/);
  });
});

describe("linking a provider while signed in", () => {
  it("attaches the new identity to the current user, whatever its email, and keeps the session", async () => {
    const h = await harness();
    const person = await signedInPerson(h, {
      provider: "github",
      providerId: "gh-owner",
      email: "ana@work.example",
    });
    const writes = watchWrites(h);
    const flow = await startFlow(h, "google", {
      query: { link: "1", return_to: "https://id.meltemi.dev/account" },
      headers: { Cookie: person.cookie },
    });
    const response = await callback(h, "google", flow, { cookies: [person.cookie] });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://id.meltemi.dev/account");
    expectEnded(response);
    // The session is the one the person already has: no new cookie, no new row.
    expect(sessionCookies(response)).toEqual([]);
    expect(writes.sessions).not.toHaveBeenCalled();
    expect(writes.users).not.toHaveBeenCalled();
    expect(await h.store.session(person.session.sid)).toMatchObject({ revokedAt: null });

    const identities = await h.store.identitiesOf(person.user.id);
    expect(identities.map((i) => [i.provider, i.providerId, i.email])).toEqual([
      ["github", "gh-owner", "ana@work.example"],
      ["google", "g-7777", "ana@example.com"],
    ]);
    expect((await h.store.identity("google", "g-7777"))!.userId).toBe(person.user.id);
    // The user's name stays the user's: linking is not a sign-in as the other provider.
    expect(await h.store.userById(person.user.id)).toMatchObject({ name: "Ana Dev" });
  });

  it("links GitHub just the same", async () => {
    const h = await harness();
    const person = await signedInPerson(h, { provider: "google", providerId: "g-owner" });
    const flow = await startFlow(h, "github", {
      query: { link: "1", return_to: "https://id.meltemi.dev/account" },
      headers: { Cookie: person.cookie },
    });
    const response = await callback(h, "github", flow, { cookies: [person.cookie] });
    expect(response.status).toBe(302);
    expect((await h.store.identity("github", "4242"))!.userId).toBe(person.user.id);
  });

  it("an identity that belongs to another user is refused with identity.taken and nothing changes", async () => {
    const h = await harness();
    const other = await signedInPerson(h, {
      id: "user-b",
      name: "Bea",
      provider: "google",
      providerId: "g-7777",
      email: "bea@example.com",
    });
    const person = await signedInPerson(h, {
      id: "user-a",
      provider: "github",
      providerId: "gh-a",
    });
    const before = {
      identity: await h.store.identity("google", "g-7777"),
      a: await h.store.identitiesOf("user-a"),
      b: await h.store.identitiesOf("user-b"),
      userB: await h.store.userById("user-b"),
    };
    const writes = watchWrites(h);
    const flow = await startFlow(h, "google", {
      query: { link: "1", return_to: "https://id.meltemi.dev/account" },
      headers: { Cookie: person.cookie },
    });
    const response = await callback(h, "google", flow, { cookies: [person.cookie] });

    expect(response.status).toBe(409);
    const html = await textOf(response);
    expect(html).toContain("identity.taken");
    expect(html).toContain(en.signin.takenTitle);
    expect(hrefsOf(html)).toContain("https://id.meltemi.dev/account");
    expectEnded(response);
    expect(sessionCookies(response)).toEqual([]);
    expectNoWrites(writes);
    expect(await h.store.identity("google", "g-7777")).toEqual(before.identity);
    expect(await h.store.identitiesOf("user-a")).toEqual(before.a);
    expect(await h.store.identitiesOf("user-b")).toEqual(before.b);
    // Nothing of the other account's profile was touched by the refused attempt.
    expect(await h.store.userById("user-b")).toEqual(before.userB);
    expect(await h.store.session(person.session.sid)).toMatchObject({ revokedAt: null });
    expect(await h.store.session(other.session.sid)).toMatchObject({ revokedAt: null });
    // The page tells nothing about the other account.
    expect(html).not.toContain("Bea");
    expect(html).not.toContain("bea@example.com");
  });

  it("the refusal is in Spanish for a Spanish browser", async () => {
    const h = await harness();
    await signedInPerson(h, {
      id: "user-b",
      provider: "google",
      providerId: "g-7777",
      email: "bea@example.com",
    });
    const person = await signedInPerson(h, {
      id: "user-a",
      provider: "github",
      providerId: "gh-a",
      email: "a@example.com",
    });
    const headers = { Cookie: person.cookie, "Accept-Language": "es" };
    const flow = await startFlow(h, "google", {
      query: { link: "1", return_to: "https://id.meltemi.dev/account" },
      headers,
    });
    const response = await callback(h, "google", flow, {
      cookies: [person.cookie],
      headers: { "Accept-Language": "es" },
    });
    expect(response.status).toBe(409);
    const html = await textOf(response);
    expect(langOf(html)).toBe("es");
    expect(html).toContain(es.signin.takenTitle);
    expect(html).toContain("identity.taken");
  });

  it("linking an identity the user already holds changes no ownership and keeps the session", async () => {
    const h = await harness();
    const person = await signedInPerson(h, {
      id: "user-a",
      provider: "google",
      providerId: "g-7777",
      email: "ana@example.com",
    });
    const flow = await startFlow(h, "google", {
      query: { link: "1", return_to: "https://id.meltemi.dev/account" },
      headers: { Cookie: person.cookie },
    });
    const response = await callback(h, "google", flow, { cookies: [person.cookie] });
    expect(response.status).toBe(302);
    expect(sessionCookies(response)).toEqual([]);
    expect(await h.store.identitiesOf("user-a")).toHaveLength(1);
  });

  it("without a session at the start, link=1 is an ordinary sign-in", async () => {
    const h = await harness();
    const { flow, response } = await signIn(h, "google", {
      query: { link: "1", return_to: "https://id.meltemi.dev/account" },
    });
    expect(decodeOauth(flow.value).payload).not.toHaveProperty("link");
    expect(response.status).toBe(302);
    expect(sessionCookies(response)).toHaveLength(1);
    expect(await h.store.identity("google", "g-7777")).toBeDefined();
  });

  it("when the session is gone by the callback, the link request lapses into an ordinary sign-in", async () => {
    const h = await harness();
    const person = await signedInPerson(h, {
      id: "user-a",
      provider: "github",
      providerId: "gh-a",
      email: "a@example.com",
    });
    const flow = await startFlow(h, "google", {
      query: { link: "1", return_to: "https://id.meltemi.dev/account" },
      headers: { Cookie: person.cookie },
    });
    // Signed out in another tab while the person was at Google.
    await h.store.revokeSession(person.session.sid, h.clock.now().toISOString());
    const response = await callback(h, "google", flow, { cookies: [person.cookie] });
    expect(response.status).toBe(302);
    expect(sessionCookies(response)).toHaveLength(1);
    const identity = (await h.store.identity("google", "g-7777"))!;
    expect(identity.userId).not.toBe("user-a");
    expect(await h.store.identitiesOf("user-a")).toHaveLength(1);
  });

  it("when another user is signed in by the callback, the link is not made for them either", async () => {
    const h = await harness();
    const a = await signedInPerson(h, {
      id: "user-a",
      provider: "github",
      providerId: "gh-a",
      email: "a@example.com",
    });
    const b = await signedInPerson(h, {
      id: "user-b",
      provider: "github",
      providerId: "gh-b",
      email: "b@example.com",
    });
    const flow = await startFlow(h, "google", {
      query: { link: "1", return_to: "https://id.meltemi.dev/account" },
      headers: { Cookie: a.cookie },
    });
    const response = await callback(h, "google", flow, { cookies: [b.cookie] });
    expect(response.status).toBe(302);
    const identity = (await h.store.identity("google", "g-7777"))!;
    expect(identity.userId).not.toBe("user-a");
    expect(identity.userId).not.toBe("user-b");
    expect(await h.store.identitiesOf("user-a")).toHaveLength(1);
    expect(await h.store.identitiesOf("user-b")).toHaveLength(1);
  });
});
