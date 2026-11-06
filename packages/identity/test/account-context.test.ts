import { describe, expect, it } from "vitest";
import type { Provider } from "../src/types.js";
import { DEV_ENV, anotherSession, formsOf, submitForm } from "./support/account.js";
import { harness, signedInPerson, textOf } from "./support/index.js";
import { callback, decodeOauth, hrefsOf, sessionCookies, startFlow } from "./support/signin.js";

describe("account language and explicit product context through authentication", () => {
  for (const development of [false, true]) {
    for (const query of ["?lang=es", "?lang=es&environment=staging"]) {
      it.each<Provider>(["github", "google"])(
        `keeps ${development ? "local" : "hosted"} ${query} through rendered %s linking and its callback`,
        async (provider) => {
          const h = await harness({ env: development ? DEV_ENV : {} });
          const person = await signedInPerson(h, {
            provider: provider === "github" ? "google" : "github",
          });
          const address = `${h.env.ISSUER}/account${query}`;
          const html = await textOf(
            await h.request(`/account${query}`, { headers: { Cookie: person.cookie } }),
          );
          const href = hrefsOf(html).find((value) => {
            const target = new URL(value, h.env.ISSUER);
            return target.pathname === "/login" && target.searchParams.get("provider") === provider;
          });
          expect(href).toBeDefined();
          const target = new URL(href!, h.env.ISSUER);
          expect(target.searchParams.get("lang")).toBe("es");
          expect(target.searchParams.get("link")).toBe("1");
          expect(target.searchParams.get("return_to")).toBe(address);

          // Follow the actual page's link through signed OAuth state and the existing callback.
          const flow = await startFlow(h, provider, {
            query: Object.fromEntries(target.searchParams),
            headers: { Cookie: person.cookie },
          });
          expect(decodeOauth(flow.value).payload["returnTo"]).toBe(address);
          const response = await callback(h, provider, flow, { cookies: [person.cookie] });
          expect(response.status).toBe(302);
          expect(response.headers.get("Location")).toBe(address);
          expect(sessionCookies(response)).toEqual([]);
          expect(await h.store.session(person.session.sid)).toMatchObject({ revokedAt: null });
          const returned = await textOf(
            await h.request(address, { headers: { Cookie: person.cookie } }),
          );
          expect(returned).toContain('<html lang="es"');
          expect(
            (await h.store.identitiesOf(person.user.id)).map((item) => item.provider).sort(),
          ).toEqual(["github", "google"]);
        },
      );
    }
  }

  it("keeps language, staging and a checked product return through unlink and device revocation", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const other = await anotherSession(h, person);
    const product = "https://staging.diagrams.meltemi.dev/?account=devices";
    const query = `?lang=es&environment=staging&return_to=${encodeURIComponent(product)}`;
    const flow = await startFlow(h, "google", {
      query: { link: "1", return_to: `${h.env.ISSUER}/account${query}` },
      headers: { Cookie: person.cookie },
    });
    expect((await callback(h, "google", flow, { cookies: [person.cookie] })).status).toBe(302);
    const read = async () =>
      textOf(await h.request(`/account${query}`, { headers: { Cookie: person.cookie } }));
    const forms = formsOf(await read());
    const unlink = forms.find(
      (form) =>
        new URL(form.action, h.env.ISSUER).pathname === "/account/unlink" &&
        form.fields["provider"] === "google",
    )!;
    const unlinked = await submitForm(h, unlink, { cookie: person.cookie });
    expect(unlinked.status).toBe(303);
    expect(unlinked.headers.get("Location")).toBe(`/account${query}`);
    expect((await h.store.identitiesOf(person.user.id)).map((item) => item.provider)).toEqual([
      "github",
    ]);
    const revoke = formsOf(await read()).find(
      (form) =>
        new URL(form.action, h.env.ISSUER).pathname === "/account/sessions/revoke" &&
        form.fields["sid"] === other.session.sid,
    )!;
    const revoked = await submitForm(h, revoke, { cookie: person.cookie });
    expect(revoked.status).toBe(303);
    expect(revoked.headers.get("Location")).toBe(`/account${query}`);
    expect((await h.request(`/sessions/${other.session.sid}`)).status).toBe(404);
    expect((await h.request(`/sessions/${person.session.sid}`)).status).toBe(204);
  });

  it.each(["/account", "/account/unlink", "/account/sessions/revoke-others"])(
    "keeps explicit language and staging when %s needs a fresh session",
    async (path) => {
      const h = await harness({ env: DEV_ENV });
      const response = await h.request(`${path}?lang=es&environment=staging`, {
        method: path === "/account" ? "GET" : "POST",
      });
      expect(response.status).toBe(302);
      const login = new URL(response.headers.get("Location")!, h.env.ISSUER);
      expect(login.pathname).toBe("/login");
      expect(login.searchParams.get("lang")).toBe("es");
      expect(login.searchParams.get("return_to")).toBe(
        `${h.env.ISSUER}/account?lang=es&environment=staging`,
      );
      expect(h.stub.calls).toEqual([]);
    },
  );

  it.each(["environment=other", "environment=staging&environment=production"])(
    "refuses invalid or ambiguous product context before starting OAuth: %s",
    async (query) => {
      const h = await harness();
      const response = await h.request(`/account?lang=es&${query}`);
      expect(response.status).toBe(400);
      expect(response.headers.has("Location")).toBe(false);
      expect(h.stub.calls).toEqual([]);
    },
  );
});
