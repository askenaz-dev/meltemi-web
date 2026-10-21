// The migrations over node:sqlite: what "What the service holds" (spec identity-account) says the
// database is, checked against the database itself.

import { describe, expect, it } from "vitest";
import { migrationFiles, openDatabase, sqliteAvailable } from "./support/sqlite.js";

/** `name`, `type`, whether it is NOT NULL, and its position in the primary key (0: not in it). */
type Column = readonly [name: string, type: "TEXT" | "INTEGER", notNull: boolean, pk: number];

const EXPECTED: Record<string, readonly Column[]> = {
  users: [
    ["id", "TEXT", true, 1],
    ["name", "TEXT", true, 0],
    ["picture", "TEXT", true, 0],
    ["created_at", "TEXT", true, 0],
  ],
  identities: [
    ["provider", "TEXT", true, 1],
    ["provider_id", "TEXT", true, 2],
    ["user_id", "TEXT", true, 0],
    ["email", "TEXT", true, 0],
    ["email_verified", "INTEGER", true, 0],
    ["verified_at", "TEXT", false, 0],
    ["handle", "TEXT", true, 0],
    ["linked_at", "TEXT", true, 0],
  ],
  sessions: [
    ["sid", "TEXT", true, 1],
    ["user_id", "TEXT", true, 0],
    ["created_at", "TEXT", true, 0],
    ["last_seen", "TEXT", true, 0],
    ["expires_at", "TEXT", true, 0],
    ["label", "TEXT", true, 0],
    ["revoked_at", "TEXT", false, 0],
  ],
  outbox: [
    ["id", "TEXT", true, 1],
    ["product", "TEXT", true, 0],
    ["body", "TEXT", true, 0],
    ["created_at", "TEXT", true, 0],
    ["attempts", "INTEGER", true, 0],
    ["next_at", "TEXT", true, 0],
    ["delivered_at", "TEXT", false, 0],
    ["failed_at", "TEXT", false, 0],
  ],
};

const T = "2026-10-14T12:00:00.000Z";

/** The tables the service made, without SQLite's own and wrangler's bookkeeping table. */
function tablesOf(db: ReturnType<typeof openDatabase>): string[] {
  return db.raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => String(row.name))
    .filter((name) => !name.startsWith("sqlite_") && name !== "d1_migrations")
    .sort();
}

const squash = (sql: unknown) => String(sql).replace(/\s+/g, " ").trim();

describe.skipIf(!sqliteAvailable)("the migrations", () => {
  it("are numbered files wrangler applies in order, starting at 0001_identity.sql", () => {
    const names = migrationFiles().map((file) => file.name);
    expect(names[0]).toBe("0001_identity.sql");
    names.forEach((name, index) => {
      expect(name).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
      expect(Number(name.slice(0, 4))).toBe(index + 1);
    });
  });

  it("create exactly the tables users, identities, sessions and outbox", () => {
    const db = openDatabase();
    expect(tablesOf(db)).toEqual(["identities", "outbox", "sessions", "users"]);
    db.close();
  });

  it("create no view and no trigger", () => {
    const db = openDatabase();
    const kinds = db.raw
      .prepare("SELECT DISTINCT type FROM sqlite_master ORDER BY type")
      .all()
      .map((row) => String(row.type));
    expect(kinds).toEqual(["index", "table"]);
    db.close();
  });

  for (const [table, columns] of Object.entries(EXPECTED)) {
    it(`give ${table} exactly the columns the inventory lists`, () => {
      const db = openDatabase();
      const actual = db.raw
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => [String(row.name), String(row.type), row.notnull === 1, Number(row.pk)]);
      expect(actual).toEqual(columns.map((column) => [...column]));
      db.close();
    });
  }

  it("make every table STRICT, so a boolean or a time cannot be stored as the wrong type", () => {
    const db = openDatabase();
    const strict = db.raw
      .prepare("PRAGMA table_list")
      .all()
      .filter((row) => String(row.name) in EXPECTED)
      .map((row) => [String(row.name), Number(row.strict)]);
    expect(strict.sort()).toEqual([
      ["identities", 1],
      ["outbox", 1],
      ["sessions", 1],
      ["users", 1],
    ]);
    // Text that is not a number cannot go into an INTEGER column (a boolean must be 0 or 1).
    db.raw
      .prepare("INSERT INTO users (id, name, picture, created_at) VALUES ('u1', 'Ana', '', ?)")
      .run(T);
    expect(() =>
      db.raw
        .prepare(
          "INSERT INTO identities (provider, provider_id, user_id, email, email_verified, handle, linked_at) VALUES ('github', 'g', 'u1', 'a@example.com', 'yes', '', ?)",
        )
        .run(T),
    ).toThrow(/cannot store TEXT value in INTEGER column/);
    db.close();
  });

  it("make exactly the indexes on user, verified email, session user and due events", () => {
    const db = openDatabase();
    const indexes = db.raw
      .prepare(
        "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name",
      )
      .all()
      .map((row) => [String(row.name), String(row.tbl_name), squash(row.sql)]);
    expect(indexes).toEqual([
      [
        "identities_user_id",
        "identities",
        "CREATE INDEX identities_user_id ON identities (user_id)",
      ],
      [
        "identities_verified_email",
        "identities",
        "CREATE INDEX identities_verified_email ON identities (lower(email)) WHERE email_verified = 1",
      ],
      [
        "outbox_due",
        "outbox",
        "CREATE INDEX outbox_due ON outbox (next_at) WHERE delivered_at IS NULL AND failed_at IS NULL",
      ],
      ["sessions_user_id", "sessions", "CREATE INDEX sessions_user_id ON sessions (user_id)"],
    ]);
    // The two on the conditions are partial; the other two cover every row.
    const partial = (table: string, name: string) =>
      db.raw
        .prepare(`PRAGMA index_list(${table})`)
        .all()
        .find((row) => row.name === name)?.partial;
    expect(partial("identities", "identities_verified_email")).toBe(1);
    expect(partial("outbox", "outbox_due")).toBe(1);
    expect(partial("identities", "identities_user_id")).toBe(0);
    expect(partial("sessions", "sessions_user_id")).toBe(0);
    db.close();
  });

  it("have no column that could hold a provider token, a raw User-Agent or a request log", () => {
    const db = openDatabase();
    const names = Object.keys(EXPECTED).flatMap((table) =>
      db.raw
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => `${table}.${String(row.name)}`),
    );
    expect(names).toHaveLength(Object.values(EXPECTED).flat().length);
    const forbidden =
      /token|secret|credential|password|jwt|cookie|header|agent|\bua\b|_ua\b|browser|\bip\b|_ip\b|address|request|referer|referrer|log\b|analytics|refresh|access/i;
    for (const name of names) {
      // `outbox.body` is the event, `{ id, type, sub, at }`; `sessions.label` is a coarse label.
      expect(name, `${name} should not be able to hold such data`).not.toMatch(forbidden);
    }
    // No column takes binary data, so nothing opaque (a token, a blob) is stored either.
    const types = new Set(
      Object.values(EXPECTED)
        .flat()
        .map((column) => column[1]),
    );
    expect([...types].sort()).toEqual(["INTEGER", "TEXT"]);
    db.close();
  });

  describe("the constraints", () => {
    const user = (db: ReturnType<typeof openDatabase>, id = "u1") =>
      db.raw
        .prepare("INSERT INTO users (id, name, picture, created_at) VALUES (?, 'Ana', '', ?)")
        .run(id, T);
    const identity = (db: ReturnType<typeof openDatabase>, userId = "u1", verified = 1) =>
      db.raw
        .prepare(
          "INSERT INTO identities (provider, provider_id, user_id, email, email_verified, verified_at, handle, linked_at) VALUES ('github', ?, ?, 'a@example.com', ?, NULL, '', ?)",
        )
        .run(`gh-${userId}`, userId, verified, T);
    const session = (db: ReturnType<typeof openDatabase>, userId = "u1", sid = `sid-${userId}`) =>
      db.raw
        .prepare(
          "INSERT INTO sessions (sid, user_id, created_at, last_seen, expires_at, label, revoked_at) VALUES (?, ?, ?, ?, ?, 'Edge on Windows', NULL)",
        )
        .run(sid, userId, T, T, T);
    const count = (db: ReturnType<typeof openDatabase>, table: string) =>
      Number(db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);

    it("cascade from a user to its identities and sessions, and never to the outbox", () => {
      const db = openDatabase();
      user(db, "u1");
      user(db, "u2");
      identity(db, "u1");
      identity(db, "u2");
      session(db, "u1");
      session(db, "u2");
      db.raw
        .prepare(
          "INSERT INTO outbox (id, product, body, created_at, next_at) VALUES ('evt_1', 'diagrams', '{}', ?, ?)",
        )
        .run(T, T);

      db.raw.prepare("DELETE FROM users WHERE id = 'u1'").run();

      expect(db.raw.prepare("SELECT user_id FROM identities").all()).toEqual([{ user_id: "u2" }]);
      expect(db.raw.prepare("SELECT user_id FROM sessions").all()).toEqual([{ user_id: "u2" }]);
      expect(count(db, "outbox")).toBe(1);
      db.close();
    });

    it("name the users table as the parent of identities and sessions, and of nothing else", () => {
      const db = openDatabase();
      for (const table of ["identities", "sessions"]) {
        expect(
          db.raw
            .prepare(`PRAGMA foreign_key_list(${table})`)
            .all()
            .map((row) => [row.table, row.from, row.to, row.on_delete]),
        ).toEqual([["users", "user_id", "id", "CASCADE"]]);
      }
      for (const table of ["users", "outbox"]) {
        expect(db.raw.prepare(`PRAGMA foreign_key_list(${table})`).all()).toEqual([]);
      }
      db.close();
    });

    it("refuse an identity or a session of a user that does not exist", () => {
      const db = openDatabase();
      expect(() => identity(db, "nobody")).toThrow(/FOREIGN KEY/);
      expect(() => session(db, "nobody")).toThrow(/FOREIGN KEY/);
      expect(count(db, "identities") + count(db, "sessions")).toBe(0);
      db.close();
    });

    it("keep a provider id unique per provider, and a user id and a sid unique", () => {
      const db = openDatabase();
      user(db);
      identity(db);
      expect(() => identity(db)).toThrow(/UNIQUE|PRIMARY KEY/);
      expect(() => user(db)).toThrow(/UNIQUE|PRIMARY KEY/);
      session(db);
      expect(() => session(db)).toThrow(/UNIQUE|PRIMARY KEY/);
      db.close();
    });

    it("accept only 0 or 1 for a verified email and a count of attempts of 0 or more", () => {
      const db = openDatabase();
      user(db);
      expect(() => identity(db, "u1", 2)).toThrow(/CHECK/);
      expect(() => identity(db, "u1", -1)).toThrow(/CHECK/);
      expect(() =>
        db.raw
          .prepare(
            "INSERT INTO outbox (id, product, body, created_at, attempts, next_at) VALUES ('e', 'p', '{}', ?, -1, ?)",
          )
          .run(T, T),
      ).toThrow(/CHECK/);
      db.close();
    });

    it("start an outbox event at zero attempts, neither delivered nor failed", () => {
      const db = openDatabase();
      db.raw
        .prepare(
          "INSERT INTO outbox (id, product, body, created_at, next_at) VALUES ('e', 'p', '{}', ?, ?)",
        )
        .run(T, T);
      expect(db.raw.prepare("SELECT attempts, delivered_at, failed_at FROM outbox").get()).toEqual({
        attempts: 0,
        delivered_at: null,
        failed_at: null,
      });
      db.close();
    });

    it("refuse a NULL where the inventory needs a value", () => {
      const db = openDatabase();
      expect(() =>
        db.raw
          .prepare("INSERT INTO users (id, name, picture, created_at) VALUES ('u', NULL, '', ?)")
          .run(T),
      ).toThrow(/NOT NULL/);
      expect(() =>
        db.raw
          .prepare("INSERT INTO users (id, name, picture, created_at) VALUES (NULL, 'n', '', ?)")
          .run(T),
      ).toThrow(/NOT NULL/);
      db.close();
    });
  });
});
