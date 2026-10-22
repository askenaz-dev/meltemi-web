// Product-signed calls (`identity-session`, "Product-signed calls"): the canonical string, the
// signer products use, the service's check, and the test helper the package gives products.

import { describe, expect, it } from "vitest";
import { hmacHex, hex, sha256 } from "../src/crypto.js";
import {
  PRODUCT_CALL_WINDOW_MS,
  PRODUCT_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  bodyHash,
  canonicalString,
  signProductRequest,
  verifyProductRequest,
} from "../src/product-call.js";
import { signedProductCall } from "../src/testing.js";
import * as verifier from "../src/verify.js";

const URL_ACCOUNT = "https://id.meltemi.dev/api/account";
const SECRET = "test-events-secret";
const NOW = new Date("2026-10-21T12:00:00.000Z");
const secrets = (product: string) => (product === "diagrams" ? SECRET : undefined);

async function signed(
  init: {
    method?: string;
    url?: string;
    body?: string;
    secret?: string;
    product?: string;
    now?: Date;
  } = {},
): Promise<{ request: Request; body: string }> {
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  const url = init.url ?? URL_ACCOUNT;
  const headers = await signProductRequest({
    product: init.product ?? "diagrams",
    secret: init.secret ?? SECRET,
    method,
    url,
    ...(init.body !== undefined ? { body: init.body } : {}),
    now: init.now ?? NOW,
  });
  return {
    request: new Request(url, {
      method,
      headers,
      ...(init.body !== undefined ? { body: init.body } : {}),
    }),
    body: init.body ?? "",
  };
}

describe("the canonical string", () => {
  it("is the timestamp, the method in capitals, the path with its query and the body's hash", async () => {
    expect(
      canonicalString("2026-10-21T12:00:00.000Z", "post", "/api/account/unlink?x=1", "ab"),
    ).toBe("2026-10-21T12:00:00.000Z\nPOST\n/api/account/unlink?x=1\nab");
    expect(await bodyHash("")).toBe(hex(await sha256("")));
    expect(await bodyHash("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("signProductRequest", () => {
  it("writes the product, an ISO timestamp and a v1 HMAC-SHA256 over the canonical string", async () => {
    const headers = await signProductRequest({
      product: "diagrams",
      secret: SECRET,
      method: "POST",
      url: "https://id.meltemi.dev/api/account/unlink",
      body: '{"provider":"google"}',
      now: NOW,
    });
    expect(headers[PRODUCT_HEADER]).toBe("diagrams");
    expect(headers[TIMESTAMP_HEADER]).toBe("2026-10-21T12:00:00.000Z");
    const expected = await hmacHex(
      SECRET,
      canonicalString(
        "2026-10-21T12:00:00.000Z",
        "POST",
        "/api/account/unlink",
        await bodyHash('{"provider":"google"}'),
      ),
    );
    expect(headers[SIGNATURE_HEADER]).toBe(`v1=${expected}`);
  });
});

describe("verifyProductRequest", () => {
  it("names the product of a well-signed call", async () => {
    const { request, body } = await signed({ body: "{}" });
    expect(await verifyProductRequest(request, body, secrets, NOW)).toEqual({
      product: "diagrams",
    });
  });

  it("accepts a call up to five minutes either side of its clock, and not beyond", async () => {
    const { request, body } = await signed();
    const edge = new Date(NOW.getTime() + PRODUCT_CALL_WINDOW_MS);
    expect(await verifyProductRequest(request, body, secrets, edge)).toEqual({
      product: "diagrams",
    });
    const late = new Date(NOW.getTime() + 11 * 60_000);
    expect(await verifyProductRequest(request, body, secrets, late)).toBeUndefined();
    const early = new Date(NOW.getTime() - PRODUCT_CALL_WINDOW_MS - 1);
    expect(await verifyProductRequest(request, body, secrets, early)).toBeUndefined();
  });

  it("refuses another secret, an unknown product, and a product of the wrong shape", async () => {
    const other = await signed({ secret: "another-products-secret" });
    expect(await verifyProductRequest(other.request, other.body, secrets, NOW)).toBeUndefined();
    const unknown = await signed({ product: "nobody" });
    expect(await verifyProductRequest(unknown.request, unknown.body, secrets, NOW)).toBeUndefined();
    const shape = await signed({ product: "Diagrams" });
    expect(
      await verifyProductRequest(shape.request, shape.body, () => SECRET, NOW),
    ).toBeUndefined();
  });

  it("refuses a body, a path, a query or a method other than the ones signed", async () => {
    const { request } = await signed({
      body: '{"provider":"google"}',
      url: `${URL_ACCOUNT}/unlink`,
    });
    expect(
      await verifyProductRequest(request, '{"provider":"github"}', secrets, NOW),
    ).toBeUndefined();

    const path = await signed({ url: `${URL_ACCOUNT}/sessions/revoke-others`, body: "" });
    const moved = new Request(`${URL_ACCOUNT}/unlink`, {
      method: "POST",
      headers: path.request.headers,
    });
    expect(await verifyProductRequest(moved, "", secrets, NOW)).toBeUndefined();

    const query = await signed();
    const withQuery = new Request(`${URL_ACCOUNT}?x=1`, { headers: query.request.headers });
    expect(await verifyProductRequest(withQuery, "", secrets, NOW)).toBeUndefined();

    const method = await signed();
    const posted = new Request(URL_ACCOUNT, { method: "POST", headers: method.request.headers });
    expect(await verifyProductRequest(posted, "", secrets, NOW)).toBeUndefined();
  });

  it("refuses missing or malformed headers without reading anything else", async () => {
    const { request } = await signed();
    for (const name of [PRODUCT_HEADER, TIMESTAMP_HEADER, SIGNATURE_HEADER]) {
      const headers = new Headers(request.headers);
      headers.delete(name);
      expect(
        await verifyProductRequest(new Request(URL_ACCOUNT, { headers }), "", secrets, NOW),
        name,
      ).toBeUndefined();
    }
    for (const [name, value] of [
      [TIMESTAMP_HEADER, "21 October 2026"],
      [TIMESTAMP_HEADER, "2026-10-21T12:00:00+02:00"],
      [SIGNATURE_HEADER, "v2=00"],
      [SIGNATURE_HEADER, `v1=${"A".repeat(64)}`],
      [SIGNATURE_HEADER, "v1=zz"],
    ] as const) {
      const headers = new Headers(request.headers);
      headers.set(name, value);
      expect(
        await verifyProductRequest(new Request(URL_ACCOUNT, { headers }), "", secrets, NOW),
        value,
      ).toBeUndefined();
    }
  });
});

describe("the package", () => {
  it("exports the signer, the check and the header names from its main entry", () => {
    expect(verifier.signProductRequest).toBe(signProductRequest);
    expect(verifier.verifyProductRequest).toBe(verifyProductRequest);
    expect([verifier.PRODUCT_HEADER, verifier.TIMESTAMP_HEADER, verifier.SIGNATURE_HEADER]).toEqual(
      ["Meltemi-Product", "Meltemi-Timestamp", "Meltemi-Signature"],
    );
    expect(verifier.PRODUCT_CALL_WINDOW_MS).toBe(300_000);
  });

  it("gives products a helper that builds a signed call with the person's token", async () => {
    const request = await signedProductCall({
      product: "diagrams",
      secret: SECRET,
      url: `${URL_ACCOUNT}/unlink`,
      body: { provider: "google" },
      token: "a.b.c",
      now: NOW,
    });
    expect(request.method).toBe("POST");
    expect(request.headers.get("Authorization")).toBe("Bearer a.b.c");
    expect(request.headers.get("Content-Type")).toBe("application/json");
    const body = await request.clone().text();
    expect(body).toBe('{"provider":"google"}');
    expect(await verifyProductRequest(request, body, secrets, NOW)).toEqual({
      product: "diagrams",
    });

    const read = await signedProductCall({
      product: "diagrams",
      secret: SECRET,
      url: URL_ACCOUNT,
      token: "a.b.c",
      now: NOW,
    });
    expect(read.method).toBe("GET");
    expect(await verifyProductRequest(read, "", secrets, NOW)).toEqual({ product: "diagrams" });
  });
});
