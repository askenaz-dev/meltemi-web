import { describe, expect, it, vi } from "vitest";
import { accountMenu } from "../src/account-menu.js";
const request = (headers: HeadersInit = {}, method = "GET") =>
  new Request("https://docs.meltemi.dev/api/account-menu", { method, headers });
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
describe("private documentation account discovery", () => {
  it("forwards only one session cookie to a fixed Identity path", async () => {
    const fetch = vi.fn(async (r: Request) => {
      expect(r.url).toBe("https://id.meltemi.dev/api/navigation");
      expect(r.method).toBe("GET");
      expect([...r.headers]).toEqual([
        ["accept", "application/json"],
        ["cookie", "meltemi_session=abc.def.ghi"],
      ]);
      return json({ authenticated: true, name: "Owner", owner: true });
    });
    const response = await accountMenu(
      request({
        Cookie: "other=secret; meltemi_session=abc.def.ghi",
        Authorization: "Bearer private",
        Referer: "https://docs.meltemi.dev/private",
        "CF-Connecting-IP": "127.0.0.1",
      }),
      { IDENTITY: { fetch } },
    );
    expect(await response.json()).toEqual({ authenticated: true, name: "Owner", owner: true });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
  });
  it("makes no service request for anonymous, malformed, duplicate, or offline fixture credentials", async () => {
    const fetch = vi.fn(async () => json({ authenticated: true, name: "Owner", owner: true }));
    for (const cookie of [
      "",
      "meltemi_session=garbage",
      "meltemi_session=abc.def.ghi; meltemi_session=jkl.mno.pqr",
    ])
      expect(
        await (await accountMenu(request({ Cookie: cookie }), { IDENTITY: { fetch } })).json(),
      ).toEqual({ authenticated: false });
    expect(
      await (
        await accountMenu(request({ Cookie: "meltemi_session=abc.def.ghi" }), {
          ASK_STUB: "fixture",
          IDENTITY: { fetch },
        })
      ).json(),
    ).toEqual({ authenticated: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { authenticated: true, name: "Owner", owner: "true" },
    { authenticated: false, owner: true },
    { authenticated: true, name: "Owner", owner: true, email: "secret@example.test" },
    {},
  ])("refuses a malformed upstream payload %j", async (payload) => {
    const response = await accountMenu(request({ Cookie: "meltemi_session=abc.def.ghi" }), {
      IDENTITY: { fetch: async () => json(payload) },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ reason: "unavailable" });
  });
  it("refuses cross-site requests and methods without touching the service", async () => {
    const fetch = vi.fn(async () => json({ authenticated: false }));
    expect(
      (await accountMenu(request({ Origin: "https://evil.example" }), { IDENTITY: { fetch } }))
        .status,
    ).toBe(403);
    expect((await accountMenu(request({}, "POST"), { IDENTITY: { fetch } })).status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not follow redirects, expose upstream errors, or parse an oversized response", async () => {
    for (const answer of [
      new Response(null, { status: 302, headers: { Location: "https://evil.example" } }),
      new Response("private failure", { status: 500 }),
      json({ authenticated: true, name: "x".repeat(5000), owner: true }),
    ]) {
      const response = await accountMenu(request({ Cookie: "meltemi_session=abc.def.ghi" }), {
        IDENTITY: {
          fetch: async (r) => {
            expect(r.redirect).toBe("manual");
            return answer;
          },
        },
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ reason: "unavailable" });
    }
  });

  it("times out a response body that never completes and cancels the stream", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    try {
      const work = accountMenu(request({ Cookie: "meltemi_session=abc.def.ghi" }), {
        IDENTITY: {
          fetch: async () =>
            new Response(new ReadableStream({ cancel }), {
              headers: { "Content-Type": "application/json" },
            }),
        },
      });
      await vi.advanceTimersByTimeAsync(3001);
      const response = await work;
      expect(response.status).toBe(503);
      expect(cancel).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
