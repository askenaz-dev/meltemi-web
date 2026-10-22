// Product-signed calls (`identity-session`, "Product-signed calls"): how a product's Worker proves,
// on each call to the service's `/api`, that it is the product it names. The product signs with the
// secret it shares with the service (the one that signs the events sent to it); the service checks
// the product, the time and the signature. WebCrypto only: it runs in Node 22, in Workers and in
// the reference package that products install.

import { hex, hmacHex, sha256, verifyHmacHex } from "./crypto.js";

export const PRODUCT_HEADER = "Meltemi-Product";
export const TIMESTAMP_HEADER = "Meltemi-Timestamp";
export const SIGNATURE_HEADER = "Meltemi-Signature";

/** How far a call's timestamp may be from the service's clock, either way. */
export const PRODUCT_CALL_WINDOW_MS = 5 * 60 * 1000;

/** A product's name, as `PRODUCTS` declares it. */
const PRODUCT_NAME = /^[a-z][a-z0-9-]{0,30}$/;
/** An ISO 8601 time in UTC, as `Date.prototype.toISOString` writes it (milliseconds optional). */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SIGNATURE = /^v1=([0-9a-f]{64})$/;

/** The hex SHA-256 of a body; the empty string's for a call without one. */
export async function bodyHash(body: string): Promise<string> {
  return hex(await sha256(body));
}

/** What is signed: the timestamp, the method, the path with its query and the body's hash. */
export function canonicalString(
  timestamp: string,
  method: string,
  pathAndQuery: string,
  bodySha256: string,
): string {
  return `${timestamp}\n${method.toUpperCase()}\n${pathAndQuery}\n${bodySha256}`;
}

function pathAndQueryOf(url: string | URL): string {
  const parsed = typeof url === "string" ? new URL(url) : url;
  return `${parsed.pathname}${parsed.search}`;
}

export interface ProductRequestToSign {
  /** The product's name, as the service's `PRODUCTS` lists it (`diagrams`). */
  readonly product: string;
  /** The product's secret: the service's `EVENTS_SECRET_<NAME>`, the product's own setting. */
  readonly secret: string;
  readonly method: string;
  /** The address the call goes to; only its path and query are signed. */
  readonly url: string | URL;
  /** The body exactly as it is sent; none for a call without one. */
  readonly body?: string;
  /** When the call is made; the current time by default. */
  readonly now?: Date;
}

/**
 * The three headers that sign a call: `Meltemi-Product`, `Meltemi-Timestamp` and
 * `Meltemi-Signature: v1=<hex HMAC-SHA256 of the canonical string>`. The call also carries the
 * person's session token as `Authorization: Bearer`, which this function does not add.
 */
export async function signProductRequest(
  call: ProductRequestToSign,
): Promise<Record<string, string>> {
  const timestamp = (call.now ?? new Date()).toISOString();
  const canonical = canonicalString(
    timestamp,
    call.method,
    pathAndQueryOf(call.url),
    await bodyHash(call.body ?? ""),
  );
  return {
    [PRODUCT_HEADER]: call.product,
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: `v1=${await hmacHex(call.secret, canonical)}`,
  };
}

/**
 * The product that signed a request, or undefined: a product name of the right shape whose secret
 * `secretOf` knows, a timestamp within five minutes of `now`, and a signature that verifies (in
 * constant time) over the request's method, path, query and `body`. Undefined never says which
 * check failed.
 */
export async function verifyProductRequest(
  request: Request,
  body: string,
  secretOf: (product: string) => string | undefined,
  now: Date = new Date(),
): Promise<{ readonly product: string } | undefined> {
  const product = request.headers.get(PRODUCT_HEADER) ?? "";
  const timestamp = request.headers.get(TIMESTAMP_HEADER) ?? "";
  const signature = SIGNATURE.exec(request.headers.get(SIGNATURE_HEADER) ?? "")?.[1];
  if (!PRODUCT_NAME.test(product) || !TIMESTAMP.test(timestamp) || signature === undefined) {
    return undefined;
  }
  const at = Date.parse(timestamp);
  if (!Number.isFinite(at) || Math.abs(now.getTime() - at) > PRODUCT_CALL_WINDOW_MS) {
    return undefined;
  }
  const secret = secretOf(product);
  if (!secret) return undefined;
  const canonical = canonicalString(
    timestamp,
    request.method,
    pathAndQueryOf(request.url),
    await bodyHash(body),
  );
  return (await verifyHmacHex(secret, canonical, signature)) ? { product } : undefined;
}
