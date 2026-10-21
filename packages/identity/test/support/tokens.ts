// Tokens that a careful verifier must handle: signed on purpose with whatever header and claims a
// test names, and altered in the ways an attacker would try. The service never makes these.

import { base64url, fromBase64url, fromUtf8, utf8 } from "../../src/crypto.js";
import { importSigningKeys } from "../../src/jwt.js";
import type { TestKeys } from "../../src/testing.js";

/** The instant most tests start at. */
export const T0 = new Date("2026-10-14T12:00:00.000Z");
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
/** The lifetime of a session and of its token. */
export const THIRTY_DAYS_SECONDS = 2_592_000;

/** `T0` moved by some milliseconds. */
export function after(ms: number, from: Date = T0): Date {
  return new Date(from.getTime() + ms);
}

/** The base64url of a value's JSON, as one part of a token. */
export function encodePart(value: unknown): string {
  return base64url(utf8(JSON.stringify(value)));
}

/** The JSON a token part holds. */
export function decodePart(part: string): Record<string, unknown> {
  const bytes = fromBase64url(part);
  if (!bytes) throw new Error("not base64url");
  return JSON.parse(fromUtf8(bytes)) as Record<string, unknown>;
}

/** The decoded header and claims of a compact token. */
export function decodeToken(token: string): {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
  signature: string;
} {
  const [header, claims, signature] = token.split(".") as [string, string, string];
  return { header: decodePart(header), claims: decodePart(claims), signature };
}

/** Every claim of a session token, as the service makes them; `overrides` replace some. */
export function fullClaims(
  now: Date = T0,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const iat = Math.floor(now.getTime() / 1000);
  return {
    iss: "https://id.meltemi.dev",
    aud: "meltemi",
    sub: "user-1",
    sid: "sid-0123456789abcdefghijklmnopqrstuvwxyzABCDEFG",
    name: "Ana Dev",
    picture: "https://avatars.githubusercontent.com/u/4242",
    email: "ana@example.com",
    email_verified: true,
    iat,
    exp: iat + THIRTY_DAYS_SECONDS,
    ...overrides,
  };
}

/** The header the service writes. */
export function goodHeader(keys: TestKeys): Record<string, unknown> {
  return { alg: "ES256", typ: "JWT", kid: keys.publicJwk.kid };
}

/**
 * A token whose signature is a real ES256 signature of `<header>.<payload>` by `keys`, whatever
 * the header says: it isolates the one thing a test changed (the `typ`, the `kid`, a claim).
 */
export async function craftToken(
  keys: TestKeys,
  header: Record<string, unknown>,
  claims: unknown,
): Promise<string> {
  const signing = await importSigningKeys(keys.privateJwk, [keys.publicJwk]);
  const input = `${encodePart(header)}.${encodePart(claims)}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signing.privateKey, utf8(input)),
  );
  return `${input}.${base64url(signature)}`;
}

/** A token with another `kid` than the key's own, signed by that key. */
export function craftWithKid(
  keys: TestKeys,
  kid: unknown,
  claims: unknown = fullClaims(),
): Promise<string> {
  return craftToken(keys, { alg: "ES256", typ: "JWT", kid }, claims);
}

/** The token with one character of its payload changed and the old signature kept. */
export function withPayloadCharacterChanged(token: string, index: number): string {
  const [header, payload, signature] = token.split(".") as [string, string, string];
  const at = index < 0 ? payload.length + index : index;
  const original = payload[at]!;
  const replacement = original === "A" ? "B" : "A";
  return `${header}.${payload.slice(0, at)}${replacement}${payload.slice(at + 1)}.${signature}`;
}

/** The token with its claims replaced and the old signature kept. */
export function withClaims(token: string, claims: unknown): string {
  const [header, , signature] = token.split(".") as [string, string, string];
  return `${header}.${encodePart(claims)}.${signature}`;
}
