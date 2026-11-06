import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";
import { csrfToken } from "../src/forms.js";
import { productContext, productEnvironment, workspacePath } from "../src/product-admin.js";
import { currentSession } from "../src/session.js";
import { adminView, json } from "./admin-support.js";
import { harness, signedInPerson } from "./support/index.js";

async function fixture(
  options: {
    staging?: boolean;
    familyOwner?: boolean;
    stagingRole?: "owner" | "admin" | "none";
  } = {},
) {
  const calls = { production: [] as Request[], staging: [] as Request[] };
  const changes = { production: false, staging: false };
  const service = (environment: "production" | "staging") => ({
    fetch: async (request: Request) => {
      calls[environment].push(request);
      const path = new URL(request.url).pathname;
      const role = environment === "staging" ? (options.stagingRole ?? "owner") : "owner";
      if (path === "/context") return json({ role, invitation: null });
      if (role === "none") return json({ code: "not-found" }, 404);
      if (path === "/api/admin")
        return json({
          ...adminView(role === "admin" ? "administrator" : "owner"),
          owners: [
            {
              sub: "owner-1",
              name: `${environment}-only owner`,
              handle: "owner",
              email: `${environment}@example.com`,
            },
          ],
          permissions: [{ id: "unbranded-exports", holders: [] }],
        });
      const account = {
        sub: `${environment}-account`,
        name: `${environment}-only account`,
        email: `${environment}-account@example.com`,
        handle: "account",
      };
      if (path === "/account-permission")
        return json({
          ...account,
          permission: {
            id: "unbranded-exports",
            granted: changes[environment],
            by: null,
            at: null,
          },
        });
      if (request.method === "PUT") {
        changes[environment] = ((await request.json()) as { granted: boolean }).granted;
        return json({
          ...account,
          permission: {
            id: "unbranded-exports",
            granted: changes[environment],
            by: "owner-1",
            at: "2026-10-14T12:00:00.000Z",
          },
        });
      }
      return new Response(null, { status: 204 });
    },
  });
  const h = await harness({
    env: {
      ADMIN_SUBS: options.familyOwner === false ? "" : "owner-1",
      DIAGRAMS_ADMIN: service("production"),
      ...(options.staging === false ? {} : { DIAGRAMS_ADMIN_STAGING: service("staging") }),
    },
  });
  const person = await signedInPerson(h, { id: "owner-1" });
  const csrf = await csrfToken({ env: h.env }, person.session.sid);
  const read = (path: string) => h.request(path, { headers: { Cookie: person.cookie } });
  const post = (path: string, fields: Record<string, string>) =>
    h.request(path, {
      method: "POST",
      headers: {
        Cookie: person.cookie,
        Origin: h.env.ISSUER,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrf, ...fields }),
    });
  return { h, person, calls, changes, read, post };
}

describe("explicit isolated Diagrams environments", () => {
  it("defaults to production and preserves an explicit staging choice through navigation and forms", async () => {
    const f = await fixture();
    expect(await (await f.read("/admin/diagrams/access?lang=en")).text()).toContain(
      "production-only owner",
    );
    f.calls.production.length = 0;
    const response = await f.read("/admin/diagrams/access?lang=es&environment=staging");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("staging-only owner");
    expect(html).not.toContain("production-only owner");
    expect(html).toContain("Diagrams · Staging");
    expect(html).toContain('action="/admin/diagrams/access?lang=es&amp;environment=staging"');
    expect(html).toContain('href="/account/profile?lang=es&amp;environment=staging"');
    expect(html).toContain('href="/admin/diagrams/permissions?lang=es&amp;environment=staging"');
    expect(html).toContain('href="/admin/diagrams/access?lang=es&amp;environment=production"');
    expect(f.calls.production).toHaveLength(0);
    expect(f.calls.staging.map((r) => new URL(r.url).origin)).toEqual([
      "https://staging.diagrams.meltemi.dev",
      "https://staging.diagrams.meltemi.dev",
    ]);
  });

  it("looks up and mutates only staging records and retains selection on the success redirect", async () => {
    const f = await fixture();
    const selected = await f.post("/admin/diagrams/permissions?lang=en&environment=staging", {
      action: "lookup",
      account: "person@example.com",
      permission: "unbranded-exports",
    });
    expect(selected.status).toBe(200);
    expect(await selected.text()).toContain("staging-only account");
    expect(f.calls.staging.at(-1)!.url).toBe(
      "https://staging.diagrams.meltemi.dev/account-permission",
    );
    const saved = await f.post("/admin/diagrams/permissions?lang=en&environment=staging", {
      action: "permission",
      account: "staging-account",
      permission: "unbranded-exports",
      granted: "true",
    });
    expect(saved.status).toBe(303);
    expect(saved.headers.get("Location")).toBe(
      "/admin/diagrams/permissions?lang=en&environment=staging&saved=1",
    );
    expect(f.changes).toEqual({ production: false, staging: true });
    expect(f.calls.production).toHaveLength(0);
    expect(
      f.calls.staging.every(
        (r) =>
          new URL(r.url).origin === "https://staging.diagrams.meltemi.dev" &&
          !r.headers.has("Cookie"),
      ),
    ).toBe(true);
  });

  it("does not borrow a production role when staging denies access", async () => {
    const f = await fixture({ stagingRole: "none", familyOwner: false });
    expect((await f.read("/admin/diagrams/access?environment=production")).status).toBe(200);
    f.calls.production.length = 0;
    const denied = await f.read("/admin/diagrams/access?environment=staging");
    expect(denied.status).toBe(404);
    expect(await denied.text()).not.toContain("production-only owner");
    expect(f.calls.production).toHaveLength(0);
    expect(f.calls.staging).toHaveLength(1);
  });

  it("fails closed if the staging capability is absent, while the shared Docs control remains usable", async () => {
    const f = await fixture({ staging: false });
    const response = await f.read("/admin/diagrams/permissions?environment=staging");
    expect(response.status).toBe(503);
    const overview = await f.read("/admin/?environment=staging&lang=en");
    expect(overview.status).toBe(200);
    const html = await overview.text();
    expect(html).toContain("Diagrams · Staging");
    expect(html).toContain("Global");
    expect(html).toContain("production and staging");
    expect(f.calls.production).toHaveLength(0);
    expect(f.calls.staging).toHaveLength(0);
  });

  it.each([
    "environment=unknown",
    "environment=",
    "environment=STAGING",
    "environment=production&environment=staging",
    "environment=staging&environment=staging",
  ])("rejects %s without any product call or mutation", async (query) => {
    const f = await fixture();
    const get = await f.read(`/admin/diagrams/access?${query}`);
    expect([400, 404]).toContain(get.status);
    const post = await f.post(`/admin/diagrams/permissions?${query}`, {
      action: "permission",
      account: "production-account",
      permission: "unbranded-exports",
      granted: "true",
    });
    expect([400, 404]).toContain(post.status);
    expect(f.calls.production).toHaveLength(0);
    expect(f.calls.staging).toHaveLength(0);
    expect(f.changes).toEqual({ production: false, staging: false });
  });

  it("rejects invalid context defensively in the private client too", async () => {
    const f = await fixture();
    const request = new Request(`${f.h.env.ISSUER}/admin/?environment=evil`, {
      headers: { Cookie: f.person.cookie },
    });
    const ctx = {
      request,
      url: new URL(request.url),
      lang: "en" as const,
      env: f.h.env,
      config: readConfig(f.h.env),
      deps: f.h.deps,
      params: {},
    };
    const current = (await currentSession(ctx))!;
    expect(await productContext(ctx, current)).toEqual({
      ok: false,
      status: 400,
      code: "request.invalid",
    });
    expect(productEnvironment(ctx)).toBeUndefined();
    expect(f.calls.production).toHaveLength(0);
    expect(f.calls.staging).toHaveLength(0);
    const valid = { ...ctx, url: new URL(`${f.h.env.ISSUER}/account?environment=staging`) };
    expect(workspacePath(valid, "/account/preferences")).toBe(
      "/account/preferences?lang=en&environment=staging",
    );
  });
});
