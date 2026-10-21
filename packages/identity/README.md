# `@meltemi/identity`

The shared identity service of the Meltemi family, at `id.meltemi.dev`: sign-in with GitHub and
Google, a signed session every product can verify on its own, the account page, deletion events
to the products, and the reference verifier products use. A Cloudflare Worker of plain functions
with a D1 database and a cron trigger; it runs and is tested entirely on a laptop.

The decisions are in [`docs/decisions/0002`](../../docs/decisions/0002-shared-identity.md) and
[`0003`](../../docs/decisions/0003-family-web-on-cloudflare.md); the requirements are the
specifications `identity-sign-in`, `identity-session` and `identity-account` of the OpenSpec
change `identity-service`. This file is the contract for products and the guide for working on
the service.

## For products

A person signs in once at `id.meltemi.dev`; the browser then carries the cookie
`meltemi_session` to every host under `meltemi.dev`. A product never sees a password or a
provider token: it verifies the cookie, keeps its data by the user id (`sub`), and hears about
deleted accounts.

### Sign in and sign out

- **Sign in:** send the browser to
  `https://id.meltemi.dev/login?return_to=<URL-encoded address>`. `return_to` must be an address
  of the family: `https:`, a host that is `meltemi.dev` or ends in `.meltemi.dev`, no port, no
  credentials, at most 2048 characters; anything else is refused with the code
  `return_to.invalid` and nothing starts. Without it the person returns to the site. `?lang=en|es`
  chooses the language of the pages (otherwise `Accept-Language`).
- **Sign out:** post a plain form to `https://id.meltemi.dev/logout` with the field `return_to`
  (same rule). The service accepts an `Origin` of any host of the family and answers `403` to any
  other (and to a request with no `Origin`). `GET /logout?return_to=…` shows a confirmation page
  with that form, so a link works too. Posting the form is how a product ends a session: clearing
  the cookie by itself leaves the session live until the next hourly check or its expiry.

### The cookie and the token

`meltemi_session` is set with `Domain=meltemi.dev; Path=/; Max-Age=2592000; Secure; HttpOnly;
SameSite=Lax` and holds a JWT signed with ES256 (header `{ "alg": "ES256", "typ": "JWT", "kid": … }`):

| Claim             | Meaning                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| `iss`             | The service's address, `https://id.meltemi.dev`                             |
| `aud`             | Always `meltemi`                                                            |
| `sub`             | The user id: what a product keeps its data by                               |
| `sid`             | The session id, for the session check                                       |
| `name`, `picture` | Profile, as the provider gave it (limited in length); `picture` may be `""` |
| `email`           | The email of the identity used to sign in (`""` when the provider has none) |
| `email_verified`  | Whether that provider vouched for the email                                 |
| `iat`, `exp`      | Seconds since the epoch; `exp` is `iat` plus thirty days                    |

The public keys are at `https://id.meltemi.dev/.well-known/jwks.json` (`Cache-Control: public,
max-age=3600`), current key first. A key rotation publishes the new key first and keeps the old
one until its tokens expire (at most thirty days).

### Verifying a session

```ts
import { parseSessionCookie, sessionVerifier } from "@meltemi/identity";

const verifier = sessionVerifier({
  jwks: "https://id.meltemi.dev/.well-known/jwks.json",
});

export async function whoAmI(request: Request) {
  const token = parseSessionCookie(request.headers.get("Cookie"));
  return token ? verifier.verifySession(token) : undefined; // the claims, or undefined
}
```

The verifier has no Cloudflare dependency and runs in Node 22 and in Workers. Create one per
isolate or process, not per request: its caches belong to the instance. Options:

| Option           | Default                  | Meaning                                                                                                            |
| ---------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `jwks`           | (required)               | The key set: inline `{ keys }`, the address of a JWKS, or a function that returns one                              |
| `issuer`         | `https://id.meltemi.dev` | The token's `iss` must equal it; also where the session check goes                                                 |
| `fetch`          | `globalThis.fetch`       | Used for a JWKS address and the session check                                                                      |
| `checkSession`   | `true`                   | `true` asks `GET <issuer>/sessions/<sid>`; `false` skips the check; a function `(sid) => Promise<boolean>` decides |
| `cacheMs`        | `3600000` (one hour)     | How long a key set and each session check are kept                                                                 |
| `fetchTimeoutMs` | `5000`                   | How long the verifier waits for its own requests; a request that takes longer counts as a failure                  |

`verifySession(token, now?)` returns the claims or `undefined`. It rejects, in this order and
before any key is looked up, a token whose header `alg` is not exactly `ES256` or whose `typ` is
not `JWT`; then checks the signature (only JWKS entries with `kty` `EC`, `crv` `P-256` and `use`
`sig` are used; comparisons are constant-time), `iss`, `aud`, `exp` and `iat` (sixty seconds of
leeway), and last that the session is live. Details worth knowing:

- An unknown `kid` refetches the key set at most once a minute however many arrive.
- A session check that fails, throws or times out makes the session invalid and is **not**
  cached; an answer (`204` live, `404` gone) is kept for `cacheMs`, so revocation reaches a
  product within an hour. In Workers the cache is per isolate.
- Verifications that start together share one key-set fetch and one check per `sid`.
- A product that cannot reach the service in development passes its own `checkSession`.

### What a product must do

1. **Check `Origin` on every request that changes state.** Every host under `meltemi.dev` shares
   the cookie and is the same site for `SameSite`: a form on another host posts to yours with the
   cookie attached. A cookie alone is never consent.
2. **Never serve content a person wrote or uploaded from a host under `meltemi.dev`.** Such
   content goes to a separate registrable domain, or it could set or replace the family's cookie.
3. **Keep data by `sub`**, cache `name` and `picture` from the token, and handle the deletion
   event below. The service never sends a provider token.

### Deletion events

When a person deletes their account the service posts, to every product listed in its `PRODUCTS`
setting:

```http
POST <the product's events address>
Content-Type: application/json
Meltemi-Event-Id: evt_…
Meltemi-Signature: v1=<hex HMAC-SHA256 of the body, keyed with the product's events secret>

{"id":"evt_…","type":"user.deleted","sub":"<user id>","at":"2026-10-14T12:00:00.000Z"}
```

```ts
import { verifyEventSignature } from "@meltemi/identity";

const body = await request.text();
const genuine = await verifyEventSignature(
  secret, // EVENTS_SECRET_<PRODUCT> of the service = the product's own setting
  body,
  request.headers.get("Meltemi-Signature"),
);
```

Answer any `2xx` once the data is deleted. Delivery is at least once, so keep the ids of the events
you handled. A failed delivery (non-2xx, error, or no answer in ten seconds; a redirect counts as
a failure) is retried after 1 minute, 5 minutes, 30 minutes, 2 hours and then every 6 hours, until
seven days after the account was deleted, when the service gives up and logs the event's id and
product. Deliveries run from a cron trigger every fifteen minutes, at most 100 per run.

### Testing a product without the service

```ts
import { signSessionToken, testJwks, testKeys } from "@meltemi/identity/testing";
import { sessionVerifier } from "@meltemi/identity";

const keys = await testKeys(); // an ES256 pair as JWKs, with a kid
const token = await signSessionToken({ sub: "u1", name: "Ana" }, keys, new Date());
const verifier = sessionVerifier({ jwks: testJwks(keys), checkSession: false });
await verifier.verifySession(token); // { sub: "u1", name: "Ana", … }
```

`signSessionToken` fills every claim it is not given (`iss` `https://id.meltemi.dev`, `aud`
`meltemi`, a random `sid`, `iat` now, `exp` thirty days later, empty `name`, `picture` and `email`,
`email_verified` false); a claim you pass overrides its default, so pass your own `iss` and a
`picture` on your own origin when you configure another issuer. The testing module is never part of
the Worker bundle (a test checks it).

### Installing the package

The verifier and the test support are published on npm as `@meltemi/identity`, with provenance,
from this repository's release workflow:

```bash
pnpm add @meltemi/identity
```

`@meltemi/identity` exports `parseSessionCookie`, `sessionVerifier`, `verifyEventSignature` and
their types; `@meltemi/identity/testing` mints sessions and test keys for a product's own tests and
is never imported by a Worker. The package holds `dist/` only: no part of the service.

While the verifier changes, a product can work against a checkout of this repository instead of
the published version, without committing the link:

```bash
pnpm link ../meltemi-web/packages/identity
```

Run `pnpm build` here first, and again after each change: the package's `exports` point at `dist/`.

## The routes

| Route                                                                        | What                                                                                                                                                                   |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                                                                      | To `/account` when signed in, else `/login`                                                                                                                            |
| `GET /login`                                                                 | The chooser (links, never forms); with `provider=github\|google` the redirect to the provider; `return_to`, `link=1` (add a provider to the signed-in account), `lang` |
| `GET /callback/github`, `GET /callback/google`                               | Finishes the flow; sets the session cookie; redirects to `return_to`                                                                                                   |
| `GET /logout`, `POST /logout`                                                | Confirmation page; ends the session and redirects                                                                                                                      |
| `GET /sessions/<sid>`                                                        | `204` when the session is live (and bumps its last seen), else `404`                                                                                                   |
| `GET /.well-known/jwks.json`                                                 | The public keys                                                                                                                                                        |
| `GET /account`                                                               | Identities, sessions and the actions                                                                                                                                   |
| `POST /account/unlink`, `/account/sessions/revoke-others`, `/account/delete` | The account's actions; each needs `Origin` = the issuer and the page's `csrf`                                                                                          |
| `GET /identity.css`                                                          | The stylesheet of the pages                                                                                                                                            |

Pages come in English and Spanish and carry their own Content-Security-Policy. Every refusal shows a
stable code: `provider.unknown`, `return_to.invalid`, `state.mismatch`, `provider.denied`,
`provider.unavailable`, `identity.taken`, `identity.last`, `confirm.mismatch`, `request.forbidden`,
`not-found` and `internal`.

## Configuration

Variables (`wrangler.jsonc`, or `.dev.vars` in development):

| Name                                   | Meaning                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `ISSUER`                               | The service's address, `https://id.meltemi.dev` (the token's `iss`)                                                                        |
| `COOKIE_DOMAIN`                        | `meltemi.dev`                                                                                                                              |
| `SITE_URL`                             | The family's site: the default return address and home of the privacy notice and terms                                                     |
| `SESSION_PUBLIC_KEYS`                  | JSON array of public JWKs, current first                                                                                                   |
| `PRODUCTS`                             | JSON array of `{ "name", "events" }`; Meltemi Diagrams is `[{"name":"diagrams","events":"https://diagrams.meltemi.dev/_identity/events"}]` |
| `GITHUB_CLIENT_ID`, `GOOGLE_CLIENT_ID` | The OAuth apps' ids                                                                                                                        |
| `DEV`, `DEV_ORIGINS`                   | Development mode and its origins; **only in `.dev.vars`, never in `wrangler.jsonc`**                                                       |

Secrets (never in a file that is committed). In production each one is a secret of the family's
Secrets Store, declared and given its value by Terraform (`packages/infra`), and bound in
`wrangler.jsonc` under `secrets_store_secrets` as `<NAME>_STORE`; the Worker's entry
(`src/secrets.ts`) reads every such binding once per isolate into `<NAME>`, so the handlers read a
string. In development `.dev.vars` gives the strings, and a string always wins over a binding.
Nobody runs `wrangler secret put`. A service with no `SESSION_PRIVATE_KEY` or no `STATE_SECRET`
answers `500` and names the setting in the log, never on the page.

| Name                                           | Meaning                                                                                                                                      |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET` | The OAuth apps' secrets                                                                                                                      |
| `SESSION_PRIVATE_KEY`                          | The private JWK (with `kid`) that signs sessions                                                                                             |
| `STATE_SECRET`                                 | Signs the `meltemi_oauth` cookie and the account forms' `csrf`                                                                               |
| `EVENTS_SECRET_<PRODUCT>`                      | Signs one product's events; the name upper-cased (`EVENTS_SECRET_DIAGRAMS`). The product's own `IDENTITY_EVENTS_SECRET` holds the same value |

`pnpm identity:keys` prints a new signing pair and writes nothing to a file. To rotate, set the new
private key as `SESSION_PRIVATE_KEY` and put its public key **first** in `SESSION_PUBLIC_KEYS`,
keeping the old public key there for thirty days.

## Working on the service

Nothing here needs the cloud. From `C:\meltemi`:

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Every test runs in Node with an in-memory store (and the D1 store over `node:sqlite`), generated
keys, a fake clock and stub providers; none opens a network connection.

### Signing in with GitHub and Google on this machine

This is the manual check before archiving the change (tasks 2.6, 2.8 and 5.2):

1. **Register two development OAuth apps** (the owner's accounts): at GitHub, _Settings › Developer
   settings › OAuth Apps_, with the callback `http://localhost:8787/callback/github`; at Google
   Cloud, _APIs & Services › Credentials › OAuth client ID_ (web application) with the authorized
   redirect URI `http://localhost:8787/callback/google` and a consent screen whose scopes are
   `openid`, `email` and `profile`.
2. `cp packages/identity/.dev.vars.example packages/identity/.dev.vars` and fill it in: the two
   client ids and secrets; `pnpm identity:keys` for `SESSION_PRIVATE_KEY` and
   `SESSION_PUBLIC_KEYS`; any long random text for `STATE_SECRET` and `EVENTS_SECRET_DIAGRAMS`.
   `.dev.vars` is ignored by Git.
3. `pnpm identity:migrate --local` (answer `y`): creates the local D1 under
   `packages/identity/.wrangler/state`.
4. `pnpm identity:dev` serves `http://localhost:8787`.
5. In Edge or Chrome open
   `http://localhost:8787/login?return_to=http://localhost:8787/account`, choose a provider and
   approve. You land on the account page; the developer tools show the cookie `meltemi_session`
   (`HttpOnly`, `SameSite=Lax`, no `Domain` in development).
6. Sign in with the other provider too, and from the account page link and unlink it; check
   _Sign out of other devices_ in a second browser.
7. Open `http://localhost:8787/logout?return_to=http://localhost:8787/login`, confirm, and check
   that you land on `/login` with the cookie gone.
8. To watch a deletion event arrive, serve something on `http://localhost:8788/_identity/events`
   (Meltemi Diagrams will), delete an account, restart the service as
   `pnpm identity:dev --test-scheduled` and visit
   `http://localhost:8787/__scheduled?cron=*/15+*+*+*+*`: that runs the cron trigger, which
   posts the signed event.

In development mode (`DEV=true`) cookies have no `Domain` and no `Secure` on `http:`, the origins
of `DEV_ORIGINS` and the service's own origin are accepted as return addresses and `Origin`s, and
the pages' `form-action` lists them.

## What the service holds

Exactly four tables (`migrations/0001_identity.sql`), all `STRICT`:

| Table        | Columns                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `users`      | `id`, `name`, `picture`, `created_at`                                                                 |
| `identities` | `provider`, `provider_id`, `user_id`, `email`, `email_verified`, `verified_at`, `handle`, `linked_at` |
| `sessions`   | `sid`, `user_id`, `created_at`, `last_seen`, `expires_at`, `label`, `revoked_at`                      |
| `outbox`     | `id`, `product`, `body`, `created_at`, `attempts`, `next_at`, `delivered_at`, `failed_at`             |

`verified_at` is the time the provider last reported the email verified (`NULL` while it is not);
an email only joins two identities into one account when it was verified within the last ninety
days. A session `label` is a coarse family such as `Edge on Windows`.

The service **never** stores a provider token (an access token is used once to read the profile and
dropped), a raw `User-Agent` (only the label above), a password (there are none), or an analytics
record. Deleting an account removes its user, identities and sessions in one step and queues the
deletion events; the outbox keeps its events until they are delivered or given up. Sessions that
ended more than seven days ago are removed by the scheduled run.

## Layout

```
packages/identity/
├── wrangler.jsonc          main, D1 binding DB, cron */15, vars (no DEV, no secrets)
├── .dev.vars.example       every name of Env with development values; copy to .dev.vars (ignored)
├── migrations/             0001_identity.sql: users, identities, sessions, outbox
├── scripts/keys.mjs        pnpm identity:keys: an ES256 pair as JWKs (prints, writes nothing)
├── tsconfig.build.json     pnpm build: dist/ (verify.js, testing.js and their .d.ts), what exports point at
├── src/
│   ├── worker.ts           the Cloudflare entry (fetch, scheduled)
│   ├── handler.ts          identity(request, env, deps): the routes
│   ├── routes/             one module per route; providers/ github.ts, google.ts
│   ├── resolve.ts  session.ts  jwt.ts  events.ts  forms.ts  return-to.ts  config.ts
│   ├── store/              types.ts, memory.ts, d1.ts
│   ├── pages/  messages/   HTML pages and the en/es catalogs
│   ├── verify.ts           the reference verifier (package main export, no Cloudflare dependency)
│   └── testing.ts          @meltemi/identity/testing: keys and a signer for products' tests
└── test/                   vitest, in-memory and node:sqlite stores, stub providers, generated keys
```
