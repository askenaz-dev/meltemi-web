import type { Config } from "../config.js";
import type { Ctx } from "../context.js";
import { messages } from "../messages/index.js";
import type { Lang } from "../types.js";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes a value for HTML text and for double- or single-quoted attributes. Use it on every value. */
export function esc(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/**
 * The Content-Security-Policy of every page. `form-action` names the family's hosts because
 * Chromium applies it to the redirect that follows a form post, and `POST /logout` redirects to a
 * product; in development it also lists the origins of `DEV_ORIGINS`.
 */
export function policy(config: Config): string {
  const family = [`https://${config.cookieDomain}`, `https://*.${config.cookieDomain}`];
  const formAction = ["'self'", ...family, ...config.devOrigins].join(" ");
  return [
    "default-src 'none'",
    "style-src 'self'",
    "img-src 'self' https://avatars.githubusercontent.com https://*.googleusercontent.com",
    `form-action ${formAction}`,
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** The addresses of the legal pages, which the site hosts, in the language of the page. */
export function legalLinks(config: Config, lang: Lang): { privacy: string; terms: string } {
  const base = lang === "es" ? `${config.siteUrl}/es` : config.siteUrl;
  return { privacy: `${base}/privacy/`, terms: `${base}/terms/` };
}

export interface PageOptions {
  readonly title: string;
  /** Trusted HTML: every value inside it went through `esc`. */
  readonly body: string;
  readonly status?: number;
  /** The page shows personal data: it is never cached. */
  readonly personal?: boolean;
  readonly setCookies?: readonly string[];
}

/** An HTML page with the policy headers every page carries. */
export function renderPage(ctx: Ctx, options: PageOptions): Response {
  const m = messages(ctx.lang).common;
  const legal = legalLinks(ctx.config, ctx.lang);
  const html = `<!doctype html>
<html lang="${ctx.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(options.title)} · ${esc(m.brand)}</title>
<link rel="stylesheet" href="/identity.css">
</head>
<body>
<main class="card">
<p class="brand">${esc(m.brand)}</p>
${options.body}
</main>
<footer class="legal"><a href="${esc(legal.privacy)}">${esc(m.privacy)}</a> · <a href="${esc(legal.terms)}">${esc(m.terms)}</a></footer>
</body>
</html>
`;
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": policy(ctx.config),
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  });
  if (options.personal) headers.set("Cache-Control", "no-store");
  for (const cookie of options.setCookies ?? []) headers.append("Set-Cookie", cookie);
  return new Response(html, { status: options.status ?? 200, headers });
}

export interface PageAction {
  readonly href: string;
  readonly label: string;
  readonly primary?: boolean;
}

/** A page that says what went wrong, shows its stable code and offers where to go next. */
export function errorPage(
  ctx: Ctx,
  options: {
    readonly code: string;
    readonly status: number;
    readonly title: string;
    readonly message: string;
    readonly actions?: readonly PageAction[];
    readonly setCookies?: readonly string[];
  },
): Response {
  const m = messages(ctx.lang).common;
  const actions = (options.actions ?? [])
    .map(
      (a) =>
        `<a class="btn${a.primary ? " primary" : ""}" href="${esc(a.href)}">${esc(a.label)}</a>`,
    )
    .join("\n");
  const body = `<h1>${esc(options.title)}</h1>
<p>${esc(options.message)}</p>
<p class="code">${esc(m.codeLabel)}: <code>${esc(options.code)}</code></p>
${actions ? `<p class="actions">${actions}</p>` : ""}`;
  return renderPage(ctx, {
    title: options.title,
    body,
    status: options.status,
    ...(options.setCookies ? { setCookies: options.setCookies } : {}),
  });
}

/** The page of a request that cannot be used (`400`, `403`, `404`, `500`…) with the common words. */
export function simpleError(
  ctx: Ctx,
  status: number,
  code: string,
  title: string,
  message: string,
): Response {
  return errorPage(ctx, { code, status, title, message });
}
