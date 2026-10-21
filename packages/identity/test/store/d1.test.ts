// `d1Store` over the real migration, through the `node:sqlite` adapter of test/support/sqlite.ts:
// the same conformance suite as the in-memory store, then what only SQL can get wrong (statements
// built from values, transactions, indexes, how booleans and times are stored).

import { describe, expect, it } from "vitest";
import { readConfig } from "../../src/config.js";
import type { Ctx } from "../../src/context.js";
import type { D1Like, D1PreparedLike } from "../../src/env.js";
import { currentSession } from "../../src/session.js";
import { d1Store } from "../../src/store/d1.js";
import type { IdentityStore } from "../../src/store/types.js";
import type { Identity, OutboxEvent, Session, User } from "../../src/types.js";
import { harness, signedInPerson } from "../support/index.js";
import { openDatabase, sqliteAvailable, withLatency, type SqliteDb } from "../support/sqlite.js";
import { runStoreConformance } from "./conformance.js";

/** Every outbox row, as the domain type, in the order they were queued. */
function outboxRows(db: SqliteDb): OutboxEvent[] {
  return db.raw
    .prepare(
      "SELECT id, product, body, created_at, attempts, next_at, delivered_at, failed_at FROM outbox ORDER BY rowid",
    )
    .all()
    .map((row) => ({
      id: String(row.id),
      product: String(row.product),
      body: String(row.body),
      createdAt: String(row.created_at),
      attempts: Number(row.attempts),
      nextAt: String(row.next_at),
      deliveredAt: row.delivered_at === null ? null : String(row.delivered_at),
      failedAt: row.failed_at === null ? null : String(row.failed_at),
    }));
}

/** The text of every row of every table: what "the store holds" comes to. */
function dump(db: SqliteDb): string {
  const tables = db.raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => String(row.name));
  return tables
    .map((table) => JSON.stringify(db.raw.prepare(`SELECT * FROM ${table}`).all()))
    .join("\n");
}

const T = "2026-10-14T12:00:00.000Z";
const user: User = { id: "u1", name: "Ana", picture: "https://example.com/a.png", createdAt: T };
const identity: Identity = {
  provider: "github",
  providerId: "gh-1",
  userId: "u1",
  email: "ana@example.com",
  emailVerified: true,
  verifiedAt: T,
  handle: "ana-dev",
  linkedAt: T,
};
const session: Session = {
  sid: "sid-1",
  userId: "u1",
  createdAt: T,
  lastSeen: T,
  expiresAt: "2026-11-13T12:00:00.000Z",
  label: "Edge on Windows",
  revokedAt: null,
};
const event: OutboxEvent = {
  id: "evt_1",
  product: "diagrams",
  body: "{}",
  createdAt: T,
  attempts: 0,
  nextAt: T,
  deliveredAt: null,
  failedAt: null,
};

describe.skipIf(!sqliteAvailable)("d1Store over node:sqlite", () => {
  runStoreConformance("d1Store", () => {
    const db = openDatabase();
    return { store: d1Store(db), outbox: async () => outboxRows(db), close: () => db.close() };
  });

  describe("the adapter", () => {
    it("runs a batch as one transaction: a failing statement undoes the ones before it", async () => {
      const db = openDatabase();
      const insert = (id: string, name: string) =>
        db
          .prepare("INSERT INTO users (id, name, picture, created_at) VALUES (?, ?, ?, ?)")
          .bind(id, name, "", T);
      // The second statement breaks the primary key, after the first one ran.
      await expect(db.batch([insert("u1", "Ana"), insert("u1", "Duplicate")])).rejects.toThrow();
      expect(db.raw.prepare("SELECT count(*) AS n FROM users").get()).toEqual({ n: 0 });
      // The connection is usable afterwards: the failed transaction was rolled back, not left open.

      await db.batch([insert("u1", "Ana"), insert("u2", "Bo")]);
      expect(db.raw.prepare("SELECT count(*) AS n FROM users").get()).toEqual({ n: 2 });
      db.close();
    });

    it("tells in meta.changes how many rows a write changed, zero included, as D1 does", async () => {
      const db = openDatabase();
      const insert = (id: string) =>
        db
          .prepare("INSERT INTO users (id, name, picture, created_at) VALUES (?, ?, ?, ?)")
          .bind(id, "Ana", "", T)
          .run();
      expect((await insert("u1")).meta?.changes).toBe(1);
      await insert("u2");
      await insert("u3");
      const remove = (id: string) => db.prepare("DELETE FROM users WHERE id <> ?").bind(id).run();
      expect(
        (await db.prepare("DELETE FROM users WHERE id = ?").bind("nobody").run()).meta,
      ).toEqual(expect.objectContaining({ changes: 0 }));
      expect((await remove("u1")).meta?.changes).toBe(2);
      // The count belongs to the statement that ran, not to an earlier one.
      expect((await remove("u1")).meta?.changes).toBe(0);
      db.close();
    });

    it("refuses what D1 refuses and what the store must never send: undefined, booleans, objects", () => {
      const db = openDatabase();
      const statement = db.prepare("SELECT ?");
      expect(() => statement.bind(undefined)).toThrow(/D1_TYPE_ERROR/);
      expect(() => statement.bind(true)).toThrow(/D1_TYPE_ERROR/);
      expect(() => statement.bind({})).toThrow(/D1_TYPE_ERROR/);
      expect(() => statement.bind(Number.NaN)).toThrow(/D1_TYPE_ERROR/);
      expect(() => statement.bind(null)).not.toThrow();
      expect(() => statement.bind(1, "a")).not.toThrow();
      db.close();
    });

    it("answers like D1: first() gives null for no row, all() gives results, run() gives changes", async () => {
      const db = openDatabase();
      expect(await db.prepare("SELECT * FROM users WHERE id = ?").bind("x").first()).toBeNull();
      expect(await db.prepare("SELECT * FROM users").all()).toEqual({ results: [] });
      const ran = (await db
        .prepare("INSERT INTO users (id, name, picture, created_at) VALUES (?, ?, ?, ?)")
        .bind("u1", "Ana", "", T)
        .run()) as { success: boolean; meta: { changes: number } };
      expect(ran.success).toBe(true);
      expect(ran.meta.changes).toBe(1);
      const row = await db.prepare("SELECT id, name FROM users").first<{ id: string }>();
      expect(row).toEqual({ id: "u1", name: "Ana" });
      // A plain object, as D1 returns, not a null-prototype one.
      expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
      db.close();
    });

    it("rejects a batch that holds a statement of another database", async () => {
      const db = openDatabase();
      await expect(
        db.batch([
          {
            bind: () => null as never,
            first: async () => null,
            all: async () => ({ results: [] }),
            run: async () => ({}),
          },
        ]),
      ).rejects.toThrow(/this database/);
      db.close();
    });
  });

  describe("the statements", () => {
    /** Calls every method of the store, with values that would break out of pasted-in SQL. */
    async function useEveryMethod(store: IdentityStore): Promise<Set<string>> {
      const called = new Set<string>();
      const spy = new Proxy(store, {
        get(target, property, receiver) {
          const member = Reflect.get(target, property, receiver) as unknown;
          if (typeof member !== "function") return member;
          return (...args: unknown[]) => {
            called.add(String(property));
            return (member as (...a: unknown[]) => unknown)(...args);
          };
        },
      });
      const evil = "x'); DROP TABLE users; --";
      await spy.createUser({ ...user, id: evil, name: evil, picture: evil });
      await spy.updateUser(evil, { name: evil, picture: evil });
      await spy.userById(evil);
      await spy.addIdentity({
        ...identity,
        providerId: evil,
        userId: evil,
        email: evil,
        handle: evil,
      });
      await spy.updateIdentity("github", evil, {
        email: evil,
        emailVerified: true,
        verifiedAt: T,
        handle: evil,
      });
      await spy.identity("github", evil);
      await spy.identitiesOf(evil);
      await spy.identityByVerifiedEmail(evil);
      await spy.createSession({ ...session, sid: evil, userId: evil, label: evil });
      await spy.session(evil);
      await spy.touchSession(evil, T);
      await spy.revokeSession(evil, T);
      await spy.revokeOtherSessions(evil, evil, T);
      await spy.sessionsOf(evil, T);
      await spy.deleteSessionsBefore(T);
      await spy.enqueueEvents([{ ...event, id: evil, product: evil, body: evil }]);
      await spy.dueEvents(T, 5);
      await spy.markDelivered(evil, T);
      await spy.recordFailure(evil, { nextAt: evil });
      await spy.recordFailure(evil, { failedAt: evil });
      // The only identity is GitHub's, so nothing goes (the follow-up read runs); with a Google
      // one beside it, the conditional delete removes.
      expect(await spy.unlinkProvider(evil, "github")).toBe("last");
      await spy.addIdentity({
        ...identity,
        provider: "google",
        providerId: evil,
        userId: evil,
        email: evil,
        handle: evil,
      });
      expect(await spy.unlinkProvider(evil, "github")).toBe("removed");
      await spy.deleteUser(evil, [{ ...event, id: `${evil}-2`, product: evil, body: evil }]);
      return called;
    }

    it("are constants with placeholders: no value is ever pasted into the SQL", async () => {
      const db = openDatabase();
      const called = await useEveryMethod(d1Store(db));
      // Every method of the interface ran, so every statement of the store was looked at.
      expect([...called].sort()).toEqual(Object.keys(d1Store(db)).sort());
      expect(db.queries.length).toBeGreaterThan(20);
      for (const { sql, values } of db.queries) {
        expect(sql).not.toContain("DROP TABLE");
        expect(sql).not.toContain("x'");
        expect(sql).not.toContain(T);
        expect(sql).not.toMatch(/'/);
        expect(sql.match(/\?/g)?.length ?? 0, sql).toBe(values.length);
      }
      // The table the injected text names is still there, with its data deleted by deleteUser only.
      expect(db.raw.prepare("SELECT count(*) AS n FROM users").get()).toEqual({ n: 0 });
      db.close();
    });

    it("binds booleans as 0 and 1 and a missing time as null, never undefined", async () => {
      const db = openDatabase();
      const store = d1Store(db);
      await store.createUser(user);
      await store.addIdentity({ ...identity, emailVerified: false, verifiedAt: null });
      await store.createSession(session);
      await store.enqueueEvents([event]);
      for (const { values } of db.queries) {
        for (const value of values) {
          expect(["string", "number"].includes(typeof value) || value === null).toBe(true);
        }
      }
      db.close();
    });
  });

  describe("how rows are stored", () => {
    it("keeps booleans as the integers 0 and 1 and a missing time as NULL", async () => {
      const db = openDatabase();
      const store = d1Store(db);
      await store.createUser(user);
      await store.addIdentity(identity);
      await store.addIdentity({
        ...identity,
        provider: "google",
        providerId: "g-1",
        emailVerified: false,
        verifiedAt: null,
      });
      const rows = db.raw
        .prepare(
          "SELECT provider, typeof(email_verified) AS type, email_verified, verified_at FROM identities ORDER BY provider",
        )
        .all();
      expect(rows).toEqual([
        { provider: "github", type: "integer", email_verified: 1, verified_at: T },
        { provider: "google", type: "integer", email_verified: 0, verified_at: null },
      ]);
      db.close();
    });

    it("keeps times as the ISO text it was given and a live session's revoked_at as NULL", async () => {
      const db = openDatabase();
      const store = d1Store(db);
      await store.createUser(user);
      await store.createSession(session);
      await store.createSession({
        ...session,
        sid: "sid-2",
        revokedAt: "2026-10-15T00:00:00.000Z",
      });
      expect(
        db.raw
          .prepare(
            "SELECT sid, typeof(created_at) AS t, created_at, expires_at, revoked_at FROM sessions ORDER BY sid",
          )
          .all(),
      ).toEqual([
        { sid: "sid-1", t: "text", created_at: T, expires_at: session.expiresAt, revoked_at: null },
        {
          sid: "sid-2",
          t: "text",
          created_at: T,
          expires_at: session.expiresAt,
          revoked_at: "2026-10-15T00:00:00.000Z",
        },
      ]);
      db.close();
    });

    it("counts attempts as an integer in the outbox", async () => {
      const db = openDatabase();
      const store = d1Store(db);
      await store.enqueueEvents([event]);
      await store.recordFailure("evt_1", { nextAt: "2026-10-14T12:01:00.000Z" });
      expect(db.raw.prepare("SELECT typeof(attempts) AS t, attempts FROM outbox").get()).toEqual({
        t: "integer",
        attempts: 1,
      });
      db.close();
    });
  });

  describe("transactions", () => {
    it("deleteUser is one batch of three explicit deletes, children first", async () => {
      const db = openDatabase();
      const store = d1Store(db);
      await store.createUser(user);
      const before = db.queries.length;
      await store.deleteUser("u1");
      const ran = db.queries.slice(before);
      expect(ran.map((q) => q.sql)).toEqual([
        "DELETE FROM sessions WHERE user_id = ?",
        "DELETE FROM identities WHERE user_id = ?",
        "DELETE FROM users WHERE id = ?",
      ]);
      expect(new Set(ran.map((q) => q.batch)).size).toBe(1);
      expect(ran[0]?.batch).not.toBeNull();
      db.close();
    });

    it("deleteUser undoes its first deletes when the last one fails", async () => {
      const db = openDatabase();
      const store = d1Store(db);
      await store.createUser(user);
      await store.addIdentity(identity);
      await store.createSession(session);
      db.raw.exec(
        "CREATE TRIGGER refuse_user_delete BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'refused'); END",
      );
      await expect(store.deleteUser("u1")).rejects.toThrow(/refused/);
      expect(await store.userById("u1")).toBeDefined();
      expect(await store.identitiesOf("u1")).toHaveLength(1);
      expect(await store.session("sid-1")).toBeDefined();
      db.close();
    });

    it("deleteUser with events is one batch: the events first, then the three deletes", async () => {
      const db = openDatabase();
      const store = d1Store(db);
      await store.createUser(user);
      const before = db.queries.length;
      await store.deleteUser("u1", [event, { ...event, id: "evt_2", product: "ide" }]);
      const ran = db.queries.slice(before);
      expect(ran.map((q) => q.sql.replace(/\(.*?\) VALUES \(.*?\)/, "(...)"))).toEqual([
        "INSERT INTO outbox (...) ON CONFLICT (id) DO NOTHING",
        "INSERT INTO outbox (...) ON CONFLICT (id) DO NOTHING",
        "DELETE FROM sessions WHERE user_id = ?",
        "DELETE FROM identities WHERE user_id = ?",
        "DELETE FROM users WHERE id = ?",
      ]);
      // Nothing outside the one transaction: no statement ran alone, before or after.
      expect(new Set(ran.map((q) => q.batch)).size).toBe(1);
      expect(ran[0]?.batch).not.toBeNull();
      expect(outboxRows(db).map((e) => e.id)).toEqual(["evt_1", "evt_2"]);
      db.close();
    });

    it("deleteUser undoes the events it queued when a delete fails", async () => {
      const db = openDatabase();
      const store = d1Store(db);
      await store.createUser(user);
      await store.addIdentity(identity);
      await store.createSession(session);
      await store.enqueueEvents([{ ...event, id: "evt_earlier" }]);
      db.raw.exec(
        "CREATE TRIGGER refuse_user_delete BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'refused'); END",
      );

      await expect(
        store.deleteUser("u1", [event, { ...event, id: "evt_2", product: "ide" }]),
      ).rejects.toThrow(/refused/);

      // The account is whole, and not one of the new events was queued; the earlier one is there.
      expect(await store.userById("u1")).toBeDefined();
      expect(await store.identitiesOf("u1")).toHaveLength(1);
      expect(await store.session("sid-1")).toBeDefined();
      expect(outboxRows(db).map((e) => e.id)).toEqual(["evt_earlier"]);
      db.close();
    });

    it("deleteUser deletes nothing when an event is refused after the ones before it were fine", async () => {
      const db = openDatabase();
      const store = d1Store(db);
      await store.createUser(user);
      await store.addIdentity(identity);
      await store.addIdentity({ ...identity, provider: "google", providerId: "g-1" });
      await store.createSession(session);
      await store.enqueueEvents([{ ...event, id: "evt_earlier" }]);

      await expect(
        store.deleteUser("u1", [
          event,
          { ...event, id: "evt_2", product: "ide" },
          { ...event, id: "evt_bad", attempts: -1 }, // breaks CHECK (attempts >= 0)
        ]),
      ).rejects.toThrow();

      expect(await store.userById("u1")).toEqual(user);
      expect(await store.identitiesOf("u1")).toHaveLength(2);
      expect(await store.session("sid-1")).toEqual(session);
      expect(outboxRows(db).map((e) => e.id)).toEqual(["evt_earlier"]);
      // Nothing was left half done: the same call with sound events goes through.
      await store.deleteUser("u1", [event, { ...event, id: "evt_2", product: "ide" }]);
      expect(await store.userById("u1")).toBeUndefined();
      expect(outboxRows(db).map((e) => e.id)).toEqual(["evt_earlier", "evt_1", "evt_2"]);
      db.close();
    });

    it("deleteUser queues its events and deletes without the foreign keys too", async () => {
      const db = openDatabase({ foreignKeys: false });
      const store = d1Store(db);
      await store.createUser(user);
      await store.addIdentity(identity);
      await store.createSession(session);

      await store.deleteUser("u1", [event]);

      expect(db.raw.prepare("SELECT count(*) AS n FROM users").get()).toEqual({ n: 0 });
      expect(db.raw.prepare("SELECT count(*) AS n FROM identities").get()).toEqual({ n: 0 });
      expect(db.raw.prepare("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 0 });
      expect(outboxRows(db).map((e) => e.id)).toEqual(["evt_1"]);
      db.close();
    });

    it("deleteUser works without the foreign keys: it does not rely on the cascade", async () => {
      const db = openDatabase({ foreignKeys: false });
      expect(db.raw.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 0 });
      const store = d1Store(db);
      await store.createUser(user);
      await store.createUser({ ...user, id: "u2" });
      await store.addIdentity(identity);
      await store.addIdentity({ ...identity, providerId: "gh-2", userId: "u2" });
      await store.createSession(session);
      await store.createSession({ ...session, sid: "sid-2", userId: "u2" });
      await store.enqueueEvents([event]);

      await store.deleteUser("u1");

      expect(db.raw.prepare("SELECT user_id FROM identities").all()).toEqual([{ user_id: "u2" }]);
      expect(db.raw.prepare("SELECT user_id FROM sessions").all()).toEqual([{ user_id: "u2" }]);
      expect(db.raw.prepare("SELECT id FROM users").all()).toEqual([{ id: "u2" }]);
      expect(outboxRows(db)).toHaveLength(1);
      db.close();
    });

    it("enqueueEvents queues all its events or none", async () => {
      const db = openDatabase();
      const store = d1Store(db);
      await expect(
        store.enqueueEvents([
          event,
          { ...event, id: "evt_2" },
          { ...event, id: "evt_bad", attempts: -1 }, // breaks CHECK (attempts >= 0)
        ]),
      ).rejects.toThrow();
      expect(outboxRows(db)).toEqual([]);
      await store.enqueueEvents([event, { ...event, id: "evt_2" }]);
      expect(outboxRows(db).map((e) => e.id)).toEqual(["evt_1", "evt_2"]);
      expect(
        db.queries.filter((q) => q.batch !== null).every((q) => q.sql.startsWith("INSERT")),
      ).toBe(true);
      db.close();
    });

    it("queues the events of one call in one batch", async () => {
      const db = openDatabase();
      const store = d1Store(db);
      await store.enqueueEvents([event, { ...event, id: "evt_2" }, { ...event, id: "evt_3" }]);
      expect(db.queries).toHaveLength(3);
      expect(new Set(db.queries.map((q) => q.batch)).size).toBe(1);
      db.close();
    });

    it("runs nothing at all for an empty list of events", async () => {
      const db = openDatabase();
      await d1Store(db).enqueueEvents([]);
      expect(db.queries).toEqual([]);
      db.close();
    });
  });

  describe("unlinking a provider", () => {
    const UNLINK_SQL =
      "DELETE FROM identities WHERE user_id = ? AND provider = ? AND EXISTS (SELECT 1 FROM identities WHERE user_id = ? AND provider <> ?)";
    const google: Identity = { ...identity, provider: "google", providerId: "g-1" };

    /** Opens a database where u1 has a GitHub and a Google identity. */
    async function withBoth() {
      const db = openDatabase();
      const store = d1Store(db);
      await store.createUser(user);
      await store.addIdentity(identity);
      await store.addIdentity(google);
      return { db, store };
    }

    const identitiesLeft = (db: SqliteDb, userId: string): string[] =>
      db.raw
        .prepare("SELECT provider FROM identities WHERE user_id = ? ORDER BY provider")
        .all(userId)
        .map((row) => String(row.provider));

    it("is one conditional DELETE when it removes, and nothing else", async () => {
      const { db, store } = await withBoth();
      const before = db.queries.length;
      expect(await store.unlinkProvider("u1", "google")).toBe("removed");
      const ran = db.queries.slice(before);
      expect(ran).toHaveLength(1);
      expect(ran[0]?.sql).toBe(UNLINK_SQL);
      expect(ran[0]?.values).toEqual(["u1", "google", "u1", "google"]);
      expect(identitiesLeft(db, "u1")).toEqual(["github"]);
      db.close();
    });

    it("adds one read to tell last from absent when the DELETE removed nothing", async () => {
      const { db, store } = await withBoth();
      await store.unlinkProvider("u1", "google");

      const before = db.queries.length;
      expect(await store.unlinkProvider("u1", "github")).toBe("last");
      expect(await store.unlinkProvider("u1", "google")).toBe("absent");
      const ran = db.queries.slice(before);
      expect(ran.map((q) => q.sql)).toEqual([
        UNLINK_SQL,
        "SELECT 1 AS held FROM identities WHERE user_id = ? AND provider = ? LIMIT 1",
        UNLINK_SQL,
        "SELECT 1 AS held FROM identities WHERE user_id = ? AND provider = ? LIMIT 1",
      ]);
      expect(ran.map((q) => q.values)).toEqual([
        ["u1", "github", "u1", "github"],
        ["u1", "github"],
        ["u1", "google", "u1", "google"],
        ["u1", "google"],
      ]);
      expect(identitiesLeft(db, "u1")).toEqual(["github"]);
      db.close();
    });

    /**
     * A database that answers every write with `ran` and every read with `row`, whatever the
     * statement says: it shows what the store takes from the answers and nothing else.
     */
    function answering(ran: { meta?: { changes?: number } }, row: unknown): D1Like {
      const statement: D1PreparedLike = {
        bind: () => statement,
        first: async <T>() => row as T | null,
        all: async () => ({ results: [] }),
        run: async () => ran,
      };
      return { prepare: () => statement, batch: async () => [] };
    }

    it("takes the answer from meta.changes of the DELETE, then from the follow-up read", async () => {
      // Rows went: removed, and the read is not needed (it would say `last`).
      expect(
        await d1Store(answering({ meta: { changes: 2 } }, { held: 1 })).unlinkProvider(
          "u",
          "github",
        ),
      ).toBe("removed");
      // Nothing went, and the user still has this provider: it is all they have.
      expect(
        await d1Store(answering({ meta: { changes: 0 } }, { held: 1 })).unlinkProvider(
          "u",
          "github",
        ),
      ).toBe("last");
      // Nothing went, and the user has none of it.
      expect(
        await d1Store(answering({ meta: { changes: 0 } }, null)).unlinkProvider("u", "github"),
      ).toBe("absent");
    });

    it("refuses to guess when the database does not say how many rows changed", async () => {
      for (const ran of [{}, { meta: {} }, { meta: { changes: undefined } }]) {
        await expect(
          d1Store(answering(ran, { held: 1 })).unlinkProvider("u", "github"),
        ).rejects.toThrow(/did not report the rows changed/);
      }
    });

    const wires = [
      ["on the bare adapter", (db: SqliteDb): D1Like => db],
      ["with a round trip before every statement", withLatency],
    ] as const;

    it.each(wires)(
      "leaves nothing to chance when two stores over one database unlink at once, %s",
      async (_wire, wire) => {
        const db = openDatabase();
        for (let round = 0; round < 40; round++) {
          const userId = `u${round}`;
          await d1Store(db).createUser({ ...user, id: userId });
          await d1Store(db).addIdentity({ ...identity, providerId: `gh-${round}`, userId });
          await d1Store(db).addIdentity({ ...google, providerId: `g-${round}`, userId });

          // Two requests, each with its own store, started in the same tick.
          const outcomes = await Promise.all(
            round % 2 === 0
              ? [
                  d1Store(wire(db)).unlinkProvider(userId, "github"),
                  d1Store(wire(db)).unlinkProvider(userId, "google"),
                ]
              : [
                  d1Store(wire(db)).unlinkProvider(userId, "google"),
                  d1Store(wire(db)).unlinkProvider(userId, "github"),
                ],
          );

          expect([...outcomes].sort(), `round ${round}`).toEqual(["last", "removed"]);
          expect(identitiesLeft(db, userId), `round ${round}`).toHaveLength(1);
        }
        db.close();
      },
    );

    it.each(wires)(
      "is what the race needs: a check followed by a delete does lose it, %s",
      async (_wire, wire) => {
        // The control for the test above. The handlers used to read the identities and then
        // delete one by one; two requests started together both read two identities, both found
        // "another provider remains", and both deleted: a user with no way to sign in. If the
        // database did not let two requests interleave at their awaits, the test above would
        // prove nothing.
        const { db } = await withBoth();
        const store = d1Store(wire(db));
        const checkThenDelete = async (provider: "github" | "google") => {
          const identities = await store.identitiesOf("u1");
          const mine = identities.filter((i) => i.provider === provider);
          if (mine.length === identities.length) return "last";
          for (const i of mine) {
            await wire(db)
              .prepare("DELETE FROM identities WHERE provider = ? AND provider_id = ?")
              .bind(i.provider, i.providerId)
              .run();
          }
          return "removed";
        };

        const outcomes = await Promise.all([checkThenDelete("github"), checkThenDelete("google")]);

        expect(outcomes).toEqual(["removed", "removed"]);
        expect(identitiesLeft(db, "u1")).toEqual([]);
        db.close();
      },
    );
  });

  describe("the indexes", () => {
    /** The plan SQLite gives the last statement a store call ran. */
    function planOfLast(db: SqliteDb): string {
      const last = db.queries.at(-1);
      if (!last) throw new Error("no query was run");
      return db.raw
        .prepare(`EXPLAIN QUERY PLAN ${last.sql}`)
        .all(...last.values)
        .map((row) => String(row.detail))
        .join(" | ");
    }

    it("serve the lookups the handlers make, with no scan of a whole table", async () => {
      const db = openDatabase();
      const store = d1Store(db);
      const plans: Record<string, string> = {};
      const probe = async (name: string, call: () => Promise<unknown>) => {
        await call();
        plans[name] = planOfLast(db);
      };
      await probe("userById", () => store.userById("u1"));
      await probe("identity", () => store.identity("github", "gh-1"));
      await probe("identitiesOf", () => store.identitiesOf("u1"));
      await probe("identityByVerifiedEmail", () =>
        store.identityByVerifiedEmail("ana@example.com"),
      );
      await probe("session", () => store.session("sid-1"));
      await probe("sessionsOf", () => store.sessionsOf("u1", T));
      await probe("dueEvents", () => store.dueEvents(T, 100));
      await store.createUser(user);
      await store.addIdentity(identity);
      await store.addIdentity({ ...identity, provider: "google", providerId: "g-1" });
      await probe("unlinkProvider (the DELETE)", () => store.unlinkProvider("u1", "google"));
      await probe("unlinkProvider (the follow-up read)", () =>
        store.unlinkProvider("u1", "google"),
      );

      expect(plans.userById).toMatch(/SEARCH users USING .*(PRIMARY KEY|autoindex)/);
      expect(plans.identity).toMatch(/SEARCH identities USING .*(PRIMARY KEY|autoindex)/);
      expect(plans.identitiesOf).toMatch(/SEARCH identities USING INDEX identities_user_id/);
      expect(plans.identityByVerifiedEmail).toMatch(
        /SEARCH identities USING INDEX identities_verified_email/,
      );
      expect(plans.session).toMatch(/SEARCH sessions USING .*(PRIMARY KEY|autoindex)/);
      expect(plans.sessionsOf).toMatch(/SEARCH sessions USING INDEX sessions_user_id/);
      expect(plans.dueEvents).toMatch(/SEARCH outbox USING INDEX outbox_due/);
      // The statement that deletes, its subquery, and the read that follows it all go by user.
      expect(plans["unlinkProvider (the DELETE)"]?.match(/identities_user_id/g)).toHaveLength(2);
      expect(plans["unlinkProvider (the follow-up read)"]).toMatch(
        /SEARCH identities USING INDEX identities_user_id/,
      );
      for (const [name, plan] of Object.entries(plans)) expect(plan, name).not.toMatch(/\bSCAN\b/);
      db.close();
    });
  });

  describe("one store per request", () => {
    it("holds no state of its own: two stores over one database see the same rows", async () => {
      const db = openDatabase();
      const first = d1Store(db);
      const second = d1Store(db);
      await first.createUser(user);
      expect(await second.userById("u1")).toEqual(user);
      await second.deleteUser("u1");
      expect(await first.userById("u1")).toBeUndefined();
      db.close();
    });
  });

  describe("under the sign-in code", () => {
    it("signs a person in over D1: startSession's rows are read back by currentSession", async () => {
      const db = openDatabase();
      const h = await harness({ store: d1Store(db) });
      const person = await signedInPerson(h);
      const ctx: Ctx = {
        request: new Request(`${h.env.ISSUER}/account`, { headers: { Cookie: person.cookie } }),
        url: new URL(`${h.env.ISSUER}/account`),
        env: h.env,
        deps: h.deps,
        config: readConfig(h.env),
        lang: "en",
        params: {},
      };

      const current = await currentSession(ctx);
      expect(current?.user).toEqual(person.user);
      expect(current?.session).toEqual(person.session);
      expect(await h.store.sessionsOf(person.user.id, h.clock.now().toISOString())).toEqual([
        person.session,
      ]);

      // A revocation is seen at once, and so is the expiry instant.
      await h.store.revokeSession(person.session.sid, h.clock.now().toISOString());
      expect(await currentSession(ctx)).toBeUndefined();
      db.close();
    });

    it("stops recognizing a session at its expiry instant", async () => {
      const db = openDatabase();
      const h = await harness({ store: d1Store(db) });
      const person = await signedInPerson(h);
      const ctx: Ctx = {
        request: new Request(`${h.env.ISSUER}/account`, { headers: { Cookie: person.cookie } }),
        url: new URL(`${h.env.ISSUER}/account`),
        env: h.env,
        deps: h.deps,
        config: readConfig(h.env),
        lang: "en",
        params: {},
      };
      h.clock.set(new Date(Date.parse(person.session.expiresAt) - 1000).toISOString());
      expect(await currentSession(ctx)).toBeDefined();
      h.clock.set(person.session.expiresAt);
      expect(await currentSession(ctx)).toBeUndefined();
      db.close();
    });

    it("holds only a coarse label: the raw User-Agent, the token and the cookie appear nowhere", async () => {
      const db = openDatabase();
      const h = await harness({ store: d1Store(db) });
      const userAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
      const person = await signedInPerson(h, { userAgent });
      const everything = dump(db);
      expect(everything).toContain("Edge on Windows");
      expect(everything).not.toContain("Mozilla");
      expect(everything).not.toContain("AppleWebKit");
      expect(everything).not.toContain("130.0.0.0");
      expect(everything).not.toContain(person.token);
      expect(everything).not.toContain("meltemi_session");
      db.close();
    });
  });
});
