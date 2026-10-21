// What every state-changing request of the account page goes through: the session, the `Origin`
// of the request and the `csrf` token the page's forms carry (`identity-account`, "Form protection").

import type { Config } from "./config.js";
import type { Ctx } from "./context.js";
import { hmacHex, verifyHmacHex } from "./crypto.js";
import { originOf, redirect } from "./http.js";
import { messages } from "./messages/index.js";
import { errorPage, type PageAction } from "./pages/layout.js";
import { currentSession, type CurrentSession } from "./session.js";

/**
 * The token the account page's forms carry: the hex HMAC-SHA256 of the session id with
 * `STATE_SECRET`. It belongs to one session, so a token from another session never verifies.
 */
export async function csrfToken(ctx: Pick<Ctx, "env">, sid: string): Promise<string> {
  return hmacHex(ctx.env.STATE_SECRET, sid);
}

/** `/account`, keeping the language a person chose with `?lang=`. */
export function accountPath(ctx: Pick<Ctx, "url">): string {
  const asked = ctx.url.searchParams.get("lang");
  return asked === "en" || asked === "es" ? `/account?lang=${asked}` : "/account";
}

/** Where a person without a session goes: the chooser, returning to the account page. */
export function signInRedirect(config: Config): Response {
  return redirect(`/login?return_to=${encodeURIComponent(`${config.issuer}/account`)}`);
}

/** The fields of a form post, or undefined when the body is not a form (never an exception). */
export async function readForm(request: Request): Promise<FormData | undefined> {
  try {
    return await request.formData();
  } catch {
    return undefined;
  }
}

/** The 403 page of a request the service refuses to act on, with a way forward. */
export function forbiddenPage(ctx: Ctx, back: PageAction): Response {
  const m = messages(ctx.lang).common;
  return errorPage(ctx, {
    code: "request.forbidden",
    status: 403,
    title: m.requestForbiddenTitle,
    message: m.requestForbiddenBody,
    actions: [back],
  });
}

function backToAccount(ctx: Ctx): PageAction {
  return { href: accountPath(ctx), label: messages(ctx.lang).account.backToAccount, primary: true };
}

/**
 * The 403 page unless the request is the account page's own form: its `Origin` is the origin of
 * the issuer (the service itself, not any other family host) and its `csrf` field verifies, in
 * constant time, against the current session. Undefined when both hold.
 */
export async function checkAccountForm(
  ctx: Ctx,
  current: CurrentSession,
  form: FormData,
): Promise<Response | undefined> {
  const sent = form.get("csrf");
  const tokenHolds =
    typeof sent === "string" &&
    (await verifyHmacHex(ctx.env.STATE_SECRET, current.session.sid, sent));
  const originHolds = originOf(ctx.request) === new URL(ctx.config.issuer).origin;
  return tokenHolds && originHolds ? undefined : forbiddenPage(ctx, backToAccount(ctx));
}

export type AccountAction =
  { readonly current: CurrentSession; readonly form: FormData } | { readonly response: Response };

/**
 * The start of every `POST /account/*`, in this order: the session (a person without one goes to
 * the chooser and nothing changes), then the form and its `Origin` and `csrf` (403), and only then
 * does the caller act.
 */
export async function accountAction(ctx: Ctx): Promise<AccountAction> {
  const current = await currentSession(ctx);
  if (!current) return { response: signInRedirect(ctx.config) };
  const form = await readForm(ctx.request);
  if (!form) return { response: forbiddenPage(ctx, backToAccount(ctx)) };
  const refused = await checkAccountForm(ctx, current, form);
  return refused ? { response: refused } : { current, form };
}
