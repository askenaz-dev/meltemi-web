// Reads the signing keys from the Worker's settings: the private JWK that signs sessions and the
// public JWKs the key set publishes. Every message is written here and never repeats a setting's
// text (V8 quotes part of the text in a `JSON.parse` error), because the first setting holds a
// private key and the message is logged.

import type { Env } from "./env.js";
import { importSigningKeys, type PrivateJwk, type PublicJwk, type SigningKeys } from "./jwt.js";

/** A key setting the service cannot run with. The message is safe to log. */
export class KeyConfigError extends Error {
  override readonly name = "KeyConfigError";
}

function parseJson(name: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new KeyConfigError(`${name} is not JSON`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/**
 * Whether a record is a P-256 key with the fields a verifier needs, for signing (`use` `sig`,
 * `alg` `ES256`) when it names a use or an algorithm at all.
 */
function isSigningJwk(value: Record<string, unknown>): boolean {
  return (
    value["kty"] === "EC" &&
    value["crv"] === "P-256" &&
    (value["use"] === undefined || value["use"] === "sig") &&
    (value["alg"] === undefined || value["alg"] === "ES256") &&
    text(value["kid"]) &&
    text(value["x"]) &&
    text(value["y"])
  );
}

/**
 * The keys of `SESSION_PRIVATE_KEY` and `SESSION_PUBLIC_KEYS`. The private key must be a P-256 JWK
 * with a `kid`, and the public keys must publish its public half: a service whose sessions no
 * product can verify is a service that fails at once and in the open, not one that signs people in
 * and is refused everywhere.
 */
export async function readSigningKeys(
  env: Pick<Env, "SESSION_PRIVATE_KEY" | "SESSION_PUBLIC_KEYS">,
): Promise<SigningKeys> {
  if (!env.SESSION_PRIVATE_KEY) {
    throw new KeyConfigError("SESSION_PRIVATE_KEY is missing: run `pnpm identity:keys` and set it");
  }
  const privateJwk = parseJson("SESSION_PRIVATE_KEY", env.SESSION_PRIVATE_KEY);
  if (!isRecord(privateJwk) || !isSigningJwk(privateJwk) || !text(privateJwk["d"])) {
    throw new KeyConfigError("SESSION_PRIVATE_KEY is not a P-256 private JWK with a kid");
  }

  const published = parseJson("SESSION_PUBLIC_KEYS", env.SESSION_PUBLIC_KEYS || "[]");
  if (!Array.isArray(published) || !published.every(isRecord) || !published.every(isSigningJwk)) {
    throw new KeyConfigError("SESSION_PUBLIC_KEYS is not an array of P-256 public JWKs");
  }
  // The public keys as the key set publishes them: the public fields, for signing, nothing else
  // (a private part pasted among them stays out), so that the service verifies with the very keys
  // it publishes.
  const publicJwks: PublicJwk[] = published.map((key) => ({
    kty: "EC",
    crv: "P-256",
    use: "sig",
    alg: "ES256",
    kid: key["kid"] as string,
    x: key["x"] as string,
    y: key["y"] as string,
  }));
  const current = publicJwks.find((key) => key.kid === privateJwk["kid"]);
  if (!current || current.x !== privateJwk["x"] || current.y !== privateJwk["y"]) {
    throw new KeyConfigError(
      "SESSION_PUBLIC_KEYS does not publish the public half of SESSION_PRIVATE_KEY",
    );
  }

  try {
    return await importSigningKeys(privateJwk as PrivateJwk, publicJwks);
  } catch {
    throw new KeyConfigError("SESSION_PRIVATE_KEY is not a usable ES256 key");
  }
}
