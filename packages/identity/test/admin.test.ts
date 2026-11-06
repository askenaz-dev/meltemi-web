import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfig } from "../src/config.js";
import { currentSession } from "../src/session.js";
import {
  parseProductContext,
  parseAdminView,
  productContext,
  validAccount,
} from "../src/product-admin.js";
import { publicationAt } from "../src/routes/admin.js";
import {
  adminFixture,
  adminView,
  account,
  administrator,
  INVITATION,
  json,
} from "./admin-support.js";

afterEach(() => vi.useRealTimers());

describe("central administration", () => {
  it("redirects anonymous and revoked sessions back to the exact administrative language without a product call", async () => {
    const f = await adminFixture();
    const anonymous = await f.h.request(
      "/admin/diagrams/access?lang=es&return_to=https://evil.example",
    );
    const location = new URL(anonymous.headers.get("Location")!, f.h.env.ISSUER);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("return_to")).toBe(
      `${f.h.env.ISSUER}/admin/diagrams/access?lang=es&environment=production`,
    );
    await f.h.store.revokeSession(f.person.session.sid, f.h.clock.now().toISOString());
    expect((await f.read("access")).status).toBe(302);
    expect((await f.post("access", { action: "invite", email: "a@example.com" })).status).toBe(302);
    expect(f.calls).toHaveLength(0);
  });

  it("renders a real owner workspace in English and Spanish with private headers and no scripts", async () => {
    const f = await adminFixture();
    for (const [lang, title] of [
      ["en", "Roles and invitations"],
      ["es", "Roles e invitaciones"],
    ]) {
      const response = await f.read("access", lang);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
      const html = await response.text();
      expect(html).toContain(`<html lang="${lang}"`);
      expect(html).toContain(title);
      expect(html).toContain('class="app-shell"');
      expect(html).toContain(
        `action="/admin/diagrams/access?lang=${lang}&amp;environment=production"`,
      );
      expect(html).toContain("invitee@example.com");
      expect(html).toContain('href="/admin/docs-ai?lang=');
      expect(html).not.toMatch(/<script|<style|style=|role="menu"/i);
    }
  });

  it("denies ordinary users and exposes no protected overview data", async () => {
    const f = await adminFixture("none");
    expect((await f.read("access")).status).toBe(404);
    expect((await f.read("/admin/")).status).toBe(404);
    expect(f.calls.every((c) => new URL(c.request.url).pathname === "/context")).toBe(true);
  });

  it("limits product administrators to their product and self-removal", async () => {
    const f = await adminFixture("admin");
    const html = await (await f.read("access")).text();
    expect(html).toContain("Leave administration");
    expect(html).not.toContain('href="/admin/docs-ai');
    expect(html).not.toContain('value="invite"');
    expect(
      (await f.post("access", { action: "invite", email: "stranger@example.com" })).status,
    ).toBe(404);
    const result = await f.post("access", {
      action: "remove",
      sub: administrator.sub,
      confirm: "yes",
    });
    expect(result.status).toBe(303);
    expect(result.headers.get("Location")).toContain("/account?lang=en");
    expect(f.calls.at(-1)!.request.method).toBe("DELETE");
  });

  it("shows only invitation acceptance to an invitee, never the product lists or Docs switch", async () => {
    const f = await adminFixture("invitee");
    const html = await (await f.read("access")).text();
    expect(html).toContain("Accept invitation");
    expect(html).toContain("Decline invitation");
    expect(html).not.toContain('href="/admin/docs-ai');
    expect(html).not.toContain("invitee@example.com");
    expect((await f.read("permissions")).status).toBe(404);
    expect((await f.post("access", { action: "accept", invitation: INVITATION })).status).toBe(303);
    expect(f.calls.at(-1)!.request.url).toBe(
      `https://diagrams.meltemi.dev/api/admin/invitations/${INVITATION}/accept`,
    );
    expect(f.calls.some((c) => new URL(c.request.url).pathname === "/api/admin")).toBe(false);
  });

  it.each([
    ["missing Origin", { Origin: "" }],
    ["family sibling", { Origin: "https://diagrams.meltemi.dev" }],
    ["serialized Origin with a path", { Origin: "https://id.meltemi.dev/path" }],
  ])("rejects %s before consulting the product", async (_name, headers) => {
    const f = await adminFixture();
    expect(
      (await f.post("access", { action: "invite", email: "new@example.com" }, headers)).status,
    ).toBe(403);
    expect(f.calls).toHaveLength(0);
  });

  it.each<Record<string, string>>([
    { action: "invite", email: "new@example.com", csrf: "wrong" },
    { action: "remove", sub: "admin-1" },
    { action: "remove", sub: "admin-1", confirm: "no" },
    { action: "invite", email: "not-an-email" },
    { action: "invite", email: "new@example.com", role: "owner" },
    { action: "unknown" },
  ])(
    "refuses invalid fields or missing confirmation without a product call: %j",
    async (fields) => {
      const f = await adminFixture();
      expect((await f.post("access", fields)).status).toBeGreaterThanOrEqual(400);
      expect(f.calls).toHaveLength(0);
    },
  );

  it("refuses duplicate csrf/action fields and over-size browser forms", async () => {
    const f = await adminFixture();
    const send = (body: URLSearchParams) =>
      f.h.request("/admin/diagrams/access", {
        method: "POST",
        headers: {
          Cookie: f.person.cookie,
          Origin: f.h.env.ISSUER,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
    const duplicate = new URLSearchParams({
      csrf: f.csrf,
      action: "invite",
      email: "a@example.com",
    });
    duplicate.append("action", "remove");
    expect((await send(duplicate)).status).toBe(400);
    expect(
      (await send(new URLSearchParams({ csrf: f.csrf, action: "invite", email: "x".repeat(9000) })))
        .status,
    ).toBe(403);
    expect(f.calls).toHaveLength(0);
  });

  it("invites through the private binding with the cookie bearer and no browser headers", async () => {
    const f = await adminFixture();
    const result = await f.post(
      "access",
      { action: "invite", email: "NEW@example.com" },
      { Authorization: "Bearer attacker" },
    );
    expect(result.status).toBe(303);
    const sent = f.calls.at(-1)!;
    expect(sent.request.url).toBe("https://diagrams.meltemi.dev/api/admin/invitations");
    expect(sent.request.headers.get("Authorization")).toBe(`Bearer ${f.person.token}`);
    expect(sent.request.headers.has("Cookie")).toBe(false);
    expect(sent.request.headers.has("Origin")).toBe(false);
    expect(JSON.parse(sent.body)).toEqual({ email: "NEW@example.com" });
    expect(result.headers.get("Location")).not.toContain("NEW");
  });

  it("keeps an exact email lookup out of both browser and private service URLs", async () => {
    const f = await adminFixture();
    const result = await f.post("permissions", {
      action: "lookup",
      account: "person@example.com",
      permission: "unbranded-exports",
    });
    expect(result.status).toBe(200);
    const sent = f.calls.at(-1)!;
    expect(sent.request.url).toBe("https://diagrams.meltemi.dev/account-permission");
    expect(sent.request.method).toBe("POST");
    expect(JSON.parse(sent.body)).toEqual({
      account: "person@example.com",
      permission: "unbranded-exports",
    });
    const html = await result.text();
    expect(html).toContain("Person &lt;script&gt;bad()&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('name="account" value="account-1"');
    expect(html).toContain("Explicit grant");
  });

  it("distinguishes a stored grant from effective role-derived access", async () => {
    const f = await adminFixture();
    f.intercept((request) =>
      new URL(request.url).pathname === "/account-permission"
        ? json({
            ...administrator,
            invitedBy: undefined,
            since: undefined,
            permission: { id: "unbranded-exports", granted: false, by: null, at: null },
          })
        : undefined,
    );
    const result = await f.post("permissions", {
      action: "lookup",
      account: administrator.sub,
      permission: "unbranded-exports",
    });
    expect(result.status).toBe(200);
    const html = await result.text();
    expect(html).toContain("Granted by administrative role");
    expect(html).toContain("Not granted");
  });

  it("saves an explicit permission and confirms only a matching product response", async () => {
    const f = await adminFixture();
    expect(
      (
        await f.post("permissions", {
          action: "permission",
          account: account.sub,
          permission: "unbranded-exports",
          granted: "true",
        })
      ).status,
    ).toBe(303);
    expect(JSON.parse(f.calls.at(-1)!.body)).toEqual({ granted: true });
    f.intercept((request) =>
      request.method === "PUT"
        ? json({
            ...account,
            permission: { id: "unbranded-exports", granted: false, by: null, at: null },
          })
        : undefined,
    );
    const mismatch = await f.post("permissions", {
      action: "permission",
      account: account.sub,
      permission: "unbranded-exports",
      granted: "true",
    });
    expect(mismatch.status).toBe(503);
    expect(mismatch.headers.has("Location")).toBe(false);
  });

  it("translates ambiguous lookup without exposing upstream response contents", async () => {
    const f = await adminFixture();
    f.intercept((request) =>
      new URL(request.url).pathname === "/account-permission"
        ? json({ code: "account.ambiguous", message: "private upstream details" }, 409)
        : undefined,
    );
    const result = await f.post("permissions", {
      action: "lookup",
      account: "person@example.com",
      permission: "unbranded-exports",
    });
    expect(result.status).toBe(409);
    const html = await result.text();
    expect(html).toContain("Ask the person for their account ID");
    expect(html).not.toContain("private upstream details");
  });

  it("shows real bounded sponsorship and activity records, safely escaped", async () => {
    const f = await adminFixture();
    const sponsors = await (await f.read("sponsorships")).text();
    expect(sponsors).toContain("latest 50 sponsorship");
    expect(sponsors).toContain("$12.34");
    expect(sponsors).toContain("Organization");
    expect(sponsors).toContain("Cancelling a sponsorship keeps");
    expect(sponsors).toContain("A GitHub login is not a Meltemi handle");
    const activity = await (await f.read("activity")).text();
    expect(activity).toContain("latest 50 recorded");
    expect(activity).toContain("365 days");
    expect(activity).toContain("&lt;img src=x onerror=bad()&gt;");
    expect(activity).not.toContain("<img src=x");
  });

  it("requires confirmed same-host publication removal and preserves the reason", async () => {
    const f = await adminFixture();
    const bad = await f.post("publications", {
      action: "takedown",
      publication: "https://evil.example/person/page/",
      reason: "",
      confirm: "yes",
    });
    expect(bad.status).toBe(400);
    expect(f.calls.some((c) => c.request.method === "DELETE")).toBe(false);
    const good = await f.post("publications", {
      action: "takedown",
      publication: "https://meltemi.page/person/page/",
      reason: "Policy\nreview",
      confirm: "yes",
    });
    expect(good.status).toBe(303);
    expect(f.calls.at(-1)!.request.url).toBe(
      "https://diagrams.meltemi.dev/api/admin/publications/person/page",
    );
    expect(JSON.parse(f.calls.at(-1)!.body)).toEqual({ reason: "Policy\nreview" });
  });

  it("keeps owner overview and Docs controls available during product failure", async () => {
    const f = await adminFixture();
    f.intercept(() => {
      throw new Error("unavailable");
    });
    const overview = await f.read("/admin/");
    expect(overview.status).toBe(200);
    const html = await overview.text();
    expect(html).toContain("Diagrams could not be reached");
    expect(html).toContain("Answers enabled");
    expect(html).toContain('href="/admin/docs-ai?lang=en"');
    const product = await f.read("access");
    expect(product.status).toBe(503);
    expect(await product.text()).not.toContain("No records to show");
  });

  it("does not turn malformed product data into empty successful lists", async () => {
    const f = await adminFixture();
    f.intercept((request) =>
      new URL(request.url).pathname === "/api/admin"
        ? json({ ...adminView(), sponsorships: [{ login: "partial" }] })
        : undefined,
    );
    const response = await f.read("sponsorships");
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Diagrams could not be reached");
  });

  it("bounds stalled private response bodies as well as stalled fetches", async () => {
    const f = await adminFixture();
    const request = new Request(`${f.h.env.ISSUER}/admin/`, {
      headers: { Cookie: f.person.cookie },
    });
    const ctx = {
      request,
      url: new URL(request.url),
      env: f.h.env,
      deps: f.h.deps,
      config: readConfig(f.h.env),
      lang: "en" as const,
      params: {},
    };
    const current = (await currentSession(ctx))!;
    let cancelled = false;
    f.intercept(
      () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.useFakeTimers();
    const pending = productContext(ctx, current);
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await pending).toEqual({ ok: false, status: 503, code: "product.unavailable" });
    expect(cancelled).toBe(true);
  });
});

describe("strict product data and targets", () => {
  it("rejects unknown context fields, partial collections and non-boolean grants", () => {
    expect(() =>
      parseProductContext({ role: "owner", invitation: null, cookie: "secret" }),
    ).toThrow();
    expect(() => parseProductContext({ role: "invitee", invitation: null })).toThrow();
    expect(() => parseAdminView({ ...adminView(), permissions: undefined })).toThrow();
    expect(() => parseAdminView({ ...adminView(), owners: [{ sub: "x" }] })).toThrow();
    expect(() =>
      parseAdminView({
        ...adminView(),
        sponsorships: [{ ...adminView().sponsorships[0], amountCents: NaN }],
      }),
    ).toThrow();
  });
  it("rejects traversal and off-host publication URLs", () => {
    for (const target of ["..", "../../api", "a/b", "person?role=owner", "x\nheader"])
      expect(validAccount(target)).toBe(false);
    expect(publicationAt("https://meltemi.page/person/page/", "meltemi.page")).toEqual({
      handle: "person",
      slug: "page",
    });
    for (const target of [
      "http://meltemi.page/person/page",
      "https://meltemi.page.evil/person/page",
      "https://person@meltemi.page/person/page",
      "https://meltemi.page/person/page?x=1",
      "https://meltemi.page/person/page#x",
    ])
      expect(publicationAt(target, "meltemi.page")).toBeUndefined();
  });
});
