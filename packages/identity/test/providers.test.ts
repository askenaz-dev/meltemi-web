import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfig } from "../src/config.js";
import { base64url, sha256 } from "../src/crypto.js";
import { PROVIDERS, type Provider, type ProviderProfile } from "../src/types.js";
import {
  OAUTH_PROVIDERS,
  PROFILE_LIMITS,
  ProviderError,
  normalizeProfile,
  pkceChallenge,
  providerSettings,
  redirectUriFor,
  type ProviderSettings,
} from "../src/providers/index.js";
import {
  PROVIDER_TIMEOUT_MS,
  PROVIDER_USER_AGENT,
  asRecord,
  requestJson,
  text,
} from "../src/providers/http.js";
import { githubProvider } from "../src/providers/github.js";
import { googleProvider } from "../src/providers/google.js";
import { stubProviders, testEnv, type StubProviders } from "./support/index.js";
import { DEV_ENV } from "./support/signin.js";

const GITHUB = "https://github.com/login/oauth/access_token";
const GITHUB_USER = "https://api.github.com/user";
const GITHUB_EMAILS = "https://api.github.com/user/emails";
const GOOGLE = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

function settings(
  stub: Pick<StubProviders, "fetch">,
  over: Partial<ProviderSettings> = {},
): ProviderSettings & { fetch: typeof fetch } {
  return {
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://id.meltemi.dev/callback/x",
    fetch: stub.fetch,
    ...over,
  };
}

/** A fetch that answers the listed addresses with the given responses and refuses all others. */
function fetchOf(answers: Record<string, () => Response | Promise<Response>>): typeof fetch {
  return async (input, init) => {
    const url = new Request(input as RequestInfo, init).url;
    const answer = answers[url];
    if (!answer) throw new Error(`The test made a request to ${url}`);
    return answer();
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the provider registry", () => {
  it("has exactly the two providers, with PKCE for Google only", () => {
    expect(Object.keys(OAUTH_PROVIDERS).sort()).toEqual([...PROVIDERS].sort());
    expect(OAUTH_PROVIDERS.github).toBe(githubProvider);
    expect(OAUTH_PROVIDERS.google).toBe(googleProvider);
    expect(githubProvider.id).toBe("github");
    expect(googleProvider.id).toBe("google");
    expect(githubProvider.usesPkce).toBe(false);
    expect(googleProvider.usesPkce).toBe(true);
  });

  it("registers the callback of each provider under the issuer", () => {
    const production = readConfig(testEnv());
    expect(redirectUriFor(production, "github")).toBe("https://id.meltemi.dev/callback/github");
    expect(redirectUriFor(production, "google")).toBe("https://id.meltemi.dev/callback/google");
    const development = readConfig(testEnv(DEV_ENV));
    expect(redirectUriFor(development, "github")).toBe("http://localhost:8787/callback/github");
  });

  it("reads each provider's own client id and secret from the environment", () => {
    const env = testEnv();
    const config = readConfig(env);
    expect(providerSettings(env, config, "github")).toEqual({
      clientId: "test-github-client",
      clientSecret: "test-github-secret",
      redirectUri: "https://id.meltemi.dev/callback/github",
    });
    expect(providerSettings(env, config, "google")).toEqual({
      clientId: "test-google-client",
      clientSecret: "test-google-secret",
      redirectUri: "https://id.meltemi.dev/callback/google",
    });
  });
});

describe("the authorization addresses", () => {
  const base = {
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://id.meltemi.dev/callback/x",
  };

  it("GitHub: client, callback, scope and state, nothing else", () => {
    const url = new URL(githubProvider.authorizationUrl(base, { state: "the-state" }));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-id",
      redirect_uri: "https://id.meltemi.dev/callback/x",
      scope: "read:user user:email",
      state: "the-state",
    });
  });

  it("Google: the code flow with a S256 challenge", () => {
    const url = new URL(
      googleProvider.authorizationUrl(base, { state: "the-state", challenge: "the-challenge" }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-id",
      redirect_uri: "https://id.meltemi.dev/callback/x",
      response_type: "code",
      scope: "openid email profile",
      state: "the-state",
      code_challenge: "the-challenge",
      code_challenge_method: "S256",
    });
  });

  it("encodes values that need it instead of splicing them in", () => {
    const url = githubProvider.authorizationUrl(
      { ...base, redirectUri: "https://id.meltemi.dev/callback/x?a=1&b=2" },
      { state: "a b&c=d" },
    );
    expect(url).not.toContain(" ");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://id.meltemi.dev/callback/x?a=1&b=2",
    );
    expect(parsed.searchParams.get("state")).toBe("a b&c=d");
    expect([...parsed.searchParams.keys()]).toHaveLength(4);
  });

  it("refuses to start without a client id, naming the setting and no value", () => {
    expect(() =>
      githubProvider.authorizationUrl({ ...base, clientId: "" }, { state: "s" }),
    ).toThrow(new ProviderError("GITHUB_CLIENT_ID is not set"));
    expect(() =>
      googleProvider.authorizationUrl({ ...base, clientId: "" }, { state: "s", challenge: "c" }),
    ).toThrow(new ProviderError("GOOGLE_CLIENT_ID is not set"));
    // A secret that was never set arrives as undefined, which is the same thing.
    expect(() =>
      githubProvider.authorizationUrl(
        { ...base, clientId: undefined as unknown as string },
        { state: "s" },
      ),
    ).toThrow(ProviderError);
  });

  it("Google refuses to start without a challenge", () => {
    expect(() => googleProvider.authorizationUrl(base, { state: "s" })).toThrow(ProviderError);
  });
});

describe("PKCE", () => {
  it("matches the example of RFC 7636", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("is the unpadded base64url of the SHA-256 of the verifier", async () => {
    const verifier = "a-verifier-of-some-length-0123456789-abcdefghijklmnop";
    const challenge = await pkceChallenge(verifier);
    expect(challenge).toBe(base64url(await sha256(verifier)));
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("GitHub: the profile", () => {
  async function profileOf(change: (stub: StubProviders) => void = () => {}) {
    const stub = stubProviders();
    change(stub);
    return githubProvider.signIn(settings(stub), { code: "c" });
  }

  it("maps the user and the primary verified email", async () => {
    expect(await profileOf()).toEqual({
      provider: "github",
      providerId: "4242",
      name: "Ana Dev",
      picture: "https://avatars.githubusercontent.com/u/4242",
      email: "ana@example.com",
      emailVerified: true,
      handle: "ana-dev",
    });
  });

  it("falls back to the login when there is no name", async () => {
    for (const name of [null, "", "   "]) {
      const profile = await profileOf(
        (stub) => void (stub.github.user = { ...stub.github.user, name }),
      );
      expect(profile.name, JSON.stringify(name)).toBe("ana-dev");
    }
  });

  it("trims the name", async () => {
    const profile = await profileOf(
      (stub) => void (stub.github.user = { ...stub.github.user, name: "  Ana Dev  " }),
    );
    expect(profile.name).toBe("Ana Dev");
  });

  it("makes the id the text of the number, whatever the size", async () => {
    const profile = await profileOf(
      (stub) => void (stub.github.user = { ...stub.github.user, id: 9007199254740991 }),
    );
    expect(profile.providerId).toBe("9007199254740991");
  });

  const emails: [
    string,
    { email: string; primary: boolean; verified: boolean }[],
    string,
    boolean,
  ][] = [
    [
      "the primary verified one",
      [{ email: "p@example.com", primary: true, verified: true }],
      "p@example.com",
      true,
    ],
    [
      "the primary verified one, listed after others",
      [
        { email: "a@example.com", primary: false, verified: true },
        { email: "b@example.com", primary: false, verified: false },
        { email: "p@example.com", primary: true, verified: true },
      ],
      "p@example.com",
      true,
    ],
    [
      "the primary unverified one, marked unverified, over a verified secondary",
      [
        { email: "a@example.com", primary: false, verified: true },
        { email: "p@example.com", primary: true, verified: false },
      ],
      "p@example.com",
      false,
    ],
    [
      "a primary that is unverified",
      [{ email: "p@example.com", primary: true, verified: false }],
      "p@example.com",
      false,
    ],
    [
      "none when only secondary addresses exist, verified or not",
      [
        { email: "a@example.com", primary: false, verified: true },
        { email: "b@example.com", primary: false, verified: false },
      ],
      "",
      false,
    ],
    ["none when there are no addresses", [], "", false],
  ];

  it.each(emails)("email: %s", async (_name, list, email, verified) => {
    const profile = await profileOf((stub) => void (stub.github.emails = list));
    expect(profile.email).toBe(email);
    expect(profile.emailVerified).toBe(verified);
  });

  it("ignores entries that are not addresses, instead of failing on them", async () => {
    const fetch = fetchOf({
      [GITHUB]: () => json({ access_token: "t" }),
      [GITHUB_USER]: () => json({ id: 1, login: "x", name: "X", avatar_url: "" }),
      [GITHUB_EMAILS]: () =>
        json([
          null,
          3,
          "text",
          { primary: true, verified: true },
          { email: "", primary: true, verified: true },
          { email: "ok@example.com", primary: true, verified: true },
        ]),
    });
    const profile = await githubProvider.signIn(settings({ fetch }), { code: "c" });
    expect(profile).toMatchObject({ email: "ok@example.com", emailVerified: true });
  });

  it("only a literal true counts as verified", async () => {
    for (const verified of ["true", 1, "yes", null]) {
      const profile = await profileOf(
        (stub) =>
          void (stub.github.emails = [
            { email: "p@example.com", primary: true, verified: verified as unknown as boolean },
          ]),
      );
      expect(profile.emailVerified, JSON.stringify(verified)).toBe(false);
    }
  });

  it("gives an empty picture and handle when GitHub gives none", async () => {
    const fetch = fetchOf({
      [GITHUB]: () => json({ access_token: "t" }),
      [GITHUB_USER]: () => json({ id: 5 }),
      [GITHUB_EMAILS]: () => json([]),
    });
    const profile = await githubProvider.signIn(settings({ fetch }), { code: "c" });
    expect(profile).toEqual({
      provider: "github",
      providerId: "5",
      name: "",
      picture: "",
      email: "",
      emailVerified: false,
      handle: "",
    });
  });

  it("the profile holds no token", async () => {
    const stub = stubProviders();
    const profile = await githubProvider.signIn(settings(stub), { code: "c" });
    expect(JSON.stringify(profile)).not.toContain(stub.github.token);
    expect(Object.keys(profile).sort()).toEqual(
      ["email", "emailVerified", "handle", "name", "picture", "provider", "providerId"].sort(),
    );
  });
});

describe("GitHub: the requests", () => {
  it("asks for the token with a form body that encodes every value", async () => {
    const stub = stubProviders();
    await githubProvider.signIn(
      settings(stub, {
        clientSecret: "s&e=c r+et",
        redirectUri: "https://id.meltemi.dev/callback/github",
      }),
      { code: "co de&x=1+2%" },
    );
    const exchange = stub.calls[0]!;
    expect(exchange.method).toBe("POST");
    expect(exchange.url).toBe(GITHUB);
    expect(exchange.headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
    expect(exchange.headers.get("Accept")).toBe("application/json");
    expect(exchange.headers.get("User-Agent")).toBe(PROVIDER_USER_AGENT);
    expect(exchange.headers.get("Authorization")).toBeNull();
    expect(Object.fromEntries(new URLSearchParams(exchange.body))).toEqual({
      client_id: "client-id",
      client_secret: "s&e=c r+et",
      code: "co de&x=1+2%",
      redirect_uri: "https://id.meltemi.dev/callback/github",
    });
    expect(PROVIDER_USER_AGENT).toBe("meltemi-identity");
  });

  it("reads the profile with the token as a bearer, and asks for nothing else", async () => {
    const stub = stubProviders();
    await githubProvider.signIn(settings(stub), { code: "c" });
    expect(stub.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `POST ${GITHUB}`,
      `GET ${GITHUB_USER}`,
      `GET ${GITHUB_EMAILS}`,
    ]);
    for (const call of stub.calls.slice(1)) {
      expect(call.headers.get("Authorization")).toBe(`Bearer ${stub.github.token}`);
      expect(call.headers.get("User-Agent")).toBe("meltemi-identity");
      expect(call.headers.get("Accept")).toBe("application/vnd.github+json");
    }
    // The token never goes anywhere but GitHub's API: not in a body, not in a query.
    for (const call of stub.calls) {
      expect(call.body).not.toContain(stub.github.token);
      expect(call.url).not.toContain(stub.github.token);
    }
  });

  it("makes no request at all without the client secret", async () => {
    const stub = stubProviders();
    for (const clientSecret of ["", undefined as unknown as string]) {
      await expect(
        githubProvider.signIn(settings(stub, { clientSecret }), { code: "c" }),
      ).rejects.toThrow(new ProviderError("GITHUB_CLIENT_SECRET is not set"));
    }
    await expect(
      githubProvider.signIn(settings(stub, { clientId: "" }), { code: "c" }),
    ).rejects.toThrow(new ProviderError("GITHUB_CLIENT_ID is not set"));
    expect(stub.calls).toEqual([]);
  });
});

describe("Google: the profile and the requests", () => {
  it("maps userinfo", async () => {
    const stub = stubProviders();
    expect(await googleProvider.signIn(settings(stub), { code: "c", verifier: "v" })).toEqual({
      provider: "google",
      providerId: "g-7777",
      name: "Ana Dev",
      picture: "https://lh3.googleusercontent.com/a/ana",
      email: "ana@example.com",
      emailVerified: true,
      handle: "",
    });
  });

  it("exchanges the code with the verifier, then reads userinfo with the bearer", async () => {
    const stub = stubProviders();
    await googleProvider.signIn(
      settings(stub, { redirectUri: "https://id.meltemi.dev/callback/google" }),
      { code: "the&code", verifier: "the-verifier" },
    );
    expect(stub.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `POST ${GOOGLE}`,
      `GET ${GOOGLE_USERINFO}`,
    ]);
    const [exchange, userinfo] = stub.calls as [
      (typeof stub.calls)[number],
      (typeof stub.calls)[number],
    ];
    expect(exchange.headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
    expect(exchange.headers.get("Accept")).toBe("application/json");
    expect(exchange.headers.get("User-Agent")).toBe("meltemi-identity");
    expect(Object.fromEntries(new URLSearchParams(exchange.body))).toEqual({
      client_id: "client-id",
      client_secret: "client-secret",
      code: "the&code",
      code_verifier: "the-verifier",
      grant_type: "authorization_code",
      redirect_uri: "https://id.meltemi.dev/callback/google",
    });
    expect(userinfo.headers.get("Authorization")).toBe(`Bearer ${stub.google.token}`);
    expect(userinfo.headers.get("User-Agent")).toBe("meltemi-identity");
    expect(userinfo.headers.get("Accept")).toBe("application/json");
    for (const call of stub.calls) expect(call.body + call.url).not.toContain(stub.google.token);
  });

  it("makes no request without the verifier or the secret", async () => {
    const stub = stubProviders();
    await expect(googleProvider.signIn(settings(stub), { code: "c" })).rejects.toThrow(
      new ProviderError("Google: the PKCE verifier is missing"),
    );
    await expect(
      googleProvider.signIn(settings(stub, { clientSecret: "" }), { code: "c", verifier: "v" }),
    ).rejects.toThrow(new ProviderError("GOOGLE_CLIENT_SECRET is not set"));
    expect(stub.calls).toEqual([]);
  });

  it("counts the email as verified only when email_verified is literally true", async () => {
    for (const [value, expected] of [
      [true, true],
      [false, false],
      ["true", false],
      [1, false],
      [undefined, false],
      [null, false],
    ] as const) {
      const stub = stubProviders();
      stub.google.userinfo = {
        ...stub.google.userinfo,
        email_verified: value as unknown as boolean,
      };
      const profile = await googleProvider.signIn(settings(stub), { code: "c", verifier: "v" });
      expect(profile.emailVerified, JSON.stringify(value)).toBe(expected);
      expect(profile.email).toBe("ana@example.com");
    }
  });

  it("has no verified email when there is no address", async () => {
    const stub = stubProviders();
    stub.google.userinfo = { ...stub.google.userinfo, email: "", email_verified: true };
    const profile = await googleProvider.signIn(settings(stub), { code: "c", verifier: "v" });
    expect(profile).toMatchObject({ email: "", emailVerified: false });
  });

  it("uses the email as the name when Google gives none, and trims a name it gives", async () => {
    const stub = stubProviders();
    stub.google.userinfo = { ...stub.google.userinfo, name: "   " };
    expect((await googleProvider.signIn(settings(stub), { code: "c", verifier: "v" })).name).toBe(
      "ana@example.com",
    );
    stub.google.userinfo = { ...stub.google.userinfo, name: " Ana  " };
    expect((await googleProvider.signIn(settings(stub), { code: "c", verifier: "v" })).name).toBe(
      "Ana",
    );
  });

  it("gives an empty picture when Google gives none", async () => {
    const fetch = fetchOf({
      [GOOGLE]: () => json({ access_token: "t" }),
      [GOOGLE_USERINFO]: () => json({ sub: "s-1" }),
    });
    const profile = await googleProvider.signIn(settings({ fetch }), { code: "c", verifier: "v" });
    expect(profile).toEqual({
      provider: "google",
      providerId: "s-1",
      name: "",
      picture: "",
      email: "",
      emailVerified: false,
      handle: "",
    });
  });

  it("needs a sub that is text", async () => {
    for (const sub of [undefined, null, "", 123, {}]) {
      const fetch = fetchOf({
        [GOOGLE]: () => json({ access_token: "t" }),
        [GOOGLE_USERINFO]: () => json({ sub, email: "x@example.com" }),
      });
      await expect(
        googleProvider.signIn(settings({ fetch }), { code: "c", verifier: "v" }),
      ).rejects.toThrow(ProviderError);
    }
  });

  it("the profile holds no token", async () => {
    const stub = stubProviders();
    const profile = await googleProvider.signIn(settings(stub), { code: "c", verifier: "v" });
    expect(JSON.stringify(profile)).not.toContain(stub.google.token);
    expect(Object.keys(profile).sort()).toEqual(
      ["email", "emailVerified", "handle", "name", "picture", "provider", "providerId"].sort(),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// The rules every profile goes through (src/providers/profile.ts), on both providers. The limits
// are written as numbers here on purpose: they are part of the contract.

/** What a provider says about the person; each provider's wire format is built from it. */
interface Wire {
  id: string | number;
  name: string;
  picture: string;
  email: string;
  emailVerified: boolean;
  /** The GitHub login; Google has no handle. */
  handle: string;
}

const WIRE: Wire = {
  id: "ID-1",
  name: "Ana Dev",
  picture: "https://avatars.example.com/u/1",
  email: "ana@example.com",
  emailVerified: true,
  handle: "ana-dev",
};

/** The profile that comes out of a sign-in where the provider said `WIRE` changed by `over`. */
async function signInWire(provider: Provider, over: Partial<Wire> = {}): Promise<ProviderProfile> {
  const wire = { ...WIRE, ...over };
  if (provider === "github") {
    const fetch = fetchOf({
      [GITHUB]: () => json({ access_token: "t" }),
      [GITHUB_USER]: () =>
        json({ id: wire.id, login: wire.handle, name: wire.name, avatar_url: wire.picture }),
      [GITHUB_EMAILS]: () =>
        json(
          wire.email === ""
            ? []
            : [{ email: wire.email, primary: true, verified: wire.emailVerified }],
        ),
    });
    return githubProvider.signIn(settings({ fetch }), { code: "c" });
  }
  const fetch = fetchOf({
    [GOOGLE]: () => json({ access_token: "t" }),
    [GOOGLE_USERINFO]: () =>
      json({
        sub: wire.id,
        name: wire.name,
        picture: wire.picture,
        email: wire.email,
        email_verified: wire.emailVerified,
      }),
  });
  return googleProvider.signIn(settings({ fetch }), { code: "c", verifier: "v" });
}

/** What `WIRE` comes to when every rule is satisfied. */
function expectedOf(provider: Provider, over: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    provider,
    providerId: "ID-1",
    name: "Ana Dev",
    picture: "https://avatars.example.com/u/1",
    email: "ana@example.com",
    emailVerified: true,
    handle: provider === "github" ? "ana-dev" : "",
    ...over,
  };
}

/** A text with a surrogate that is not half of a pair. */
const hasLoneSurrogate = (value: string) => /\p{Cs}/u.test(value);

/** An address of exactly `length` characters. */
const emailOfLength = (length: number) => `${"e".repeat(length - 12)}@example.com`;

describe.each(PROVIDERS)("%s: the rules of a profile", (provider) => {
  describe("name", () => {
    const cases: [string, string, string][] = [
      [
        "a name that follows the rules is kept",
        "Ana María Núñez 山田 😀",
        "Ana María Núñez 山田 😀",
      ],
      ["is trimmed, whatever the kind of space", "   Ana Dev   ", "Ana Dev"],
      ["loses its control characters", "A\u0000n\u0007a\tD\ne\rv\u001f\u007f", "AnaDev"],
      ["keeps the space, 0x20, between words", "Ana\u001f Dev", "Ana Dev"],
      ["exactly 100 code points are kept", "n".repeat(100), "n".repeat(100)],
      ["101 code points are cut to 100", "n".repeat(101), "n".repeat(100)],
      ["100 characters outside the BMP are kept whole", "😀".repeat(100), "😀".repeat(100)],
      ["101 characters outside the BMP are cut to 100", "😀".repeat(101), "😀".repeat(100)],
      [
        "a pair that ends exactly at the limit is kept",
        `${"a".repeat(99)}😀tail`,
        `${"a".repeat(99)}😀`,
      ],
      [
        "a pair that would start after the limit is left out, not halved",
        `${"a".repeat(100)}😀tail`,
        "a".repeat(100),
      ],
      ["a space left at the cut is trimmed", `${"a".repeat(99)} b`, "a".repeat(99)],
      ["control characters do not count toward the limit", "a\u0000".repeat(101), "a".repeat(100)],
      ["a lone surrogate becomes U+FFFD", "a\ud800b\udc00c", "a�b�c"],
      ["a pair written backwards is two lone surrogates", "\udc00\ud800", "��"],
      ["a name of ten thousand characters is cut to 100", "ñ".repeat(10_000), "ñ".repeat(100)],
    ];

    it.each(cases)("%s", async (_label, name, expected) => {
      const profile = await signInWire(provider, { name });
      expect(profile).toEqual(expectedOf(provider, { name: expected }));
      expect(hasLoneSurrogate(profile.name)).toBe(false);
      expect([...profile.name].length).toBeLessThanOrEqual(100);
    });

    // The fallback is the GitHub login or the Google email, and it is applied before the limit.
    const fallback = provider === "github" ? "handle" : "email";
    const fallbackText = (profile: Partial<Wire>) =>
      provider === "github" ? profile.handle : profile.email;

    it.each([
      ["no name", ""],
      ["a name of spaces", "   "],
      ["a name of control characters", "\u0000\u0001\u007f"],
      ["a name of control characters and spaces", " \t\n "],
    ])(`%s falls back to the ${fallback}`, async (_label, name) => {
      const profile = await signInWire(provider, { name });
      expect(profile.name).toBe(fallbackText(WIRE));
    });

    it("does not use the fallback when there is a name", async () => {
      expect((await signInWire(provider, { name: "Z" })).name).toBe("Z");
    });

    it("limits the fallback too, after choosing it", async () => {
      const long = `${"l".repeat(150)}@example.com`;
      const profile = await signInWire(
        provider,
        provider === "github" ? { name: "", handle: "l".repeat(150) } : { name: "", email: long },
      );
      expect(profile.name).toBe("l".repeat(100));
      if (provider === "google") {
        // Not the email: it is under its own limit (162 characters) and stays whole.
        expect(profile).toMatchObject({ email: long, emailVerified: true });
      } else {
        // A handle of 150 characters is over its limit and is dropped; the name still came from it.
        expect(profile.handle).toBe("");
      }
    });

    it("takes the fallback text cleaned of control characters", async () => {
      const profile = await signInWire(
        provider,
        provider === "github"
          ? { name: "", handle: "ana\u0000-dev" }
          : { name: "", email: "ana\u0000@example.com" },
      );
      expect(profile.name).toBe(provider === "github" ? "ana-dev" : "ana@example.com");
    });

    // Google only: GitHub's fallback is the login, not the address.
    if (provider === "google") {
      it("an email over its own limit still names the person, up to 100 code points", async () => {
        const profile = await signInWire(provider, { name: "", email: emailOfLength(300) });
        expect(profile).toMatchObject({ name: "e".repeat(100), email: "", emailVerified: false });
      });
    }
  });

  describe("picture", () => {
    const origin = "https://a.example/";
    const kept: [string, string][] = [
      ["an ordinary avatar address", "https://avatars.githubusercontent.com/u/4242?v=4"],
      ["a Google avatar address", "https://lh3.googleusercontent.com/a/ana=s96-c"],
      ["a scheme written in capitals", "HTTPS://Example.com/a.png"],
      ["a port", "https://example.com:8443/a.png"],
      ["an @ after the path started", "https://example.com/a@b.png"],
      ["an @ in the query", "https://example.com/?u=a@b"],
      ["a bare origin", "https://example.com"],
      ["exactly 512 characters", origin + "p".repeat(512 - origin.length)],
    ];
    it.each(kept)("keeps %s", async (_label, picture) => {
      expect(await signInWire(provider, { picture })).toEqual(expectedOf(provider, { picture }));
    });

    const refused: [string, string][] = [
      ["513 characters", origin + "p".repeat(513 - origin.length)],
      ["a very long address", origin + "p".repeat(5000)],
      ["http:", "http://avatars.example.com/u/1"],
      ["ftp:", "ftp://avatars.example.com/u/1"],
      ["javascript:", "javascript:alert(1)"],
      ["a data: URL", "data:image/png;base64,AAAA"],
      ["no scheme", "avatars.example.com/u/1"],
      ["a scheme-relative address", "//avatars.example.com/u/1"],
      ["a path", "/u/1.png"],
      ["https: without the slashes", "https:avatars.example.com/u/1"],
      ["https:// and no host", "https://"],
      ["an empty authority", "https:///avatars.example.com/u/1"],
      ["an empty authority before a backslash", "https://\\avatars.example.com/u/1"],
      ["a user and a password", "https://user:secret@avatars.example.com/u/1"],
      ["a user", "https://user@avatars.example.com/u/1"],
      ["a password only", "https://:secret@avatars.example.com/u/1"],
      ["empty credentials", "https://@avatars.example.com/u/1"],
      ["empty credentials with a colon", "https://:@avatars.example.com/u/1"],
      ["credentials before a port", "https://user@avatars.example.com:443/u/1"],
      ["a space", "https://avatars.example.com/a b.png"],
      ["a space around it", " https://avatars.example.com/u/1 "],
      ["a control character", "https://avatars.example.com/u/1\u0000"],
      ["a newline", "https://avatars.example.com/\nu/1"],
      ["a character outside ASCII", "https://avatars.example.com/é.png"],
      ["a host outside ASCII", "https://avatars-ñ.example.com/u/1"],
      ["a host that is not one", "https://avatars example.com/u/1"],
      ["a port that is not one", "https://avatars.example.com:port/u/1"],
      ["just text", "not a url"],
    ];
    it.each(refused)("drops %s: no picture", async (_label, picture) => {
      expect(await signInWire(provider, { picture })).toEqual(
        expectedOf(provider, { picture: "" }),
      );
    });

    it("does not touch anything else of the profile when it drops the picture", async () => {
      const profile = await signInWire(provider, { picture: "http://example.com/a.png" });
      expect(profile).toEqual(expectedOf(provider, { picture: "" }));
    });
  });

  describe("email", () => {
    const kept: [string, string][] = [
      ["an ordinary address", "ana@example.com"],
      ["capitals", "Ana.Dev+tag@Example.COM"],
      ["exactly 254 characters", emailOfLength(254)],
      ["characters outside ASCII", "añá@exámple.com"],
      ["a pair outside the BMP", "a😀@example.com"],
    ];
    it.each(kept)("keeps %s, with its verification", async (_label, email) => {
      expect(await signInWire(provider, { email })).toEqual(expectedOf(provider, { email }));
      expect(await signInWire(provider, { email, emailVerified: false })).toEqual(
        expectedOf(provider, { email, emailVerified: false }),
      );
    });

    const refused: [string, string][] = [
      ["255 characters", emailOfLength(255)],
      ["a very long address", emailOfLength(10_000)],
      ["no @", "ana.example.com"],
      ["nothing before the @", "@example.com"],
      ["nothing after the @", "ana@"],
      ["only an @", "@"],
      ["a space inside", "ana @example.com"],
      ["a space before", " ana@example.com"],
      ["a space after", "ana@example.com "],
      ["a no-break space", "ana @example.com"],
      ["a tab", "ana\t@example.com"],
      ["a newline after", "ana@example.com\n"],
      ["a null in the middle (never repaired into another address)", "ana@exam\u0000ple.com"],
      ["a control character (0x1f)", "ana\u001f@example.com"],
      ["a DEL (0x7f)", "ana@example.com\u007f"],
      ["a lone surrogate", "a\ud800@example.com"],
    ];
    it.each(refused)("treats %s as no email at all, verified or not", async (_label, email) => {
      for (const emailVerified of [true, false]) {
        const profile = await signInWire(provider, { email, emailVerified });
        expect(profile).toEqual(expectedOf(provider, { email: "", emailVerified: false }));
      }
    });
  });

  describe("provider id", () => {
    const kept: [string, string][] = [
      ["one character", "1"],
      ["exactly 128 characters", "i".repeat(128)],
      ["spaces, which are not control characters", "an id with spaces"],
      ["characters outside ASCII", "ñ-山田-😀"],
      ["a space at either end, exactly as given", " id "],
    ];
    it.each(kept)("keeps %s, exactly as given", async (_label, id) => {
      expect(await signInWire(provider, { id })).toEqual(expectedOf(provider, { providerId: id }));
    });

    const refused: [string, string][] = [
      ["129 characters", "i".repeat(129)],
      ["a very long id", "i".repeat(100_000)],
      ["a newline", "id\n1"],
      ["a null", "id\u00001"],
      ["0x1f", "id\u001f1"],
      ["a DEL (0x7f)", "id\u007f1"],
      ["a lone surrogate", "id\ud8001"],
    ];
    it.each(refused)(
      "fails the whole answer for %s, saying nothing of the id",
      async (_label, id) => {
        const error = await signInWire(provider, { id }).then(
          () => undefined,
          (failure: unknown) => failure,
        );
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).message).toBe(
          `${provider === "github" ? "GitHub" : "Google"}: the account id is not usable`,
        );
        expect((error as ProviderError).message).not.toContain(id);
      },
    );
  });

  it("is deterministic and gives the same answer for the same profile twice", async () => {
    const wire = { name: "  Ana\u0000 ", picture: "http://x.example/a.png", email: "ana" };
    expect(await signInWire(provider, wire)).toEqual(await signInWire(provider, wire));
  });
});

describe("GitHub: the handle", () => {
  const kept: [string, string][] = [
    ["a login", "ana-dev"],
    ["letters, digits, hyphen, underscore and dot", "A_b.c-9"],
    ["one character", "a"],
    ["exactly 100 characters", "h".repeat(100)],
  ];
  it.each(kept)("keeps %s", async (_label, handle) => {
    expect(await signInWire("github", { handle })).toEqual(expectedOf("github", { handle }));
  });

  const refused: [string, string][] = [
    ["101 characters", "h".repeat(101)],
    ["a space", "ana dev"],
    ["a slash", "ana/dev"],
    ["an @", "ana@dev"],
    ["markup", "<b>ana</b>"],
    ["a quote", 'ana"dev'],
    ["a letter outside ASCII", "añadir"],
    ["a pair outside the BMP", "ana😀"],
    ["a trailing newline and a space", "ana\n "],
  ];
  it.each(refused)("drops %s: no handle", async (_label, handle) => {
    const profile = await signInWire("github", { handle });
    expect(profile.handle).toBe("");
  });

  it("removes control characters first, then applies the rule", async () => {
    expect((await signInWire("github", { handle: "an\u0000a\n-d\u007fev" })).handle).toBe(
      "ana-dev",
    );
    // Nothing is left of a handle that was only control characters.
    expect((await signInWire("github", { handle: "\u0001\u0002" })).handle).toBe("");
    // The control characters do not count toward the limit either.
    expect((await signInWire("github", { handle: "h\u0000".repeat(100) })).handle).toBe(
      "h".repeat(100),
    );
  });

  it("Google has no handle, whatever the profile", async () => {
    expect((await signInWire("google", { handle: "ana-dev" })).handle).toBe("");
  });
});

describe("normalizeProfile", () => {
  const base: ProviderProfile = {
    provider: "github",
    providerId: "42",
    name: "Ana Dev",
    picture: "https://avatars.githubusercontent.com/u/42",
    email: "ana@example.com",
    emailVerified: true,
    handle: "ana-dev",
  };

  it("gives a profile that follows the rules back unchanged, as a new object", () => {
    const out = normalizeProfile(base);
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
    expect(Object.keys(out).sort()).toEqual(Object.keys(base).sort());
  });

  it("does not change what it is given", () => {
    const dirty = Object.freeze({ ...base, name: " \u0000x ", email: "nope", picture: "http://x" });
    expect(normalizeProfile(dirty)).toEqual({
      ...base,
      name: "x",
      email: "",
      emailVerified: false,
      picture: "",
    });
    expect(dirty.name).toBe(" \u0000x ");
  });

  it("has no fallback unless it is given one", () => {
    expect(normalizeProfile({ ...base, name: " " }).name).toBe("");
    expect(normalizeProfile({ ...base, name: " " }, "fallback").name).toBe("fallback");
    expect(normalizeProfile({ ...base, name: "Ana" }, "fallback").name).toBe("Ana");
  });

  it("a verified flag without an address is not verified", () => {
    expect(normalizeProfile({ ...base, email: "" })).toMatchObject({
      email: "",
      emailVerified: false,
    });
    expect(normalizeProfile({ ...base, email: "x", emailVerified: true })).toMatchObject({
      email: "",
      emailVerified: false,
    });
  });

  it("names the provider that failed, never the id", () => {
    for (const [provider, label] of [
      ["github", "GitHub"],
      ["google", "Google"],
    ] as const) {
      expect(() => normalizeProfile({ ...base, provider, providerId: "x".repeat(129) })).toThrow(
        new ProviderError(`${label}: the account id is not usable`),
      );
    }
  });

  it("states its limits", () => {
    expect(PROFILE_LIMITS).toEqual({
      name: 100,
      email: 254,
      picture: 512,
      handle: 100,
      providerId: 128,
    });
  });
});

describe("failures are ProviderErrors that say nothing the provider said", () => {
  const TOKEN = "access-token-of-the-test";
  const SECRET = "client-secret";

  const githubOk = {
    [GITHUB]: () => json({ access_token: TOKEN }),
    [GITHUB_USER]: () => json({ id: 1, login: "x" }),
    [GITHUB_EMAILS]: () => json([]),
  };
  const googleOk = {
    [GOOGLE]: () => json({ access_token: TOKEN }),
    [GOOGLE_USERINFO]: () => json({ sub: "s" }),
  };

  const cases: [
    string,
    "github" | "google",
    Record<string, () => Response | Promise<Response>>,
    string,
  ][] = [
    [
      "a token answer of 503",
      "github",
      { ...githubOk, [GITHUB]: () => json({}, 503) },
      "GitHub token: the answer was 503",
    ],
    [
      "a token answer of 200 that is not JSON",
      "github",
      { ...githubOk, [GITHUB]: () => new Response("x") },
      "GitHub token: the answer is not JSON",
    ],
    [
      "a token answer without a token",
      "github",
      {
        ...githubOk,
        [GITHUB]: () => json({ error: "bad_verification_code", error_description: TOKEN }),
      },
      "GitHub token: no access token in the answer (bad_verification_code)",
    ],
    [
      "an error code that is not a plain code",
      "github",
      { ...githubOk, [GITHUB]: () => json({ error: `<script>${TOKEN}` }) },
      "GitHub token: no access token in the answer",
    ],
    [
      "a token that is not text",
      "github",
      { ...githubOk, [GITHUB]: () => json({ access_token: 5 }) },
      "GitHub token: no access token in the answer",
    ],
    [
      "a token that is empty",
      "github",
      { ...githubOk, [GITHUB]: () => json({ access_token: "" }) },
      "GitHub token: no access token in the answer",
    ],
    [
      "a token request that cannot connect",
      "github",
      {
        ...githubOk,
        [GITHUB]: () => {
          throw new TypeError(TOKEN);
        },
      },
      "GitHub token: the request failed",
    ],
    [
      "a user answer of 500",
      "github",
      { ...githubOk, [GITHUB_USER]: () => json({}, 500) },
      "GitHub user: the answer was 500",
    ],
    [
      "a user without an id",
      "github",
      { ...githubOk, [GITHUB_USER]: () => json({ login: "x" }) },
      "GitHub user: the answer has no id",
    ],
    [
      "a user id of zero",
      "github",
      { ...githubOk, [GITHUB_USER]: () => json({ id: 0 }) },
      "GitHub user: the answer has no id",
    ],
    [
      "a user id that is a fraction",
      "github",
      { ...githubOk, [GITHUB_USER]: () => json({ id: 1.5 }) },
      "GitHub user: the answer has no id",
    ],
    [
      "a user that is a list",
      "github",
      { ...githubOk, [GITHUB_USER]: () => json([{ id: 1 }]) },
      "GitHub user: the answer has no id",
    ],
    [
      "a user that is null",
      "github",
      { ...githubOk, [GITHUB_USER]: () => json(null) },
      "GitHub user: the answer has no id",
    ],
    [
      "an emails answer of 403",
      "github",
      { ...githubOk, [GITHUB_EMAILS]: () => json({}, 403) },
      "GitHub emails: the answer was 403",
    ],
    [
      "emails that are an object",
      "github",
      { ...githubOk, [GITHUB_EMAILS]: () => json({ message: "x" }) },
      "GitHub emails: the answer is not a list",
    ],
    [
      "emails that are not JSON",
      "github",
      { ...githubOk, [GITHUB_EMAILS]: () => new Response("") },
      "GitHub emails: the answer is not JSON",
    ],
    [
      "a token answer of 400",
      "google",
      { ...googleOk, [GOOGLE]: () => json({ error: "invalid_grant" }, 400) },
      "Google token: the answer was 400",
    ],
    [
      "a token answer without a token",
      "google",
      { ...googleOk, [GOOGLE]: () => json({ id_token: TOKEN }) },
      "Google token: no access token in the answer",
    ],
    [
      "a token request that cannot connect",
      "google",
      {
        ...googleOk,
        [GOOGLE]: () => {
          throw new Error(`${SECRET} ${TOKEN}`);
        },
      },
      "Google token: the request failed",
    ],
    [
      "a userinfo answer of 401",
      "google",
      { ...googleOk, [GOOGLE_USERINFO]: () => json({}, 401) },
      "Google userinfo: the answer was 401",
    ],
    [
      "a userinfo that is not JSON",
      "google",
      { ...googleOk, [GOOGLE_USERINFO]: () => new Response("<html>") },
      "Google userinfo: the answer is not JSON",
    ],
    [
      "a userinfo without a sub",
      "google",
      { ...googleOk, [GOOGLE_USERINFO]: () => json({ email: "a@example.com" }) },
      "Google userinfo: the answer has no sub",
    ],
  ];

  it.each(cases)("%s", async (_name, provider, answers, message) => {
    const fetch = fetchOf(answers);
    const attempt =
      provider === "github"
        ? githubProvider.signIn(settings({ fetch }), { code: "c" })
        : googleProvider.signIn(settings({ fetch }), { code: "c", verifier: "v" });
    const error = await attempt.then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).name).toBe("ProviderError");
    expect((error as ProviderError).message).toBe(message);
    // Nothing the provider or the network said, and no secret, is in the message.
    for (const secret of [TOKEN, SECRET, "<script>"]) {
      expect((error as ProviderError).message).not.toContain(secret);
    }
  });
});

describe("the time a provider may take", () => {
  it("is ten seconds, for the answer and for its body together", () => {
    expect(PROVIDER_TIMEOUT_MS).toBe(10_000);
  });

  it("aborts the request at the limit and says the request failed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let aborted = false;
    const hanging: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      });
    const outcome = requestJson(hanging, "Test", "https://example.test/", {}).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS - 1);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(aborted).toBe(true);
    expect(await outcome).toEqual(new ProviderError("Test: the request failed"));
  });

  it("also bounds a body that never finishes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stalled: typeof fetch = async (_input, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
        },
      });
      return new Response(body, { status: 200 });
    };
    const outcome = requestJson(stalled, "Test", "https://example.test/", {}).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS);
    expect(await outcome).toEqual(new ProviderError("Test: the answer is not JSON"));
  });

  it("leaves no timer behind once the answer is in, or once it failed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await requestJson(async () => json({ ok: true }), "Test", "https://example.test/", {});
    expect(vi.getTimerCount()).toBe(0);
    await requestJson(async () => json({}, 500), "Test", "https://example.test/", {}).catch(
      () => {},
    );
    expect(vi.getTimerCount()).toBe(0);
    await requestJson(
      async () => {
        throw new Error("down");
      },
      "Test",
      "https://example.test/",
      {},
    ).catch(() => {});
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes the request's own options along with the abort signal", async () => {
    let seen: RequestInit | undefined;
    await requestJson(
      async (_input, init) => {
        seen = init;
        return json({});
      },
      "Test",
      "https://example.test/",
      { method: "POST", body: "a=1", headers: { "X-Test": "1" } },
    );
    expect(seen).toMatchObject({ method: "POST", body: "a=1", headers: { "X-Test": "1" } });
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("the helpers", () => {
  it("asRecord accepts objects only", () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    for (const value of [null, undefined, [], [1], "x", 1, true])
      expect(asRecord(value)).toBeUndefined();
  });

  it("text accepts non-empty strings only", () => {
    expect(text("a")).toBe("a");
    for (const value of ["", null, undefined, 1, {}, []]) expect(text(value)).toBeUndefined();
  });
});
