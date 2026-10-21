import type { Identity, Iso, OutboxEvent, Provider, Session, User } from "../types.js";

/** What changes when the same identity signs in again. */
export interface IdentityPatch {
  readonly email: string;
  readonly emailVerified: boolean;
  readonly verifiedAt: Iso | null;
  readonly handle: string;
}

/**
 * Everything the service keeps (the inventory of `identity-account`): users, identities,
 * sessions and the outbox of deletion events. Never a provider token, never a raw `User-Agent`.
 *
 * Two implementations pass one conformance suite: `memoryStore()` for the tests of the handlers
 * and `d1Store()` for the Worker. Times are ISO strings in UTC, which sort as text.
 */
export interface IdentityStore {
  userById(id: string): Promise<User | undefined>;
  createUser(user: User): Promise<void>;
  updateUser(id: string, patch: { readonly name: string; readonly picture: string }): Promise<void>;
  /**
   * Deletes the user with its identities and sessions, and queues `events` (as `enqueueEvents`
   * does: an id already queued keeps its row) in the same atomic step: all of it happens or none
   * of it. The outbox keeps its earlier events.
   */
  deleteUser(id: string, events?: readonly OutboxEvent[]): Promise<void>;

  identity(provider: Provider, providerId: string): Promise<Identity | undefined>;
  /** The identities of a user, the oldest link first. */
  identitiesOf(userId: string): Promise<Identity[]>;
  addIdentity(identity: Identity): Promise<void>;
  updateIdentity(provider: Provider, providerId: string, patch: IdentityPatch): Promise<void>;
  /**
   * Removes every identity of `provider` from the user, but only if the user keeps at least one
   * identity of another provider, in one atomic step so that two requests unlinking different
   * providers at once can never leave a user without a way to sign in. Answers `"removed"` when
   * it removed them, `"last"` when the user has identities of this provider and none of another
   * (nothing changes), and `"absent"` when the user has none of this provider (nothing changes).
   */
  unlinkProvider(userId: string, provider: Provider): Promise<"removed" | "last" | "absent">;
  /**
   * The identity that holds this email verified (compared ignoring case), the most recently
   * verified one when several do. The caller applies the 90-day window to its `verifiedAt`.
   */
  identityByVerifiedEmail(email: string): Promise<Identity | undefined>;

  createSession(session: Session): Promise<void>;
  session(sid: string): Promise<Session | undefined>;
  touchSession(sid: string, at: Iso): Promise<void>;
  revokeSession(sid: string, at: Iso): Promise<void>;
  /** Revokes every live session of the user except `keepSid`. */
  revokeOtherSessions(userId: string, keepSid: string, at: Iso): Promise<void>;
  /** The live sessions of a user (not revoked, not expired at `now`), the newest first. */
  sessionsOf(userId: string, now: Iso): Promise<Session[]>;
  /** Removes the sessions that expired, or were revoked, before `before`. */
  deleteSessionsBefore(before: Iso): Promise<void>;

  enqueueEvents(events: readonly OutboxEvent[]): Promise<void>;
  /** The events neither delivered nor failed whose `nextAt` has come, oldest `nextAt` first. */
  dueEvents(now: Iso, limit: number): Promise<OutboxEvent[]>;
  /** Marks an event delivered at `at` and counts the attempt. */
  markDelivered(id: string, at: Iso): Promise<void>;
  /** Counts a failed attempt and either schedules the next one or gives the event up. */
  recordFailure(
    id: string,
    outcome: { readonly nextAt: Iso } | { readonly failedAt: Iso },
  ): Promise<void>;
}
