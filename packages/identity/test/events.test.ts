import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readConfig } from "../src/config.js";
import { hmacHex } from "../src/crypto.js";
import type { Env } from "../src/env.js";
import { buildDeletionEvents, deliverDueEvents, nextAttemptDelayMs } from "../src/events.js";
import { scheduled } from "../src/handler.js";
import type { IdentityStore } from "../src/store/types.js";
import type { OutboxEvent, Session } from "../src/types.js";
import { verifyEventSignature } from "../src/verify.js";
import { harness, memoryStore, type Harness, type StubCall } from "./support/index.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The harness's product, `diagrams`, and the secret the harness gives it. */
const EVENTS_URL = "https://diagrams.meltemi.dev/_identity/events";
const SECRET = "test-events-secret";
/** A time after every event's `nextAt`: `dueEvents` with it lists every event still pending. */
const FOREVER = "9999-12-31T00:00:00.000Z";

const iso = (ms: number): string => new Date(ms).toISOString();

// ---------------------------------------------------------------------------------------------
// What the tests use to look at the outbox. The store only lists events that are neither
// delivered nor failed, so a ledger of the outcomes the service recorded covers the rest: every
// outcome is one attempt (the store counts it).

type Outcome =
  | { readonly id: string; readonly kind: "delivered"; readonly at: string }
  | { readonly id: string; readonly kind: "retry"; readonly nextAt: string }
  | { readonly id: string; readonly kind: "failed"; readonly failedAt: string };

function watchedStore(): { store: IdentityStore; outcomes: Outcome[] } {
  const inner = memoryStore();
  const outcomes: Outcome[] = [];
  const store: IdentityStore = {
    ...inner,
    async markDelivered(id, at) {
      outcomes.push({ id, kind: "delivered", at });
      await inner.markDelivered(id, at);
    },
    async recordFailure(id, outcome) {
      outcomes.push(
        "nextAt" in outcome
          ? { id, kind: "retry", nextAt: outcome.nextAt }
          : { id, kind: "failed", failedAt: outcome.failedAt },
      );
      await inner.recordFailure(id, outcome);
    },
  };
  return { store, outcomes };
}

async function setup(env: Partial<Env> = {}) {
  const { store, outcomes } = watchedStore();
  const h = await harness({ store, env });
  return { h, outcomes };
}

const attemptsOf = (outcomes: readonly Outcome[], id: string): number =>
  outcomes.filter((outcome) => outcome.id === id).length;

/** The address of a product's events in the tests: `diagrams` is the harness's own. */
const eventsUrl = (name: string): string => `https://${name}.meltemi.dev/_identity/events`;

/** The environment of several products, each with the secret `<name>-secret`. */
function productsEnv(names: readonly string[]): Partial<Env> {
  const env: Record<string, string> = {
    PRODUCTS: JSON.stringify(names.map((name) => ({ name, events: eventsUrl(name) }))),
  };
  for (const name of names) env[`EVENTS_SECRET_${name.toUpperCase()}`] = `${name}-secret`;
  return env as Partial<Env>;
}

/**
 * Makes a product answer: one status for every request, or one per request in order (the last
 * repeats). Records the requests and the fake time each one arrived.
 */
function answer(h: Harness, answers: number | readonly number[], name = "diagrams") {
  const calls: StubCall[] = [];
  const times: string[] = [];
  h.stub.products.set(eventsUrl(name), (call) => {
    calls.push(call);
    times.push(h.clock.now().toISOString());
    if (typeof answers === "number") return answers;
    return answers[calls.length - 1] ?? answers[answers.length - 1]!;
  });
  return { calls, times };
}

/** The events of a deletion, as `deleteUser` is given them. */
const build = (h: Harness, userId = "user-1") =>
  buildDeletionEvents(readConfig(h.env), h.deps, userId);
/** Queues the events of a deletion, as `deleteUser` does in the same step as the deletion. */
const enqueue = (h: Harness, userId = "user-1") => h.store.enqueueEvents(build(h, userId));
const deliver = (h: Harness, env: Env = h.env) => deliverDueEvents(env, readConfig(env), h.deps);
/** Every event neither delivered nor failed, whenever it is due. */
const pending = (h: Harness) => h.store.dueEvents(FOREVER, 1000);
/** The events due now. */
const due = (h: Harness) => h.store.dueEvents(h.clock.now().toISOString(), 1000);

function only<T>(list: readonly T[]): T {
  expect(list).toHaveLength(1);
  return list[0]!;
}

const spyOnError = () => vi.spyOn(console, "error").mockImplementation(() => {});
let errors: ReturnType<typeof spyOnError>;
/** The lines `console.error` received, each joined into one text. */
const logged = (): string[] => errors.mock.calls.map((args) => args.map(String).join(" "));

beforeEach(() => {
  errors = spyOnError();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------------------------

describe("nextAttemptDelayMs", () => {
  it.each([
    [1, MINUTE],
    [2, 5 * MINUTE],
    [3, 30 * MINUTE],
    [4, 2 * HOUR],
    [5, 6 * HOUR],
    [6, 6 * HOUR],
    [12, 6 * HOUR],
    [1000, 6 * HOUR],
  ])("after %i attempts the wait is %i ms", (attempts, delay) => {
    expect(nextAttemptDelayMs(attempts)).toBe(delay);
  });

  it("treats a count that is not a positive number as the first attempt", () => {
    expect(nextAttemptDelayMs(0)).toBe(MINUTE);
    expect(nextAttemptDelayMs(-3)).toBe(MINUTE);
    expect(nextAttemptDelayMs(Number.NaN)).toBe(MINUTE);
  });

  it("never waits less after more attempts", () => {
    for (let attempts = 1; attempts < 60; attempts++) {
      expect(nextAttemptDelayMs(attempts + 1)).toBeGreaterThanOrEqual(nextAttemptDelayMs(attempts));
    }
  });
});

describe("buildDeletionEvents", () => {
  it("builds one event per product, with the exact body, due at once", async () => {
    const h = await harness({ env: productsEnv(["diagrams", "docs"]) });
    const events = build(h, "user-1").sort((a, b) => a.product.localeCompare(b.product));
    expect(events.map((event) => event.product)).toEqual(["diagrams", "docs"]);
    const at = "2026-10-14T12:00:00.000Z";
    for (const event of events) {
      expect(event.id).toMatch(/^evt_[A-Za-z0-9_-]{22}$/);
      expect(event.body).toBe(
        `{"id":"${event.id}","type":"user.deleted","sub":"user-1","at":"${at}"}`,
      );
      expect(event).toEqual({
        id: event.id,
        product: event.product,
        body: event.body,
        createdAt: at,
        attempts: 0,
        nextAt: at,
        deliveredAt: null,
        failedAt: null,
      } satisfies OutboxEvent);
    }
    expect(events[0]!.id).not.toBe(events[1]!.id);
  });

  it("only builds them: nothing is queued until the store is given the events", async () => {
    const h = await harness();
    const touched = vi.spyOn(h.store, "enqueueEvents");
    const events = build(h);
    expect(events).toHaveLength(1);
    expect(touched).not.toHaveBeenCalled();
    expect(await pending(h)).toEqual([]);
    // Handed to the store, they are what the delivery sends.
    await h.store.enqueueEvents(events);
    expect(await pending(h)).toEqual(events);
  });

  it("takes the time from the clock", async () => {
    const h = await harness();
    h.clock.set("2027-03-01T08:30:15.250Z");
    const event = only(build(h, "user-2"));
    expect(event.createdAt).toBe("2027-03-01T08:30:15.250Z");
    expect(event.nextAt).toBe("2027-03-01T08:30:15.250Z");
    expect(JSON.parse(event.body)).toEqual({
      id: event.id,
      type: "user.deleted",
      sub: "user-2",
      at: "2027-03-01T08:30:15.250Z",
    });
  });

  it("gives every call its own ids", async () => {
    const h = await harness();
    const events = [...build(h, "user-1"), ...build(h, "user-1")];
    expect(events).toHaveLength(2);
    expect(events[0]!.id).not.toBe(events[1]!.id);
  });

  it("writes JSON whatever the user id holds", async () => {
    const h = await harness();
    const event = only(build(h, 'a"b\\c\n'));
    expect(JSON.parse(event.body).sub).toBe('a"b\\c\n');
  });

  it("builds nothing, and does not throw, for an empty list of products", async () => {
    const h = await harness({ env: { PRODUCTS: "[]" } });
    expect(build(h)).toEqual([]);
    // A deletion with no events is still a deletion; there is nothing for the delivery to send.
    await h.store.deleteUser("user-1", build(h));
    expect(await pending(h)).toEqual([]);
    await deliver(h);
    expect(h.stub.calls).toEqual([]);
  });
});

describe("deliverDueEvents: a delivery", () => {
  it("posts the signed event once, and the product can verify it", async () => {
    const { h, outcomes } = await setup();
    const product = answer(h, 200);
    await enqueue(h);
    const event = only(await pending(h));

    await deliver(h);

    const call = only(product.calls);
    expect(call.method).toBe("POST");
    expect(call.url).toBe(EVENTS_URL);
    expect(call.headers.get("Content-Type")).toBe("application/json");
    expect(call.headers.get("Meltemi-Event-Id")).toBe(event.id);
    expect(call.headers.get("Meltemi-Signature")).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(call.body).toBe(event.body);
    expect(
      await verifyEventSignature(SECRET, call.body, call.headers.get("Meltemi-Signature")),
    ).toBe(true);
    expect(JSON.parse(call.body)).toMatchObject({ id: event.id, type: "user.deleted" });

    // Marked delivered, by one attempt, at the time of the delivery; no longer due.
    expect(outcomes).toEqual([
      { id: event.id, kind: "delivered", at: h.clock.now().toISOString() },
    ]);
    expect(attemptsOf(outcomes, event.id)).toBe(1);
    expect(await pending(h)).toEqual([]);
    expect(errors).not.toHaveBeenCalled();

    // And never again.
    h.clock.advance(30 * DAY);
    await deliver(h);
    expect(product.calls).toHaveLength(1);
  });

  it("is rejected by the verifier when the signature was made with another secret", async () => {
    const { h } = await setup();
    const product = answer(h, 200);
    await enqueue(h);
    await deliver(h);
    const { body, headers } = only(product.calls);
    const signature = headers.get("Meltemi-Signature");

    expect(await verifyEventSignature("another-secret", body, signature)).toBe(false);
    expect(await verifyEventSignature(SECRET, `${body} `, signature)).toBe(false);
    const forged = `v1=${await hmacHex("another-secret", body)}`;
    expect(await verifyEventSignature(SECRET, body, forged)).toBe(false);
    expect(await verifyEventSignature(SECRET, body, null)).toBe(false);
    expect(await verifyEventSignature(SECRET, body, signature?.replace("v1=", "v2=") ?? null)).toBe(
      false,
    );
  });

  it("signs each product's event with that product's own secret", async () => {
    const { h, outcomes } = await setup(productsEnv(["diagrams", "docs"]));
    const diagrams = answer(h, 200, "diagrams");
    const docs = answer(h, 200, "docs");
    await enqueue(h);

    await deliver(h);

    const forDiagrams = only(diagrams.calls);
    const forDocs = only(docs.calls);
    expect(forDiagrams.headers.get("Meltemi-Event-Id")).not.toBe(
      forDocs.headers.get("Meltemi-Event-Id"),
    );
    const signedWith = (secret: string, call: StubCall) =>
      verifyEventSignature(secret, call.body, call.headers.get("Meltemi-Signature"));
    expect(await signedWith("diagrams-secret", forDiagrams)).toBe(true);
    expect(await signedWith("docs-secret", forDiagrams)).toBe(false);
    expect(await signedWith("docs-secret", forDocs)).toBe(true);
    expect(await signedWith("diagrams-secret", forDocs)).toBe(false);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["delivered", "delivered"]);
  });

  it("does nothing when no event is due", async () => {
    const { h, outcomes } = await setup();
    await deliver(h);
    expect(h.stub.calls).toEqual([]);
    expect(outcomes).toEqual([]);
  });

  it("leaves an event alone until its time", async () => {
    const { h } = await setup();
    const product = answer(h, 200);
    const later = iso(h.clock.now().getTime() + HOUR);
    await h.store.enqueueEvents([
      {
        id: "evt_later",
        product: "diagrams",
        body: "{}",
        createdAt: h.clock.now().toISOString(),
        attempts: 1,
        nextAt: later,
        deliveredAt: null,
        failedAt: null,
      },
    ]);
    await deliver(h);
    expect(product.calls).toEqual([]);
    h.clock.set(later);
    await deliver(h);
    expect(product.calls).toHaveLength(1);
  });

  it.each([200, 201, 202, 204, 299])("counts a %i answer as delivered", async (status) => {
    const { h, outcomes } = await setup();
    answer(h, status);
    await enqueue(h);
    await deliver(h);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["delivered"]);
    expect(await pending(h)).toEqual([]);
  });

  it.each([300, 301, 302, 307, 400, 401, 404, 410, 429, 500, 502, 503])(
    "counts a %i answer as a failure and schedules a retry",
    async (status) => {
      const { h, outcomes } = await setup();
      answer(h, status);
      await enqueue(h);
      await deliver(h);
      const row = only(await pending(h));
      expect(row.attempts).toBe(1);
      expect(row.nextAt).toBe(iso(h.clock.now().getTime() + MINUTE));
      expect(outcomes.map((outcome) => outcome.kind)).toEqual(["retry"]);
      expect(errors).not.toHaveBeenCalled();
    },
  );

  it("does not follow a redirect and does not wait for ever", async () => {
    const { h } = await setup();
    await enqueue(h);
    const inits: (RequestInit | undefined)[] = [];
    const recording: typeof fetch = async (_input, init) => {
      inits.push(init);
      return new Response(null, { status: 204 });
    };
    await deliverDueEvents(h.env, readConfig(h.env), { ...h.deps, fetch: recording });
    const init = only(inits);
    // A redirected POST becomes a GET that may answer 200 without the product seeing the event.
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.method).toBe("POST");
  });

  it("releases the answer's body without reading it", async () => {
    const { h, outcomes } = await setup();
    await enqueue(h);
    let cancelled = false;
    const chatty: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200 },
      );
    await deliverDueEvents(h.env, readConfig(h.env), { ...h.deps, fetch: chatty });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelled).toBe(true);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["delivered"]);
  });
});

describe("deliverDueEvents: when the product is down", () => {
  it("retries after one minute, and the second attempt delivers", async () => {
    const { h, outcomes } = await setup();
    const product = answer(h, [503, 200]);
    await enqueue(h);
    const event = only(await pending(h));
    const first = h.clock.now().getTime();

    await deliver(h);
    expect(product.calls).toHaveLength(1);
    const retry = only(await pending(h));
    expect(retry).toMatchObject({ id: event.id, attempts: 1, nextAt: iso(first + MINUTE) });
    expect(await due(h)).toEqual([]);

    // Not before the minute has passed.
    h.clock.advance(MINUTE - 1);
    expect(await due(h)).toEqual([]);
    await deliver(h);
    expect(product.calls).toHaveLength(1);

    h.clock.advance(1);
    expect(only(await due(h)).id).toBe(event.id);
    await deliver(h);

    expect(product.calls).toHaveLength(2);
    expect(Date.parse(product.times[1]!) - Date.parse(product.times[0]!)).toBe(MINUTE);
    // The retry is the same event, signed again.
    expect(product.calls[1]!.headers.get("Meltemi-Event-Id")).toBe(event.id);
    expect(product.calls[1]!.body).toBe(event.body);
    expect(
      await verifyEventSignature(
        SECRET,
        product.calls[1]!.body,
        product.calls[1]!.headers.get("Meltemi-Signature"),
      ),
    ).toBe(true);
    expect(outcomes).toEqual([
      { id: event.id, kind: "retry", nextAt: iso(first + MINUTE) },
      { id: event.id, kind: "delivered", at: iso(first + MINUTE) },
    ]);
    expect(attemptsOf(outcomes, event.id)).toBe(2);
    expect(await pending(h)).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("retries after a network error without logging anything", async () => {
    const { h, outcomes } = await setup();
    h.stub.products.set(EVENTS_URL, () => {
      throw new TypeError("fetch failed: connect ECONNREFUSED");
    });
    await enqueue(h);

    await expect(deliver(h)).resolves.toBeUndefined();

    const row = only(await pending(h));
    expect(row.attempts).toBe(1);
    expect(row.nextAt).toBe(iso(h.clock.now().getTime() + MINUTE));
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["retry"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("retries when the injected fetch throws before returning a promise", async () => {
    const { h } = await setup();
    await enqueue(h);
    const broken: typeof fetch = () => {
      throw new Error("no network");
    };
    await deliverDueEvents(h.env, readConfig(h.env), { ...h.deps, fetch: broken });
    expect(only(await pending(h)).attempts).toBe(1);
  });

  it("walks the whole schedule: 1 min, 5 min, 30 min, 2 h, then every 6 h", async () => {
    const { h } = await setup();
    const product = answer(h, 503);
    await enqueue(h);
    const schedule = [MINUTE, 5 * MINUTE, 30 * MINUTE, 2 * HOUR, 6 * HOUR, 6 * HOUR, 6 * HOUR];
    let attemptAt = h.clock.now().getTime();

    for (const [index, delay] of schedule.entries()) {
      await deliver(h);
      expect(product.calls).toHaveLength(index + 1);
      const row = only(await pending(h));
      expect(row.attempts).toBe(index + 1);
      expect(row.nextAt).toBe(iso(attemptAt + delay));

      // Nothing happens a millisecond early; the event is due at its time.
      h.clock.set(iso(attemptAt + delay - 1));
      expect(await due(h)).toEqual([]);
      await deliver(h);
      expect(product.calls).toHaveLength(index + 1);
      h.clock.set(iso(attemptAt + delay));
      expect(only(await due(h)).id).toBe(row.id);
      attemptAt += delay;
    }
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("deliverDueEvents: giving up after seven days", () => {
  /** The wait after each failed attempt of the spec: 1 min, 5 min, 30 min, 2 h, then 6 h. */
  const delayAfter = (attempts: number) =>
    [MINUTE, 5 * MINUTE, 30 * MINUTE, 2 * HOUR][attempts - 1] ?? 6 * HOUR;

  it("marks the event failed at the first failure seven days after creation, and stops", async () => {
    // The schedule ends at seven days: the attempt after the last one that fits is made then.
    const { h, outcomes } = await setup();
    const product = answer(h, 503);
    await enqueue(h);
    const event = only(await pending(h));
    const created = h.clock.now().getTime();

    let elapsed = 0;
    let previous = 0;
    let attempts = 0;
    for (;;) {
      await deliver(h);
      attempts += 1;
      expect(product.calls).toHaveLength(attempts);
      if ((await pending(h)).length === 0) break;
      expect(attempts).toBeLessThan(100);
      // Still pending: the event was under seven days old when this attempt failed.
      expect(elapsed).toBeLessThan(7 * DAY);
      const row = only(await pending(h));
      const next = Math.min(elapsed + delayAfter(attempts), 7 * DAY);
      expect(row.nextAt).toBe(iso(created + next));
      previous = elapsed;
      elapsed = next;
      h.clock.set(iso(created + elapsed));
    }

    // The attempt before was under seven days, this one is at seven days exactly: it gave up.
    expect(previous).toBeLessThan(7 * DAY);
    expect(elapsed).toBe(7 * DAY);
    // 4 attempts in the first 2.6 hours, then one every 6 hours, then the one at seven days.
    expect(attempts).toBe(33);
    const mine = outcomes.filter((outcome) => outcome.id === event.id);
    expect(mine.slice(0, -1).every((outcome) => outcome.kind === "retry")).toBe(true);
    expect(mine.at(-1)).toEqual({
      id: event.id,
      kind: "failed",
      failedAt: iso(created + elapsed),
    });

    // One error line, naming the event and the product, holding nothing about the person.
    const lines = logged();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(event.id);
    expect(lines[0]).toContain("diagrams");
    expect(lines[0]).not.toContain("user-1");
    expect(lines[0]).not.toContain("user.deleted");
    expect(lines[0]).not.toContain(SECRET);

    // No longer due, and no further attempt however long it waits.
    expect(await due(h)).toEqual([]);
    h.clock.advance(60 * DAY);
    expect(await due(h)).toEqual([]);
    await deliver(h);
    expect(product.calls).toHaveLength(attempts);
    expect(logged()).toHaveLength(1);
  });

  it("still retries one millisecond before the seven days are over, once more, at the seven days", async () => {
    const { h, outcomes } = await setup();
    const product = answer(h, 503);
    await enqueue(h);
    const created = h.clock.now().getTime();
    h.clock.advance(7 * DAY - 1);
    await deliver(h);
    const row = only(await pending(h));
    expect(row.attempts).toBe(1);
    // A minute would fall past the seventh day: the last attempt is made at the seventh day.
    expect(row.nextAt).toBe(iso(created + 7 * DAY));
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["retry"]);
    expect(errors).not.toHaveBeenCalled();

    h.clock.advance(1);
    await deliver(h);
    expect(product.calls).toHaveLength(2);
    expect(await pending(h)).toEqual([]);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["retry", "failed"]);
    expect(only(logged())).toContain(row.id);
  });

  it("is failed by a run at the seventh day however far its next attempt was meant to be", async () => {
    // Twelve attempts so far: the next one is six hours away, which is past the seventh day.
    const { h, outcomes } = await setup();
    const product = answer(h, 503);
    const created = h.clock.now().getTime();
    await h.store.enqueueEvents([
      {
        id: "evt_late",
        product: "diagrams",
        body: "{}",
        createdAt: iso(created),
        attempts: 12,
        nextAt: iso(created + 7 * DAY - 2 * HOUR),
        deliveredAt: null,
        failedAt: null,
      },
    ]);
    h.clock.set(iso(created + 7 * DAY - 2 * HOUR));
    await deliver(h);
    expect(product.calls).toHaveLength(1);
    expect(only(await pending(h)).nextAt).toBe(iso(created + 7 * DAY));

    // Nothing is due before the seventh day, and a run at it is the last attempt and the failure.
    h.clock.set(iso(created + 7 * DAY - 1));
    expect(await due(h)).toEqual([]);
    h.clock.set(iso(created + 7 * DAY));
    await deliver(h);
    expect(product.calls).toHaveLength(2);
    expect(outcomes.at(-1)).toEqual({
      id: "evt_late",
      kind: "failed",
      failedAt: iso(created + 7 * DAY),
    });
    expect(await pending(h)).toEqual([]);
    expect(only(logged())).toContain("evt_late");
  });

  it("gives up when the failure comes exactly seven days after creation", async () => {
    const { h, outcomes } = await setup();
    const product = answer(h, 503);
    await enqueue(h);
    const event = only(await pending(h));
    h.clock.advance(7 * DAY);
    await deliver(h);
    expect(await pending(h)).toEqual([]);
    expect(outcomes).toEqual([
      { id: event.id, kind: "failed", failedAt: h.clock.now().toISOString() },
    ]);
    expect(only(logged())).toContain(event.id);
    expect(product.calls).toHaveLength(1);
  });

  it("gives up at once on a row whose creation time cannot be read, instead of retrying for ever", async () => {
    const { h, outcomes } = await setup();
    const product = answer(h, 503);
    await h.store.enqueueEvents([
      {
        id: "evt_corrupt",
        product: "diagrams",
        body: "{}",
        createdAt: "not a time",
        attempts: 0,
        nextAt: h.clock.now().toISOString(),
        deliveredAt: null,
        failedAt: null,
      },
    ]);
    await deliver(h);
    expect(product.calls).toHaveLength(1);
    expect(await pending(h)).toEqual([]);
    expect(outcomes).toEqual([
      { id: "evt_corrupt", kind: "failed", failedAt: h.clock.now().toISOString() },
    ]);
    expect(only(logged())).toContain("evt_corrupt");
  });

  it("still delivers a late event when the product finally answers", async () => {
    const { h, outcomes } = await setup();
    answer(h, 200);
    await enqueue(h);
    h.clock.advance(9 * DAY);
    await deliver(h);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["delivered"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("makes no more than the schedule's attempts under the scheduler's fifteen-minute ticks", async () => {
    const { h, outcomes } = await setup();
    const product = answer(h, 503);
    await enqueue(h);
    const event = only(await pending(h));

    // Eight days of ticks; the schedule is only as fine as the ticks are.
    for (let tick = 0; tick < 8 * 96; tick++) {
      await deliver(h);
      h.clock.advance(15 * MINUTE);
    }

    expect(await pending(h)).toEqual([]);
    expect(outcomes.at(-1)).toMatchObject({ id: event.id, kind: "failed" });
    // Attempts at 0, 15, 30 and 60 minutes, then at 3 hours and every 6 hours after, then the
    // last one at seven days.
    expect(product.calls).toHaveLength(33);
    expect(logged()).toHaveLength(1);
  });
});

describe("deliverDueEvents: the ten-second wait", () => {
  it("gives up on a product that does not answer within ten seconds", async () => {
    const { h, outcomes } = await setup();
    await enqueue(h);
    const event = only(await pending(h));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let started!: (signal: AbortSignal | undefined) => void;
    const requested = new Promise<AbortSignal | undefined>((resolve) => (started = resolve));
    // A fetch that honours its abort signal, as the platform's does.
    const silent: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        started(init?.signal ?? undefined);
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    let finished = false;
    const run = deliverDueEvents(h.env, readConfig(h.env), { ...h.deps, fetch: silent }).then(
      () => {
        finished = true;
      },
    );

    const signal = await requested;
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(finished).toBe(false);
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(finished).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(only(await pending(h))).toMatchObject({
      id: event.id,
      attempts: 1,
      nextAt: iso(h.clock.now().getTime() + MINUTE),
    });
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["retry"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("does not depend on the injected fetch honouring the abort signal", async () => {
    const { h } = await setup();
    await enqueue(h);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let started!: () => void;
    const requested = new Promise<void>((resolve) => (started = resolve));
    const deaf: typeof fetch = () => {
      started();
      return new Promise(() => {});
    };
    let finished = false;
    const run = deliverDueEvents(h.env, readConfig(h.env), { ...h.deps, fetch: deaf }).then(() => {
      finished = true;
    });

    await requested;
    await vi.advanceTimersByTimeAsync(9_999);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(only(await pending(h)).attempts).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timer when the product answers, and when the request fails", async () => {
    const { h, outcomes } = await setup(productsEnv(["diagrams", "docs"]));
    answer(h, 200, "diagrams");
    h.stub.products.set(eventsUrl("docs"), () => {
      throw new TypeError("fetch failed");
    });
    await enqueue(h);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    await deliver(h);

    expect(vi.getTimerCount()).toBe(0);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(["delivered", "retry"]);
  });
});

describe("deliverDueEvents: a run", () => {
  it("delivers at most 100 events: 150 queued, 100 then 50", async () => {
    const { h } = await setup();
    const product = answer(h, 200);
    for (let user = 0; user < 150; user++) await enqueue(h, `user-${user}`);

    await deliver(h);
    expect(product.calls).toHaveLength(100);
    expect(await due(h)).toHaveLength(50);

    await deliver(h);
    expect(product.calls).toHaveLength(150);
    expect(await due(h)).toEqual([]);
    expect(await pending(h)).toEqual([]);
    // Every event once.
    const ids = product.calls.map((call) => call.headers.get("Meltemi-Event-Id"));
    expect(new Set(ids).size).toBe(150);

    await deliver(h);
    expect(product.calls).toHaveLength(150);
  });

  it("runs a few deliveries at once, never more than five", async () => {
    const { h, outcomes } = await setup();
    let inFlight = 0;
    let peak = 0;
    h.stub.products.set(EVENTS_URL, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return 200;
    });
    for (let user = 0; user < 12; user++) await enqueue(h, `user-${user}`);

    await deliver(h);

    expect(outcomes).toHaveLength(12);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(5);
  });

  it("delivers to the product that answers when another one is down", async () => {
    const { h, outcomes } = await setup(productsEnv(["docs", "diagrams"]));
    const docs = answer(h, 503, "docs");
    const diagrams = answer(h, 200, "diagrams");
    await enqueue(h);
    const events = await pending(h);
    const byProduct = (name: string) => events.find((event) => event.product === name)!;

    await deliver(h);

    expect(docs.calls).toHaveLength(1);
    expect(diagrams.calls).toHaveLength(1);
    expect(outcomes).toEqual(
      expect.arrayContaining([
        { id: byProduct("diagrams").id, kind: "delivered", at: h.clock.now().toISOString() },
        {
          id: byProduct("docs").id,
          kind: "retry",
          nextAt: iso(h.clock.now().getTime() + MINUTE),
        },
      ]),
    );
    // Only the failing one is still pending, and only it is tried again.
    expect(only(await pending(h)).id).toBe(byProduct("docs").id);
    h.stub.products.set(eventsUrl("docs"), () => 200);
    h.clock.advance(MINUTE);
    await deliver(h);
    expect(await pending(h)).toEqual([]);
    expect(diagrams.calls).toHaveLength(1);
  });

  it("never lets failures hold back the events behind them, past the limit of concurrency", async () => {
    const names = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
    const { h, outcomes } = await setup(productsEnv(names));
    for (const name of names.slice(0, 6)) {
      h.stub.products.set(eventsUrl(name), () => {
        throw new TypeError("fetch failed");
      });
    }
    const p7 = answer(h, 200, "p7");
    const p8 = answer(h, 200, "p8");
    await enqueue(h);

    await deliver(h);

    expect(p7.calls).toHaveLength(1);
    expect(p8.calls).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind === "delivered")).toHaveLength(2);
    expect(outcomes.filter((outcome) => outcome.kind === "retry")).toHaveLength(6);
    expect((await pending(h)).map((event) => event.product).sort()).toEqual(names.slice(0, 6));
  });

  it("keeps going when the store cannot record one outcome", async () => {
    const { h } = await setup(productsEnv(["diagrams", "docs"]));
    const diagrams = answer(h, 200, "diagrams");
    const docs = answer(h, 200, "docs");
    await enqueue(h);
    const original = h.store.markDelivered.bind(h.store);
    let failed = false;
    h.store.markDelivered = async (id, at) => {
      if (!failed) {
        failed = true;
        throw new Error("the database is unreachable");
      }
      await original(id, at);
    };

    await expect(deliver(h)).resolves.toBeUndefined();

    expect(diagrams.calls).toHaveLength(1);
    expect(docs.calls).toHaveLength(1);
    // The event whose outcome was lost stays due (it goes out again; products keep the ids they
    // handled); the other one is done. The line names the event and the product only.
    const left = only(await pending(h));
    const line = only(logged());
    expect(line).toContain(left.id);
    expect(line).toContain(left.product);
    expect(line).not.toContain("user.deleted");
    expect(line).not.toContain("-secret");
  });
});

describe("deliverDueEvents: a product that cannot be reached by configuration", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])(
    "treats a %s secret as a failure and never sends the event unsigned",
    async (_kind, secret) => {
      const { h, outcomes } = await setup({ EVENTS_SECRET_DIAGRAMS: secret });
      const product = answer(h, 200);
      await enqueue(h);
      const event = only(await pending(h));

      await deliver(h);

      expect(product.calls).toEqual([]);
      expect(h.stub.calls).toEqual([]);
      expect(only(await pending(h))).toMatchObject({
        id: event.id,
        attempts: 1,
        nextAt: iso(h.clock.now().getTime() + MINUTE),
      });
      expect(outcomes.map((outcome) => outcome.kind)).toEqual(["retry"]);
      const line = only(logged());
      expect(line).toContain(event.id);
      expect(line).toContain("diagrams");
      expect(line).not.toContain("user-1");
      expect(line).not.toContain("test-state-secret");

      // The operator sets the secret within the seven days: the event goes out, signed.
      const repaired: Env = { ...h.env, EVENTS_SECRET_DIAGRAMS: SECRET };
      h.clock.advance(MINUTE);
      await deliver(h, repaired);
      const call = only(product.calls);
      expect(
        await verifyEventSignature(SECRET, call.body, call.headers.get("Meltemi-Signature")),
      ).toBe(true);
      expect(outcomes.map((outcome) => outcome.kind)).toEqual(["retry", "delivered"]);
      expect(logged()).toHaveLength(1);
    },
  );

  it("treats an event of a product that is no longer configured as a failure, and never names its secret", async () => {
    const { h, outcomes } = await setup({ EVENTS_SECRET_RETIRED: "the-retired-secret-value" });
    const created = h.clock.now().toISOString();
    await h.store.enqueueEvents([
      {
        id: "evt_retired",
        product: "retired",
        body: `{"id":"evt_retired","type":"user.deleted","sub":"user-9","at":"${created}"}`,
        createdAt: created,
        attempts: 0,
        nextAt: created,
        deliveredAt: null,
        failedAt: null,
      },
    ]);

    await deliver(h);

    expect(h.stub.calls).toEqual([]);
    expect(only(await pending(h))).toMatchObject({ id: "evt_retired", attempts: 1 });
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["retry"]);
    const line = only(logged());
    expect(line).toContain("evt_retired");
    expect(line).toContain("retired");
    expect(line).not.toContain("the-retired-secret-value");
    expect(line).not.toContain("user-9");

    // Like any other event, it is given up after seven days.
    h.clock.advance(7 * DAY);
    await deliver(h);
    expect(await pending(h)).toEqual([]);
    expect(outcomes.at(-1)).toMatchObject({ id: "evt_retired", kind: "failed" });
    const everything = logged().join("\n");
    expect(everything).toContain("gave up");
    expect(everything).not.toContain("the-retired-secret-value");
    expect(h.stub.calls).toEqual([]);
  });
});

describe("the scheduled run", () => {
  const session = (sid: string, now: number, overrides: Partial<Session> = {}): Session => ({
    sid,
    userId: "user-1",
    createdAt: iso(now - 40 * DAY),
    lastSeen: iso(now - 40 * DAY),
    expiresAt: iso(now + 20 * DAY),
    label: "Edge on Windows",
    revokedAt: null,
    ...overrides,
  });

  it("delivers the due events and removes the sessions that ended over seven days ago", async () => {
    const { h, outcomes } = await setup();
    const product = answer(h, 200);
    await enqueue(h);
    const event = only(await pending(h));
    const now = h.clock.now().getTime();
    const deleteBefore = vi.spyOn(h.store, "deleteSessionsBefore");
    for (const stored of [
      session("expired-long-ago", now, { expiresAt: iso(now - 8 * DAY) }),
      session("expired-recently", now, { expiresAt: iso(now - 6 * DAY) }),
      session("revoked-long-ago", now, { revokedAt: iso(now - 8 * DAY) }),
      session("revoked-recently", now, { revokedAt: iso(now - 1 * DAY) }),
      session("live", now),
    ]) {
      await h.store.createSession(stored);
    }

    await scheduled(h.env, h.deps);

    const call = only(product.calls);
    expect(call.headers.get("Meltemi-Event-Id")).toBe(event.id);
    expect(outcomes).toEqual([{ id: event.id, kind: "delivered", at: iso(now) }]);
    expect(deleteBefore).toHaveBeenCalledExactlyOnceWith(iso(now - 7 * DAY));
    const kept = async (sid: string) => (await h.store.session(sid)) !== undefined;
    expect(await kept("expired-long-ago")).toBe(false);
    expect(await kept("revoked-long-ago")).toBe(false);
    expect(await kept("expired-recently")).toBe(true);
    expect(await kept("revoked-recently")).toBe(true);
    expect(await kept("live")).toBe(true);
  });

  it("tidies the sessions even when a product is down, and tries the event again later", async () => {
    const { h, outcomes } = await setup();
    const product = answer(h, [503, 200]);
    await enqueue(h);
    const now = h.clock.now().getTime();
    await h.store.createSession(session("old", now, { expiresAt: iso(now - 8 * DAY) }));

    await expect(scheduled(h.env, h.deps)).resolves.toBeUndefined();

    expect(await h.store.session("old")).toBeUndefined();
    expect(only(await pending(h)).attempts).toBe(1);
    // The next run, fifteen minutes later, delivers it.
    h.clock.advance(15 * MINUTE);
    await scheduled(h.env, h.deps);
    expect(product.calls).toHaveLength(2);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["retry", "delivered"]);
    expect(await pending(h)).toEqual([]);
  });

  it("has nothing to do on an empty service", async () => {
    const { h } = await setup();
    await expect(scheduled(h.env, h.deps)).resolves.toBeUndefined();
    expect(h.stub.calls).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });
});
