import { isDocsAiOwner } from "../administration.js";
import type { Route } from "../context.js";
import { currentSession } from "../session.js";

/** Private cookie-based navigation discovery. Roles are never inferred from a stale JWT alone. */
export const navigation: Route = async (ctx) => {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  };
  try {
    const current = await currentSession(ctx);
    const body = current
      ? {
          authenticated: true,
          name: current.user.name,
          owner: isDocsAiOwner(ctx.env, current.user.id),
        }
      : { authenticated: false };
    return new Response(JSON.stringify(body), { headers });
  } catch {
    return new Response(JSON.stringify({ reason: "unavailable" }), { status: 503, headers });
  }
};
