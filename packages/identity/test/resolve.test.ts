import { describe, expect, it, vi } from "vitest";
import { MERGE_WINDOW_DAYS, resolveIdentity } from "../src/resolve.js";
import type { Identity, Iso, Provider, ProviderProfile } from "../src/types.js";
import { harness, type Harness } from "./support/index.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = "2026-10-14T12:00:00.000Z";

/** The time `days` days (and `extraMs` more) before the harness clock's start. */
function ago(days: number, extraMs = 0): Iso {
  return new Date(new Date(NOW).getTime() - days * DAY - extraMs).toISOString();
}

function profile(over: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    provider: "google",
    providerId: "g-1",
    name: "Ana from Google",
    picture: "https://lh3.googleusercontent.com/a/ana",
    email: "ana@example.com",
    emailVerified: true,
    handle: "",
    ...over,
  };
}

/** A user with one identity, written straight into the store with the times a test chooses. */
async function seed(
  h: Harness,
  options: {
    userId: string;
    name?: string;
    provider?: Provider;
    providerId?: string;
    email?: string;
    emailVerified?: boolean;
    verifiedAt?: Iso | null;
    handle?: string;
    linkedAt?: Iso;
  },
): Promise<Identity> {
  const emailVerified = options.emailVerified ?? true;
  await h.store.createUser({
    id: options.userId,
    name: options.name ?? "Seeded",
    picture: "https://avatars.githubusercontent.com/u/1",
    createdAt: NOW,
  });
  const identity: Identity = {
    provider: options.provider ?? "github",
    providerId: options.providerId ?? `${options.userId}-gh`,
    userId: options.userId,
    email: options.email ?? "ana@example.com",
    emailVerified,
    verifiedAt: options.verifiedAt !== undefined ? options.verifiedAt : emailVerified ? NOW : null,
    handle: options.handle ?? "seeded",
    linkedAt: options.linkedAt ?? NOW,
  };
  await h.store.addIdentity(identity);
  return identity;
}

const resolve = (h: Harness, p: ProviderProfile, link?: { userId: string }) =>
  resolveIdentity({ deps: h.deps }, p, link);

describe("rule 1: an identity that exists signs in its user", () => {
  it("refreshes the user's name and picture and the identity's email, verification and handle", async () => {
    const h = await harness();
    const old = await seed(h, {
      userId: "u1",
      provider: "github",
      providerId: "4242",
      email: "old@example.com",
      emailVerified: false,
      verifiedAt: null,
      handle: "old-handle",
      linkedAt: ago(30),
    });
    const result = await resolve(
      h,
      profile({
        provider: "github",
        providerId: "4242",
        name: "New Name",
        picture: "https://avatars.githubusercontent.com/u/4242?v=2",
        email: "new@example.com",
        emailVerified: true,
        handle: "new-handle",
      }),
    );
    expect(result.kind).toBe("existing");
    if (result.kind !== "existing") throw new Error("unreachable");
    expect(result.user).toEqual({
      id: "u1",
      name: "New Name",
      picture: "https://avatars.githubusercontent.com/u/4242?v=2",
      createdAt: NOW,
    });
    const expected: Identity = {
      ...old,
      email: "new@example.com",
      emailVerified: true,
      verifiedAt: NOW,
      handle: "new-handle",
    };
    expect(result.identity).toEqual(expected);
    expect(await h.store.identity("github", "4242")).toEqual(expected);
    expect(await h.store.userById("u1")).toEqual(result.user);
    expect(expected.linkedAt).toBe(old.linkedAt);
  });

  it("clears verified_at when the provider no longer reports the email verified", async () => {
    const h = await harness();
    await seed(h, { userId: "u1", provider: "google", providerId: "g-1", verifiedAt: ago(5) });
    await resolve(h, profile({ emailVerified: false }));
    expect(await h.store.identity("google", "g-1")).toMatchObject({
      emailVerified: false,
      verifiedAt: null,
    });
  });

  it("sets verified_at to now each time the provider reports it verified", async () => {
    const h = await harness();
    await seed(h, { userId: "u1", provider: "google", providerId: "g-1", verifiedAt: ago(40) });
    await resolve(h, profile());
    expect(await h.store.identity("google", "g-1")).toMatchObject({ verifiedAt: NOW });
  });

  it("treats a verified flag with no address as unverified", async () => {
    const h = await harness();
    await seed(h, { userId: "u1", provider: "google", providerId: "g-1" });
    await resolve(h, profile({ email: "", emailVerified: true }));
    expect(await h.store.identity("google", "g-1")).toMatchObject({
      email: "",
      emailVerified: false,
      verifiedAt: null,
    });
  });

  it("keeps the name and picture the user has when the provider gives none", async () => {
    const h = await harness();
    await seed(h, { userId: "u1", name: "Kept Name", provider: "google", providerId: "g-1" });
    await resolve(h, profile({ name: "", picture: "" }));
    expect(await h.store.userById("u1")).toMatchObject({
      name: "Kept Name",
      picture: "https://avatars.githubusercontent.com/u/1",
    });
  });

  it("comes before every other rule: the email of another user's identity does not move it", async () => {
    const h = await harness();
    await seed(h, {
      userId: "a",
      provider: "github",
      providerId: "gh-a",
      email: "shared@example.com",
    });
    await seed(h, {
      userId: "b",
      provider: "google",
      providerId: "g-1",
      email: "b@example.com",
      emailVerified: false,
      verifiedAt: null,
    });
    const result = await resolve(h, profile({ email: "shared@example.com" }));
    expect(result.kind).toBe("existing");
    if (result.kind === "existing") expect(result.user.id).toBe("b");
    expect(await h.store.identitiesOf("a")).toHaveLength(1);
    expect(await h.store.identitiesOf("b")).toHaveLength(1);
  });

  it("is the same answer on every repetition, and creates nothing", async () => {
    const h = await harness();
    const first = await resolve(h, profile());
    const writes = [vi.spyOn(h.store, "createUser"), vi.spyOn(h.store, "addIdentity")];
    const second = await resolve(h, profile());
    const third = await resolve(h, profile());
    expect(first.kind).toBe("created");
    expect(second.kind).toBe("existing");
    expect(third.kind).toBe("existing");
    if (first.kind === "created" && second.kind === "existing" && third.kind === "existing") {
      expect(second.user.id).toBe(first.user.id);
      expect(third.user.id).toBe(first.user.id);
    }
    for (const spy of writes) expect(spy).not.toHaveBeenCalled();
  });

  it("is an error, not a silent new account, when an identity has no user", async () => {
    const h = await harness();
    await h.store.addIdentity({
      provider: "google",
      providerId: "g-1",
      userId: "ghost",
      email: "x@example.com",
      emailVerified: false,
      verifiedAt: null,
      handle: "",
      linkedAt: NOW,
    });
    await expect(resolve(h, profile())).rejects.toThrow("An identity has no user");
  });
});

describe("rule 2: linking while signed in", () => {
  it("attaches a new identity to the current user whatever its email", async () => {
    const h = await harness();
    await seed(h, { userId: "me", name: "Me", email: "me@work.example" });
    const writes = vi.spyOn(h.store, "createUser");
    const result = await resolve(h, profile({ email: "different@example.com" }), { userId: "me" });
    expect(result.kind).toBe("linked");
    if (result.kind !== "linked") throw new Error("unreachable");
    expect(writes).not.toHaveBeenCalled();
    expect(result.user.id).toBe("me");
    expect(result.identity).toEqual({
      provider: "google",
      providerId: "g-1",
      userId: "me",
      email: "different@example.com",
      emailVerified: true,
      verifiedAt: NOW,
      handle: "",
      linkedAt: NOW,
    });
    expect((await h.store.identitiesOf("me")).map((i) => i.provider)).toEqual(["github", "google"]);
    // The user's own profile is not replaced by the linked provider's.
    expect(await h.store.userById("me")).toMatchObject({ name: "Me" });
  });

  it("links an unverified identity with no verified_at", async () => {
    const h = await harness();
    await seed(h, { userId: "me" });
    await resolve(h, profile({ emailVerified: false }), { userId: "me" });
    expect(await h.store.identity("google", "g-1")).toMatchObject({
      emailVerified: false,
      verifiedAt: null,
      userId: "me",
    });
  });

  it("attaches to the current user even when another user's verified identity holds that email", async () => {
    const h = await harness();
    await seed(h, { userId: "me", email: "me@example.com" });
    await seed(h, { userId: "other", email: "shared@example.com", verifiedAt: ago(1) });
    const result = await resolve(h, profile({ email: "shared@example.com" }), { userId: "me" });
    expect(result.kind).toBe("linked");
    expect((await h.store.identity("google", "g-1"))!.userId).toBe("me");
    expect(await h.store.identitiesOf("other")).toHaveLength(1);
  });

  it("refuses an identity that belongs to another user, and changes nothing", async () => {
    const h = await harness();
    await seed(h, { userId: "me", name: "Me" });
    const theirs = await seed(h, {
      userId: "them",
      name: "Them",
      provider: "google",
      providerId: "g-1",
      email: "them@example.com",
      verifiedAt: ago(3),
    });
    const writes = [
      vi.spyOn(h.store, "createUser"),
      vi.spyOn(h.store, "addIdentity"),
      vi.spyOn(h.store, "updateUser"),
      vi.spyOn(h.store, "updateIdentity"),
    ];
    const result = await resolve(h, profile({ name: "Changed", email: "changed@example.com" }), {
      userId: "me",
    });
    expect(result).toEqual({ kind: "taken" });
    for (const spy of writes) expect(spy).not.toHaveBeenCalled();
    expect(await h.store.identity("google", "g-1")).toEqual(theirs);
    expect((await h.store.userById("them"))!.name).toBe("Them");
    expect(await h.store.identitiesOf("me")).toHaveLength(1);
  });

  it("an identity the user already holds is linked: refreshed, nothing duplicated", async () => {
    const h = await harness();
    await seed(h, {
      userId: "me",
      provider: "google",
      providerId: "g-1",
      email: "old@example.com",
    });
    const result = await resolve(h, profile({ email: "new@example.com" }), { userId: "me" });
    expect(result.kind).toBe("linked");
    expect(await h.store.identitiesOf("me")).toHaveLength(1);
    expect(await h.store.identity("google", "g-1")).toMatchObject({ email: "new@example.com" });
  });

  it("lapses into an ordinary sign-in when the user who asked no longer exists", async () => {
    const h = await harness();
    const result = await resolve(h, profile(), { userId: "deleted-meanwhile" });
    expect(result.kind).toBe("created");
  });
});

describe("rule 3: two providers, one verified mailbox", () => {
  it("attaches the new identity to the user whose identity verified that email ten days ago", async () => {
    const h = await harness();
    await seed(h, { userId: "owner", name: "Owner", verifiedAt: ago(10) });
    const writes = vi.spyOn(h.store, "createUser");
    const result = await resolve(h, profile());
    expect(result.kind).toBe("merged");
    if (result.kind !== "merged") throw new Error("unreachable");
    expect(writes).not.toHaveBeenCalled();
    expect(result.user).toMatchObject({ id: "owner", name: "Owner" });
    expect(result.identity).toMatchObject({
      userId: "owner",
      provider: "google",
      verifiedAt: NOW,
      linkedAt: NOW,
    });
    expect((await h.store.identitiesOf("owner")).map((i) => i.provider)).toEqual([
      "github",
      "google",
    ]);
  });

  it("compares emails ignoring case, both ways", async () => {
    const upperOnRecord = await harness();
    await seed(upperOnRecord, { userId: "owner", email: "ANA@Example.COM" });
    expect((await resolve(upperOnRecord, profile({ email: "ana@example.com" }))).kind).toBe(
      "merged",
    );

    const upperFromProvider = await harness();
    await seed(upperFromProvider, { userId: "owner", email: "ana@example.com" });
    expect((await resolve(upperFromProvider, profile({ email: "Ana@EXAMPLE.com" }))).kind).toBe(
      "merged",
    );
  });

  it("states the window as 90 days", () => {
    expect(MERGE_WINDOW_DAYS).toBe(90);
  });

  // The window is inclusive: a verification exactly 90 days old still counts.
  const boundary: [string, number, number, "merged" | "stale"][] = [
    ["89 days", 89, 0, "merged"],
    ["90 days less a millisecond", 90, -1, "merged"],
    ["exactly 90 days", 90, 0, "merged"],
    ["90 days and a millisecond", 90, 1, "stale"],
    ["91 days", 91, 0, "stale"],
    ["a year", 365, 0, "stale"],
  ];

  it.each(boundary)("verified %s ago: %s", async (_name, days, extraMs, kind) => {
    const h = await harness();
    await seed(h, { userId: "owner", verifiedAt: ago(days, extraMs) });
    const result = await resolve(h, profile());
    expect(result.kind).toBe(kind);
    if (kind === "merged") {
      expect((result as { user: { id: string } }).user.id).toBe("owner");
    } else {
      expect((result as { user: { id: string } }).user.id).not.toBe("owner");
    }
  });

  it("never matches an unverified email, however fresh the other identity", async () => {
    const h = await harness();
    await seed(h, { userId: "owner", verifiedAt: ago(1) });
    const lookup = vi.spyOn(h.store, "identityByVerifiedEmail");
    const result = await resolve(h, profile({ emailVerified: false }));
    expect(result.kind).toBe("created");
    expect(lookup).not.toHaveBeenCalled();
    expect(await h.store.identitiesOf("owner")).toHaveLength(1);
  });

  it("never matches an empty email", async () => {
    const h = await harness();
    await seed(h, { userId: "owner", email: "", emailVerified: true });
    const result = await resolve(h, profile({ email: "", emailVerified: true }));
    expect(result.kind).toBe("created");
  });

  it("never matches an identity whose own email is unverified", async () => {
    const h = await harness();
    await seed(h, { userId: "owner", emailVerified: false, verifiedAt: null });
    const result = await resolve(h, profile());
    // Nothing verified the address: a new user, and not even the account-exists page.
    expect(result.kind).toBe("created");
  });

  it("a different email does not match", async () => {
    const h = await harness();
    await seed(h, { userId: "owner", email: "someone.else@example.com", verifiedAt: ago(1) });
    expect((await resolve(h, profile())).kind).toBe("created");
  });

  it("joins the freshest verification when two identities hold the address", async () => {
    const h = await harness();
    await seed(h, {
      userId: "old",
      email: "ana@example.com",
      verifiedAt: ago(100),
      providerId: "gh-old",
    });
    await seed(h, {
      userId: "recent",
      email: "ana@example.com",
      verifiedAt: ago(5),
      provider: "google",
      providerId: "g-recent",
    });
    const result = await resolve(h, profile({ providerId: "g-new" }));
    expect(result.kind).toBe("merged");
    if (result.kind === "merged") expect(result.user.id).toBe("recent");
  });

  it("can join a second account of the same provider that verified the same address", async () => {
    const h = await harness();
    await seed(h, { userId: "owner", provider: "google", providerId: "g-old", verifiedAt: ago(2) });
    const result = await resolve(h, profile({ providerId: "g-new" }));
    expect(result.kind).toBe("merged");
    expect((await h.store.identitiesOf("owner")).map((i) => i.providerId)).toEqual([
      "g-old",
      "g-new",
    ]);
  });

  it("does not trust a verified identity whose user is gone: a new user, no account-exists page", async () => {
    const h = await harness();
    await h.store.addIdentity({
      provider: "github",
      providerId: "orphan",
      userId: "ghost",
      email: "ana@example.com",
      emailVerified: true,
      verifiedAt: ago(1),
      handle: "",
      linkedAt: NOW,
    });
    expect((await resolve(h, profile())).kind).toBe("created");
  });
});

describe("rule 4: a new user", () => {
  it("creates the user with the profile's name and picture and one identity", async () => {
    const h = await harness();
    const result = await resolve(
      h,
      profile({ provider: "github", providerId: "4242", handle: "ana-dev" }),
    );
    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("unreachable");
    expect(result.user).toEqual({
      id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      name: "Ana from Google",
      picture: "https://lh3.googleusercontent.com/a/ana",
      createdAt: NOW,
    });
    expect(result.identity).toEqual({
      provider: "github",
      providerId: "4242",
      userId: result.user.id,
      email: "ana@example.com",
      emailVerified: true,
      verifiedAt: NOW,
      handle: "ana-dev",
      linkedAt: NOW,
    });
    expect(await h.store.userById(result.user.id)).toEqual(result.user);
    expect(await h.store.identitiesOf(result.user.id)).toEqual([result.identity]);
  });

  it("sets verified_at only when the email is verified", async () => {
    const h = await harness();
    const verified = await resolve(h, profile());
    const unverified = await resolve(h, profile({ providerId: "g-2", emailVerified: false }));
    expect(verified.kind === "created" && verified.identity.verifiedAt).toBe(NOW);
    expect(unverified.kind === "created" && unverified.identity.verifiedAt).toBeNull();
    expect(unverified.kind === "created" && unverified.identity.emailVerified).toBe(false);
  });

  it("gives every user its own id", async () => {
    const h = await harness();
    const a = await resolve(h, profile({ providerId: "g-a", emailVerified: false }));
    const b = await resolve(h, profile({ providerId: "g-b", emailVerified: false }));
    expect(a.kind === "created" && b.kind === "created" && a.user.id !== b.user.id).toBe(true);
  });

  it("an unverified email carrying the address of an existing user still makes a new user", async () => {
    const h = await harness();
    const owner = await seed(h, { userId: "owner", verifiedAt: ago(1) });
    const result = await resolve(h, profile({ email: owner.email, emailVerified: false }));
    expect(result.kind).toBe("created");
    if (result.kind === "created") expect(result.user.id).not.toBe("owner");
  });

  it("leaves no user behind when the identity cannot be stored", async () => {
    const h = await harness();
    const created: string[] = [];
    const createUser = h.store.createUser.bind(h.store);
    h.store.createUser = async (user) => {
      created.push(user.id);
      await createUser(user);
    };
    h.store.addIdentity = async () => {
      throw new Error("the store is down");
    };
    await expect(resolve(h, profile())).rejects.toThrow("the store is down");
    expect(created).toHaveLength(1);
    expect(await h.store.userById(created[0]!)).toBeUndefined();
  });
});

describe("the stale verified email", () => {
  it("creates a new user and says which provider holds the older identity", async () => {
    const h = await harness();
    const old = await seed(h, { userId: "owner", provider: "github", verifiedAt: ago(91) });
    const result = await resolve(h, profile());
    expect(result.kind).toBe("stale");
    if (result.kind !== "stale") throw new Error("unreachable");
    expect(result.existingProvider).toBe("github");
    expect(result.user.id).not.toBe("owner");
    expect(result.identity).toMatchObject({ provider: "google", userId: result.user.id });
    // The older account is untouched, and so is its identity.
    expect(await h.store.identitiesOf("owner")).toEqual([old]);
    expect(await h.store.userById("owner")).toMatchObject({ name: "Seeded" });
  });

  it("names the provider of the older identity, whichever it is", async () => {
    const h = await harness();
    await seed(h, {
      userId: "owner",
      provider: "google",
      providerId: "g-old",
      verifiedAt: ago(200),
    });
    const result = await resolve(h, profile({ provider: "github", providerId: "4242" }));
    expect(result.kind === "stale" && result.existingProvider).toBe("google");
  });

  it("is not the answer to a link request, which attaches whatever the email", async () => {
    const h = await harness();
    await seed(h, {
      userId: "owner",
      email: "ana@example.com",
      verifiedAt: ago(200),
      providerId: "gh-old",
    });
    await seed(h, { userId: "me", email: "me@example.com", providerId: "gh-me" });
    const result = await resolve(h, profile(), { userId: "me" });
    expect(result.kind).toBe("linked");
  });
});
