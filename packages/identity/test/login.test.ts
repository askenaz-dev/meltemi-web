import { describe, expect, it } from "vitest";
import { base64url, fromBase64url, sha256, verifyHmac } from "../src/crypto.js";
import { OAUTH_COOKIE } from "../src/oauth-cookie.js";
import { harness, setCookie, setCookieLine, signedInPerson, textOf } from "./support/index.js";
import {
  DEV_ENV,
  NOT_DEV_ENV,
  captureConsole,
  decodeOauth,
  hrefsOf,
  startFlow,
} from "./support/signin.js";

const STATE_SECRET = "test-state-secret";

/** The attributes of a `Set-Cookie` line, without the name and value. */
function attributes(line: string | undefined): string[] {
  return (line ?? "").split("; ").slice(1);
}

describe("GET /login: the chooser", () => {
  it("links to both providers, never posts, and links the legal pages", async () => {
    const h = await harness();
    const response = await h.request("/login");
    expect(response.status).toBe(200);
    const html = await textOf(response);
    expect(html).toMatch(/<a href="\/login\?provider=github"[^>]*>/);
    expect(html).toMatch(/<a href="\/login\?provider=google"[^>]*>/);
    expect(html).not.toMatch(/<form/i);
    expect(hrefsOf(html)).toEqual(
      expect.arrayContaining(["https://meltemi.dev/privacy/", "https://meltemi.dev/terms/"]),
    );
  });

  it("offers GitHub and Google and nothing else, and no password", async () => {
    const h = await harness();
    const html = await textOf(await h.request("/login"));
    const logins = hrefsOf(html).filter((href) => href.startsWith("/login"));
    expect(logins).toEqual(["/login?provider=github", "/login?provider=google"]);
    expect(html).not.toMatch(/<input/i);
    expect(html).not.toMatch(/type="password"/i);
  });

  it("sets no cookie and asks no provider", async () => {
    const h = await harness();
    const response = await h.request("/login");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(h.stub.calls).toEqual([]);
  });

  it("carries the validated return address in both links, URL-encoded", async () => {
    const h = await harness();
    const returnTo = "https://diagrams.meltemi.dev/p/abc?x=1&y=2#top";
    const html = await textOf(await h.request(`/login?return_to=${encodeURIComponent(returnTo)}`));
    // In the page the ampersands are escaped; undone, the link names the address once, encoded.
    expect(html).toContain("provider=github&amp;return_to=");
    const encoded = encodeURIComponent(returnTo);
    expect(hrefsOf(html)).toEqual(
      expect.arrayContaining([
        `/login?provider=github&return_to=${encoded}`,
        `/login?provider=google&return_to=${encoded}`,
      ]),
    );
  });

  it("carries the parsed address, which is what the flow will redirect to", async () => {
    const h = await harness();
    const html = await textOf(
      await h.request(
        "/login?return_to=" + encodeURIComponent("https://DIAGRAMS.meltemi.dev:443/Ñ"),
      ),
    );
    expect(hrefsOf(html)).toContain(
      `/login?provider=github&return_to=${encodeURIComponent("https://diagrams.meltemi.dev/%C3%91")}`,
    );
  });

  it("a link of the chooser starts a flow that returns to the address it carried", async () => {
    const h = await harness();
    const returnTo = "https://diagrams.meltemi.dev/p/abc?x=1&y=2";
    const html = await textOf(await h.request(`/login?return_to=${encodeURIComponent(returnTo)}`));
    const href = hrefsOf(html).find((link) => link.startsWith("/login?provider=google"))!;
    const response = await h.request(href);
    expect(response.status).toBe(302);
    expect(decodeOauth(setCookie(response, OAUTH_COOKIE)!).payload).toMatchObject({
      provider: "google",
      returnTo,
    });
  });

  it("an empty return_to is no return_to: the links stay bare", async () => {
    const h = await harness();
    const html = await textOf(await h.request("/login?return_to="));
    expect(hrefsOf(html).filter((href) => href.startsWith("/login"))).toEqual([
      "/login?provider=github",
      "/login?provider=google",
    ]);
  });

  it("refuses a return address outside the family, with no links to follow it", async () => {
    const h = await harness();
    const response = await h.request("/login?return_to=https://evil.example/");
    expect(response.status).toBe(400);
    const html = await textOf(response);
    expect(html).toContain("return_to.invalid");
    expect(html).not.toContain("evil.example");
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("is the same chooser for a signed-in person, who may start another flow", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const response = await h.request("/login", { headers: { Cookie: person.cookie } });
    expect(response.status).toBe(200);
    expect(await textOf(response)).toContain("/login?provider=github");
  });

  it("answers only GET", async () => {
    const h = await harness();
    expect((await h.request("/login", { method: "POST" })).status).toBe(404);
  });
});

describe("GET /login?provider=github", () => {
  it("redirects to GitHub with the client, the callback, the scopes and a state", async () => {
    const h = await harness();
    const response = await h.request(
      "/login?provider=github&return_to=https://diagrams.meltemi.dev/",
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("test-github-client");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://id.meltemi.dev/callback/github",
    );
    expect(location.searchParams.get("scope")).toBe("read:user user:email");
    expect(location.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect([...location.searchParams.keys()].sort()).toEqual([
      "client_id",
      "redirect_uri",
      "scope",
      "state",
    ]);
  });

  it("encodes the space of the scope and the colons of the callback properly", async () => {
    const h = await harness();
    const response = await h.request("/login?provider=github");
    const raw = response.headers.get("Location")!;
    expect(raw).not.toMatch(/\s/);
    expect(raw).toContain("scope=read%3Auser+user%3Aemail");
    expect(raw).toContain("redirect_uri=https%3A%2F%2Fid.meltemi.dev%2Fcallback%2Fgithub");
  });

  it("sets the signed cookie for the callbacks only, out of reach of scripts", async () => {
    const h = await harness();
    const response = await h.request(
      "/login?provider=github&return_to=https://diagrams.meltemi.dev/",
    );
    const line = setCookieLine(response, OAUTH_COOKIE)!;
    expect(line).toMatch(/^meltemi_oauth=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+;/);
    expect(attributes(line).sort()).toEqual(
      ["Path=/callback", "Max-Age=600", "HttpOnly", "Secure", "SameSite=Lax"].sort(),
    );
    expect(line).not.toMatch(/Domain/i);
    expect(response.headers.getSetCookie()).toHaveLength(1);
  });

  it("holds the provider, the return address, the same state and the time, and nothing more", async () => {
    const h = await harness();
    const flow = await startFlow(h, "github", {
      query: { return_to: "https://diagrams.meltemi.dev/p/abc?x=1" },
    });
    const { payload } = decodeOauth(flow.value);
    expect(payload).toEqual({
      provider: "github",
      returnTo: "https://diagrams.meltemi.dev/p/abc?x=1",
      state: flow.state,
      issued: "2026-10-14T12:00:00.000Z",
    });
  });

  it("signs the value with STATE_SECRET, and with nothing else", async () => {
    const h = await harness();
    const flow = await startFlow(h, "github");
    const { payloadPart, signaturePart } = decodeOauth(flow.value);
    const signature = fromBase64url(signaturePart)!;
    expect(signature).toHaveLength(32);
    expect(await verifyHmac(STATE_SECRET, payloadPart, signature)).toBe(true);
    expect(await verifyHmac("another secret", payloadPart, signature)).toBe(false);
    expect(await verifyHmac(STATE_SECRET, payloadPart + "x", signature)).toBe(false);
  });

  it("leaks no secret into the redirect or the cookie", async () => {
    const h = await harness();
    const response = await h.request("/login?provider=github");
    const seen = response.headers.get("Location")! + response.headers.getSetCookie().join("\n");
    for (const secret of ["test-github-secret", "test-google-secret", STATE_SECRET]) {
      expect(seen).not.toContain(secret);
    }
  });

  it("uses no PKCE for GitHub and keeps no verifier", async () => {
    const h = await harness();
    const flow = await startFlow(h, "github");
    expect(flow.location.searchParams.has("code_challenge")).toBe(false);
    expect(decodeOauth(flow.value).payload).not.toHaveProperty("verifier");
  });

  it("is a redirect that is never cached, made without asking any provider", async () => {
    const h = await harness();
    const response = await h.request("/login?provider=github");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.stub.calls).toEqual([]);
  });

  it("gives every flow its own state", async () => {
    const h = await harness();
    const first = await startFlow(h, "github");
    const second = await startFlow(h, "github");
    expect(first.state).not.toBe(second.state);
    expect(first.value).not.toBe(second.value);
  });

  it("takes the client id from the environment", async () => {
    const h = await harness({ env: { GITHUB_CLIENT_ID: "another-client" } });
    const flow = await startFlow(h, "github");
    expect(flow.location.searchParams.get("client_id")).toBe("another-client");
  });

  it("returns to the site when no address is given", async () => {
    const h = await harness();
    const flow = await startFlow(h, "github");
    expect(decodeOauth(flow.value).payload["returnTo"]).toBe("https://meltemi.dev");
  });

  it("returns to the parsed address, not the raw text", async () => {
    const h = await harness();
    const flow = await startFlow(h, "github", {
      query: { return_to: "https://DIAGRAMS.meltemi.dev:443/x" },
    });
    expect(decodeOauth(flow.value).payload["returnTo"]).toBe("https://diagrams.meltemi.dev/x");
  });

  it("runs the flow for a signed-in person too, as an ordinary sign-in", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const flow = await startFlow(h, "github", { headers: { Cookie: person.cookie } });
    expect(flow.response.status).toBe(302);
    expect(decodeOauth(flow.value).payload).not.toHaveProperty("link");
  });
});

describe("GET /login?provider=google", () => {
  it("redirects to Google with the client, the callback, the scopes and a code challenge", async () => {
    const h = await harness();
    const flow = await startFlow(h, "google");
    expect(flow.response.status).toBe(302);
    const { location } = flow;
    expect(location.origin + location.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(location.searchParams.get("client_id")).toBe("test-google-client");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://id.meltemi.dev/callback/google",
    );
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("scope")).toBe("openid email profile");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect([...location.searchParams.keys()].sort()).toEqual([
      "client_id",
      "code_challenge",
      "code_challenge_method",
      "redirect_uri",
      "response_type",
      "scope",
      "state",
    ]);
    expect(flow.response.headers.get("Location")).toContain("scope=openid+email+profile");
  });

  it("keeps the verifier in the cookie, and its SHA-256 is the challenge", async () => {
    const h = await harness();
    const flow = await startFlow(h, "google");
    const { payload } = decodeOauth(flow.value);
    const verifier = payload["verifier"] as string;
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(flow.location.searchParams.get("code_challenge")).toBe(
      base64url(await sha256(verifier)),
    );
    // The challenge is the digest, never the verifier itself, and the verifier is not the state.
    expect(flow.location.searchParams.get("code_challenge")).not.toBe(verifier);
    expect(verifier).not.toBe(flow.state);
  });

  it("does not put the verifier in the redirect", async () => {
    const h = await harness();
    const flow = await startFlow(h, "google");
    const verifier = decodeOauth(flow.value).payload["verifier"] as string;
    expect(flow.response.headers.get("Location")).not.toContain(verifier);
  });

  it("sets the same kind of cookie as GitHub's", async () => {
    const h = await harness();
    const flow = await startFlow(h, "google");
    expect(attributes(setCookieLine(flow.response, OAUTH_COOKIE)).sort()).toEqual(
      ["Path=/callback", "Max-Age=600", "HttpOnly", "Secure", "SameSite=Lax"].sort(),
    );
    expect(decodeOauth(flow.value).payload).toMatchObject({ provider: "google" });
  });

  it("gives every flow its own verifier", async () => {
    const h = await harness();
    const first = decodeOauth((await startFlow(h, "google")).value).payload["verifier"];
    const second = decodeOauth((await startFlow(h, "google")).value).payload["verifier"];
    expect(first).not.toBe(second);
  });
});

describe("GET /login: unknown providers", () => {
  const unknown = [
    "facebook",
    "GitHub",
    "GOOGLE",
    "",
    " github",
    "github ",
    "github,google",
    "github/",
    "constructor",
    "__proto__",
    "toString",
    "hasOwnProperty",
  ];

  it.each(unknown)(
    "%j is refused with provider.unknown, no cookie and no redirect",
    async (name) => {
      const h = await harness();
      const response = await h.request(`/login?provider=${encodeURIComponent(name)}`);
      expect(response.status).toBe(400);
      expect(response.headers.get("Location")).toBeNull();
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await textOf(response)).toContain("provider.unknown");
    },
  );

  it("offers the way back to the chooser, keeping a valid return address", async () => {
    const h = await harness();
    const response = await h.request(
      "/login?provider=facebook&return_to=https://diagrams.meltemi.dev/p/1",
    );
    expect(hrefsOf(await textOf(response))).toContain(
      `/login?return_to=${encodeURIComponent("https://diagrams.meltemi.dev/p/1")}`,
    );
    const bare = await h.request("/login?provider=facebook");
    expect(hrefsOf(await textOf(bare))).toContain("/login");
  });

  it("checks the return address first: an invalid one wins over an unknown provider", async () => {
    const h = await harness();
    const response = await h.request("/login?provider=facebook&return_to=https://evil.example/");
    expect(response.status).toBe(400);
    const html = await textOf(response);
    expect(html).toContain("return_to.invalid");
    expect(html).not.toContain("provider.unknown");
  });
});

describe("GET /login: return addresses", () => {
  it("starts the flow for a subdomain, with path and query, and remembers it exactly", async () => {
    const h = await harness();
    const flow = await startFlow(h, "github", {
      query: { return_to: "https://diagrams.meltemi.dev/p/abc?x=1" },
    });
    expect(decodeOauth(flow.value).payload["returnTo"]).toBe(
      "https://diagrams.meltemi.dev/p/abc?x=1",
    );
  });

  const refused = [
    "https://meltemi.dev.evil.example/",
    "https://user@meltemi.dev/",
    "http://diagrams.meltemi.dev/",
    "https://diagrams.meltemi.dev:8443/",
    "https://evil.example\\@meltemi.dev/",
    "https://meltemi.dev/\r\nSet-Cookie: x=y",
    "javascript:alert(1)",
    "/relative",
  ];

  it.each(refused)("refuses %j: a 400 page, no cookie, no redirect", async (address) => {
    const h = await harness();
    for (const provider of ["github", "google"]) {
      const response = await h.request(
        `/login?provider=${provider}&return_to=${encodeURIComponent(address)}`,
      );
      expect(response.status).toBe(400);
      expect(await textOf(response)).toContain("return_to.invalid");
      expect(response.headers.get("Location")).toBeNull();
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    expect(h.stub.calls).toEqual([]);
  });

  it("accepts the development origins only in development mode", async () => {
    const address = "http://localhost:8788/";
    const production = await harness({ env: { DEV_ORIGINS: "http://localhost:8788" } });
    const refused = await production.request(
      `/login?provider=github&return_to=${encodeURIComponent(address)}`,
    );
    expect(refused.status).toBe(400);
    expect(await textOf(refused)).toContain("return_to.invalid");

    const dev = await harness({ env: DEV_ENV });
    const flow = await startFlow(dev, "github", { query: { return_to: address } });
    expect(decodeOauth(flow.value).payload["returnTo"]).toBe(address);
  });

  it("accepts the service's own origin only in development mode", async () => {
    const dev = await harness({ env: DEV_ENV });
    const flow = await startFlow(dev, "github", {
      query: { return_to: "http://localhost:8787/account" },
    });
    expect(decodeOauth(flow.value).payload["returnTo"]).toBe("http://localhost:8787/account");

    const notDev = await harness({
      env: NOT_DEV_ENV,
    });
    const refused = await notDev.request(
      `/login?provider=github&return_to=${encodeURIComponent("http://localhost:8787/account")}`,
    );
    expect(refused.status).toBe(400);
  });
});

describe("GET /login: development mode", () => {
  it("sends the provider back to the development service and drops Secure on http", async () => {
    const h = await harness({ env: DEV_ENV });
    const flow = await startFlow(h, "github");
    expect(flow.location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:8787/callback/github",
    );
    expect(attributes(setCookieLine(flow.response, OAUTH_COOKIE)).sort()).toEqual(
      ["Path=/callback", "Max-Age=600", "HttpOnly", "SameSite=Lax"].sort(),
    );
    expect(decodeOauth(flow.value).payload["returnTo"]).toBe("http://localhost:8789");
  });

  it("keeps Secure when the development service is served over https", async () => {
    const h = await harness({ env: { ...DEV_ENV, ISSUER: "https://localhost:8787" } });
    const flow = await startFlow(h, "github");
    expect(attributes(setCookieLine(flow.response, OAUTH_COOKIE))).toContain("Secure");
    expect(setCookieLine(flow.response, OAUTH_COOKIE)).not.toMatch(/Domain/i);
  });
});

describe("GET /login&link=1", () => {
  it("is an ordinary sign-in without a session", async () => {
    const h = await harness();
    const flow = await startFlow(h, "google", { query: { link: "1" } });
    const { payload } = decodeOauth(flow.value);
    expect(payload).not.toHaveProperty("link");
    expect(payload).not.toHaveProperty("userId");
  });

  it("remembers the signed-in user who asks to link a provider", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const flow = await startFlow(h, "google", {
      query: { link: "1", return_to: "https://id.meltemi.dev/account" },
      headers: { Cookie: person.cookie },
    });
    expect(decodeOauth(flow.value).payload).toMatchObject({
      provider: "google",
      returnTo: "https://id.meltemi.dev/account",
      link: true,
      userId: person.user.id,
    });
  });

  it("is ignored when the session cookie is not a session", async () => {
    const h = await harness();
    for (const cookie of ["meltemi_session=garbage", "meltemi_session=", "other=1"]) {
      const flow = await startFlow(h, "github", {
        query: { link: "1" },
        headers: { Cookie: cookie },
      });
      expect(decodeOauth(flow.value).payload, cookie).not.toHaveProperty("link");
    }
  });

  it("is ignored when the session was revoked or has expired", async () => {
    const h = await harness();
    const revoked = await signedInPerson(h);
    await h.store.revokeSession(revoked.session.sid, h.clock.now().toISOString());
    const flow = await startFlow(h, "github", {
      query: { link: "1" },
      headers: { Cookie: revoked.cookie },
    });
    expect(decodeOauth(flow.value).payload).not.toHaveProperty("link");

    const expired = await signedInPerson(h);
    h.clock.advance(31 * 24 * 60 * 60 * 1000);
    const late = await startFlow(h, "github", {
      query: { link: "1" },
      headers: { Cookie: expired.cookie },
    });
    expect(decodeOauth(late.value).payload).not.toHaveProperty("link");
  });

  it("is ignored when the signed-in user no longer exists", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    await h.store.deleteUser(person.user.id);
    const flow = await startFlow(h, "github", {
      query: { link: "1" },
      headers: { Cookie: person.cookie },
    });
    expect(decodeOauth(flow.value).payload).not.toHaveProperty("link");
  });

  it.each(["0", "true", "", "yes", "11"])("honours only link=1, not link=%j", async (value) => {
    const h = await harness();
    const person = await signedInPerson(h);
    const flow = await startFlow(h, "github", {
      query: { link: value },
      headers: { Cookie: person.cookie },
    });
    expect(decodeOauth(flow.value).payload).not.toHaveProperty("link");
  });
});

describe("GET /login: a provider that is not configured", () => {
  it("says the provider is unavailable, names the missing setting in the log and sets no cookie", async () => {
    const log = captureConsole();
    try {
      const h = await harness({ env: { GITHUB_CLIENT_ID: "" } });
      const response = await h.request("/login?provider=github");
      expect(response.status).toBe(502);
      expect(await textOf(response)).toContain("provider.unavailable");
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(response.headers.get("Location")).toBeNull();
      expect(log.lines()).toContain("GITHUB_CLIENT_ID");
      expect(log.lines()).not.toContain("test-github-secret");
      // The other provider is not affected.
      expect((await h.request("/login?provider=google")).status).toBe(302);
    } finally {
      log.restore();
    }
  });
});
