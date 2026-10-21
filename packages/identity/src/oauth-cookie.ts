// The `meltemi_oauth` cookie: what the service remembers between sending a person to a provider and
// receiving them back. Its value is the base64url of a JSON object, a dot, and the base64url of
// the HMAC-SHA256 (with `STATE_SECRET`) of that first part, so a callback can trust what it reads.

import type { Config } from "./config.js";
import { base64url, fromBase64url, fromUtf8, hmacSha256, utf8, verifyHmac } from "./crypto.js";
import { serializeCookie } from "./http.js";
import { isProvider, type Iso, type Provider } from "./types.js";

export const OAUTH_COOKIE = "meltemi_oauth";
/** The cookie travels only to the callbacks: `Lax` sends it on the provider's redirect back. */
export const OAUTH_COOKIE_PATH = "/callback";
export const OAUTH_MAX_AGE_SECONDS = 600;
/** The server's own bound, for a cookie the browser should already have dropped. */
const OAUTH_MAX_AGE_MS = OAUTH_MAX_AGE_SECONDS * 1000;
/** A value longer than a cookie may be is refused unread. */
const MAX_VALUE_LENGTH = 4096;

/** What a sign-in in progress carries. */
export interface OAuthState {
  readonly provider: Provider;
  /** The validated address the person returns to: the parsed one, never the raw text. */
  readonly returnTo: string;
  /** 32 random bytes in base64url; the provider sends it back unchanged. */
  readonly state: string;
  /** The PKCE verifier (Google). */
  readonly verifier?: string;
  /** The person asked to add this provider to the account they are signed in with. */
  readonly link?: boolean;
  /** The signed-in user who asked to link; present exactly when `link` is. */
  readonly userId?: string;
  readonly issued: Iso;
}

/** The cookie's value for a sign-in in progress. */
export async function signOauthCookie(secret: string, value: OAuthState): Promise<string> {
  const payload = base64url(utf8(JSON.stringify(value)));
  return `${payload}.${base64url(await hmacSha256(secret, payload))}`;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/**
 * What a cookie value holds, or undefined when the signature is not ours, the content is not a
 * sign-in in progress, or it was issued more than ten minutes before `now`. The signature is
 * checked (in constant time) before anything is parsed.
 */
export async function readOauthCookie(
  secret: string,
  raw: string,
  now: Date,
): Promise<OAuthState | undefined> {
  if (raw.length > MAX_VALUE_LENGTH) return undefined;
  const parts = raw.split(".");
  if (parts.length !== 2) return undefined;
  const [payload, signature] = parts as [string, string];
  const signatureBytes = fromBase64url(signature);
  if (!signatureBytes || !(await verifyHmac(secret, payload, signatureBytes))) return undefined;
  const bytes = fromBase64url(payload);
  if (!bytes) return undefined;

  let value: unknown;
  try {
    value = JSON.parse(fromUtf8(bytes));
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { provider, returnTo, state, verifier, link, userId, issued } = value as Record<
    string,
    unknown
  >;
  if (!isProvider(provider) || !nonEmpty(returnTo) || !nonEmpty(state) || !nonEmpty(issued)) {
    return undefined;
  }
  if (verifier !== undefined && !nonEmpty(verifier)) return undefined;
  if (link !== undefined && typeof link !== "boolean") return undefined;
  if (userId !== undefined && !nonEmpty(userId)) return undefined;
  if (link === true && userId === undefined) return undefined;

  const issuedAt = Date.parse(issued);
  if (!Number.isFinite(issuedAt) || now.getTime() - issuedAt > OAUTH_MAX_AGE_MS) return undefined;

  return {
    provider,
    returnTo,
    state,
    ...(verifier !== undefined ? { verifier } : {}),
    ...(link === true ? { link: true, userId: userId as string } : {}),
    issued,
  };
}

/** Compares two texts without stopping at the first difference. */
export function sameText(a: string, b: string): boolean {
  const x = utf8(a);
  const y = utf8(b);
  let difference = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    difference |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return difference === 0;
}

/** The `Set-Cookie` value that starts a sign-in: no `Domain`, so only this host receives it. */
export function oauthSetCookie(config: Config, value: string): string {
  return serializeCookie(OAUTH_COOKIE, value, {
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_MAX_AGE_SECONDS,
    secure: config.secureCookies,
    httpOnly: true,
    sameSite: "Lax",
  });
}

/** The `Set-Cookie` value that removes it (same attributes, `Max-Age=0`). */
export function clearOauthCookie(config: Config): string {
  return serializeCookie(OAUTH_COOKIE, "", {
    path: OAUTH_COOKIE_PATH,
    maxAge: 0,
    secure: config.secureCookies,
    httpOnly: true,
    sameSite: "Lax",
  });
}
