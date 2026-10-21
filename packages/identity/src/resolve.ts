// Identity resolution: who a completed provider flow is. A pure function over the store; the
// callback turns the answer into a session, a redirect or a page.

import type { Ctx } from "./context.js";
import { uuid } from "./crypto.js";
import type { IdentityPatch } from "./store/types.js";
import type { Identity, Iso, Provider, ProviderProfile, User } from "./types.js";

/** Two providers that both verified a mailbox this recently are taken to be one person. */
export const MERGE_WINDOW_DAYS = 90;
const MERGE_WINDOW_MS = MERGE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** What a completed flow came to. */
export type Resolution =
  /** The identity was known (`existing`), joined a user by a recent verified email (`merged`), or started a new user (`created`): sign in as `user`. */
  | {
      readonly kind: "existing" | "merged" | "created";
      readonly user: User;
      readonly identity: Identity;
    }
  /** The link flow: the identity belongs to `user`, who stays signed in with the session they have. */
  | { readonly kind: "linked"; readonly user: User; readonly identity: Identity }
  /** The link flow met an identity that belongs to another user: nothing changed. */
  | { readonly kind: "taken" }
  /**
   * A new user was created although another identity holds the same verified email, because that
   * identity's `verifiedAt` is older than the window: sign `user` in and say so.
   */
  | {
      readonly kind: "stale";
      readonly user: User;
      readonly identity: Identity;
      /** The provider of the older identity that holds the email. */
      readonly existingProvider: Provider;
    };

/** Whether a verification time is at most the window old (a window of exactly 90 days counts). */
function withinWindow(verifiedAt: Iso | null, now: Date): boolean {
  if (verifiedAt === null) return false;
  const verified = Date.parse(verifiedAt);
  return Number.isFinite(verified) && now.getTime() - verified <= MERGE_WINDOW_MS;
}

/**
 * Resolves the identity `(provider, providerId)` of a completed flow, in the order of the design:
 *
 * 1. an existing identity signs in its user and refreshes what the provider says;
 * 2. with `link` (a valid session asked to add this provider) a new identity attaches to that user
 *    whatever its email, and an identity of another user is refused;
 * 3. a new identity whose verified email an identity holds verified within the last 90 days
 *    attaches to that identity's user;
 * 4. otherwise a new user and identity are made; when rule 3 failed only because the matching
 *    identity was verified longer ago than the window, the result is `stale`.
 *
 * An unverified email never matches anything.
 */
export async function resolveIdentity(
  ctx: Pick<Ctx, "deps">,
  profile: ProviderProfile,
  link?: { readonly userId: string },
): Promise<Resolution> {
  const { deps } = ctx;
  const { store } = deps;
  const now = deps.now();
  const at = now.toISOString();
  const verified = profile.emailVerified && profile.email !== "";
  const patch: IdentityPatch = {
    email: profile.email,
    emailVerified: verified,
    verifiedAt: verified ? at : null,
    handle: profile.handle,
  };
  const fresh = (userId: string): Identity => ({
    provider: profile.provider,
    providerId: profile.providerId,
    userId,
    ...patch,
    linkedAt: at,
  });

  // A link request counts only while the user who made it still exists.
  const linking = link ? await store.userById(link.userId) : undefined;
  const existing = await store.identity(profile.provider, profile.providerId);

  if (existing) {
    if (linking && existing.userId !== linking.id) return { kind: "taken" };
    const owner = await store.userById(existing.userId);
    if (!owner) throw new Error("An identity has no user");
    const refreshed: User = {
      ...owner,
      name: profile.name !== "" ? profile.name : owner.name,
      picture: profile.picture !== "" ? profile.picture : owner.picture,
    };
    await store.updateUser(owner.id, { name: refreshed.name, picture: refreshed.picture });
    await store.updateIdentity(existing.provider, existing.providerId, patch);
    return {
      kind: linking ? "linked" : "existing",
      user: refreshed,
      identity: { ...existing, ...patch },
    };
  }

  if (linking) {
    const identity = fresh(linking.id);
    await store.addIdentity(identity);
    return { kind: "linked", user: linking, identity };
  }

  let stale: Identity | undefined;
  if (verified) {
    const match = await store.identityByVerifiedEmail(profile.email);
    if (match && withinWindow(match.verifiedAt, now)) {
      const owner = await store.userById(match.userId);
      if (owner) {
        const identity = fresh(owner.id);
        await store.addIdentity(identity);
        return { kind: "merged", user: owner, identity };
      }
    } else if (match) {
      stale = match;
    }
  }

  const user: User = {
    id: uuid((length) => deps.randomBytes(length)),
    name: profile.name,
    picture: profile.picture,
    createdAt: at,
  };
  const identity = fresh(user.id);
  await store.createUser(user);
  try {
    await store.addIdentity(identity);
  } catch (error) {
    // No user without an identity: undo the half that was made.
    await store.deleteUser(user.id);
    throw error;
  }
  return stale
    ? { kind: "stale", user, identity, existingProvider: stale.provider }
    : { kind: "created", user, identity };
}
