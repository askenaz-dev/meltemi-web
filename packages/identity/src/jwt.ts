// ES256 JSON Web Tokens over WebCrypto: the primitives the service signs sessions with and the
// reference verifier checks them with. WebCrypto's ECDSA signature is the raw `r‖s` form JWS
// requires, so there is nothing to convert.

import { base64url, fromBase64url, fromUtf8, sha256, utf8, type Bytes } from "./crypto.js";

// Type aliases, not interfaces: a JWK is a plain object a key set may hold as `Record<string, unknown>`.
export type PublicJwk = {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  kid: string;
  use?: "sig";
  alg?: "ES256";
};

export type PrivateJwk = PublicJwk & { d: string };

/** A JSON Web Key Set as a product receives it; entries are checked before they are used. */
export interface JsonWebKeySet {
  readonly keys: readonly Record<string, unknown>[];
}

/** What signs sessions and what the JWKS publishes, imported once per isolate. */
export interface SigningKeys {
  readonly kid: string;
  readonly privateKey: CryptoKey;
  readonly publicJwks: readonly PublicJwk[];
}

const ECDSA_IMPORT = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDSA_SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

/** The RFC 7638 thumbprint of a P-256 key, which names it (`kid`). */
export async function thumbprint(jwk: {
  crv: string;
  kty: string;
  x: string;
  y: string;
}): Promise<string> {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return base64url(await sha256(canonical));
}

/** A new signing pair: the private JWK for `SESSION_PRIVATE_KEY` and the public one to publish. */
export async function generateKeyPair(): Promise<{ privateJwk: PrivateJwk; publicJwk: PublicJwk }> {
  const pair = (await crypto.subtle.generateKey(ECDSA_IMPORT, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const exported = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as {
    x: string;
    y: string;
    d: string;
  };
  const base = { kty: "EC", crv: "P-256", x: exported.x, y: exported.y } as const;
  const kid = await thumbprint(base);
  const publicJwk: PublicJwk = { ...base, use: "sig", alg: "ES256", kid };
  return { privateJwk: { ...publicJwk, d: exported.d }, publicJwk };
}

export async function importSigningKeys(
  privateJwk: PrivateJwk,
  publicJwks: readonly PublicJwk[],
): Promise<SigningKeys> {
  const { kty, crv, x, y, d } = privateJwk;
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    { kty, crv, x, y, d, ext: true },
    ECDSA_IMPORT,
    false,
    ["sign"],
  );
  return { kid: privateJwk.kid, privateKey, publicJwks };
}

/** Signs `claims` as a compact JWS with the header `{ alg: "ES256", typ: "JWT", kid }`. */
export async function signJwt(
  key: { readonly kid: string; readonly privateKey: CryptoKey },
  claims: Readonly<Record<string, unknown>>,
): Promise<string> {
  const header = { alg: "ES256", typ: "JWT", kid: key.kid };
  const input = `${base64url(utf8(JSON.stringify(header)))}.${base64url(utf8(JSON.stringify(claims)))}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(ECDSA_SIGN, key.privateKey, utf8(input)),
  );
  return `${input}.${base64url(signature)}`;
}

export interface ParsedJwt {
  readonly header: Readonly<Record<string, unknown>>;
  readonly claims: Readonly<Record<string, unknown>>;
  /** `<header>.<payload>` as signed. */
  readonly signingInput: string;
  readonly signature: Bytes;
}

function parseObject(part: string): Record<string, unknown> | undefined {
  const bytes = fromBase64url(part);
  if (!bytes) return undefined;
  try {
    const value: unknown = JSON.parse(fromUtf8(bytes));
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Splits and decodes a token without verifying anything; undefined when it is not a JWS. */
export function parseJwt(token: string): ParsedJwt | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const header = parseObject(headerPart);
  const claims = parseObject(payloadPart);
  const signature = fromBase64url(signaturePart);
  if (!header || !claims || !signature) return undefined;
  return { header, claims, signingInput: `${headerPart}.${payloadPart}`, signature };
}

/**
 * A public key for verification, or undefined when the entry is not an ES256 signing key: only
 * entries with `kty` `EC`, `crv` `P-256` and `use` `sig` count, and `alg` must be `ES256`
 * when the entry names one.
 */
export async function importVerifyKey(
  jwk: Readonly<Record<string, unknown>>,
): Promise<CryptoKey | undefined> {
  if (jwk["kty"] !== "EC" || jwk["crv"] !== "P-256" || jwk["use"] !== "sig") return undefined;
  if (jwk["alg"] !== undefined && jwk["alg"] !== "ES256") return undefined;
  if (typeof jwk["x"] !== "string" || typeof jwk["y"] !== "string") return undefined;
  try {
    return await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x: jwk["x"], y: jwk["y"], ext: true },
      ECDSA_IMPORT,
      false,
      ["verify"],
    );
  } catch {
    return undefined;
  }
}

/** Checks the signature of a parsed token (in constant time, inside the platform). */
export async function verifyJwtSignature(parsed: ParsedJwt, key: CryptoKey): Promise<boolean> {
  try {
    return await crypto.subtle.verify(ECDSA_SIGN, key, parsed.signature, utf8(parsed.signingInput));
  } catch {
    return false;
  }
}
