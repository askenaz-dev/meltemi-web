// A best-effort bound on the calls of the account API: at most sixty a minute for one product and
// person, counted where the counter lives (one per isolate in the Worker, one per test harness). It
// stops a product's loop from hammering the store; it is no defence against an attacker, who has no
// product secret to call with in the first place.

export const CALLS_PER_MINUTE = 60;
const WINDOW_MS = 60_000;
/** Bounds the memory of the counter. */
const MAX_KEYS = 10_000;

export interface CallLimits {
  /** Counts a call for `key` at `now` (milliseconds); false when the minute's allowance is spent. */
  allow(key: string, now: number): boolean;
}

export function callLimits(perMinute = CALLS_PER_MINUTE): CallLimits {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    allow(key, now) {
      const held = windows.get(key);
      if (!held || now - held.start >= WINDOW_MS) {
        windows.delete(key);
        if (windows.size >= MAX_KEYS) windows.delete(windows.keys().next().value!);
        windows.set(key, { start: now, count: 1 });
        return true;
      }
      if (held.count >= perMinute) return false;
      held.count++;
      return true;
    },
  };
}
