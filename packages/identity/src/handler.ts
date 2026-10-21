import { ConfigError, readConfig, type Config } from "./config.js";
import type { Ctx, Route } from "./context.js";
import type { Env } from "./env.js";
import { deliverDueEvents } from "./events.js";
import { messages, resolveLang } from "./messages/index.js";
import { simpleError } from "./pages/layout.js";
import { accountPage, deletePost, revokeOthersPost, unlinkPost } from "./routes/account.js";
import { cssRoute, jwksRoute } from "./routes/assets.js";
import { callbackRoute } from "./routes/callback.js";
import { loginRoute } from "./routes/login.js";
import { logoutPage, logoutPost } from "./routes/logout.js";
import { rootRoute } from "./routes/root.js";
import { sessionCheck } from "./routes/sessions.js";
import type { Deps } from "./types.js";

interface RouteEntry {
  readonly method: "GET" | "POST";
  readonly path: RegExp;
  readonly params?: readonly string[];
  readonly route: Route;
}

const ROUTES: readonly RouteEntry[] = [
  { method: "GET", path: /^\/$/, route: rootRoute },
  { method: "GET", path: /^\/login$/, route: loginRoute },
  {
    method: "GET",
    path: /^\/callback\/(github|google)$/,
    params: ["provider"],
    route: callbackRoute,
  },
  { method: "GET", path: /^\/logout$/, route: logoutPage },
  { method: "POST", path: /^\/logout$/, route: logoutPost },
  { method: "GET", path: /^\/sessions\/([^/]+)$/, params: ["sid"], route: sessionCheck },
  { method: "GET", path: /^\/\.well-known\/jwks\.json$/, route: jwksRoute },
  { method: "GET", path: /^\/account$/, route: accountPage },
  { method: "POST", path: /^\/account\/unlink$/, route: unlinkPost },
  { method: "POST", path: /^\/account\/sessions\/revoke-others$/, route: revokeOthersPost },
  { method: "POST", path: /^\/account\/delete$/, route: deletePost },
  { method: "GET", path: /^\/identity\.css$/, route: cssRoute },
];

function match(
  method: string,
  pathname: string,
): { route: Route; params: Record<string, string> } | undefined {
  for (const entry of ROUTES) {
    if (entry.method !== method) continue;
    const found = entry.path.exec(pathname);
    if (!found) continue;
    const params: Record<string, string> = {};
    for (const [i, name] of (entry.params ?? []).entries()) {
      try {
        params[name] = decodeURIComponent(found[i + 1] ?? "");
      } catch {
        return undefined;
      }
    }
    return { route: entry.route, params };
  }
  return undefined;
}

/** The plain answer to a request the service cannot even start to handle. */
function plain(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function hardened(response: Response): Response {
  if (!response.headers.has("X-Content-Type-Options")) {
    // A redirect's headers are immutable in some runtimes: copy before adding one.
    const copy = new Response(response.body, response);
    copy.headers.set("X-Content-Type-Options", "nosniff");
    return copy;
  }
  return response;
}

/**
 * The service: a request in, a response out. Everything with a side effect (the providers, the
 * clock, randomness, the store, the keys) arrives in `deps`, so the tests run in Node.
 */
export async function identity(request: Request, env: Env, deps: Deps): Promise<Response> {
  let config: Config;
  try {
    config = readConfig(env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`identity: ${error.message}`);
    return plain(500, "The service is not configured.");
  }
  const url = new URL(request.url);
  const lang = resolveLang(url, request.headers.get("Accept-Language"));
  const base = { request, url, env, deps, config, lang };
  const found = match(request.method, url.pathname);
  try {
    if (!found) {
      const m = messages(lang).common;
      return hardened(
        simpleError({ ...base, params: {} }, 404, "not-found", m.notFoundTitle, m.notFoundBody),
      );
    }
    const ctx: Ctx = { ...base, params: found.params };
    return hardened(await found.route(ctx));
  } catch (error) {
    // The message of an error never holds a secret or a person's data: log it and say nothing more.
    console.error(
      "identity: unexpected error:",
      error instanceof Error ? error.message : "unknown",
    );
    const m = messages(lang).common;
    return hardened(
      simpleError({ ...base, params: {} }, 500, "internal", m.internalTitle, m.internalBody),
    );
  }
}

/** Sessions that ended this long ago are removed by the scheduled run. */
const SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** The scheduled run: delivers the deletion events that are due and tidies old sessions. */
export async function scheduled(env: Env, deps: Deps): Promise<void> {
  const config = readConfig(env);
  await deliverDueEvents(env, config, deps);
  await deps.store.deleteSessionsBefore(
    new Date(deps.now().getTime() - SESSION_RETENTION_MS).toISOString(),
  );
}
