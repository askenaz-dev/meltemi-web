import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_ENV, anotherSession, formsOf } from "./support/account.js";
import { harness, setCookie, setCookieLine, signedInPerson, textOf } from "./support/index.js";
import type { Harness } from "./support/index.js";

const PRODUCTION_FORM_ACTION = "form-action 'self' https://meltemi.dev https://*.meltemi.dev";

afterEach(() => {
  vi.restoreAllMocks();
});

function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

interface LogoutOptions {
  readonly cookie?: string;
  /** The `Origin` header: a product's by default, `null` for none. */
  readonly origin?: string | null;
  readonly body?: string;
  readonly contentType?: string | null;
  readonly query?: string;
}

function postLogout(h: Harness, options: LogoutOptions = {}): Promise<Response> {
  const headers = new Headers();
  const origin = options.origin === undefined ? "https://diagrams.meltemi.dev" : options.origin;
  if (origin !== null) headers.set("Origin", origin);
  if (options.cookie) headers.set("Cookie", options.cookie);
  const contentType =
    options.contentType === undefined ? "application/x-www-form-urlencoded" : options.contentType;
  if (contentType !== null) headers.set("Content-Type", contentType);
  return h.request(`/logout${options.query ?? ""}`, {
    method: "POST",
    headers,
    ...(options.body !== undefined ? { body: options.body } : {}),
  });
}

async function isLive(h: Harness, sid: string): Promise<boolean> {
  return (await h.request(`/sessions/${sid}`)).status === 204;
}

describe("GET /logout", () => {
  it("shows a form that posts to /logout with the same return_to", async () => {
    const h = await harness();
    const response = await h.request("/logout?return_to=https://meltemi.dev/");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const page = await textOf(response);
    expect(page).toContain('<html lang="en">');

    const forms = formsOf(page);
    expect(forms).toHaveLength(1);
    const [form] = forms;
    expect(form?.method).toBe("post");
    expect(new URL(form!.action, "https://id.meltemi.dev").pathname).toBe("/logout");
    expect(form?.fields).toEqual({ return_to: "https://meltemi.dev/" });
    expect(form?.button).toBe("Sign out");
  });

  it("carries Referrer-Policy: same-origin and a form-action of the family's hosts", async () => {
    const h = await harness();
    const response = await h.request("/logout?return_to=https://meltemi.dev/");
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
    const policy = response.headers.get("Content-Security-Policy") ?? "";
    expect(policy.split("; ")).toContain(PRODUCTION_FORM_ACTION);
    expect(policy).toMatch(/^default-src 'none'/);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("offers a way back to the return address that does not sign out", async () => {
    const h = await harness();
    const page = await textOf(
      await h.request("/logout?return_to=https://diagrams.meltemi.dev/p/abc?x=1"),
    );
    expect(page).toContain('<a class="btn" href="https://diagrams.meltemi.dev/p/abc?x=1">');
  });

  it("uses the site as the return address when none is given", async () => {
    const h = await harness();
    const [form] = formsOf(await textOf(await h.request("/logout")));
    expect(form?.fields["return_to"]).toBe("https://meltemi.dev");
  });

  it("keeps a return address with a path and a query exactly", async () => {
    const h = await harness();
    const address = "https://diagrams.meltemi.dev/p/abc?x=1&y=two#top";
    const [form] = formsOf(
      await textOf(await h.request(`/logout?return_to=${encodeURIComponent(address)}`)),
    );
    expect(form?.fields["return_to"]).toBe(address);
  });

  it("is in Spanish by ?lang=es and by Accept-Language, and its form says so", async () => {
    const h = await harness();
    for (const response of [
      await h.request("/logout?lang=es"),
      await h.request("/logout", { headers: { "Accept-Language": "es-CL,es;q=0.9,en;q=0.8" } }),
    ]) {
      const page = await textOf(response);
      expect(page).toContain('<html lang="es">');
      expect(page).toContain("Cerrar sesión");
      expect(page).toContain("https://meltemi.dev/es/privacy/");
      expect(page).not.toContain("Sign out");
      expect(formsOf(page)[0]?.action).toBe("/logout?lang=es");
    }
  });

  it("falls back to English for a language it does not have", async () => {
    const h = await harness();
    const page = await textOf(await h.request("/logout?lang=fr"));
    expect(page).toContain('<html lang="en">');
    expect(page).toContain("Sign out");
  });

  it("changes nothing: a GET with a cookie does not end the session", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const response = await h.request("/logout", { headers: { Cookie: person.cookie } });
    expect(response.status).toBe(200);
    expect(setCookie(response, "meltemi_session")).toBeUndefined();
    expect(await isLive(h, person.session.sid)).toBe(true);
  });

  it.each([
    ["a foreign host", "https://evil.example/"],
    ["a look-alike host", "https://meltemi.dev.evil.example/"],
    ["a host that only ends alike", "https://notmeltemi.dev/"],
    ["credentials", "https://user@meltemi.dev/"],
    ["plain http", "http://meltemi.dev/"],
    ["a port", "https://meltemi.dev:8443/"],
    ["a script", "javascript:alert(1)"],
    ["a backslash", "https://evil.example\\@meltemi.dev/"],
    ["a relative address", "/account"],
    ["not an address", "not an address"],
  ])("refuses a return address with %s: 400 return_to.invalid and no form", async (_n, bad) => {
    const h = await harness();
    const response = await h.request(`/logout?return_to=${encodeURIComponent(bad)}`);
    expect(response.status).toBe(400);
    const page = await textOf(response);
    expect(page).toContain("return_to.invalid");
    expect(formsOf(page)).toEqual([]);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("escapes a hostile return address even though it is accepted", async () => {
    const h = await harness();
    // The address parser percent-encodes quotes and angle brackets; `&` and `'` survive it.
    const hostile = `https://diagrams.meltemi.dev/"><script>alert(1)</script>/'onmouseover='x()?a=1&b=2`;
    const page = await textOf(await h.request(`/logout?return_to=${encodeURIComponent(hostile)}`));
    expect(page).not.toMatch(/<script/i);
    expect(page).not.toContain("'onmouseover='");
    expect(page).toContain("&#39;onmouseover=&#39;x()?a=1&amp;b=2");
    const [form] = formsOf(page);
    expect(new URL(form!.fields["return_to"]!).hostname).toBe("diagrams.meltemi.dev");
  });

  describe("the policy of the page in development", () => {
    const origins = "http://localhost:8788 http://localhost:8789";

    it("lists the development origins in form-action only when DEV is true", async () => {
      const on = await harness({
        env: { DEV: "true", DEV_ORIGINS: "http://localhost:8788,http://localhost:8789" },
      });
      const policyOn = (await on.request("/logout")).headers.get("Content-Security-Policy") ?? "";
      expect(policyOn.split("; ")).toContain(`${PRODUCTION_FORM_ACTION} ${origins}`);

      const off = await harness({
        env: { DEV_ORIGINS: "http://localhost:8788,http://localhost:8789" },
      });
      const policyOff = (await off.request("/logout")).headers.get("Content-Security-Policy") ?? "";
      expect(policyOff.split("; ")).toContain(PRODUCTION_FORM_ACTION);
      expect(policyOff).not.toContain("localhost");
    });

    it("accepts a development return address in development mode and refuses it otherwise", async () => {
      const dev = await harness({ env: { ...DEV_ENV } });
      const accepted = await dev.request(
        `/logout?return_to=${encodeURIComponent("http://localhost:8788/")}`,
      );
      expect(accepted.status).toBe(200);
      expect(formsOf(await textOf(accepted))[0]?.fields["return_to"]).toBe(
        "http://localhost:8788/",
      );

      const production = await harness({ env: { DEV_ORIGINS: "http://localhost:8788" } });
      const refused = await production.request(
        `/logout?return_to=${encodeURIComponent("http://localhost:8788/")}`,
      );
      expect(refused.status).toBe(400);
      expect(await textOf(refused)).toContain("return_to.invalid");
    });
  });
});

describe("POST /logout", () => {
  it("lets a product sign the person out: revoked, cookie cleared, 302 to return_to", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const response = await postLogout(h, {
      cookie: person.cookie,
      body: formBody({ return_to: "https://diagrams.meltemi.dev/" }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://diagrams.meltemi.dev/");
    const line = setCookieLine(response, "meltemi_session");
    expect(line).toBeDefined();
    expect(line!.split("; ")).toEqual([
      "meltemi_session=",
      "Domain=meltemi.dev",
      "Path=/",
      "Max-Age=0",
      "Secure",
      "HttpOnly",
      "SameSite=Lax",
    ]);
    const stored = await h.store.session(person.session.sid);
    expect(stored?.revokedAt).toBe("2026-10-14T12:00:00.000Z");
    expect(await isLive(h, person.session.sid)).toBe(false);
  });

  it("revokes only the session of the cookie: the person's other devices stay signed in", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const phone = await anotherSession(h, person);
    await postLogout(h, {
      cookie: person.cookie,
      body: formBody({ return_to: "https://meltemi.dev/" }),
    });
    expect(await isLive(h, person.session.sid)).toBe(false);
    expect(await isLive(h, phone.session.sid)).toBe(true);
  });

  it("stamps the time of the request as the revocation time", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    h.clock.set("2026-10-20T07:08:09.000Z");
    await postLogout(h, { cookie: person.cookie });
    expect((await h.store.session(person.session.sid))?.revokedAt).toBe("2026-10-20T07:08:09.000Z");
  });

  it("treats the cookie as gone afterwards: the account page sends the person to sign in", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    await postLogout(h, { cookie: person.cookie });
    const response = await h.request("/account", { headers: { Cookie: person.cookie } });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toMatch(/^\/login\?/);
  });

  it("goes to the site when no return_to is given", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const response = await postLogout(h, { cookie: person.cookie });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://meltemi.dev");
    expect(await isLive(h, person.session.sid)).toBe(false);
  });

  it("goes to the site when return_to is empty", async () => {
    const h = await harness();
    const response = await postLogout(h, { body: formBody({ return_to: "" }) });
    expect(response.headers.get("Location")).toBe("https://meltemi.dev");
  });

  it("reads return_to from the query when the body has none", async () => {
    const h = await harness();
    const response = await postLogout(h, {
      query: `?return_to=${encodeURIComponent("https://diagrams.meltemi.dev/p/1")}`,
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://diagrams.meltemi.dev/p/1");
  });

  it("reads return_to from the query when the form's field is empty", async () => {
    const h = await harness();
    const response = await postLogout(h, {
      body: formBody({ return_to: "" }),
      query: `?return_to=${encodeURIComponent("https://diagrams.meltemi.dev/q")}`,
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://diagrams.meltemi.dev/q");
  });

  it("prefers the form's return_to over the query's", async () => {
    const h = await harness();
    const response = await postLogout(h, {
      body: formBody({ return_to: "https://diagrams.meltemi.dev/from-form" }),
      query: `?return_to=${encodeURIComponent("https://diagrams.meltemi.dev/from-query")}`,
    });
    expect(response.headers.get("Location")).toBe("https://diagrams.meltemi.dev/from-form");
  });

  it("follows the first return_to when a form repeats the field", async () => {
    const h = await harness();
    const response = await postLogout(h, {
      body: "return_to=https%3A%2F%2Fdiagrams.meltemi.dev%2Fa&return_to=https%3A%2F%2Fevil.example%2F",
    });
    expect(response.headers.get("Location")).toBe("https://diagrams.meltemi.dev/a");
  });

  it("accepts a multipart form as well", async () => {
    const h = await harness();
    const data = new FormData();
    data.set("return_to", "https://diagrams.meltemi.dev/multipart");
    const response = await h.request("/logout", {
      method: "POST",
      headers: { Origin: "https://diagrams.meltemi.dev" },
      body: data,
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://diagrams.meltemi.dev/multipart");
  });

  it("ignores a body that is not a form and uses the query, or the site", async () => {
    const h = await harness();
    const json = await postLogout(h, {
      contentType: "application/json",
      body: JSON.stringify({ return_to: "https://evil.example/" }),
    });
    expect(json.status).toBe(302);
    expect(json.headers.get("Location")).toBe("https://meltemi.dev");

    const empty = await postLogout(h, { contentType: null });
    expect(empty.status).toBe(302);
    expect(empty.headers.get("Location")).toBe("https://meltemi.dev");

    const brokenMultipart = await postLogout(h, {
      contentType: "multipart/form-data; boundary=xyz",
      body: "this is not multipart",
      query: `?return_to=${encodeURIComponent("https://diagrams.meltemi.dev/q")}`,
    });
    expect(brokenMultipart.status).toBe(302);
    expect(brokenMultipart.headers.get("Location")).toBe("https://diagrams.meltemi.dev/q");
  });

  describe("without a valid cookie it still clears the cookie and redirects", () => {
    it.each([
      ["no cookie", undefined],
      ["a cookie that is not a token", "meltemi_session=not-a-token"],
      ["an empty cookie", "meltemi_session="],
      ["another cookie", "other=1"],
    ])("%s", async (_name, cookie) => {
      const h = await harness();
      const live = await signedInPerson(h);
      const response = await postLogout(h, {
        ...(cookie ? { cookie } : {}),
        body: formBody({ return_to: "https://diagrams.meltemi.dev/" }),
      });
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("https://diagrams.meltemi.dev/");
      expect(setCookieLine(response, "meltemi_session")).toContain("Max-Age=0");
      // Somebody else's session is none of its business.
      expect(await isLive(h, live.session.sid)).toBe(true);
    });

    it("a tampered token", async () => {
      const h = await harness();
      const person = await signedInPerson(h);
      const [head, payload, signature] = person.token.split(".");
      const forged = `${head}.${payload!.slice(0, -2)}${payload!.endsWith("AA") ? "BB" : "AA"}.${signature}`;
      const response = await postLogout(h, { cookie: `meltemi_session=${forged}` });
      expect(response.status).toBe(302);
      expect(setCookieLine(response, "meltemi_session")).toContain("Max-Age=0");
      expect(await isLive(h, person.session.sid)).toBe(true);
    });

    it("a token whose session is already gone from the store", async () => {
      const h = await harness();
      const person = await signedInPerson(h);
      await h.store.deleteUser(person.user.id);
      const response = await postLogout(h, { cookie: person.cookie });
      expect(response.status).toBe(302);
      expect(setCookieLine(response, "meltemi_session")).toContain("Max-Age=0");
    });
  });

  it("is idempotent: a second sign-out clears the cookie again and keeps the first revocation time", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    await postLogout(h, { cookie: person.cookie });
    h.clock.advance(5 * 60_000);
    const again = await postLogout(h, { cookie: person.cookie });
    expect(again.status).toBe(302);
    expect(setCookieLine(again, "meltemi_session")).toContain("Max-Age=0");
    expect((await h.store.session(person.session.sid))?.revokedAt).toBe("2026-10-14T12:00:00.000Z");
  });

  describe("the Origin rule", () => {
    it.each([
      ["a product", "https://diagrams.meltemi.dev"],
      ["the site", "https://meltemi.dev"],
      ["the service itself", "https://id.meltemi.dev"],
      ["a future product", "https://anything.meltemi.dev"],
      ["a deeper subdomain", "https://a.b.meltemi.dev"],
    ])("accepts %s", async (_name, origin) => {
      const h = await harness();
      const person = await signedInPerson(h);
      const response = await postLogout(h, { cookie: person.cookie, origin });
      expect(response.status).toBe(302);
      expect(await isLive(h, person.session.sid)).toBe(false);
    });

    it.each([
      ["a foreign origin", "https://evil.example"],
      ["a look-alike that contains the domain", "https://meltemi.dev.evil.example"],
      ["a look-alike that ends alike", "https://evilmeltemi.dev"],
      ["a product over plain http", "http://diagrams.meltemi.dev"],
      ["a family host on another port", "https://diagrams.meltemi.dev:8443"],
      ["the null origin", "null"],
      ["something that is not an origin", "not an origin"],
      ["an empty origin", ""],
      ["a development origin outside development", "http://localhost:8788"],
    ])("refuses %s with 403 and changes nothing", async (_name, origin) => {
      const h = await harness({ env: { DEV_ORIGINS: "http://localhost:8788" } });
      const person = await signedInPerson(h);
      const response = await postLogout(h, {
        cookie: person.cookie,
        origin,
        body: formBody({ return_to: "https://diagrams.meltemi.dev/" }),
      });
      expect(response.status).toBe(403);
      expect(await textOf(response)).toContain("request.forbidden");
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(response.headers.get("Location")).toBeNull();
      expect(await isLive(h, person.session.sid)).toBe(true);
      expect((await h.store.session(person.session.sid))?.revokedAt).toBeNull();
    });

    it("refuses a request with no Origin header at all, like a foreign one", async () => {
      const h = await harness();
      const person = await signedInPerson(h);
      const response = await postLogout(h, { cookie: person.cookie, origin: null });
      expect(response.status).toBe(403);
      expect(await textOf(response)).toContain("request.forbidden");
      expect(await isLive(h, person.session.sid)).toBe(true);
    });

    it("refuses before it looks at the return address", async () => {
      const h = await harness();
      const response = await postLogout(h, {
        origin: "https://evil.example",
        body: formBody({ return_to: "https://evil.example/" }),
      });
      expect(response.status).toBe(403);
    });

    it("says why in Spanish and offers the site", async () => {
      const h = await harness();
      const response = await postLogout(h, { origin: "https://evil.example", query: "?lang=es" });
      expect(response.status).toBe(403);
      const page = await textOf(response);
      expect(page).toContain('<html lang="es">');
      expect(page).toContain("Se rechazó esta petición");
      expect(page).toContain('href="https://meltemi.dev"');
    });

    it("accepts the development origins in development mode only", async () => {
      const dev = await harness({ env: { ...DEV_ENV } });
      const person = await signedInPerson(dev);
      for (const origin of ["http://localhost:8788", "http://localhost:8789"]) {
        const again = await anotherSession(dev, person);
        const response = await postLogout(dev, { cookie: again.cookie, origin });
        expect(response.status).toBe(302);
        expect(await isLive(dev, again.session.sid)).toBe(false);
      }
      // The service's own origin counts too: the account page's form posts from it.
      const own = await anotherSession(dev, person);
      const fromAccount = await postLogout(dev, {
        cookie: own.cookie,
        origin: "http://localhost:8787",
      });
      expect(fromAccount.status).toBe(302);
      expect(await isLive(dev, own.session.sid)).toBe(false);
      // A localhost origin nobody listed is still foreign.
      const stranger = await postLogout(dev, { origin: "http://localhost:9999" });
      expect(stranger.status).toBe(403);
    });
  });

  describe("the return address", () => {
    it.each([
      ["a foreign host", "https://evil.example/"],
      ["a look-alike host", "https://meltemi.dev.evil.example/"],
      ["credentials", "https://user@meltemi.dev/"],
      ["plain http", "http://diagrams.meltemi.dev/"],
      ["a script", "javascript:alert(1)"],
      ["a backslash", "https://evil.example\\@diagrams.meltemi.dev/"],
      ["a line break", "https://diagrams.meltemi.dev/\r\nSet-Cookie: x=1"],
      ["a relative address", "/account"],
    ])(
      "refuses %s with 400 return_to.invalid and changes nothing, from the form",
      async (_name, bad) => {
        const h = await harness();
        const person = await signedInPerson(h);
        const response = await postLogout(h, {
          cookie: person.cookie,
          body: formBody({ return_to: bad }),
        });
        expect(response.status).toBe(400);
        expect(await textOf(response)).toContain("return_to.invalid");
        expect(response.headers.get("Location")).toBeNull();
        expect(response.headers.getSetCookie()).toEqual([]);
        expect(await isLive(h, person.session.sid)).toBe(true);
      },
    );

    it("refuses a bad return address in the query too, and changes nothing", async () => {
      const h = await harness();
      const person = await signedInPerson(h);
      const response = await postLogout(h, {
        cookie: person.cookie,
        query: `?return_to=${encodeURIComponent("https://evil.example/")}`,
      });
      expect(response.status).toBe(400);
      expect(await isLive(h, person.session.sid)).toBe(true);
    });

    it("refuses a bad first return_to even when a later one is fine", async () => {
      const h = await harness();
      const person = await signedInPerson(h);
      const response = await postLogout(h, {
        cookie: person.cookie,
        body: "return_to=https%3A%2F%2Fevil.example%2F&return_to=https%3A%2F%2Fmeltemi.dev%2F",
      });
      expect(response.status).toBe(400);
      expect(await isLive(h, person.session.sid)).toBe(true);
    });

    it("accepts the site, a product and a development origin in development mode", async () => {
      const dev = await harness({ env: { ...DEV_ENV } });
      for (const target of [
        "http://localhost:8788/",
        "http://localhost:8789/",
        "http://localhost:8787/account",
      ]) {
        const response = await postLogout(dev, {
          origin: "http://localhost:8788",
          body: formBody({ return_to: target }),
        });
        expect(response.status).toBe(302);
        expect(response.headers.get("Location")).toBe(target);
      }
    });

    it("clears the development cookie with the development attributes", async () => {
      const dev = await harness({ env: { ...DEV_ENV } });
      const person = await signedInPerson(dev);
      const response = await postLogout(dev, {
        cookie: person.cookie,
        origin: "http://localhost:8788",
      });
      expect(setCookieLine(response, "meltemi_session")?.split("; ")).toEqual([
        "meltemi_session=",
        "Path=/",
        "Max-Age=0",
        "HttpOnly",
        "SameSite=Lax",
      ]);
    });
  });

  it("answers a failing store with an error, not with a person who looks signed out", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(h.store, "revokeSession").mockRejectedValue(new Error("database is down"));
    const response = await postLogout(h, { cookie: person.cookie });
    expect(response.status).toBe(500);
    expect(response.headers.getSetCookie()).toEqual([]);
    const page = await textOf(response);
    expect(page).not.toContain("database is down");
  });

  it("does not cache the redirect", async () => {
    const h = await harness();
    const response = await postLogout(h);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
