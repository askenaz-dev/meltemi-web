import type { Provider, ProviderProfile } from "../types.js";

/**
 * A provider flow that failed or could not start: the provider answered with an error, did not
 * answer, answered with something unusable, or the service lacks a setting for it. The message is
 * written here, never copied from a provider's answer, so it holds no token and no personal data
 * and may be logged.
 */
export class ProviderError extends Error {
  override readonly name = "ProviderError";
}

/** What a provider needs from the environment. */
export interface ProviderSettings {
  readonly clientId: string;
  readonly clientSecret: string;
  /** `<ISSUER>/callback/<provider>`: where the provider sends the browser back. */
  readonly redirectUri: string;
}

export interface AuthorizationInput {
  readonly state: string;
  /** The PKCE code challenge (S256), for providers that use PKCE. */
  readonly challenge?: string;
}

export interface SignInInput {
  readonly code: string;
  /** The PKCE verifier whose SHA-256 is the challenge that started the flow. */
  readonly verifier?: string;
}

export interface OAuthProvider {
  readonly id: Provider;
  /** Whether the flow carries a PKCE verifier and challenge. */
  readonly usesPkce: boolean;
  /** The provider's authorization endpoint with the parameters of the flow. */
  authorizationUrl(settings: ProviderSettings, input: AuthorizationInput): string;
  /**
   * Exchanges the code for an access token, reads the profile with it, and forgets the token:
   * only the profile leaves this function, after `normalizeProfile` (bounded, cleaned, with the
   * fallbacks applied). Every request goes through `fetch`. Any failure, an unusable provider id
   * included, is a `ProviderError`.
   */
  signIn(
    settings: ProviderSettings & { readonly fetch: typeof fetch },
    input: SignInInput,
  ): Promise<ProviderProfile>;
}
