/** A fixed service-binding proxy: only the session cookie crosses to Identity. */
export interface NavigationEnv {
  readonly ASK_STUB?: string;
  readonly IDENTITY?: { fetch(request: Request): Promise<Response> };
}

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });

/** A duplicate or malformed credential fails closed. Unrelated cookies are discarded. */
function sessionCookie(raw: string): string | undefined {
  const values = raw
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.split("=", 1)[0] === "meltemi_session");
  if (values.length !== 1) return undefined;
  const value = values[0]!.slice("meltemi_session=".length);
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) && value.length <= 8192
    ? `meltemi_session=${value}`
    : undefined;
}

function valid(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort().join(",");
  return row.authenticated === false
    ? keys === "authenticated"
    : row.authenticated === true &&
        keys === "authenticated,name,owner" &&
        typeof row.name === "string" &&
        [...row.name].length <= 256 &&
        typeof row.owner === "boolean";
}

export async function accountMenu(request: Request, env: NavigationEnv): Promise<Response> {
  if (request.method !== "GET") return json({ reason: "method" }, 405, { Allow: "GET" });
  const origin = request.headers.get("Origin");
  if (
    (origin !== null && origin !== new URL(request.url).origin) ||
    request.headers.get("Sec-Fetch-Site") === "cross-site"
  )
    return json({ reason: "origin" }, 403);
  if (env.ASK_STUB === "fixture") return json({ authenticated: false });
  const cookie = sessionCookie(request.headers.get("Cookie") ?? "");
  if (!cookie) return json({ authenticated: false });
  if (!env.IDENTITY) return json({ reason: "unavailable" }, 503);
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = await Promise.race([
      (async () => {
        const response = await env.IDENTITY!.fetch(
          new Request("https://id.meltemi.dev/api/navigation", {
            headers: { Cookie: cookie, Accept: "application/json" },
            signal: controller.signal,
            cache: "no-store",
            redirect: "manual",
            credentials: "omit",
          }),
        );
        if (
          response.status !== 200 ||
          !/^application\/json(?:\s*;|$)/i.test(response.headers.get("Content-Type") ?? "")
        )
          throw new Error("navigation unavailable");
        // A corrupt upstream response is bounded before parsing, including streamed bodies.
        const reader = response.body?.getReader();
        if (!reader) throw new Error("navigation unavailable");
        const cancel = () => {
          void reader.cancel().catch(() => {});
        };
        controller.signal.addEventListener("abort", cancel, { once: true });
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 4096) {
              await reader.cancel();
              throw new Error("navigation unavailable");
            }
            chunks.push(value);
          }
        } finally {
          controller.signal.removeEventListener("abort", cancel);
        }
        if (controller.signal.aborted) throw new Error("navigation unavailable");
        const bytes = new Uint8Array(size);
        let at = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, at);
          at += chunk.length;
        }
        const data: unknown = JSON.parse(
          new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
        );
        if (!valid(data)) throw new Error("navigation unavailable");
        return json(data);
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("navigation unavailable"));
        }, 3000);
      }),
    ]);
    return answer;
  } catch {
    return json({ reason: "unavailable" }, 503);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
