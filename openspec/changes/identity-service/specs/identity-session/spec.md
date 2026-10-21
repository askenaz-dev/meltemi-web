## ADDED Requirements

### Requirement: The session cookie and token
After a completed sign-in the service SHALL set the cookie `meltemi_session` with
`Domain=<COOKIE_DOMAIN>`, `Path=/`, `Max-Age=2592000`, `Secure`, `HttpOnly` and `SameSite=Lax`
(in development mode: no `Domain`, and no `Secure` on `http:`), holding a JWT signed with ES256
whose header carries `kid` and `typ: "JWT"` and whose claims are `iss` (`ISSUER`), `aud`
(`meltemi`), `sub` (the user id), `sid` (the session id, 32 random bytes in base64url), `name`,
`picture`, `email`, `email_verified`, `iat` and `exp` equal to `iat` plus thirty days. A session
row with the same `sid` and expiry SHALL exist.

#### Scenario: Cookie attributes
- **WHEN** a sign-in completes against the production configuration
- **THEN** the `Set-Cookie` header names `meltemi_session` with `Domain=meltemi.dev`, `Path=/`, `Max-Age=2592000`, `Secure`, `HttpOnly` and `SameSite=Lax`

#### Scenario: Claims verify with the published key
- **WHEN** the token of a fresh session is verified with the keys of `/.well-known/jwks.json`
- **THEN** the signature holds and the claims carry `iss`, `aud=meltemi`, `sub`, `sid`, `name`, `picture`, `email`, `email_verified`, `iat` and `exp = iat + 2592000`

#### Scenario: A tampered token fails
- **WHEN** one character of the token's payload is changed
- **THEN** verification fails

### Requirement: Public keys and rotation
`GET /.well-known/jwks.json` SHALL return `{ "keys": [...] }` with every public key of
`SESSION_PUBLIC_KEYS`, current first, each with `kty: "EC"`, `crv: "P-256"`, `use: "sig"`,
`alg: "ES256"`, `kid`, `x` and `y`, with `Cache-Control: public, max-age=3600`. A token signed
with a previous key SHALL verify while that key is published, and a token whose `kid` is not
published SHALL fail. `pnpm identity:keys` SHALL print a new pair as a private JWK and a public
JWK, both with the same `kid`, and never write them to a file.

#### Scenario: Two keys during rotation
- **WHEN** `SESSION_PUBLIC_KEYS` holds the new key and the previous one, and the private key is the new one
- **THEN** a token signed earlier with the previous key verifies and a new token carries the new `kid`

#### Scenario: Unknown kid
- **WHEN** a token's `kid` names no published key
- **THEN** verification fails even if the signature was made with a valid key of the same curve

### Requirement: The session check
`GET /sessions/<sid>` SHALL answer 204 with no body when the session exists, is not revoked and
has not expired, updating its last-seen time, and 404 otherwise, including for malformed ids;
both with `Cache-Control: no-store`; no authentication SHALL be required. The reference
verifier SHALL call it at most once per hour per session and verifier instance (its cache is in
memory, so per isolate in Workers).

#### Scenario: A live session
- **WHEN** the `sid` of a fresh session is checked
- **THEN** the answer is 204 and the session's last-seen time is the request's time

#### Scenario: A revoked session
- **WHEN** the session was revoked by `POST /logout`
- **THEN** the answer is 404

#### Scenario: A malformed id
- **WHEN** the path is `/sessions/not-base64url!`
- **THEN** the answer is 404 and nothing is logged beyond the platform's defaults

### Requirement: Signing out
`POST /logout` SHALL revoke the session named by a valid `meltemi_session` cookie, clear the
cookie, and redirect to `return_to` (validated like a sign-in's return address; `SITE_URL` by
default). It SHALL accept requests whose `Origin` is a host under `COOKIE_DOMAIN` (or a
development origin in development mode) and answer 403 to any other origin without changing
anything. Without a valid cookie it SHALL still clear the cookie and redirect. `GET /logout`
SHALL show a confirmation page whose form posts to `/logout` with the same `return_to`, served
with `Referrer-Policy: same-origin` and a `form-action` naming `'self'`, `https://meltemi.dev`
and `https://*.meltemi.dev` (and the origins of `DEV_ORIGINS` in development mode), so that the
redirect following the post is allowed by browsers that apply `form-action` to it.

#### Scenario: A product signs the person out
- **WHEN** a form on `https://diagrams.meltemi.dev` posts to `/logout` with `return_to=https://diagrams.meltemi.dev/`
- **THEN** the session is revoked, the cookie is cleared with `Max-Age=0`, and the response is a 302 to `https://diagrams.meltemi.dev/`

#### Scenario: A foreign origin is refused
- **WHEN** the `Origin` header is `https://evil.example`
- **THEN** the answer is 403 and the session stays live

#### Scenario: The confirmation page
- **WHEN** `GET /logout?return_to=https://meltemi.dev/` is requested
- **THEN** the page shows a form posting to `/logout` with a hidden `return_to` of that address, and the response carries `Referrer-Policy: same-origin` and a policy whose `form-action` is `'self' https://meltemi.dev https://*.meltemi.dev`

### Requirement: A reference verifier for products
The package SHALL export, with no Cloudflare dependency and usable in Node 22 and in Workers,
`parseSessionCookie(cookieHeader)` returning the token; `sessionVerifier(options)` with the
options `issuer?: string` (default `https://id.meltemi.dev`; the token's `iss` SHALL equal it),
`jwks: JsonWebKeySet | string | (() => Promise<JsonWebKeySet>)` (inline, a URL, or a function),
`fetch?: typeof fetch` (default `globalThis.fetch`, used for a URL `jwks` and the session
check), `checkSession?: boolean | ((sid: string) => Promise<boolean>)` (default `true`, which
is `GET <issuer>/sessions/<sid>`) `cacheMs?: number` (default `3_600_000`, for both the
JWKS and each session check) and `fetchTimeoutMs?: number` (default `5000`: a request of the
verifier's own that takes longer counts as a failure), whose `verifySession(token, now?)` returns the claims when the
signature, `iss`, `aud`, `exp` and `iat` (sixty seconds of leeway) hold and the session check
passes, and `undefined` otherwise; and `verifyEventSignature(secret, body, header)` for the
deletion events. `verifySession` SHALL reject, before any key lookup, a header whose `alg` is
not exactly `ES256` or whose `typ` is not `JWT`; SHALL use only JWKS entries with `kty` `EC`,
`crv` `P-256`, `use` `sig` (and `alg` `ES256` when present); SHALL refetch the JWKS on an
unknown `kid` at most once per minute per verifier, however many unknown `kid`s arrive; SHALL
return `undefined` when the session check fails or throws; and SHALL compare signatures and
HMACs in constant time (`crypto.subtle.verify`, `timingSafeEqual`). The caches SHALL belong to
the verifier instance, so each session is checked at most once per `cacheMs` per instance.

#### Scenario: A valid token
- **WHEN** a fresh token is verified with the service's JWKS and a session check that answers 204
- **THEN** the claims are returned and the session check is called once for two verifications within the hour

#### Scenario: `alg: none` is refused
- **WHEN** a token whose header is `{ "alg": "none", "typ": "JWT", "kid": <a published kid> }` and whose signature part is empty is verified
- **THEN** `verifySession` returns `undefined` and no key is looked up

#### Scenario: `alg: HS256` with the public key is refused
- **WHEN** a token is signed with HMAC-SHA256 using the published public JWK as the secret and carries `alg: "HS256"`
- **THEN** `verifySession` returns `undefined`

#### Scenario: Unknown kids do not flood the service
- **WHEN** ten tokens with ten distinct unknown `kid`s are verified within one minute
- **THEN** the JWKS is fetched once more, not ten times, and every verification returns `undefined`

#### Scenario: A throwing session check
- **WHEN** the `fetch` given to the verifier throws on `GET <issuer>/sessions/<sid>`
- **THEN** `verifySession` returns `undefined` and the failure is not cached as a success

#### Scenario: A request that never answers
- **WHEN** the `fetch` given to the verifier never answers a session check, or a key set address, and five seconds pass
- **THEN** `verifySession` returns `undefined`, the request was aborted through its signal, and the failure is not cached

#### Scenario: Expired
- **WHEN** the clock is past `exp` plus sixty seconds
- **THEN** `verifySession` returns `undefined`

#### Scenario: A rotated key
- **WHEN** the cached JWKS lacks the token's `kid` and the service now publishes it
- **THEN** the verifier refetches once and the token verifies

#### Scenario: Revocation seen within the hour
- **WHEN** a session is revoked after a successful verification
- **THEN** a verification an hour later returns `undefined`

### Requirement: Test support for products
The package SHALL export `@meltemi/identity/testing` with `testKeys()` (a generated ES256 pair
as JWKs with a `kid`), `signSessionToken(claims, keys, now)` producing a token the reference
verifier accepts, and `testJwks(keys)`; none of it SHALL be reachable from the Worker entry, and
a product's tests SHALL be able to mint a session for a fake person without the service running.
`signSessionToken` SHALL fill every claim it is not given: `iss` `https://id.meltemi.dev`,
`aud` `meltemi`, `sid` random, `iat` = `now`, `exp` = `now` + 30 days, `name`, `picture` and
`email` `""`, `email_verified` `false`; any claim given SHALL override its default.

#### Scenario: A product mints a test session
- **WHEN** a test calls `signSessionToken({ sub: "u1", name: "Ana" }, keys, now)` and verifies it with `sessionVerifier({ jwks: () => testJwks(keys), checkSession: false })`
- **THEN** the claims come back with `sub` `u1`, `name` `Ana`, `iss` `https://id.meltemi.dev`, `aud` `meltemi`, a `sid`, `picture` and `email` empty, `email_verified` false and the thirty-day expiry

#### Scenario: A product passes its own issuer
- **WHEN** a test calls `signSessionToken({ sub: "u1", iss: "http://localhost:8787", picture: "http://localhost:8788/avatar.png" }, keys, now)` and verifies it with `sessionVerifier({ issuer: "http://localhost:8787", jwks: testJwks(keys), checkSession: false })`
- **THEN** the claims come back with that `iss` and `picture`, and the same token verified with the default `issuer` returns `undefined`

#### Scenario: Not in the Worker
- **WHEN** the Worker bundle is built
- **THEN** it contains no reference to the testing module

### Requirement: Deletion events reach every product
When an account is deleted the service SHALL enqueue, for every product in `PRODUCTS`, an event
`{ "id": "evt_<random>", "type": "user.deleted", "sub": "<user id>", "at": "<ISO time>" }` and
deliver it by `POST` to the product's `events` address with `Content-Type: application/json`,
`Meltemi-Event-Id` and `Meltemi-Signature: v1=<hex HMAC-SHA256 of the body with
EVENTS_SECRET_<NAME>>`, waiting at most ten seconds. A `2xx` SHALL mark it delivered; otherwise
the next attempt SHALL be at 1 minute, 5 minutes, 30 minutes, 2 hours, then every 6 hours, until
seven days after creation, when the event SHALL be marked failed and reported with
`console.error`. The scheduled handler SHALL run deliveries every fifteen minutes and deliver
at most 100 events per run.

#### Scenario: Delivered and verifiable
- **WHEN** an account is deleted and the product's endpoint answers 200
- **THEN** the product received one request whose signature `verifyEventSignature` accepts with the product's secret, and the event is marked delivered

#### Scenario: The product is down, then up
- **WHEN** the endpoint answers 503 on the first attempt and 200 on the second
- **THEN** the second attempt happens about one minute after the first and the event is marked delivered with two attempts

#### Scenario: Given up after seven days
- **WHEN** every attempt fails for seven days
- **THEN** the event is marked failed, an error line names its id and product, and no further attempt is made

#### Scenario: A bad signature is rejected by the verifier
- **WHEN** `verifyEventSignature` is given a body and a signature made with another secret
- **THEN** it returns false
