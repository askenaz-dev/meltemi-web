/** The cookies of a `Cookie` header; a repeated name keeps its first value. */
export function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name !== "" && !cookies.has(name)) cookies.set(name, part.slice(index + 1).trim());
  }
  return cookies;
}

export interface CookieOptions {
  readonly path?: string;
  readonly domain?: string | undefined;
  readonly maxAge?: number;
  readonly secure?: boolean;
  readonly httpOnly?: boolean;
  readonly sameSite?: "Lax" | "Strict" | "None";
}

/** A `Set-Cookie` value. Names and values are tokens the service makes itself, never user text. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${value}`];
  if (options.domain) parts.push(`Domain=${options.domain}`);
  parts.push(`Path=${options.path ?? "/"}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.secure) parts.push("Secure");
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
}

/** A redirect that can still receive cookies (`Response.redirect` has immutable headers). */
export function redirect(
  location: string,
  setCookies: readonly string[] = [],
  status = 302,
): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status, headers });
}

/** The `Origin` header's origin, or undefined when it is absent or `null`. */
export function originOf(request: Request): string | undefined {
  const origin = request.headers.get("Origin");
  if (!origin || origin === "null") return undefined;
  try {
    return new URL(origin).origin;
  } catch {
    return undefined;
  }
}
