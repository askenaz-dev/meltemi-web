import type { ProviderProfile } from "../types.js";
import { PROVIDER_USER_AGENT, asRecord, requestJson, requireSetting, text } from "./http.js";
import { normalizeProfile } from "./profile.js";
import { ProviderError, type OAuthProvider } from "./types.js";

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const EMAILS_URL = "https://api.github.com/user/emails";
const SCOPE = "read:user user:email";

/** GitHub's numeric id as text, or undefined when the answer has none. */
function providerId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return text(value);
}

/**
 * The email of the profile: the primary one when GitHub says it is verified; else the primary one
 * marked unverified; else none. A verified email that is not the primary one counts for nothing.
 */
function pickEmail(emails: unknown[]): { email: string; verified: boolean } {
  let primary: { email: string; verified: boolean } | undefined;
  for (const entry of emails) {
    const item = asRecord(entry);
    const email = text(item?.["email"]);
    if (!item || email === undefined || item["primary"] !== true) continue;
    const verified = item["verified"] === true;
    if (verified) return { email, verified: true };
    primary ??= { email, verified: false };
  }
  return primary ?? { email: "", verified: false };
}

export const githubProvider: OAuthProvider = {
  id: "github",
  usesPkce: false,

  authorizationUrl(settings, input) {
    requireSetting("GITHUB_CLIENT_ID", settings.clientId);
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", settings.clientId);
    url.searchParams.set("redirect_uri", settings.redirectUri);
    url.searchParams.set("scope", SCOPE);
    url.searchParams.set("state", input.state);
    return url.href;
  },

  async signIn(settings, input): Promise<ProviderProfile> {
    requireSetting("GITHUB_CLIENT_ID", settings.clientId);
    requireSetting("GITHUB_CLIENT_SECRET", settings.clientSecret);

    const tokenAnswer = asRecord(
      await requestJson(settings.fetch, "GitHub token", TOKEN_URL, {
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
          redirect_uri: settings.redirectUri,
        }).toString(),
      }),
    );
    // GitHub answers a bad code with 200 and an `error` member: only a token counts.
    const token = text(tokenAnswer?.["access_token"]);
    if (token === undefined) {
      const reason = text(tokenAnswer?.["error"]);
      throw new ProviderError(
        `GitHub token: no access token in the answer${reason && /^[a-z_]{1,64}$/.test(reason) ? ` (${reason})` : ""}`,
      );
    }

    // The token lives in this function only: it reads the profile and is dropped.
    const headers = {
      Authorization: `Bearer ${token}`,
      "User-Agent": PROVIDER_USER_AGENT,
      Accept: "application/vnd.github+json",
    };
    const user = asRecord(await requestJson(settings.fetch, "GitHub user", USER_URL, { headers }));
    const emails = await requestJson(settings.fetch, "GitHub emails", EMAILS_URL, { headers });

    const id = providerId(user?.["id"]);
    if (!user || id === undefined) throw new ProviderError("GitHub user: the answer has no id");
    if (!Array.isArray(emails)) throw new ProviderError("GitHub emails: the answer is not a list");

    const login = text(user["login"]) ?? "";
    const { email, verified } = pickEmail(emails);
    // Whatever GitHub said goes through the rules of `normalizeProfile`; the login names the
    // person when the name is empty.
    return normalizeProfile(
      {
        provider: "github",
        providerId: id,
        name: typeof user["name"] === "string" ? user["name"] : "",
        picture: text(user["avatar_url"]) ?? "",
        email,
        emailVerified: verified,
        handle: login,
      },
      login,
    );
  },
};
