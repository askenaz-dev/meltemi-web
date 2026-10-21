// Helpers for the tests of the account routes: more sessions for a person, form posts that carry
// the `Origin` and `csrf` a browser would, and a reader for the forms of a page.

import { readConfig } from "../../src/config.js";
import type { Ctx } from "../../src/context.js";
import { csrfToken } from "../../src/forms.js";
import { resolveLang } from "../../src/messages/index.js";
import { startSession } from "../../src/session.js";
import type { Session } from "../../src/types.js";
import type { Harness, SeededPerson } from "./index.js";

export const EDGE_ON_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
export const FIREFOX_ON_ANDROID =
  "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0";
export const SAFARI_ON_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/** The development environment: the service on localhost, the product and the site beside it. */
export const DEV_ENV = {
  DEV: "true",
  ISSUER: "http://localhost:8787",
  SITE_URL: "http://localhost:8789",
  DEV_ORIGINS: "http://localhost:8788,http://localhost:8789",
} as const;

export interface AnotherSession {
  readonly session: Session;
  readonly cookie: string;
  readonly token: string;
}

/** Another device of a person who is already signed in: a second live session of the same user. */
export async function anotherSession(
  h: Harness,
  person: SeededPerson,
  userAgent = EDGE_ON_WINDOWS,
): Promise<AnotherSession> {
  const started = await startSession(
    {
      deps: h.deps,
      config: readConfig(h.env),
      request: new Request(h.env.ISSUER, { headers: { "User-Agent": userAgent } }),
    },
    person.user,
    person.identity,
  );
  return {
    session: started.session,
    cookie: `meltemi_session=${started.token}`,
    token: started.token,
  };
}

/** The `csrf` field the page would give a session. */
export function csrfOf(h: Harness, sid: string): Promise<string> {
  return csrfToken(h, sid);
}

export interface FormPostOptions {
  /** Whose session signs the request, and whose `csrf` it carries unless `csrf` says otherwise. */
  readonly as?: { readonly cookie: string; readonly session: { readonly sid: string } };
  /** A `Cookie` header that replaces the one of `as`. */
  readonly cookie?: string;
  /** The `Origin` header: the issuer's own by default, `null` for none. */
  readonly origin?: string | null;
  /** The `csrf` field: the token of `as` by default, `null` for none. */
  readonly csrf?: string | null;
  readonly fields?: Readonly<Record<string, string>>;
  /** Appended to the path as it is, for example `?lang=es`. */
  readonly query?: string;
}

/** A `POST` of a form, the way the account page's forms send it. */
export async function formPost(
  h: Harness,
  path: string,
  options: FormPostOptions = {},
): Promise<Response> {
  const origin = options.origin === undefined ? new URL(h.env.ISSUER).origin : options.origin;
  const csrf =
    options.csrf !== undefined
      ? options.csrf
      : options.as
        ? await csrfOf(h, options.as.session.sid)
        : null;
  const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
  const cookie = options.cookie ?? options.as?.cookie;
  if (cookie) headers.set("Cookie", cookie);
  if (origin !== null) headers.set("Origin", origin);
  const body = new URLSearchParams({
    ...(csrf !== null ? { csrf } : {}),
    ...options.fields,
  });
  return h.request(`${path}${options.query ?? ""}`, {
    method: "POST",
    headers,
    body: body.toString(),
  });
}

/** What the tests need to know about a `<form>` of a page. */
export interface ParsedForm {
  readonly action: string;
  readonly method: string;
  readonly fields: Record<string, string>;
  readonly button: string;
}

export function unescapeHtml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** The forms of an HTML page with their action, method, hidden fields and button text. */
export function formsOf(html: string): ParsedForm[] {
  const forms: ParsedForm[] = [];
  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)) {
    const attributes = match[1] ?? "";
    const inner = match[2] ?? "";
    const fields: Record<string, string> = {};
    for (const input of inner.matchAll(/<input type="hidden" name="([^"]*)" value="([^"]*)">/g)) {
      fields[unescapeHtml(input[1] ?? "")] = unescapeHtml(input[2] ?? "");
    }
    forms.push({
      action: unescapeHtml(/action="([^"]*)"/.exec(attributes)?.[1] ?? ""),
      method: /method="([^"]*)"/.exec(attributes)?.[1] ?? "get",
      fields,
      button: unescapeHtml(/<button[^>]*>([\s\S]*?)<\/button>/.exec(inner)?.[1] ?? ""),
    });
  }
  return forms;
}

/** Submits a form of a page as the browser would: its fields, the signed-in cookie, the Origin. */
export function submitForm(
  h: Harness,
  form: ParsedForm,
  options: { cookie: string; origin?: string; extra?: Readonly<Record<string, string>> },
): Promise<Response> {
  const body = new URLSearchParams({ ...form.fields, ...options.extra });
  return h.request(form.action, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: options.cookie,
      Origin: options.origin ?? new URL(h.env.ISSUER).origin,
    },
    body: body.toString(),
  });
}

/** A context for calling the helpers of a route directly, as the handler would build it. */
export function ctxOf(h: Harness, request: Request): Ctx {
  const url = new URL(request.url);
  return {
    request,
    url,
    env: h.env,
    deps: h.deps,
    config: readConfig(h.env),
    lang: resolveLang(url, request.headers.get("Accept-Language")),
    params: {},
  };
}
