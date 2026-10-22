// The account API for products (`identity-account`, "The account API for products"): what a
// product's Worker reads and changes on a person's behalf, so that the product shows the account in
// its own interface. Each call carries two things together: the product's signature
// (`product-call.ts`) and the person's own session token as a bearer, whose session is "the current
// one" for the call. Cookies count for nothing here and no CORS header is ever written, so no
// browser can use this API, from any origin. Linking a provider and deleting the account are not
// here: they stay the account page's, as navigations.

import type { AccountView } from "../account-view.js";
import type { Ctx, Route } from "../context.js";
import { callLimits } from "../limits.js";
import { verifyProductRequest } from "../product-call.js";
import { sessionFromToken, type CurrentSession } from "../session.js";
import { isProvider } from "../types.js";
import { SID } from "./sessions.js";

/** The longest body a call may carry. */
const MAX_BODY_BYTES = 8 * 1024;

/** The counter used when the dependencies bring none: one per isolate. */
const isolateLimits = callLimits();

/** A JSON answer that nothing may cache. */
export function apiJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** A refusal: `{ "error": "<code>" }`. */
export function apiError(code: string, status: number): Response {
  return apiJson({ error: code }, status);
}

/** The body as UTF-8 text, read through the cap; undefined when it is longer or not UTF-8. */
async function readBody(request: Request): Promise<string | undefined> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return undefined;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** A JSON object body; an empty body is an empty object. Undefined for anything else. */
function objectOf(body: string): Record<string, unknown> | undefined {
  if (body.trim() === "") return {};
  try {
    const value: unknown = JSON.parse(body);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

interface Caller {
  readonly product: string;
  readonly current: CurrentSession;
  readonly fields: Record<string, unknown>;
}

/**
 * Who calls, in this order: the body (`400 request.invalid` beyond 8 KiB or when it is not a JSON
 * object), the product's signature (`401 product.unauthorized`, never saying which check failed),
 * the person's token and live session (`401 session.invalid`), and the minute's allowance for that
 * product and person (`429 rate.limited`).
 */
async function productCaller(ctx: Ctx): Promise<Caller | Response> {
  const { request, config, env, deps } = ctx;
  const body = await readBody(request);
  if (body === undefined) return apiError("request.invalid", 400);
  const signed = await verifyProductRequest(
    request,
    body,
    (name) => {
      const product = config.products.find((candidate) => candidate.name === name);
      return product ? env[product.secretName] : undefined;
    },
    deps.now(),
  );
  if (!signed) return apiError("product.unauthorized", 401);
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("Authorization") ?? "")?.[1];
  const current = token ? await sessionFromToken(ctx, token) : undefined;
  if (!current) return apiError("session.invalid", 401);
  const limits = deps.limits ?? isolateLimits;
  if (!limits.allow(`${signed.product}\n${current.user.id}`, deps.now().getTime())) {
    return apiError("rate.limited", 429);
  }
  const fields = objectOf(body);
  if (!fields) return apiError("request.invalid", 400);
  return { product: signed.product, current, fields };
}

/** The account as it is now, for the person of the current session. */
async function viewOf(ctx: Ctx, current: CurrentSession): Promise<AccountView> {
  const { store } = ctx.deps;
  const [identities, sessions] = await Promise.all([
    store.identitiesOf(current.user.id),
    store.sessionsOf(current.user.id, ctx.deps.now().toISOString()),
  ]);
  return {
    user: { id: current.user.id, name: current.user.name, picture: current.user.picture },
    identities: identities.map((identity) => ({
      provider: identity.provider,
      email: identity.email,
      emailVerified: identity.emailVerified,
      handle: identity.handle,
      linkedAt: identity.linkedAt,
    })),
    sessions: sessions.map((session) => ({
      sid: session.sid,
      label: session.label,
      createdAt: session.createdAt,
      lastSeen: session.lastSeen,
      expiresAt: session.expiresAt,
      current: session.sid === current.session.sid,
    })),
    // The store unlinks a provider with every identity of it, so what counts is the providers.
    canUnlink: new Set(identities.map((identity) => identity.provider)).size > 1,
  };
}

/** `GET /api/account`: the person, their identities and their live sessions. */
export const apiAccount: Route = async (ctx) => {
  const caller = await productCaller(ctx);
  if (caller instanceof Response) return caller;
  return apiJson(await viewOf(ctx, caller.current));
};

/**
 * `POST /api/account/unlink { provider }`: removes the person's identities of a provider unless it
 * is the last one (`409 identity.last`). A provider not linked is already as asked.
 */
export const apiUnlink: Route = async (ctx) => {
  const caller = await productCaller(ctx);
  if (caller instanceof Response) return caller;
  const provider = caller.fields["provider"];
  if (!isProvider(provider)) return apiError("provider.unknown", 400);
  const outcome = await ctx.deps.store.unlinkProvider(caller.current.user.id, provider);
  if (outcome === "last") return apiError("identity.last", 409);
  return apiJson(await viewOf(ctx, caller.current));
};

/** `POST /api/account/sessions/revoke-others`: every session of the person but the current one ends. */
export const apiRevokeOthers: Route = async (ctx) => {
  const caller = await productCaller(ctx);
  if (caller instanceof Response) return caller;
  const { deps } = ctx;
  await deps.store.revokeOtherSessions(
    caller.current.user.id,
    caller.current.session.sid,
    deps.now().toISOString(),
  );
  return apiJson(await viewOf(ctx, caller.current));
};

/**
 * `POST /api/account/sessions/:sid/revoke`: one session of the person ends. The current one is
 * refused (`409 session.current`: a product signs a person out with `/logout`), a session that is
 * not the person's, or no session, is `404 session.not-found`, and one that already ended is
 * already as asked.
 */
export const apiRevokeOne: Route = async (ctx) => {
  const caller = await productCaller(ctx);
  if (caller instanceof Response) return caller;
  const { deps } = ctx;
  const sid = ctx.params["sid"] ?? "";
  if (sid === caller.current.session.sid) return apiError("session.current", 409);
  const session = SID.test(sid) ? await deps.store.session(sid) : undefined;
  if (!session || session.userId !== caller.current.user.id) {
    return apiError("session.not-found", 404);
  }
  if (session.revokedAt === null) await deps.store.revokeSession(sid, deps.now().toISOString());
  return apiJson(await viewOf(ctx, caller.current));
};
