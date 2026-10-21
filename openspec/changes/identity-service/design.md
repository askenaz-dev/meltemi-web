## Context

There is no identity code anywhere in the family yet. Meltemi Diagrams will be the first
consumer (projects in the cloud, sharing, collaboration); the IDE will never be one; the site
links to both. The owner wants GitHub and Google sign-in, no passwords and no identity vendor,
and the whole service must run and be tested locally before any cloud resource exists
(decision 0001). Cloudflare's free plan gives a Worker, a D1 database and cron triggers
(decision 0003); the shared cookie needs every host under one registrable domain,
`meltemi.dev`.

## Goals / Non-Goals

**Goals:**

- One account for the family, created by signing in with GitHub or Google; nothing to remember.
- A session a product verifies on its own, with no call per request, and a revocation that
  takes effect within an hour.
- An account page where a person sees what is linked and where they are signed in, links or
  unlinks providers, signs out of other devices, and deletes everything.
- A service that holds little, says what it holds, and tells every product when an account goes.
- Plain functions, in-memory stores and stub providers, so every test runs in Node.

**Non-Goals:**

- Products' data and permissions; organisations; passwords; other providers.
- Registration of the production OAuth apps at the providers, DNS and secrets (the delivery
  change); the development apps are the owner's and come before the manual slice.

## Decisions

### A Worker of plain functions

`packages/identity/src/handler.ts` exports `identity(request, env, deps): Promise<Response>`
and `scheduled(env, deps): Promise<void>`. `src/worker.ts` is the Cloudflare entry: it builds
`deps` from the bindings (D1 store, WebCrypto keys, `fetch`, `Date`) and exports `fetch` and
`scheduled`. Tests call `identity` with `memoryStore()`, `stubProviders()` and generated keys.

```ts
interface Deps {
  readonly fetch: typeof fetch;          // the providers and the products' event addresses
  now(): Date;
  randomBytes(length: number): Uint8Array;
  readonly store: IdentityStore;
  readonly keys: SigningKeys;            // private key (kid) and the public keys to publish
}
```

`Env` (from `wrangler.jsonc`): vars `ISSUER` (`https://id.meltemi.dev`), `COOKIE_DOMAIN`
(`meltemi.dev`), `SITE_URL` (`https://meltemi.dev`, the default return address and the home of
the privacy notice and terms), `SESSION_PUBLIC_KEYS` (JSON array of public JWKs, current
first), `PRODUCTS` (JSON array of `{ name, events }`; Meltemi Diagrams is
`[{"name":"diagrams","events":"https://diagrams.meltemi.dev/_identity/events"}]`),
`GITHUB_CLIENT_ID`, `GOOGLE_CLIENT_ID`, `DEV` (`"true"` only in `.dev.vars`), `DEV_ORIGINS`
(comma-separated); secrets `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET`,
`SESSION_PRIVATE_KEY` (a private JWK with `kid`), `STATE_SECRET` (HMAC key for the `state`
cookie and the form tokens), `EVENTS_SECRET_<NAME>` per product, the name upper-cased
(`EVENTS_SECRET_DIAGRAMS`; Diagrams' `IDENTITY_EVENTS_SECRET` holds the same value); binding
`DB` (D1); trigger `crons: ["*/15 * * * *"]`. `.dev.vars` overrides `ISSUER`, `SITE_URL`,
`DEV_ORIGINS` and `PRODUCTS` with the development values (see Development mode).

### Routes

| Route | Purpose |
| --- | --- |
| `GET /` | Redirect to `/account` when signed in, else to `/login` |
| `GET /login` | The chooser; with `provider=`, the redirect to the provider |
| `GET /callback/github`, `GET /callback/google` | Finish the flow, sign in, set the cookie, redirect |
| `GET /logout` | A confirmation page with the form |
| `POST /logout` | Revoke the session, clear the cookie, redirect |
| `GET /sessions/:sid` | 204 when the session is live, 404 otherwise |
| `GET /.well-known/jwks.json` | The public keys |
| `GET /account` | The account page |
| `POST /account/unlink`, `POST /account/sessions/revoke-others`, `POST /account/delete` | Account actions |
| `GET /identity.css` | The stylesheet of the pages |
| scheduled | Deliver the outbox |

### The provider flows

`GET /login?provider=github` sets the cookie `meltemi_oauth` (`Path=/callback`, `Max-Age=600`,
`HttpOnly`, `Secure`, `SameSite=Lax`; its value is base64url JSON `{ provider, returnTo, state,
verifier?, link?, issued }` followed by `.` and its HMAC-SHA256 with `STATE_SECRET`) and
redirects to the provider's authorization endpoint: GitHub
`https://github.com/login/oauth/authorize` with `client_id`, `redirect_uri`, `scope=read:user
user:email`, `state`; Google `https://accounts.google.com/o/oauth2/v2/auth` with `client_id`,
`redirect_uri`, `response_type=code`, `scope=openid email profile`, `state`,
`code_challenge` (`S256`) and `code_challenge_method`. `Lax` cookies travel on the top-level
`GET` the provider sends the browser back with.

The callback requires the cookie, a valid signature, the same provider and the same `state`;
then exchanges the code from the Worker (GitHub `https://github.com/login/oauth/access_token`
with `Accept: application/json`; Google `https://oauth2.googleapis.com/token` with the
verifier), reads the profile (GitHub `GET https://api.github.com/user` and
`GET https://api.github.com/user/emails`, the primary verified email; Google
`GET https://openidconnect.googleapis.com/v1/userinfo`: `sub`, `email`, `email_verified`,
`name`, `picture`), and forgets the provider's tokens. Every provider request goes through
`deps.fetch`, so tests answer them with stubs; the `User-Agent` is `meltemi-identity`.

### Identity resolution

An identity is `(provider, providerId)`; a user has one or more. On a callback:

1. The identity exists: sign in as its user; refresh `name`, `picture`, `email`,
   `email_verified`, `handle` and `verifiedAt` (column `verified_at`: the time the provider
   last reported the email verified, `null` while it is not).
2. It does not exist and the cookie carries `link` and the request carries a valid session:
   attach the identity to that user, whatever its email. An identity attached to another user
   is refused (`identity.taken`); nothing merges.
3. It does not exist and the provider reports a verified email that an existing identity holds
   verified with a `verifiedAt` within the last 90 days: attach to that identity's user (two
   providers that both verified the same mailbox recently).
4. Otherwise: create the user (`name`, `picture`) and the identity with `verifiedAt` set when
   the email is verified. When rule 3 failed only because the matching identity's `verifiedAt`
   is older than 90 days, the callback signs the new user in and, instead of redirecting, shows
   a page saying that an account with that email exists, offering to sign in with its provider
   and link this identity from the account page, and linking to the return address.

Unverified emails never match anything. GitHub's email counts as verified only when the primary
email is `verified` in `/user/emails`; Google's when `email_verified` is true. The 90-day window
keeps a mailbox the person lost (reassigned or lapsed, so still "verified" on an old identity)
from merging a stranger's new identity into their account.

### Sessions and the token

A session is a row `(sid, userId, createdAt, lastSeen, expiresAt, label, revokedAt)`; `sid` is
32 random bytes in base64url; `label` is coarse, "Edge on Windows", derived from the
`User-Agent` families (Chrome, Edge, Firefox, Safari, other; Windows, macOS, Linux, Android,
iOS, other), and the raw string is never stored. `expiresAt` is thirty days after creation.

The token is a JWT: header `{ alg: "ES256", typ: "JWT", kid }`; claims `iss` (`ISSUER`), `aud`
`"meltemi"`, `sub` (the user id, `crypto.randomUUID()`), `sid`, `name`, `picture`, `email`,
`email_verified`, `iat`, `exp` (= `iat` + 30 days, the session's expiry). Signing uses
`SESSION_PRIVATE_KEY` through WebCrypto (`ECDSA`, `P-256`, `SHA-256`, raw `r‖s` signature as
JWS requires). The cookie: `meltemi_session=<jwt>; Domain=<COOKIE_DOMAIN>; Path=/;
Max-Age=2592000; Secure; HttpOnly; SameSite=Lax`. In development mode the cookie has no
`Domain` and drops `Secure` on `http:`.

Rotation: `pnpm identity:keys` generates a pair and prints the private JWK (for
`SESSION_PRIVATE_KEY`) and the public JWK (for `SESSION_PUBLIC_KEYS`, prepended); the JWKS
publishes every public key, so tokens of the previous key verify until it is removed, at most
thirty days later.

### Lazy revocation

Products verify the token locally and ask `GET /sessions/:sid` at most once an hour per
verifier instance (the cache lives in memory, so per isolate in Workers). The endpoint answers
`204` (and bumps `lastSeen`) or `404`, with `Cache-Control: no-store`, and needs no
authentication: the `sid` is a 256-bit secret known to the browser (in the HttpOnly cookie),
the service and the products.

Alternatives: resolving an opaque id on every request (one call per request in every
product); short tokens with a refresh cookie scoped to this host (a renewal every few minutes
that would interrupt a live editor, and a cookie products cannot present). Recommended: the
hourly check; it bounds revocation at one hour and costs one request per session per hour per
verifier instance.

### The reference verifier and the package's exports

`src/verify.ts` is the package's main export (`@meltemi/identity`), with no Cloudflare type in
its surface:

```ts
parseSessionCookie(cookieHeader: string | null): string | undefined
sessionVerifier({
  issuer?: string,                      // default "https://id.meltemi.dev"; must equal the token's iss
  jwks: JsonWebKeySet | string | (() => Promise<JsonWebKeySet>),  // inline, a URL, or a function
  fetch?: typeof fetch,                 // default globalThis.fetch (used for a URL jwks and the session check)
  checkSession?: boolean | ((sid: string) => Promise<boolean>),   // default true = GET <issuer>/sessions/<sid>
  cacheMs?: number,                     // default 3_600_000 for both the JWKS and each session check
  fetchTimeoutMs?: number,              // default 5000: the verifier's own requests give up after it
}): { verifySession(token: string, now?: Date): Promise<SessionClaims | undefined> }
verifyEventSignature(secret: string, body: string, header: string | null): Promise<boolean>
```

`verifySession` rejects, before any key lookup, a header whose `alg` is not exactly `ES256` or
whose `typ` is not `JWT`; uses only JWKS entries with `kty` `EC`, `crv` `P-256`, `use` `sig`
(and `alg` `ES256` when present); refetches the JWKS on an unknown `kid` at most once per
minute per verifier, however many unknown `kid`s arrive; returns `undefined` when the session
check fails or throws; and compares signatures and HMACs in constant time
(`crypto.subtle.verify`, `timingSafeEqual`). The caches are the verifier instance's, so the
session check happens at most once per hour per verifier instance; a product wanting another
policy (Diagrams skips the check in development) passes its own `checkSession`.

The package builds: `exports` is `{ ".": { "types": "./dist/verify.d.ts", "default":
"./dist/verify.js" }, "./testing": { "types": "./dist/testing.d.ts", "default":
"./dist/testing.js" } }` and `build` (`tsc -p tsconfig.build.json`, run by `pnpm build` at the
root and in the package) emits `dist/`; a consumer that links the package runs `pnpm install`
and `pnpm build` here first. Alternatives: `exports` pointing at `src/*.ts` (a consumer's `tsc`
and bundler would compile foreign sources through a pnpm `link:` realpath, and Diagrams' own
source condition is unknown to this package); publishing to npm from the start (the delivery
change does that).

### Test support for products

`src/testing.ts` is exported as `@meltemi/identity/testing` with `testKeys()` (a generated
ES256 pair as JWKs with a `kid`), `signSessionToken(claims, keys, now)` and `testJwks(keys)`.
`signSessionToken` fills every claim it is not given: `iss` `https://id.meltemi.dev`, `aud`
`meltemi`, `sid` random, `iat` = `now`, `exp` = `now` + 30 days, `name`, `picture` and `email`
`""`, `email_verified` false; any claim passed overrides its default, so a product passes its
own `iss` (its `IDENTITY_ISSUER`) and a `picture` on its own origin. `src/worker.ts` never
imports the module, and a test asserts that the built Worker bundle contains no reference to
it. Alternatives: each product keeps its own signer (two signers to keep equal); the service
running during products' tests (a network dependency). Products mint sessions with it in their
own suites.

### Signing out

`POST /logout` revokes the session of the cookie when present and valid, clears the cookie
(same attributes, `Max-Age=0`), and redirects to `return_to` (validated like sign-in, default
`SITE_URL`). It accepts an `Origin` under `meltemi.dev` (or a development origin) because
products sign people out with a plain form; any other origin gets `403`. `GET /logout` shows a
confirmation page with that form, so a link works too; its `form-action` names the family's
hosts because Chromium applies it to the redirect that follows the post. A product may also
clear the cookie itself (it is a domain cookie), but the session stays live until the hour or
the expiry; the contract asks products to post the form.

### The account page and deletion events

`GET /account` lists identities (provider, handle or email, the link date), sessions (label,
created, last seen, "this one") and the actions as forms. Every action requires `Origin` equal
to the issuer and a `csrf` field equal to the HMAC-SHA256 of the `sid` with `STATE_SECRET`
(hex, compared in constant time); otherwise `403`. Deleting requires a `confirm` field equal to
the word the page shows (`delete` or `eliminar`).

Deletion removes the user, its identities and sessions, enqueues one event per product in the
outbox, clears the cookie and shows the "account deleted" page. The outbox row holds
`(id, product, body, createdAt, attempts, nextAt, deliveredAt, failedAt)`; `scheduled` (every
fifteen minutes) posts due rows to the product's address with `Content-Type:
application/json`, `Meltemi-Event-Id` and `Meltemi-Signature: v1=<hex HMAC-SHA256 of the body
with EVENTS_SECRET_<NAME>>`, waits ten seconds, and marks delivered on `2xx`; otherwise the next
attempt is at 1 min, 5 min, 30 min, 2 h, then every 6 h, until seven days after creation, when
the row is marked failed and `console.error` names it. The body is
`{"id":"evt_<random>","type":"user.deleted","sub":"<user id>","at":"<ISO time>"}`.

### Stores

```ts
interface IdentityStore {
  userById(id): Promise<User | undefined>;
  createUser(user): Promise<void>;                      // the caller makes the id (a UUID from deps.randomBytes)
  updateUser(id, { name, picture }): Promise<void>;
  deleteUser(id, events?): Promise<void>;               // identities, sessions and the user go, and `events` are queued, in one atomic step
  identity(provider, providerId): Promise<Identity | undefined>;
  identitiesOf(userId): Promise<Identity[]>;
  addIdentity(identity): Promise<void>;
  updateIdentity(provider, providerId, patch): Promise<void>;
  unlinkProvider(userId, provider): Promise<"removed" | "last" | "absent">;  // one conditional statement: never leaves a user without an identity
  identityByVerifiedEmail(email): Promise<Identity | undefined>;  // the caller applies the 90-day window on verifiedAt
  createSession(session): Promise<void>;
  session(sid): Promise<Session | undefined>;
  touchSession(sid, at): Promise<void>;
  revokeSession(sid, at): Promise<void>;
  revokeOtherSessions(userId, keepSid, at): Promise<void>;
  sessionsOf(userId, now): Promise<Session[]>;          // live sessions, newest first
  deleteSessionsBefore(before): Promise<void>;          // the scheduled run's tidy-up of old sessions
  enqueueEvents(events): Promise<void>;
  dueEvents(now, limit): Promise<OutboxEvent[]>;
  markDelivered(id, at): Promise<void>;
  recordFailure(id, { nextAt } | { failedAt }): Promise<void>;
}
```

`memoryStore()` backs the tests; `d1Store(db: D1Like)` maps each method to SQL over a minimal
`D1Like` (`prepare(sql).bind(...).first() | all() | run()`), so the same conformance tests run
over an adapter on `node:sqlite` when Node offers it (22.13 and later; skipped otherwise) and
over `wrangler dev`'s local D1 by hand. Migrations live in `packages/identity/migrations/`;
`pnpm identity:migrate --local` applies them.

### Pages

Pages are HTML strings from `src/pages/*.ts` with one escaping function for every value and
typed message catalogs `src/messages/en.ts` and `es.ts` (the Spanish object has the English
one's type). The language is `?lang=en|es`, else the first of `en`/`es` in `Accept-Language`,
else English; `<html lang>` says which. Every page answers with `Content-Security-Policy:
default-src 'none'; style-src 'self'; img-src 'self' https://avatars.githubusercontent.com
https://*.googleusercontent.com; form-action 'self' https://meltemi.dev https://*.meltemi.dev;
base-uri 'none'; frame-ancestors 'none'` (in development mode `form-action` also lists
`DEV_ORIGINS`; Chromium applies `form-action` to the redirect that follows a form post, and
`POST /logout` redirects to a family host), `Referrer-Policy: same-origin` (under
`no-referrer` a same-origin form post carries `Origin: null`, and every account action would
answer 403), `X-Content-Type-Options: nosniff`, and `Cache-Control: no-store` when it shows
personal data. The chooser offers the providers as links (`<a href="/login?provider=github">`),
never as forms. `/identity.css` is the site's `tokens.css` plus a small stylesheet of the
pages, copied at build; the pages link the privacy notice and the terms at `<SITE_URL>/privacy/`
and `<SITE_URL>/terms/`, or `<SITE_URL>/es/privacy/` and `<SITE_URL>/es/terms/` when the page
is in Spanish.

### Development mode

`DEV=true` in `.dev.vars` (never in `wrangler.jsonc`) allows the origins of `DEV_ORIGINS`, and
the service's own origin (`ISSUER`, which the account page returns to), as return addresses and
as the `Origin` of a sign-out, allows `DEV_ORIGINS` in `form-action`, drops the cookie's
`Domain`, and drops `Secure` on `http:`. `.dev.vars` also overrides `ISSUER=http://localhost:8787` (the service's `wrangler dev`
port), `SITE_URL=http://localhost:8789` (the site's `wrangler dev` port),
`DEV_ORIGINS=http://localhost:8788,http://localhost:8789` (the Diagrams Worker and the site) and
`PRODUCTS=[{"name":"diagrams","events":"http://localhost:8788/_identity/events"}]`; the token's
`iss`, the account forms' `Origin` check and every redirect follow `ISSUER`. The development
OAuth apps (one per provider, callback `http://localhost:8787/callback/<provider>`) are the
owner's, registered before the manual slice; `.dev.vars.example` lists every name with these
values. `pnpm identity:dev` runs `wrangler dev` with a local D1.

### Open decisions

1. **How products get the verifier.** Alternatives: copy `verify.ts`; publish
   `@meltemi/identity-verifier` to npm; install from the local path with pnpm `link:` while
   developing. Recommended: the module stays here as the package's main export, built to
   `dist/` by `pnpm build`; Meltemi Diagrams links it from `C:\meltemi\packages\identity`
   (`"@meltemi/identity": "link:../../../../meltemi/packages/identity"` from its
   `packages/cloud`) during development, and the delivery change publishes it.
2. **Avatars.** Alternatives: hot-link the provider's URL; proxy and cache them. Recommended:
   hot-link (nothing stored, the policy names both hosts); products do the same.
3. **"Sign out everywhere".** Alternatives: revoke every session including the current one;
   revoke the others. Recommended: the others, so the person stays on the page; the normal
   sign-out ends this one.
4. **Email change at the provider.** Alternatives: refresh the identity's email on each
   sign-in; keep the first. Recommended: refresh, with `verifiedAt`; the merge rule uses the
   current verified email only at the moment of a new identity and only within 90 days of its
   last verification.

## Risks / Trade-offs

- **Trusting a provider's "verified".** The merge rule depends on it; GitHub's `verified` flag
  on the primary email and Google's `email_verified` are the providers' own statements, and a
  statement goes stale when the person loses the mailbox: the 90-day window on `verifiedAt`
  bounds that. The alternative, never merging, leaves people with two accounts; the explicit
  link covers that case too.
- **A domain cookie.** Every host under `meltemi.dev` receives it and is the same site for
  `SameSite`. Only the family's Workers exist there; products check `Origin` on state changes
  and never serve user-authored content under `meltemi.dev` (`docs/repositories.md`).
- **Token size.** The JWT is about 700 bytes; well under the 4 KiB cookie limit, and only
  `name`, `picture` and `email` vary.
- **Clock skew.** The verifier allows sixty seconds on `exp` and `iat`.
- **Provider outages.** The service shows `provider.unavailable` and nothing else happens; no
  retry, no queue.

## Test strategy

Every test runs in Node with vitest: `identity()` with `memoryStore()`, generated P-256 keys,
a fake clock and `stubProviders()` (a `fetch` that answers the token and profile URLs of each
provider with configured results or failures); page tests check both languages and escaping;
`verify.ts` tests use the same keys and a fake JWKS fetch (including tokens with `alg: none`
and `alg: HS256` signed with the public key); event tests use a fake product
endpoint and the fake clock to walk the retry schedule; the D1 store runs the store conformance
suite over `node:sqlite`. No test opens a network connection. `pnpm identity:dev` plus a browser
sign-in with the development apps is the manual check before archiving.
