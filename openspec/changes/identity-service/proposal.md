## Why

Meltemi Diagrams is adding accounts (projects that follow a person between devices, sharing,
live collaboration), and the family wants one account rather than one per product. The IDE
promises no accounts, so the account belongs to neither product: it is the identity service of
this repository, `id.meltemi.dev`, a relying party of GitHub and Google that issues a session
the products verify on their own ([decision 0002](../../../docs/decisions/0002-shared-identity.md)).

## What Changes

- New package `packages/identity`: a Cloudflare Worker in TypeScript with the routes `/login`,
  `/callback/:provider`, `/logout`, `/sessions/:sid`, `/.well-known/jwks.json`, `/account` and
  its actions, and pages in English and Spanish.
- **Sign-in**: a chooser page and the OAuth flows of GitHub (`read:user user:email`) and Google
  (`openid email profile`) with a signed `state` cookie and, for Google, PKCE; `return_to`
  restricted to `meltemi.dev` and its subdomains (development origins in development mode);
  identity resolution and linking rules (an email verified within the last 90 days, explicit
  link).
- **Sessions**: an ES256 JWT in the cookie `meltemi_session` on `.meltemi.dev`, thirty days; the
  public keys at `/.well-known/jwks.json` with rotation; `GET /sessions/:sid` for lazy
  revocation; `POST /logout`, and a confirmation page for `GET /logout`.
- **Account page**: linked providers (link; unlink all but the last), sessions ("sign out of
  other devices"), delete the account with cascade and signed `user.deleted` events to the
  products, retried from an outbox by a cron trigger.
- **Reference verifier** `src/verify.ts`: verifies a session JWT against the JWKS with caching,
  checks `iss`, `aud` and `exp`, performs the hourly session check and verifies event
  signatures; no Cloudflare dependency, usable by any product in Node or Workers.
- **Stores**: an `IdentityStore` interface with an in-memory implementation for tests and a D1
  implementation with migrations, over a `D1Like` interface so the SQL is tested with
  `node:sqlite`.
- Workspace: pnpm, TypeScript strict, vitest, eslint, prettier; `wrangler.jsonc`,
  `packages/identity/.dev.vars.example`, `pnpm identity:dev`, `pnpm identity:migrate`, `pnpm identity:keys` (an
  ES256 key pair as JWKs), `pnpm build` (the package's `dist/`, which products import).
- Documentation: `packages/identity/README.md` (the contract for products, development setup,
  the names of the secrets, the inventory of data held) and decision 0002.

## Capabilities

### New Capabilities

- `identity-sign-in`: the chooser, the provider flows, return addresses, the callback's checks,
  identity resolution and linking, localized pages under a policy.
- `identity-session`: the contract products consume: cookie, JWT, JWKS and rotation, the
  session check, signing out, the reference verifier, and the signed deletion events.
- `identity-account`: the account page: identities, sessions, deletion with cascade and events,
  form protection, and the inventory of what the service holds.

### Modified Capabilities

None: this is the first change of the repository.

## Non-goals

- The products' data, APIs, storage, quotas and permissions: each product's repository (for
  Meltemi Diagrams, `packages/cloud` in `C:\development\dac`).
- Registering the production OAuth apps at GitHub and Google, the Cloudflare zone and DNS, the
  secrets, the GitHub repository and the pipeline: the delivery change of this repository.

## Impact

- New development dependencies: `wrangler` (MIT or Apache-2.0) and `@cloudflare/workers-types`
  (MIT or Apache-2.0), approved on 2026-10-13, and the toolchain of Meltemi Diagrams
  (`typescript`, Apache-2.0; `vitest`, `eslint`, `typescript-eslint`, `@eslint/js`, `globals`,
  `eslint-config-prettier`, `prettier`, `tsx`, `@types/node`, MIT). No runtime dependency:
  JWT, cookies, HTML and HMAC are written here over WebCrypto.
- Products (first Meltemi Diagrams) implement the contract of `identity-session`: verify the
  token, keep data by `sub`, check `Origin` on state changes, handle `user.deleted`.
- The site (`product-site`) hosts the privacy notice and the terms the sign-in page names.
