## Why

Meltemi Diagrams is bringing the account into its own interface: a panel with the person's
profile, linked sign-ins, devices, API tokens and usage, instead of sending people to
`id.meltemi.dev/account` in a new tab. The owner ruled out embedding the page in a frame and wants
a product's page to keep talking to one origin, its own; so the product's Worker must read and
change, on the person's behalf, what only this service holds. Today the service has pages and
forms, nothing a product can call.

## What Changes

- **An account API for products.** `GET /api/account` (the person, their identities and their
  sessions), `POST /api/account/unlink`, `POST /api/account/sessions/revoke-others` and
  `POST /api/account/sessions/:sid/revoke`, JSON in and out, never cached. A call is authenticated
  by two things together: the person's own session token, presented as a bearer, and the
  product's signature over the call. Cookies are ignored under `/api`, no CORS header is ever
  sent, so a browser cannot reach it, from any origin.
- **Product-signed calls.** `Meltemi-Product`, `Meltemi-Timestamp` and `Meltemi-Signature`
  (HMAC-SHA256 with the product's secret, the one that already signs the events sent to it, over
  the timestamp, the method, the path and the hash of the body). The reference package exports
  `signProductRequest` and `verifyProductRequest`, the API's types, and a test helper that mints
  signed calls, so no product writes the scheme twice.
- **What stays on the pages.** Linking a provider is a navigation to GitHub or Google, and
  deleting the account keeps its own confirmation and its "account deleted" page: neither is in
  the API. Both flows take a product's address as `return_to`, and the account page and the
  deleted page show "Back to <product>" when they were entered with one.
- **Signing out of one device**, new on the page and in the API: a session other than the current
  one is revoked on its own; the current one is signed out with `/logout` as always.
- `packages/identity/README.md` gains "The account API" for products; decision 0005.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `identity-account`: the account API for products, signing out of one device, and a product's
  way in and back.
- `identity-session`: product-signed calls join the contract products consume and the reference
  package.

The requirements are added to the capabilities the `identity-service` change introduces; this
change is archived after it.

## Non-goals

- The product's side: the Worker routes that proxy this API, the account panel, its words and its
  policy belong to Meltemi Diagrams (`packages/cloud` and `packages/playground` in
  `C:\development\dac`).
- Publishing `@meltemi/identity` 0.2.0 to npm and placing or rotating any secret: the delivery
  change of this repository.

No new dependency.

## Impact

- `packages/identity`: `src/routes/api-account.ts` (the four routes), `src/product-call.ts`
  (the canonical string, signing and verification, shared with the reference package through
  `src/verify.ts`), `src/handler.ts` (the routes; cookies ignored under `/api`), `src/pages/account.ts`
  (per-session sign out, "Back to <product>"), `src/routes/account.ts` (`return_to` through the
  delete form), `src/messages/en.ts` and `es.ts`, `src/testing.ts` (signed calls for products'
  tests), the package's `index.ts` exports, version 0.2.0, tests, README.
- `docs/decisions/0005-account-api-for-products.md`.
