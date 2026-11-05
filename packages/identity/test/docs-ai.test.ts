import { afterEach, describe, expect, it, vi } from "vitest";
import { isDocsAiOwner } from "../src/administration.js";
import { d1Store } from "../src/store/d1.js";
import { formPost, formsOf, submitForm } from "./support/account.js";
import { harness, signedInPerson } from "./support/index.js";
import { migrationFiles, openDatabase, sqliteAvailable } from "./support/sqlite.js";

const ADMIN = "/admin/docs-ai";

afterEach(() => vi.restoreAllMocks());

async function owner() {
  const h = await harness({ env: { ADMIN_SUBS: " owner-1 , owner-2 " } });
  const person = await signedInPerson(h, { id: "owner-1" });
  return { h, person };
}

describe("the documentation AI switch", () => {
  it("publishes only the saved boolean without caching or a user session", async () => {
    const h = await harness();
    const first = await h.request("/api/docs-ai");
    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    expect(await first.json()).toEqual({ enabled: true });
    await h.store.setDocsAi(false);
    expect(await (await h.request("/api/docs-ai")).json()).toEqual({ enabled: false });
    expect(h.stub.calls).toEqual([]);
  });

  it("fails closed for a missing or unreadable setting", async () => {
    const h = await harness();
    vi.spyOn(h.store, "getDocsAi").mockResolvedValueOnce(undefined);
    const missing = await h.request("/api/docs-ai");
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ reason: "unavailable" });
    expect(missing.headers.get("Cache-Control")).toBe("no-store");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(h.store, "getDocsAi").mockRejectedValueOnce(new Error("database unavailable"));
    const failed = await h.request("/api/docs-ai");
    expect(failed.status).toBe(500);
    expect(await failed.json()).not.toHaveProperty("enabled");
  });

  it("does not expose a public or bearer-token write API", async () => {
    const { h, person } = await owner();
    const response = await h.request("/api/docs-ai", {
      method: "POST",
      headers: { Authorization: `Bearer ${person.token}`, "Content-Type": "application/json" },
      body: '{"enabled":false}',
    });
    expect(response.status).toBe(404);
    expect(await h.store.getDocsAi()).toBe(true);
  });

  it("requires an exact nonempty owner sub rather than an email, name or substring", () => {
    expect(isDocsAiOwner({}, "owner-1")).toBe(false);
    expect(isDocsAiOwner({ ADMIN_SUBS: " ,  , " }, "")).toBe(false);
    expect(isDocsAiOwner({ ADMIN_SUBS: " owner-1,owner-2 " }, "owner")).toBe(false);
    expect(isDocsAiOwner({ ADMIN_SUBS: " owner-1,owner-2 " }, "owner-2")).toBe(true);
  });

  it("returns anonymous readers directly from sign-in to the requested admin language", async () => {
    const { h } = await owner();
    const response = await h.request(`${ADMIN}?lang=es&return_to=https://evil.example`);
    expect(response.status).toBe(302);
    const login = new URL(response.headers.get("Location")!, h.env.ISSUER);
    expect(login.pathname).toBe("/login");
    expect(login.searchParams.get("lang")).toBe("es");
    expect(login.searchParams.get("return_to")).toBe(`${h.env.ISSUER}${ADMIN}?lang=es`);
  });

  it("hides administration and the account link from signed-in nonowners", async () => {
    const { h } = await owner();
    const other = await signedInPerson(h, { id: "other" });
    const headers = { Cookie: other.cookie };
    expect((await h.request(ADMIN, { headers })).status).toBe(404);
    expect((await formPost(h, ADMIN, { as: other, fields: { enabled: "false" } })).status).toBe(
      404,
    );
    expect(await (await h.request("/account", { headers })).text()).not.toContain(ADMIN);
    expect(await h.store.getDocsAi()).toBe(true);
  });

  it("shows a translated owner control in the shared hardened layout and account page", async () => {
    const { h, person } = await owner();
    for (const lang of ["en", "es"]) {
      const response = await h.request(`${ADMIN}?lang=${lang}`, {
        headers: { Cookie: person.cookie },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
      const html = await response.text();
      expect(html).toContain(`<html lang="${lang}">`);
      expect(html).toContain(lang === "es" ? "Pausar respuestas" : "Pause answers");
      expect(formsOf(html).map((form) => form.fields["enabled"])).toEqual(["true", "false"]);
      const account = await h.request(`/account?lang=${lang}`, {
        headers: { Cookie: person.cookie },
      });
      expect(await account.text()).toContain(`${ADMIN}?lang=${lang}`);
    }
  });

  it("persists explicit pause and enable actions and displays the saved state after redirect", async () => {
    const { h, person } = await owner();
    for (const enabled of [false, false, true]) {
      const page = await h.request(`${ADMIN}?lang=es`, { headers: { Cookie: person.cookie } });
      const form = formsOf(await page.text()).find(
        (form) => form.fields["enabled"] === String(enabled),
      )!;
      const response = await submitForm(h, form, { cookie: person.cookie });
      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe(`${ADMIN}?lang=es`);
      expect(await h.store.getDocsAi()).toBe(enabled);
      expect(await (await h.request("/api/docs-ai")).json()).toEqual({ enabled });
    }
  });

  it.each([null, "null", "https://diagrams.meltemi.dev", "https://evil.example"])(
    "rejects an owner form from Origin %s even with a valid csrf",
    async (origin) => {
      const { h, person } = await owner();
      const response = await formPost(h, ADMIN, {
        as: person,
        origin,
        fields: { enabled: "false" },
      });
      expect(response.status).toBe(403);
      expect(await h.store.getDocsAi()).toBe(true);
    },
  );

  it.each([null, "bogus"])("rejects csrf %s", async (csrf) => {
    const { h, person } = await owner();
    const response = await formPost(h, ADMIN, { as: person, csrf, fields: { enabled: "false" } });
    expect(response.status).toBe(403);
    expect(await h.store.getDocsAi()).toBe(true);
  });

  it.each(["", "off", "0", "toggle"])(
    "requires an explicit boolean, refusing %s",
    async (enabled) => {
      const { h, person } = await owner();
      expect((await formPost(h, ADMIN, { as: person, fields: { enabled } })).status).toBe(400);
      expect(await h.store.getDocsAi()).toBe(true);
    },
  );

  it("does not accept a csrf from another live session", async () => {
    const { h, person } = await owner();
    const other = await signedInPerson(h, { id: "owner-2" });
    const page = await h.request(ADMIN, { headers: { Cookie: other.cookie } });
    const csrf = formsOf(await page.text())[0]!.fields["csrf"]!;
    const response = await formPost(h, ADMIN, { as: person, csrf, fields: { enabled: "false" } });
    expect(response.status).toBe(403);
  });

  it("enforces revocation immediately after a previously successful admin read", async () => {
    const { h, person } = await owner();
    expect((await h.request(ADMIN, { headers: { Cookie: person.cookie } })).status).toBe(200);
    await h.store.revokeSession(person.session.sid, h.clock.now().toISOString());
    const response = await formPost(h, ADMIN, { as: person, fields: { enabled: "false" } });
    expect(response.status).toBe(302);
    expect(await h.store.getDocsAi()).toBe(true);
  });

  it("never acknowledges a failed save, preserving the previous paused state", async () => {
    const { h, person } = await owner();
    await h.store.setDocsAi(false);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(h.store, "setDocsAi").mockRejectedValueOnce(new Error("database unavailable"));
    const response = await formPost(h, ADMIN, { as: person, fields: { enabled: "true" } });
    expect(response.status).toBe(500);
    expect(response.headers.has("Location")).toBe(false);
    expect(await h.store.getDocsAi()).toBe(false);
  });

  it("does not read private state or authorize a mutation from a bearer session token", async () => {
    const { h, person } = await owner();
    const response = await h.request(ADMIN, {
      headers: { Authorization: `Bearer ${person.token}` },
    });
    expect(response.status).toBe(302);
    const post = await h.request(ADMIN, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${person.token}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: h.env.ISSUER,
      },
      body: "enabled=false",
    });
    expect(post.status).toBe(302);
    expect(await h.store.getDocsAi()).toBe(true);
  });

  it("refuses ambiguous action fields instead of interpreting a partial form", async () => {
    const { h, person } = await owner();
    const page = await h.request(ADMIN, { headers: { Cookie: person.cookie } });
    const form = formsOf(await page.text())[0]!;
    const body = new URLSearchParams(form.fields);
    body.append("enabled", "false");
    const response = await h.request(ADMIN, {
      method: "POST",
      headers: {
        Cookie: person.cookie,
        Origin: h.env.ISSUER,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    expect(response.status).toBe(400);
    expect(await h.store.getDocsAi()).toBe(true);
  });
});

describe.skipIf(!sqliteAvailable)("documentation AI SQL persistence", () => {
  it("retains a pause across store reconstruction and a repeated seed migration", async () => {
    const db = openDatabase();
    try {
      const first = d1Store(db);
      expect(await first.getDocsAi()).toBe(true);
      await first.setDocsAi(false);
      const migration = migrationFiles().find((file) => file.name === "0002_docs_ai.sql")!;
      db.raw.exec(migration.sql);
      expect(await d1Store(db).getDocsAi()).toBe(false);
      expect(db.raw.prepare("SELECT * FROM docs_ai_settings").all()).toEqual([
        { id: 1, enabled: 0 },
      ]);
    } finally {
      db.close();
    }
  });

  it("fails closed when the row is missing and refuses to manufacture a replacement on save", async () => {
    const db = openDatabase();
    try {
      db.raw.exec("DELETE FROM docs_ai_settings");
      const store = d1Store(db);
      expect(await store.getDocsAi()).toBeUndefined();
      await expect(store.setDocsAi(true)).rejects.toThrow("state is missing");
      const h = await harness({ store });
      expect((await h.request("/api/docs-ai")).status).toBe(503);
    } finally {
      db.close();
    }
  });

  it("constrains the setting to one row and a real boolean", () => {
    const db = openDatabase();
    try {
      expect(() => db.raw.exec("UPDATE docs_ai_settings SET enabled = 2")).toThrow(/CHECK/);
      expect(() => db.raw.exec("INSERT INTO docs_ai_settings VALUES (2, 1)")).toThrow(/CHECK/);
      expect(() => db.raw.exec("UPDATE docs_ai_settings SET enabled = 'yes'")).toThrow(/INTEGER/);
    } finally {
      db.close();
    }
  });

  it("does not acknowledge a rejected SQL update or lose the paused value", async () => {
    const db = openDatabase();
    try {
      const store = d1Store(db);
      await store.setDocsAi(false);
      const h = await harness({ store, env: { ADMIN_SUBS: "owner-1" } });
      const person = await signedInPerson(h, { id: "owner-1" });
      db.raw.exec(
        "CREATE TRIGGER refuse_docs_ai BEFORE UPDATE ON docs_ai_settings BEGIN SELECT RAISE(ABORT, 'refused'); END",
      );
      vi.spyOn(console, "error").mockImplementation(() => {});
      const response = await formPost(h, ADMIN, { as: person, fields: { enabled: "true" } });
      expect(response.status).toBe(500);
      expect(response.headers.has("Location")).toBe(false);
      expect(await d1Store(db).getDocsAi()).toBe(false);
    } finally {
      db.close();
    }
  });
});
