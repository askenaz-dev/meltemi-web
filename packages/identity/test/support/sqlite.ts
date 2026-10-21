// A `D1Like` over `node:sqlite`, so the SQL of `d1Store` runs in Node with no Cloudflare and no
// network. `node:sqlite` exists from Node 22.5 (behind a flag until 22.13), so it is loaded with a
// dynamic import: where it is missing `sqliteAvailable` is false and the suites that need it skip.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { D1Like, D1PreparedLike } from "../../src/env.js";

async function loadSqlite(): Promise<typeof import("node:sqlite") | undefined> {
  try {
    return await import("node:sqlite");
  } catch {
    return undefined;
  }
}

const sqlite = await loadSqlite();

/** Whether this Node has `node:sqlite`; `describe.skipIf(!sqliteAvailable)` guards the suites. */
export const sqliteAvailable: boolean = sqlite !== undefined;

/** The folder with the migrations of the package. */
export const migrationsDir = fileURLToPath(new URL("../../migrations/", import.meta.url));

/** The migrations in the order they apply (by file name, as wrangler orders them). */
export function migrationFiles(): { name: string; sql: string }[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), "utf8") }));
}

/** What the adapter answers for a statement it ran, in the shape D1 uses. */
export interface SqliteResult<T = Record<string, unknown>> {
  success: true;
  results: T[];
  meta: { changes?: number; last_row_id?: number };
}

/** A prepared statement of the adapter: a `D1PreparedLike` that a batch can execute. */
export interface SqliteStatement extends D1PreparedLike {
  readonly sql: string;
  readonly values: readonly SQLInputValue[];
  /** Runs the statement now and answers like D1 (a read gives rows, a write gives changes). */
  execute(): SqliteResult;
  /**
   * Answers as D1's `run()` does: `meta.changes` is the number of rows the statement changed, zero
   * for a write that matched nothing. `d1Store` reads it to tell what a conditional write did.
   */
  run(): Promise<SqliteResult>;
}

/** A statement the adapter ran, as the tests read it back. */
export interface ExecutedQuery {
  readonly sql: string;
  readonly values: readonly SQLInputValue[];
  /** The number of the `batch()` call it ran in, or null when it ran alone. */
  readonly batch: number | null;
}

export interface SqliteDb extends D1Like {
  /** The database itself, for the tests that look inside it. */
  readonly raw: DatabaseSync;
  /** Every statement run so far, in order. */
  readonly queries: ExecutedQuery[];
  close(): void;
}

export interface OpenOptions {
  /** Enforce the foreign keys (default true, as D1 does). */
  foreignKeys?: boolean;
  /** Apply every migration of `migrations/` (default true). */
  migrate?: boolean;
}

/**
 * D1 binds null, numbers and strings (and blobs, which the service never uses). `undefined` is an
 * error in D1; a boolean is a mistake the store must not make (it stores 0 and 1), so the adapter
 * refuses both, and anything else SQLite cannot hold.
 */
function checkValue(value: unknown, index: number): SQLInputValue {
  if (value === null || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new TypeError(
    `D1_TYPE_ERROR: cannot bind ${typeof value} at position ${index + 1}: use null, a finite number or a string`,
  );
}

const READ = /^\s*(select|with|pragma|explain)\b/i;

function runNow(raw: DatabaseSync, sql: string, values: readonly SQLInputValue[]): SqliteResult {
  const prepared = raw.prepare(sql);
  if (READ.test(sql)) {
    return {
      success: true,
      results: prepared.all(...values).map((row) => ({ ...row })),
      meta: {},
    };
  }
  const { changes, lastInsertRowid } = prepared.run(...values);
  return {
    success: true,
    results: [],
    meta: { changes: Number(changes), last_row_id: Number(lastInsertRowid) },
  };
}

function isOurs(candidate: D1PreparedLike): candidate is SqliteStatement {
  return typeof (candidate as Partial<SqliteStatement>).execute === "function";
}

/** Applies the migrations over a database, each in a transaction, in order. */
export function applyMigrations(raw: DatabaseSync): void {
  for (const { name, sql } of migrationFiles()) {
    raw.exec("BEGIN");
    try {
      raw.exec(sql);
      raw.exec("COMMIT");
    } catch (error) {
      raw.exec("ROLLBACK");
      throw new Error(
        `migration ${name} failed: ${error instanceof Error ? error.message : error}`,
        { cause: error },
      );
    }
  }
}

/** Opens an in-memory database with the migrations applied and wraps it as a `D1Like`. */
export function openDatabase(options: OpenOptions = {}): SqliteDb {
  if (!sqlite) throw new Error("node:sqlite is not available on this Node");
  const raw = new sqlite.DatabaseSync(":memory:", {
    enableForeignKeyConstraints: options.foreignKeys ?? true,
  });
  if (options.migrate ?? true) applyMigrations(raw);

  const queries: ExecutedQuery[] = [];
  let batchCount = 0;
  let activeBatch: number | null = null;

  const make = (sql: string, values: readonly SQLInputValue[]): SqliteStatement => {
    const execute = (): SqliteResult => {
      queries.push({ sql, values, batch: activeBatch });
      return runNow(raw, sql, values);
    };
    return {
      sql,
      values,
      bind: (...next: unknown[]) => make(sql, next.map(checkValue)),
      async first<T>() {
        queries.push({ sql, values, batch: activeBatch });
        const row = raw.prepare(sql).get(...values);
        return row === undefined ? null : ({ ...row } as T);
      },
      async all<T>() {
        queries.push({ sql, values, batch: activeBatch });
        return {
          results: raw
            .prepare(sql)
            .all(...values)
            .map((row) => ({ ...row }) as T),
        };
      },
      async run() {
        return execute();
      },
      execute,
    };
  };

  return {
    raw,
    queries,
    close: () => raw.close(),
    prepare: (sql) => make(sql, []),
    // One transaction, as in D1: all the statements or none. There is no `await` between BEGIN and
    // COMMIT, so nothing else can touch the connection in between.
    async batch(statements) {
      const own = statements.map((candidate) => {
        if (!isOurs(candidate)) throw new TypeError("batch() takes statements of this database");
        return candidate;
      });
      raw.exec("BEGIN");
      activeBatch = ++batchCount;
      try {
        const results = own.map((candidate) => candidate.execute());
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        try {
          raw.exec("ROLLBACK");
        } catch {
          // The transaction had already ended.
        }
        throw error;
      } finally {
        activeBatch = null;
      }
    },
  };
}

/** Gives up the thread for one turn of the event loop, as waiting for a reply does. */
const roundTrip = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Puts a round trip in front of every statement, as the real D1 has (it is another machine): a
 * request that has sent one statement waits for the answer, and the statements of another request
 * started at the same moment run in between. Each statement and each batch is still atomic. On the
 * bare adapter a request's statements run back to back, which hides the races two requests can
 * have; over this, they show.
 *
 * `before` is called with the SQL of each statement (each one of a batch too) after its round
 * trip and before it runs; a test makes it wait to hold requests at the same point of their work.
 */
export function withLatency(
  db: D1Like,
  before: (sql: string) => void | Promise<void> = () => undefined,
): D1Like {
  const inner = new WeakMap<D1PreparedLike, { statement: D1PreparedLike; sql: string }>();
  const wrap = (statement: D1PreparedLike, sql: string): D1PreparedLike => {
    const arrive = async (): Promise<void> => {
      await roundTrip();
      await before(sql);
    };
    const slow: D1PreparedLike = {
      bind: (...values) => wrap(statement.bind(...values), sql),
      first: async <T>() => {
        await arrive();
        return statement.first<T>();
      },
      all: async <T>() => {
        await arrive();
        return statement.all<T>();
      },
      run: async () => {
        await arrive();
        return statement.run();
      },
    };
    inner.set(slow, { statement, sql });
    return slow;
  };
  return {
    prepare: (sql) => wrap(db.prepare(sql), sql),
    batch: async (statements) => {
      await roundTrip();
      const own = statements.map((candidate) => inner.get(candidate));
      for (const entry of own) if (entry) await before(entry.sql);
      return db.batch(statements.map((candidate, i) => own[i]?.statement ?? candidate));
    },
  };
}
