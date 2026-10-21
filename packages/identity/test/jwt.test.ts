// The ES256 tokens (`src/jwt.ts`) and the WebCrypto helpers under them (`src/crypto.ts`): what the
// service signs sessions with and the verifier checks them with. The signature format is checked
// against Node's own crypto, so that the two sides do not only agree with each other.

import {
  createHmac,
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
} from "node:crypto";
import type { JsonWebKey as NodeJwk } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  base64url,
  fromBase64url,
  fromHex,
  fromUtf8,
  hex,
  hmacHex,
  hmacSha256,
  randomToken,
  sha256,
  utf8,
  uuid,
  verifyHmac,
  verifyHmacHex,
} from "../src/crypto.js";
import {
  generateKeyPair,
  importSigningKeys,
  importVerifyKey,
  parseJwt,
  signJwt,
  thumbprint,
  verifyJwtSignature,
  type PrivateJwk,
  type PublicJwk,
} from "../src/jwt.js";
import { seededRandom } from "./support/index.js";
import { encodePart } from "./support/tokens.js";

const claims = { iss: "https://id.meltemi.dev", sub: "user-1", name: "José Ñandú 日本" };

async function signed(payload: Record<string, unknown> = claims) {
  const { privateJwk, publicJwk } = await generateKeyPair();
  const keys = await importSigningKeys(privateJwk, [publicJwk]);
  return { privateJwk, publicJwk, keys, token: await signJwt(keys, payload) };
}

// ---------------------------------------------------------------------------------------------

describe("thumbprint", () => {
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
    y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
  };
  const canonicalDigest = (x: string, y: string) =>
    createHash("sha256")
      .update(`{"crv":"P-256","kty":"EC","x":"${x}","y":"${y}"}`)
      .digest("base64url");

  it("is the unpadded base64url SHA-256 of the canonical JSON of the required members (RFC 7638)", async () => {
    expect(await thumbprint(jwk)).toBe(canonicalDigest(jwk.x, jwk.y));
    expect(await thumbprint(jwk)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("does not depend on the order of the members or on the optional ones", async () => {
    const reordered = { y: jwk.y, x: jwk.x, crv: jwk.crv, kty: jwk.kty };
    const decorated = { ...jwk, use: "sig", alg: "ES256", kid: "anything", d: "secret" };
    expect(await thumbprint(reordered)).toBe(await thumbprint(jwk));
    expect(await thumbprint(decorated)).toBe(await thumbprint(jwk));
  });

  it("changes with the point", async () => {
    expect(await thumbprint({ ...jwk, x: jwk.y })).not.toBe(await thumbprint(jwk));
    expect(await thumbprint({ ...jwk, y: jwk.x })).not.toBe(await thumbprint(jwk));
  });
});

describe("generateKeyPair", () => {
  it("gives a private JWK and a public JWK for ES256 with the same kid", async () => {
    const { privateJwk, publicJwk } = await generateKeyPair();
    expect(publicJwk).toMatchObject({ kty: "EC", crv: "P-256", use: "sig", alg: "ES256" });
    expect(Object.keys(publicJwk).sort()).toEqual(["alg", "crv", "kid", "kty", "use", "x", "y"]);
    expect(Object.keys(privateJwk).sort()).toEqual([
      "alg",
      "crv",
      "d",
      "kid",
      "kty",
      "use",
      "x",
      "y",
    ]);
    expect({ ...privateJwk, d: undefined }).toEqual({ ...publicJwk, d: undefined });
  });

  it("names the pair by the thumbprint of its public point", async () => {
    const { publicJwk } = await generateKeyPair();
    expect(publicJwk.kid).toBe(await thumbprint(publicJwk));
  });

  it("gives coordinates and a secret of the length of the curve", async () => {
    const { privateJwk } = await generateKeyPair();
    for (const part of [privateJwk.x, privateJwk.y, privateJwk.d]) {
      expect(fromBase64url(part)).toHaveLength(32);
    }
  });

  it("is a point on the curve that Node accepts as a public key", async () => {
    const { publicJwk } = await generateKeyPair();
    const key = createPublicKey({ key: publicJwk as NodeJwk, format: "jwk" });
    expect(key.asymmetricKeyType).toBe("ec");
    expect(key.asymmetricKeyDetails?.namedCurve).toBe("prime256v1");
  });

  it("gives a different pair every time", async () => {
    const pairs = await Promise.all([generateKeyPair(), generateKeyPair(), generateKeyPair()]);
    expect(new Set(pairs.map((p) => p.privateJwk.d)).size).toBe(3);
    expect(new Set(pairs.map((p) => p.publicJwk.kid)).size).toBe(3);
  });
});

describe("importSigningKeys", () => {
  it("keeps the kid and the public keys to publish, and holds a key that only signs", async () => {
    const { privateJwk, publicJwk } = await generateKeyPair();
    const other = await generateKeyPair();
    const keys = await importSigningKeys(privateJwk, [publicJwk, other.publicJwk]);
    expect(keys.kid).toBe(publicJwk.kid);
    expect(keys.publicJwks).toEqual([publicJwk, other.publicJwk]);
    expect(keys.privateKey.type).toBe("private");
    expect(keys.privateKey.usages).toEqual(["sign"]);
    expect(keys.privateKey.extractable).toBe(false);
    expect(keys.privateKey.algorithm).toMatchObject({ name: "ECDSA", namedCurve: "P-256" });
  });

  it("does not let the key be exported again", async () => {
    const { privateJwk, publicJwk } = await generateKeyPair();
    const keys = await importSigningKeys(privateJwk, [publicJwk]);
    await expect(crypto.subtle.exportKey("jwk", keys.privateKey)).rejects.toThrow();
  });

  it("refuses a JWK that is not a private P-256 key", async () => {
    const { privateJwk, publicJwk } = await generateKeyPair();
    const broken: Record<string, unknown>[] = [
      { ...privateJwk, d: undefined },
      { ...privateJwk, d: "AAAA" },
      { ...privateJwk, crv: "P-384" },
      { ...privateJwk, kty: "RSA" },
      { ...privateJwk, x: "AAAA" },
      {},
    ];
    for (const jwk of broken) {
      await expect(importSigningKeys(jwk as unknown as PrivateJwk, [publicJwk])).rejects.toThrow();
    }
  });

  it("signs with the key it was given: the matching public key verifies, another does not", async () => {
    const { keys, token, publicJwk } = await signed();
    const parsed = parseJwt(token)!;
    expect(await verifyJwtSignature(parsed, (await importVerifyKey(publicJwk))!)).toBe(true);
    const other = await generateKeyPair();
    expect(await verifyJwtSignature(parsed, (await importVerifyKey(other.publicJwk))!)).toBe(false);
    expect(keys.kid).toBe(publicJwk.kid);
  });
});

describe("signJwt", () => {
  it("makes a compact JWS of three base64url parts", async () => {
    const { token } = await signed();
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("writes the header alg, typ, kid, and the claims as given", async () => {
    const { token, publicJwk } = await signed();
    const [header, payload] = token.split(".") as [string, string];
    expect(JSON.parse(fromUtf8(fromBase64url(header)!))).toEqual({
      alg: "ES256",
      typ: "JWT",
      kid: publicJwk.kid,
    });
    expect(Object.keys(JSON.parse(fromUtf8(fromBase64url(header)!)))).toEqual([
      "alg",
      "typ",
      "kid",
    ]);
    expect(JSON.parse(fromUtf8(fromBase64url(payload)!))).toEqual(claims);
  });

  it("signs the text of the first two parts, so what was written is what was signed", async () => {
    const { token } = await signed();
    const parsed = parseJwt(token)!;
    expect(parsed.signingInput).toBe(token.split(".").slice(0, 2).join("."));
  });

  it("makes the raw r and s of JWS, 64 bytes, not an ASN.1 DER signature", async () => {
    const { token } = await signed();
    expect(fromBase64url(token.split(".")[2]!)).toHaveLength(64);
  });

  it("makes a signature Node's crypto verifies as ES256 (IEEE P1363), with the public JWK", async () => {
    const { token, publicJwk } = await signed();
    const [header, payload, signature] = token.split(".") as [string, string, string];
    const key = createPublicKey({ key: publicJwk as NodeJwk, format: "jwk" });
    const ok = nodeVerify(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      { key, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );
    expect(ok).toBe(true);
  });

  it("verifies a token that Node signed, so the two implementations agree both ways", async () => {
    const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = pair.publicKey.export({ format: "jwk" }) as { x: string; y: string };
    const input = `${encodePart({ alg: "ES256", typ: "JWT", kid: "n" })}.${encodePart(claims)}`;
    const signature = nodeSign("sha256", Buffer.from(input), {
      key: pair.privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url");
    const parsed = parseJwt(`${input}.${signature}`)!;
    const key = await importVerifyKey({ kty: "EC", crv: "P-256", use: "sig", x: jwk.x, y: jwk.y });
    expect(await verifyJwtSignature(parsed, key!)).toBe(true);
  });

  it("signs the same claims differently each time (ECDSA is randomized), and both verify", async () => {
    const { keys, publicJwk } = await signed();
    const [a, b] = [await signJwt(keys, claims), await signJwt(keys, claims)];
    expect(a).not.toBe(b);
    const key = (await importVerifyKey(publicJwk))!;
    expect(await verifyJwtSignature(parseJwt(a)!, key)).toBe(true);
    expect(await verifyJwtSignature(parseJwt(b)!, key)).toBe(true);
  });

  it("keeps characters outside ASCII in the claims, as UTF-8", async () => {
    const { token } = await signed({ name: "Ñandú 日本 \u{1F600}" });
    expect(parseJwt(token)?.claims["name"]).toBe("Ñandú 日本 \u{1F600}");
  });
});

describe("parseJwt", () => {
  it("splits and decodes a token without judging it", async () => {
    const { token, publicJwk } = await signed();
    const parsed = parseJwt(token)!;
    expect(parsed.header).toEqual({ alg: "ES256", typ: "JWT", kid: publicJwk.kid });
    expect(parsed.claims).toEqual(claims);
    expect(parsed.signature).toHaveLength(64);
  });

  it("does not look at what the header says: that is the verifier's decision", () => {
    const token = `${encodePart({ alg: "none" })}.${encodePart({ a: 1 })}.`;
    const parsed = parseJwt(token);
    expect(parsed?.header).toEqual({ alg: "none" });
    expect(parsed?.signature).toHaveLength(0);
  });

  it.each<[string, string]>([
    ["an empty string", ""],
    ["one part", "abc"],
    ["two parts", `${encodePart({})}.${encodePart({})}`],
    ["four parts", `${encodePart({})}.${encodePart({})}.AAAA.AAAA`],
    ["a header that is not base64url", `*.${encodePart({})}.AAAA`],
    ["a payload that is not base64url", `${encodePart({})}.*.AAAA`],
    ["a signature that is not base64url", `${encodePart({})}.${encodePart({})}.*`],
    ["a header with padding", `${encodePart({})}=.${encodePart({})}.AAAA`],
    ["a part of an impossible length", `${encodePart({})}.${encodePart({})}.AAAAA`],
    ["a header that is not JSON", `${base64url(utf8("nope"))}.${encodePart({})}.AAAA`],
    ["a header that is an array", `${encodePart([])}.${encodePart({})}.AAAA`],
    ["a header that is null", `${encodePart(null)}.${encodePart({})}.AAAA`],
    ["a header that is a string", `${encodePart("ES256")}.${encodePart({})}.AAAA`],
    ["a payload that is not JSON", `${encodePart({})}.${base64url(utf8("{"))}.AAAA`],
    ["a payload that is an array", `${encodePart({})}.${encodePart([1])}.AAAA`],
    ["a payload that is a number", `${encodePart({})}.${encodePart(5)}.AAAA`],
    [
      "bytes that are not UTF-8 JSON",
      `${base64url(new Uint8Array([0xff, 0xfe]))}.${encodePart({})}.AAAA`,
    ],
  ])("gives undefined for %s", (_name, token) => {
    expect(parseJwt(token)).toBeUndefined();
  });
});

describe("importVerifyKey", () => {
  it("imports a public ES256 signing key for verification only", async () => {
    const { publicJwk } = await generateKeyPair();
    const key = (await importVerifyKey(publicJwk))!;
    expect(key.type).toBe("public");
    expect(key.usages).toEqual(["verify"]);
    expect(key.algorithm).toMatchObject({ name: "ECDSA", namedCurve: "P-256" });
  });

  it("imports the public half of a private JWK and nothing of its secret", async () => {
    const { privateJwk } = await generateKeyPair();
    const key = (await importVerifyKey(privateJwk))!;
    expect(key.type).toBe("public");
    expect(key.usages).toEqual(["verify"]);
  });

  it("accepts an entry that names use sig and no alg, and refuses one that names no use", async () => {
    const { publicJwk } = await generateKeyPair();
    const { alg: _alg, ...withoutAlg } = publicJwk;
    expect(await importVerifyKey(withoutAlg)).toBeDefined();
    const { use: _use, ...withoutUse } = publicJwk;
    expect(await importVerifyKey(withoutUse)).toBeUndefined();
    const { use: _use2, alg: _alg2, ...bare } = publicJwk;
    expect(await importVerifyKey(bare)).toBeUndefined();
  });

  it.each<[string, Record<string, unknown>]>([
    ["another kty", { kty: "RSA" }],
    ["no kty", { kty: undefined }],
    ["another curve", { crv: "P-384" }],
    ["no curve", { crv: undefined }],
    ["use enc", { use: "enc" }],
    ["no use", { use: undefined }],
    ["use that is not text", { use: 1 }],
    ["another alg", { alg: "RS256" }],
    ["alg HS256", { alg: "HS256" }],
    ["an x that is a number", { x: 1 }],
    ["no x", { x: undefined }],
    ["a y that is null", { y: null }],
    ["no y", { y: undefined }],
    ["an x that is not a point of the curve", { x: "AAAA" }],
    ["coordinates of the wrong length", { x: "AA", y: "AA" }],
  ])("gives undefined for %s", async (_name, change) => {
    const { publicJwk } = await generateKeyPair();
    expect(await importVerifyKey({ ...publicJwk, ...change })).toBeUndefined();
  });

  it("gives undefined for an entry that is empty", async () => {
    expect(await importVerifyKey({})).toBeUndefined();
  });
});

describe("verifyJwtSignature", () => {
  it("is true for the signature of the signing input by the key", async () => {
    const { token, publicJwk } = await signed();
    expect(await verifyJwtSignature(parseJwt(token)!, (await importVerifyKey(publicJwk))!)).toBe(
      true,
    );
  });

  it("is false for a signature with any single bit flipped", async () => {
    const { token, publicJwk } = await signed();
    const key = (await importVerifyKey(publicJwk))!;
    const parsed = parseJwt(token)!;
    for (const index of [0, 1, 31, 32, 33, 63]) {
      const bytes = new Uint8Array(parsed.signature);
      bytes[index] = bytes[index]! ^ 0x01;
      expect(await verifyJwtSignature({ ...parsed, signature: bytes }, key), `byte ${index}`).toBe(
        false,
      );
    }
  });

  it("is false when the signing input is not the signed one", async () => {
    const { token, publicJwk } = await signed();
    const key = (await importVerifyKey(publicJwk))!;
    const parsed = parseJwt(token)!;
    expect(
      await verifyJwtSignature({ ...parsed, signingInput: `${parsed.signingInput} ` }, key),
    ).toBe(false);
    expect(await verifyJwtSignature({ ...parsed, signingInput: "" }, key)).toBe(false);
  });

  it("is false, not an exception, for a signature of the wrong shape", async () => {
    const { token, publicJwk } = await signed();
    const key = (await importVerifyKey(publicJwk))!;
    const parsed = parseJwt(token)!;
    const shapes = [
      new Uint8Array(0),
      parsed.signature.slice(0, 63),
      new Uint8Array([...parsed.signature, 0]),
      new Uint8Array(64),
      new Uint8Array(64).fill(0xff),
    ];
    for (const signature of shapes) {
      expect(
        await verifyJwtSignature({ ...parsed, signature }, key),
        `${signature.length} bytes`,
      ).toBe(false);
    }
  });

  it("is false, not an exception, when the key cannot verify ES256 at all", async () => {
    const { keys, token } = await signed();
    const parsed = parseJwt(token)!;
    // A key that only signs, and a key for another algorithm: WebCrypto refuses both.
    expect(await verifyJwtSignature(parsed, keys.privateKey)).toBe(false);
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      utf8("secret"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    expect(await verifyJwtSignature(parsed, hmacKey)).toBe(false);
  });

  it("is false for an ASN.1 DER signature, which is not what JWS carries", async () => {
    const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = pair.publicKey.export({ format: "jwk" }) as { x: string; y: string };
    const input = `${encodePart({ alg: "ES256" })}.${encodePart(claims)}`;
    const der = nodeSign("sha256", Buffer.from(input), pair.privateKey); // DER by default
    expect(der.length).toBeGreaterThan(64);
    const key = (await importVerifyKey({ kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }))!;
    const parsed = { header: {}, claims: {}, signingInput: input, signature: new Uint8Array(der) };
    expect(await verifyJwtSignature(parsed, key)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------

describe("crypto helpers", () => {
  describe("base64url", () => {
    it.each([
      ["", ""],
      ["f", "Zg"],
      ["fo", "Zm8"],
      ["foo", "Zm9v"],
      ["foob", "Zm9vYg"],
      ["fooba", "Zm9vYmE"],
      ["foobar", "Zm9vYmFy"],
    ])("encodes %j as %s, without padding (RFC 4648)", (text, encoded) => {
      expect(base64url(utf8(text))).toBe(encoded);
      expect(fromUtf8(fromBase64url(encoded)!)).toBe(text);
    });

    it("uses the URL-safe alphabet", () => {
      expect(base64url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
      expect(base64url(new Uint8Array([0xfb, 0xef, 0xbe]))).toBe("----");
      expect(base64url(new Uint8Array([0xff, 0xff, 0xff]))).toBe("____");
      expect([...fromBase64url("-_8")!]).toEqual([0xfb, 0xff]);
    });

    it("round-trips every length from 0 to 70 bytes, and a large array", () => {
      const random = seededRandom(3);
      for (let length = 0; length <= 70; length++) {
        const bytes = random(length);
        expect([...fromBase64url(base64url(bytes))!], `${length} bytes`).toEqual([...bytes]);
      }
      const large = random(100_000);
      expect(base64url(large)).toBe(Buffer.from(large).toString("base64url"));
      expect([...fromBase64url(base64url(large))!]).toEqual([...large]);
    });

    it("agrees with Node's base64url", () => {
      const random = seededRandom(5);
      for (let length = 0; length < 40; length++) {
        const bytes = random(length);
        expect(base64url(bytes)).toBe(Buffer.from(bytes).toString("base64url"));
      }
    });

    it.each([
      "A",
      "AAAAA",
      "a+b",
      "a/b",
      "ab==",
      "ab cd",
      "ab\ncd",
      "ab.cd",
      "é",
      "%41%41",
      "A\u0000",
    ])("does not decode %j", (text) => {
      expect(fromBase64url(text)).toBeUndefined();
    });

    it("decodes the empty string to no bytes", () => {
      expect(fromBase64url("")).toHaveLength(0);
    });
  });

  describe("utf8", () => {
    it("round-trips text outside ASCII", () => {
      for (const text of ["", "ascii", "José Ñandú", "日本語", "\u{1F600}", "a\u0000b"]) {
        expect(fromUtf8(utf8(text))).toBe(text);
      }
      expect([...utf8("é")]).toEqual([0xc3, 0xa9]);
    });
  });

  describe("hex", () => {
    it("writes lowercase pairs and reads them back, uppercase too", () => {
      expect(hex(new Uint8Array([0, 1, 15, 16, 255]))).toBe("00010f10ff");
      expect([...fromHex("00010f10ff")!]).toEqual([0, 1, 15, 16, 255]);
      expect([...fromHex("00010F10FF")!]).toEqual([0, 1, 15, 16, 255]);
      expect(fromHex("")).toHaveLength(0);
    });

    it.each(["0", "abc", "zz", "0x00", "00 01", "g0", "é0", "00\n"])("does not read %j", (text) => {
      expect(fromHex(text)).toBeUndefined();
    });
  });

  describe("HMAC-SHA256", () => {
    it("matches the test vectors of RFC 4231", async () => {
      expect(await hmacHex("\u000b".repeat(20), "Hi There")).toBe(
        "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
      );
      expect(await hmacHex("Jefe", "what do ya want for nothing?")).toBe(
        "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
      );
    });

    it("agrees with Node, for text outside ASCII too", async () => {
      for (const data of ["", "x", "José Ñandú 日本", "a".repeat(10_000)]) {
        const expected = createHmac("sha256", "secret-ñ").update(data).digest("hex");
        expect(await hmacHex("secret-ñ", data)).toBe(expected);
        expect(hex(await hmacSha256("secret-ñ", data))).toBe(expected);
      }
    });

    it("verifies its own signature and refuses any other", async () => {
      const mac = await hmacSha256("secret", "data");
      expect(await verifyHmac("secret", "data", mac)).toBe(true);
      expect(await verifyHmac("other", "data", mac)).toBe(false);
      expect(await verifyHmac("secret", "datb", mac)).toBe(false);
      expect(await verifyHmac("secret", "data", mac.slice(0, 31))).toBe(false);
      expect(await verifyHmac("secret", "data", new Uint8Array(0))).toBe(false);
      expect(await verifyHmac("secret", "data", new Uint8Array(32))).toBe(false);
    });

    it("verifies a hexadecimal signature, and is false for text that is not one", async () => {
      const mac = await hmacHex("secret", "data");
      expect(await verifyHmacHex("secret", "data", mac)).toBe(true);
      expect(await verifyHmacHex("secret", "data", mac.toUpperCase())).toBe(true);
      expect(await verifyHmacHex("other", "data", mac)).toBe(false);
      expect(await verifyHmacHex("secret", "data", "")).toBe(false);
      expect(await verifyHmacHex("secret", "data", "zz".repeat(32))).toBe(false);
      expect(await verifyHmacHex("secret", "data", mac.slice(1))).toBe(false);
    });
  });

  describe("sha256", () => {
    it("matches the test vectors, for text and for bytes", async () => {
      expect(hex(await sha256("abc"))).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
      expect(hex(await sha256(""))).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
      expect(hex(await sha256(utf8("abc")))).toBe(hex(await sha256("abc")));
    });
  });

  describe("randomToken", () => {
    it("is the base64url of the bytes drawn: 32 by default, as many as asked", () => {
      const random = seededRandom(11);
      expect(randomToken(random)).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(randomToken(random, 16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(randomToken(random, 1)).toMatch(/^[A-Za-z0-9_-]{2}$/);
    });

    it("is deterministic with the same randomness and different with the next draw", () => {
      expect(randomToken(seededRandom(11))).toBe(randomToken(seededRandom(11)));
      const random = seededRandom(11);
      expect(randomToken(random)).not.toBe(randomToken(random));
    });

    it("asks the injected source for exactly the length it needs", () => {
      const asked: number[] = [];
      randomToken((length) => {
        asked.push(length);
        return new Uint8Array(length);
      }, 24);
      expect(asked).toEqual([24]);
    });
  });

  describe("uuid", () => {
    const shape = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    it("is a version 4 UUID whatever bytes are drawn", () => {
      for (const fill of [0x00, 0xff, 0x55, 0xaa]) {
        expect(uuid(() => new Uint8Array(16).fill(fill))).toMatch(shape);
      }
      const random = seededRandom(9);
      for (let i = 0; i < 50; i++) expect(uuid(random)).toMatch(shape);
    });

    it("is made from the injected randomness only, and leaves the bytes it was given alone", () => {
      const bytes = new Uint8Array(16).fill(0xff);
      const copy = new Uint8Array(bytes);
      expect(uuid(() => bytes)).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
      expect([...bytes]).toEqual([...copy]);
      expect(uuid(seededRandom(9))).toBe(uuid(seededRandom(9)));
    });

    it("is different for different draws", () => {
      const random = seededRandom(9);
      expect(new Set(Array.from({ length: 100 }, () => uuid(random))).size).toBe(100);
    });
  });
});

describe("the types", () => {
  it("make a PublicJwk assignable from what the script prints and a PrivateJwk from its private line", async () => {
    const { privateJwk, publicJwk } = await generateKeyPair();
    const asPublic: PublicJwk = JSON.parse(JSON.stringify(publicJwk)) as PublicJwk;
    const asPrivate: PrivateJwk = JSON.parse(JSON.stringify(privateJwk)) as PrivateJwk;
    expect((await importSigningKeys(asPrivate, [asPublic])).kid).toBe(asPublic.kid);
  });
});
