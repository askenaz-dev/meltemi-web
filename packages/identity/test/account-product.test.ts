// The account page for a person who comes from a product (`identity-account`, "A product's way in
// and back") and signing out of one device on the page ("Signing out of one device on the page").

import { describe, expect, it } from "vitest";
import {
  FIREFOX_ON_ANDROID,
  anotherSession,
  formPost,
  formsOf,
  submitForm,
  unescapeHtml,
} from "./support/account.js";
import { harness, signedInPerson, textOf, type Harness } from "./support/index.js";

const ISSUER = "https://id.meltemi.dev";
const PRODUCT = "https://diagrams.meltemi.dev/?account=signins";
const FROM_PRODUCT = `?return_to=${encodeURIComponent(PRODUCT)}`;

async function page(h: Harness, cookie: string, query = ""): Promise<string> {
  const response = await h.request(`/account${query}`, { headers: { Cookie: cookie } });
  expect(response.status).toBe(200);
  return textOf(response);
}

async function isLive(h: Harness, sid: string): Promise<boolean> {
  return (await h.request(`/sessions/${sid}`)).status === 204;
}

const pathOf = (action: string) => new URL(action, ISSUER).pathname;

describe("entering from a product", () => {
  it("shows Back to the product's host and starts the link flow back to the product", async () => {
    const h = await harness();
    const person = await signedInPerson(h, { provider: "google", handle: "" });
    const html = await page(h, person.cookie, FROM_PRODUCT);
    expect(html).toContain(
      `<a class="btn" href="${PRODUCT.replace(/&/g, "&amp;")}">Back to diagrams.meltemi.dev</a>`,
    );
    const link = /href="([^"]*provider=github[^"]*)"/.exec(html)?.[1];
    expect(unescapeHtml(link ?? "")).toBe(
      `/login?provider=github&link=1&return_to=${encodeURIComponent(PRODUCT)}`,
    );
  });

  it("keeps the address in every form, and signs out back to the product", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    await anotherSession(h, person, FIREFOX_ON_ANDROID);
    const forms = formsOf(await page(h, person.cookie, FROM_PRODUCT));
    for (const form of forms) {
      expect(form.fields["return_to"], pathOf(form.action)).toBe(PRODUCT);
    }
    expect(forms.map((form) => pathOf(form.action)).sort()).toEqual([
      "/account/delete",
      "/account/sessions/revoke",
      "/account/sessions/revoke-others",
      "/logout",
    ]);
  });

  it("comes back to the page with the address after an action", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const phone = await anotherSession(h, person, FIREFOX_ON_ANDROID);
    const forms = formsOf(await page(h, person.cookie, FROM_PRODUCT));
    const revoke = forms.find((form) => pathOf(form.action) === "/account/sessions/revoke")!;
    const response = await submitForm(h, revoke, { cookie: person.cookie });
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("Location")!, ISSUER);
    expect(location.pathname).toBe("/account");
    expect(location.searchParams.get("return_to")).toBe(PRODUCT);
    expect(await isLive(h, phone.session.sid)).toBe(false);
  });

  it("links back to the product from the page that says the account is gone", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const forms = formsOf(await page(h, person.cookie, FROM_PRODUCT));
    const remove = forms.find((form) => pathOf(form.action) === "/account/delete")!;
    const response = await submitForm(h, remove, {
      cookie: person.cookie,
      extra: { confirm: "delete" },
    });
    expect(response.status).toBe(200);
    const html = await textOf(response);
    expect(html).toContain("Account deleted");
    expect(html).toContain(
      `<a class="btn primary" href="${PRODUCT.replace(/&/g, "&amp;")}">Back to diagrams.meltemi.dev</a>`,
    );
  });

  it("refuses an address outside the family and links to nothing of it", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const response = await h.request(
      `/account?return_to=${encodeURIComponent("https://example.com/")}`,
      {
        headers: { Cookie: person.cookie },
      },
    );
    expect(response.status).toBe(400);
    const html = await textOf(response);
    expect(html).toContain("return_to.invalid");
    expect(html).not.toContain("example.com");
  });

  it("sends a person without a session to sign in, back to the page with the address", async () => {
    const h = await harness();
    const response = await h.request(`/account${FROM_PRODUCT}`);
    expect(response.status).toBe(302);
    const login = new URL(response.headers.get("Location")!, ISSUER);
    expect(login.pathname).toBe("/login");
    expect(login.searchParams.get("return_to")).toBe(
      `${ISSUER}/account?return_to=${encodeURIComponent(PRODUCT)}`,
    );
  });

  it("drops an address a form carries that is not the family's, and never follows it", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const response = await formPost(h, "/account/sessions/revoke-others", {
      as: person,
      fields: { return_to: "https://example.com/" },
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/account");
  });
});

describe("signing out of one device on the page", () => {
  it("offers Sign out on every other session and /logout on the current one", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const phone = await anotherSession(h, person, FIREFOX_ON_ANDROID);
    const forms = formsOf(await page(h, person.cookie));
    const revoke = forms.filter((form) => pathOf(form.action) === "/account/sessions/revoke");
    expect(revoke.map((form) => form.fields["sid"])).toEqual([phone.session.sid]);
    expect(revoke[0]!.button).toBe("Sign out");
    const logout = forms.filter((form) => pathOf(form.action) === "/logout");
    expect(logout).toHaveLength(1);
    expect(logout[0]!.fields).toEqual({ return_to: "https://meltemi.dev" });
  });

  it("ends that session only, and the page lists it no more", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const phone = await anotherSession(h, person, FIREFOX_ON_ANDROID);
    const response = await formPost(h, "/account/sessions/revoke", {
      as: person,
      fields: { sid: phone.session.sid },
    });
    expect(response.status).toBe(303);
    expect(await isLive(h, phone.session.sid)).toBe(false);
    expect(await isLive(h, person.session.sid)).toBe(true);
    expect(await page(h, person.cookie)).not.toContain("Firefox on Android");
  });

  it("answers 404 session.not-found for a stranger's session, which stays live", async () => {
    const h = await harness();
    const ana = await signedInPerson(h, { id: "user-ana" });
    const bea = await signedInPerson(h, { id: "user-bea", providerId: "bea-provider" });
    const response = await formPost(h, "/account/sessions/revoke", {
      as: ana,
      fields: { sid: bea.session.sid },
    });
    expect(response.status).toBe(404);
    expect(await textOf(response)).toContain("session.not-found");
    expect(await isLive(h, bea.session.sid)).toBe(true);
  });

  it("answers 409 session.current for the session that posts", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const response = await formPost(h, "/account/sessions/revoke", {
      as: person,
      fields: { sid: person.session.sid },
    });
    expect(response.status).toBe(409);
    expect(await textOf(response)).toContain("session.current");
    expect(await isLive(h, person.session.sid)).toBe(true);
  });

  it("is protected like every other action: without the page's Origin nothing changes", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const phone = await anotherSession(h, person, FIREFOX_ON_ANDROID);
    const response = await formPost(h, "/account/sessions/revoke", {
      as: person,
      origin: "https://diagrams.meltemi.dev",
      fields: { sid: phone.session.sid },
    });
    expect(response.status).toBe(403);
    expect(await isLive(h, phone.session.sid)).toBe(true);
  });

  it("speaks Spanish on a Spanish page", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    await anotherSession(h, person, FIREFOX_ON_ANDROID);
    const html = await page(h, person.cookie, `?lang=es${FROM_PRODUCT.replace("?", "&")}`);
    expect(html).toContain("Volver a diagrams.meltemi.dev");
    const revoke = formsOf(html).find(
      (form) => pathOf(form.action) === "/account/sessions/revoke",
    )!;
    expect(revoke.button).toBe("Cerrar sesión");
    expect(revoke.action).toBe("/account/sessions/revoke?lang=es");
  });
});
