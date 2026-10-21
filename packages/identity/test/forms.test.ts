import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  accountAction,
  accountPath,
  checkAccountForm,
  csrfToken,
  forbiddenPage,
  readForm,
  signInRedirect,
} from "../src/forms.js";
import { readConfig } from "../src/config.js";
import { currentSession } from "../src/session.js";
import { DEV_ENV, anotherSession, ctxOf } from "./support/account.js";
import { harness, signedInPerson, textOf } from "./support/index.js";
import type { Harness } from "./support/index.js";

const ISSUER_ORIGIN = "https://id.meltemi.dev";

function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

/** Runs `checkAccountForm` the way a route does, for a request with the given `Origin`. */
async function check(
  h: Harness,
  cookie: string,
  origin: string | null,
  fields: Record<string, string>,
  query = "",
): Promise<Response | undefined> {
  const headers = new Headers({ Cookie: cookie });
  if (origin !== null) headers.set("Origin", origin);
  const ctx = ctxOf(
    h,
    new Request(`${h.env.ISSUER}/account/delete${query}`, { method: "POST", headers }),
  );
  const current = await currentSession(ctx);
  if (!current) throw new Error("the test's person is not signed in");
  return checkAccountForm(ctx, current, formOf(fields));
}

describe("csrfToken", () => {
  it("is the hex HMAC-SHA256 of the sid with STATE_SECRET", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const token = await csrfToken(h, person.session.sid);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const expected = createHmac("sha256", "test-state-secret")
      .update(person.session.sid)
      .digest("hex");
    expect(token).toBe(expected);
  });

  it("is stable for a session and differs between sessions and between secrets", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const phone = await anotherSession(h, person);
    expect(await csrfToken(h, person.session.sid)).toBe(await csrfToken(h, person.session.sid));
    expect(await csrfToken(h, person.session.sid)).not.toBe(await csrfToken(h, phone.session.sid));
    const other = await harness({ env: { STATE_SECRET: "another-state-secret" } });
    expect(await csrfToken(other, person.session.sid)).not.toBe(
      await csrfToken(h, person.session.sid),
    );
  });
});

describe("checkAccountForm", () => {
  it("lets through a post from the issuer's origin with the session's own token", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const csrf = await csrfToken(h, person.session.sid);
    expect(await check(h, person.cookie, ISSUER_ORIGIN, { csrf })).toBeUndefined();
  });

  it.each([
    ["no Origin header", null],
    ["the null origin", "null"],
    ["a product", "https://diagrams.meltemi.dev"],
    ["the site", "https://meltemi.dev"],
    ["a foreign origin", "https://evil.example"],
    ["the issuer over plain http", "http://id.meltemi.dev"],
    ["the issuer on another port", "https://id.meltemi.dev:8443"],
    ["a look-alike of the issuer", "https://id.meltemi.dev.evil.example"],
    ["something that is not an origin", "not an origin"],
  ])("refuses %s even with a correct token", async (_name, origin) => {
    const h = await harness();
    const person = await signedInPerson(h);
    const csrf = await csrfToken(h, person.session.sid);
    const refused = await check(h, person.cookie, origin, { csrf });
    expect(refused?.status).toBe(403);
    expect(await textOf(refused!)).toContain("request.forbidden");
  });

  it("refuses a missing, empty, short, long or non-hexadecimal token", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const good = await csrfToken(h, person.session.sid);
    const attempts: Record<string, string>[] = [
      {},
      { csrf: "" },
      { csrf: good.slice(0, 62) },
      { csrf: `${good}00` },
      { csrf: "z".repeat(64) },
      { csrf: `${good.slice(0, 63)}g` },
      { csrf: " " + good },
      { token: good },
    ];
    for (const fields of attempts) {
      const refused = await check(h, person.cookie, ISSUER_ORIGIN, fields);
      expect(refused?.status, JSON.stringify(fields)).toBe(403);
    }
  });

  it("refuses a token that is a file rather than text", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const good = await csrfToken(h, person.session.sid);
    const form = new FormData();
    form.set("csrf", new File([good], "csrf.txt"));
    const ctx = ctxOf(
      h,
      new Request(`${h.env.ISSUER}/account/delete`, {
        method: "POST",
        headers: { Cookie: person.cookie, Origin: ISSUER_ORIGIN },
      }),
    );
    const current = (await currentSession(ctx))!;
    expect((await checkAccountForm(ctx, current, form))?.status).toBe(403);
  });

  it("refuses the token of another session, even of the same person", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const phone = await anotherSession(h, person);
    const theirs = await csrfToken(h, phone.session.sid);
    expect((await check(h, person.cookie, ISSUER_ORIGIN, { csrf: theirs }))?.status).toBe(403);
  });

  it("refuses the token of another person's session", async () => {
    const h = await harness();
    const person = await signedInPerson(h, { id: "user-a" });
    const stranger = await signedInPerson(h, { id: "user-b" });
    const theirs = await csrfToken(h, stranger.session.sid);
    expect((await check(h, person.cookie, ISSUER_ORIGIN, { csrf: theirs }))?.status).toBe(403);
  });

  it("refuses a token made with another secret", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const forged = createHmac("sha256", "not-the-state-secret")
      .update(person.session.sid)
      .digest("hex");
    expect((await check(h, person.cookie, ISSUER_ORIGIN, { csrf: forged }))?.status).toBe(403);
  });

  it("does not accept the token from the query string", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const csrf = await csrfToken(h, person.session.sid);
    const refused = await check(h, person.cookie, ISSUER_ORIGIN, {}, `?csrf=${csrf}`);
    expect(refused?.status).toBe(403);
  });

  it("answers in the language of the request and offers the way back", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const english = await textOf((await check(h, person.cookie, null, {}))!);
    expect(english).toContain("This request was refused");
    expect(english).toContain('href="/account"');
    const spanish = await check(h, person.cookie, null, {}, "?lang=es");
    const page = await textOf(spanish!);
    expect(page).toContain('<html lang="es">');
    expect(page).toContain("Se rechazó esta petición");
    expect(page).toContain('href="/account?lang=es"');
  });

  it("holds the same line in development: only the service's own origin, not the family's", async () => {
    const dev = await harness({ env: { ...DEV_ENV } });
    const person = await signedInPerson(dev);
    const csrf = await csrfToken(dev, person.session.sid);
    expect(await check(dev, person.cookie, "http://localhost:8787", { csrf })).toBeUndefined();
    for (const origin of ["http://localhost:8788", "http://localhost:8789", null]) {
      expect((await check(dev, person.cookie, origin, { csrf }))?.status).toBe(403);
    }
  });
});

describe("forbiddenPage", () => {
  it("is a 403 page with the stable code, the common words and the given way forward", async () => {
    const h = await harness();
    const ctx = ctxOf(h, new Request(`${h.env.ISSUER}/x`));
    const response = forbiddenPage(ctx, { href: "https://meltemi.dev", label: "Back <here>" });
    expect(response.status).toBe(403);
    const page = await textOf(response);
    expect(page).toContain("request.forbidden");
    expect(page).toContain("Back &lt;here&gt;");
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
  });
});

describe("readForm", () => {
  const post = (init: RequestInit) =>
    new Request("https://id.meltemi.dev/account/x", { method: "POST", ...init });

  it("reads a urlencoded form", async () => {
    const form = await readForm(
      post({
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "a=1&b=two+words&b=again",
      }),
    );
    expect(form?.get("a")).toBe("1");
    expect(form?.get("b")).toBe("two words");
  });

  it("reads a multipart form", async () => {
    const data = new FormData();
    data.set("a", "1");
    expect((await readForm(post({ body: data })))?.get("a")).toBe("1");
  });

  it.each([
    ["JSON", { headers: { "Content-Type": "application/json" }, body: '{"a":1}' }],
    ["plain text", { headers: { "Content-Type": "text/plain" }, body: "a=1" }],
    ["no body and no type", {}],
    [
      "a broken multipart body",
      { headers: { "Content-Type": "multipart/form-data; boundary=x" }, body: "garbage" },
    ],
  ])("answers undefined, not an exception, for %s", async (_name, init) => {
    expect(await readForm(post(init))).toBeUndefined();
  });
});

describe("signInRedirect and accountPath", () => {
  it("sends a person to the chooser with the account page as the return address, encoded", async () => {
    const h = await harness();
    const response = signInRedirect(readConfig(h.env));
    expect(response.status).toBe(302);
    const location = response.headers.get("Location")!;
    expect(location).toBe("/login?return_to=https%3A%2F%2Fid.meltemi.dev%2Faccount");
    expect(new URL(location, ISSUER_ORIGIN).searchParams.get("return_to")).toBe(
      "https://id.meltemi.dev/account",
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns to the development issuer's account page in development", async () => {
    const dev = await harness({ env: { ...DEV_ENV } });
    const location = signInRedirect(readConfig(dev.env)).headers.get("Location")!;
    expect(new URL(location, "http://localhost:8787").searchParams.get("return_to")).toBe(
      "http://localhost:8787/account",
    );
  });

  it("keeps a chosen language in the account path and invents none", () => {
    const path = (search: string) =>
      accountPath({ url: new URL(`https://id.meltemi.dev/x${search}`) });
    expect(path("")).toBe("/account");
    expect(path("?lang=es")).toBe("/account?lang=es");
    expect(path("?lang=en")).toBe("/account?lang=en");
    expect(path("?lang=fr")).toBe("/account");
    expect(path("?lang=es&x=1")).toBe("/account?lang=es");
  });
});

describe("accountAction", () => {
  async function run(
    h: Harness,
    options: { cookie?: string; origin?: string | null; fields?: Record<string, string> },
  ) {
    const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
    if (options.cookie) headers.set("Cookie", options.cookie);
    if (options.origin !== null) headers.set("Origin", options.origin ?? ISSUER_ORIGIN);
    const request = new Request(`${h.env.ISSUER}/account/unlink`, {
      method: "POST",
      headers,
      body: new URLSearchParams(options.fields ?? {}).toString(),
    });
    return accountAction(ctxOf(h, request));
  }

  it("gives the session and the form when everything holds", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const csrf = await csrfToken(h, person.session.sid);
    const result = await run(h, { cookie: person.cookie, fields: { csrf, provider: "github" } });
    expect("response" in result).toBe(false);
    if ("current" in result) {
      expect(result.current.session.sid).toBe(person.session.sid);
      expect(result.current.user.id).toBe(person.user.id);
      expect(result.form.get("provider")).toBe("github");
    }
  });

  it("asks for the session before anything else: a signed-out person goes to sign in, whatever else is wrong", async () => {
    const h = await harness();
    const attempts: Parameters<typeof run>[1][] = [
      { origin: "https://evil.example", fields: {} },
      { origin: null, fields: {} },
      { cookie: "meltemi_session=garbage", origin: "https://evil.example", fields: { csrf: "x" } },
    ];
    for (const options of attempts) {
      const result = await run(h, options);
      expect("response" in result && result.response.status).toBe(302);
    }
  });

  it("refuses a body that is not a form with 403, without throwing", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const request = new Request(`${h.env.ISSUER}/account/unlink`, {
      method: "POST",
      headers: { Cookie: person.cookie, Origin: ISSUER_ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ csrf: await csrfToken(h, person.session.sid) }),
    });
    const result = await accountAction(ctxOf(h, request));
    expect("response" in result && result.response.status).toBe(403);
  });

  it("refuses a form from another origin or without the token with 403", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const csrf = await csrfToken(h, person.session.sid);
    const foreign = await run(h, {
      cookie: person.cookie,
      origin: "https://diagrams.meltemi.dev",
      fields: { csrf },
    });
    expect("response" in foreign && foreign.response.status).toBe(403);
    const tokenless = await run(h, { cookie: person.cookie, fields: {} });
    expect("response" in tokenless && tokenless.response.status).toBe(403);
  });
});
