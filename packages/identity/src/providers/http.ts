import { ProviderError } from "./types.js";

/** Every request to a provider says who is asking. */
export const PROVIDER_USER_AGENT = "meltemi-identity";

/** A provider that does not answer within this time is treated as down. */
export const PROVIDER_TIMEOUT_MS = 10_000;

/** A decoded JSON object, or undefined for anything else (an array, a string, `null`...). */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The text of a value when it is a non-empty string, else undefined. */
export function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** A setting the flow cannot run without; a secret that was never set arrives as undefined. */
export function requireSetting(name: string, value: string | undefined): void {
  if (!value) throw new ProviderError(`${name} is not set`);
}

/**
 * One request to a provider, read as JSON: the whole exchange (answer and body) is bound by the
 * timeout, a status outside 2xx, a failure to connect and a body that is not JSON are all a
 * `ProviderError`. `what` names the step in the message; nothing the provider said is copied.
 */
export async function requestJson(
  doFetch: typeof fetch,
  what: string,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await doFetch(url, { ...init, signal: controller.signal });
    } catch {
      throw new ProviderError(`${what}: the request failed`);
    }
    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      throw new ProviderError(`${what}: the answer was ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new ProviderError(`${what}: the answer is not JSON`);
    }
  } finally {
    clearTimeout(timer);
  }
}
