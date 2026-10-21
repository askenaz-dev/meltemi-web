import { base64url, sha256 } from "../crypto.js";
import type { ProviderProfile } from "../types.js";
import { PROVIDER_USER_AGENT, asRecord, requestJson, requireSetting, text } from "./http.js";
import { normalizeProfile } from "./profile.js";
import { ProviderError, type OAuthProvider } from "./types.js";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const SCOPE = "openid email profile";

/** The PKCE challenge (method S256) of a verifier: base64url of its SHA-256. */
export async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(await sha256(verifier));
}

export const googleProvider: OAuthProvider = {
  id: "google",
  usesPkce: true,

  authorizationUrl(settings, input) {
    requireSetting("GOOGLE_CLIENT_ID", settings.clientId);
    if (input.challenge === undefined)
      throw new ProviderError("Google: the PKCE challenge is missing");
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", settings.clientId);
    url.searchParams.set("redirect_uri", settings.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPE);
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.href;
  },

  async signIn(settings, input): Promise<ProviderProfile> {
    requireSetting("GOOGLE_CLIENT_ID", settings.clientId);
    requireSetting("GOOGLE_CLIENT_SECRET", settings.clientSecret);
    if (input.verifier === undefined)
      throw new ProviderError("Google: the PKCE verifier is missing");

    const tokenAnswer = asRecord(
      await requestJson(settings.fetch, "Google token", TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": PROVIDER_USER_AGENT,
        },
        body: new URLSearchParams({
          client_id: settings.clientId,
          client_secret: settings.clientSecret,
          code: input.code,
          code_verifier: input.verifier,
          grant_type: "authorization_code",
          redirect_uri: settings.redirectUri,
        }).toString(),
      }),
    );
    const token = text(tokenAnswer?.["access_token"]);
    if (token === undefined) throw new ProviderError("Google token: no access token in the answer");

    // The token lives in this function only: it reads the profile and is dropped.
    const info = asRecord(
      await requestJson(settings.fetch, "Google userinfo", USERINFO_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": PROVIDER_USER_AGENT,
          Accept: "application/json",
        },
      }),
    );
    const sub = text(info?.["sub"]);
    if (!info || sub === undefined)
      throw new ProviderError("Google userinfo: the answer has no sub");

    const email = text(info["email"]) ?? "";
    // Whatever Google said goes through the rules of `normalizeProfile`; the email names the
    // person when the name is empty.
    return normalizeProfile(
      {
        provider: "google",
        providerId: sub,
        name: typeof info["name"] === "string" ? info["name"] : "",
        picture: text(info["picture"]) ?? "",
        email,
        // Only a literal `true` counts: anything else is the provider not vouching for the address.
        emailVerified: email !== "" && info["email_verified"] === true,
        handle: "",
      },
      email,
    );
  },
};
