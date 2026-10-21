import type { Config } from "./config.js";

/** The longest return address accepted, so that the cookie that carries it stays small. */
export const MAX_RETURN_TO_LENGTH = 2048;

export type ReturnTo = { readonly ok: true; readonly url: string } | { readonly ok: false };

/**
 * Whether an address belongs to the family: an `https:` address without credentials or a port
 * whose host is the cookie domain or a subdomain of it. In development the origins of
 * `DEV_ORIGINS` and the service's own origin also count (the account page returns to itself).
 */
export function isFamilyUrl(url: URL, config: Config): boolean {
  if (url.username !== "" || url.password !== "") return false;
  if (
    config.dev &&
    (config.devOrigins.includes(url.origin) || url.origin === originOfIssuer(config))
  ) {
    return true;
  }
  if (url.protocol !== "https:" || url.port !== "") return false;
  const domain = config.cookieDomain.toLowerCase();
  return url.hostname === domain || url.hostname.endsWith(`.${domain}`);
}

/** A control character or a backslash: browsers read `\` as `/`, so a parser could disagree. */
function hasControlOrBackslash(text: string): boolean {
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || char === "\\") return true;
  }
  return false;
}

function originOfIssuer(config: Config): string {
  return new URL(config.issuer).origin;
}

/**
 * Where a person goes after signing in or out: a family address (`isFamilyUrl`), or the site's
 * when none is given. The accepted address is the parsed one, so what the browser follows is what
 * was checked.
 */
export function resolveReturnTo(raw: string | null | undefined, config: Config): ReturnTo {
  if (raw === null || raw === undefined || raw === "") return { ok: true, url: config.siteUrl };
  // The address travels in the signed `meltemi_oauth` cookie, which browsers drop above 4 KiB.
  if (raw.length > MAX_RETURN_TO_LENGTH || hasControlOrBackslash(raw)) return { ok: false };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false };
  }
  return isFamilyUrl(url, config) ? { ok: true, url: url.href } : { ok: false };
}

/**
 * Whether the `Origin` of a request that changes state is a family host: products sign people out
 * with a plain form, so `POST /logout` accepts any of them.
 */
export function isFamilyOrigin(origin: string | undefined, config: Config): boolean {
  if (!origin) return false;
  try {
    return isFamilyUrl(new URL(origin), config);
  } catch {
    return false;
  }
}
