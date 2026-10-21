import type { Provider, ProviderProfile } from "../types.js";
import { ProviderError } from "./types.js";

// The profile a provider reports is the one input of the service nobody here controls, and it
// travels: it is stored, shown on the account page and signed into the session token (name,
// picture, email), which a verifier and a browser cookie refuse above 4096 characters. A profile
// of a few thousand characters would sign the person in and then look signed out at once, so
// every profile goes through `normalizeProfile` before it is resolved, and these are the rules.
// A profile that already fits them comes out unchanged.
//
// - Control characters (code points below 0x20 and 0x7f) are removed from the name and the handle.
//   The email is not repaired: one that holds a control character is not an address, because
//   dropping the character would name another mailbox than the provider vouched for.
// - Lone surrogates are not text: the name gets U+FFFD in their place (so it cannot grow when it
//   is written as JSON), and an email or a provider id that holds one is refused.
// - name: trimmed and limited to 100 code points, never cutting a surrogate pair. When the name is
//   empty once cleaned, the provider's fallback (the GitHub login, the Google email) takes its
//   place BEFORE the limit applies.
// - email: at most 254 characters (UTF-16 code units), no whitespace, no control character and an
//   '@' with something on each side; anything else is no email at all: email '' and
//   emailVerified false.
// - picture: kept only as an absolute https: URL of at most 512 characters, written in printable
//   ASCII (a URL on the wire is; this also bounds its size inside the token), without credentials
//   (no userinfo before the host, not even an empty one); otherwise ''. The account page and the
//   token then carry no picture.
// - handle: at most 100 characters, only ASCII letters, digits, '-', '_' and '.'; otherwise ''.
//   It is dropped, not cut: half a login names somebody else.
// - providerId: a non-empty string of at most 128 characters without control characters or lone
//   surrogates, kept exactly as given (it is the key of the identity). Otherwise the whole answer
//   is a `ProviderError`, like any other malformed answer: the callback shows
//   `provider.unavailable` and nothing is created or stored.
//
// With every field at its limit and written to cost the most (a name of four-byte characters, an
// address of three-byte ones, a picture of characters JSON escapes) the token is about 3400
// characters; a test builds it. That is the margin the ASCII rule on the picture buys: a picture
// of three-byte characters would take the token to about 4050, too close to the 4096 of the
// verifier and of a cookie, where the name of the cookie counts too.

/** The limits of the rules above. */
export const PROFILE_LIMITS = {
  /** Code points. */
  name: 100,
  /** UTF-16 code units, as `String.length` counts them. */
  email: 254,
  picture: 512,
  handle: 100,
  providerId: 128,
} as const;

const LABELS: Readonly<Record<Provider, string>> = { github: "GitHub", google: "Google" };

/** Whether the text holds a code point below 0x20 or 0x7f. */
function hasControl(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function stripControl(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0x20 && code !== 0x7f) out += value[i];
  }
  return out;
}

/** A surrogate that is not half of a pair (with the `u` flag a proper pair is one code point). */
const LONE_SURROGATE = /\p{Cs}/u;

/** U+FFFD, REPLACEMENT CHARACTER: what a lone surrogate of a name becomes. */
const REPLACEMENT = String.fromCodePoint(0xfffd);

/** The first `max` code points of a text: a surrogate pair is kept whole or left out. */
function firstCodePoints(value: string, max: number): string {
  let count = 0;
  let end = 0;
  for (const point of value) {
    if (count === max) break;
    count++;
    end += point.length;
  }
  return value.slice(0, end);
}

/** The name or the fallback, cleaned: no control characters, no lone surrogate, trimmed. */
function cleanName(value: string): string {
  const text = stripControl(value);
  const wellFormed = text.replace(/\p{Cs}/gu, REPLACEMENT);
  return wellFormed.trim();
}

function acceptName(name: string, fallbackName: string): string {
  const cleaned = cleanName(name);
  const chosen = cleaned !== "" ? cleaned : cleanName(fallbackName);
  return firstCodePoints(chosen, PROFILE_LIMITS.name).trim();
}

function acceptEmail(email: string): string {
  if (email.length === 0 || email.length > PROFILE_LIMITS.email) return "";
  if (hasControl(email) || /\s/u.test(email) || LONE_SURROGATE.test(email)) return "";
  const at = email.lastIndexOf("@");
  return at > 0 && at < email.length - 1 ? email : "";
}

function acceptPicture(picture: string): string {
  if (picture.length > PROFILE_LIMITS.picture || !/^[\x21-\x7e]+$/.test(picture)) return "";
  // It starts with `https://`. The authority ends at the first of `/`, `\`, `?` and `#`; any `@`
  // before that is userinfo, even an empty one, and an empty authority is no host (`https:///x`
  // parses as the host `x`).
  const authority = /^https:\/\/([^/\\?#]*)/i.exec(picture)?.[1];
  if (!authority || authority.includes("@")) return "";
  try {
    // What is left for the parser to refuse is a host that is not one (`https://a:port/`).
    const url = new URL(picture);
    return url.username === "" && url.password === "" ? picture : "";
  } catch {
    return "";
  }
}

function acceptHandle(handle: string): string {
  const cleaned = stripControl(handle);
  return cleaned.length <= PROFILE_LIMITS.handle && /^[A-Za-z0-9._-]+$/.test(cleaned)
    ? cleaned
    : "";
}

/**
 * The profile of a provider's answer under the rules above. `fallbackName` names the person when
 * the name is empty (the GitHub login, the Google email). Throws a `ProviderError`, which says
 * nothing the provider said, when the provider id is not usable.
 */
export function normalizeProfile(raw: ProviderProfile, fallbackName = ""): ProviderProfile {
  const id = raw.providerId;
  if (
    id === "" ||
    id.length > PROFILE_LIMITS.providerId ||
    hasControl(id) ||
    LONE_SURROGATE.test(id)
  ) {
    throw new ProviderError(`${LABELS[raw.provider]}: the account id is not usable`);
  }
  const email = acceptEmail(raw.email);
  return {
    provider: raw.provider,
    providerId: id,
    name: acceptName(raw.name, fallbackName),
    picture: acceptPicture(raw.picture),
    email,
    emailVerified: email !== "" && raw.emailVerified,
    handle: acceptHandle(raw.handle),
  };
}
