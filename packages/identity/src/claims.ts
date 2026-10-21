/** The audience of every session token: the whole family. */
export const AUDIENCE = "meltemi";

/** The name of the session cookie, shared by every host under the cookie domain. */
export const SESSION_COOKIE = "meltemi_session";

/** A session, and its token, live thirty days. */
export const SESSION_SECONDS = 30 * 24 * 60 * 60;

/** The claims of a session token (`identity-session`). */
export interface SessionClaims {
  readonly iss: string;
  readonly aud: string;
  /** The user id: what a product keeps its data by. */
  readonly sub: string;
  /** The session id, which `GET /sessions/<sid>` answers for. */
  readonly sid: string;
  readonly name: string;
  readonly picture: string;
  readonly email: string;
  readonly email_verified: boolean;
  /** Seconds since the epoch. */
  readonly iat: number;
  readonly exp: number;
}
