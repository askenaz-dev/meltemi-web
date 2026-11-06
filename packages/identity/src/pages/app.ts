import type { Ctx } from "../context.js";
import { administrationMessages } from "../messages/administration.js";
import type { AccountPreferences } from "../preferences.js";
import { appPath, productEnvironment } from "../product-admin.js";
import type { User } from "../types.js";
import { esc, legalLinks, policy } from "./layout.js";
import { IDENTITY_CSS_REVISION } from "./css.js";

export type ProductRole = "owner" | "admin" | "invitee" | "none";

export interface AppPageOptions {
  readonly title: string;
  /** Trusted HTML; escape every value before adding it. */
  readonly body: string;
  readonly user: User;
  readonly owner: boolean;
  readonly active: string;
  readonly preferences?: AccountPreferences;
  readonly productRole?: ProductRole;
  readonly returnTo?: string;
  readonly status?: number;
  readonly setCookies?: readonly string[];
}

/** Explicit page language wins, then the saved preference, then the browser-resolved language. */
export function applyAppPreferences(ctx: Ctx, preferences: AccountPreferences): Ctx {
  const explicit = ctx.url.searchParams.get("lang");
  const lang =
    explicit === "en" || explicit === "es"
      ? explicit
      : preferences.language === "system"
        ? ctx.lang
        : preferences.language;
  return { ...ctx, lang };
}

/** Canonical family geometry from site/public/media/meltemi-mark-gradient.svg. */
const MARK = `<svg class="app-mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="36" height="36" aria-hidden="true" focusable="false">
<defs><linearGradient id="app-mark-gradient" x1="38" y1="222" x2="219" y2="54" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2563EB"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs>
<path d="M43 178C43 125 57 100 78 100C99 100 109 127 109 176C109 105 132 67 158 67C185 67 199 97 196 132C194 154 185 169 172 177C189 176 205 166 217 152C224 144 230 133 234 122" fill="none" stroke="url(#app-mark-gradient)" stroke-width="25" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M45 199C87 211 145 215 202 189C195 204 177 216 151 220C106 226 67 215 45 199Z" fill="url(#app-mark-gradient)"/>
</svg>`;

/** Full application surface, independent of the compact authentication/confirmation renderer. */
export function renderAppPage(ctx: Ctx, options: AppPageOptions): Response {
  const local = options.preferences ? applyAppPreferences(ctx, options.preferences) : ctx;
  const m = administrationMessages(local.lang);
  const legal = legalLinks(local.config, local.lang);
  const at = (path: string) => appPath(local, path);
  const name = options.preferences?.displayName ?? options.user.name;
  const initial = Array.from(name.trim())[0]?.toLocaleUpperCase(local.lang) ?? "M";
  const role = options.productRole ?? "none";
  const administrative = options.owner || role !== "none";
  const environment = productEnvironment(local);
  const environmentName = environment === undefined ? m.invalidEnvironment : m[environment];
  const selectorPath =
    local.url.pathname === "/admin/" || local.url.pathname.startsWith("/admin/diagrams/")
      ? local.url.pathname
      : "/admin/";
  const environmentLinks = administrative
    ? `<div class="app-nav-group app-environments"><p>${esc(m.environment)}</p><div class="app-environment-options">${(["production", "staging"] as const).map((value) => `<a href="${esc(appPath(local, selectorPath, value))}"${environment === value ? ' aria-current="true"' : ""}>${esc(m[value])}</a>`).join("")}</div></div>`
    : "";
  const link = (path: string, label: string, active: string): string =>
    `<a href="${esc(at(path))}"${options.active === active ? ' aria-current="page"' : ""}>${esc(label)}</a>`;
  const personal = `${link("/account/profile", m.profile, "profile")}${link("/account/preferences", m.preferences, "preferences")}${link("/account", m.security, "account")}`;
  const productLinks =
    role === "invitee"
      ? link("/admin/diagrams/access", m.access, "access")
      : ["access", "permissions", "sponsorships", "publications", "activity"]
          .map((key) =>
            link(
              `/admin/diagrams/${key}`,
              m[key as "access" | "permissions" | "sponsorships" | "publications" | "activity"],
              key,
            ),
          )
          .join("");
  const navigation = `${administrative ? `<div class="app-nav-group"><p>${esc(m.services)}</p>${link("/admin/", m.overview, "overview")}${options.owner ? link("/admin/docs-ai", m.docsAi, "docs-ai") : ""}</div>` : ""}
${environmentLinks}${options.owner || role !== "none" ? `<div class="app-nav-group"><p>${esc(m.diagrams)} · ${esc(environmentName)}</p>${productLinks}</div>` : ""}
<div class="app-nav-group"><p>${esc(m.account)}</p>${personal}</div>`;
  const theme = options.preferences?.theme ?? "system";
  const html = `<!doctype html>
<html lang="${local.lang}" data-theme="${esc(theme)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">
<title>${esc(options.title)} · ${esc(m.brand)}</title><link rel="stylesheet" href="/identity.css?v=${IDENTITY_CSS_REVISION}"></head>
<body class="app-body">
<a class="app-skip" href="#main">${esc(m.skip)}</a>
<div class="app-shell">
<header class="app-header">
<a class="app-brand" href="${esc(at(administrative ? "/admin/" : "/account"))}">${MARK}<span>${esc(m.brand)}</span></a>
<span class="app-context">${esc(administrative ? m.workspace : m.account)}</span>
<details class="app-account"><summary aria-label="${esc(m.accountMenu)}"><span class="app-avatar" aria-hidden="true">${esc(initial)}</span><span class="app-account-name">${esc(name)}</span><span class="app-chevron" aria-hidden="true">⌄</span></summary>
<nav class="app-account-links" aria-label="${esc(m.accountMenu)}"><span class="app-menu-name">${esc(name)}</span>${personal}${administrative ? link("/admin/", m.workspace, "overview") : ""}<a href="${esc(at("/logout"))}">${esc(m.signOut)}</a></nav></details>
</header>
<aside class="app-sidebar"><nav class="app-desktop-nav" aria-label="${esc(m.navigation)}">${navigation}</nav>
<details class="app-mobile-nav"><summary>${esc(m.navigation)}</summary><nav aria-label="${esc(m.navigation)}">${navigation}</nav></details>
<footer class="app-legal"><a href="${esc(legal.privacy)}">${esc(m.privacy)}</a><a href="${esc(legal.terms)}">${esc(m.terms)}</a></footer></aside>
<main class="app-main" id="main" tabindex="-1">${options.returnTo ? `<p class="back"><a href="${esc(options.returnTo)}">${esc(m.back)}</a></p>` : ""}<header class="app-page-header"><h1>${esc(options.title)}</h1>${options.active === "overview" || local.url.pathname.startsWith("/admin/diagrams/") ? `<p class="app-environment-label">${esc(m.diagrams)} · ${esc(environmentName)}</p>` : options.active === "docs-ai" ? `<p class="app-environment-label">${esc(m.global)} · ${esc(m.globalNotice)}</p>` : ""}</header>${options.body}</main>
</div></body></html>`;
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": policy(local.config),
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
  for (const cookie of options.setCookies ?? []) headers.append("Set-Cookie", cookie);
  return new Response(html, { status: options.status ?? 200, headers });
}
