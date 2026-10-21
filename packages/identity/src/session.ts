import { AUDIENCE, SESSION_COOKIE, SESSION_SECONDS, type SessionClaims } from "./claims.js";
import type { Config } from "./config.js";
import type { Ctx } from "./context.js";
import { randomToken } from "./crypto.js";
import { serializeCookie } from "./http.js";
import { signJwt } from "./jwt.js";
import type { Identity, Session, User } from "./types.js";
import { parseSessionCookie, sessionVerifier } from "./verify.js";

/**
 * A coarse label for a session, from the families of browser and system in the `User-Agent`,
 * such as `Edge on Windows`. The raw string is never stored.
 */
export function sessionLabel(userAgent: string | null): string {
  const ua = userAgent ?? "";
  let browser = "Other browser";
  if (/\b(Edg|Edge|EdgA|EdgiOS)\//.test(ua)) browser = "Edge";
  else if (/\bOPR\/|\bOpera\b/.test(ua)) browser = "Other browser";
  else if (/\b(Chrome|CriOS|Chromium)\//.test(ua)) browser = "Chrome";
  else if (/\b(Firefox|FxiOS)\//.test(ua)) browser = "Firefox";
  else if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) browser = "Safari";

  let system = "Other system";
  if (/\bAndroid\b/.test(ua)) system = "Android";
  else if (/\b(iPhone|iPad|iPod)\b/.test(ua)) system = "iOS";
  else if (/\bWindows\b/.test(ua)) system = "Windows";
  else if (/\b(Macintosh|Mac OS X)\b/.test(ua)) system = "macOS";
  else if (/\b(Linux|X11)\b/.test(ua)) system = "Linux";
  return `${browser} on ${system}`;
}

/** The `Set-Cookie` value that carries a session token. */
export function sessionCookie(config: Config, token: string): string {
  return serializeCookie(SESSION_COOKIE, token, {
    domain: config.cookieDomainAttribute,
    path: "/",
    maxAge: SESSION_SECONDS,
    secure: config.secureCookies,
    httpOnly: true,
    sameSite: "Lax",
  });
}

/** The `Set-Cookie` value that removes the session cookie (same attributes, `Max-Age=0`). */
export function clearSessionCookie(config: Config): string {
  return serializeCookie(SESSION_COOKIE, "", {
    domain: config.cookieDomainAttribute,
    path: "/",
    maxAge: 0,
    secure: config.secureCookies,
    httpOnly: true,
    sameSite: "Lax",
  });
}

export interface StartedSession {
  readonly session: Session;
  readonly token: string;
  /** The `Set-Cookie` value. */
  readonly cookie: string;
}

/**
 * Opens a session for a person who just signed in: the row, the signed token and the cookie.
 * The token's profile claims come from the user and from the identity used to sign in.
 */
export async function startSession(
  ctx: Pick<Ctx, "deps" | "config" | "request">,
  user: User,
  signedInWith: Pick<Identity, "email" | "emailVerified">,
): Promise<StartedSession> {
  const { deps, config, request } = ctx;
  const iat = Math.floor(deps.now().getTime() / 1000);
  const at = new Date(iat * 1000).toISOString();
  const session: Session = {
    sid: randomToken(deps.randomBytes, 32),
    userId: user.id,
    createdAt: at,
    lastSeen: at,
    expiresAt: new Date((iat + SESSION_SECONDS) * 1000).toISOString(),
    label: sessionLabel(request.headers.get("User-Agent")),
    revokedAt: null,
  };
  await deps.store.createSession(session);
  const claims: SessionClaims = {
    iss: config.issuer,
    aud: AUDIENCE,
    sub: user.id,
    sid: session.sid,
    name: user.name,
    picture: user.picture,
    email: signedInWith.email,
    email_verified: signedInWith.emailVerified,
    iat,
    exp: iat + SESSION_SECONDS,
  };
  const token = await signJwt(deps.keys, claims as unknown as Record<string, unknown>);
  return { session, token, cookie: sessionCookie(config, token) };
}

export interface CurrentSession {
  readonly session: Session;
  readonly user: User;
  readonly claims: SessionClaims;
}

/**
 * The person behind the request's session cookie: the token verifies against this service's own
 * keys, the session row is live (not revoked, not expired) and the user still exists. The rows
 * are read here, outside the verifier, every time: a revocation counts at once, and a failing
 * store is an error (a 500), not a person who looks signed out.
 */
export async function currentSession(ctx: Ctx): Promise<CurrentSession | undefined> {
  const token = parseSessionCookie(ctx.request.headers.get("Cookie"));
  if (!token) return undefined;
  const { deps, config } = ctx;
  const now = deps.now();
  const verifier = sessionVerifier({
    issuer: config.issuer,
    jwks: { keys: deps.keys.publicJwks as unknown as Record<string, unknown>[] },
    checkSession: false,
  });
  const claims = await verifier.verifySession(token, now);
  if (!claims) return undefined;
  const session = await deps.store.session(claims.sid);
  if (!session || session.revokedAt !== null || session.expiresAt <= now.toISOString()) {
    return undefined;
  }
  const user = await deps.store.userById(claims.sub);
  if (!user || session.userId !== user.id) return undefined;
  return { session, user, claims };
}
