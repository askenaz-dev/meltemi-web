// Secrets in production come from Cloudflare's Secrets Store: a Worker binds each one as
// `<NAME>_STORE` and reads its value with `await env.<NAME>_STORE.get()`. In development and in the
// tests the same secret is the string `<NAME>` of `.dev.vars`. `resolveSecrets` turns the first
// into the second once, at the Worker's entry, so every handler keeps reading `env.<NAME>` as a
// string and nothing below the entry knows where a secret came from.

/** A Secrets Store binding: the one call a Worker makes on it. */
export interface StoredSecret {
  get(): Promise<string>;
}

/** The suffix of a Secrets Store binding's name: `STATE_SECRET_STORE` holds `STATE_SECRET`. */
export const STORE_SUFFIX = "_STORE";

/** The values read so far, for the life of the isolate: one `get()` per secret, not per request. */
const values = new Map<string, Promise<string | undefined>>();

/** Forgets what was read; for the tests, which run many environments in one process. */
export function forgetSecrets(): void {
  values.clear();
}

function isStoredSecret(value: unknown): value is StoredSecret {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { get?: unknown }).get === "function"
  );
}

/**
 * The value of one stored secret, or undefined when the store cannot give it: the name is logged,
 * never the value, and a failure is not remembered, so the next request asks again.
 */
function readStored(name: string, binding: StoredSecret): Promise<string | undefined> {
  let pending = values.get(name);
  if (!pending) {
    pending = binding.get().then(
      (value) => (typeof value === "string" && value !== "" ? value : undefined),
      () => undefined,
    );
    values.set(name, pending);
  }
  return pending.then((value) => {
    if (value === undefined) {
      values.delete(name);
      console.error(`identity: the secret ${name} could not be read from its store binding`);
    }
    return value;
  });
}

/**
 * The environment with every `<NAME>_STORE` binding read into `<NAME>`. A non-empty string
 * `<NAME>` (from `.dev.vars`) wins and its binding is never called. The result reads every other
 * binding and variable from `env` itself, so the D1 binding and the rest are untouched.
 */
export async function resolveSecrets<E extends object>(env: E): Promise<E> {
  const record = env as Record<string, unknown>;
  const read: [string, Promise<string | undefined>][] = [];
  for (const key of Object.keys(record)) {
    if (!key.endsWith(STORE_SUFFIX) || key === STORE_SUFFIX) continue;
    const binding = record[key];
    if (!isStoredSecret(binding)) continue;
    const name = key.slice(0, -STORE_SUFFIX.length);
    const given = record[name];
    if (typeof given === "string" && given !== "") continue;
    read.push([name, readStored(name, binding)]);
  }
  if (read.length === 0) return env;
  const resolved = Object.create(env) as Record<string, unknown>;
  for (const [name, pending] of read) {
    const value = await pending;
    if (value !== undefined) resolved[name] = value;
  }
  return resolved as E;
}
