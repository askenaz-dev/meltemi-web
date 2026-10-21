import { describe, expect, it, vi } from "vitest";
import { harness, signedInPerson, textOf } from "./support/index.js";

describe("the handler", () => {
  it("answers 404 to an unknown route, with the policy headers of a page", async () => {
    const h = await harness();
    const response = await h.request("/nothing-here");
    expect(response.status).toBe(404);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toMatch(/^default-src 'none'/);
    expect(await textOf(response)).toContain("not-found");
  });

  it("answers 404 to a known path with another method", async () => {
    const h = await harness();
    expect((await h.request("/account/delete", { method: "GET" })).status).toBe(404);
    expect((await h.request("/identity.css", { method: "POST" })).status).toBe(404);
  });

  it("serves the stylesheet", async () => {
    const h = await harness();
    const response = await h.request("/identity.css");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/css");
    expect(await textOf(response)).toContain("--mel-aegean: #2563eb");
  });

  it("publishes the public keys and nothing private", async () => {
    const h = await harness();
    const response = await h.request("/.well-known/jwks.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    const body = (await response.json()) as { keys: Record<string, unknown>[] };
    expect(body.keys).toHaveLength(1);
    expect(Object.keys(body.keys[0]!).sort()).toEqual([
      "alg",
      "crv",
      "kid",
      "kty",
      "use",
      "x",
      "y",
    ]);
    expect(body.keys[0]).toMatchObject({ kty: "EC", crv: "P-256", use: "sig", alg: "ES256" });
  });

  it("treats a cookie that is not a token as signed out, not as an error", async () => {
    const h = await harness();
    const response = await h.request("/", { headers: { Cookie: "meltemi_session=not-a-token" } });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login");
  });

  it("answers an unexpected failure with a page that holds no detail", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    // Make the store fail the way an unexpected bug would, with a message that must stay unseen.
    h.deps.store.session = async () => {
      throw new Error("secret detail that must not be shown");
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await h.request("/", { headers: { Cookie: person.cookie } });
    logged.mockRestore();
    expect(response.status).toBe(500);
    const page = await textOf(response);
    expect(page).toContain("internal");
    expect(page).not.toContain("secret detail");
  });

  it("refuses to run with an invalid configuration, without naming a secret", async () => {
    const h = await harness({ env: { PRODUCTS: "not json" } });
    const response = await h.request("/login");
    expect(response.status).toBe(500);
    expect(await textOf(response)).toBe("The service is not configured.");
  });
});
