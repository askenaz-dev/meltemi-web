import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionVerifier } from "../src/verify.js";
import { readDisplayName } from "../src/preferences.js";
import * as jwt from "../src/jwt.js";
import { formPost } from "./support/account.js";
import { harness, setCookie, signedInPerson } from "./support/index.js";

afterEach(() => vi.restoreAllMocks());
const claims = (token: string) =>
  JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;

describe("personal account settings", () => {
  it("rejects invalid or duplicated environment selections before account or global configuration changes", async () => {
    const h = await harness({ env: { ADMIN_SUBS: "owner" } });
    const person = await signedInPerson(h, { id: "owner" });
    for (const query of ["?environment=unknown", "?environment=production&environment=staging"]) {
      expect(
        (
          await formPost(h, "/account/profile", {
            as: person,
            query,
            fields: { displayName: "Changed" },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await formPost(h, "/account/preferences", {
            as: person,
            query,
            fields: { theme: "dark", language: "es" },
          })
        ).status,
      ).toBe(400);
      expect(
        (await formPost(h, "/admin/docs-ai", { as: person, query, fields: { enabled: "false" } }))
          .status,
      ).toBe(400);
    }
    expect(await h.store.getAccountPreferences(person.user.id)).toEqual({
      displayName: null,
      theme: "system",
      language: "system",
    });
    expect(await h.store.getDocsAi()).toBe(true);
  });

  it("preserves staging while saving personal preferences and labels the AI control as global", async () => {
    const h = await harness({ env: { ADMIN_SUBS: "owner" } });
    const person = await signedInPerson(h, { id: "owner" });
    const response = await formPost(h, "/account/preferences", {
      as: person,
      query: "?environment=staging",
      fields: { theme: "dark", language: "es" },
    });
    expect(response.headers.get("Location")).toBe(
      "/account/preferences?saved=1&environment=staging&lang=es",
    );
    const page = await h.request("/admin/docs-ai?environment=staging&lang=en", {
      headers: { Cookie: person.cookie },
    });
    const html = await page.text();
    expect(html).toContain("Global control");
    expect(html).toContain('action="/admin/docs-ai?lang=en&amp;environment=staging"');
  });

  it("normalizes Unicode and rejects invisible controls and excessive names", () => {
    expect(readDisplayName("  A\u0301na  ")).toBe("Ána");
    expect(readDisplayName(" ")).toBeNull();
    expect(readDisplayName("😀".repeat(80))).toHaveLength(160);
    for (const name of ["😀".repeat(81), "Ana\n", "Ana\u202e", 1])
      expect(readDisplayName(name)).toBeUndefined();
  });

  it("renders both account settings pages in the application shell and escapes names", async () => {
    const h = await harness();
    const person = await signedInPerson(h, { name: '<Ana & "A">' });
    for (const section of ["profile", "preferences"]) {
      const response = await h.request(`/account/${section}?lang=es`, {
        headers: { Cookie: person.cookie },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const html = await response.text();
      expect(html).toContain('class="app-shell"');
      expect(html).toContain('lang="es"');
      expect(html).not.toContain('<Ana & "A">');
      expect(html).not.toContain("/admin/docs-ai");
      expect(html).toContain('name="csrf"');
    }
  });

  it("updates only the name and reissues the same signed session without extending its expiry", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    h.clock.advance(120_000);
    const response = await formPost(h, "/account/profile", {
      as: person,
      fields: { displayName: "  Ána  " },
    });
    expect(response.status).toBe(303);
    const token = setCookie(response, "meltemi_session")!;
    const original = claims(person.token),
      updated = claims(token);
    expect(updated).toEqual({ ...original, name: "Ána" });
    expect(response.headers.get("Set-Cookie")).toContain(
      `Max-Age=${Number(original["exp"]) - Number(original["iat"]) - 120}`,
    );
    const verified = await sessionVerifier({
      issuer: h.env.ISSUER,
      jwks: { keys: [h.keys.publicJwk] },
      checkSession: false,
    }).verifySession(token, h.clock.now());
    expect(verified?.name).toBe("Ána");
    expect((await h.store.userById(person.user.id))?.name).toBe("Ana Dev");
    await h.store.updateUser(person.user.id, { name: "Provider refreshed", picture: "" });
    const nav = await h.request("/api/navigation", { headers: { Cookie: person.cookie } });
    expect(await nav.json()).toEqual({ authenticated: true, name: "Ána", owner: false });
  });

  it("saves appearance per account and resolves explicit, saved and browser language in order", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const response = await formPost(h, "/account/preferences", {
      as: person,
      fields: { theme: "dark", language: "es" },
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/account/preferences?saved=1&lang=es");
    const headers = { Cookie: person.cookie, "Accept-Language": "en" };
    const saved = await (await h.request("/account/preferences", { headers })).text();
    expect(saved).toContain('<html lang="es" data-theme="dark">');
    expect(await (await h.request("/account/preferences?lang=en", { headers })).text()).toContain(
      '<html lang="en"',
    );
    await formPost(h, "/account/preferences", {
      as: person,
      fields: { theme: "system", language: "system" },
    });
    expect(await (await h.request("/account/preferences", { headers })).text()).toContain(
      '<html lang="en" data-theme="system">',
    );
  });

  it.each([null, "null", "https://docs.meltemi.dev", "https://evil.example"])(
    "rejects profile writes from %s",
    async (origin) => {
      const h = await harness();
      const person = await signedInPerson(h);
      const response = await formPost(h, "/account/profile", {
        as: person,
        origin,
        fields: { displayName: "Changed" },
      });
      expect(response.status).toBe(403);
      expect((await h.store.getAccountPreferences(person.user.id)).displayName).toBeNull();
    },
  );

  it("rejects bad CSRF, duplicated/unknown fields, invalid options, and oversized bodies", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    expect(
      (
        await formPost(h, "/account/profile", {
          as: person,
          csrf: "bad",
          fields: { displayName: "Changed" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await formPost(h, "/account/profile", {
          as: person,
          fields: { displayName: "Changed", userId: "other" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await formPost(h, "/account/preferences", {
          as: person,
          fields: { theme: "invalid", language: "es" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await formPost(h, "/account/profile", {
          as: person,
          fields: { displayName: "x".repeat(5000) },
        })
      ).status,
    ).toBe(403);
    expect((await h.store.getAccountPreferences(person.user.id)).displayName).toBeNull();
  });

  it("does not acknowledge failed persistence or issue a replacement cookie", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    vi.spyOn(h.store, "setDisplayName").mockRejectedValueOnce(new Error("unavailable"));
    const response = await formPost(h, "/account/profile", {
      as: person,
      fields: { displayName: "Changed" },
    });
    expect(response.status).toBe(503);
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect((await h.store.getAccountPreferences(person.user.id)).displayName).toBeNull();
  });

  it("does not persist a profile when the replacement JWT cannot be signed", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    vi.spyOn(jwt, "signJwt").mockRejectedValueOnce(new Error("signing unavailable"));
    const response = await formPost(h, "/account/profile", {
      as: person,
      fields: { displayName: "Changed" },
    });
    expect(response.status).toBe(503);
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect((await h.store.getAccountPreferences(person.user.id)).displayName).toBeNull();
  });
});

describe("private navigation discovery", () => {
  it("returns only the minimal live cookie-based identity and owner role without caching", async () => {
    const h = await harness({ env: { ADMIN_SUBS: "owner" } });
    const owner = await signedInPerson(h, { id: "owner" });
    const request = () => h.request("/api/navigation", { headers: { Cookie: owner.cookie } });
    const response = await request();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
    expect(await response.json()).toEqual({ authenticated: true, name: "Ana Dev", owner: true });
    expect(
      await (
        await h.request("/api/navigation", { headers: { Authorization: `Bearer ${owner.token}` } })
      ).json(),
    ).toEqual({ authenticated: false });
    await h.store.revokeSession(owner.session.sid, h.clock.now().toISOString());
    expect(await (await request()).json()).toEqual({ authenticated: false });
  });

  it("fails closed on a storage failure with no personal error details", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    vi.spyOn(h.store, "session").mockRejectedValueOnce(new Error("private database detail"));
    const response = await h.request("/api/navigation", { headers: { Cookie: person.cookie } });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ reason: "unavailable" });
  });
});
