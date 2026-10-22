## Context

- The service answers pages and forms (`src/handler.ts`): `GET /account` renders identities and
  sessions from the store (`identitiesOf`, `sessionsOf`), and `POST /account/unlink`,
  `POST /account/sessions/revoke-others` and `POST /account/delete` go through `accountAction`
  (`src/forms.ts`): a live session from the cookie, `Origin` equal to the issuer, a `csrf` field.
  The store already has `revokeSession(sid, at)` and `revokeOtherSessions(userId, keepSid, at)`.
- Products verify the session JWT with the reference verifier of this package (`src/verify.ts`:
  `parseSessionCookie`, `sessionVerifier`, `verifyEventSignature`); events to products are
  signed with `hmacHex(secret, body)` as `Meltemi-Signature: v1=<hex>` (`src/events.ts`), the
  secret being `EVENTS_SECRET_<NAME>` of `config.products` (`src/config.ts`).
- Every page carries `frame-ancestors 'none'`; `form-action` lists the family's hosts.
- The link flow is `/login?provider=<p>&link=1&return_to=<url>`: `link=1` is honoured with a live
  session, and `return_to` is any address of the family (`resolveReturnTo`). The account page
  always sends `return_to=<ISSUER>/account`.
- Meltemi Diagrams' Worker keeps the person's session cookie as a principal with `sub` and `sid`
  and calls this service for its keys and the session check, nothing else.

## Goals / Non-Goals

**Goals:** a product can show and act on the person's identities and sessions from its own
interface, through its own Worker, without the browser ever talking to this service; nothing a
browser can do with the API; the person's consent stays implied by the one thing the product
holds, their live session; the service keeps deciding what a product may do.

**Non-Goals:** an API for browsers (no CORS, ever); deleting the account or linking a provider
through the API; a product acting without the person's session (no service accounts).

## Decisions

### Two credentials, together

A call to `/api/account/*` carries `Authorization: Bearer <the person's session JWT>` and the
product's signature. The token is verified as a product verifies it (ES256 against the current key
set, `iss`, `aud`, `exp`) and its `sid` must be a live session of its `sub`; that session is "the
current one" for the call. The signature proves a product of the family made the call. A missing
or wrong signature, an unknown product or a stale timestamp is `401 product.unauthorized`, with no
hint of which; a token that does not verify or whose session is gone is `401 session.invalid`.
Cookies are ignored under `/api`: a `meltemi_session` cookie authenticates nothing there, so a
same-site page cannot drive the API with the browser's cookie. No `Access-Control-Allow-Origin` is
ever written and `OPTIONS` answers `404`. *Alternative:* the product's signature alone, naming the
`sub` (rejected: the product could act on anyone it has ever seen; the live token binds the call to
a person who is signed in through it now).

### The signature

`Meltemi-Product: <name>`, `Meltemi-Timestamp: <ISO 8601, UTC>`, `Meltemi-Signature:
v1=<hex HMAC-SHA256>` over the canonical string `"<timestamp>\n<METHOD>\n<path with query>\n<hex
SHA-256 of the body, of the empty string for none>"`, with the product's secret. The timestamp must
be within five minutes of the service's clock. A replay inside the window repeats an action that
is idempotent (a session already revoked, a provider already unlinked) and so changes nothing a
second time; a nonce cache is not kept. *Alternative:* a signed JWT per call (rejected: heavier,
and the events already use HMAC).

### The secret is the product's secret

`EVENTS_SECRET_<NAME>` signs both directions: the events the service sends to the product and the
calls the product makes to the service. It is one trust relationship between two parties; a second
secret would double what Terraform places in two Workers for no separation of consequence (both
secrets would sit in the same two places). The README names it "the product's secret" from now on.
*Alternative:* `PRODUCT_SECRET_<NAME>` (rejected for the reason above).

### What the API offers

| Call | Answer |
| --- | --- |
| `GET /api/account` | `{ user: { id, name, picture }, identities: [{ provider, email, emailVerified, handle, linkedAt }], sessions: [{ sid, label, createdAt, lastSeen, expiresAt, current }], canUnlink }` |
| `POST /api/account/unlink { provider }` | `200` the same view; `409 identity.last`; `400 provider.unknown` |
| `POST /api/account/sessions/revoke-others` | `200` the same view |
| `POST /api/account/sessions/:sid/revoke` | `200` the same view; `404 session.not-found` (another person's too); `409 session.current` |

Every action that worked answers the whole view, so a product redraws from one shape. `canUnlink`
counts providers, not identities, because the store unlinks a provider with all its identities.

`current` is the session of the presented token; `sid` is the id the product already sees in the
token. Every answer carries `Cache-Control: no-store` and `Content-Type: application/json`. Bodies
are read through an 8 KiB cap (`400 request.invalid`). Linking and deletion stay navigations:
GitHub and Google refuse to run anywhere but the top window, and deleting an account deserves the
confirmation word and the final page of this service, not a button in a product. *Alternative:*
`DELETE /api/account` (rejected: a product bug could delete accounts).

### Rate limit

At most sixty calls per minute per product and person, counted per isolate (as the verifier's
caches are); beyond it `429 rate.limited`. Best effort: it bounds a loop in a product, not an
attacker, who has no secret.

### The reference package

`src/product-call.ts` holds the canonical string, `signProductRequest({ product, secret, method,
url, body, now }) → headers` and `verifyProductRequest(request, body, secretOf, now) → { product }
| undefined`; `src/verify.ts` re-exports the signer and the API's types (`AccountView`,
`AccountIdentity`, `AccountSession`) for products; `src/testing.ts` gains `signedProductCall` so a
product's tests mint a valid call against a fake. The package becomes 0.2.0 (new exports, no change
to the verifier). WebCrypto only, as the rest.

### The page: a way back and one device at a time

`GET /account?return_to=<family url>` keeps the address through the page (a hidden field of each
form, the `return_to` of the link flow) and shows "Back to <host>" at the top; the deleted page
shows it too when the delete form carried one. Each session row that is not the current one gets
"Sign out" (`POST /account/sessions/revoke` with `sid`, under the same `accountAction` guard); the
current row keeps pointing at `/logout`.

## Risks / Trade-offs

- [A product's secret leaks] → the attacker still needs a live session token of each person they
  target, and the API cannot delete accounts or link identities; rotating the secret is the same
  Terraform step as today.
- [Clock skew between Workers] → five minutes; both run on the same platform.
- [Replay within the window] → every action is idempotent; nothing is created by the API.
- [The service is down while a product shows the panel] → the product shows that the service
  could not be reached and offers the page; this change gives products stable error codes to do so.
- [Secret reuse ties two features to one rotation] → accepted; they share the parties and the
  consequence.
