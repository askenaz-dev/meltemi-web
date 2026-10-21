import type { SigningKeys } from "./jwt.js";
import type { IdentityStore } from "./store/types.js";

/** The providers the service signs people in with; there are no others. */
export const PROVIDERS = ["github", "google"] as const;
export type Provider = (typeof PROVIDERS)[number];

export function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

/** The words the interface speaks. */
export type Lang = "en" | "es";

/** Times are ISO-8601 strings in UTC with milliseconds (`Date.prototype.toISOString`). */
export type Iso = string;

export interface User {
  readonly id: string;
  readonly name: string;
  readonly picture: string;
  readonly createdAt: Iso;
}

export interface Identity {
  readonly provider: Provider;
  readonly providerId: string;
  readonly userId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  /** The time the provider last reported the email verified; null while it is not. */
  readonly verifiedAt: Iso | null;
  /** The provider's handle (the GitHub login; empty for Google). */
  readonly handle: string;
  readonly linkedAt: Iso;
}

export interface Session {
  readonly sid: string;
  readonly userId: string;
  readonly createdAt: Iso;
  readonly lastSeen: Iso;
  readonly expiresAt: Iso;
  /** A coarse label such as `Edge on Windows`; the raw `User-Agent` is never stored. */
  readonly label: string;
  readonly revokedAt: Iso | null;
}

/** A deletion event waiting for, or past, delivery to one product. */
export interface OutboxEvent {
  readonly id: string;
  readonly product: string;
  readonly body: string;
  readonly createdAt: Iso;
  readonly attempts: number;
  readonly nextAt: Iso;
  readonly deliveredAt: Iso | null;
  readonly failedAt: Iso | null;
}

/** What a provider tells the service about the person after a sign-in. */
export interface ProviderProfile {
  readonly provider: Provider;
  readonly providerId: string;
  readonly name: string;
  readonly picture: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly handle: string;
}

/** What the handlers need besides the request: everything with a side effect is injected. */
export interface Deps {
  /** The providers and the products' event addresses. */
  readonly fetch: typeof fetch;
  now(): Date;
  randomBytes(length: number): Uint8Array;
  readonly store: IdentityStore;
  /** The private key that signs sessions and the public keys the JWKS publishes. */
  readonly keys: SigningKeys;
}
