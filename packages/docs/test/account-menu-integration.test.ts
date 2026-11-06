import { afterEach, describe, expect, it, vi } from "vitest";
import { identity } from "../../identity/src/handler.js";
import { harness, signedInPerson } from "../../identity/test/support/index.js";
import { accountMenu } from "../src/account-menu.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("documentation navigation through the live Identity handler", () => {
  it("reflects persisted names, account changes and revocation without leaking additional cookies", async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("The integration does not use the network");
    });
    const h = await harness({ env: { ADMIN_SUBS: "owner" } });
    const owner = await signedInPerson(h, { id: "owner", name: "Original owner" });
    const ordinary = await signedInPerson(h, {
      id: "ordinary",
      name: "Original person",
      email: "person@example.com",
    });
    await h.store.setDisplayName(owner.user.id, "Owner from preferences");
    await h.store.setDisplayName(ordinary.user.id, "Person from preferences");
    const calls: Request[] = [];
    const env = {
      IDENTITY: {
        fetch: async (request: Request) => {
          calls.push(request);
          return identity(request, h.env, h.deps);
        },
      },
    };
    const discover = (cookie: string) =>
      accountMenu(
        new Request("https://docs.meltemi.dev/api/account-menu", {
          headers: {
            Cookie: `unrelated=private-value; ${cookie}`,
            Authorization: "Bearer do-not-forward",
            Origin: "https://docs.meltemi.dev",
          },
        }),
        env,
      );
    const first = await discover(owner.cookie);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      authenticated: true,
      name: "Owner from preferences",
      owner: true,
    });
    expect(first.headers.get("Cache-Control")).toBe("private, no-store");
    expect(first.headers.get("Vary")).toBe("Cookie");
    expect(first.headers.has("Set-Cookie")).toBe(false);
    expect(calls[0]!.url).toBe("https://id.meltemi.dev/api/navigation");
    expect([...calls[0]!.headers]).toEqual([
      ["accept", "application/json"],
      ["cookie", owner.cookie],
    ]);

    expect(await (await discover(ordinary.cookie)).json()).toEqual({
      authenticated: true,
      name: "Person from preferences",
      owner: false,
    });
    await h.store.setDisplayName(owner.user.id, "Updated without replacing the browser token");
    expect(await (await discover(owner.cookie)).json()).toEqual({
      authenticated: true,
      name: "Updated without replacing the browser token",
      owner: true,
    });
    await h.store.revokeSession(owner.session.sid, h.clock.now().toISOString());
    expect(await (await discover(owner.cookie)).json()).toEqual({ authenticated: false });
    expect(await (await discover(ordinary.cookie)).json()).toEqual({
      authenticated: true,
      name: "Person from preferences",
      owner: false,
    });
  });

  it("fails closed across storage failure and duplicate credentials, then recovers without retaining owner state", async () => {
    const h = await harness({ env: { ADMIN_SUBS: "owner" } });
    const owner = await signedInPerson(h, { id: "owner" });
    let calls = 0;
    const env = {
      IDENTITY: {
        fetch: async (request: Request) => {
          calls++;
          return identity(request, h.env, h.deps);
        },
      },
    };
    const discover = (cookie: string) =>
      accountMenu(
        new Request("https://docs.meltemi.dev/api/account-menu", { headers: { Cookie: cookie } }),
        env,
      );
    expect(await (await discover(owner.cookie)).json()).toEqual({
      authenticated: true,
      name: "Ana Dev",
      owner: true,
    });
    vi.spyOn(h.store, "session").mockRejectedValueOnce(new Error("private database details"));
    const unavailable = await discover(owner.cookie);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ reason: "unavailable" });
    expect(unavailable.headers.get("Cache-Control")).toBe("private, no-store");
    const before = calls;
    expect(await (await discover(`${owner.cookie}; ${owner.cookie}`)).json()).toEqual({
      authenticated: false,
    });
    expect(calls).toBe(before);
    await h.store.setDisplayName(owner.user.id, "Removed profile");
    await h.store.deleteUser(owner.user.id);
    expect(await (await discover(owner.cookie)).json()).toEqual({ authenticated: false });
    expect((await h.store.getAccountPreferences(owner.user.id)).displayName).toBeNull();
  });
});
