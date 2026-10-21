// Prints a new ES256 signing pair for the session tokens: the private JWK for SESSION_PRIVATE_KEY
// and the public JWK to prepend to SESSION_PUBLIC_KEYS. Both carry the same `kid` (the RFC 7638
// thumbprint). It writes nothing to a file: put the values where they belong yourself.
//
// Usage: pnpm identity:keys

import { createHash, webcrypto } from "node:crypto";

const { subtle } = webcrypto;

const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const { x, y, d } = await subtle.exportKey("jwk", pair.privateKey);
const kid = createHash("sha256")
  .update(JSON.stringify({ crv: "P-256", kty: "EC", x, y }))
  .digest("base64url");
const publicJwk = { kty: "EC", crv: "P-256", x, y, use: "sig", alg: "ES256", kid };
const privateJwk = { ...publicJwk, d };

console.log("SESSION_PRIVATE_KEY (a secret; never commit it):");
console.log(JSON.stringify(privateJwk));
console.log("");
console.log("Add this to SESSION_PUBLIC_KEYS (a JSON array, current key first):");
console.log(JSON.stringify(publicJwk));
