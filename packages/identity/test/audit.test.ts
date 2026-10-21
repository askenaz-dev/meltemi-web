// The coverage audit of `identity-service`. Everything here closes a gap the audit found between
// a scenario's THEN and what the other suites assert, or exercises seams that only meet once the
// parts run together: the handlers over the real SQL with foreign keys enforced (D1 always
// enforces them; the in-memory store does not), and the Worker entry, which no other test calls.

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { csrfToken } from "../src/forms.js";
import { scheduled } from "../src/handler.js";
import { parseJwt } from "../src/jwt.js";
import { KeyConfigError, readSigningKeys } from "../src/signing-keys.js";
import { d1Store } from "../src/store/d1.js";
import { testKeys } from "../src/testing.js";
import { verifyEventSignature } from "../src/verify.js";
import worker from "../src/worker.js";
import {
  EDGE_ON_WINDOWS,
  FIREFOX_ON_ANDROID,
  SAFARI_ON_IOS,
  anotherSession,
  formPost,
} from "./support/account.js";
import {
  harness,
  signedInPerson,
  stubProviders,
  testEnv,
  textOf,
  type Harness,
  type SeededPerson,
} from "./support/index.js";
import { callback, captureConsole, sessionCookies, signIn, startFlow } from "./support/signin.js";
import { openDatabase, sqliteAvailable, type SqliteDb } from "./support/sqlite.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const EVENTS_URL = "https://diagrams.meltemi.dev/_identity/events";
const EVENTS_SECRET = "test-events-secret";

let log: ReturnType<typeof captureConsole>;
beforeEach(() => {
  log = captureConsole();
});
afterEach(() => {
  log.restore();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------------------------
// Helpers

/** The `meltemi_session=<token>` pair a response sets, as a `Cookie` header value. */
function cookieOf(response: Response): string {
  const line = sessionCookies(response)[0];
  if (!line) throw new Error("the response sets no session cookie");
  return line.split(";")[0]!;
}

/** The `sid` inside the token a response sets. */
function sidOf(response: Response): string {
  const token = cookieOf(response).slice("meltemi_session=".length);
  return parseJwt(token)!.claims["sid"] as string;
}

/** What a product's session check would be told about a session. */
async function checkOf(h: Pick<Harness, "request">, sid: string): Promise<number> {
  return (await h.request(`/sessions/${sid}`)).status;
}

function asSession(response: Response) {
  return { cookie: cookieOf(response), session: { sid: sidOf(response) } };
}

// ---------------------------------------------------------------------------------------------
// identity-account: the answers a product sees, exactly as the scenarios word them

describe("revoking the other sessions, as the scenarios word it", () => {
  it("others revoked: the first and the third answer 404 to the session check, the second 204", async () => {
    const h = await harness();
    const first = await signedInPerson(h);
    const second = await anotherSession(h, first, FIREFOX_ON_ANDROID);
    const third = await anotherSession(h, first, SAFARI_ON_IOS);
    for (const s of [first.session, second.session, third.session]) {
      expect(await checkOf(h, s.sid)).toBe(204);
    }

    const response = await formPost(h, "/account/sessions/revoke-others", { as: second });
    expect(response.status).toBe(303);

    expect(await checkOf(h, first.session.sid)).toBe(404);
    expect(await checkOf(h, third.session.sid)).toBe(404);
    expect(await checkOf(h, second.session.sid)).toBe(204);
  });

  it("signed out: a 302 to the chooser with the account page, and every session still answers 204", async () => {
    const h = await harness();
    const first = await signedInPerson(h);
    const second = await anotherSession(h, first, FIREFOX_ON_ANDROID);
    const third = await anotherSession(h, first, SAFARI_ON_IOS);

    const response = await formPost(h, "/account/sessions/revoke-others", {});
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!, h.env.ISSUER);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("return_to")).toBe("https://id.meltemi.dev/account");

    for (const s of [first.session, second.session, third.session]) {
      expect(await checkOf(h, s.sid)).toBe(204);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// identity-sign-in: "a completed flow SHALL replace the session"

describe("a completed sign-in replaces the session the browser held", () => {
  /** A person who signs in as the stub's GitHub account, already holding a session. */
  async function holder(h: Harness): Promise<SeededPerson> {
    return signedInPerson(h, { provider: "github", providerId: "4242", email: "ana@example.com" });
  }

  it("ends the old session: its check answers 404, the new one 204, and the old cookie is a stranger", async () => {
    const h = await harness();
    const person = await holder(h);
    h.clock.advance(MINUTE);

    const { response } = await signIn(h, "github", { cookies: [person.cookie] });
    expect(response.status).toBe(302);

    const sid = sidOf(response);
    expect(sid).not.toBe(person.session.sid);
    expect(await checkOf(h, person.session.sid)).toBe(404);
    expect(await checkOf(h, sid)).toBe(204);
    expect((await h.store.session(person.session.sid))?.revokedAt).toBe(
      h.clock.now().toISOString(),
    );
    expect((await h.request("/account", { headers: { Cookie: person.cookie } })).status).toBe(302);
    const page = await h.request("/account", { headers: { Cookie: cookieOf(response) } });
    expect(page.status).toBe(200);
  });

  it("lists one session afterwards, not an orphan next to the new one", async () => {
    const h = await harness();
    const person = await holder(h);
    const { response } = await signIn(h, "github", { cookies: [person.cookie] });
    const sessions = await h.store.sessionsOf(person.user.id, h.clock.now().toISOString());
    expect(sessions.map((s) => s.sid)).toEqual([sidOf(response)]);
  });

  it("ends it when the person signs in as someone else: that session was the other person's", async () => {
    const h = await harness();
    const first = await signedInPerson(h, {
      id: "user-first",
      providerId: "other-github",
      email: "first@example.com",
    });
    const { response } = await signIn(h, "github", { cookies: [first.cookie] });
    expect(await checkOf(h, first.session.sid)).toBe(404);
    expect(await checkOf(h, sidOf(response))).toBe(204);
  });

  it("leaves the person's other devices signed in", async () => {
    const h = await harness();
    const person = await holder(h);
    const phone = await anotherSession(h, person, FIREFOX_ON_ANDROID);
    await signIn(h, "github", { cookies: [person.cookie] });
    expect(await checkOf(h, person.session.sid)).toBe(404);
    expect(await checkOf(h, phone.session.sid)).toBe(204);
  });

  it("does the same in the 'an account with that email exists' flow", async () => {
    const h = await harness();
    await signedInPerson(h, {
      id: "user-owner",
      provider: "github",
      providerId: "gh-owner",
      email: "ana@example.com",
    });
    h.clock.advance(91 * DAY);
    const stranger = await signedInPerson(h, {
      id: "user-b",
      providerId: "b-1",
      email: "b@example.com",
    });

    const { response } = await signIn(h, "google", { cookies: [stranger.cookie] });
    expect(response.status).toBe(200);
    expect(await textOf(response)).toContain("An account with this email already exists");
    expect(await checkOf(h, stranger.session.sid)).toBe(404);
    expect(await checkOf(h, sidOf(response))).toBe(204);
  });

  it("keeps it when the flow only links a provider: the person stays signed in", async () => {
    const h = await harness();
    const person = await holder(h);
    const { response } = await signIn(h, "google", {
      cookies: [person.cookie],
      query: { link: "1" },
    });
    expect(response.status).toBe(302);
    expect(sessionCookies(response)).toEqual([]);
    expect(await checkOf(h, person.session.sid)).toBe(204);
    expect((await h.store.identitiesOf(person.user.id)).map((i) => i.provider)).toEqual([
      "github",
      "google",
    ]);
  });

  it("keeps it when linking is refused because the identity belongs to someone else", async () => {
    const h = await harness();
    const person = await holder(h);
    await signedInPerson(h, {
      id: "user-b",
      provider: "google",
      providerId: "g-7777",
      email: "b@example.com",
    });
    const { response } = await signIn(h, "google", {
      cookies: [person.cookie],
      query: { link: "1" },
    });
    expect(response.status).toBe(409);
    expect(await textOf(response)).toContain("identity.taken");
    expect(await checkOf(h, person.session.sid)).toBe(204);
  });

  it.each([
    ["the provider is down", async (h: Harness) => void (h.stub.github.tokenStatus = 503)],
    ["the person declines", async () => undefined],
    ["the state does not match", async () => undefined],
  ])("keeps it when the flow fails: %s", async (name, arrange) => {
    const h = await harness();
    const person = await holder(h);
    await arrange(h);
    const flow = await startFlow(h, "github", { headers: { Cookie: person.cookie } });
    const response = await callback(h, "github", flow, {
      cookies: [person.cookie],
      ...(name === "the person declines" ? { error: "access_denied", code: undefined } : {}),
      ...(name === "the state does not match" ? { state: "not-the-state" } : {}),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(sessionCookies(response)).toEqual([]);
    expect(await checkOf(h, person.session.sid)).toBe(204);
  });
});

// ---------------------------------------------------------------------------------------------
// The handlers over D1: the same flows, over the SQL, with the foreign keys enforced

describe.skipIf(!sqliteAvailable)(
  "the whole service over D1 (node:sqlite, foreign keys on)",
  () => {
    let db: SqliteDb;
    afterEach(() => db?.close());

    async function d1Harness(): Promise<Harness> {
      db = openDatabase({ foreignKeys: true });
      return harness({ store: d1Store(db) });
    }
    const count = (table: string): number =>
      (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    const rows = (table: string) => db.raw.prepare(`SELECT * FROM ${table}`).all();
    const everythingStored = () =>
      JSON.stringify(["users", "identities", "sessions", "outbox"].map((table) => rows(table)));

    it("lives a whole account: sign in, check, link, unlink, other devices, sign out, delete, tell the product", async () => {
      const h = await d1Harness();

      // Sign in with GitHub from Edge.
      const first = await signIn(h, "github", {
        headers: { "User-Agent": EDGE_ON_WINDOWS },
        query: { return_to: "https://diagrams.meltemi.dev/" },
      });
      expect(first.response.status).toBe(302);
      expect(first.response.headers.get("Location")).toBe("https://diagrams.meltemi.dev/");
      const laptop = asSession(first.response);
      expect([count("users"), count("identities"), count("sessions"), count("outbox")]).toEqual([
        1, 1, 1, 0,
      ]);
      // What was stored is coarse: a family label, never the User-Agent or a provider's token.
      const stored = everythingStored();
      expect(stored).toContain("Edge on Windows");
      expect(stored).not.toContain("Mozilla");
      expect(stored).not.toContain("stub-github-access-token");
      expect(stored).not.toContain("test-github-secret");

      // The session check moves last_seen to the request's time.
      h.clock.advance(5 * MINUTE);
      expect(await checkOf(h, laptop.session.sid)).toBe(204);
      const seen = db.raw
        .prepare("SELECT last_seen FROM sessions WHERE sid = ?")
        .get(laptop.session.sid) as { last_seen: string };
      expect(seen.last_seen).toBe(h.clock.now().toISOString());

      // The account page reads the rows back.
      const account = await h.request("/account", { headers: { Cookie: laptop.cookie } });
      expect(account.status).toBe(200);
      const accountHtml = await textOf(account);
      expect(accountHtml).toContain("Ana Dev");
      expect(accountHtml).toContain("Edge on Windows");

      // Link Google while signed in: a second identity for the same user, the session untouched.
      const linked = await signIn(h, "google", {
        cookies: [laptop.cookie],
        query: { link: "1", return_to: "https://id.meltemi.dev/account" },
      });
      expect(linked.response.status).toBe(302);
      expect(linked.response.headers.get("Location")).toBe("https://id.meltemi.dev/account");
      expect(sessionCookies(linked.response)).toEqual([]);
      expect([count("users"), count("identities"), count("sessions")]).toEqual([1, 2, 1]);

      // A second device signs in with the same GitHub identity.
      const phone = asSession(
        (await signIn(h, "github", { headers: { "User-Agent": FIREFOX_ON_ANDROID } })).response,
      );
      expect(count("users")).toBe(1);
      expect(count("sessions")).toBe(2);

      // Unlink Google; the last identity cannot go.
      const unlinked = await formPost(h, "/account/unlink", {
        as: laptop,
        fields: { provider: "google" },
      });
      expect(unlinked.status).toBe(303);
      expect(count("identities")).toBe(1);
      const last = await formPost(h, "/account/unlink", {
        as: laptop,
        fields: { provider: "github" },
      });
      expect(last.status).toBe(409);
      expect(await textOf(last)).toContain("identity.last");
      expect(count("identities")).toBe(1);

      // Sign out of the other devices.
      const others = await formPost(h, "/account/sessions/revoke-others", { as: laptop });
      expect(others.status).toBe(303);
      expect(await checkOf(h, phone.session.sid)).toBe(404);
      expect(await checkOf(h, laptop.session.sid)).toBe(204);
      expect(
        (
          db.raw
            .prepare("SELECT revoked_at FROM sessions WHERE sid = ?")
            .get(phone.session.sid) as {
            revoked_at: string | null;
          }
        ).revoked_at,
      ).toBe(h.clock.now().toISOString());

      // A product signs the person out with its own form.
      const signedOut = await h.request("/logout", {
        method: "POST",
        headers: {
          Origin: "https://diagrams.meltemi.dev",
          Cookie: laptop.cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ return_to: "https://diagrams.meltemi.dev/" }).toString(),
      });
      expect(signedOut.status).toBe(302);
      expect(await checkOf(h, laptop.session.sid)).toBe(404);

      // Sign in again and delete the account: the user, identities and sessions go, the event stays.
      const again = asSession((await signIn(h, "github")).response);
      const deleted = await formPost(h, "/account/delete", {
        as: again,
        fields: { confirm: "delete" },
      });
      expect(deleted.status).toBe(200);
      expect(await textOf(deleted)).toContain("Account deleted");
      expect([count("users"), count("identities"), count("sessions"), count("outbox")]).toEqual([
        0, 0, 0, 1,
      ]);
      expect(await checkOf(h, again.session.sid)).toBe(404);
      const event = db.raw.prepare("SELECT * FROM outbox").get() as {
        id: string;
        product: string;
        body: string;
        attempts: number;
        delivered_at: string | null;
      };
      expect(event.product).toBe("diagrams");
      expect(event.id).toMatch(/^evt_/);
      expect(event.attempts).toBe(0);
      expect(event.delivered_at).toBeNull();

      // The scheduled run delivers it, signed, once.
      h.stub.products.set(EVENTS_URL, () => 200);
      await scheduled(h.env, h.deps);
      const posts = h.stub.calls.filter((call) => call.url === EVENTS_URL);
      expect(posts).toHaveLength(1);
      expect(posts[0]!.method).toBe("POST");
      expect(posts[0]!.body).toBe(event.body);
      expect(posts[0]!.headers.get("Meltemi-Event-Id")).toBe(event.id);
      expect(
        await verifyEventSignature(
          EVENTS_SECRET,
          posts[0]!.body,
          posts[0]!.headers.get("Meltemi-Signature"),
        ),
      ).toBe(true);
      const delivered = db.raw.prepare("SELECT * FROM outbox").get() as {
        attempts: number;
        delivered_at: string | null;
      };
      expect(delivered.attempts).toBe(1);
      expect(delivered.delivered_at).toBe(h.clock.now().toISOString());
      await scheduled(h.env, h.deps);
      expect(h.stub.calls.filter((call) => call.url === EVENTS_URL)).toHaveLength(1);
    });

    it("merges a verified mailbox within 90 days, and starts a new user past them, under the foreign keys", async () => {
      const h = await d1Harness();
      await signIn(h, "github");
      h.clock.advance(10 * DAY);
      const merged = await signIn(h, "google");
      expect(merged.response.status).toBe(302);
      expect([count("users"), count("identities")]).toEqual([1, 2]);

      // The freshest verification of the address is Google's, ten days after GitHub's. Another
      // GitHub account that verified the same address 91 days after that is a new user.
      h.clock.advance(91 * DAY);
      h.stub.github.user = { ...h.stub.github.user, id: 5555, login: "ana-two" };
      const stale = await signIn(h, "github");
      expect(stale.response.status).toBe(200);
      expect(await textOf(stale.response)).toContain("An account with this email already exists");
      expect([count("users"), count("identities")]).toEqual([2, 3]);
      expect(await checkOf(h, sidOf(stale.response))).toBe(204);
    });

    it("tells a product that is down again, and gives the event up after seven days", async () => {
      const h = await d1Harness();
      const person = asSession((await signIn(h, "github")).response);
      await formPost(h, "/account/delete", { as: person, fields: { confirm: "delete" } });
      const created = h.clock.now().getTime();
      let answer = 503;
      h.stub.products.set(EVENTS_URL, () => answer);
      const outbox = () =>
        db.raw.prepare("SELECT * FROM outbox").get() as {
          id: string;
          attempts: number;
          next_at: string;
          delivered_at: string | null;
          failed_at: string | null;
        };

      // 503 first: the next attempt is a minute away.
      await scheduled(h.env, h.deps);
      expect(outbox().attempts).toBe(1);
      expect(outbox().next_at).toBe(new Date(created + MINUTE).toISOString());
      // Up on the second attempt: delivered, with two attempts.
      h.clock.advance(MINUTE);
      answer = 200;
      await scheduled(h.env, h.deps);
      expect(outbox().attempts).toBe(2);
      expect(outbox().delivered_at).toBe(h.clock.now().toISOString());
      expect(outbox().failed_at).toBeNull();

      // And an account whose product never answers: the cron fires every fifteen minutes.
      const other = asSession((await signIn(h, "github")).response);
      await formPost(h, "/account/delete", { as: other, fields: { confirm: "delete" } });
      const second = db.raw.prepare("SELECT * FROM outbox WHERE delivered_at IS NULL").get() as {
        id: string;
        created_at: string;
      };
      const begun = Date.parse(second.created_at);
      answer = 503;
      const callsBefore = h.stub.calls.filter((call) => call.url === EVENTS_URL).length;
      log.restore();
      log = captureConsole();
      while (h.clock.now().getTime() - begun < 8 * DAY) {
        h.clock.advance(15 * MINUTE);
        await scheduled(h.env, h.deps);
      }
      const failed = db.raw.prepare("SELECT * FROM outbox WHERE id = ?").get(second.id) as {
        attempts: number;
        delivered_at: string | null;
        failed_at: string | null;
      };
      const attempts = h.stub.calls.filter((call) => call.url === EVENTS_URL).length - callsBefore;
      expect(failed.delivered_at).toBeNull();
      expect(failed.failed_at).not.toBeNull();
      expect(Date.parse(failed.failed_at!) - begun).toBeGreaterThanOrEqual(7 * DAY);
      expect(failed.attempts).toBe(attempts);
      const lines = log
        .lines()
        .split("\n")
        .filter((line) => line.includes(second.id));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("diagrams");
    });

    it("removes sessions that ended over seven days ago and keeps the live ones", async () => {
      const h = await d1Harness();
      const gone = asSession((await signIn(h, "github")).response);
      await h.request("/logout", {
        method: "POST",
        headers: { Origin: "https://meltemi.dev", Cookie: gone.cookie },
      });
      h.clock.advance(1 * DAY);
      const kept = asSession((await signIn(h, "github")).response);
      h.clock.advance(7 * DAY + MINUTE);
      await scheduled(h.env, h.deps);
      expect(count("sessions")).toBe(1);
      expect(await checkOf(h, kept.session.sid)).toBe(204);
      expect(await checkOf(h, gone.session.sid)).toBe(404);
    });
  },
);

// ---------------------------------------------------------------------------------------------
// The Worker entry, which builds the dependencies from the bindings

describe("the signing keys of the Worker's settings", () => {
  interface Fields {
    privateJwk: Record<string, unknown>;
    publicJwk: Record<string, unknown>;
    others: Record<string, unknown>[];
  }

  async function settings(change: (fields: Fields) => void = () => undefined) {
    const keys = await testKeys();
    const fields: Fields = {
      privateJwk: { ...keys.privateJwk },
      publicJwk: { ...keys.publicJwk },
      others: [],
    };
    change(fields);
    return {
      keys,
      env: {
        SESSION_PRIVATE_KEY: JSON.stringify(fields.privateJwk),
        SESSION_PUBLIC_KEYS: JSON.stringify([fields.publicJwk, ...fields.others]),
      },
    };
  }

  it("imports a private key that its public half is published for, and keeps the order given", async () => {
    const previous = await testKeys();
    const { keys, env } = await settings((fields) => fields.others.push({ ...previous.publicJwk }));
    const read = await readSigningKeys(env);
    expect(read.kid).toBe(keys.publicJwk.kid);
    expect(read.publicJwks.map((key) => key.kid)).toEqual([
      keys.publicJwk.kid,
      previous.publicJwk.kid,
    ]);
    expect(read.privateKey.type).toBe("private");
    expect(read.privateKey.extractable).toBe(false);
  });

  it("publishes the public fields only, for signing, whatever the setting carried", async () => {
    const { env } = await settings((fields) => {
      delete fields.publicJwk["use"];
      delete fields.publicJwk["alg"];
      fields.publicJwk["d"] = "PRIVATE-PART-PASTED-BY-MISTAKE";
    });
    const read = await readSigningKeys(env);
    expect(read.publicJwks).toHaveLength(1);
    expect(read.publicJwks[0]).toMatchObject({ kty: "EC", crv: "P-256", use: "sig", alg: "ES256" });
    expect(Object.keys(read.publicJwks[0]!).sort()).toEqual([
      "alg",
      "crv",
      "kid",
      "kty",
      "use",
      "x",
      "y",
    ]);
    expect(JSON.stringify(read.publicJwks)).not.toContain("PRIVATE-PART");
  });

  const cases: [string, Record<string, string>, RegExp][] = [
    ["a missing private key", { SESSION_PRIVATE_KEY: "", SESSION_PUBLIC_KEYS: "[]" }, /missing/],
    [
      "a private key that is not JSON",
      { SESSION_PRIVATE_KEY: "TOP-SECRET-KEY-MATERIAL {oops", SESSION_PUBLIC_KEYS: "[]" },
      /SESSION_PRIVATE_KEY is not JSON/,
    ],
    [
      "a public key list that is not JSON",
      { SESSION_PUBLIC_KEYS: "TOP-SECRET-KEY-MATERIAL [oops" },
      /SESSION_PUBLIC_KEYS is not JSON/,
    ],
    [
      "a private key that is not a JWK",
      { SESSION_PRIVATE_KEY: '"TOP-SECRET-KEY-MATERIAL"' },
      /not a P-256 private JWK/,
    ],
    [
      "a private key without its secret",
      { SESSION_PRIVATE_KEY: "PUBLIC-ONLY" },
      /not a P-256 private JWK/,
    ],
    ["a public key list that is not a list", { SESSION_PUBLIC_KEYS: "{}" }, /not an array/],
    [
      "a public key list with something that is not a key",
      { SESSION_PUBLIC_KEYS: '["TOP-SECRET-KEY-MATERIAL"]' },
      /not an array of P-256 public JWKs/,
    ],
    ["no public keys at all", { SESSION_PUBLIC_KEYS: "[]" }, /does not publish/],
    ["no public keys set", { SESSION_PUBLIC_KEYS: "" }, /does not publish/],
  ];

  it.each(cases)(
    "refuses %s with a message that repeats nothing of the settings",
    async (_n, change, message) => {
      const { keys, env } = await settings();
      const given = {
        ...env,
        ...change,
        ...(change["SESSION_PRIVATE_KEY"] === "PUBLIC-ONLY"
          ? { SESSION_PRIVATE_KEY: JSON.stringify(keys.publicJwk) }
          : {}),
      };
      const failure = await readSigningKeys(given).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(KeyConfigError);
      const text = (failure as Error).message;
      expect(text).toMatch(message);
      expect(text).not.toContain("TOP-SECRET");
      expect(text).not.toContain(keys.privateJwk.d);
    },
  );

  it("refuses a published key that is another key under the same kid", async () => {
    const other = await testKeys();
    const { env } = await settings((fields) => {
      fields.publicJwk["x"] = other.publicJwk.x;
      fields.publicJwk["y"] = other.publicJwk.y;
    });
    await expect(readSigningKeys(env)).rejects.toThrow(/does not publish/);
  });

  it("refuses keys that are not for signing", async () => {
    const encKey = await settings((fields) => (fields.publicJwk["use"] = "enc"));
    await expect(readSigningKeys(encKey.env)).rejects.toThrow(/public JWKs/);
    const wrongAlg = await settings((fields) => (fields.privateJwk["alg"] = "RS256"));
    await expect(readSigningKeys(wrongAlg.env)).rejects.toThrow(/private JWK/);
  });
});

describe.skipIf(!sqliteAvailable)("the Worker entry over D1", () => {
  let db: SqliteDb;
  afterEach(() => db?.close());

  /** The Worker as Cloudflare calls it: bindings in, global `fetch` for the providers. */
  async function deployed(over: Record<string, string> = {}) {
    db = openDatabase();
    const keys = await testKeys();
    const stub = stubProviders();
    vi.stubGlobal("fetch", stub.fetch);
    const env = testEnv({
      DB: db,
      SESSION_PRIVATE_KEY: JSON.stringify(keys.privateJwk),
      SESSION_PUBLIC_KEYS: JSON.stringify([keys.publicJwk]),
      ...over,
    });
    const call = (path: string, init?: RequestInit) =>
      worker.fetch(new Request(`${env.ISSUER}${path}`, init), env);
    // `startFlow` and `callback` only need something that calls the service.
    const browser = { request: call } as unknown as Harness;
    return { keys, stub, env, call, browser };
  }

  it("publishes the keys, signs people in over D1, checks sessions, signs out and tells the product", async () => {
    const { keys, stub, env, call, browser } = await deployed();

    const jwks = (await (await call("/.well-known/jwks.json")).json()) as {
      keys: { kid: string }[];
    };
    expect(jwks.keys.map((key) => key.kid)).toEqual([keys.publicJwk.kid]);

    const flow = await startFlow(browser, "github", {
      query: { return_to: "https://diagrams.meltemi.dev/" },
    });
    const signedIn = await callback(browser, "github", flow);
    expect(signedIn.status).toBe(302);
    expect(signedIn.headers.get("Location")).toBe("https://diagrams.meltemi.dev/");
    const person = asSession(signedIn);
    expect(parseJwt(person.cookie.slice("meltemi_session=".length))!.header["kid"]).toBe(
      keys.publicJwk.kid,
    );

    const account = await call("/account", { headers: { Cookie: person.cookie } });
    expect(account.status).toBe(200);
    expect(await textOf(account)).toContain("Ana Dev");
    expect(await checkOf({ request: call }, person.session.sid)).toBe(204);

    const out = await call("/logout", {
      method: "POST",
      headers: { Origin: "https://diagrams.meltemi.dev", Cookie: person.cookie },
    });
    expect(out.status).toBe(302);
    expect(await checkOf({ request: call }, person.session.sid)).toBe(404);

    // Delete an account through the Worker, then let the cron deliver the event.
    const again = asSession(await callback(browser, "github", await startFlow(browser, "github")));
    const csrf = await csrfToken({ env }, again.session.sid);
    const deleted = await call("/account/delete", {
      method: "POST",
      headers: {
        Origin: env.ISSUER,
        Cookie: again.cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrf, confirm: "delete" }).toString(),
    });
    expect(deleted.status).toBe(200);
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(0);

    stub.products.set(EVENTS_URL, () => 200);
    await worker.scheduled(undefined, env);
    const posts = stub.calls.filter((c) => c.url === EVENTS_URL);
    expect(posts).toHaveLength(1);
    expect(
      await verifyEventSignature(
        EVENTS_SECRET,
        posts[0]!.body,
        posts[0]!.headers.get("Meltemi-Signature"),
      ),
    ).toBe(true);
    expect(
      (db.raw.prepare("SELECT delivered_at FROM outbox").get() as { delivered_at: string | null })
        .delivered_at,
    ).not.toBeNull();
  });

  it("serves a rotated key set as soon as the settings carry it", async () => {
    const { keys, env, call } = await deployed();
    expect(
      ((await (await call("/.well-known/jwks.json")).json()) as { keys: unknown[] }).keys,
    ).toHaveLength(1);
    const next = await testKeys();
    const rotated = {
      ...env,
      SESSION_PRIVATE_KEY: JSON.stringify(next.privateJwk),
      SESSION_PUBLIC_KEYS: JSON.stringify([next.publicJwk, keys.publicJwk]),
    };
    const answer = await worker.fetch(new Request(`${env.ISSUER}/.well-known/jwks.json`), rotated);
    const published = ((await answer.json()) as { keys: { kid: string }[] }).keys.map((k) => k.kid);
    expect(published).toEqual([next.publicJwk.kid, keys.publicJwk.kid]);
  });

  it.each([
    ["no private key", { SESSION_PRIVATE_KEY: "" }, "SESSION_PRIVATE_KEY is missing"],
    [
      "a private key that is not JSON",
      { SESSION_PRIVATE_KEY: "TOP-SECRET-KEY-MATERIAL {oops" },
      "SESSION_PRIVATE_KEY is not JSON",
    ],
    ["public keys that lack the signing key", { SESSION_PUBLIC_KEYS: "[]" }, "does not publish"],
  ])(
    "answers 500 and logs a message that holds no setting when there is %s",
    async (_n, over, logged) => {
      const { call } = await deployed(over);
      const response = await call("/login");
      expect(response.status).toBe(500);
      expect(await response.text()).toBe("The service is not configured.");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(log.lines()).toContain(logged);
      expect(log.lines()).not.toContain("TOP-SECRET");
    },
  );

  it("does not start the cron either when the keys cannot be read", async () => {
    const { env } = await deployed({ SESSION_PRIVATE_KEY: "" });
    await expect(worker.scheduled(undefined, env)).rejects.toThrow(/SESSION_PRIVATE_KEY/);
  });
});

// ---------------------------------------------------------------------------------------------
// identity-account, "What the service holds": "`packages/identity/README.md` SHALL list this
// inventory". The README is written by task 6.1; until then it says it holds only itself and the
// check waits, and from the moment it is written it is enforced.

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const README_WRITTEN = !README.includes("holds only this file");

describe.skipIf(!README_WRITTEN)("the README's inventory of what the service holds", () => {
  it("names the four tables", () => {
    for (const table of ["users", "identities", "sessions", "outbox"]) {
      expect(README, table).toMatch(new RegExp(String.raw`\b${table}\b`));
    }
  });

  it("lists the columns, verified_at included", () => {
    const columns = [
      "provider_id",
      "email_verified",
      "verified_at",
      "linked_at",
      "last_seen",
      "expires_at",
      "revoked_at",
      "next_at",
      "delivered_at",
      "failed_at",
    ];
    for (const column of columns) expect(README, column).toContain(column);
  });

  it("says what it does not hold", () => {
    expect(README.toLowerCase()).toMatch(/provider token/);
    expect(README.toLowerCase()).toMatch(/user-agent/);
  });
});
