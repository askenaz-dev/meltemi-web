// Test support: everything a test of the identity service needs, with no network and no cloud.
// `harness()` builds an environment, a fake clock, generated keys, an in-memory store and stub
// providers, and gives `request()` to call the service as a browser would.

import { readConfig } from "../../src/config.js";
import type { Env } from "../../src/env.js";
import { identity } from "../../src/handler.js";
import { importSigningKeys } from "../../src/jwt.js";
import { startSession } from "../../src/session.js";
import { memoryStore } from "../../src/store/memory.js";
import type { IdentityStore } from "../../src/store/types.js";
import { testKeys, type TestKeys } from "../../src/testing.js";
import type { Deps, Identity, Provider, Session, User } from "../../src/types.js";

export { memoryStore, testKeys };

// ---------------------------------------------------------------------------------------------
// A clock that only moves when a test says so.

export interface FakeClock {
  now(): Date;
  /** Moves the clock to an ISO time. */
  set(iso: string): void;
  advance(ms: number): void;
}

export function fakeClock(start = "2026-10-14T12:00:00.000Z"): FakeClock {
  let time = new Date(start).getTime();
  return {
    now: () => new Date(time),
    set: (iso) => {
      time = new Date(iso).getTime();
    },
    advance: (ms) => {
      time += ms;
    },
  };
}

/** Deterministic "random" bytes: a counter-seeded generator, so a run is the same every time. */
export function seededRandom(seed = 1): (length: number) => Uint8Array {
  let state = seed >>> 0 || 1;
  return (length) => {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      bytes[i] = state & 0xff;
    }
    return bytes;
  };
}

// ---------------------------------------------------------------------------------------------
// Providers and products that answer from memory. A request to any other address is an error:
// no test reaches the network.

export interface StubCall {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly body: string;
}

export interface StubGithub {
  /** The access token the token endpoint hands out; the profile endpoints require it. */
  token: string;
  tokenStatus: number;
  user: { id: number; login: string; name: string | null; avatar_url: string };
  userStatus: number;
  emails: { email: string; primary: boolean; verified: boolean }[];
  emailsStatus: number;
}

export interface StubGoogle {
  token: string;
  tokenStatus: number;
  userinfo: { sub: string; email: string; email_verified: boolean; name: string; picture: string };
  userinfoStatus: number;
}

export interface StubProviders {
  readonly fetch: typeof fetch;
  /** Every request made, in order. */
  readonly calls: StubCall[];
  readonly github: StubGithub;
  readonly google: StubGoogle;
  /** Answers for product addresses (the deletion events): the status to return, or a function. */
  readonly products: Map<string, (call: StubCall) => number | Promise<number>>;
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

export function stubProviders(): StubProviders {
  const calls: StubCall[] = [];
  const github: StubGithub = {
    token: "stub-github-access-token",
    tokenStatus: 200,
    user: {
      id: 4242,
      login: "ana-dev",
      name: "Ana Dev",
      avatar_url: "https://avatars.githubusercontent.com/u/4242",
    },
    userStatus: 200,
    emails: [{ email: "ana@example.com", primary: true, verified: true }],
    emailsStatus: 200,
  };
  const google: StubGoogle = {
    token: "stub-google-access-token",
    tokenStatus: 200,
    userinfo: {
      sub: "g-7777",
      email: "ana@example.com",
      email_verified: true,
      name: "Ana Dev",
      picture: "https://lh3.googleusercontent.com/a/ana",
    },
    userinfoStatus: 200,
  };
  const products = new Map<string, (call: StubCall) => number | Promise<number>>();

  const stubFetch: typeof fetch = async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    const call: StubCall = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: await request.text(),
    };
    calls.push(call);
    const url = new URL(request.url);
    const bearer = request.headers.get("Authorization");

    if (url.href === "https://github.com/login/oauth/access_token") {
      return github.tokenStatus === 200
        ? json({ access_token: github.token, token_type: "bearer", scope: "read:user,user:email" })
        : json({ error: "stub" }, github.tokenStatus);
    }
    if (url.href === "https://api.github.com/user") {
      if (bearer !== `Bearer ${github.token}` && bearer !== `token ${github.token}`)
        return json({}, 401);
      return json(github.user, github.userStatus);
    }
    if (url.href === "https://api.github.com/user/emails") {
      if (bearer !== `Bearer ${github.token}` && bearer !== `token ${github.token}`)
        return json({}, 401);
      return json(github.emails, github.emailsStatus);
    }
    if (url.href === "https://oauth2.googleapis.com/token") {
      return google.tokenStatus === 200
        ? json({ access_token: google.token, token_type: "Bearer", expires_in: 3599 })
        : json({ error: "stub" }, google.tokenStatus);
    }
    if (url.href === "https://openidconnect.googleapis.com/v1/userinfo") {
      if (bearer !== `Bearer ${google.token}`) return json({}, 401);
      return json(google.userinfo, google.userinfoStatus);
    }
    const product = products.get(url.href);
    if (product) return new Response(null, { status: await product(call) });
    throw new Error(
      `The test made a request to ${request.method} ${url.href}: no test reaches the network`,
    );
  };

  return { fetch: stubFetch, calls, github, google, products };
}

// ---------------------------------------------------------------------------------------------
// The environment, the dependencies and a way to call the service.

/** A development-and-test environment: production addresses, fake secrets. */
export function testEnv(overrides: Partial<Env> = {}): Env {
  const unavailable = () => {
    throw new Error("D1 is not available in the tests: use the in-memory store");
  };
  return {
    ISSUER: "https://id.meltemi.dev",
    COOKIE_DOMAIN: "meltemi.dev",
    SITE_URL: "https://meltemi.dev",
    SESSION_PUBLIC_KEYS: "[]",
    PRODUCTS: '[{"name":"diagrams","events":"https://diagrams.meltemi.dev/_identity/events"}]',
    GITHUB_CLIENT_ID: "test-github-client",
    GITHUB_CLIENT_SECRET: "test-github-secret",
    GOOGLE_CLIENT_ID: "test-google-client",
    GOOGLE_CLIENT_SECRET: "test-google-secret",
    SESSION_PRIVATE_KEY: "{}",
    STATE_SECRET: "test-state-secret",
    EVENTS_SECRET_DIAGRAMS: "test-events-secret",
    DB: { prepare: unavailable, batch: unavailable },
    ...overrides,
  };
}

export interface Harness {
  readonly env: Env;
  readonly deps: Deps;
  readonly store: IdentityStore;
  readonly clock: FakeClock;
  readonly stub: StubProviders;
  readonly keys: TestKeys;
  /** Calls the service as a browser would: a path (or full URL) and the usual `RequestInit`. */
  request(path: string, init?: RequestInit): Promise<Response>;
}

export async function harness(
  options: { env?: Partial<Env>; store?: IdentityStore; start?: string } = {},
): Promise<Harness> {
  const keys = await testKeys();
  const clock = fakeClock(options.start);
  const stub = stubProviders();
  const store = options.store ?? memoryStore();
  const env = testEnv({ SESSION_PUBLIC_KEYS: JSON.stringify([keys.publicJwk]), ...options.env });
  const deps: Deps = {
    fetch: stub.fetch,
    now: () => clock.now(),
    randomBytes: seededRandom(),
    store,
    keys: await importSigningKeys(keys.privateJwk, [keys.publicJwk]),
  };
  return {
    env,
    deps,
    store,
    clock,
    stub,
    keys,
    request: (path, init) => {
      const url = path.startsWith("http") ? path : `${env.ISSUER}${path}`;
      return identity(new Request(url, init), env, deps);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Helpers for what the tests look at.

/** The value of a cookie a response sets, or undefined. */
export function setCookie(response: Response, name: string): string | undefined {
  const line = response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return line?.slice(name.length + 1).split(";")[0];
}

/** The whole `Set-Cookie` line of a cookie, attributes included. */
export function setCookieLine(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
}

/** The text of a response, for assertions on pages. */
export async function textOf(response: Response): Promise<string> {
  return response.text();
}

export interface SeededPerson {
  readonly user: User;
  readonly identity: Identity;
  readonly session: Session;
  /** A `Cookie` header value that signs requests in as this person. */
  readonly cookie: string;
  readonly token: string;
}

/**
 * A person who is already signed in: a user, an identity and a live session, made through the same
 * code a real sign-in uses, so the token is the real thing.
 */
export async function signedInPerson(
  h: Harness,
  options: {
    id?: string;
    name?: string;
    provider?: Provider;
    providerId?: string;
    email?: string;
    emailVerified?: boolean;
    handle?: string;
    userAgent?: string;
  } = {},
): Promise<SeededPerson> {
  const at = h.clock.now().toISOString();
  const id =
    options.id ??
    `user-${(await h.store.userById("user-1")) ? Math.random().toString(36).slice(2) : "1"}`;
  const user: User = {
    id,
    name: options.name ?? "Ana Dev",
    picture: "https://avatars.githubusercontent.com/u/4242",
    createdAt: at,
  };
  await h.store.createUser(user);
  const identity: Identity = {
    provider: options.provider ?? "github",
    providerId: options.providerId ?? `${id}-provider`,
    userId: id,
    email: options.email ?? "ana@example.com",
    emailVerified: options.emailVerified ?? true,
    verifiedAt: (options.emailVerified ?? true) ? at : null,
    handle: options.handle ?? "ana-dev",
    linkedAt: at,
  };
  await h.store.addIdentity(identity);
  const started = await startSession(
    {
      deps: h.deps,
      config: readConfig(h.env),
      request: new Request(h.env.ISSUER, {
        headers: {
          "User-Agent":
            options.userAgent ??
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
        },
      }),
    },
    user,
    identity,
  );
  return {
    user,
    identity,
    session: started.session,
    cookie: `meltemi_session=${started.token}`,
    token: started.token,
  };
}
