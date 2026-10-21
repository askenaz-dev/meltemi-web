import type { Ctx, Route } from "../context.js";
import { messages } from "../messages/index.js";
import { errorPage } from "../pages/layout.js";
import {
  accountExistsPage,
  identityTakenPage,
  loginHref,
  providerDeniedPage,
  providerUnavailablePage,
  returnToInvalidPage,
  stateMismatchPage,
} from "../pages/signin.js";
import { parseCookies, redirect } from "../http.js";
import { OAUTH_COOKIE, clearOauthCookie, readOauthCookie, sameText } from "../oauth-cookie.js";
import { OAUTH_PROVIDERS, ProviderError, providerSettings } from "../providers/index.js";
import { MERGE_WINDOW_DAYS, resolveIdentity } from "../resolve.js";
import { resolveReturnTo } from "../return-to.js";
import { currentSession, startSession, type CurrentSession } from "../session.js";
import { isProvider, type ProviderProfile } from "../types.js";

/** Nothing the callback says is ever worth keeping: it depends on a cookie and a one-time code. */
function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/**
 * The session a completed flow replaces ends with it, whoever it belonged to: the browser is about
 * to lose its token, and an orphan that stays live for thirty days is a session the person cannot
 * sign out of except by name. The new session is made first, so a failure here never leaves the
 * person with none.
 */
async function endReplaced(ctx: Ctx, held: CurrentSession | undefined): Promise<void> {
  if (held) await ctx.deps.store.revokeSession(held.session.sid, ctx.deps.now().toISOString());
}

async function finish(ctx: Ctx, clear: string): Promise<Response> {
  const { url, config, env, deps } = ctx;
  const refuse = { setCookies: [clear] };

  // 1. What came back is what went out: the cookie, its signature, the provider, the `state`.
  const provider = ctx.params["provider"];
  if (!isProvider(provider)) return stateMismatchPage(ctx, refuse);
  const raw = parseCookies(ctx.request.headers.get("Cookie")).get(OAUTH_COOKIE);
  const flow = raw ? await readOauthCookie(env.STATE_SECRET, raw, deps.now()) : undefined;
  const state = url.searchParams.get("state");
  if (!flow || flow.provider !== provider || !state || !sameText(state, flow.state)) {
    return stateMismatchPage(ctx, refuse);
  }
  // The address was checked when the flow started; it is checked again where it is used.
  const returnTo = resolveReturnTo(flow.returnTo, config);
  if (!returnTo.ok) return returnToInvalidPage(ctx, refuse);
  const back = returnTo.url;

  // 2. The provider's own refusal, which only a flow that is ours may report.
  const error = url.searchParams.get("error");
  if (error !== null) {
    return error === "access_denied"
      ? providerDeniedPage(ctx, { provider, returnTo: back, ...refuse })
      : providerUnavailablePage(ctx, { provider, returnTo: back, ...refuse });
  }
  const code = url.searchParams.get("code");
  if (!code) return stateMismatchPage(ctx, { returnTo: back, ...refuse });

  // 3. The code for a profile; the provider's token never leaves the provider module.
  let profile: ProviderProfile;
  try {
    profile = await OAUTH_PROVIDERS[provider].signIn(
      { ...providerSettings(env, config, provider), fetch: deps.fetch },
      { code, ...(flow.verifier !== undefined ? { verifier: flow.verifier } : {}) },
    );
  } catch (failure) {
    if (!(failure instanceof ProviderError)) throw failure;
    console.error(`identity: ${provider} sign-in failed: ${failure.message}`);
    return providerUnavailablePage(ctx, { provider, returnTo: back, ...refuse });
  }

  // 4. Who that is. The browser may already hold a session. A link request holds only while the
  // session that made it is still here; any other completed flow replaces that session.
  const held = await currentSession(ctx);
  const link =
    flow.link && held && held.user.id === flow.userId ? { userId: held.user.id } : undefined;
  const result = await resolveIdentity(ctx, profile, link);

  switch (result.kind) {
    case "taken":
      return identityTakenPage(ctx, { provider, returnTo: back, ...refuse });
    case "linked":
      // The person stays signed in with the session they have.
      return redirect(back, [clear]);
    case "stale": {
      const started = await startSession(ctx, result.user, result.identity);
      await endReplaced(ctx, held);
      return accountExistsPage(ctx, {
        name: result.user.name,
        email: result.identity.email,
        provider,
        existingProvider: result.existingProvider,
        returnTo: back,
        windowDays: MERGE_WINDOW_DAYS,
        setCookies: [started.cookie, clear],
      });
    }
    default: {
      // A completed flow replaces the session: the new cookie takes the old one's place.
      const started = await startSession(ctx, result.user, result.identity);
      await endReplaced(ctx, held);
      return redirect(back, [started.cookie, clear]);
    }
  }
}

/**
 * `GET /callback/<provider>`: finishes a sign-in. Whatever the outcome, the answer clears the
 * `meltemi_oauth` cookie, and nothing it says is cached.
 */
export const callbackRoute: Route = async (ctx) => {
  const clear = clearOauthCookie(ctx.config);
  try {
    return noStore(await finish(ctx, clear));
  } catch (failure) {
    // The cookie is cleared even when the service itself fails; the message holds no secret.
    console.error(
      "identity: callback failed:",
      failure instanceof Error ? failure.message : "unknown",
    );
    const m = messages(ctx.lang);
    return noStore(
      errorPage(ctx, {
        code: "internal",
        status: 500,
        title: m.common.internalTitle,
        message: m.common.internalBody,
        actions: [{ href: loginHref({}), label: m.signin.chooseAgain, primary: true }],
        setCookies: [clear],
      }),
    );
  }
};
