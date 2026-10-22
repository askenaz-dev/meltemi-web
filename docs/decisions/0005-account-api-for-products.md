# 0005. An account API for products, signed by the product and the person

Status: accepted (identity-account-api change, 21 October 2026)

## Context

Meltemi Diagrams wanted the account inside its own interface: a panel with the person's sign-ins,
devices, API tokens and usage, instead of sending people to `id.meltemi.dev/account` in a new tab.
The owner ruled out two ways of doing it: embedding the account page in a frame, and letting a
product's page talk to any origin but its own. What only this service holds (the identities and
the sessions) had to reach the product's Worker, which the page already talks to. Until now the
service answered pages and forms only, and products called it for its keys and the session check.

## Decision

- **An API for products, not for browsers.** `GET /api/account`, `POST /api/account/unlink`,
  `POST /api/account/sessions/revoke-others` and `POST /api/account/sessions/:sid/revoke` answer
  JSON. Cookies authenticate nothing under `/api` and the service never writes a CORS header, so
  no page can call it, whatever its origin.
- **Two credentials on every call.** The person's session token as a bearer binds the call to a
  person who is signed in through the product now; the product's HMAC signature over the time, the
  method, the path and the body proves which product calls. Either alone is refused. A product
  cannot act for someone whose token it does not hold, and a token found elsewhere is useless
  without a product's secret.
- **One secret per product, both ways.** `EVENTS_SECRET_<NAME>` signs the events the service sends
  to the product and checks the calls the product makes. It is one trust relationship between the
  same two parties; a second secret would sit in the same two places for no separation.
- **What stays a navigation.** Linking a provider runs at GitHub or Google, which refuse anything
  but the top window; deleting an account keeps its typed confirmation and its final page. Neither
  is in the API. Both accept a product's address as `return_to`, and the account page says "Back to
  <product>" and keeps it.
- **Idempotent actions and a five-minute window** instead of a nonce store: a replayed call within
  the window repeats something already done. Sixty calls a minute per product and person, counted
  per isolate, bounds a product's loop.
- **Signing out one device**, on the page and in the API: the current session still ends through
  `/logout`.

## Consequences

- `@meltemi/identity` 0.2.0 exports `signProductRequest`, `verifyProductRequest`, the API's types
  and, in `/testing`, `signedProductCall`; a product writes no part of the scheme itself.
- A leaked product secret still needs each victim's live session token and cannot delete accounts
  or link identities; rotating it is the Terraform step that already exists for the events.
- A device signed out through the API keeps working on a product until that product's verifier asks
  again, at most an hour, as with every sign-out.
