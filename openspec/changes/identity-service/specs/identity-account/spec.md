## ADDED Requirements

### Requirement: The account page
`GET /account` SHALL require a valid session and otherwise redirect to
`/login?return_to=<ISSUER>/account`. Signed in, it SHALL show the name and avatar, each linked
identity (provider, handle or email, and the date it was linked), the sessions (label, created,
last seen, and which one is the current), the actions as forms, and links to the privacy notice
and the terms at `<SITE_URL>/privacy/` and `<SITE_URL>/terms/` (`<SITE_URL>/es/privacy/` and
`<SITE_URL>/es/terms/` in Spanish); it SHALL answer with `Cache-Control: no-store`.

#### Scenario: Signed out
- **WHEN** `GET /account` is requested without a cookie
- **THEN** the response is a 302 to `/login?return_to=https://id.meltemi.dev/account`

#### Scenario: Signed in
- **WHEN** a person with a GitHub and a Google identity and two sessions opens the page
- **THEN** both identities are listed with their link dates, both sessions are listed, the current session is marked, and the response carries `Cache-Control: no-store`

### Requirement: Linking and unlinking providers
The page SHALL offer "Link GitHub" and "Link Google" for providers not yet linked, starting
`/login?provider=<p>&link=1&return_to=<ISSUER>/account`. `POST /account/unlink` with `provider`
SHALL remove that identity of the current user, unless it is the last one, in which case it
SHALL answer 409 with the code `identity.last` and change nothing; an unknown provider SHALL
answer 400 with `provider.unknown`.

#### Scenario: Unlink one of two
- **WHEN** a person with two identities posts `provider=google`
- **THEN** the Google identity is removed and the page lists GitHub only

#### Scenario: The last identity stays
- **WHEN** a person with one identity posts its provider
- **THEN** the answer is 409 with `identity.last` and the identity remains

### Requirement: Signing out of other devices
`POST /account/sessions/revoke-others` SHALL revoke every session of the current user except the
current one; afterwards `GET /sessions/<sid>` of each revoked session SHALL answer 404 and the
current one 204. Without a valid session it SHALL answer like `GET /account`, a 302 to
`/login?return_to=<ISSUER>/account`, and change nothing.

#### Scenario: Others revoked
- **WHEN** a person with three sessions posts the action from the second
- **THEN** the first and third answer 404 to the session check and the second answers 204

#### Scenario: Signed out
- **WHEN** `POST /account/sessions/revoke-others` arrives without a valid `meltemi_session` cookie
- **THEN** the answer is a 302 to `/login?return_to=https://id.meltemi.dev/account` and every session still answers 204 to the session check

### Requirement: Deleting the account
`POST /account/delete` SHALL require a `confirm` field equal to the word the page shows in its
language (`delete` or `eliminar`); it SHALL delete the user, its identities and its sessions,
enqueue the `user.deleted` events, clear the cookie, and show a page that says the account is
gone and that the products delete their data within seven days. A wrong or missing confirmation
SHALL answer 400 with `confirm.mismatch` and change nothing.

#### Scenario: Deleted
- **WHEN** the person posts `confirm=delete` on the English page
- **THEN** no user, identity or session with that id remains, one event per product is queued, the cookie is cleared and the "account deleted" page is shown

#### Scenario: Wrong confirmation
- **WHEN** the person posts `confirm=yes`
- **THEN** the answer is 400 with `confirm.mismatch` and everything remains

### Requirement: Form protection
Every `POST /account/*` SHALL require an `Origin` header equal to `ISSUER` and a `csrf` field
equal to the hex HMAC-SHA256 of the current `sid` with `STATE_SECRET`, which the page's forms
carry; otherwise it SHALL answer 403 with `request.forbidden` and change nothing.

#### Scenario: Cross-origin post refused
- **WHEN** `POST /account/delete` arrives with `Origin: https://diagrams.meltemi.dev` and a correct `csrf`
- **THEN** the answer is 403 with `request.forbidden` and the account remains

#### Scenario: Missing token refused
- **WHEN** `POST /account/unlink` arrives from the issuer's origin without `csrf`
- **THEN** the answer is 403 with `request.forbidden`

### Requirement: What the service holds
The service SHALL store exactly: users (id, name, picture, created), identities
(provider, provider id, user, email, email verified, verified at, handle, linked), sessions
(sid, user, created, last seen, expires, label, revoked) and outbox events; no provider token,
no raw `User-Agent`, no request log with personal data beyond the platform's defaults, no
analytics.
The migrations SHALL create exactly those tables and `packages/identity/README.md` SHALL list
this inventory.

#### Scenario: Exactly these tables
- **WHEN** the migrations run over `node:sqlite`
- **THEN** the tables are `users`, `identities`, `sessions` and `outbox` with exactly the columns above

#### Scenario: Only a coarse session label
- **WHEN** a sign-in arrives with a long `User-Agent`
- **THEN** the stored label is one of the browser-and-system families, such as `Edge on Windows`, and the raw string appears nowhere in the store
