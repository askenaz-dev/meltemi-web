import type { Ctx, Route } from "../context.js";
import { forbiddenPage, readForm } from "../forms.js";
import { originOf, redirect } from "../http.js";
import { messages } from "../messages/index.js";
import { logoutConfirmPage } from "../pages/account.js";
import { errorPage } from "../pages/layout.js";
import { isFamilyOrigin, resolveReturnTo } from "../return-to.js";
import { clearSessionCookie, currentSession } from "../session.js";

function toTheSite(ctx: Ctx) {
  return {
    href: ctx.config.siteUrl,
    label: messages(ctx.lang).account.backToSite,
    primary: true,
  };
}

/** The 400 page of a return address outside the family. */
function returnToInvalid(ctx: Ctx): Response {
  const m = messages(ctx.lang).account;
  return errorPage(ctx, {
    code: "return_to.invalid",
    status: 400,
    title: m.returnToInvalidTitle,
    message: m.returnToInvalidBody,
    actions: [toTheSite(ctx)],
  });
}

/** `GET /logout`: a confirmation page whose form posts to `/logout` with the same `return_to`. */
export const logoutPage: Route = async (ctx) => {
  const target = resolveReturnTo(ctx.url.searchParams.get("return_to"), ctx.config);
  if (!target.ok) return returnToInvalid(ctx);
  return logoutConfirmPage(ctx, target.url);
};

/**
 * `POST /logout`: ends the session of the cookie and goes to `return_to`. Products sign people out
 * with a plain form, so the `Origin` may be any family host (or a development origin in development
 * mode); a request without one, or from elsewhere, is refused before anything is read or changed.
 * The return address is validated before anything changes too.
 */
export const logoutPost: Route = async (ctx) => {
  const { config, deps } = ctx;
  if (!isFamilyOrigin(originOf(ctx.request), config)) return forbiddenPage(ctx, toTheSite(ctx));

  const form = await readForm(ctx.request);
  const fromBody = form?.get("return_to");
  const raw =
    typeof fromBody === "string" && fromBody !== ""
      ? fromBody
      : ctx.url.searchParams.get("return_to");
  const target = resolveReturnTo(raw, config);
  if (!target.ok) return returnToInvalid(ctx);

  // Without a valid cookie there is nothing to revoke, and the cookie is cleared all the same.
  const current = await currentSession(ctx);
  if (current) await deps.store.revokeSession(current.session.sid, deps.now().toISOString());
  return redirect(target.url, [clearSessionCookie(config)]);
};
