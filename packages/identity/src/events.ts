// The outbox of deletion events: when an account is deleted every product is told, by a signed
// POST that is retried until the product answers 2xx or seven days have passed. Delivery is at
// least once, so a product keeps the ids of the events it handled (`verifyEventSignature` in
// `verify.ts` is the product's half).

import type { Config } from "./config.js";
import { hmacHex, randomToken } from "./crypto.js";
import type { Env } from "./env.js";
import type { Deps, OutboxEvent } from "./types.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** An event that has not reached its product this long after its creation is given up. */
const GIVE_UP_AFTER_MS = 7 * DAY_MS;
/** How long a product has to answer one delivery. */
const DELIVERY_TIMEOUT_MS = 10_000;
/** The most events one scheduled run delivers; the rest wait for the next run. */
const MAX_EVENTS_PER_RUN = 100;
/** How many deliveries are in flight at once. */
const CONCURRENCY = 5;
/** The random part of an event id, in bytes before encoding. */
const EVENT_ID_BYTES = 16;

/** The wait after the first, second, third and fourth failed attempt. */
const RETRY_DELAYS_MS = [1 * MINUTE_MS, 5 * MINUTE_MS, 30 * MINUTE_MS, 2 * HOUR_MS] as const;
/** The wait after the fifth failed attempt and every one after it. */
const LAST_RETRY_DELAY_MS = 6 * HOUR_MS;

/**
 * How long to wait before the next attempt, given the number of attempts already made including
 * the one that just failed: 1 minute, 5 minutes, 30 minutes, 2 hours, then 6 hours every time.
 */
export function nextAttemptDelayMs(attempts: number): number {
  if (!(attempts > 1)) return RETRY_DELAYS_MS[0];
  return RETRY_DELAYS_MS[Math.floor(attempts) - 1] ?? LAST_RETRY_DELAY_MS;
}

/**
 * One `user.deleted` event per product for a user who is being deleted, all due at once; none when
 * the service has no products. Nothing is stored here: the caller hands the events to
 * `store.deleteUser`, which queues them in the outbox in the same atomic step as the deletion, so
 * they survive a restart and `deliverDueEvents` sends them, and an account is never deleted
 * without its products being told, nor are they told about an account that still exists.
 */
export function buildDeletionEvents(config: Config, deps: Deps, userId: string): OutboxEvent[] {
  const at = deps.now().toISOString();
  return config.products.map((product) => {
    const id = `evt_${randomToken(deps.randomBytes, EVENT_ID_BYTES)}`;
    return {
      id,
      product: product.name,
      body: JSON.stringify({ id, type: "user.deleted", sub: userId, at }),
      createdAt: at,
      attempts: 0,
      nextAt: at,
      deliveredAt: null,
      failedAt: null,
    };
  });
}

/**
 * Delivers the events that are due, at most 100, a few at a time. One event failing, in any way,
 * never stops the others. Called by the scheduled handler every fifteen minutes.
 */
export async function deliverDueEvents(env: Env, config: Config, deps: Deps): Promise<void> {
  const due = await deps.store.dueEvents(deps.now().toISOString(), MAX_EVENTS_PER_RUN);
  await forEachLimited(due, CONCURRENCY, async (event) => {
    try {
      await deliverOne(env, config, deps, event);
    } catch (error) {
      // The store failed after the delivery: the event stays due and goes out again, which the
      // products accept because they keep the ids they handled. Never the body or the secret.
      console.error(
        `identity: event ${event.id} for ${event.product}: its outcome could not be recorded:`,
        error instanceof Error ? error.message : "unknown",
      );
    }
  });
}

/** Runs `task` over `items` with at most `limit` running at once; `task` must not throw. */
async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      await task(items[next++] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** One delivery attempt of one event, and what the outcome does to its row. */
async function deliverOne(env: Env, config: Config, deps: Deps, event: OutboxEvent): Promise<void> {
  if (await attemptDelivery(env, config, deps, event)) {
    await deps.store.markDelivered(event.id, deps.now().toISOString());
    return;
  }
  const now = deps.now().getTime();
  const attempts = event.attempts + 1;
  const age = now - Date.parse(event.createdAt);
  // `!(age < limit)` rather than `age >= limit`: a row whose time cannot be read is given up too,
  // instead of being retried for ever.
  if (!(age < GIVE_UP_AFTER_MS)) {
    await deps.store.recordFailure(event.id, { failedAt: new Date(now).toISOString() });
    console.error(
      `identity: gave up delivering event ${event.id} to ${event.product} after ${attempts} attempts`,
    );
    return;
  }
  // The schedule ends seven days after creation: the next attempt is never later than that, so the
  // last attempt, and with it the failure, falls at the first run at or after the seventh day
  // (here the age is under it, so the time is finite and in the future).
  const lastAttemptAt = Date.parse(event.createdAt) + GIVE_UP_AFTER_MS;
  await deps.store.recordFailure(event.id, {
    nextAt: new Date(Math.min(now + nextAttemptDelayMs(attempts), lastAttemptAt)).toISOString(),
  });
}

/**
 * Posts the signed event to its product. True only for a 2xx answer; a non-2xx answer, a thrown
 * error, a timeout, a product that is no longer configured and a missing secret are all false (a
 * misconfiguration can be repaired within the seven days, so it is retried like any failure, and
 * an event is never sent unsigned).
 */
async function attemptDelivery(
  env: Env,
  config: Config,
  deps: Deps,
  event: OutboxEvent,
): Promise<boolean> {
  const product = config.products.find((candidate) => candidate.name === event.product);
  if (!product) {
    console.error(`identity: event ${event.id}: product ${event.product} is not in PRODUCTS`);
    return false;
  }
  const secret = env[product.secretName];
  if (!secret) {
    console.error(
      `identity: event ${event.id}: the secret of product ${event.product} (${product.secretName}) is not set`,
    );
    return false;
  }
  try {
    const signature = await hmacHex(secret, event.body);
    return await post(deps.fetch, product.events, event.body, {
      "Content-Type": "application/json",
      "Meltemi-Event-Id": event.id,
      "Meltemi-Signature": `v1=${signature}`,
    });
  } catch {
    return false;
  }
}

/**
 * A POST that gives up after ten seconds, whether or not the injected `fetch` honours the abort
 * signal. A redirect is not followed: a POST turned into a GET could answer 200 without the
 * product ever having seen the event.
 */
async function post(
  doFetch: typeof fetch,
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timeout"));
    }, DELIVERY_TIMEOUT_MS);
  });
  try {
    const response = await Promise.race([
      doFetch(url, {
        method: "POST",
        headers,
        body,
        redirect: "manual",
        signal: controller.signal,
      }),
      timeout,
    ]);
    // Nothing in the answer is needed: release the connection.
    response.body?.cancel().catch(() => {});
    return response.status >= 200 && response.status < 300;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
