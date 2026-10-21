// Helpers for the sign-in tests: start a flow through `/login`, feed the cookie back to the
// callback as a browser would, and read what the pages and cookies say.

import { vi } from "vitest";
import { fromBase64url, fromUtf8 } from "../../src/crypto.js";
import type { Provider } from "../../src/types.js";
import { setCookie, type Harness } from "./index.js";

/** The `Set-Cookie` line that clears the `meltemi_oauth` cookie in production. */
export const CLEARED_OAUTH =
  "meltemi_oauth=; Path=/callback; Max-Age=0; Secure; HttpOnly; SameSite=Lax";

/** The development environment of the family: the service and two products on localhost. */
export const DEV_ENV = {
  DEV: "true",
  ISSUER: "http://localhost:8787",
  SITE_URL: "http://localhost:8789",
  DEV_ORIGINS: "http://localhost:8788,http://localhost:8789",
  PRODUCTS: '[{"name":"diagrams","events":"http://localhost:8788/_identity/events"}]',
} as const;

/**
 * The production addresses with the development origins listed and development mode off: the
 * origins must then be ignored (an `http:` issuer outside development mode is a configuration error).
 */
export const NOT_DEV_ENV = {
  DEV: "false",
  DEV_ORIGINS: DEV_ENV.DEV_ORIGINS,
} as const;

export interface Flow {
  /** The response of `/login?provider=...`. */
  readonly response: Response;
  /** Where the browser was sent: the provider's authorization endpoint. */
  readonly location: URL;
  /** The value of the `meltemi_oauth` cookie. */
  readonly value: string;
  /** The `Cookie` header that carries it. */
  readonly cookie: string;
  /** The `state` the provider will send back. */
  readonly state: string;
}

/** Starts a flow at `/login` and returns what the browser would hold. */
export async function startFlow(
  h: Harness,
  provider: Provider,
  options: { query?: Record<string, string>; headers?: Record<string, string> } = {},
): Promise<Flow> {
  const query = new URLSearchParams({ provider, ...options.query });
  const response = await h.request(`/login?${query}`, { headers: options.headers ?? {} });
  if (response.status !== 302) throw new Error(`/login answered ${response.status}`);
  const location = new URL(response.headers.get("Location")!);
  const value = setCookie(response, "meltemi_oauth")!;
  return {
    response,
    location,
    value,
    cookie: `meltemi_oauth=${value}`,
    state: location.searchParams.get("state")!,
  };
}

/**
 * The provider sends the browser back: `GET /callback/<provider>` with the flow's cookie, the
 * flow's `state` and a code, each of which a test may replace or drop (`undefined`).
 */
export function callback(
  h: Harness,
  provider: Provider,
  flow: Flow,
  options: {
    code?: string | undefined;
    state?: string | undefined;
    error?: string;
    /** Replaces the cookie header (default: the flow's cookie). */
    cookie?: string | null;
    /** Other cookies sent along, such as the session's. */
    cookies?: string[];
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const query = new URLSearchParams();
  const code = "code" in options ? options.code : "stub-code";
  const state = "state" in options ? options.state : flow.state;
  if (code !== undefined) query.set("code", code);
  if (state !== undefined) query.set("state", state);
  if (options.error !== undefined) query.set("error", options.error);
  const cookie = options.cookie === undefined ? flow.cookie : options.cookie;
  const cookies = [...(options.cookies ?? []), ...(cookie ? [cookie] : [])];
  return h.request(`/callback/${provider}?${query}`, {
    headers: { ...(cookies.length > 0 ? { Cookie: cookies.join("; ") } : {}), ...options.headers },
  });
}

/** A whole sign-in: `/login` then the callback. */
export async function signIn(
  h: Harness,
  provider: Provider,
  options: {
    query?: Record<string, string>;
    headers?: Record<string, string>;
    cookies?: string[];
  } = {},
): Promise<{ flow: Flow; response: Response }> {
  const flow = await startFlow(h, provider, {
    ...(options.query ? { query: options.query } : {}),
    headers: {
      ...(options.cookies ? { Cookie: options.cookies.join("; ") } : {}),
      ...options.headers,
    },
  });
  const response = await callback(h, provider, flow, {
    ...(options.cookies ? { cookies: options.cookies } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
  });
  return { flow, response };
}

/** What a `meltemi_oauth` value holds, undone without checking anything. */
export function decodeOauth(value: string): {
  payloadPart: string;
  signaturePart: string;
  payload: Record<string, unknown>;
} {
  const [payloadPart, signaturePart] = value.split(".") as [string, string];
  const payload = JSON.parse(fromUtf8(fromBase64url(payloadPart)!)) as Record<string, unknown>;
  return { payloadPart, signaturePart, payload };
}

const UNESCAPES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/** The text of an HTML attribute value, undone. */
export function unescapeHtml(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => UNESCAPES[entity]!);
}

/** Every `href` of a page, unescaped, in order. */
export function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => unescapeHtml(match[1]!));
}

/** The `<html lang>` of a page. */
export function langOf(html: string): string | undefined {
  return /<html lang="([^"]*)"/.exec(html)?.[1];
}

/** The `Set-Cookie` lines of a response that name the session cookie. */
export function sessionCookies(response: Response): string[] {
  return response.headers.getSetCookie().filter((line) => line.startsWith("meltemi_session="));
}

/**
 * Silences `console.error`/`warn`/`log`/`info` and keeps what was said, so a test can check that a
 * failure was logged without a secret and the run stays quiet.
 */
export function captureConsole(): { lines: () => string; restore: () => void } {
  const spies = (["error", "warn", "log", "info"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
  return {
    lines: () => spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join("\n"),
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}

/** A harness whose provider fetch answers one address its own way and leaves the rest to the stub. */
export function interceptFetch(
  h: Harness,
  handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response> | undefined,
): void {
  const original = h.deps.fetch;
  (h.deps as { fetch: typeof fetch }).fetch = async (input, init) => {
    const url = new Request(input as RequestInfo, init).url;
    const answer = await handler(url, init);
    return answer ?? original(input, init);
  };
}
