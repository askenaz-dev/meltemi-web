import type { Env } from "./env.js";

/** A product that receives deletion events. */
export interface Product {
  readonly name: string;
  /** The address the events are posted to. */
  readonly events: string;
  /** The name of the secret that signs its events: `EVENTS_SECRET_<NAME>`. */
  readonly secretName: `EVENTS_SECRET_${string}`;
}

/** The environment, read and checked once per request. */
export interface Config {
  readonly issuer: string;
  readonly cookieDomain: string;
  readonly siteUrl: string;
  readonly dev: boolean;
  /** Origins accepted as return addresses and form targets; empty unless `dev`. */
  readonly devOrigins: readonly string[];
  readonly products: readonly Product[];
  /** Whether cookies carry `Secure` (not on `http:` in development). */
  readonly secureCookies: boolean;
  /** The `Domain` attribute of the family's cookies; none in development. */
  readonly cookieDomainAttribute: string | undefined;
}

/** A misconfiguration the service cannot run with; answered as an internal error. */
export class ConfigError extends Error {}

function trimSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

/** An address the service can use: parseable, `https:` (`http:` only in development). */
function checkAddress(name: string, value: string, dev: boolean): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`${name} is not an address`);
  }
  if (url.protocol !== "https:" && !(dev && url.protocol === "http:")) {
    throw new ConfigError(`${name} must be https`);
  }
}

function parseOrigins(text: string | undefined): string[] {
  const origins: string[] = [];
  for (const part of (text ?? "").split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    try {
      origins.push(new URL(trimmed).origin);
    } catch {
      throw new ConfigError(`DEV_ORIGINS holds an address that is not a URL: ${trimmed}`);
    }
  }
  return origins;
}

function parseProducts(text: string, dev: boolean): Product[] {
  let value: unknown;
  try {
    value = JSON.parse(text || "[]");
  } catch {
    throw new ConfigError("PRODUCTS is not JSON");
  }
  if (!Array.isArray(value)) throw new ConfigError("PRODUCTS is not an array");
  const seen = new Set<string>();
  return value.map((entry: unknown) => {
    const item = entry as { name?: unknown; events?: unknown };
    if (typeof item?.name !== "string" || !/^[a-z][a-z0-9-]{0,30}$/.test(item.name)) {
      throw new ConfigError("A product needs a name of lowercase letters, digits and hyphens");
    }
    if (seen.has(item.name)) throw new ConfigError(`${item.name}: the product is listed twice`);
    seen.add(item.name);
    if (typeof item.events !== "string") throw new ConfigError(`${item.name}: events is missing`);
    let url: URL;
    try {
      url = new URL(item.events);
    } catch {
      throw new ConfigError(`${item.name}: events is not a URL`);
    }
    if (url.protocol !== "https:" && !(dev && url.protocol === "http:")) {
      throw new ConfigError(`${item.name}: events must be https`);
    }
    const secretName = `EVENTS_SECRET_${item.name.toUpperCase().replace(/-/g, "_")}` as const;
    return { name: item.name, events: url.href, secretName };
  });
}

export function readConfig(env: Env): Config {
  const dev = env.DEV === "true";
  const issuer = trimSlashes(env.ISSUER);
  checkAddress("ISSUER", issuer, dev);
  checkAddress("SITE_URL", env.SITE_URL, dev);
  if (!env.COOKIE_DOMAIN) throw new ConfigError("COOKIE_DOMAIN is missing");
  return {
    issuer,
    cookieDomain: env.COOKIE_DOMAIN,
    siteUrl: trimSlashes(env.SITE_URL),
    dev,
    devOrigins: dev ? parseOrigins(env.DEV_ORIGINS) : [],
    products: parseProducts(env.PRODUCTS, dev),
    secureCookies: !(dev && issuer.startsWith("http:")),
    cookieDomainAttribute: dev ? undefined : env.COOKIE_DOMAIN,
  };
}
