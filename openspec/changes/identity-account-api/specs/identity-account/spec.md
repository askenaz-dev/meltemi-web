## ADDED Requirements

### Requirement: The account API for products
The service SHALL answer, as JSON with `Cache-Control: no-store`, `GET /api/account` (the user's
id, name and picture; each identity's provider, email, whether it is verified, handle and link
date; each live session's `sid`, label, created, last seen, expiry and whether it is the current
one; and whether an identity may be unlinked), `POST /api/account/unlink { provider }`,
`POST /api/account/sessions/revoke-others` and `POST /api/account/sessions/:sid/revoke`, each
authenticated by a product-signed call (`identity-session`) carrying the person's session token as
a bearer; the token's session SHALL be the current one. Unlinking the last identity SHALL answer
`409 identity.last`, an unknown provider `400 provider.unknown`, revoking the current session `409
session.current`, and a session that is not the person's `404 session.not-found`; each SHALL
change nothing. Cookies SHALL authenticate nothing under `/api`, no CORS header SHALL ever be sent,
`OPTIONS` SHALL answer `404`, and more than sixty calls per minute for one product and person
SHALL answer `429 rate.limited`. Bodies SHALL be read through an 8 KiB cap (`400 request.invalid`).

#### Scenario: Read through a product
- **WHEN** a product sends a signed `GET /api/account` with the session token of a person who has a GitHub identity and two sessions
- **THEN** the answer lists the identity with its handle and link date and both sessions, the token's marked current, with `Cache-Control: no-store`

#### Scenario: One device signed out
- **WHEN** a product sends a signed `POST /api/account/sessions/<other>/revoke` with the token of the first session
- **THEN** `GET /sessions/<other>` answers 404 afterwards, the first still answers 204, and the answer lists the sessions left

#### Scenario: The current session is not revoked here
- **WHEN** the `sid` is the token's own
- **THEN** the answer is `409 session.current` and the session is live

#### Scenario: The browser's cookie does nothing
- **WHEN** `GET /api/account` arrives with a valid `meltemi_session` cookie and no bearer or signature
- **THEN** the answer is `401 product.unauthorized` and carries no `Access-Control-Allow-Origin`

#### Scenario: The last identity
- **WHEN** a product posts `{ "provider": "google" }` for a person whose only identity is Google
- **THEN** the answer is `409 identity.last` and the identity remains

### Requirement: Signing out of one device on the page
The account page SHALL offer "Sign out" on each session that is not the current one, posting
`POST /account/sessions/revoke` with the session's `sid` under the same protection as the other
account actions; the current session's row SHALL point to `/logout` instead. A `sid` that is not
the person's SHALL answer `404 session.not-found` and change nothing.

#### Scenario: Another device signed out from the page
- **WHEN** the person presses Sign out on the row of another session
- **THEN** that session answers 404 to the session check, the page lists it no more, and the current session is untouched

#### Scenario: A stranger's session
- **WHEN** the form posts a `sid` of another person
- **THEN** the answer is `404 session.not-found` and that session is live

### Requirement: A product's way in and back
`GET /account?return_to=<address>` with an address of the family SHALL show "Back to <host>" and
keep the address through the page's forms and its link flows, so that after linking a provider, or
after any action, the person returns to that address; the "account deleted" page SHALL show the
same link when the delete form carried one. An address outside the family SHALL be refused as a
return address is (`return_to.invalid`), and the page SHALL show without the link.

#### Scenario: Back to the product
- **WHEN** the page opens with `return_to=https://diagrams.meltemi.dev/?account=signins`
- **THEN** it shows "Back to diagrams.meltemi.dev" and Link GitHub starts `/login?provider=github&link=1&return_to=https%3A%2F%2Fdiagrams.meltemi.dev%2F%3Faccount%3Dsignins`

#### Scenario: After deletion
- **WHEN** the person deletes the account from a page entered with that address
- **THEN** the "account deleted" page links to `https://diagrams.meltemi.dev/?account=signins`

#### Scenario: An address outside the family
- **WHEN** the page opens with `return_to=https://example.com/`
- **THEN** the answer says the return address is not accepted and nothing links to it
