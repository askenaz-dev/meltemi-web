import type { D1Like, D1PreparedLike } from "../env.js";
import type { Identity, Iso, OutboxEvent, Provider, Session, User } from "../types.js";
import type { IdentityPatch, IdentityStore } from "./types.js";

// The store over D1: every statement is a constant prepared with `?` placeholders and given its
// values through `bind()`, never built from a value. Times are ISO-8601 text (they sort as text),
// booleans are stored as 0 and 1, and a missing time is NULL. The tables are made by
// `migrations/0001_identity.sql`; the orderings below are the ones `store/types.ts` documents,
// with ties broken by insertion order (`rowid`) so that `memoryStore()` and this store agree.

interface UserRow {
  id: string;
  name: string;
  picture: string;
  created_at: string;
}

interface IdentityRow {
  provider: string;
  provider_id: string;
  user_id: string;
  email: string;
  email_verified: number;
  verified_at: string | null;
  handle: string;
  linked_at: string;
}

interface SessionRow {
  sid: string;
  user_id: string;
  created_at: string;
  last_seen: string;
  expires_at: string;
  label: string;
  revoked_at: string | null;
}

interface OutboxRow {
  id: string;
  product: string;
  body: string;
  created_at: string;
  attempts: number;
  next_at: string;
  delivered_at: string | null;
  failed_at: string | null;
}

const USER_COLUMNS = "id, name, picture, created_at";
const IDENTITY_COLUMNS =
  "provider, provider_id, user_id, email, email_verified, verified_at, handle, linked_at";
const SESSION_COLUMNS = "sid, user_id, created_at, last_seen, expires_at, label, revoked_at";
const OUTBOX_COLUMNS = "id, product, body, created_at, attempts, next_at, delivered_at, failed_at";

const toUser = (row: UserRow): User => ({
  id: row.id,
  name: row.name,
  picture: row.picture,
  createdAt: row.created_at,
});

// The providers are a closed set the handlers validate before anything is stored, so a stored
// `provider` is one of them.
const toIdentity = (row: IdentityRow): Identity => ({
  provider: row.provider as Provider,
  providerId: row.provider_id,
  userId: row.user_id,
  email: row.email,
  emailVerified: row.email_verified === 1,
  verifiedAt: row.verified_at,
  handle: row.handle,
  linkedAt: row.linked_at,
});

const toSession = (row: SessionRow): Session => ({
  sid: row.sid,
  userId: row.user_id,
  createdAt: row.created_at,
  lastSeen: row.last_seen,
  expiresAt: row.expires_at,
  label: row.label,
  revokedAt: row.revoked_at,
});

const toEvent = (row: OutboxRow): OutboxEvent => ({
  id: row.id,
  product: row.product,
  body: row.body,
  createdAt: row.created_at,
  attempts: row.attempts,
  nextAt: row.next_at,
  deliveredAt: row.delivered_at,
  failedAt: row.failed_at,
});

/** The value SQLite stores for a boolean. */
const bit = (value: boolean): number => (value ? 1 : 0);

/**
 * A row count that SQLite accepts after `LIMIT`: a whole number, never negative (SQLite reads
 * `LIMIT -1` as "no limit") and never `NaN` or infinite.
 */
function rowLimit(limit: number): number {
  if (Number.isNaN(limit)) return 0;
  return Math.min(Math.max(Math.floor(limit), 0), Number.MAX_SAFE_INTEGER);
}

/** The identity store over a D1 database (or anything shaped like one). */
export function d1Store(db: D1Like): IdentityStore {
  const run = async (statement: D1PreparedLike): Promise<void> => {
    await statement.run();
  };

  /** Runs a write and answers how many rows it changed, as D1 reports in `meta.changes`. */
  const runCounting = async (statement: D1PreparedLike): Promise<number> => {
    const changes = (await statement.run()).meta?.changes;
    // Guessing would turn a driver that does not report the count into a wrong answer to the person.
    if (typeof changes !== "number")
      throw new Error("the database did not report the rows changed");
    return changes;
  };

  // An id already queued keeps its row (attempts and outcome included): queueing again is harmless.
  const insertEvent = (event: OutboxEvent): D1PreparedLike =>
    db
      .prepare(
        `INSERT INTO outbox (${OUTBOX_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      )
      .bind(
        event.id,
        event.product,
        event.body,
        event.createdAt,
        event.attempts,
        event.nextAt,
        event.deliveredAt,
        event.failedAt,
      );

  return {
    async userById(id) {
      const row = await db
        .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
        .bind(id)
        .first<UserRow>();
      return row ? toUser(row) : undefined;
    },
    async createUser(user: User) {
      await run(
        db
          .prepare("INSERT INTO users (id, name, picture, created_at) VALUES (?, ?, ?, ?)")
          .bind(user.id, user.name, user.picture, user.createdAt),
      );
    },
    async updateUser(id, patch) {
      await run(
        db
          .prepare("UPDATE users SET name = ?, picture = ? WHERE id = ?")
          .bind(patch.name, patch.picture, id),
      );
    },
    async deleteUser(id, events = []) {
      // Explicit and in one transaction: the events go into the outbox, then the children, then
      // the user, so a failure anywhere (a rejected event, a refused delete) undoes all of it. The
      // foreign keys would cascade, but the deletion does not depend on them being enforced.
      await db.batch([
        ...events.map(insertEvent),
        db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
        db.prepare("DELETE FROM identities WHERE user_id = ?").bind(id),
        db.prepare("DELETE FROM users WHERE id = ?").bind(id),
      ]);
    },

    async identity(provider, providerId) {
      const row = await db
        .prepare(
          `SELECT ${IDENTITY_COLUMNS} FROM identities WHERE provider = ? AND provider_id = ?`,
        )
        .bind(provider, providerId)
        .first<IdentityRow>();
      return row ? toIdentity(row) : undefined;
    },
    async identitiesOf(userId) {
      const { results } = await db
        .prepare(
          `SELECT ${IDENTITY_COLUMNS} FROM identities WHERE user_id = ? ORDER BY linked_at ASC, rowid ASC`,
        )
        .bind(userId)
        .all<IdentityRow>();
      return results.map(toIdentity);
    },
    async addIdentity(identity: Identity) {
      await run(
        db
          .prepare(`INSERT INTO identities (${IDENTITY_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(
            identity.provider,
            identity.providerId,
            identity.userId,
            identity.email,
            bit(identity.emailVerified),
            identity.verifiedAt,
            identity.handle,
            identity.linkedAt,
          ),
      );
    },
    async updateIdentity(provider, providerId, patch: IdentityPatch) {
      await run(
        db
          .prepare(
            "UPDATE identities SET email = ?, email_verified = ?, verified_at = ?, handle = ? WHERE provider = ? AND provider_id = ?",
          )
          .bind(
            patch.email,
            bit(patch.emailVerified),
            patch.verifiedAt,
            patch.handle,
            provider,
            providerId,
          ),
      );
    },
    async unlinkProvider(userId, provider) {
      // One statement, so the "keeps another provider" check and the removal cannot be pulled
      // apart by a second request: it deletes nothing unless an identity of another provider
      // remains, however many requests run at once.
      const removed = await runCounting(
        db
          .prepare(
            "DELETE FROM identities WHERE user_id = ? AND provider = ? AND EXISTS (SELECT 1 FROM identities WHERE user_id = ? AND provider <> ?)",
          )
          .bind(userId, provider, userId, provider),
      );
      if (removed > 0) return "removed";
      // Nothing went: either the user has none of this provider, or it is all they have.
      const held = await db
        .prepare("SELECT 1 AS held FROM identities WHERE user_id = ? AND provider = ? LIMIT 1")
        .bind(userId, provider)
        .first<{ held: number }>();
      return held ? "last" : "absent";
    },
    async identityByVerifiedEmail(email) {
      // `lower()` folds ASCII letters on both sides, and the partial index
      // `identities_verified_email` is over exactly `lower(email)` where `email_verified = 1`.
      // The most recently verified identity first; NULL (never expected here) sorts last.
      const row = await db
        .prepare(
          `SELECT ${IDENTITY_COLUMNS} FROM identities WHERE email_verified = 1 AND lower(email) = lower(?) ORDER BY verified_at DESC, linked_at ASC, rowid ASC LIMIT 1`,
        )
        .bind(email)
        .first<IdentityRow>();
      return row ? toIdentity(row) : undefined;
    },

    async createSession(session: Session) {
      await run(
        db
          .prepare(`INSERT INTO sessions (${SESSION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(
            session.sid,
            session.userId,
            session.createdAt,
            session.lastSeen,
            session.expiresAt,
            session.label,
            session.revokedAt,
          ),
      );
    },
    async session(sid) {
      const row = await db
        .prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE sid = ?`)
        .bind(sid)
        .first<SessionRow>();
      return row ? toSession(row) : undefined;
    },
    async touchSession(sid, at: Iso) {
      await run(db.prepare("UPDATE sessions SET last_seen = ? WHERE sid = ?").bind(at, sid));
    },
    async revokeSession(sid, at: Iso) {
      // The first revocation stands: a session revoked twice keeps its first `revoked_at`.
      await run(
        db
          .prepare("UPDATE sessions SET revoked_at = ? WHERE sid = ? AND revoked_at IS NULL")
          .bind(at, sid),
      );
    },
    async revokeOtherSessions(userId, keepSid, at: Iso) {
      await run(
        db
          .prepare(
            "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND sid <> ? AND revoked_at IS NULL",
          )
          .bind(at, userId, keepSid),
      );
    },
    async sessionsOf(userId, now: Iso) {
      // Live at `now`: not revoked and `expires_at` after `now` (a session expiring at exactly
      // `now` is over). The newest first; of two created at the same instant, the later row.
      const { results } = await db
        .prepare(
          `SELECT ${SESSION_COLUMNS} FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC, rowid DESC`,
        )
        .bind(userId, now)
        .all<SessionRow>();
      return results.map(toSession);
    },
    async deleteSessionsBefore(before: Iso) {
      await run(
        db
          .prepare(
            "DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)",
          )
          .bind(before, before),
      );
    },

    async enqueueEvents(events) {
      if (events.length === 0) return;
      // One transaction, so a call never queues half its events.
      await db.batch(events.map(insertEvent));
    },
    async dueEvents(now, limit) {
      const { results } = await db
        .prepare(
          `SELECT ${OUTBOX_COLUMNS} FROM outbox WHERE delivered_at IS NULL AND failed_at IS NULL AND next_at <= ? ORDER BY next_at ASC, id ASC LIMIT ?`,
        )
        .bind(now, rowLimit(limit))
        .all<OutboxRow>();
      return results.map(toEvent);
    },
    async markDelivered(id, at) {
      await run(
        db
          .prepare("UPDATE outbox SET delivered_at = ?, attempts = attempts + 1 WHERE id = ?")
          .bind(at, id),
      );
    },
    async recordFailure(id, outcome) {
      if ("nextAt" in outcome) {
        await run(
          db
            .prepare("UPDATE outbox SET next_at = ?, attempts = attempts + 1 WHERE id = ?")
            .bind(outcome.nextAt, id),
        );
      } else {
        await run(
          db
            .prepare("UPDATE outbox SET failed_at = ?, attempts = attempts + 1 WHERE id = ?")
            .bind(outcome.failedAt, id),
        );
      }
    },
  };
}
