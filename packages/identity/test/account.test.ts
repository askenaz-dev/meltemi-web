import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfig } from "../src/config.js";
import { resolveReturnTo } from "../src/return-to.js";
import { startSession } from "../src/session.js";
import { d1Store } from "../src/store/d1.js";
import { signSessionToken, testKeys } from "../src/testing.js";
import type { Identity, Session } from "../src/types.js";
import {
  DEV_ENV,
  EDGE_ON_WINDOWS,
  FIREFOX_ON_ANDROID,
  SAFARI_ON_IOS,
  anotherSession,
  csrfOf,
  formPost,
  formsOf,
  submitForm,
  type ParsedForm,
} from "./support/account.js";
import {
  harness,
  setCookie,
  setCookieLine,
  signedInPerson,
  textOf,
  type Harness,
  type SeededPerson,
} from "./support/index.js";
import { openDatabase, sqliteAvailable, withLatency } from "./support/sqlite.js";

const ISSUER = "https://id.meltemi.dev";
const FAR_FUTURE = "2999-01-01T00:00:00.000Z";
const PRODUCTION_FORM_ACTION = "form-action 'self' https://meltemi.dev https://*.meltemi.dev";

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------
// Fixtures

interface Seeded {
  readonly person: SeededPerson;
  readonly phone: { session: Session; cookie: string };
}

/**
 * Ana: GitHub since 1 October and Google since 9 October, signed in on a Windows laptop (1 October)
 * and on an Android phone (10 October). The clock ends on 14 October.
 */
async function seed(h: Harness, options: { name?: string } = {}): Promise<Seeded> {
  h.clock.set("2026-10-01T08:00:00.000Z");
  const person = await signedInPerson(h, {
    ...(options.name !== undefined ? { name: options.name } : {}),
    handle: "ana-dev",
    userAgent: EDGE_ON_WINDOWS,
  });
  h.clock.set("2026-10-09T18:30:00.000Z");
  await h.store.addIdentity(googleIdentity(person.user.id, h.clock.now().toISOString()));
  h.clock.set("2026-10-10T07:15:00.000Z");
  const phone = await anotherSession(h, person, FIREFOX_ON_ANDROID);
  h.clock.set("2026-10-14T12:00:00.000Z");
  return { person, phone };
}

function googleIdentity(userId: string, at: string, overrides: Partial<Identity> = {}): Identity {
  return {
    provider: "google",
    providerId: "g-7777",
    userId,
    email: "ana@example.com",
    emailVerified: true,
    verifiedAt: at,
    handle: "",
    linkedAt: at,
    ...overrides,
  };
}

async function page(
  h: Harness,
  cookie: string,
  query = "",
  init: RequestInit = {},
): Promise<string> {
  const response = await h.request(`/account${query}`, {
    ...init,
    headers: { Cookie: cookie, ...(init.headers as Record<string, string> | undefined) },
  });
  expect(response.status).toBe(200);
  return textOf(response);
}

/** The part of the page under an `<h2>` with this text, up to the next one. */
function sectionOf(html: string, heading: string): string {
  const start = html.indexOf(`<h2>${heading}</h2>`);
  expect(start, `a section titled ${heading}`).toBeGreaterThanOrEqual(0);
  const next = html.indexOf("<h2>", start + 1);
  return html.slice(start, next < 0 ? undefined : next);
}

function rowsOf(html: string): string[] {
  return [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .map((match) => match[1] ?? "")
    .filter((row) => row.includes("<td"));
}

function formByPath(html: string, path: string): ParsedForm {
  const form = formsOf(html).find((f) => new URL(f.action, ISSUER).pathname === path);
  if (!form) throw new Error(`the page has no form posting to ${path}`);
  return form;
}

async function isLive(h: Harness, sid: string): Promise<boolean> {
  return (await h.request(`/sessions/${sid}`)).status === 204;
}

async function outbox(h: Harness) {
  return h.store.dueEvents(FAR_FUTURE, 100);
}

/** Everything of the seeded person is still there. */
async function expectUnchanged(h: Harness, { person, phone }: Seeded): Promise<void> {
  expect(await h.store.userById(person.user.id)).toBeDefined();
  const providers = (await h.store.identitiesOf(person.user.id)).map((i) => i.provider);
  expect(providers).toEqual(["github", "google"]);
  for (const session of [person.session, phone.session]) {
    expect((await h.store.session(session.sid))?.revokedAt).toBeNull();
    expect(await isLive(h, session.sid)).toBe(true);
  }
  expect(await outbox(h)).toEqual([]);
}

// ---------------------------------------------------------------------------------------------
// GET /account

describe("GET /account when signed out", () => {
  it("redirects to the chooser with the account page as the return address", async () => {
    const h = await harness();
    const response = await h.request("/account");
    expect(response.status).toBe(302);
    const location = response.headers.get("Location")!;
    const target = new URL(location, ISSUER);
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("return_to")).toBe("https://id.meltemi.dev/account");
    expect(location).toBe("/login?return_to=https%3A%2F%2Fid.meltemi.dev%2Faccount");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns to the development service's own account page in development", async () => {
    const dev = await harness({ env: { ...DEV_ENV } });
    const location = (await dev.request("/account")).headers.get("Location")!;
    expect(new URL(location, "http://localhost:8787").searchParams.get("return_to")).toBe(
      "http://localhost:8787/account",
    );
  });

  it.each([
    ["a cookie that is not a token", () => "meltemi_session=not-a-token"],
    ["an empty cookie", () => "meltemi_session="],
  ])("treats %s as signed out", async (_name, cookieOf) => {
    const h = await harness();
    const response = await h.request("/account", { headers: { Cookie: cookieOf() } });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toMatch(/^\/login\?return_to=/);
  });

  it("treats a tampered token as signed out", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const [head, payload, signature] = person.token.split(".");
    const forged = `${head}.${payload!.slice(0, -2)}${payload!.endsWith("AA") ? "BB" : "AA"}.${signature}`;
    const response = await h.request("/account", {
      headers: { Cookie: `meltemi_session=${forged}` },
    });
    expect(response.status).toBe(302);
  });

  it("treats a token of the right shape signed with another key as signed out", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const stranger = await testKeys();
    const token = await signSessionToken(
      { sub: person.user.id, sid: person.session.sid, iss: ISSUER },
      stranger,
      h.clock.now(),
    );
    const response = await h.request("/account", {
      headers: { Cookie: `meltemi_session=${token}` },
    });
    expect(response.status).toBe(302);
  });

  it("treats a revoked session as signed out", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    await h.store.revokeSession(person.session.sid, h.clock.now().toISOString());
    expect((await h.request("/account", { headers: { Cookie: person.cookie } })).status).toBe(302);
  });

  it("treats an expired session as signed out", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    h.clock.advance(31 * 24 * 60 * 60 * 1000);
    expect((await h.request("/account", { headers: { Cookie: person.cookie } })).status).toBe(302);
  });

  it("treats a session of a deleted user as signed out", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    await h.store.deleteUser(person.user.id);
    expect((await h.request("/account", { headers: { Cookie: person.cookie } })).status).toBe(302);
  });
});

describe("GET /account when signed in", () => {
  it("lists both identities with their link dates and both sessions, marks the current one, and is not cached", async () => {
    const h = await harness();
    const { person, phone } = await seed(h);
    const response = await h.request("/account", { headers: { Cookie: person.cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const html = await textOf(response);
    expect(html).toContain('<html lang="en">');

    const identities = rowsOf(sectionOf(html, "Linked sign-ins"));
    expect(identities).toHaveLength(2);
    const [github, google] = identities;
    expect(github).toContain("<td>GitHub</td>");
    expect(github).toContain("<td>ana-dev</td>");
    expect(github).toContain("<td>October 1, 2026</td>");
    expect(google).toContain("<td>Google</td>");
    expect(google).toContain("<td>ana@example.com</td>");
    expect(google).toContain("<td>October 9, 2026</td>");

    const sessions = rowsOf(sectionOf(html, "Where you are signed in"));
    expect(sessions).toHaveLength(2);
    const laptop = sessions.find((row) => row.includes("Edge on Windows"))!;
    const mobile = sessions.find((row) => row.includes("Firefox on Android"))!;
    expect(laptop).toContain('<span class="badge">This session</span>');
    expect(laptop).toContain("Oct 1, 2026");
    expect(mobile).not.toContain("badge");
    expect(mobile).toContain("Oct 10, 2026");
    expect(laptop + mobile).toContain("UTC");
    expect(html.match(/This session/g)).toHaveLength(1);

    // From the phone the badge moves.
    const fromPhone = await page(h, phone.cookie);
    const phoneRows = rowsOf(sectionOf(fromPhone, "Where you are signed in"));
    expect(phoneRows.find((row) => row.includes("Firefox on Android"))).toContain("badge");
    expect(phoneRows.find((row) => row.includes("Edge on Windows"))).not.toContain("badge");
  });

  it("carries Referrer-Policy: same-origin and a form-action that is exactly the family's hosts", async () => {
    const h = await harness();
    const { person } = await seed(h);
    const response = await h.request("/account", { headers: { Cookie: person.cookie } });
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
    const policy = response.headers.get("Content-Security-Policy") ?? "";
    expect(policy.split("; ")).toContain(PRODUCTION_FORM_ACTION);
    expect(policy).toContain("img-src 'self' https://avatars.githubusercontent.com");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("shows the name and the avatar", async () => {
    const h = await harness();
    const { person } = await seed(h);
    const html = await page(h, person.cookie);
    expect(html).toContain("<strong>Ana Dev</strong>");
    expect(html).toContain(
      '<img class="avatar" src="https://avatars.githubusercontent.com/u/4242" alt="" width="48" height="48">',
    );
  });

  it("links the privacy notice and the terms of the site", async () => {
    const h = await harness();
    const { person } = await seed(h);
    const html = await page(h, person.cookie);
    expect(html).toContain('href="https://meltemi.dev/privacy/"');
    expect(html).toContain('href="https://meltemi.dev/terms/"');
  });

  it("reads the person from the store, not from the token: a new name shows at once", async () => {
    const h = await harness();
    const { person } = await seed(h);
    await h.store.updateUser(person.user.id, { name: "Ana Renamed", picture: "" });
    const html = await page(h, person.cookie);
    expect(html).toContain("<strong>Ana Renamed</strong>");
    expect(html).not.toContain("Ana Dev");
    expect(html).not.toContain("<img");
  });

  it("lists only live sessions: not a revoked one, not an expired one, not another person's", async () => {
    const h = await harness();
    const { person } = await seed(h);
    const base = {
      userId: person.user.id,
      createdAt: "2026-10-05T10:00:00.000Z",
      lastSeen: "2026-10-05T10:00:00.000Z",
      expiresAt: "2026-11-04T10:00:00.000Z",
      revokedAt: null,
    };
    await h.store.createSession({ ...base, sid: "r".repeat(43), label: "Safari on macOS" });
    await h.store.revokeSession("r".repeat(43), "2026-10-06T10:00:00.000Z");
    await h.store.createSession({
      ...base,
      sid: "e".repeat(43),
      label: "Chrome on Linux",
      createdAt: "2026-08-01T10:00:00.000Z",
      expiresAt: "2026-08-31T10:00:00.000Z",
    });
    await signedInPerson(h, { id: "user-other", userAgent: SAFARI_ON_IOS });

    const html = await page(h, person.cookie);
    const sessions = rowsOf(sectionOf(html, "Where you are signed in"));
    expect(sessions).toHaveLength(2);
    expect(html).not.toContain("Safari on macOS");
    expect(html).not.toContain("Chrome on Linux");
    expect(html).not.toContain("Safari on iOS");
  });

  it("shows the time a session was last seen", async () => {
    const h = await harness();
    const { person, phone } = await seed(h);
    h.clock.set("2026-10-13T20:45:00.000Z");
    expect((await h.request(`/sessions/${phone.session.sid}`)).status).toBe(204);
    const sessions = rowsOf(sectionOf(await page(h, person.cookie), "Where you are signed in"));
    const mobile = sessions.find((row) => row.includes("Firefox on Android"))!;
    expect(mobile).toContain("Oct 10, 2026");
    expect(mobile).toContain("Oct 13, 2026");
  });

  it("does not move the last-seen time of anything by being read", async () => {
    const h = await harness();
    const { person, phone } = await seed(h);
    await page(h, person.cookie);
    expect((await h.store.session(phone.session.sid))?.lastSeen).toBe(phone.session.lastSeen);
  });

  it("answers a HEAD or any other method on /account with a 404, not the page", async () => {
    const h = await harness();
    const { person } = await seed(h);
    const response = await h.request("/account", {
      method: "POST",
      headers: { Cookie: person.cookie },
    });
    expect(response.status).toBe(404);
  });

  it("falls back to the email, then to a dash, for an identity without a handle", async () => {
    const h = await harness();
    const person = await signedInPerson(h, { handle: "" });
    await h.store.addIdentity(
      googleIdentity(person.user.id, h.clock.now().toISOString(), { email: "" }),
    );
    const rows = rowsOf(sectionOf(await page(h, person.cookie), "Linked sign-ins"));
    expect(rows[0]).toContain("<td>ana@example.com</td>");
    expect(rows[1]).toContain("<td>—</td>");
  });
});

describe("the forms of the account page", () => {
  it("are the five actions, each a POST, and the ones that need it carry the session's csrf token", async () => {
    const h = await harness();
    const { person } = await seed(h);
    const html = await page(h, person.cookie);
    const forms = formsOf(html);
    expect(forms).toHaveLength(5);
    expect(forms.every((form) => form.method === "post")).toBe(true);

    const csrf = await csrfOf(h, person.session.sid);
    expect(csrf).toMatch(/^[0-9a-f]{64}$/);
    const unlink = forms.filter((f) => new URL(f.action, ISSUER).pathname === "/account/unlink");
    expect(unlink.map((f) => f.fields)).toEqual([
      { csrf, provider: "github" },
      { csrf, provider: "google" },
    ]);
    expect(unlink.map((f) => f.button)).toEqual(["Unlink GitHub", "Unlink Google"]);
    expect(formByPath(html, "/account/sessions/revoke-others").fields).toEqual({ csrf });
    expect(formByPath(html, "/account/sessions/revoke-others").button).toBe(
      "Sign out of other devices",
    );
    expect(formByPath(html, "/account/delete").fields).toEqual({ csrf });
    expect(html).toContain('name="confirm"');
  });

  it("sign out posts to /logout with the site as the return address and no csrf", async () => {
    const h = await harness();
    const { person } = await seed(h);
    const logout = formByPath(await page(h, person.cookie), "/logout");
    expect(logout.fields).toEqual({ return_to: "https://meltemi.dev" });
    expect(logout.button).toBe("Sign out");
  });

  it("carry a token that belongs to the session that opened the page", async () => {
    const h = await harness();
    const { person, phone } = await seed(h);
    const mine = formByPath(await page(h, person.cookie), "/account/delete").fields["csrf"];
    const theirs = formByPath(await page(h, phone.cookie), "/account/delete").fields["csrf"];
    expect(mine).toBe(await csrfOf(h, person.session.sid));
    expect(theirs).toBe(await csrfOf(h, phone.session.sid));
    expect(mine).not.toBe(theirs);
  });

  it("name the language of the page, so that a post is judged in it", async () => {
    const h = await harness();
    const { person } = await seed(h);
    for (const lang of ["en", "es"]) {
      const forms = formsOf(await page(h, person.cookie, `?lang=${lang}`));
      expect(forms.every((form) => form.action.endsWith(`?lang=${lang}`))).toBe(true);
    }
  });
});

describe("linking providers", () => {
  it("offers Link Google, and only that, to a person who has only GitHub", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const html = await page(h, person.cookie);
    expect(html).toContain("Link another provider");
    expect(html).toContain("Link Google");
    expect(html).not.toContain("Link GitHub");
  });

  it("offers Link GitHub, and only that, to a person who has only Google", async () => {
    const h = await harness();
    const person = await signedInPerson(h, { provider: "google", handle: "" });
    const html = await page(h, person.cookie);
    expect(html).toContain("Link GitHub");
    expect(html).not.toContain("Link Google");
  });

  it("offers nothing to a person who has both", async () => {
    const h = await harness();
    const { person } = await seed(h);
    const html = await page(h, person.cookie);
    expect(html).not.toContain("Link GitHub");
    expect(html).not.toContain("Link Google");
    expect(html).not.toContain("Link another provider");
  });

  it("starts the flow with link=1 and the account page as the return address", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const html = await page(h, person.cookie);
    const href = /<a class="btn" href="([^"]*)">Link Google<\/a>/.exec(html)?.[1];
    expect(href).toBeDefined();
    const target = new URL(href!.replace(/&amp;/g, "&"), ISSUER);
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("provider")).toBe("google");
    expect(target.searchParams.get("link")).toBe("1");
    expect(target.searchParams.get("return_to")).toBe("https://id.meltemi.dev/account");
    expect(href).toBe(
      "/login?provider=google&amp;link=1&amp;return_to=https%3A%2F%2Fid.meltemi.dev%2Faccount",
    );
  });

  it("names a return address that the sign-in itself accepts, in production and in development", async () => {
    for (const env of [{}, { ...DEV_ENV }]) {
      const h = await harness({ env });
      const person = await signedInPerson(h);
      const html = await page(h, person.cookie);
      const href = /<a class="btn" href="([^"]*)">Link Google<\/a>/.exec(html)?.[1];
      const returnTo = new URL(href!.replace(/&amp;/g, "&"), h.env.ISSUER).searchParams.get(
        "return_to",
      );
      expect(returnTo).toBe(`${h.env.ISSUER}/account`);
      expect(resolveReturnTo(returnTo, readConfig(h.env))).toEqual({ ok: true, url: returnTo });
    }
  });

  it("uses the development service's account page as the return address in development", async () => {
    const dev = await harness({ env: { ...DEV_ENV } });
    const person = await signedInPerson(dev);
    const html = await page(dev, person.cookie);
    expect(html).toContain("return_to=http%3A%2F%2Flocalhost%3A8787%2Faccount");
  });

  it("does not offer to unlink the only identity, and says why", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const html = await page(h, person.cookie);
    expect(formsOf(html).map((f) => new URL(f.action, ISSUER).pathname)).not.toContain(
      "/account/unlink",
    );
    expect(html).toContain("This is your only sign-in");
  });

  it("offers to unlink each identity when there are two, and says nothing about a last one", async () => {
    const h = await harness();
    const { person } = await seed(h);
    const html = await page(h, person.cookie);
    expect(html).not.toContain("This is your only sign-in");
  });
});

describe("what the page shows is text, never markup", () => {
  it("escapes the name, the handle, the email and the label of a session", async () => {
    const h = await harness();
    const person = await signedInPerson(h, {
      handle: "<img src=x onerror=alert(1)>",
      name: "<b>x</b>",
    });
    await h.store.updateUser(person.user.id, { name: "<b>x</b>", picture: person.user.picture });
    await h.store.addIdentity(
      googleIdentity(person.user.id, h.clock.now().toISOString(), {
        email: '"><script>alert(2)</script>@example.com',
      }),
    );
    await h.store.createSession({
      sid: "h".repeat(43),
      userId: person.user.id,
      createdAt: h.clock.now().toISOString(),
      lastSeen: h.clock.now().toISOString(),
      expiresAt: "2026-11-13T12:00:00.000Z",
      label: "<script>alert(3)</script> on <i>x</i>",
      revokedAt: null,
    });

    const response = await h.request("/account", { headers: { Cookie: person.cookie } });
    const html = await textOf(response);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;@example.com");
    expect(html).toContain("&lt;script&gt;alert(3)&lt;/script&gt; on &lt;i&gt;x&lt;/i&gt;");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("<i>x</i>");
    // The policy headers are there all the same.
    expect(response.headers.get("Content-Security-Policy")).toMatch(/^default-src 'none'/);
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
  });

  it("escapes a quote in the name, which could end an attribute", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    await h.store.updateUser(person.user.id, {
      name: `Ana" onfocus="alert(1)' x`,
      picture: person.user.picture,
    });
    const html = await page(h, person.cookie);
    expect(html).toContain("Ana&quot; onfocus=&quot;alert(1)&#39; x");
    expect(html).not.toContain('onfocus="alert(1)');
  });

  describe("the avatar", () => {
    const rendered = [
      "https://avatars.githubusercontent.com/u/4242",
      "https://lh3.googleusercontent.com/a/ana",
    ];
    it.each(rendered)("is an <img> with an empty alt for %s", async (picture) => {
      const h = await harness();
      const person = await signedInPerson(h);
      await h.store.updateUser(person.user.id, { name: "Ana", picture });
      const html = await page(h, person.cookie);
      expect(html).toContain(`<img class="avatar" src="${picture}" alt=""`);
    });

    const refused: readonly [string, string][] = [
      ["an empty picture", ""],
      ["a plain http address", "http://avatars.githubusercontent.com/u/1"],
      ["a script", "javascript:alert(1)"],
      ["a data address", "data:image/svg+xml,<svg onload=alert(1)>"],
      ["a protocol-relative address", "//avatars.githubusercontent.com/u/1"],
      ["a relative address", "/avatar.png"],
      ["not an address", "not an address"],
      ["credentials in an https address", "https://user:pass@avatars.githubusercontent.com/u/1"],
      ["a file address", "file:///etc/passwd"],
    ];
    it.each(refused)("is not an <img> for %s", async (_name, picture) => {
      const h = await harness();
      const person = await signedInPerson(h);
      await h.store.updateUser(person.user.id, { name: "Ana", picture });
      const html = await page(h, person.cookie);
      expect(html).not.toContain("<img");
      expect(html).not.toContain("javascript:");
    });

    it("keeps a quote in an https address from leaving the attribute", async () => {
      const h = await harness();
      const person = await signedInPerson(h);
      await h.store.updateUser(person.user.id, {
        name: "Ana",
        picture: `https://avatars.githubusercontent.com/u/1"onerror="alert(1)`,
      });
      const html = await page(h, person.cookie);
      expect(html).not.toContain('onerror="alert(1)');
      expect(html).not.toMatch(/<img[^>]*\sonerror=/);
    });
  });
});

describe("the account page in Spanish", () => {
  it("speaks Spanish, formats dates in Spanish and links the Spanish legal pages, by ?lang=es", async () => {
    const h = await harness();
    const { person } = await seed(h);
    const html = await page(h, person.cookie, "?lang=es");
    expect(html).toContain('<html lang="es">');
    expect(html).toContain("<h1>Tu cuenta</h1>");
    expect(html).toContain("Inicios de sesión vinculados");
    expect(html).toContain("Dónde tienes la sesión iniciada");

    const identities = rowsOf(sectionOf(html, "Inicios de sesión vinculados"));
    expect(identities[0]).toContain("<td>1 de octubre de 2026</td>");
    expect(identities[1]).toContain("<td>9 de octubre de 2026</td>");

    const sessions = rowsOf(sectionOf(html, "Dónde tienes la sesión iniciada"));
    const laptop = sessions.find((row) => row.includes("Edge en Windows"))!;
    expect(laptop).toContain('<span class="badge">Esta sesión</span>');
    expect(laptop).toMatch(/1 oct\.? 2026/);
    expect(laptop).toContain("UTC");
    expect(sessions.find((row) => row.includes("Firefox en Android"))).toBeDefined();

    expect(html).toContain('href="https://meltemi.dev/es/privacy/"');
    expect(html).toContain('href="https://meltemi.dev/es/terms/"');
    expect(html).toContain("<code>eliminar</code>");
    expect(html).toContain("Cerrar sesión en los otros dispositivos");
    expect(html).toContain("Desvincular GitHub");
    for (const english of [
      "Linked sign-ins",
      "Where you are signed in",
      "This session",
      "Unlink",
    ]) {
      expect(html).not.toContain(english);
    }
  });

  it("is chosen by Accept-Language too, and ?lang wins over it", async () => {
    const h = await harness();
    const { person } = await seed(h);
    const byHeader = await page(h, person.cookie, "", {
      headers: { "Accept-Language": "es-CL,es;q=0.9,en;q=0.8" },
    });
    expect(byHeader).toContain('<html lang="es">');
    const byQuery = await page(h, person.cookie, "?lang=en", {
      headers: { "Accept-Language": "es" },
    });
    expect(byQuery).toContain('<html lang="en">');
  });

  it("offers linking and explains a last identity in Spanish", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const html = await page(h, person.cookie, "?lang=es");
    expect(html).toContain("Vincular otro proveedor");
    expect(html).toContain("Vincular Google");
    expect(html).toContain("Es tu único inicio de sesión");
  });

  it("translates the generic label too", async () => {
    const h = await harness();
    const person = await signedInPerson(h, { userAgent: "curl/8.5.0" });
    const html = await page(h, person.cookie, "?lang=es");
    expect(html).toContain("Otro navegador en otro sistema");
    const english = await page(h, person.cookie);
    expect(english).toContain("Other browser on Other system");
  });

  it("shows a label it does not know as it is", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    await h.store.createSession({
      sid: "u".repeat(43),
      userId: person.user.id,
      createdAt: h.clock.now().toISOString(),
      lastSeen: h.clock.now().toISOString(),
      expiresAt: "2026-11-13T12:00:00.000Z",
      label: "Some device",
      revokedAt: null,
    });
    expect(await page(h, person.cookie, "?lang=es")).toContain("Some device");
  });
});

// ---------------------------------------------------------------------------------------------
// Form protection

const ACTIONS = [
  { name: "unlink", path: "/account/unlink", fields: { provider: "google" } },
  { name: "revoke-others", path: "/account/sessions/revoke-others", fields: {} },
  { name: "delete", path: "/account/delete", fields: { confirm: "delete" } },
] as const;

describe.each(ACTIONS)("POST $path is protected", ({ path, fields }) => {
  const asJson = (token: string | null, h: Harness, cookie: string, origin: string | null) =>
    h.request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...(origin !== null ? { Origin: origin } : {}),
      },
      body: JSON.stringify({ ...fields, ...(token !== null ? { csrf: token } : {}) }),
    });

  it("sends a person without a session to sign in, and changes nothing", async () => {
    const h = await harness();
    const seeded = await seed(h);
    const response = await formPost(h, path, { csrf: "0".repeat(64), fields });
    expect(response.status).toBe(302);
    const location = response.headers.get("Location")!;
    expect(location).toBe("/login?return_to=https%3A%2F%2Fid.meltemi.dev%2Faccount");
    expect(new URL(location, ISSUER).searchParams.get("return_to")).toBe(
      "https://id.meltemi.dev/account",
    );
    await expectUnchanged(h, seeded);
  });

  it.each([
    ["a cookie that is not a token", "meltemi_session=not-a-token"],
    ["an empty cookie", "meltemi_session="],
  ])("sends %s to sign in too", async (_name, cookie) => {
    const h = await harness();
    const seeded = await seed(h);
    const response = await formPost(h, path, { cookie, csrf: "0".repeat(64), fields });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toMatch(/^\/login\?return_to=/);
    await expectUnchanged(h, seeded);
  });

  it("sends a revoked session to sign in, even with its own token", async () => {
    const h = await harness();
    const seeded = await seed(h);
    const other = await anotherSession(h, seeded.person);
    await h.store.revokeSession(other.session.sid, h.clock.now().toISOString());
    const response = await formPost(h, path, { as: other, fields });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toMatch(/^\/login\?return_to=/);
    await expectUnchanged(h, seeded);
  });

  it("asks for the session before it looks at the origin", async () => {
    const h = await harness();
    const seeded = await seed(h);
    const response = await formPost(h, path, { origin: "https://evil.example", fields });
    expect(response.status).toBe(302);
    await expectUnchanged(h, seeded);
  });

  it.each([
    ["a product", "https://diagrams.meltemi.dev"],
    ["the site", "https://meltemi.dev"],
    ["a foreign origin", "https://evil.example"],
    ["the null origin", "null"],
    ["a look-alike of the issuer", "https://id.meltemi.dev.evil.example"],
    ["the issuer over plain http", "http://id.meltemi.dev"],
    ["no Origin header", null],
  ])("refuses %s with 403 request.forbidden, even with a correct token", async (_n, origin) => {
    const h = await harness();
    const seeded = await seed(h);
    const response = await formPost(h, path, { as: seeded.person, origin, fields });
    expect(response.status).toBe(403);
    expect(await textOf(response)).toContain("request.forbidden");
    expect(response.headers.getSetCookie()).toEqual([]);
    await expectUnchanged(h, seeded);
  });

  it("refuses a missing token with 403 request.forbidden", async () => {
    const h = await harness();
    const seeded = await seed(h);
    const response = await formPost(h, path, { cookie: seeded.person.cookie, csrf: null, fields });
    expect(response.status).toBe(403);
    expect(await textOf(response)).toContain("request.forbidden");
    await expectUnchanged(h, seeded);
  });

  it("refuses a wrong token, the token of another session, and the token of another person", async () => {
    const h = await harness();
    const seeded = await seed(h);
    const stranger = await signedInPerson(h, { id: "user-stranger" });
    for (const csrf of [
      "0".repeat(64),
      "",
      "not hex",
      await csrfOf(h, seeded.phone.session.sid),
      await csrfOf(h, stranger.session.sid),
    ]) {
      const response = await formPost(h, path, { cookie: seeded.person.cookie, csrf, fields });
      expect(response.status, csrf).toBe(403);
    }
    await expectUnchanged(h, seeded);
  });

  it("refuses a token that only the query string carries", async () => {
    const h = await harness();
    const seeded = await seed(h);
    const token = await csrfOf(h, seeded.person.session.sid);
    const response = await formPost(h, path, {
      cookie: seeded.person.cookie,
      csrf: null,
      fields,
      query: `?csrf=${token}`,
    });
    expect(response.status).toBe(403);
    await expectUnchanged(h, seeded);
  });

  it("refuses a body that is not a form with 403, never an exception", async () => {
    const h = await harness();
    const seeded = await seed(h);
    const token = await csrfOf(h, seeded.person.session.sid);
    const json = await asJson(token, h, seeded.person.cookie, ISSUER);
    expect(json.status).toBe(403);
    const empty = await h.request(path, {
      method: "POST",
      headers: { Cookie: seeded.person.cookie, Origin: ISSUER },
    });
    expect(empty.status).toBe(403);
    await expectUnchanged(h, seeded);
  });

  it("explains a refusal in Spanish when the request asks for it", async () => {
    const h = await harness();
    const seeded = await seed(h);
    const response = await formPost(h, path, {
      as: seeded.person,
      origin: "https://evil.example",
      fields,
      query: "?lang=es",
    });
    expect(response.status).toBe(403);
    const html = await textOf(response);
    expect(html).toContain('<html lang="es">');
    expect(html).toContain("request.forbidden");
    expect(html).toContain('href="/account?lang=es"');
  });

  it("accepts only the service's own origin in development, not the family's", async () => {
    const dev = await harness({ env: { ...DEV_ENV } });
    const seeded = await seed(dev);
    for (const origin of ["http://localhost:8788", "http://localhost:8789", null]) {
      const response = await formPost(dev, path, { as: seeded.person, origin, fields });
      expect(response.status).toBe(403);
    }
    await expectUnchanged(dev, seeded);
  });

  it("is a POST route: a GET is a 404", async () => {
    const h = await harness();
    const { person } = await seed(h);
    const response = await h.request(path, { headers: { Cookie: person.cookie } });
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------
// POST /account/unlink

describe("POST /account/unlink", () => {
  it("removes the identity of one of two providers and the page lists the other only", async () => {
    const h = await harness();
    const { person, phone } = await seed(h);
    const response = await formPost(h, "/account/unlink", {
      as: person,
      fields: { provider: "google" },
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/account");
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    expect((await h.store.identitiesOf(person.user.id)).map((i) => i.provider)).toEqual(["github"]);
    expect(await h.store.identity("google", "g-7777")).toBeUndefined();

    const html = await page(h, person.cookie);
    const rows = rowsOf(sectionOf(html, "Linked sign-ins"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("<td>GitHub</td>");
    expect(html).not.toContain("<td>Google</td>");
    // Google can be linked again, and nobody was signed out.
    expect(html).toContain("Link Google");
    expect(await isLive(h, person.session.sid)).toBe(true);
    expect(await isLive(h, phone.session.sid)).toBe(true);
    expect(await h.store.userById(person.user.id)).toBeDefined();
  });

  it("removes the GitHub identity just as well, and the Google one signs in alone", async () => {
    const h = await harness();
    const { person } = await seed(h);
    const response = await formPost(h, "/account/unlink", {
      as: person,
      fields: { provider: "github" },
    });
    expect(response.status).toBe(303);
    expect((await h.store.identitiesOf(person.user.id)).map((i) => i.provider)).toEqual(["google"]);
  });

  it("goes back to the page in the language it was asked in", async () => {
    const h = await harness();
    const { person } = await seed(h);
    const response = await formPost(h, "/account/unlink", {
      as: person,
      fields: { provider: "google" },
      query: "?lang=es",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/account?lang=es");
  });

  it("keeps the last identity: 409 identity.last and nothing changes", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const response = await formPost(h, "/account/unlink", {
      as: person,
      fields: { provider: "github" },
    });
    expect(response.status).toBe(409);
    const html = await textOf(response);
    expect(html).toContain("identity.last");
    expect(html).toContain("This is your only sign-in");
    expect(html).toContain('href="/account"');
    expect((await h.store.identitiesOf(person.user.id)).map((i) => i.provider)).toEqual(["github"]);
    expect(response.headers.get("Location")).toBeNull();
  });

  it("says so in Spanish", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const response = await formPost(h, "/account/unlink", {
      as: person,
      fields: { provider: "github" },
      query: "?lang=es",
    });
    expect(response.status).toBe(409);
    const html = await textOf(response);
    expect(html).toContain("identity.last");
    expect(html).toContain("Es tu único inicio de sesión");
    expect(html).toContain('href="/account?lang=es"');
  });

  it("lets go of one and then keeps the other: the second unlink is the last identity", async () => {
    const h = await harness();
    const { person } = await seed(h);
    expect(
      (await formPost(h, "/account/unlink", { as: person, fields: { provider: "google" } })).status,
    ).toBe(303);
    const second = await formPost(h, "/account/unlink", {
      as: person,
      fields: { provider: "github" },
    });
    expect(second.status).toBe(409);
    expect((await h.store.identitiesOf(person.user.id)).map((i) => i.provider)).toEqual(["github"]);
  });

  describe("a provider that is not one", () => {
    it.each([
      ["facebook", { provider: "facebook" }],
      ["an empty value", { provider: "" }],
      ["another case", { provider: "GitHub" }],
      ["a padded value", { provider: "github " }],
      ["a prototype name", { provider: "__proto__" }],
      ["a list", { provider: "github,google" }],
      ["no field at all", {}],
    ])("answers 400 provider.unknown for %s and changes nothing", async (_name, fields) => {
      const h = await harness();
      const seeded = await seed(h);
      const response = await formPost(h, "/account/unlink", { as: seeded.person, fields });
      expect(response.status).toBe(400);
      expect(await textOf(response)).toContain("provider.unknown");
      await expectUnchanged(h, seeded);
    });

    it("says so in Spanish", async () => {
      const h = await harness();
      const { person } = await seed(h);
      const response = await formPost(h, "/account/unlink", {
        as: person,
        fields: { provider: "facebook" },
        query: "?lang=es",
      });
      expect(await textOf(response)).toContain("Proveedor desconocido");
    });

    it("is judged before the last-identity rule", async () => {
      const h = await harness();
      const person = await signedInPerson(h);
      const response = await formPost(h, "/account/unlink", {
        as: person,
        fields: { provider: "facebook" },
      });
      expect(response.status).toBe(400);
    });
  });

  it("leaves things as they are when the provider is not linked, and says nothing is wrong", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const response = await formPost(h, "/account/unlink", {
      as: person,
      fields: { provider: "google" },
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/account");
    expect((await h.store.identitiesOf(person.user.id)).map((i) => i.provider)).toEqual(["github"]);
  });

  it("is repeatable: unlinking what is already unlinked changes nothing", async () => {
    const h = await harness();
    const { person } = await seed(h);
    for (let i = 0; i < 2; i++) {
      const response = await formPost(h, "/account/unlink", {
        as: person,
        fields: { provider: "google" },
      });
      expect(response.status).toBe(303);
    }
    expect((await h.store.identitiesOf(person.user.id)).map((i) => i.provider)).toEqual(["github"]);
  });

  it("does not call it the last identity when the user has no identity at all", async () => {
    const h = await harness();
    const user = {
      id: "user-bare",
      name: "Bare",
      picture: "",
      createdAt: "2026-10-14T12:00:00.000Z",
    };
    await h.store.createUser(user);
    const started = await startSession(
      { deps: h.deps, config: readConfig(h.env), request: new Request(h.env.ISSUER) },
      user,
      { email: "", emailVerified: false },
    );
    const response = await formPost(h, "/account/unlink", {
      as: { cookie: `meltemi_session=${started.token}`, session: started.session },
      fields: { provider: "github" },
    });
    expect(response.status).toBe(303);
    expect(await h.store.identitiesOf(user.id)).toEqual([]);
  });

  describe("the store decides, in one step", () => {
    it.each([
      ["removed", 303],
      ["last", 409],
      ["absent", 303],
    ] as const)("answers %s with %i", async (outcome, status) => {
      const h = await harness();
      const { person } = await seed(h);
      const unlink = vi.spyOn(h.store, "unlinkProvider").mockResolvedValueOnce(outcome);
      // The route decides nothing from a read of its own: a read followed by a delete is what two
      // tabs could slip between.
      const identitiesOf = vi.spyOn(h.store, "identitiesOf");

      const response = await formPost(h, "/account/unlink", {
        as: person,
        fields: { provider: "google" },
      });

      expect(response.status).toBe(status);
      expect(unlink).toHaveBeenCalledExactlyOnceWith(person.user.id, "google");
      expect(identitiesOf).not.toHaveBeenCalled();
      if (outcome === "last") {
        expect(await textOf(response)).toContain("identity.last");
        expect(response.headers.get("Location")).toBeNull();
      } else {
        expect(response.headers.get("Location")).toBe("/account");
      }
    });

    it("asks the store about the signed-in person only, whatever the form says", async () => {
      const h = await harness();
      const { person } = await seed(h);
      const other = await signedInPerson(h, { id: "user-other", providerId: "other-gh" });
      const unlink = vi.spyOn(h.store, "unlinkProvider");
      await formPost(h, "/account/unlink", {
        as: person,
        fields: { provider: "google", user: other.user.id, userId: other.user.id },
      });
      expect(unlink).toHaveBeenCalledExactlyOnceWith(person.user.id, "google");
      expect((await h.store.identitiesOf(other.user.id)).map((i) => i.provider)).toEqual([
        "github",
      ]);
    });

    it("lets an error of the store become the error page, with nothing changed", async () => {
      const h = await harness();
      const seeded = await seed(h);
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(h.store, "unlinkProvider").mockRejectedValueOnce(new Error("the database is down"));
      const response = await formPost(h, "/account/unlink", {
        as: seeded.person,
        fields: { provider: "google" },
      });
      expect(response.status).toBe(500);
      expect(await textOf(response)).not.toContain("the database is down");
      await expectUnchanged(h, seeded);
    });
  });

  it("never touches the identities of other people", async () => {
    const h = await harness();
    const { person } = await seed(h);
    const other = await signedInPerson(h, { id: "user-other", providerId: "other-gh" });
    await h.store.addIdentity(
      googleIdentity(other.user.id, h.clock.now().toISOString(), {
        providerId: "g-other",
        email: "bea@example.com",
      }),
    );
    await formPost(h, "/account/unlink", { as: person, fields: { provider: "google" } });
    expect((await h.store.identitiesOf(other.user.id)).map((i) => i.provider)).toEqual([
      "github",
      "google",
    ]);
    expect(await h.store.identity("google", "g-other")).toBeDefined();
  });

  it("removes every identity of the provider when a user linked several, if another provider remains", async () => {
    const h = await harness();
    const { person } = await seed(h);
    await h.store.addIdentity({
      ...person.identity,
      providerId: "second-github",
      handle: "ana-second",
    });
    const response = await formPost(h, "/account/unlink", {
      as: person,
      fields: { provider: "github" },
    });
    expect(response.status).toBe(303);
    expect((await h.store.identitiesOf(person.user.id)).map((i) => i.provider)).toEqual(["google"]);
  });

  it("keeps the identities when they are all of the provider asked for", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    await h.store.addIdentity({ ...person.identity, providerId: "second-github" });
    const response = await formPost(h, "/account/unlink", {
      as: person,
      fields: { provider: "github" },
    });
    expect(response.status).toBe(409);
    expect(await h.store.identitiesOf(person.user.id)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------
// POST /account/sessions/revoke-others

describe("POST /account/sessions/revoke-others", () => {
  it("revokes the first and the third session and keeps the second, as the session check shows", async () => {
    const h = await harness();
    const { person } = await seed(h);
    const second = await anotherSession(h, person, FIREFOX_ON_ANDROID);
    h.clock.advance(60_000);
    const third = await anotherSession(h, person, SAFARI_ON_IOS);
    h.clock.advance(60_000);
    const first = person;

    const response = await formPost(h, "/account/sessions/revoke-others", { as: second });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/account");

    expect(await isLive(h, first.session.sid)).toBe(false);
    expect(await isLive(h, third.session.sid)).toBe(false);
    expect(await isLive(h, second.session.sid)).toBe(true);
    // The phone from the seed was another one of the person's: gone too.
    const stamp = h.clock.now().toISOString();
    expect((await h.store.session(first.session.sid))?.revokedAt).toBe(stamp);
    expect((await h.store.session(third.session.sid))?.revokedAt).toBe(stamp);
    expect((await h.store.session(second.session.sid))?.revokedAt).toBeNull();
  });

  it("leaves the page with this session only, and the revoked cookies signed out", async () => {
    const h = await harness();
    const { person, phone } = await seed(h);
    await formPost(h, "/account/sessions/revoke-others", { as: phone });

    const html = await page(h, phone.cookie);
    const sessions = rowsOf(sectionOf(html, "Where you are signed in"));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toContain("Firefox on Android");
    expect(sessions[0]).toContain("badge");

    const revoked = await h.request("/account", { headers: { Cookie: person.cookie } });
    expect(revoked.status).toBe(302);
    expect(revoked.headers.get("Location")).toMatch(/^\/login\?/);
  });

  it("keeps the person's account, identities and the other people's sessions", async () => {
    const h = await harness();
    const { person, phone } = await seed(h);
    const other = await signedInPerson(h, { id: "user-other" });
    await formPost(h, "/account/sessions/revoke-others", { as: phone });
    expect(await h.store.userById(person.user.id)).toBeDefined();
    expect(await h.store.identitiesOf(person.user.id)).toHaveLength(2);
    expect(await isLive(h, other.session.sid)).toBe(true);
    expect(await outbox(h)).toEqual([]);
  });

  it("is a no-op for a person with one session, and repeatable", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    for (let i = 0; i < 2; i++) {
      const response = await formPost(h, "/account/sessions/revoke-others", { as: person });
      expect(response.status).toBe(303);
    }
    expect(await isLive(h, person.session.sid)).toBe(true);
  });

  it("goes back to the page in the language it was asked in", async () => {
    const h = await harness();
    const { person } = await seed(h);
    const response = await formPost(h, "/account/sessions/revoke-others", {
      as: person,
      query: "?lang=es",
    });
    expect(response.headers.get("Location")).toBe("/account?lang=es");
  });

  it("after a sign-out of the current session, it is signed out like any other request", async () => {
    const h = await harness();
    const { person } = await seed(h);
    await h.store.revokeSession(person.session.sid, h.clock.now().toISOString());
    const response = await formPost(h, "/account/sessions/revoke-others", { as: person });
    expect(response.status).toBe(302);
  });
});

// ---------------------------------------------------------------------------------------------
// POST /account/delete

describe("POST /account/delete", () => {
  it("deletes the person, queues one event per product, clears the cookie and shows the deleted page", async () => {
    const h = await harness();
    const seeded = await seed(h);
    const { person, phone } = seeded;
    const other = await signedInPerson(h, { id: "user-other", providerId: "other-gh" });

    const response = await formPost(h, "/account/delete", {
      as: person,
      fields: { confirm: "delete" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const html = await textOf(response);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("Account deleted");
    expect(html).toContain("seven days");
    expect(html).toContain('href="https://meltemi.dev"');
    expect(html).not.toContain("Ana Dev");
    expect(formsOf(html)).toEqual([]);

    // Nothing of the person remains.
    expect(await h.store.userById(person.user.id)).toBeUndefined();
    expect(await h.store.identitiesOf(person.user.id)).toEqual([]);
    expect(await h.store.identity("github", person.identity.providerId)).toBeUndefined();
    expect(await h.store.identity("google", "g-7777")).toBeUndefined();
    expect(await h.store.session(person.session.sid)).toBeUndefined();
    expect(await h.store.session(phone.session.sid)).toBeUndefined();
    expect(await h.store.sessionsOf(person.user.id, new Date("2000-01-01").toISOString())).toEqual(
      [],
    );

    // The cookie goes.
    expect(setCookie(response, "meltemi_session")).toBe("");
    expect(setCookieLine(response, "meltemi_session")?.split("; ")).toEqual([
      "meltemi_session=",
      "Domain=meltemi.dev",
      "Path=/",
      "Max-Age=0",
      "Secure",
      "HttpOnly",
      "SameSite=Lax",
    ]);

    // One event for the one product, about this user, at this time.
    const events = await outbox(h);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.product).toBe("diagrams");
    expect(JSON.parse(event!.body)).toEqual({
      id: event!.id,
      type: "user.deleted",
      sub: person.user.id,
      at: "2026-10-14T12:00:00.000Z",
    });
    expect(event?.id).toMatch(/^evt_/);
    expect(event?.deliveredAt).toBeNull();

    // Somebody else is untouched.
    expect(await h.store.userById(other.user.id)).toBeDefined();
    expect(await isLive(h, other.session.sid)).toBe(true);
  });

  it("hands the store the user and the events in one call, and makes no other write", async () => {
    const h = await harness();
    const { person } = await seed(h);
    const deleteUser = vi.spyOn(h.store, "deleteUser");
    const enqueueEvents = vi.spyOn(h.store, "enqueueEvents");

    await formPost(h, "/account/delete", { as: person, fields: { confirm: "delete" } });

    expect(deleteUser).toHaveBeenCalledTimes(1);
    const [userId, events] = deleteUser.mock.calls[0]!;
    expect(userId).toBe(person.user.id);
    expect(events).toHaveLength(1);
    expect(events![0]).toMatchObject({
      product: "diagrams",
      attempts: 0,
      deliveredAt: null,
      failedAt: null,
    });
    expect(JSON.parse(events![0]!.body)).toMatchObject({ type: "user.deleted", sub: userId });
    // The events reach the outbox through the deletion and by no other way: a second step is where
    // a failure would leave the products told about an account that still exists, or not told.
    expect(enqueueEvents).not.toHaveBeenCalled();
    expect(await outbox(h)).toEqual(events);
  });

  it("hands the store one event for each product configured, and none for no products", async () => {
    const two = await harness({
      env: {
        PRODUCTS:
          '[{"name":"diagrams","events":"https://diagrams.meltemi.dev/_identity/events"},{"name":"ide","events":"https://ide.meltemi.dev/_identity/events"}]',
      },
    });
    const deleteUser = vi.spyOn(two.store, "deleteUser");
    const { person } = await seed(two);
    await formPost(two, "/account/delete", { as: person, fields: { confirm: "delete" } });
    expect(deleteUser.mock.calls[0]![1]!.map((event) => event.product).sort()).toEqual([
      "diagrams",
      "ide",
    ]);

    const none = await harness({ env: { PRODUCTS: "[]" } });
    const deleteNone = vi.spyOn(none.store, "deleteUser");
    const another = await seed(none);
    await formPost(none, "/account/delete", { as: another.person, fields: { confirm: "delete" } });
    expect(deleteNone.mock.calls[0]![1]).toEqual([]);
  });

  it("changes nothing when the store cannot delete: no event queued, the cookie kept, no reason given", async () => {
    const h = await harness();
    const seeded = await seed(h);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const enqueueEvents = vi.spyOn(h.store, "enqueueEvents");
    vi.spyOn(h.store, "deleteUser").mockRejectedValueOnce(new Error("the database is down"));

    const response = await formPost(h, "/account/delete", {
      as: seeded.person,
      fields: { confirm: "delete" },
    });

    expect(response.status).toBe(500);
    expect(await textOf(response)).not.toContain("the database is down");
    // The session cookie is not cleared: the person is still signed in and can try again.
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(setCookie(response, "meltemi_session")).toBeUndefined();
    expect(enqueueEvents).not.toHaveBeenCalled();
    await expectUnchanged(h, seeded);

    // The store is back: the same person deletes the account, and the products are told once.
    const again = await formPost(h, "/account/delete", {
      as: seeded.person,
      fields: { confirm: "delete" },
    });
    expect(again.status).toBe(200);
    expect(await h.store.userById(seeded.person.user.id)).toBeUndefined();
    expect(await outbox(h)).toHaveLength(1);
  });

  it("answers the error page in Spanish when the request asks for it", async () => {
    const h = await harness();
    const seeded = await seed(h);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(h.store, "deleteUser").mockRejectedValueOnce(new Error("the database is down"));
    const response = await formPost(h, "/account/delete", {
      as: seeded.person,
      fields: { confirm: "eliminar" },
      query: "?lang=es",
    });
    expect(response.status).toBe(500);
    expect(await textOf(response)).toContain('<html lang="es">');
    expect(response.headers.getSetCookie()).toEqual([]);
    await expectUnchanged(h, seeded);
  });

  it("queues one event for each product", async () => {
    const h = await harness({
      env: {
        PRODUCTS:
          '[{"name":"diagrams","events":"https://diagrams.meltemi.dev/_identity/events"},{"name":"ide","events":"https://ide.meltemi.dev/_identity/events"}]',
      },
    });
    const { person } = await seed(h);
    await formPost(h, "/account/delete", { as: person, fields: { confirm: "delete" } });
    const events = await outbox(h);
    expect(events.map((event) => event.product).sort()).toEqual(["diagrams", "ide"]);
    expect(new Set(events.map((event) => event.id)).size).toBe(2);
    for (const event of events) expect(JSON.parse(event.body).sub).toBe(person.user.id);
  });

  it("deletes the account of a service with no products too", async () => {
    const h = await harness({ env: { PRODUCTS: "[]" } });
    const { person } = await seed(h);
    const response = await formPost(h, "/account/delete", {
      as: person,
      fields: { confirm: "delete" },
    });
    expect(response.status).toBe(200);
    expect(await h.store.userById(person.user.id)).toBeUndefined();
    expect(await outbox(h)).toEqual([]);
  });

  it("signs the old cookies out: the page, the session check and a second delete", async () => {
    const h = await harness();
    const { person, phone } = await seed(h);
    await formPost(h, "/account/delete", { as: person, fields: { confirm: "delete" } });
    expect((await h.request("/account", { headers: { Cookie: person.cookie } })).status).toBe(302);
    expect((await h.request("/account", { headers: { Cookie: phone.cookie } })).status).toBe(302);
    expect((await h.request(`/sessions/${person.session.sid}`)).status).toBe(404);
    expect((await h.request(`/sessions/${phone.session.sid}`)).status).toBe(404);
    const again = await formPost(h, "/account/delete", {
      as: person,
      fields: { confirm: "delete" },
    });
    expect(again.status).toBe(302);
    expect(await outbox(h)).toHaveLength(1);
  });

  describe("a wrong confirmation", () => {
    it.each([
      ["yes", { confirm: "yes" }],
      ["no field at all", {}],
      ["an empty value", { confirm: "" }],
      ["only spaces", { confirm: "   " }],
      ["more words", { confirm: "delete account" }],
      ["a longer word", { confirm: "deleted" }],
      ["a prefix", { confirm: "delet" }],
      ["the other language's word", { confirm: "eliminar" }],
      ["two words in one", { confirm: "delete delete" }],
      ["a look-alike letter", { confirm: "dеlete" }],
    ])("%s answers 400 confirm.mismatch and everything remains", async (_name, fields) => {
      const h = await harness();
      const seeded = await seed(h);
      const response = await formPost(h, "/account/delete", { as: seeded.person, fields });
      expect(response.status).toBe(400);
      const html = await textOf(response);
      expect(html).toContain("confirm.mismatch");
      expect(html).toContain('href="/account"');
      expect(response.headers.getSetCookie()).toEqual([]);
      await expectUnchanged(h, seeded);
    });

    it("refuses a file in place of the word", async () => {
      const h = await harness();
      const seeded = await seed(h);
      const data = new FormData();
      data.set("csrf", await csrfOf(h, seeded.person.session.sid));
      data.set("confirm", new File(["delete"], "confirm.txt"));
      const response = await h.request("/account/delete", {
        method: "POST",
        headers: { Cookie: seeded.person.cookie, Origin: ISSUER },
        body: data,
      });
      expect(response.status).toBe(400);
      await expectUnchanged(h, seeded);
    });

    it("says so in Spanish", async () => {
      const h = await harness();
      const { person } = await seed(h);
      const response = await formPost(h, "/account/delete", {
        as: person,
        fields: { confirm: "yes" },
        query: "?lang=es",
      });
      expect(response.status).toBe(400);
      const html = await textOf(response);
      expect(html).toContain("confirm.mismatch");
      expect(html).toContain("La confirmación no coincide");
    });
  });

  describe("the word the page shows", () => {
    it.each(["delete", "DELETE", "Delete", "  delete  ", "\tdelete\n"])(
      "is accepted in English as %j",
      async (word) => {
        const h = await harness();
        const { person } = await seed(h);
        const response = await formPost(h, "/account/delete", {
          as: person,
          fields: { confirm: word },
        });
        expect(response.status).toBe(200);
        expect(await h.store.userById(person.user.id)).toBeUndefined();
      },
    );

    it.each(["eliminar", "ELIMINAR", " Eliminar "])(
      "is accepted in Spanish as %j",
      async (word) => {
        const h = await harness();
        const { person } = await seed(h);
        const response = await formPost(h, "/account/delete", {
          as: person,
          fields: { confirm: word },
          query: "?lang=es",
        });
        expect(response.status).toBe(200);
        const html = await textOf(response);
        expect(html).toContain('<html lang="es">');
        expect(html).toContain("Cuenta eliminada");
        expect(html).toContain("siete días");
        expect(html).toContain('href="https://meltemi.dev"');
        expect(await h.store.userById(person.user.id)).toBeUndefined();
        expect(setCookieLine(response, "meltemi_session")).toContain("Max-Age=0");
      },
    );

    it("must match the page's language: the English word on a Spanish page is refused", async () => {
      const h = await harness();
      const seeded = await seed(h);
      const response = await formPost(h, "/account/delete", {
        as: seeded.person,
        fields: { confirm: "delete" },
        query: "?lang=es",
      });
      expect(response.status).toBe(400);
      await expectUnchanged(h, seeded);
    });

    it("must match the page's language: the Spanish word on an English page is refused", async () => {
      const h = await harness();
      const seeded = await seed(h);
      const response = await formPost(h, "/account/delete", {
        as: seeded.person,
        fields: { confirm: "eliminar" },
        query: "?lang=en",
      });
      expect(response.status).toBe(400);
      await expectUnchanged(h, seeded);
    });

    it("follows Accept-Language when the request names no language, and ?lang wins over it", async () => {
      const h = await harness();
      const seeded = await seed(h);
      const headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: seeded.person.cookie,
        Origin: ISSUER,
        "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
      };
      const csrf = await csrfOf(h, seeded.person.session.sid);
      const wrong = await h.request("/account/delete?lang=en", {
        method: "POST",
        headers,
        body: new URLSearchParams({ csrf, confirm: "eliminar" }).toString(),
      });
      expect(wrong.status).toBe(400);
      const right = await h.request("/account/delete", {
        method: "POST",
        headers,
        body: new URLSearchParams({ csrf, confirm: "eliminar" }).toString(),
      });
      expect(right.status).toBe(200);
      expect(await textOf(right)).toContain("Cuenta eliminada");
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The page's own forms, submitted as a browser would

describe("the forms of the page work end to end", () => {
  it("unlinks a provider from the form of the page and comes back to it", async () => {
    const h = await harness();
    const { person } = await seed(h);
    const html = await page(h, person.cookie);
    const unlink = formsOf(html).find((f) => f.fields["provider"] === "google")!;
    const response = await submitForm(h, unlink, { cookie: person.cookie });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/account?lang=en");
    const after = await page(h, person.cookie);
    expect(after).not.toContain("<td>Google</td>");
  });

  it("ends the other sessions from the form of the page", async () => {
    const h = await harness();
    const { person, phone } = await seed(h);
    const form = formByPath(await page(h, phone.cookie), "/account/sessions/revoke-others");
    const response = await submitForm(h, form, { cookie: phone.cookie });
    expect(response.status).toBe(303);
    expect(await isLive(h, person.session.sid)).toBe(false);
    expect(await isLive(h, phone.session.sid)).toBe(true);
  });

  it("signs out from the form of the page and lands on the site", async () => {
    const h = await harness();
    const { person, phone } = await seed(h);
    const form = formByPath(await page(h, person.cookie), "/logout");
    const response = await submitForm(h, form, { cookie: person.cookie });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://meltemi.dev/");
    expect(setCookieLine(response, "meltemi_session")).toContain("Max-Age=0");
    expect(await isLive(h, person.session.sid)).toBe(false);
    expect(await isLive(h, phone.session.sid)).toBe(true);
  });

  it("signs out from the form of the page in development, where the Origin is the service's own", async () => {
    const dev = await harness({ env: { ...DEV_ENV } });
    const { person } = await seed(dev);
    const form = formByPath(await page(dev, person.cookie), "/logout");
    const response = await submitForm(dev, form, { cookie: person.cookie });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("http://localhost:8789/");
    expect(await isLive(dev, person.session.sid)).toBe(false);
  });

  it("deletes from the form of a Spanish page with the word that page shows", async () => {
    const h = await harness();
    const { person } = await seed(h);
    const html = await page(h, person.cookie, "?lang=es");
    const word = /<code>([^<]*)<\/code>/.exec(html)?.[1];
    expect(word).toBe("eliminar");
    const form = formByPath(html, "/account/delete");
    const response = await submitForm(h, form, {
      cookie: person.cookie,
      extra: { confirm: word! },
    });
    expect(response.status).toBe(200);
    expect(await textOf(response)).toContain("Cuenta eliminada");
    expect(await h.store.userById(person.user.id)).toBeUndefined();
  });

  it("deletes from the form of an English page with the word that page shows", async () => {
    const h = await harness();
    const { person } = await seed(h);
    const html = await page(h, person.cookie);
    const word = /<code>([^<]*)<\/code>/.exec(html)?.[1];
    expect(word).toBe("delete");
    const response = await submitForm(h, formByPath(html, "/account/delete"), {
      cookie: person.cookie,
      extra: { confirm: word! },
    });
    expect(response.status).toBe(200);
    expect(await textOf(response)).toContain("Account deleted");
  });
});

// ---------------------------------------------------------------------------------------------
// The two actions that must be one step, over the real SQL

describe.skipIf(!sqliteAvailable)("the account actions over D1 (node:sqlite)", () => {
  const countOf = (db: ReturnType<typeof openDatabase>, table: string): number =>
    (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  describe("POST /account/delete when the database refuses part of it", () => {
    const refusals = [
      [
        "refuses to delete the user, after the events were queued",
        "CREATE TRIGGER refuse BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'refused'); END",
      ],
      [
        "refuses to queue the event, before anything is deleted",
        "CREATE TRIGGER refuse BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'refused'); END",
      ],
    ] as const;

    it.each(refusals)(
      "leaves the account whole, queues no event and keeps the cookie when the database %s",
      async (_what, trigger) => {
        const db = openDatabase();
        const h = await harness({ store: d1Store(db) });
        const seeded = await seed(h);
        vi.spyOn(console, "error").mockImplementation(() => {});
        db.raw.exec(trigger);

        const response = await formPost(h, "/account/delete", {
          as: seeded.person,
          fields: { confirm: "delete" },
        });

        expect(response.status).toBe(500);
        expect(await textOf(response)).not.toContain("refused");
        expect(response.headers.getSetCookie()).toEqual([]);
        expect([
          countOf(db, "users"),
          countOf(db, "identities"),
          countOf(db, "sessions"),
          countOf(db, "outbox"),
        ]).toEqual([1, 2, 2, 0]);
        await expectUnchanged(h, seeded);

        // Once the database accepts it again, the same person deletes the account, and one event
        // is queued: the failed try left nothing behind to be told twice.
        db.raw.exec("DROP TRIGGER refuse");
        const again = await formPost(h, "/account/delete", {
          as: seeded.person,
          fields: { confirm: "delete" },
        });
        expect(again.status).toBe(200);
        expect([
          countOf(db, "users"),
          countOf(db, "identities"),
          countOf(db, "sessions"),
          countOf(db, "outbox"),
        ]).toEqual([0, 0, 0, 1]);
        db.close();
      },
    );
  });

  describe("POST /account/unlink when two tabs unlink at once", () => {
    /**
     * Holds the first two statements that touch the identities until both have arrived, then lets
     * them go together: the two requests are at the same point of their work at the same moment,
     * whatever order the platform would have served them in. Armed by the test once the data is in.
     */
    function meetAtTheIdentities(parties: number) {
      let armed = false;
      let arrived = 0;
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let timer: ReturnType<typeof setTimeout> | undefined;
      return {
        arm: () => (armed = true),
        before: async (sql: string) => {
          if (!armed || arrived >= parties || !sql.includes("identities")) return;
          arrived += 1;
          // Should the other request never come, the first goes on after a second and the
          // assertions judge, instead of the test hanging.
          timer ??= setTimeout(release, 1000);
          if (arrived === parties) {
            clearTimeout(timer);
            release();
          }
          await gate;
        },
      };
    }

    it.each([
      ["Google and GitHub", ["google", "github"]],
      ["GitHub and Google", ["github", "google"]],
    ] as const)(
      "keeps one way to sign in when the tabs unlink %s together",
      async (_order, providers) => {
        const db = openDatabase();
        const meeting = meetAtTheIdentities(2);
        // Every statement waits for its answer, as over the wire, and the two requests meet at
        // the first statement each sends about the identities.
        const h = await harness({ store: d1Store(withLatency(db, meeting.before)) });
        const { person, phone } = await seed(h);
        meeting.arm();

        // Two forms posted in the same tick, from two devices of one person.
        const [first, second] = await Promise.all([
          formPost(h, "/account/unlink", { as: person, fields: { provider: providers[0] } }),
          formPost(h, "/account/unlink", { as: phone, fields: { provider: providers[1] } }),
        ]);

        // One went through; the other was told it was the last, and that is the provider kept.
        const statuses = [first.status, second.status];
        expect([...statuses].sort()).toEqual([303, 409]);
        const refused = statuses[0] === 409 ? first : second;
        expect(await textOf(refused)).toContain("identity.last");
        const left = await h.store.identitiesOf(person.user.id);
        expect(left.map((i) => i.provider)).toEqual([providers[statuses.indexOf(409)]]);
        expect(countOf(db, "identities")).toBe(1);

        // The person can still sign in with what is left, and the page lists it.
        const html = await page(h, person.cookie);
        expect(rowsOf(sectionOf(html, "Linked sign-ins"))).toHaveLength(1);
        db.close();
      },
    );
  });
});
