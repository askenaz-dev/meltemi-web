import type { Config } from "../config.js";
import type { Env } from "../env.js";
import type { Provider } from "../types.js";
import { githubProvider } from "./github.js";
import { googleProvider } from "./google.js";
import type { OAuthProvider, ProviderSettings } from "./types.js";

export { ProviderError } from "./types.js";
export type { OAuthProvider, ProviderSettings } from "./types.js";
export { pkceChallenge } from "./google.js";
export { PROFILE_LIMITS, normalizeProfile } from "./profile.js";

/** The two providers, by their name in the URL (`/login?provider=github`). */
export const OAUTH_PROVIDERS: Readonly<Record<Provider, OAuthProvider>> = {
  github: githubProvider,
  google: googleProvider,
};

/** `<ISSUER>/callback/<provider>`: the address registered at the provider. */
export function redirectUriFor(config: Config, provider: Provider): string {
  return `${config.issuer}/callback/${provider}`;
}

/** The client credentials of a provider and its callback address. */
export function providerSettings(env: Env, config: Config, provider: Provider): ProviderSettings {
  const redirectUri = redirectUriFor(config, provider);
  return provider === "github"
    ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET, redirectUri }
    : { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri };
}
