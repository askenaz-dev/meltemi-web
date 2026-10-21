// WebCrypto helpers shared by the service and the reference verifier. Nothing here touches Node
// or Cloudflare APIs: it runs in Node 22, in Workers and in browsers.

/** Bytes that WebCrypto accepts as a `BufferSource`. */
export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8(text: string): Bytes {
  // Copied into a plain ArrayBuffer: some type environments type `encode` as ArrayBufferLike.
  return new Uint8Array(encoder.encode(text));
}

export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The bytes of a base64url text without padding, or undefined when it is not one. */
export function fromBase64url(text: string): Bytes | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return undefined;
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}

export function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(text: string): Bytes | undefined {
  if (!/^(?:[0-9a-f]{2})*$/i.test(text)) return undefined;
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function hmacKey(secret: string, usages: ("sign" | "verify")[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    utf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

export async function hmacSha256(secret: string, data: string): Promise<Bytes> {
  const key = await hmacKey(secret, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(data)));
}

export async function hmacHex(secret: string, data: string): Promise<string> {
  return hex(await hmacSha256(secret, data));
}

/** Checks an HMAC-SHA256 in constant time (`crypto.subtle.verify` compares in the platform). */
export async function verifyHmac(
  secret: string,
  data: string,
  signature: Uint8Array,
): Promise<boolean> {
  const key = await hmacKey(secret, ["verify"]);
  return crypto.subtle.verify("HMAC", key, signature as Bytes, utf8(data));
}

/** The same check for a hexadecimal signature; false when the text is not hexadecimal. */
export async function verifyHmacHex(
  secret: string,
  data: string,
  signature: string,
): Promise<boolean> {
  const bytes = fromHex(signature);
  return bytes !== undefined && (await verifyHmac(secret, data, bytes));
}

export async function sha256(data: string | Uint8Array): Promise<Bytes> {
  const bytes = typeof data === "string" ? utf8(data) : (data as Bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

/** A random token in base64url, `length` bytes before encoding. */
export function randomToken(randomBytes: (length: number) => Uint8Array, length = 32): string {
  return base64url(randomBytes(length));
}

/** A version 4 UUID from injected randomness, so that tests are deterministic. */
export function uuid(randomBytes: (length: number) => Uint8Array): string {
  const b = Uint8Array.from(randomBytes(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
