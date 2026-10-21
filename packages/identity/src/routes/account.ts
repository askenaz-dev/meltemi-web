import type { Ctx, Route } from "../context.js";
import { buildDeletionEvents } from "../events.js";
import { accountAction, accountPath, csrfToken, signInRedirect } from "../forms.js";
import { redirect } from "../http.js";
import { messages } from "../messages/index.js";
import { accountPage as accountView, deletedPage } from "../pages/account.js";
import { errorPage } from "../pages/layout.js";
import { clearSessionCookie, currentSession } from "../session.js";
import { isProvider } from "../types.js";

/** A page that refuses an action of the account page and says nothing was changed. */
function refuse(ctx: Ctx, status: number, code: string, title: string, message: string): Response {
  return errorPage(ctx, {
    code,
    status,
    title,
    message,
    actions: [
      { href: accountPath(ctx), label: messages(ctx.lang).account.backToAccount, primary: true },
    ],
  });
}

/** After an action that worked: back to the account page, which shows the new state. */
function backToAccount(ctx: Ctx): Response {
  return redirect(accountPath(ctx), [], 303);
}

/** `GET /account`: the person, what is linked and where they are signed in, with the actions. */
export const accountPage: Route = async (ctx) => {
  const current = await currentSession(ctx);
  if (!current) return signInRedirect(ctx.config);
  const { store } = ctx.deps;
  const [identities, sessions, csrf] = await Promise.all([
    store.identitiesOf(current.user.id),
    store.sessionsOf(current.user.id, ctx.deps.now().toISOString()),
    csrfToken(ctx, current.session.sid),
  ]);
  return accountView(ctx, {
    user: current.user,
    identities,
    sessions,
    currentSid: current.session.sid,
    csrf,
  });
};

/**
 * `POST /account/unlink`: removes the identity of a provider from the current user, unless it is
 * the last way to sign in. A provider the user has not linked is already as the person wants it.
 * When a user has linked several identities of one provider they all go: the form names the provider.
 * The store decides in one atomic step, so two tabs unlinking different providers at once cannot
 * both pass the "not the last one" check.
 */
export const unlinkPost: Route = async (ctx) => {
  const guarded = await accountAction(ctx);
  if ("response" in guarded) return guarded.response;
  const m = messages(ctx.lang).account;

  const provider = guarded.form.get("provider");
  if (!isProvider(provider)) {
    return refuse(ctx, 400, "provider.unknown", m.providerUnknownTitle, m.providerUnknownBody);
  }
  const outcome = await ctx.deps.store.unlinkProvider(guarded.current.user.id, provider);
  if (outcome === "last") {
    return refuse(ctx, 409, "identity.last", m.identityLastTitle, m.identityLastBody);
  }
  // "removed", or "absent": already as the person wants it.
  return backToAccount(ctx);
};

/** `POST /account/sessions/revoke-others`: ends every session of the person but this one. */
export const revokeOthersPost: Route = async (ctx) => {
  const guarded = await accountAction(ctx);
  if ("response" in guarded) return guarded.response;
  const { deps } = ctx;
  await deps.store.revokeOtherSessions(
    guarded.current.user.id,
    guarded.current.session.sid,
    deps.now().toISOString(),
  );
  return backToAccount(ctx);
};

/**
 * `POST /account/delete`: after the person types the word the page shows in its language, deletes
 * the user with its identities and sessions and queues the deletion events for every product, all
 * in one store call that is atomic: if it fails nothing is deleted and nothing is queued, the
 * person gets the error page with the cookie intact and can try again.
 */
export const deletePost: Route = async (ctx) => {
  const guarded = await accountAction(ctx);
  if ("response" in guarded) return guarded.response;
  const m = messages(ctx.lang).account;

  const typed = guarded.form.get("confirm");
  if (typeof typed !== "string" || typed.trim().toLowerCase() !== m.deleteWord.toLowerCase()) {
    return refuse(ctx, 400, "confirm.mismatch", m.confirmMismatchTitle, m.confirmMismatchBody);
  }
  const { config, deps } = ctx;
  const userId = guarded.current.user.id;
  await deps.store.deleteUser(userId, buildDeletionEvents(config, deps, userId));
  return deletedPage(ctx, [clearSessionCookie(config)]);
};
