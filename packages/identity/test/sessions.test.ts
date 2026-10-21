import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EDGE_ON_WINDOWS,
  FIREFOX_ON_ANDROID,
  SAFARI_ON_IOS,
  anotherSession,
  formPost,
} from "./support/account.js";
import { harness, signedInPerson } from "./support/index.js";

const SID_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /sessions/<sid>", () => {
  it("answers 204 with no body and no-store for a live session, and records when it was seen", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    expect(person.session.sid).toMatch(SID_SHAPE);
    expect(person.session.lastSeen).toBe("2026-10-14T12:00:00.000Z");

    h.clock.advance(10 * 60_000);
    const response = await h.request(`/sessions/${person.session.sid}`);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await h.store.session(person.session.sid))?.lastSeen).toBe("2026-10-14T12:10:00.000Z");
  });

  it("moves the last-seen time on every check", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    h.clock.set("2026-10-15T08:30:00.000Z");
    await h.request(`/sessions/${person.session.sid}`);
    h.clock.set("2026-10-16T09:45:00.000Z");
    await h.request(`/sessions/${person.session.sid}`);
    expect((await h.store.session(person.session.sid))?.lastSeen).toBe("2026-10-16T09:45:00.000Z");
  });

  it("needs no authentication: no cookie, a foreign Origin, a garbage cookie", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const url = `/sessions/${person.session.sid}`;
    expect((await h.request(url)).status).toBe(204);
    expect((await h.request(url, { headers: { Origin: "https://evil.example" } })).status).toBe(
      204,
    );
    expect((await h.request(url, { headers: { Cookie: "meltemi_session=garbage" } })).status).toBe(
      204,
    );
  });

  it("answers 404 with no body and no-store for a session that does not exist", async () => {
    const h = await harness();
    const response = await h.request(`/sessions/${"A".repeat(43)}`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers 404 for a session revoked by POST /logout", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    expect((await h.request(`/sessions/${person.session.sid}`)).status).toBe(204);

    const loggedOut = await h.request("/logout", {
      method: "POST",
      headers: {
        Origin: "https://diagrams.meltemi.dev",
        Cookie: person.cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "return_to=https%3A%2F%2Fdiagrams.meltemi.dev%2F",
    });
    expect(loggedOut.status).toBe(302);

    const response = await h.request(`/sessions/${person.session.sid}`);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers 404 for a session revoked in the store, and does not move its last-seen time", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    h.clock.advance(60_000);
    await h.store.revokeSession(person.session.sid, h.clock.now().toISOString());
    h.clock.advance(60_000);
    expect((await h.request(`/sessions/${person.session.sid}`)).status).toBe(404);
    expect((await h.store.session(person.session.sid))?.lastSeen).toBe("2026-10-14T12:00:00.000Z");
  });

  it("answers 204 until the instant the session expires and 404 from then on", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const expiresAt = Date.parse(person.session.expiresAt);
    expect(expiresAt - Date.parse(person.session.createdAt)).toBe(THIRTY_DAYS_MS);

    h.clock.set(new Date(expiresAt - 1).toISOString());
    expect((await h.request(`/sessions/${person.session.sid}`)).status).toBe(204);
    const lastSeen = (await h.store.session(person.session.sid))?.lastSeen;
    expect(lastSeen).toBe(new Date(expiresAt - 1).toISOString());

    h.clock.set(new Date(expiresAt).toISOString());
    expect((await h.request(`/sessions/${person.session.sid}`)).status).toBe(404);
    h.clock.set(new Date(expiresAt + THIRTY_DAYS_MS).toISOString());
    expect((await h.request(`/sessions/${person.session.sid}`)).status).toBe(404);
    // An expired session is not touched: the last time it was seen stays the last time it was live.
    expect((await h.store.session(person.session.sid))?.lastSeen).toBe(lastSeen);
  });

  it("answers an unknown, a revoked and an expired session identically, so none can be told apart", async () => {
    const h = await harness();
    const revoked = await signedInPerson(h, { id: "user-r" });
    const expired = await signedInPerson(h, { id: "user-e" });
    await h.store.revokeSession(revoked.session.sid, h.clock.now().toISOString());
    h.clock.set(new Date(Date.parse(expired.session.expiresAt) + 1).toISOString());

    const seen = async (sid: string) => {
      const response = await h.request(`/sessions/${sid}`);
      return {
        status: response.status,
        headers: [...response.headers].sort(),
        body: await response.text(),
      };
    };
    const unknown = await seen("A".repeat(43));
    expect(unknown.status).toBe(404);
    expect(await seen(revoked.session.sid)).toEqual(unknown);
    expect(await seen(expired.session.sid)).toEqual(unknown);
  });

  it("only revokes the session that was ended: another device of the same person stays live", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const phone = await anotherSession(h, person, FIREFOX_ON_ANDROID);
    await h.store.revokeSession(person.session.sid, h.clock.now().toISOString());
    expect((await h.request(`/sessions/${person.session.sid}`)).status).toBe(404);
    expect((await h.request(`/sessions/${phone.session.sid}`)).status).toBe(204);
  });

  describe("an id that cannot be a session id", () => {
    const aaa = "a".repeat(43);
    const malformed: readonly [string, string][] = [
      ["the id of the scenario", "not-base64url!"],
      ["too short", "short"],
      ["one character short", "a".repeat(42)],
      ["one character long", "a".repeat(44)],
      ["much too long", "a".repeat(5000)],
      ["with padding", `${"a".repeat(42)}=`],
      ["with a plus", `${"a".repeat(42)}+`],
      ["standard base64's slash, encoded", `${"a".repeat(42)}%2F`],
      ["with an encoded space", `${"a".repeat(42)}%20`],
      ["with an encoded newline after 43 characters", `${aaa}%0A`],
      ["with an encoded NUL", `${"a".repeat(42)}%00`],
      ["with a non-ASCII letter", `${"a".repeat(42)}%C3%A9`],
      ["with a dot", `${"a".repeat(42)}.`],
      ["a path traversal", "..%2F..%2Faccount"],
      ["an encoded percent sign", `${"a".repeat(42)}%25`],
      ["broken percent-encoding", "%E0%A4%A"],
      ["an empty id", ""],
      ["an id with a slash inside", `${"a".repeat(20)}/${"a".repeat(22)}`],
    ];

    it.each(malformed)("answers 404 and never asks the store: %s", async (_name, segment) => {
      const h = await harness();
      const lookup = vi.spyOn(h.store, "session");
      const touch = vi.spyOn(h.store, "touchSession");
      const response = await h.request(`/sessions/${segment}`);
      expect(response.status).toBe(404);
      expect(lookup).not.toHaveBeenCalled();
      expect(touch).not.toHaveBeenCalled();
    });

    it("answers the ones the route sees with an empty no-store 404", async () => {
      const h = await harness();
      for (const segment of ["not-base64url!", "a".repeat(44), `${"a".repeat(42)}%2F`]) {
        const response = await h.request(`/sessions/${segment}`);
        expect(response.status).toBe(404);
        expect(await response.text()).toBe("");
        expect(response.headers.get("Cache-Control")).toBe("no-store");
      }
    });

    it("logs nothing beyond the platform's defaults", async () => {
      const h = await harness();
      const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation(() => {}),
      );
      await h.request("/sessions/not-base64url!");
      await h.request(`/sessions/${"A".repeat(43)}`);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    });
  });

  it("knows no other method: a POST to the session path is a 404", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const response = await h.request(`/sessions/${person.session.sid}`, { method: "POST" });
    expect(response.status).toBe(404);
    expect((await h.store.session(person.session.sid))?.lastSeen).toBe(person.session.lastSeen);
  });

  it("is what an account action's effect looks like to a product: revoke-others turns the others to 404", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const phone = await anotherSession(h, person, FIREFOX_ON_ANDROID);
    const response = await formPost(h, "/account/sessions/revoke-others", { as: phone });
    expect(response.status).toBe(303);
    expect((await h.request(`/sessions/${person.session.sid}`)).status).toBe(404);
    expect((await h.request(`/sessions/${phone.session.sid}`)).status).toBe(204);
  });
});

describe("the label of a session", () => {
  it("is a coarse family, and the User-Agent appears nowhere in the store", async () => {
    const h = await harness();
    const long = `${EDGE_ON_WINDOWS} SecretDeviceId/9f8e7d6c5b4a-very-long-unique-identifier (Build/ABC123; serial 0123456789)`;
    const person = await signedInPerson(h, { userAgent: long });

    const stored = await h.store.session(person.session.sid);
    expect(stored?.label).toBe("Edge on Windows");

    const everything = JSON.stringify([
      await h.store.userById(person.user.id),
      await h.store.identitiesOf(person.user.id),
      await h.store.session(person.session.sid),
      await h.store.sessionsOf(person.user.id, h.clock.now().toISOString()),
      await h.store.dueEvents("2999-01-01T00:00:00.000Z", 100),
    ]);
    for (const piece of [
      "Mozilla",
      "AppleWebKit",
      "SecretDeviceId",
      "0123456789",
      "Build/ABC123",
    ]) {
      expect(everything).not.toContain(piece);
    }
    // Nor does the token the browser keeps carry it.
    expect(person.token).not.toContain("Mozilla");
    expect(atob(person.token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))).not.toContain(
      "SecretDeviceId",
    );
  });

  it.each([
    ["Edge on Windows", EDGE_ON_WINDOWS],
    ["Firefox on Android", FIREFOX_ON_ANDROID],
    ["Safari on iOS", SAFARI_ON_IOS],
    [
      "Chrome on Linux",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    ],
    [
      "Safari on macOS",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    ],
    ["Other browser on Other system", "curl/8.5.0"],
  ])("is %s for the matching User-Agent", async (label, userAgent) => {
    const h = await harness();
    const person = await signedInPerson(h, { userAgent });
    expect((await h.store.session(person.session.sid))?.label).toBe(label);
  });

  it("is one of the families whatever the User-Agent says, even a hostile one", async () => {
    const h = await harness();
    const family =
      /^(Edge|Chrome|Firefox|Safari|Other browser) on (Windows|macOS|Linux|Android|iOS|Other system)$/;
    for (const [i, userAgent] of [
      "",
      "<script>alert(1)</script>",
      "x".repeat(10_000),
      "Mozilla/5.0 \t Chrome/1 Windows",
    ].entries()) {
      const person = await signedInPerson(h, { id: `user-ua-${i}`, userAgent });
      const label = (await h.store.session(person.session.sid))?.label ?? "";
      expect(label).toMatch(family);
    }
  });
});
