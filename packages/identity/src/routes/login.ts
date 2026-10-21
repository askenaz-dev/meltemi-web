import type { Route } from "../context.js";
import { randomToken } from "../crypto.js";
import { redirect } from "../http.js";
import {
  chooserPage,
  providerUnavailablePage,
  providerUnknownPage,
  returnToInvalidPage,
} from "../pages/signin.js";
import {
  OAUTH_PROVIDERS,
  ProviderError,
  pkceChallenge,
  providerSettings,
} from "../providers/index.js";
import { oauthSetCookie, signOauthCookie, type OAuthState } from "../oauth-cookie.js";
import { resolveReturnTo } from "../return-to.js";
import { currentSession } from "../session.js";
import { isProvider } from "../types.js";

/**
 * `GET /login`: the chooser, or with `provider=github|google` the redirect to that provider.
 * The return address is checked first, whichever of the two it is; the provider flow runs even
 * for a person who is already signed in, and `link=1` is honoured only with a valid session.
 */
export const loginRoute: Route = async (ctx) => {
  const { url, config, env, deps } = ctx;
  const rawReturnTo = url.searchParams.get("return_to");
  const returnTo = resolveReturnTo(rawReturnTo, config);
  if (!returnTo.ok) return returnToInvalidPage(ctx);
  // The links carry the address only when there was one: a bare `/login` stays bare.
  const carried = rawReturnTo ? returnTo.url : undefined;

  const requested = url.searchParams.get("provider");
  if (requested === null) return chooserPage(ctx, carried);
  if (!isProvider(requested)) return providerUnknownPage(ctx, carried);

  const provider = OAUTH_PROVIDERS[requested];
  const state = randomToken(deps.randomBytes, 32);
  const verifier = provider.usesPkce ? randomToken(deps.randomBytes, 32) : undefined;
  const linker = url.searchParams.get("link") === "1" ? await currentSession(ctx) : undefined;

  let location: string;
  try {
    location = provider.authorizationUrl(providerSettings(env, config, requested), {
      state,
      ...(verifier !== undefined ? { challenge: await pkceChallenge(verifier) } : {}),
    });
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    console.error(`identity: ${requested} sign-in cannot start: ${error.message}`);
    return providerUnavailablePage(ctx, { provider: requested, returnTo: carried });
  }

  const flow: OAuthState = {
    provider: requested,
    returnTo: returnTo.url,
    state,
    ...(verifier !== undefined ? { verifier } : {}),
    ...(linker ? { link: true, userId: linker.user.id } : {}),
    issued: deps.now().toISOString(),
  };
  const cookie = oauthSetCookie(config, await signOauthCookie(env.STATE_SECRET, flow));
  return redirect(location, [cookie]);
};
