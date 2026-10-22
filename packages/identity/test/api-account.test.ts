// The account API for products (`identity-account`, "The account API for products"): signed calls
// that carry the person's session token, JSON answers, refusals with stable codes, no cookie and
// no CORS.

import { describe, expect, it } from "vitest";
import type { AccountView } from "../src/account-view.js";
import { signedProductCall, type ProductCallOptions } from "../src/testing.js";
import type { Identity } from "../src/types.js";
import { FIREFOX_ON_ANDROID, anotherSession } from "./support/account.js";
import { harness, signedInPerson, type Harness, type SeededPerson } from "./support/index.js";

const ISSUER = "https://id.meltemi.dev";
const SECRET = "test-events-secret";

type Call = Omit<ProductCallOptions, "product" | "secret" | "url" | "token"> &
  Partial<Pick<ProductCallOptions, "product" | "secret" | "token">>;

/** A call as Meltemi Diagrams' Worker makes it, signed at the harness's time. */
async function call(h: Harness, path: string, who: { token: string }, options: Call = {}) {
  const request = await signedProductCall({
    product: "diagrams",
    secret: SECRET,
    url: `${ISSUER}${path}`,
    token: who.token,
    now: h.clock.now(),
    ...options,
  });
  return h.request(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.method === "GET" ? {} : { body: await request.text() }),
  });
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function isLive(h: Harness, sid: string): Promise<boolean> {
  return (await h.request(`/sessions/${sid}`)).status === 204;
}

function googleIdentity(userId: string, at: string): Identity {
  return {
    provider: "google",
    providerId: "g-7777",
    userId,
    email: "ana@example.com",
    emailVerified: true,
    verifiedAt: at,
    handle: "",
    linkedAt: at,
  };
}

async function withPhone(h: Harness): Promise<{
  person: SeededPerson;
  phone: Awaited<ReturnType<typeof anotherSession>>;
}> {
  h.clock.set("2026-10-10T08:00:00.000Z");
  const person = await signedInPerson(h, { handle: "ana-dev" });
  h.clock.set("2026-10-12T09:00:00.000Z");
  const phone = await anotherSession(h, person, FIREFOX_ON_ANDROID);
  h.clock.set("2026-10-14T12:00:00.000Z");
  return { person, phone };
}

describe("GET /api/account", () => {
  it("answers the person, their identities and their sessions, the token's marked current", async () => {
    const h = await harness();
    const { person, phone } = await withPhone(h);
    const response = await call(h, "/api/account", person);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const view = await json<AccountView>(response);
    expect(view.user).toEqual({
      id: person.user.id,
      name: "Ana Dev",
      picture: "https://avatars.githubusercontent.com/u/4242",
    });
    expect(view.identities).toEqual([
      {
        provider: "github",
        email: "ana@example.com",
        emailVerified: true,
        handle: "ana-dev",
        linkedAt: "2026-10-10T08:00:00.000Z",
      },
    ]);
    expect(view.canUnlink).toBe(false);
    expect(view.sessions.map((s) => [s.sid, s.label, s.current])).toEqual([
      [phone.session.sid, "Firefox on Android", false],
      [person.session.sid, "Edge on Windows", true],
    ]);
    expect(view.sessions[1]).toMatchObject({
      createdAt: "2026-10-10T08:00:00.000Z",
      expiresAt: "2026-11-09T08:00:00.000Z",
    });
  });

  it("says a person with two providers may unlink one", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    await h.store.addIdentity(googleIdentity(person.user.id, h.clock.now().toISOString()));
    const view = await json<AccountView>(await call(h, "/api/account", person));
    expect(view.identities.map((i) => i.provider).sort()).toEqual(["github", "google"]);
    expect(view.canUnlink).toBe(true);
  });
});

describe("the two credentials", () => {
  it("ignores the browser's cookie: without a signature the answer is 401 product.unauthorized", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const response = await h.request("/api/account", {
      headers: { Cookie: person.cookie, Origin: "https://diagrams.meltemi.dev" },
    });
    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ error: "product.unauthorized" });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("does not take the cookie for the bearer either: a signed call without one is session.invalid", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const request = await signedProductCall({
      product: "diagrams",
      secret: SECRET,
      url: `${ISSUER}/api/account`,
      token: "unused",
      now: h.clock.now(),
    });
    const headers = new Headers(request.headers);
    headers.delete("Authorization");
    headers.set("Cookie", person.cookie);
    const response = await h.request("/api/account", { headers });
    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ error: "session.invalid" });
  });

  it("refuses a stale timestamp, and changes nothing", async () => {
    const h = await harness();
    const { person, phone } = await withPhone(h);
    const stale = new Date(h.clock.now().getTime() - 11 * 60_000);
    const response = await call(h, "/api/account/sessions/revoke-others", person, {
      body: {},
      now: stale,
    });
    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ error: "product.unauthorized" });
    expect(await isLive(h, phone.session.sid)).toBe(true);
  });

  it("refuses a call signed with another product's secret, and a product that is not listed", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const forged = await call(h, "/api/account", person, { secret: "another-products-secret" });
    expect(forged.status).toBe(401);
    expect(await json(forged)).toEqual({ error: "product.unauthorized" });
    const stranger = await call(h, "/api/account", person, { product: "stranger" });
    expect(await json(stranger)).toEqual({ error: "product.unauthorized" });
  });

  it("refuses a body other than the one signed", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    await h.store.addIdentity(googleIdentity(person.user.id, h.clock.now().toISOString()));
    const request = await signedProductCall({
      product: "diagrams",
      secret: SECRET,
      url: `${ISSUER}/api/account/unlink`,
      body: { provider: "github" },
      token: person.token,
      now: h.clock.now(),
    });
    const response = await h.request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({ provider: "google" }),
    });
    expect(response.status).toBe(401);
    expect((await h.store.identitiesOf(person.user.id)).length).toBe(2);
  });

  it("answers session.invalid for a well-signed call whose session was revoked", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    await h.store.revokeSession(person.session.sid, h.clock.now().toISOString());
    const response = await call(h, "/api/account", person);
    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ error: "session.invalid" });
  });

  it("answers session.invalid for a token that is not one", async () => {
    const h = await harness();
    const response = await call(h, "/api/account", { token: "not-a-token" });
    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ error: "session.invalid" });
  });
});

describe("POST /api/account/unlink", () => {
  it("unlinks one of two providers and answers the account as it is now", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    await h.store.addIdentity(googleIdentity(person.user.id, h.clock.now().toISOString()));
    const response = await call(h, "/api/account/unlink", person, { body: { provider: "google" } });
    expect(response.status).toBe(200);
    const view = await json<AccountView>(response);
    expect(view.identities.map((i) => i.provider)).toEqual(["github"]);
    expect(view.canUnlink).toBe(false);
  });

  it("keeps the last identity: 409 identity.last", async () => {
    const h = await harness();
    const person = await signedInPerson(h, { provider: "google", handle: "" });
    const response = await call(h, "/api/account/unlink", person, { body: { provider: "google" } });
    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({ error: "identity.last" });
    expect((await h.store.identitiesOf(person.user.id)).length).toBe(1);
  });

  it("answers 400 provider.unknown for a provider the service does not have", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const response = await call(h, "/api/account/unlink", person, { body: { provider: "gitlab" } });
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: "provider.unknown" });
  });

  it("answers 400 request.invalid for a body that is not a JSON object", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const response = await call(h, "/api/account/unlink", person, { body: ["github"] });
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: "request.invalid" });
  });
});

describe("signing out sessions", () => {
  it("revokes one other session: it answers 404 to the check afterwards, the current one 204", async () => {
    const h = await harness();
    const { person, phone } = await withPhone(h);
    const response = await call(h, `/api/account/sessions/${phone.session.sid}/revoke`, person, {
      body: {},
    });
    expect(response.status).toBe(200);
    expect(await isLive(h, phone.session.sid)).toBe(false);
    expect(await isLive(h, person.session.sid)).toBe(true);
    const view = await json<AccountView>(response);
    expect(view.sessions.map((s) => s.sid)).toEqual([person.session.sid]);
  });

  it("refuses the current session: 409 session.current, and it stays live", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const response = await call(h, `/api/account/sessions/${person.session.sid}/revoke`, person, {
      body: {},
    });
    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({ error: "session.current" });
    expect(await isLive(h, person.session.sid)).toBe(true);
  });

  it("answers 404 session.not-found for another person's session, which stays live", async () => {
    const h = await harness();
    const ana = await signedInPerson(h, { id: "user-ana" });
    const bea = await signedInPerson(h, { id: "user-bea", providerId: "bea-provider" });
    const response = await call(h, `/api/account/sessions/${bea.session.sid}/revoke`, ana, {
      body: {},
    });
    expect(response.status).toBe(404);
    expect(await json(response)).toEqual({ error: "session.not-found" });
    expect(await isLive(h, bea.session.sid)).toBe(true);
  });

  it("answers the account for a session of the person that already ended", async () => {
    const h = await harness();
    const { person, phone } = await withPhone(h);
    await h.store.revokeSession(phone.session.sid, h.clock.now().toISOString());
    const response = await call(h, `/api/account/sessions/${phone.session.sid}/revoke`, person, {
      body: {},
    });
    expect(response.status).toBe(200);
  });

  it("answers 404 session.not-found for an id that cannot be a session", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const response = await call(h, "/api/account/sessions/nope/revoke", person, { body: {} });
    expect(response.status).toBe(404);
    expect(await json(response)).toEqual({ error: "session.not-found" });
  });

  it("revokes every other session with revoke-others", async () => {
    const h = await harness();
    const { person, phone } = await withPhone(h);
    const tablet = await anotherSession(h, person);
    const response = await call(h, "/api/account/sessions/revoke-others", person, { body: {} });
    expect(response.status).toBe(200);
    expect(await isLive(h, phone.session.sid)).toBe(false);
    expect(await isLive(h, tablet.session.sid)).toBe(false);
    expect(await isLive(h, person.session.sid)).toBe(true);
    const view = await json<AccountView>(response);
    expect(view.sessions.map((s) => s.current)).toEqual([true]);
  });
});

describe("limits and unknown requests", () => {
  it("reads a body of at most 8 KiB", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const response = await call(h, "/api/account/unlink", person, {
      body: { provider: "google", padding: "x".repeat(9000) },
    });
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: "request.invalid" });
  });

  it("answers 429 rate.limited past sixty calls in a minute for one product and person", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    for (let i = 0; i < 60; i++) {
      expect((await call(h, "/api/account", person)).status, `call ${i + 1}`).toBe(200);
    }
    const over = await call(h, "/api/account", person);
    expect(over.status).toBe(429);
    expect(await json(over)).toEqual({ error: "rate.limited" });
    h.clock.advance(60_000);
    expect((await call(h, "/api/account", person)).status).toBe(200);
  });

  it("answers OPTIONS and an unknown path of the API with JSON 404 and no CORS header", async () => {
    const h = await harness();
    const preflight = await h.request("/api/account", {
      method: "OPTIONS",
      headers: {
        Origin: "https://diagrams.meltemi.dev",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(preflight.status).toBe(404);
    expect(await json(preflight)).toEqual({ error: "not-found" });
    for (const name of [
      "Access-Control-Allow-Origin",
      "Access-Control-Allow-Credentials",
      "Access-Control-Allow-Headers",
      "Access-Control-Allow-Methods",
    ]) {
      expect(preflight.headers.get(name), name).toBeNull();
    }
    const unknown = await h.request("/api/nothing");
    expect(unknown.status).toBe(404);
    expect(await json(unknown)).toEqual({ error: "not-found" });
    expect(unknown.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
