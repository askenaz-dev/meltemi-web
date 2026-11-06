import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";
import type { Ctx } from "../src/context.js";
import { applyAppPreferences, renderAppPage } from "../src/pages/app.js";
import { IDENTITY_CSS, IDENTITY_CSS_REVISION } from "../src/pages/css.js";
import { renderPage } from "../src/pages/layout.js";
import { DEFAULT_ACCOUNT_PREFERENCES } from "../src/preferences.js";
import { harness, signedInPerson } from "./support/index.js";

async function fixture(query = "") {
  const h = await harness();
  const person = await signedInPerson(h);
  const request = new Request(`${h.env.ISSUER}/account${query}`);
  const ctx: Ctx = {
    request,
    url: new URL(request.url),
    env: h.env,
    deps: h.deps,
    config: readConfig(h.env),
    lang: "en",
    params: {},
  };
  return { h, person, ctx };
}

describe("the application shell", () => {
  it("keeps ordinary account access independent of administrative privilege", async () => {
    const { person, ctx } = await fixture();
    const response = renderAppPage(ctx, {
      title: "Profile",
      body: "<p>Account content</p>",
      user: person.user,
      owner: false,
      active: "profile",
    });
    const html = await response.text();
    expect(html).toContain('<main class="app-main" id="main" tabindex="-1">');
    expect(html).toContain('<details class="app-account">');
    expect(html).toContain('href="/account/preferences?lang=en"');
    expect(html).toContain('href="/logout?lang=en"');
    expect(html).not.toContain('href="/admin/');
    expect(html).not.toMatch(/<form|<script|<style|style=/);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Security-Policy")).toContain("style-src 'self'");
  });

  it("shows product role navigation without the owner-only documentation control", async () => {
    const { person, ctx } = await fixture();
    const html = await renderAppPage(ctx, {
      title: "Access",
      body: "",
      user: person.user,
      owner: false,
      productRole: "admin",
      active: "access",
    }).text();
    expect(html).toContain(
      'href="/admin/diagrams/access?lang=en&amp;environment=production" aria-current="page"',
    );
    expect(html).toContain(
      'href="/admin/diagrams/publications?lang=en&amp;environment=production"',
    );
    expect(html).not.toContain('href="/admin/docs-ai');
  });

  it("offers only access acceptance to a product invitee", async () => {
    const { person, ctx } = await fixture();
    const html = await renderAppPage(ctx, {
      title: "Access",
      body: "",
      user: person.user,
      owner: false,
      productRole: "invitee",
      active: "access",
    }).text();
    expect(html).toContain('href="/admin/diagrams/access?lang=en&amp;environment=production"');
    expect(html).not.toContain('href="/admin/diagrams/permissions');
  });

  it("applies stored language/theme and escapes the personal account label", async () => {
    const { person, ctx } = await fixture();
    const preferences = {
      displayName: '<img src=x onerror="bad()">',
      language: "es" as const,
      theme: "dark" as const,
    };
    const html = await renderAppPage(ctx, {
      title: "Preferencias",
      body: "",
      user: person.user,
      owner: true,
      active: "preferences",
      preferences,
    }).text();
    expect(html).toContain('<html lang="es" data-theme="dark">');
    expect(html).toContain("&lt;img src=x onerror=&quot;bad()&quot;&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain('href="https://meltemi.dev/es/privacy/"');
    expect(html).toContain('href="/admin/docs-ai?lang=es"');
    const explicit = await fixture("?lang=en");
    expect(applyAppPreferences(explicit.ctx, preferences).lang).toBe("en");
    expect(applyAppPreferences({ ...ctx, lang: "es" }, DEFAULT_ACCOUNT_PREFERENCES).lang).toBe(
      "es",
    );
  });

  it("preserves status and cookies while retaining all security headers", async () => {
    const { person, ctx } = await fixture();
    const response = renderAppPage(ctx, {
      title: "Unavailable",
      body: "",
      user: person.user,
      owner: true,
      active: "overview",
      status: 503,
      setCookies: ["first=x", "second=y"],
    });
    expect(response.status).toBe(503);
    expect(response.headers.getSetCookie()).toEqual(["first=x", "second=y"]);
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("retains the compact authentication layout", async () => {
    const { ctx } = await fixture();
    const html = await renderPage(ctx, { title: "Sign in", body: "<p>Sign in</p>" }).text();
    expect(html).toContain('<main class="card">');
    expect(html).not.toContain('class="app-shell"');
    expect(IDENTITY_CSS).toContain("width: min(520px, 100%)");
  });

  it("requests versioned application CSS so old cached authentication styles cannot break a rollout", async () => {
    const { h, ctx, person } = await fixture();
    const html = await renderAppPage(ctx, {
      title: "Admin",
      body: "",
      user: person.user,
      owner: true,
      active: "overview",
    }).text();
    const address = `/identity.css?v=${IDENTITY_CSS_REVISION}`;
    expect(html).toContain(`href="${address}"`);
    const response = await h.request(address);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('.app-environment-options a[aria-current="true"]');
  });

  it("keeps canonical brand geometry and tokens, with explicit themes and keyboard focus", async () => {
    const { person, ctx } = await fixture();
    const html = await renderAppPage(ctx, {
      title: "Admin",
      body: "",
      user: person.user,
      owner: true,
      active: "overview",
    }).text();
    const brand = readFileSync(
      new URL("../../site/public/media/meltemi-mark-gradient.svg", import.meta.url),
      "utf8",
    );
    const paths = (source: string) =>
      [...source.matchAll(/<path\s[^>]*\bd="([^"]+)"/g)].map((m) => m[1]);
    expect(paths(html)).toEqual(paths(brand));
    const tokens = (source: string) => {
      const map = new Map<string, Set<string>>();
      for (const match of source.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/g)) {
        const set = map.get(match[1]!) ?? new Set();
        set.add(match[2]!.trim());
        map.set(match[1]!, set);
      }
      return map;
    };
    const site = readFileSync(new URL("../../site/public/tokens.css", import.meta.url), "utf8");
    expect(tokens(IDENTITY_CSS)).toEqual(tokens(site));
    expect(IDENTITY_CSS).toContain(':root[data-theme="light"]');
    expect(IDENTITY_CSS).toContain(':root[data-theme="dark"]');
    expect(IDENTITY_CSS).toContain("summary, [tabindex]");
    expect(IDENTITY_CSS).toContain("prefers-reduced-motion");
    expect(html).toContain('href="#main"');
  });
});
