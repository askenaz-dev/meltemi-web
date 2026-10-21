// The contract of `IdentityStore` (src/store/types.ts) as one suite, run over every
// implementation: `memoryStore()` in memory.test.ts and `d1Store()` over node:sqlite in
// d1.test.ts. A behavior the handlers depend on is pinned here once, so the in-memory store the
// handler tests use cannot drift from the SQL one the Worker uses.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IdentityStore } from "../../src/store/types.js";
import type { Identity, Iso, OutboxEvent, Session, User } from "../../src/types.js";

/** A store under test, with the one thing the interface cannot show: every outbox row. */
export interface StoreUnderTest {
  readonly store: IdentityStore;
  /** Every outbox row, delivered and failed ones included (`dueEvents` shows only the due). */
  outbox(): Promise<OutboxEvent[]>;
  /** Releases what the store holds (a database), after each test. */
  close?(): void | Promise<void>;
}

const T0 = Date.parse("2026-10-14T12:00:00.000Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** An ISO time `ms` milliseconds after the suite's origin. */
const at = (ms: number): Iso => new Date(T0 + ms).toISOString();

const aUser = (over: Partial<User> = {}): User => ({
  id: "u1",
  name: "Ana Dev",
  picture: "https://avatars.githubusercontent.com/u/4242",
  createdAt: at(0),
  ...over,
});

const anIdentity = (over: Partial<Identity> = {}): Identity => ({
  provider: "github",
  providerId: "gh-1",
  userId: "u1",
  email: "ana@example.com",
  emailVerified: true,
  verifiedAt: at(0),
  handle: "ana-dev",
  linkedAt: at(0),
  ...over,
});

const aSession = (over: Partial<Session> = {}): Session => ({
  sid: "sid-1",
  userId: "u1",
  createdAt: at(0),
  lastSeen: at(0),
  expiresAt: at(30 * DAY),
  label: "Edge on Windows",
  revokedAt: null,
  ...over,
});

const anEvent = (over: Partial<OutboxEvent> = {}): OutboxEvent => ({
  id: "evt_1",
  product: "diagrams",
  body: '{"id":"evt_1","type":"user.deleted","sub":"u1","at":"2026-10-14T12:00:00.000Z"}',
  createdAt: at(0),
  attempts: 0,
  nextAt: at(0),
  deliveredAt: null,
  failedAt: null,
  ...over,
});

function present<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected a value, got none");
  return value;
}

/** Runs the contract over the store `factory` makes (a fresh, empty one for each test). */
export function runStoreConformance(
  name: string,
  factory: () => StoreUnderTest | Promise<StoreUnderTest>,
): void {
  describe(`${name}: the IdentityStore contract`, () => {
    let under: StoreUnderTest;
    let store: IdentityStore;

    beforeEach(async () => {
      under = await factory();
      store = under.store;
    });

    afterEach(async () => {
      await under.close?.();
    });

    /** Users the identities and sessions of a test belong to. */
    const seedUsers = async (...ids: string[]) => {
      for (const id of ids) await store.createUser(aUser({ id, name: `Person ${id}` }));
    };

    const outboxRow = async (id: string) =>
      present((await under.outbox()).find((event) => event.id === id));

    describe("users", () => {
      it("stores a user and reads it back whole", async () => {
        const user = aUser({ createdAt: at(5 * SECOND) });
        await store.createUser(user);
        expect(await store.userById("u1")).toEqual(user);
      });

      it("answers undefined for a user that does not exist", async () => {
        expect(await store.userById("nobody")).toBeUndefined();
        await store.createUser(aUser());
        expect(await store.userById("u2")).toBeUndefined();
        expect(await store.userById("")).toBeUndefined();
      });

      it("refuses a second user with the same id and keeps the first", async () => {
        await store.createUser(aUser({ name: "First" }));
        await expect(store.createUser(aUser({ name: "Second" }))).rejects.toThrow();
        expect((await store.userById("u1"))?.name).toBe("First");
      });

      it("updates the name and picture and nothing else", async () => {
        await store.createUser(aUser({ createdAt: at(SECOND) }));
        await store.updateUser("u1", { name: "Ana B.", picture: "https://example.com/new.png" });
        expect(await store.userById("u1")).toEqual({
          id: "u1",
          name: "Ana B.",
          picture: "https://example.com/new.png",
          createdAt: at(SECOND),
        });
      });

      it("updates only the user it names", async () => {
        await seedUsers("u1", "u2");
        await store.updateUser("u1", { name: "Changed", picture: "" });
        expect((await store.userById("u2"))?.name).toBe("Person u2");
      });

      it("ignores an update of a user that does not exist, without creating one", async () => {
        await expect(
          store.updateUser("ghost", { name: "Ghost", picture: "" }),
        ).resolves.toBeUndefined();
        expect(await store.userById("ghost")).toBeUndefined();
      });

      it("keeps text exactly as given: quotes, markup, SQL, emoji, newlines and empty text", async () => {
        const odd = aUser({
          id: "Robert'); DROP TABLE users;--",
          name: "<b>x</b> \"quoted\" 'single' \\ % _ \n second line ñ 🌊",
          picture: "",
        });
        await store.createUser(odd);
        expect(await store.userById(odd.id)).toEqual(odd);
        // The statement that would have run if the id were pasted into SQL did not.
        await store.createUser(aUser());
        expect(await store.userById("u1")).toEqual(aUser());
      });

      it("hands out copies: changing a result does not change the store", async () => {
        await store.createUser(aUser());
        const first = present(await store.userById("u1"));
        (first as { name: string }).name = "changed outside";
        expect((await store.userById("u1"))?.name).toBe("Ana Dev");
      });
    });

    describe("deleting a user", () => {
      it("removes the user with its identities and its sessions", async () => {
        await seedUsers("u1");
        await store.addIdentity(anIdentity({ provider: "github", providerId: "gh-1" }));
        await store.addIdentity(anIdentity({ provider: "google", providerId: "g-1" }));
        await store.createSession(aSession({ sid: "s1" }));
        await store.createSession(aSession({ sid: "s2", revokedAt: at(SECOND) }));

        await store.deleteUser("u1");

        expect(await store.userById("u1")).toBeUndefined();
        expect(await store.identity("github", "gh-1")).toBeUndefined();
        expect(await store.identity("google", "g-1")).toBeUndefined();
        expect(await store.identitiesOf("u1")).toEqual([]);
        expect(await store.session("s1")).toBeUndefined();
        expect(await store.session("s2")).toBeUndefined();
        expect(await store.sessionsOf("u1", at(0))).toEqual([]);
        expect(await store.identityByVerifiedEmail("ana@example.com")).toBeUndefined();
      });

      it("leaves every other user's data alone", async () => {
        await seedUsers("u1", "u2");
        await store.addIdentity(anIdentity({ providerId: "gh-1", userId: "u1" }));
        await store.addIdentity(
          anIdentity({ providerId: "gh-2", userId: "u2", email: "bo@example.com" }),
        );
        await store.createSession(aSession({ sid: "s1", userId: "u1" }));
        await store.createSession(aSession({ sid: "s2", userId: "u2" }));

        await store.deleteUser("u1");

        expect(await store.userById("u2")).toEqual(aUser({ id: "u2", name: "Person u2" }));
        expect((await store.identitiesOf("u2")).map((i) => i.providerId)).toEqual(["gh-2"]);
        expect((await store.sessionsOf("u2", at(0))).map((s) => s.sid)).toEqual(["s2"]);
      });

      it("keeps the outbox events: they outlive the user they name", async () => {
        await seedUsers("u1");
        await store.createSession(aSession());
        await store.enqueueEvents([
          anEvent({ id: "evt_a", product: "diagrams" }),
          anEvent({ id: "evt_b", product: "other" }),
        ]);

        await store.deleteUser("u1");

        expect((await under.outbox()).map((e) => e.id).sort()).toEqual(["evt_a", "evt_b"]);
        expect((await store.dueEvents(at(0), 10)).map((e) => e.id)).toEqual(["evt_a", "evt_b"]);
      });

      it("queues the events it is given together with the deletion", async () => {
        await seedUsers("u1", "u2");
        await store.addIdentity(anIdentity({ userId: "u1" }));
        await store.createSession(aSession({ userId: "u1" }));
        await store.addIdentity(anIdentity({ providerId: "gh-2", userId: "u2" }));

        await store.deleteUser("u1", [
          anEvent({ id: "evt_a", product: "diagrams" }),
          anEvent({ id: "evt_b", product: "ide", createdAt: at(SECOND), nextAt: at(SECOND) }),
        ]);

        expect(await store.userById("u1")).toBeUndefined();
        expect(await store.identitiesOf("u1")).toEqual([]);
        expect(await store.session("sid-1")).toBeUndefined();
        // The events are whole and due, exactly as they were given.
        expect(await under.outbox()).toEqual([
          anEvent({ id: "evt_a", product: "diagrams" }),
          anEvent({ id: "evt_b", product: "ide", createdAt: at(SECOND), nextAt: at(SECOND) }),
        ]);
        expect((await store.dueEvents(at(SECOND), 10)).map((e) => e.id)).toEqual([
          "evt_a",
          "evt_b",
        ]);
        // Somebody else is untouched.
        expect(await store.userById("u2")).toBeDefined();
        expect(await store.identitiesOf("u2")).toHaveLength(1);
      });

      it("still deletes when it is given no events, or an empty list", async () => {
        await seedUsers("u1", "u2");
        await store.addIdentity(anIdentity({ userId: "u1" }));
        await store.createSession(aSession({ userId: "u1" }));
        await store.deleteUser("u1");
        await expect(store.deleteUser("u2", [])).resolves.toBeUndefined();
        expect(await store.userById("u1")).toBeUndefined();
        expect(await store.userById("u2")).toBeUndefined();
        expect(await store.identitiesOf("u1")).toEqual([]);
        expect(await store.session("sid-1")).toBeUndefined();
        expect(await under.outbox()).toEqual([]);
      });

      it("keeps the outbox of earlier deletions when it queues the events of another", async () => {
        await seedUsers("u1", "u2");
        await store.deleteUser("u1", [anEvent({ id: "evt_first" })]);
        await store.markDelivered("evt_first", at(MINUTE));
        await store.deleteUser("u2", [anEvent({ id: "evt_second", product: "ide" })]);
        expect((await under.outbox()).map((e) => e.id)).toEqual(["evt_first", "evt_second"]);
        // The first stays as the delivery left it.
        const first = await outboxRow("evt_first");
        expect(first.deliveredAt).toBe(at(MINUTE));
        expect(first.attempts).toBe(1);
        expect((await store.dueEvents(at(DAY), 10)).map((e) => e.id)).toEqual(["evt_second"]);
      });

      it("keeps the row of an event id already queued, as queueing again does, and deletes all the same", async () => {
        await seedUsers("u1");
        await store.enqueueEvents([anEvent({ id: "evt_a", body: "first" })]);
        await store.deleteUser("u1", [
          anEvent({ id: "evt_a", body: "second" }),
          anEvent({ id: "evt_b", body: "other" }),
          anEvent({ id: "evt_b", body: "again" }),
        ]);
        expect(await store.userById("u1")).toBeUndefined();
        expect((await outboxRow("evt_a")).body).toBe("first");
        expect((await outboxRow("evt_b")).body).toBe("other");
        expect(await under.outbox()).toHaveLength(2);
      });

      it("is a no-op for a user that does not exist, and when repeated", async () => {
        await seedUsers("u1");
        await store.deleteUser("ghost");
        expect(await store.userById("u1")).toBeDefined();
        await store.deleteUser("u1");
        await expect(store.deleteUser("u1")).resolves.toBeUndefined();
        expect(await store.userById("u1")).toBeUndefined();
      });

      it("lets the id be used again by a new user afterwards", async () => {
        await seedUsers("u1");
        await store.addIdentity(anIdentity());
        await store.deleteUser("u1");
        await store.createUser(aUser({ name: "Again" }));
        expect((await store.userById("u1"))?.name).toBe("Again");
        // The deleted user's identity is not resurrected.
        expect(await store.identitiesOf("u1")).toEqual([]);
      });
    });

    describe("identities", () => {
      it("stores an identity and reads it back whole", async () => {
        await seedUsers("u1");
        const identity = anIdentity({ linkedAt: at(3 * SECOND), verifiedAt: at(2 * SECOND) });
        await store.addIdentity(identity);
        expect(await store.identity("github", "gh-1")).toEqual(identity);
      });

      it("keeps an unverified email as false with a null verifiedAt", async () => {
        await seedUsers("u1");
        const identity = anIdentity({ emailVerified: false, verifiedAt: null });
        await store.addIdentity(identity);
        const read = present(await store.identity("github", "gh-1"));
        expect(read).toEqual(identity);
        expect(read.emailVerified).toBe(false);
        expect(read.verifiedAt).toBeNull();
      });

      it("keeps an empty handle and an empty email", async () => {
        await seedUsers("u1");
        const identity = anIdentity({
          provider: "google",
          providerId: "g-1",
          handle: "",
          email: "",
          emailVerified: false,
          verifiedAt: null,
        });
        await store.addIdentity(identity);
        expect(await store.identity("google", "g-1")).toEqual(identity);
      });

      it("tells providers apart: the same provider id at two providers is two identities", async () => {
        await seedUsers("u1", "u2");
        await store.addIdentity(
          anIdentity({ provider: "github", providerId: "123", userId: "u1" }),
        );
        await store.addIdentity(
          anIdentity({ provider: "google", providerId: "123", userId: "u2" }),
        );
        expect((await store.identity("github", "123"))?.userId).toBe("u1");
        expect((await store.identity("google", "123"))?.userId).toBe("u2");
      });

      it("answers undefined for an identity that does not exist", async () => {
        await seedUsers("u1");
        await store.addIdentity(anIdentity());
        expect(await store.identity("github", "other")).toBeUndefined();
        expect(await store.identity("google", "gh-1")).toBeUndefined();
      });

      it("refuses a second identity with the same provider and id, whoever it belongs to", async () => {
        await seedUsers("u1", "u2");
        await store.addIdentity(anIdentity({ userId: "u1", email: "first@example.com" }));
        await expect(
          store.addIdentity(anIdentity({ userId: "u2", email: "second@example.com" })),
        ).rejects.toThrow();
        const kept = present(await store.identity("github", "gh-1"));
        expect(kept.userId).toBe("u1");
        expect(kept.email).toBe("first@example.com");
      });

      it("lists the identities of a user, the oldest link first", async () => {
        await seedUsers("u1");
        await store.addIdentity(
          anIdentity({ provider: "google", providerId: "g-1", linkedAt: at(2 * SECOND) }),
        );
        await store.addIdentity(
          anIdentity({ provider: "github", providerId: "gh-1", linkedAt: at(SECOND) }),
        );
        await store.addIdentity(
          anIdentity({ provider: "github", providerId: "gh-2", linkedAt: at(3 * SECOND) }),
        );
        expect((await store.identitiesOf("u1")).map((i) => i.providerId)).toEqual([
          "gh-1",
          "g-1",
          "gh-2",
        ]);
      });

      it("orders identities linked at the same instant by when they were added", async () => {
        await seedUsers("u1");
        for (const providerId of ["gh-c", "gh-a", "gh-b"]) {
          await store.addIdentity(anIdentity({ providerId, linkedAt: at(SECOND) }));
        }
        expect((await store.identitiesOf("u1")).map((i) => i.providerId)).toEqual([
          "gh-c",
          "gh-a",
          "gh-b",
        ]);
      });

      it("lists only the identities of the user asked for", async () => {
        await seedUsers("u1", "u2");
        await store.addIdentity(anIdentity({ providerId: "gh-1", userId: "u1" }));
        await store.addIdentity(anIdentity({ providerId: "gh-2", userId: "u2" }));
        expect((await store.identitiesOf("u1")).map((i) => i.providerId)).toEqual(["gh-1"]);
        expect((await store.identitiesOf("u2")).map((i) => i.providerId)).toEqual(["gh-2"]);
        expect(await store.identitiesOf("nobody")).toEqual([]);
      });

      it("refreshes email, verification, verifiedAt and handle, and nothing else", async () => {
        await seedUsers("u1");
        await store.addIdentity(
          anIdentity({ emailVerified: false, verifiedAt: null, linkedAt: at(SECOND) }),
        );
        await store.updateIdentity("github", "gh-1", {
          email: "new@example.com",
          emailVerified: true,
          verifiedAt: at(2 * SECOND),
          handle: "new-handle",
        });
        expect(await store.identity("github", "gh-1")).toEqual({
          provider: "github",
          providerId: "gh-1",
          userId: "u1",
          email: "new@example.com",
          emailVerified: true,
          verifiedAt: at(2 * SECOND),
          handle: "new-handle",
          linkedAt: at(SECOND),
        });
      });

      it("can take an identity back to unverified, with a null verifiedAt", async () => {
        await seedUsers("u1");
        await store.addIdentity(anIdentity());
        await store.updateIdentity("github", "gh-1", {
          email: "ana@example.com",
          emailVerified: false,
          verifiedAt: null,
          handle: "ana-dev",
        });
        const read = present(await store.identity("github", "gh-1"));
        expect(read.emailVerified).toBe(false);
        expect(read.verifiedAt).toBeNull();
      });

      it("updates only the identity it names", async () => {
        await seedUsers("u1");
        await store.addIdentity(anIdentity({ provider: "github", providerId: "x" }));
        await store.addIdentity(anIdentity({ provider: "google", providerId: "x", handle: "" }));
        await store.updateIdentity("google", "x", {
          email: "g@example.com",
          emailVerified: true,
          verifiedAt: at(DAY),
          handle: "",
        });
        expect((await store.identity("github", "x"))?.email).toBe("ana@example.com");
        expect((await store.identity("google", "x"))?.email).toBe("g@example.com");
      });

      it("ignores an update of an identity that does not exist, without creating one", async () => {
        await expect(
          store.updateIdentity("github", "ghost", {
            email: "ghost@example.com",
            emailVerified: true,
            verifiedAt: at(0),
            handle: "ghost",
          }),
        ).resolves.toBeUndefined();
        expect(await store.identity("github", "ghost")).toBeUndefined();
      });

      it("hands out copies: changing a result does not change the store", async () => {
        await seedUsers("u1");
        await store.addIdentity(anIdentity());
        const one = present(await store.identity("github", "gh-1"));
        (one as { email: string }).email = "changed@example.com";
        const [listed] = await store.identitiesOf("u1");
        (present(listed) as { handle: string }).handle = "changed";
        const read = present(await store.identity("github", "gh-1"));
        expect(read.email).toBe("ana@example.com");
        expect(read.handle).toBe("ana-dev");
      });
    });

    describe("unlinking a provider", () => {
      /** Gives a user identities, as `[provider, providerId]` pairs, linked in this order. */
      const seedIdentities = async (
        userId: string,
        ...pairs: readonly (readonly [Identity["provider"], string])[]
      ) => {
        for (const [index, [provider, providerId]] of pairs.entries()) {
          await store.addIdentity(
            anIdentity({ provider, providerId, userId, linkedAt: at(index * SECOND) }),
          );
        }
      };
      const idsOf = async (userId: string) =>
        (await store.identitiesOf(userId)).map((i) => `${i.provider}:${i.providerId}`);

      it("removes the identity of the provider when another provider remains", async () => {
        await seedUsers("u1");
        await seedIdentities("u1", ["github", "x"], ["google", "x"]);
        expect(await store.unlinkProvider("u1", "github")).toBe("removed");
        expect(await store.identity("github", "x")).toBeUndefined();
        expect(await store.identity("google", "x")).toBeDefined();
        expect(await idsOf("u1")).toEqual(["google:x"]);
        expect(await store.userById("u1")).toBeDefined();
      });

      it("works for either provider", async () => {
        await seedUsers("u1", "u2");
        await seedIdentities("u1", ["github", "gh-1"], ["google", "g-1"]);
        await seedIdentities("u2", ["github", "gh-2"], ["google", "g-2"]);
        expect(await store.unlinkProvider("u1", "google")).toBe("removed");
        expect(await store.unlinkProvider("u2", "github")).toBe("removed");
        expect(await idsOf("u1")).toEqual(["github:gh-1"]);
        expect(await idsOf("u2")).toEqual(["google:g-2"]);
      });

      it("removes every identity of the provider when the user linked several", async () => {
        await seedUsers("u1");
        await seedIdentities(
          "u1",
          ["github", "gh-1"],
          ["google", "g-1"],
          ["github", "gh-2"],
          ["github", "gh-3"],
        );
        expect(await store.unlinkProvider("u1", "github")).toBe("removed");
        expect(await idsOf("u1")).toEqual(["google:g-1"]);
        expect(await store.identity("github", "gh-2")).toBeUndefined();
        expect(await store.identity("github", "gh-3")).toBeUndefined();
      });

      it("keeps the others whole, as they were, when it removes", async () => {
        await seedUsers("u1");
        const kept = anIdentity({
          provider: "google",
          providerId: "g-1",
          userId: "u1",
          email: "g@example.com",
          verifiedAt: at(DAY),
          handle: "",
          linkedAt: at(3 * SECOND),
        });
        await store.addIdentity(anIdentity({ linkedAt: at(SECOND) }));
        await store.addIdentity(kept);
        expect(await store.unlinkProvider("u1", "github")).toBe("removed");
        expect(await store.identitiesOf("u1")).toEqual([kept]);
      });

      it("answers last, and changes nothing, when the only identity is of the provider", async () => {
        await seedUsers("u1");
        const only = anIdentity();
        await store.addIdentity(only);
        expect(await store.unlinkProvider("u1", "github")).toBe("last");
        expect(await store.identitiesOf("u1")).toEqual([only]);
        // And again: the answer does not wear out.
        expect(await store.unlinkProvider("u1", "github")).toBe("last");
        expect(await store.identitiesOf("u1")).toEqual([only]);
      });

      it("answers last, and changes nothing, when all the identities are of the provider", async () => {
        await seedUsers("u1");
        await seedIdentities("u1", ["github", "gh-1"], ["github", "gh-2"], ["github", "gh-3"]);
        expect(await store.unlinkProvider("u1", "github")).toBe("last");
        expect(await idsOf("u1")).toEqual(["github:gh-1", "github:gh-2", "github:gh-3"]);
      });

      it("answers absent, and changes nothing, when the user has none of the provider", async () => {
        await seedUsers("u1");
        await seedIdentities("u1", ["github", "gh-1"]);
        expect(await store.unlinkProvider("u1", "google")).toBe("absent");
        expect(await idsOf("u1")).toEqual(["github:gh-1"]);
      });

      it("answers absent for a user without identities, and for one that does not exist", async () => {
        await seedUsers("u1");
        expect(await store.unlinkProvider("u1", "github")).toBe("absent");
        expect(await store.unlinkProvider("ghost", "google")).toBe("absent");
        expect(await store.userById("u1")).toBeDefined();
      });

      it("answers removed once and absent after it", async () => {
        await seedUsers("u1");
        await seedIdentities("u1", ["github", "gh-1"], ["google", "g-1"]);
        expect(await store.unlinkProvider("u1", "google")).toBe("removed");
        expect(await store.unlinkProvider("u1", "google")).toBe("absent");
        expect(await idsOf("u1")).toEqual(["github:gh-1"]);
        // What is left is the last way in.
        expect(await store.unlinkProvider("u1", "github")).toBe("last");
      });

      it("looks at the identities of the user it names, never at other people's", async () => {
        await seedUsers("u1", "u2");
        // u1 has GitHub only; u2 has both. Another person's Google does not make u1's GitHub spare.
        await seedIdentities("u1", ["github", "gh-1"]);
        await seedIdentities("u2", ["github", "gh-2"], ["google", "g-2"]);
        expect(await store.unlinkProvider("u1", "github")).toBe("last");
        expect(await store.unlinkProvider("u1", "google")).toBe("absent");
        expect(await idsOf("u1")).toEqual(["github:gh-1"]);
        expect(await idsOf("u2")).toEqual(["github:gh-2", "google:g-2"]);
      });

      it("removes nothing of other people when it removes", async () => {
        await seedUsers("u1", "u2");
        await seedIdentities("u1", ["github", "gh-1"], ["google", "g-1"]);
        await seedIdentities("u2", ["github", "gh-2"], ["google", "g-2"]);
        expect(await store.unlinkProvider("u1", "github")).toBe("removed");
        expect(await idsOf("u2")).toEqual(["github:gh-2", "google:g-2"]);
        expect(await store.identity("github", "gh-2")).toBeDefined();
      });

      it("leaves the user, its sessions and the outbox alone", async () => {
        await seedUsers("u1");
        await seedIdentities("u1", ["github", "gh-1"], ["google", "g-1"]);
        await store.createSession(aSession());
        await store.enqueueEvents([anEvent()]);
        await store.unlinkProvider("u1", "google");
        await store.unlinkProvider("u1", "github");
        expect(await store.userById("u1")).toEqual(aUser({ name: "Person u1" }));
        expect(await store.session("sid-1")).toBeDefined();
        expect(await under.outbox()).toEqual([anEvent()]);
      });

      it("lets an unlinked identity be added again, to the same user or to another", async () => {
        await seedUsers("u1", "u2");
        await seedIdentities("u1", ["github", "gh-1"], ["google", "g-1"]);
        expect(await store.unlinkProvider("u1", "github")).toBe("removed");
        await store.addIdentity(anIdentity({ userId: "u2" }));
        expect((await store.identity("github", "gh-1"))?.userId).toBe("u2");
        await store.addIdentity(
          anIdentity({ providerId: "gh-9", userId: "u1", linkedAt: at(2 * SECOND) }),
        );
        expect(await idsOf("u1")).toEqual(["google:g-1", "github:gh-9"]);
      });

      it("treats text that looks like SQL as the plain id it is", async () => {
        const evil = "u1' OR '1'='1";
        await seedUsers(evil, "u2");
        await seedIdentities(evil, ["github", "gh-1"]);
        await seedIdentities("u2", ["github", "gh-2"], ["google", "g-2"]);
        expect(await store.unlinkProvider(evil, "github")).toBe("last");
        expect(await store.unlinkProvider("u1", "github")).toBe("absent");
        expect(await idsOf("u2")).toEqual(["github:gh-2", "google:g-2"]);
      });
    });

    describe("finding an identity by its verified email", () => {
      it("answers undefined when no identity holds the email", async () => {
        expect(await store.identityByVerifiedEmail("ana@example.com")).toBeUndefined();
        await seedUsers("u1");
        await store.addIdentity(anIdentity());
        expect(await store.identityByVerifiedEmail("someone@example.com")).toBeUndefined();
      });

      it("finds the identity that holds the email verified", async () => {
        await seedUsers("u1");
        const identity = anIdentity();
        await store.addIdentity(identity);
        expect(await store.identityByVerifiedEmail("ana@example.com")).toEqual(identity);
      });

      it("never matches an email the provider did not verify", async () => {
        await seedUsers("u1");
        await store.addIdentity(anIdentity({ emailVerified: false, verifiedAt: null }));
        expect(await store.identityByVerifiedEmail("ana@example.com")).toBeUndefined();
      });

      it("ignores case, in the stored email and in the one asked for", async () => {
        await seedUsers("u1", "u2");
        await store.addIdentity(
          anIdentity({ providerId: "gh-1", userId: "u1", email: "Ana.Dev@Example.COM" }),
        );
        await store.addIdentity(
          anIdentity({ providerId: "gh-2", userId: "u2", email: "bo@example.com" }),
        );
        expect((await store.identityByVerifiedEmail("ana.dev@example.com"))?.providerId).toBe(
          "gh-1",
        );
        expect((await store.identityByVerifiedEmail("ANA.DEV@EXAMPLE.COM"))?.providerId).toBe(
          "gh-1",
        );
        expect((await store.identityByVerifiedEmail("Bo@Example.Com"))?.providerId).toBe("gh-2");
      });

      it("matches the whole email, not a part of it, and treats % and _ as plain characters", async () => {
        await seedUsers("u1");
        await store.addIdentity(anIdentity({ email: "a_a@example.com" }));
        expect(await store.identityByVerifiedEmail("a_a@example.co")).toBeUndefined();
        expect(await store.identityByVerifiedEmail("a_a@example.com.evil")).toBeUndefined();
        expect(await store.identityByVerifiedEmail("a%a@example.com")).toBeUndefined();
        expect(await store.identityByVerifiedEmail("a_a@example.%")).toBeUndefined();
        expect(await store.identityByVerifiedEmail("%")).toBeUndefined();
        expect(await store.identityByVerifiedEmail("")).toBeUndefined();
        expect(await store.identityByVerifiedEmail("a_a@example.com")).toBeDefined();
      });

      it("finds an email with characters beyond ASCII when it is asked for exactly", async () => {
        await seedUsers("u1");
        await store.addIdentity(anIdentity({ email: "josé@example.com" }));
        expect(await store.identityByVerifiedEmail("josé@example.com")).toBeDefined();
      });

      it("prefers the most recently verified identity when several hold the email", async () => {
        await seedUsers("u1", "u2", "u3");
        const old = anIdentity({
          provider: "github",
          providerId: "gh-old",
          userId: "u1",
          verifiedAt: at(-80 * DAY),
          linkedAt: at(-90 * DAY),
        });
        const recent = anIdentity({
          provider: "google",
          providerId: "g-recent",
          userId: "u2",
          verifiedAt: at(-2 * DAY),
          linkedAt: at(-5 * DAY),
        });
        // Linked long ago, verified yesterday: recency of verification decides, not of linking.
        const lastVerified = anIdentity({
          provider: "github",
          providerId: "gh-last",
          userId: "u3",
          verifiedAt: at(-DAY),
          linkedAt: at(-200 * DAY),
        });
        await store.addIdentity(old);
        await store.addIdentity(recent);
        expect((await store.identityByVerifiedEmail("ana@example.com"))?.providerId).toBe(
          "g-recent",
        );
        await store.addIdentity(lastVerified);
        expect((await store.identityByVerifiedEmail("ana@example.com"))?.providerId).toBe(
          "gh-last",
        );
      });

      it("does not depend on the order the identities were added in", async () => {
        await seedUsers("u1", "u2");
        const older = anIdentity({ providerId: "gh-a", userId: "u1", verifiedAt: at(-10 * DAY) });
        const newer = anIdentity({ providerId: "gh-b", userId: "u2", verifiedAt: at(-1 * DAY) });
        await store.addIdentity(newer);
        await store.addIdentity(older);
        expect((await store.identityByVerifiedEmail("ana@example.com"))?.providerId).toBe("gh-b");
      });

      it("breaks a tie on verifiedAt in favor of the oldest link", async () => {
        await seedUsers("u1", "u2");
        await store.addIdentity(
          anIdentity({ providerId: "gh-late", userId: "u1", linkedAt: at(2 * SECOND) }),
        );
        await store.addIdentity(
          anIdentity({ providerId: "gh-early", userId: "u2", linkedAt: at(SECOND) }),
        );
        expect((await store.identityByVerifiedEmail("ana@example.com"))?.providerId).toBe(
          "gh-early",
        );
      });

      it("skips an unverified identity even when it is the most recent", async () => {
        await seedUsers("u1", "u2");
        await store.addIdentity(
          anIdentity({ providerId: "gh-verified", userId: "u1", verifiedAt: at(-30 * DAY) }),
        );
        await store.addIdentity(
          anIdentity({
            providerId: "gh-unverified",
            userId: "u2",
            emailVerified: false,
            verifiedAt: null,
            linkedAt: at(DAY),
          }),
        );
        expect((await store.identityByVerifiedEmail("ana@example.com"))?.providerId).toBe(
          "gh-verified",
        );
      });

      it("follows updates: a new email is found, the old one is not, and unverified is gone", async () => {
        await seedUsers("u1");
        await store.addIdentity(anIdentity());
        await store.updateIdentity("github", "gh-1", {
          email: "moved@example.com",
          emailVerified: true,
          verifiedAt: at(DAY),
          handle: "ana-dev",
        });
        expect(await store.identityByVerifiedEmail("ana@example.com")).toBeUndefined();
        expect((await store.identityByVerifiedEmail("moved@example.com"))?.providerId).toBe("gh-1");

        await store.updateIdentity("github", "gh-1", {
          email: "moved@example.com",
          emailVerified: false,
          verifiedAt: null,
          handle: "ana-dev",
        });
        expect(await store.identityByVerifiedEmail("moved@example.com")).toBeUndefined();
      });

      it("stops finding an identity that was unlinked, or whose user was deleted", async () => {
        await seedUsers("u1", "u2");
        await store.addIdentity(anIdentity({ providerId: "gh-1", userId: "u1" }));
        await store.addIdentity(
          anIdentity({
            provider: "google",
            providerId: "g-1",
            userId: "u1",
            email: "ana.other@example.com",
          }),
        );
        await store.addIdentity(anIdentity({ providerId: "gh-2", userId: "u2" }));
        expect(await store.unlinkProvider("u1", "github")).toBe("removed");
        expect((await store.identityByVerifiedEmail("ana@example.com"))?.providerId).toBe("gh-2");
        await store.deleteUser("u2");
        expect(await store.identityByVerifiedEmail("ana@example.com")).toBeUndefined();
      });
    });

    describe("sessions", () => {
      it("stores a session and reads it back whole", async () => {
        await seedUsers("u1");
        const session = aSession({ createdAt: at(SECOND), lastSeen: at(2 * SECOND) });
        await store.createSession(session);
        expect(await store.session("sid-1")).toEqual(session);
      });

      it("answers undefined for a session that does not exist", async () => {
        await seedUsers("u1");
        await store.createSession(aSession());
        expect(await store.session("sid-2")).toBeUndefined();
        expect(await store.session("")).toBeUndefined();
      });

      it("refuses a second session with the same sid and keeps the first", async () => {
        await seedUsers("u1");
        await store.createSession(aSession({ label: "First" }));
        await expect(store.createSession(aSession({ label: "Second" }))).rejects.toThrow();
        expect((await store.session("sid-1"))?.label).toBe("First");
      });

      it("still reads a revoked or an expired session: it is a row, not a live session", async () => {
        await seedUsers("u1");
        await store.createSession(aSession({ sid: "revoked", revokedAt: at(SECOND) }));
        await store.createSession(aSession({ sid: "expired", expiresAt: at(-DAY) }));
        expect((await store.session("revoked"))?.revokedAt).toBe(at(SECOND));
        expect((await store.session("expired"))?.expiresAt).toBe(at(-DAY));
      });

      it("touches the last-seen time and nothing else", async () => {
        await seedUsers("u1");
        const session = aSession({ createdAt: at(SECOND), lastSeen: at(SECOND) });
        await store.createSession(session);
        await store.touchSession("sid-1", at(HOUR));
        expect(await store.session("sid-1")).toEqual({ ...session, lastSeen: at(HOUR) });
      });

      it("touches only the session it names, and ignores one that does not exist", async () => {
        await seedUsers("u1");
        await store.createSession(aSession({ sid: "a" }));
        await store.createSession(aSession({ sid: "b" }));
        await store.touchSession("a", at(HOUR));
        await expect(store.touchSession("ghost", at(HOUR))).resolves.toBeUndefined();
        expect((await store.session("a"))?.lastSeen).toBe(at(HOUR));
        expect((await store.session("b"))?.lastSeen).toBe(at(0));
        expect(await store.session("ghost")).toBeUndefined();
      });

      it("revokes a session with the time given, and keeps the first revocation", async () => {
        await seedUsers("u1");
        await store.createSession(aSession({ sid: "a" }));
        await store.createSession(aSession({ sid: "b" }));
        await store.revokeSession("a", at(MINUTE));
        await store.revokeSession("a", at(HOUR));
        expect((await store.session("a"))?.revokedAt).toBe(at(MINUTE));
        expect((await store.session("b"))?.revokedAt).toBeNull();
      });

      it("ignores the revocation of a session that does not exist", async () => {
        await expect(store.revokeSession("ghost", at(0))).resolves.toBeUndefined();
        expect(await store.session("ghost")).toBeUndefined();
      });

      it("revokes every other session of the user and keeps the one named", async () => {
        await seedUsers("u1", "u2");
        await store.createSession(aSession({ sid: "first", createdAt: at(SECOND) }));
        await store.createSession(aSession({ sid: "second", createdAt: at(2 * SECOND) }));
        await store.createSession(aSession({ sid: "third", createdAt: at(3 * SECOND) }));
        await store.createSession(aSession({ sid: "theirs", userId: "u2" }));

        await store.revokeOtherSessions("u1", "second", at(MINUTE));

        expect((await store.session("first"))?.revokedAt).toBe(at(MINUTE));
        expect((await store.session("second"))?.revokedAt).toBeNull();
        expect((await store.session("third"))?.revokedAt).toBe(at(MINUTE));
        expect((await store.session("theirs"))?.revokedAt).toBeNull();
        expect((await store.sessionsOf("u1", at(HOUR))).map((s) => s.sid)).toEqual(["second"]);
      });

      it("leaves a session that was already revoked with its first revocation", async () => {
        await seedUsers("u1");
        await store.createSession(aSession({ sid: "kept" }));
        await store.createSession(aSession({ sid: "earlier", revokedAt: at(SECOND) }));
        await store.revokeOtherSessions("u1", "kept", at(HOUR));
        expect((await store.session("earlier"))?.revokedAt).toBe(at(SECOND));
      });

      it("revokes every session of the user when the one to keep is not theirs", async () => {
        await seedUsers("u1", "u2");
        await store.createSession(aSession({ sid: "mine-1" }));
        await store.createSession(aSession({ sid: "mine-2" }));
        await store.createSession(aSession({ sid: "theirs", userId: "u2" }));
        await store.revokeOtherSessions("u1", "theirs", at(MINUTE));
        expect(await store.sessionsOf("u1", at(HOUR))).toEqual([]);
        // The session named is not touched, because it is not the user's to revoke or keep.
        expect((await store.session("theirs"))?.revokedAt).toBeNull();
      });

      it("does nothing for a user without other sessions", async () => {
        await seedUsers("u1");
        await store.createSession(aSession({ sid: "only" }));
        await store.revokeOtherSessions("u1", "only", at(MINUTE));
        await expect(store.revokeOtherSessions("nobody", "only", at(MINUTE))).resolves.toBe(
          undefined,
        );
        expect((await store.session("only"))?.revokedAt).toBeNull();
      });

      it("hands out copies: changing a result does not change the store", async () => {
        await seedUsers("u1");
        await store.createSession(aSession());
        const one = present(await store.session("sid-1"));
        (one as { label: string }).label = "changed";
        const [listed] = await store.sessionsOf("u1", at(0));
        (present(listed) as { label: string }).label = "changed too";
        expect((await store.session("sid-1"))?.label).toBe("Edge on Windows");
      });

      it("keeps a coarse label as text and stores nothing else about the browser", async () => {
        await seedUsers("u1");
        await store.createSession(aSession({ label: "Safari on iOS" }));
        const keys = Object.keys(present(await store.session("sid-1"))).sort();
        expect(keys).toEqual([
          "createdAt",
          "expiresAt",
          "label",
          "lastSeen",
          "revokedAt",
          "sid",
          "userId",
        ]);
      });
    });

    describe("live sessions of a user", () => {
      it("lists the live sessions, the newest first", async () => {
        await seedUsers("u1");
        await store.createSession(aSession({ sid: "old", createdAt: at(SECOND) }));
        await store.createSession(aSession({ sid: "new", createdAt: at(3 * SECOND) }));
        await store.createSession(aSession({ sid: "mid", createdAt: at(2 * SECOND) }));
        expect((await store.sessionsOf("u1", at(HOUR))).map((s) => s.sid)).toEqual([
          "new",
          "mid",
          "old",
        ]);
      });

      it("puts the later one first when two were created at the same instant", async () => {
        await seedUsers("u1");
        for (const sid of ["a", "b", "c"]) {
          await store.createSession(aSession({ sid, createdAt: at(SECOND) }));
        }
        expect((await store.sessionsOf("u1", at(HOUR))).map((s) => s.sid)).toEqual(["c", "b", "a"]);
      });

      it("leaves out revoked sessions, whenever they were revoked", async () => {
        await seedUsers("u1");
        await store.createSession(aSession({ sid: "live" }));
        await store.createSession(aSession({ sid: "revoked", revokedAt: at(SECOND) }));
        await store.createSession(aSession({ sid: "revoked-later", revokedAt: at(DAY) }));
        expect((await store.sessionsOf("u1", at(HOUR))).map((s) => s.sid)).toEqual(["live"]);
      });

      it("treats a session as over at its expiry instant: live one millisecond before only", async () => {
        await seedUsers("u1");
        const now = at(10 * DAY);
        await store.createSession(aSession({ sid: "expired-before", expiresAt: at(10 * DAY - 1) }));
        await store.createSession(aSession({ sid: "expires-now", expiresAt: now }));
        await store.createSession(aSession({ sid: "expires-after", expiresAt: at(10 * DAY + 1) }));
        expect((await store.sessionsOf("u1", now)).map((s) => s.sid)).toEqual(["expires-after"]);
      });

      it("judges liveness at the time asked about, not at the time of the call", async () => {
        await seedUsers("u1");
        await store.createSession(aSession({ sid: "a", expiresAt: at(DAY) }));
        expect((await store.sessionsOf("u1", at(DAY - 1))).map((s) => s.sid)).toEqual(["a"]);
        expect(await store.sessionsOf("u1", at(DAY))).toEqual([]);
        expect(await store.sessionsOf("u1", at(2 * DAY))).toEqual([]);
        expect((await store.sessionsOf("u1", at(-DAY))).map((s) => s.sid)).toEqual(["a"]);
      });

      it("lists only the sessions of the user asked for", async () => {
        await seedUsers("u1", "u2");
        await store.createSession(aSession({ sid: "mine", userId: "u1" }));
        await store.createSession(aSession({ sid: "theirs", userId: "u2" }));
        expect((await store.sessionsOf("u1", at(0))).map((s) => s.sid)).toEqual(["mine"]);
        expect((await store.sessionsOf("u2", at(0))).map((s) => s.sid)).toEqual(["theirs"]);
        expect(await store.sessionsOf("nobody", at(0))).toEqual([]);
      });

      it("shows the last-seen time a touch gave", async () => {
        await seedUsers("u1");
        await store.createSession(aSession());
        await store.touchSession("sid-1", at(5 * MINUTE));
        const [listed] = await store.sessionsOf("u1", at(HOUR));
        expect(present(listed).lastSeen).toBe(at(5 * MINUTE));
      });
    });

    describe("removing old sessions", () => {
      const before = at(10 * DAY);

      it("removes sessions that expired or were revoked before the time given", async () => {
        await seedUsers("u1");
        await store.createSession(aSession({ sid: "expired-before", expiresAt: at(9 * DAY) }));
        await store.createSession(
          aSession({ sid: "revoked-before", expiresAt: at(40 * DAY), revokedAt: at(9 * DAY) }),
        );
        await store.createSession(
          aSession({
            sid: "expired-and-revoked-after",
            expiresAt: at(9 * DAY),
            revokedAt: at(11 * DAY),
          }),
        );
        await store.deleteSessionsBefore(before);
        for (const sid of ["expired-before", "revoked-before", "expired-and-revoked-after"]) {
          expect(await store.session(sid), sid).toBeUndefined();
        }
      });

      it("keeps live sessions and the ones that ended exactly at, or after, the time given", async () => {
        await seedUsers("u1");
        await store.createSession(aSession({ sid: "live", expiresAt: at(40 * DAY) }));
        await store.createSession(aSession({ sid: "expires-at", expiresAt: before }));
        await store.createSession(
          aSession({ sid: "revoked-at", expiresAt: at(40 * DAY), revokedAt: before }),
        );
        await store.createSession(
          aSession({ sid: "revoked-after", expiresAt: at(40 * DAY), revokedAt: at(11 * DAY) }),
        );
        await store.deleteSessionsBefore(before);
        for (const sid of ["live", "expires-at", "revoked-at", "revoked-after"]) {
          expect(await store.session(sid), sid).toBeDefined();
        }
      });

      it("removes sessions of every user and touches nothing else", async () => {
        await seedUsers("u1", "u2");
        await store.addIdentity(anIdentity());
        await store.createSession(aSession({ sid: "a", userId: "u1", expiresAt: at(DAY) }));
        await store.createSession(aSession({ sid: "b", userId: "u2", expiresAt: at(DAY) }));
        await store.enqueueEvents([anEvent()]);
        await store.deleteSessionsBefore(before);
        expect(await store.session("a")).toBeUndefined();
        expect(await store.session("b")).toBeUndefined();
        expect(await store.userById("u1")).toBeDefined();
        expect(await store.userById("u2")).toBeDefined();
        expect(await store.identitiesOf("u1")).toHaveLength(1);
        expect(await under.outbox()).toHaveLength(1);
      });

      it("does nothing when there is nothing to remove, and when repeated", async () => {
        await expect(store.deleteSessionsBefore(before)).resolves.toBeUndefined();
        await seedUsers("u1");
        await store.createSession(aSession({ expiresAt: at(DAY) }));
        await store.deleteSessionsBefore(before);
        await expect(store.deleteSessionsBefore(before)).resolves.toBeUndefined();
        expect(await store.session("sid-1")).toBeUndefined();
      });
    });

    describe("the outbox of events", () => {
      it("stores events and gives them back whole when due", async () => {
        const event = anEvent({ createdAt: at(SECOND), nextAt: at(2 * SECOND) });
        await store.enqueueEvents([event]);
        expect(await store.dueEvents(at(2 * SECOND), 10)).toEqual([event]);
        expect(await under.outbox()).toEqual([event]);
      });

      it("queues several events in one call", async () => {
        await store.enqueueEvents([
          anEvent({ id: "evt_a", product: "diagrams" }),
          anEvent({ id: "evt_b", product: "ide" }),
          anEvent({ id: "evt_c", product: "site" }),
        ]);
        const due = await store.dueEvents(at(0), 10);
        expect(due.map((e) => [e.id, e.product])).toEqual([
          ["evt_a", "diagrams"],
          ["evt_b", "ide"],
          ["evt_c", "site"],
        ]);
      });

      it("accepts an empty list", async () => {
        await expect(store.enqueueEvents([])).resolves.toBeUndefined();
        expect(await under.outbox()).toEqual([]);
        expect(await store.dueEvents(at(DAY), 10)).toEqual([]);
      });

      it("keeps the body as given, JSON and unicode included", async () => {
        const body = JSON.stringify({
          id: "evt_1",
          type: "user.deleted",
          sub: "ñ'\"🌊\n",
          at: at(0),
        });
        await store.enqueueEvents([anEvent({ body })]);
        expect(present((await store.dueEvents(at(0), 1))[0]).body).toBe(body);
      });

      it("keeps the row of an id already queued: queueing again changes nothing", async () => {
        await store.enqueueEvents([anEvent({ product: "diagrams", body: "first" })]);
        await store.markDelivered("evt_1", at(MINUTE));
        await store.enqueueEvents([anEvent({ product: "other", body: "second" })]);
        const row = await outboxRow("evt_1");
        expect(row.body).toBe("first");
        expect(row.product).toBe("diagrams");
        expect(row.deliveredAt).toBe(at(MINUTE));
        expect(row.attempts).toBe(1);
        expect(await under.outbox()).toHaveLength(1);
      });

      it("keeps the first of two events with the same id in one call, and queues the rest", async () => {
        await store.enqueueEvents([
          anEvent({ id: "evt_1", body: "first" }),
          anEvent({ id: "evt_1", body: "second" }),
          anEvent({ id: "evt_2", body: "other" }),
        ]);
        expect((await outboxRow("evt_1")).body).toBe("first");
        expect(await under.outbox()).toHaveLength(2);
      });

      it("lists the events whose time has come, the oldest first", async () => {
        await store.enqueueEvents([
          anEvent({ id: "evt_3", nextAt: at(3 * MINUTE) }),
          anEvent({ id: "evt_1", nextAt: at(MINUTE) }),
          anEvent({ id: "evt_2", nextAt: at(2 * MINUTE) }),
        ]);
        expect((await store.dueEvents(at(10 * MINUTE), 10)).map((e) => e.id)).toEqual([
          "evt_1",
          "evt_2",
          "evt_3",
        ]);
      });

      it("orders events due at the same instant by id, by code unit", async () => {
        await store.enqueueEvents([
          anEvent({ id: "evt_b", nextAt: at(MINUTE) }),
          anEvent({ id: "evt_a", nextAt: at(MINUTE) }),
          anEvent({ id: "evt_a1", nextAt: at(MINUTE) }),
          anEvent({ id: "evt_B", nextAt: at(MINUTE) }),
          anEvent({ id: "evt_0", nextAt: at(MINUTE) }),
        ]);
        expect((await store.dueEvents(at(MINUTE), 10)).map((e) => e.id)).toEqual([
          "evt_0",
          "evt_B",
          "evt_a",
          "evt_a1",
          "evt_b",
        ]);
      });

      it("lists an event from its nextAt on, exactly at it and not a millisecond before", async () => {
        await store.enqueueEvents([anEvent({ nextAt: at(MINUTE) })]);
        expect(await store.dueEvents(at(MINUTE - 1), 10)).toEqual([]);
        expect(await store.dueEvents(at(MINUTE), 10)).toHaveLength(1);
        expect(await store.dueEvents(at(MINUTE + 1), 10)).toHaveLength(1);
        expect(await store.dueEvents(at(DAY), 10)).toHaveLength(1);
      });

      it("returns at most the limit, the oldest first, and the next ones on the next call", async () => {
        await store.enqueueEvents(
          [5, 3, 1, 4, 2].map((n) => anEvent({ id: `evt_${n}`, nextAt: at(n * MINUTE) })),
        );
        expect((await store.dueEvents(at(HOUR), 2)).map((e) => e.id)).toEqual(["evt_1", "evt_2"]);
        await store.markDelivered("evt_1", at(HOUR));
        await store.markDelivered("evt_2", at(HOUR));
        expect((await store.dueEvents(at(HOUR), 2)).map((e) => e.id)).toEqual(["evt_3", "evt_4"]);
        expect(await store.dueEvents(at(HOUR), 100)).toHaveLength(3);
      });

      it("returns nothing for a limit of zero or less", async () => {
        await store.enqueueEvents([anEvent()]);
        expect(await store.dueEvents(at(DAY), 0)).toEqual([]);
        expect(await store.dueEvents(at(DAY), -1)).toEqual([]);
      });

      it("does not change the events by listing them", async () => {
        await store.enqueueEvents([anEvent()]);
        const first = await store.dueEvents(at(0), 10);
        (present(first[0]) as { attempts: number }).attempts = 99;
        expect(await store.dueEvents(at(0), 10)).toEqual([anEvent()]);
        expect(await outboxRow("evt_1")).toEqual(anEvent());
      });

      it("counts the attempt and stops listing an event once it is delivered", async () => {
        await store.enqueueEvents([anEvent({ id: "evt_1" }), anEvent({ id: "evt_2" })]);
        await store.markDelivered("evt_1", at(MINUTE));
        expect((await store.dueEvents(at(HOUR), 10)).map((e) => e.id)).toEqual(["evt_2"]);
        const row = await outboxRow("evt_1");
        expect(row.deliveredAt).toBe(at(MINUTE));
        expect(row.attempts).toBe(1);
        expect(row.failedAt).toBeNull();
        expect(await outboxRow("evt_2")).toEqual(anEvent({ id: "evt_2" }));
      });

      it("counts a failed attempt and schedules the next one", async () => {
        await store.enqueueEvents([anEvent({ nextAt: at(0) })]);
        await store.recordFailure("evt_1", { nextAt: at(MINUTE) });
        // Not due again before the time it was scheduled for.
        expect(await store.dueEvents(at(MINUTE - 1), 10)).toEqual([]);
        const [due] = await store.dueEvents(at(MINUTE), 10);
        expect(due).toEqual(anEvent({ attempts: 1, nextAt: at(MINUTE) }));
      });

      it("gives an event up: it is marked failed, counted, and never listed again", async () => {
        await store.enqueueEvents([anEvent({ nextAt: at(0) })]);
        await store.recordFailure("evt_1", { nextAt: at(HOUR) });
        await store.recordFailure("evt_1", { failedAt: at(7 * DAY) });
        expect(await store.dueEvents(at(30 * DAY), 10)).toEqual([]);
        const row = await outboxRow("evt_1");
        expect(row.failedAt).toBe(at(7 * DAY));
        expect(row.attempts).toBe(2);
        expect(row.deliveredAt).toBeNull();
      });

      it("counts every attempt along the way to a delivery", async () => {
        await store.enqueueEvents([anEvent()]);
        await store.recordFailure("evt_1", { nextAt: at(MINUTE) });
        await store.recordFailure("evt_1", { nextAt: at(6 * MINUTE) });
        await store.markDelivered("evt_1", at(6 * MINUTE));
        const row = await outboxRow("evt_1");
        expect(row.attempts).toBe(3);
        expect(row.nextAt).toBe(at(6 * MINUTE));
        expect(row.deliveredAt).toBe(at(6 * MINUTE));
        expect(await store.dueEvents(at(DAY), 10)).toEqual([]);
      });

      it("ignores an event that does not exist, without creating one", async () => {
        await expect(store.markDelivered("ghost", at(0))).resolves.toBeUndefined();
        await expect(store.recordFailure("ghost", { nextAt: at(0) })).resolves.toBeUndefined();
        await expect(store.recordFailure("ghost", { failedAt: at(0) })).resolves.toBeUndefined();
        expect(await under.outbox()).toEqual([]);
      });

      it("touches only the event it names", async () => {
        await store.enqueueEvents([anEvent({ id: "evt_1" }), anEvent({ id: "evt_2" })]);
        await store.recordFailure("evt_1", { nextAt: at(MINUTE) });
        await store.recordFailure("evt_2", { failedAt: at(DAY) });
        expect(await outboxRow("evt_1")).toEqual(
          anEvent({ id: "evt_1", attempts: 1, nextAt: at(MINUTE) }),
        );
        expect(await outboxRow("evt_2")).toEqual(
          anEvent({ id: "evt_2", attempts: 1, failedAt: at(DAY) }),
        );
      });

      it("lists an event that was queued with a future nextAt only when it comes", async () => {
        await store.enqueueEvents([anEvent({ id: "evt_future", nextAt: at(DAY) })]);
        expect(await store.dueEvents(at(DAY - 1), 10)).toEqual([]);
        expect((await store.dueEvents(at(DAY), 10)).map((e) => e.id)).toEqual(["evt_future"]);
      });
    });

    describe("many operations at once", () => {
      it("keeps every session created concurrently", async () => {
        await seedUsers("u1");
        const sids = Array.from({ length: 25 }, (_, i) => `sid-${i}`);
        await Promise.all(
          sids.map((sid, i) => store.createSession(aSession({ sid, createdAt: at(i * SECOND) }))),
        );
        const listed = (await store.sessionsOf("u1", at(HOUR))).map((s) => s.sid);
        expect(listed.sort()).toEqual([...sids].sort());
      });

      it.each([
        ["github then google", ["github", "google"]],
        ["google then github", ["google", "github"]],
      ] as const)(
        "never leaves a user without an identity when two unlinks race: %s",
        async (_order, providers) => {
          await seedUsers("u1");
          await store.addIdentity(anIdentity({ provider: "github", providerId: "gh-1" }));
          await store.addIdentity(anIdentity({ provider: "google", providerId: "g-1" }));

          const outcomes = await Promise.all(
            providers.map((provider) => store.unlinkProvider("u1", provider)),
          );

          expect([...outcomes].sort()).toEqual(["last", "removed"]);
          const left = await store.identitiesOf("u1");
          expect(left).toHaveLength(1);
          // The provider that went is the one whose request was told "removed".
          expect(left[0]?.provider).toBe(providers[outcomes.indexOf("last")]);
        },
      );

      it("never leaves a user without an identity when many unlinks race, several per provider", async () => {
        await seedUsers("u1", "u2");
        for (const userId of ["u1", "u2"]) {
          for (const n of [1, 2, 3]) {
            await store.addIdentity(
              anIdentity({ provider: "github", providerId: `gh-${userId}-${n}`, userId }),
            );
            await store.addIdentity(
              anIdentity({ provider: "google", providerId: `g-${userId}-${n}`, userId }),
            );
          }
        }

        const providers = ["github", "google", "github", "google", "google", "github"] as const;
        const outcomes = await Promise.all(
          ["u1", "u2"].flatMap((userId) =>
            providers.map((provider) => store.unlinkProvider(userId, provider)),
          ),
        );

        // Per user: one provider went, wholly, and the other requests found it gone or the last.
        for (const userId of ["u1", "u2"]) {
          const left = await store.identitiesOf(userId);
          expect(left).toHaveLength(3);
          expect(new Set(left.map((i) => i.provider)).size).toBe(1);
        }
        expect(outcomes.filter((outcome) => outcome === "removed")).toHaveLength(2);
      });

      it("keeps every user and identity created concurrently, each in its place", async () => {
        const ids = Array.from({ length: 10 }, (_, i) => `u${i}`);
        await Promise.all(ids.map((id) => store.createUser(aUser({ id }))));
        await Promise.all(
          ids.map((id) =>
            store.addIdentity(
              anIdentity({ providerId: `gh-${id}`, userId: id, email: `${id}@example.com` }),
            ),
          ),
        );
        for (const id of ids) {
          expect((await store.identitiesOf(id)).map((i) => i.providerId)).toEqual([`gh-${id}`]);
          expect((await store.identityByVerifiedEmail(`${id}@example.com`))?.userId).toBe(id);
        }
      });
    });
  });
}
