import type { Route } from "../context.js";

/** A session id: 32 random bytes in base64url without padding. Anything else is not one. */
const SID = /^[A-Za-z0-9_-]{43}$/;

/** An answer with no body that nothing may cache: the session check changes with revocation. */
function answer(status: 204 | 404): Response {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * `GET /sessions/<sid>`: 204 when the session exists, is not revoked and has not expired (and its
 * last-seen time moves to now), 404 otherwise. No authentication: the `sid` is a 256-bit secret
 * the browser, the service and the products know. A revoked, an expired and an unknown session
 * answer alike, and an id that cannot be one never reaches the store.
 */
export const sessionCheck: Route = async (ctx) => {
  const sid = ctx.params["sid"] ?? "";
  if (!SID.test(sid)) return answer(404);
  const { deps } = ctx;
  const at = deps.now().toISOString();
  const session = await deps.store.session(sid);
  if (!session || session.revokedAt !== null || session.expiresAt <= at) return answer(404);
  await deps.store.touchSession(sid, at);
  return answer(204);
};
