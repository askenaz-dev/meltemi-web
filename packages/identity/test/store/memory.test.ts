import { describe, expect, it } from "vitest";
import { memoryOutbox, memoryStore } from "../../src/store/memory.js";
import { d1Store } from "../../src/store/d1.js";
import { runStoreConformance } from "./conformance.js";

runStoreConformance("memoryStore", () => {
  const store = memoryStore();
  return { store, outbox: async () => memoryOutbox(store) };
});

describe("memoryStore", () => {
  it("gives every call its own store: two stores share nothing", async () => {
    const a = memoryStore();
    const b = memoryStore();
    await a.createUser({
      id: "u1",
      name: "Ana",
      picture: "",
      createdAt: "2026-10-14T12:00:00.000Z",
    });
    expect(await b.userById("u1")).toBeUndefined();
  });

  it("deletes a user and queues its events as one step: events that cannot be read change nothing", async () => {
    const store = memoryStore();
    const user = { id: "u1", name: "Ana", picture: "", createdAt: "2026-10-14T12:00:00.000Z" };
    await store.createUser(user);
    await store.addIdentity({
      provider: "github",
      providerId: "gh-1",
      userId: "u1",
      email: "ana@example.com",
      emailVerified: true,
      verifiedAt: user.createdAt,
      handle: "ana-dev",
      linkedAt: user.createdAt,
    });
    await store.createSession({
      sid: "sid-1",
      userId: "u1",
      createdAt: user.createdAt,
      lastSeen: user.createdAt,
      expiresAt: "2026-11-13T12:00:00.000Z",
      label: "Edge on Windows",
      revokedAt: null,
    });
    const event = {
      id: "evt_1",
      product: "diagrams",
      body: "{}",
      createdAt: user.createdAt,
      attempts: 0,
      nextAt: user.createdAt,
      deliveredAt: null,
      failedAt: null,
    };
    // The second event fails when it is read, after the first one was.
    const failing = new Proxy([event, { ...event, id: "evt_2" }], {
      get(target, property, receiver) {
        if (property === "1") throw new Error("the second event cannot be read");
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    await expect(store.deleteUser("u1", failing)).rejects.toThrow(/cannot be read/);

    expect(await store.userById("u1")).toEqual(user);
    expect(await store.identitiesOf("u1")).toHaveLength(1);
    expect(await store.session("sid-1")).toBeDefined();
    expect(memoryOutbox(store)).toEqual([]);

    await store.deleteUser("u1", [event]);
    expect(await store.userById("u1")).toBeUndefined();
    expect(memoryOutbox(store).map((e) => e.id)).toEqual(["evt_1"]);
  });

  it("copies the events it queues: changing the list or an event afterwards changes nothing", async () => {
    const store = memoryStore();
    const event = {
      id: "evt_1",
      product: "diagrams",
      body: "{}",
      createdAt: "2026-10-14T12:00:00.000Z",
      attempts: 0,
      nextAt: "2026-10-14T12:00:00.000Z",
      deliveredAt: null,
      failedAt: null,
    };
    const given = [event];
    await store.deleteUser("u1", given);
    given.push({ ...event, id: "evt_2" });
    (event as { body: string }).body = "changed";
    expect(memoryOutbox(store)).toEqual([{ ...event, body: "{}" }]);
  });

  it("shows the outbox rows only of a store that memoryStore made", () => {
    expect(memoryOutbox(memoryStore())).toEqual([]);
    expect(() => memoryOutbox({} as never)).toThrow(/memoryStore/);
    // A different implementation of the interface is not a memory store.
    expect(() =>
      memoryOutbox(d1Store({ prepare: () => ({}) as never, batch: async () => [] })),
    ).toThrow(/memoryStore/);
  });
});
