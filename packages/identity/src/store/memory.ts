import type { Identity, Iso, OutboxEvent, Provider, Session, User } from "../types.js";
import type { IdentityPatch, IdentityStore } from "./types.js";

const identityKey = (provider: Provider, providerId: string) => `${provider}\u0000${providerId}`;

/**
 * Orders text the way SQLite's default collation does (by code unit), which is how `d1Store`
 * sorts ISO times and ids. `localeCompare` would order mixed-case ids differently.
 */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Folds ASCII letters only, which is what SQLite's `lower()` does (and so `d1Store`). */
const lowerAscii = (text: string): string =>
  text.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));

/** The outbox of each memory store, for `memoryOutbox`. */
const outboxes = new WeakMap<IdentityStore, Map<string, OutboxEvent>>();

/**
 * Every outbox row of a store made by `memoryStore()`, delivered and failed ones included, in the
 * order they were queued. For tests only: the store's interface lists just the events still due,
 * so a test of the delivery (attempts, `deliveredAt`, `failedAt`) reads the rows here.
 */
export function memoryOutbox(store: IdentityStore): OutboxEvent[] {
  const rows = outboxes.get(store);
  if (!rows) throw new Error("memoryOutbox() takes a store made by memoryStore()");
  return [...rows.values()].map((event) => ({ ...event }));
}

/** An in-memory store for the tests of the handlers; it passes the same suite as `d1Store`. */
export function memoryStore(): IdentityStore {
  const users = new Map<string, User>();
  const identities = new Map<string, Identity>();
  const sessions = new Map<string, Session>();
  const outbox = new Map<string, OutboxEvent>();

  const live = (s: Session, now: Iso) => s.revokedAt === null && s.expiresAt > now;

  // An id already queued keeps its row, attempts and outcome included, as in `d1Store`.
  const queue = (events: readonly OutboxEvent[]): void => {
    for (const event of events) if (!outbox.has(event.id)) outbox.set(event.id, event);
  };

  const store: IdentityStore = {
    async userById(id) {
      const user = users.get(id);
      return user && { ...user };
    },
    async createUser(user) {
      if (users.has(user.id)) throw new Error(`user ${user.id} exists`);
      users.set(user.id, { ...user });
    },
    async updateUser(id, patch) {
      const user = users.get(id);
      if (user) users.set(id, { ...user, name: patch.name, picture: patch.picture });
    },
    async deleteUser(id, events = []) {
      // Everything that can throw (reading `events`) comes first; what follows has no `await` in
      // it, so nothing else runs in between: the events are queued and the user is gone, or neither.
      const queued = events.map((event) => ({ ...event }));
      queue(queued);
      users.delete(id);
      for (const [key, identity] of identities) if (identity.userId === id) identities.delete(key);
      for (const [sid, session] of sessions) if (session.userId === id) sessions.delete(sid);
    },

    async identity(provider, providerId) {
      const identity = identities.get(identityKey(provider, providerId));
      return identity && { ...identity };
    },
    async identitiesOf(userId) {
      return [...identities.values()]
        .filter((i) => i.userId === userId)
        .sort((a, b) => byText(a.linkedAt, b.linkedAt))
        .map((i) => ({ ...i }));
    },
    async addIdentity(identity) {
      const key = identityKey(identity.provider, identity.providerId);
      if (identities.has(key)) throw new Error("identity exists");
      identities.set(key, { ...identity });
    },
    async updateIdentity(provider, providerId, patch: IdentityPatch) {
      const key = identityKey(provider, providerId);
      const identity = identities.get(key);
      if (identity) identities.set(key, { ...identity, ...patch });
    },
    async unlinkProvider(userId, provider) {
      // No `await`, so the check and the removal are one step, as the single statement of `d1Store`.
      const mine = [...identities].filter(([, identity]) => identity.userId === userId);
      const ofProvider = mine.filter(([, identity]) => identity.provider === provider);
      if (ofProvider.length === 0) return "absent";
      if (ofProvider.length === mine.length) return "last";
      for (const [key] of ofProvider) identities.delete(key);
      return "removed";
    },
    async identityByVerifiedEmail(email) {
      const wanted = lowerAscii(email);
      const found = [...identities.values()]
        .filter((i) => i.emailVerified && lowerAscii(i.email) === wanted)
        .sort(
          (a, b) =>
            byText(b.verifiedAt ?? "", a.verifiedAt ?? "") || byText(a.linkedAt, b.linkedAt),
        )[0];
      return found && { ...found };
    },

    async createSession(session) {
      if (sessions.has(session.sid)) throw new Error("session exists");
      sessions.set(session.sid, { ...session });
    },
    async session(sid) {
      const session = sessions.get(sid);
      return session && { ...session };
    },
    async touchSession(sid, at) {
      const session = sessions.get(sid);
      if (session) sessions.set(sid, { ...session, lastSeen: at });
    },
    async revokeSession(sid, at) {
      const session = sessions.get(sid);
      if (session && session.revokedAt === null) sessions.set(sid, { ...session, revokedAt: at });
    },
    async revokeOtherSessions(userId, keepSid, at) {
      for (const [sid, session] of sessions) {
        if (session.userId === userId && sid !== keepSid && session.revokedAt === null) {
          sessions.set(sid, { ...session, revokedAt: at });
        }
      }
    },
    async sessionsOf(userId, now) {
      // Reversed first, so that of two sessions created at the same instant the later one leads
      // (the sort is stable), as `d1Store` orders by `rowid` descending.
      return [...sessions.values()]
        .reverse()
        .filter((s) => s.userId === userId && live(s, now))
        .sort((a, b) => byText(b.createdAt, a.createdAt))
        .map((s) => ({ ...s }));
    },
    async deleteSessionsBefore(before) {
      for (const [sid, session] of sessions) {
        if (
          session.expiresAt < before ||
          (session.revokedAt !== null && session.revokedAt < before)
        ) {
          sessions.delete(sid);
        }
      }
    },

    async enqueueEvents(events) {
      queue(events.map((event) => ({ ...event })));
    },
    async dueEvents(now, limit) {
      if (!(limit > 0)) return [];
      return [...outbox.values()]
        .filter((e) => e.deliveredAt === null && e.failedAt === null && e.nextAt <= now)
        .sort((a, b) => byText(a.nextAt, b.nextAt) || byText(a.id, b.id))
        .slice(0, Math.floor(limit))
        .map((e) => ({ ...e }));
    },
    async markDelivered(id, at) {
      const event = outbox.get(id);
      if (event) outbox.set(id, { ...event, deliveredAt: at, attempts: event.attempts + 1 });
    },
    async recordFailure(id, outcome) {
      const event = outbox.get(id);
      if (!event) return;
      outbox.set(id, {
        ...event,
        attempts: event.attempts + 1,
        ...("nextAt" in outcome ? { nextAt: outcome.nextAt } : { failedAt: outcome.failedAt }),
      });
    },
  };

  outboxes.set(store, outbox);
  return store;
}
