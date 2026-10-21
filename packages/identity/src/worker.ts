// The Cloudflare entry: it reads the secrets from their store bindings, builds the dependencies
// from the bindings and hands every request to the plain functions of `handler.ts`. Nothing of
// the logic lives here.

import { identity, scheduled } from "./handler.js";
import type { SigningKeys } from "./jwt.js";
import { resolveSecrets } from "./secrets.js";
import { readSigningKeys } from "./signing-keys.js";
import { d1Store } from "./store/d1.js";
import type { Env } from "./env.js";
import type { Deps } from "./types.js";

/** The imported keys, kept for the life of the isolate and renewed when the settings change. */
let cached: { source: string; keys: Promise<SigningKeys> } | undefined;

function signingKeys(env: Env): Promise<SigningKeys> {
  const source = `${env.SESSION_PRIVATE_KEY}\n${env.SESSION_PUBLIC_KEYS}`;
  if (cached?.source !== source) cached = { source, keys: readSigningKeys(env) };
  return cached.keys;
}

async function depsFor(env: Env): Promise<Deps> {
  // Every page that signs a cookie or a form needs it; without it the service cannot start.
  if (!env.STATE_SECRET) throw new Error("STATE_SECRET is not set");
  return {
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    store: d1Store(env.DB),
    keys: await signingKeys(env),
  };
}

/** The response of a service that cannot start: the log says why, the page never does. */
function notConfigured(error: unknown): Response {
  // The messages of the settings are written not to repeat what a setting holds.
  console.error("identity:", error instanceof Error ? error.message : "cannot start");
  return new Response("The service is not configured.", {
    status: 500,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request: Request, given: Env): Promise<Response> {
    let env: Env;
    let deps: Deps;
    try {
      env = await resolveSecrets(given);
      deps = await depsFor(env);
    } catch (error) {
      return notConfigured(error);
    }
    return identity(request, env, deps);
  },
  /** The cron trigger. The controller says when it fired; the run reads the clock itself. */
  async scheduled(_controller: unknown, given: Env): Promise<void> {
    const env = await resolveSecrets(given);
    await scheduled(env, await depsFor(env));
  },
};
