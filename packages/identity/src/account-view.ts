// The answers of the account API (`identity-account`, "The account API for products"): what a
// product's Worker receives about the person it calls for. Types only: the reference package
// exports them so that a product reads the answers with the service's own names.

/** A provider a person signs in with. */
export type AccountProvider = "github" | "google";

/** One way a person signs in. */
export interface AccountIdentity {
  readonly provider: AccountProvider;
  /** The email the provider gave; `""` when it gave none. */
  readonly email: string;
  /** Whether the provider vouched for the email. */
  readonly emailVerified: boolean;
  /** The provider's handle (the GitHub login); `""` for Google. */
  readonly handle: string;
  /** When it was linked, as an ISO 8601 time. */
  readonly linkedAt: string;
}

/** One live session of the person: a browser on a device. */
export interface AccountSession {
  /** The session id, as the session token's `sid` names it. */
  readonly sid: string;
  /** A coarse label in English, such as `Edge on Windows`. */
  readonly label: string;
  readonly createdAt: string;
  readonly lastSeen: string;
  readonly expiresAt: string;
  /** The session of the token the call carried. */
  readonly current: boolean;
}

/** `GET /api/account`, and the answer of every action that worked: the account as it is now. */
export interface AccountView {
  readonly user: { readonly id: string; readonly name: string; readonly picture: string };
  readonly identities: readonly AccountIdentity[];
  /** The live sessions, newest first. */
  readonly sessions: readonly AccountSession[];
  /** Whether a provider may be unlinked: false while the person signs in with one only. */
  readonly canUnlink: boolean;
}

/**
 * The body of a refusal: a stable code. `product.unauthorized`, `session.invalid`,
 * `request.invalid`, `provider.unknown`, `identity.last`, `session.current`, `session.not-found`,
 * `rate.limited`, `not-found` or `internal`.
 */
export interface AccountApiError {
  readonly error: string;
}
