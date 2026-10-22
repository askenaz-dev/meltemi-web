// @meltemi/identity/testing: what a product's own tests use to be somebody, without the identity
// service running. It is never imported by the Worker (a test checks the import graph).

import { AUDIENCE, SESSION_SECONDS, type SessionClaims } from "./claims.js";
import { base64url } from "./crypto.js";
import {
  generateKeyPair,
  importSigningKeys,
  signJwt,
  type JsonWebKeySet,
  type PrivateJwk,
  type PublicJwk,
} from "./jwt.js";
import { signProductRequest } from "./product-call.js";

export type { PrivateJwk, PublicJwk, JsonWebKeySet } from "./jwt.js";
export type { SessionClaims } from "./claims.js";

export interface ProductCallOptions {
  /** The product's name (`diagrams`). */
  readonly product: string;
  /** The product's secret. */
  readonly secret: string;
  /** The full address of the call, such as `https://id.meltemi.dev/api/account`. */
  readonly url: string;
  /** `GET` without a body, `POST` with one, unless given. */
  readonly method?: string;
  /** A value sent as JSON; none for a call without a body. */
  readonly body?: unknown;
  /** The person's session token, sent as `Authorization: Bearer`. */
  readonly token: string;
  /** When the call is signed; the current time by default. */
  readonly now?: Date;
}

/**
 * A call to the account API as a product's Worker makes it: signed with the product's secret and
 * carrying the person's session token. A product's tests send it to a fake of the service, and a
 * fake of the service checks what a product sent with `verifyProductRequest`.
 */
export async function signedProductCall(options: ProductCallOptions): Promise<Request> {
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  const signed = await signProductRequest({
    product: options.product,
    secret: options.secret,
    method,
    url: options.url,
    ...(body !== undefined ? { body } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  const headers = new Headers(signed);
  headers.set("Authorization", `Bearer ${options.token}`);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return new Request(options.url, { method, headers, ...(body !== undefined ? { body } : {}) });
}

/** A generated ES256 pair as JWKs, both with the same `kid`. */
export interface TestKeys {
  readonly privateJwk: PrivateJwk;
  readonly publicJwk: PublicJwk;
}

export function testKeys(): Promise<TestKeys> {
  return generateKeyPair();
}

/** The key set the service would publish for these keys. */
export function testJwks(keys: TestKeys): JsonWebKeySet {
  return { keys: [keys.publicJwk] };
}

/**
 * A session token for a fake person. Every claim not given is filled: `iss`
 * `https://id.meltemi.dev`, `aud` `meltemi`, a random `sid`, `iat` = `now`, `exp` = `now` + 30
 * days, empty `name`, `picture` and `email`, `email_verified` false. A claim given overrides its
 * default, so a product passes its own `iss` and a `picture` on its own origin.
 */
export async function signSessionToken(
  claims: Partial<SessionClaims> & { readonly sub: string },
  keys: TestKeys,
  now: Date,
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  // A claim given as `undefined` is a claim not given (`{ picture: maybeUndefined }`): it keeps its
  // default instead of leaving the token without it, which no verifier would accept.
  const given = Object.fromEntries(
    Object.entries(claims).filter(([, value]) => value !== undefined),
  ) as Partial<SessionClaims>;
  const full: SessionClaims = {
    sub: claims.sub,
    iss: "https://id.meltemi.dev",
    aud: AUDIENCE,
    sid: base64url(crypto.getRandomValues(new Uint8Array(32))),
    name: "",
    picture: "",
    email: "",
    email_verified: false,
    iat,
    exp: iat + SESSION_SECONDS,
    ...given,
  };
  const signing = await importSigningKeys(keys.privateJwk, [keys.publicJwk]);
  return signJwt(signing, full as unknown as Record<string, unknown>);
}
