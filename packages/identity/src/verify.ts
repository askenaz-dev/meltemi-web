// The reference verifier of the Meltemi session: what a product (Meltemi Diagrams first) uses to
// know who is asking, and to sign its calls to the account API. No Cloudflare API is used, so it
// runs in Node 22 and in Workers; the package builds it to `dist/` and products install that build
// (`docs/repositories.md`).

import { AUDIENCE, SESSION_COOKIE, type SessionClaims } from "./claims.js";
import { fromHex, verifyHmacHex } from "./crypto.js";
import { parseCookies } from "./http.js";
import { importVerifyKey, parseJwt, verifyJwtSignature, type JsonWebKeySet } from "./jwt.js";

export type { SessionClaims } from "./claims.js";
export type { JsonWebKeySet } from "./jwt.js";
export {
  PRODUCT_CALL_WINDOW_MS,
  PRODUCT_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  signProductRequest,
  verifyProductRequest,
  type ProductRequestToSign,
} from "./product-call.js";
export type {
  AccountApiError,
  AccountIdentity,
  AccountProvider,
  AccountSession,
  AccountView,
} from "./account-view.js";

const DEFAULT_ISSUER = "https://id.meltemi.dev";
const DEFAULT_CACHE_MS = 3_600_000;
const DEFAULT_FETCH_TIMEOUT_MS = 5_000;
/** A token is a cookie: it never exceeds 4 KiB, and a longer one is refused unread. */
const MAX_TOKEN_LENGTH = 4096;
const LEEWAY_SECONDS = 60;
/** An unknown `kid` refetches the key set at most this often. */
const JWKS_REFETCH_MS = 60_000;
/** Bounds the memory of the session cache. */
const MAX_CACHED_SESSIONS = 10_000;

export interface SessionVerifierOptions {
  /** The address of the identity service; the token's `iss` must equal it. */
  readonly issuer?: string;
  /** The public keys: inline, the address of a JWKS, or a function that gives them. */
  readonly jwks: JsonWebKeySet | string | (() => JsonWebKeySet | Promise<JsonWebKeySet>);
  /** Used to fetch a JWKS address and for the session check; `globalThis.fetch` by default. */
  readonly fetch?: typeof fetch;
  /**
   * `true` (the default) asks `GET <issuer>/sessions/<sid>`; `false` skips the check; a
   * function decides. A check that fails or throws makes the session invalid.
   */
  readonly checkSession?: boolean | ((sid: string) => Promise<boolean>);
  /** How long a key set, and the answer of a session check, are kept; one hour by default. */
  readonly cacheMs?: number;
  /**
   * How long the verifier waits for its own requests (the key set, the session check); five
   * seconds by default. A request that takes longer counts as a failure, so an identity service
   * that does not answer cannot hold a product's requests for ever.
   */
  readonly fetchTimeoutMs?: number;
}

export interface SessionVerifier {
  /** The claims of a valid, live session, or undefined. `now` defaults to the current time. */
  verifySession(token: string, now?: Date): Promise<SessionClaims | undefined>;
}

/** The session token in a `Cookie` header, or undefined. */
export function parseSessionCookie(cookieHeader: string | null): string | undefined {
  return parseCookies(cookieHeader).get(SESSION_COOKIE) || undefined;
}

interface KeySet {
  readonly byKid: ReadonlyMap<string, CryptoKey>;
  readonly loadedAt: number;
}

export function sessionVerifier(options: SessionVerifierOptions): SessionVerifier {
  const issuer = (options.issuer ?? DEFAULT_ISSUER).replace(/\/+$/, "");
  const cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
  const fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  /** One request of the verifier's own, bounded in time whatever `fetch` does with its signal. */
  async function request<T>(url: string, read: (response: Response) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("The request timed out"));
      }, fetchTimeoutMs);
    });
    const work = (async () =>
      read(await (options.fetch ?? globalThis.fetch)(url, { signal: controller.signal })))();
    // If the timeout wins the race nobody else observes this promise: its failure is not news.
    work.catch(() => {});
    try {
      return await Promise.race([work, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  let keySet: KeySet | undefined;
  /** When an unknown `kid` last caused a refetch, for the once-a-minute bound on those. */
  let lastKidRefetchAt: number | undefined;
  /** The load that is under way: verifications that start together share it. */
  let loading: Promise<KeySet | undefined> | undefined;
  const sessions = new Map<string, { ok: boolean; at: number }>();
  /** The session checks under way, by sid, for the same reason. */
  const asking = new Map<string, Promise<boolean>>();

  async function loadKeySet(now: number): Promise<KeySet | undefined> {
    const source = options.jwks;
    let set: JsonWebKeySet;
    try {
      if (typeof source === "string") {
        const fetched = await request(source, async (response) =>
          response.ok ? ((await response.json()) as JsonWebKeySet) : undefined,
        );
        if (!fetched) return undefined;
        set = fetched;
      } else if (typeof source === "function") {
        set = await source();
      } else {
        set = source;
      }
    } catch {
      return undefined;
    }
    if (!set || !Array.isArray(set.keys)) return undefined;
    const byKid = new Map<string, CryptoKey>();
    for (const entry of set.keys as readonly unknown[]) {
      // A key set is data from elsewhere: an entry that is not an object is no key, not a crash.
      if (typeof entry !== "object" || entry === null) continue;
      const jwk = entry as Record<string, unknown>;
      const kid = jwk["kid"];
      if (typeof kid !== "string" || byKid.has(kid)) continue;
      const key = await importVerifyKey(jwk);
      if (key) byKid.set(kid, key);
    }
    return { byKid, loadedAt: now };
  }

  /** Fetches the key set, or joins the fetch under way: one at a time, whoever asks. */
  function load(now: number): Promise<KeySet | undefined> {
    if (!loading) {
      loading = loadKeySet(now).finally(() => {
        loading = undefined;
      });
    }
    return loading;
  }

  async function keyFor(kid: string, now: number): Promise<CryptoKey | undefined> {
    const inline = typeof options.jwks === "object";
    // Whether the key set was read for this very verification: then it is as new as it can be.
    let fresh = false;
    if (!keySet || (!inline && now - keySet.loadedAt >= cacheMs)) {
      fresh = true;
      const loaded = await load(now);
      if (loaded) keySet = loaded;
      else if (!keySet) return undefined;
    }
    const known = keySet?.byKid.get(kid);
    if (known || inline || fresh) return known;
    // An unknown kid may be a key that was just rotated in: look again, but at most once a minute
    // however many arrive (the first one looks at once; the rest wait for the minute to pass). A
    // fetch already under way answers the question too, so it is joined, not refused.
    if (!loading) {
      if (lastKidRefetchAt !== undefined && now - lastKidRefetchAt < JWKS_REFETCH_MS) {
        return undefined;
      }
      lastKidRefetchAt = now;
    }
    const reloaded = await load(now);
    if (reloaded) keySet = reloaded;
    return keySet?.byKid.get(kid);
  }

  /** Asks the service (or the product's own check) and keeps an answer, never a failure. */
  async function askSession(
    check: true | ((sid: string) => Promise<boolean>),
    sid: string,
    now: number,
  ): Promise<boolean> {
    let ok: boolean;
    try {
      if (typeof check === "function") {
        ok = await check(sid);
      } else {
        const status = await request(
          `${issuer}/sessions/${encodeURIComponent(sid)}`,
          async (response) => {
            // The body is not needed: release the connection.
            void response.body?.cancel().catch(() => {});
            return response.status;
          },
        );
        if (status === 204) ok = true;
        else if (status === 404) ok = false;
        else return false; // The service is unwell: no answer is not an answer, and it is not kept.
      }
    } catch {
      return false;
    }
    if (sessions.size >= MAX_CACHED_SESSIONS) sessions.delete(sessions.keys().next().value!);
    sessions.set(sid, { ok, at: now });
    return ok;
  }

  async function sessionIsLive(sid: string, now: number): Promise<boolean> {
    const check = options.checkSession ?? true;
    if (check === false) return true;
    const cached = sessions.get(sid);
    if (cached && now - cached.at < cacheMs) return cached.ok;
    // Verifications that start together (a page's parallel requests) share one check.
    let pending = asking.get(sid);
    if (!pending) {
      pending = askSession(check, sid, now).finally(() => {
        asking.delete(sid);
      });
      asking.set(sid, pending);
    }
    return pending;
  }

  return {
    async verifySession(token, nowDate = new Date()) {
      if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
        return undefined;
      }
      const parsed = parseJwt(token);
      if (!parsed) return undefined;
      // Before any key is looked up: the algorithm is ES256 and nothing else.
      const { alg, typ, kid } = parsed.header;
      if (alg !== "ES256" || typ !== "JWT" || typeof kid !== "string") return undefined;

      const now = nowDate.getTime();
      const key = await keyFor(kid, now);
      if (!key || !(await verifyJwtSignature(parsed, key))) return undefined;

      const claims = readClaims(parsed.claims, issuer);
      if (!claims) return undefined;
      const seconds = Math.floor(now / 1000);
      if (seconds > claims.exp + LEEWAY_SECONDS || claims.iat > seconds + LEEWAY_SECONDS) {
        return undefined;
      }
      return (await sessionIsLive(claims.sid, now)) ? claims : undefined;
    },
  };
}

function readClaims(
  value: Readonly<Record<string, unknown>>,
  issuer: string,
): SessionClaims | undefined {
  const { iss, aud, sub, sid, name, picture, email, email_verified, iat, exp } = value;
  if (iss !== issuer || aud !== AUDIENCE) return undefined;
  if (typeof sub !== "string" || sub === "" || typeof sid !== "string" || sid === "")
    return undefined;
  if (typeof name !== "string" || typeof picture !== "string" || typeof email !== "string")
    return undefined;
  if (typeof email_verified !== "boolean") return undefined;
  if (typeof iat !== "number" || !Number.isFinite(iat)) return undefined;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return undefined;
  return { iss, aud, sub, sid, name, picture, email, email_verified, iat, exp };
}

/**
 * Checks the `Meltemi-Signature` header (`v1=<hex HMAC-SHA256 of the body>`) of a deletion event
 * with the secret the service signs this product's events with. A product also keeps the ids of
 * the events it handled, because delivery is at least once.
 */
export async function verifyEventSignature(
  secret: string,
  body: string,
  header: string | null,
): Promise<boolean> {
  if (!header?.startsWith("v1=")) return false;
  const signature = header.slice(3);
  return fromHex(signature) !== undefined && verifyHmacHex(secret, body, signature);
}
