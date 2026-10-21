## ADDED Requirements

### Requirement: Sign-in through GitHub or Google
`GET /login` without `provider` SHALL show a page offering GitHub and Google as links to
`/login?provider=github` and `/login?provider=google` (never as forms), in English or Spanish,
with links to the privacy notice and the terms at `<SITE_URL>/privacy/` and `<SITE_URL>/terms/`
(`<SITE_URL>/es/privacy/` and `<SITE_URL>/es/terms/` on the Spanish page). With
`provider=github|google` it SHALL set the cookie `meltemi_oauth` (`Path=/callback`,
`Max-Age=600`, `HttpOnly`, `Secure`, `SameSite=Lax`; a signed value holding the provider, the
return address, a random `state` and, for Google, a PKCE verifier) and redirect to the provider's
authorization endpoint with the client id, the callback `/callback/<provider>`, the `state`, the
scopes `read:user user:email` (GitHub) or `openid email profile` (Google), and for Google a
`S256` code challenge. The service SHALL offer no password and no other provider. `/login`
SHALL run the provider flow even for a signed-in person, and a completed flow SHALL replace the
session.

#### Scenario: The chooser links, never posts
- **WHEN** `GET /login` is requested
- **THEN** the page holds `<a href="/login?provider=github">` and `<a href="/login?provider=google">`, no `<form>`, and links to `https://meltemi.dev/privacy/` and `https://meltemi.dev/terms/`

#### Scenario: Redirect to GitHub
- **WHEN** `GET /login?provider=github&return_to=https://diagrams.meltemi.dev/` is requested
- **THEN** the response is a 302 to `https://github.com/login/oauth/authorize` carrying `client_id`, `redirect_uri=https://id.meltemi.dev/callback/github`, `scope=read:user user:email` and a `state`, and sets `meltemi_oauth` with `Path=/callback`, `HttpOnly`, `Secure`, `SameSite=Lax` and `Max-Age=600`

#### Scenario: Google gets a code challenge
- **WHEN** `GET /login?provider=google` is requested
- **THEN** the redirect to `https://accounts.google.com/o/oauth2/v2/auth` carries `code_challenge_method=S256` and a `code_challenge`, and the cookie holds the verifier

#### Scenario: Unknown provider
- **WHEN** `GET /login?provider=facebook` is requested
- **THEN** the response is a 400 page with the code `provider.unknown` and no cookie is set

### Requirement: Return addresses stay in the family
`return_to` SHALL be accepted only as an absolute `https:` URL without credentials whose host is
`COOKIE_DOMAIN` or ends with `.` followed by it; in development mode (`DEV=true`) the origins in
`DEV_ORIGINS` SHALL also be accepted. Without `return_to`, the address SHALL be `SITE_URL`. A
refused address SHALL be answered with a 400 page with the code `return_to.invalid`, with no
cookie and no redirect. The same rule SHALL apply wherever a return address is read (`/login`,
`/logout`).

#### Scenario: A subdomain is accepted
- **WHEN** `return_to` is `https://diagrams.meltemi.dev/p/abc?x=1`
- **THEN** the flow starts and, once completed, ends with a redirect to exactly that address

#### Scenario: A foreign host is refused
- **WHEN** `return_to` is `https://meltemi.dev.evil.example/` or `https://user@meltemi.dev/`
- **THEN** the response is a 400 page with `return_to.invalid` and no cookie is set

#### Scenario: Development origins only in development mode
- **WHEN** `return_to` is `http://localhost:8788/` and `DEV_ORIGINS` names `http://localhost:8788`
- **THEN** it is accepted when `DEV` is `true` and refused with `return_to.invalid` otherwise

### Requirement: The callback checks what comes back
`GET /callback/<provider>` SHALL require the `meltemi_oauth` cookie with a valid signature, the
same provider and a `state` equal to the query's; it SHALL exchange the code at the provider's
token endpoint from the Worker with the client secret, read the profile (GitHub: `/user` and the
primary verified email of `/user/emails`; Google: `userinfo`), and SHALL keep no provider token
once the profile is read. It SHALL clear the cookie whatever the outcome. The provider's
`error=access_denied` SHALL show a page with the code `provider.denied` and a link to try again;
a missing or mismatched `state` a 400 page with `state.mismatch`; a failed exchange or profile
request a 502 page with `provider.unavailable`. Every provider request SHALL go through the
injected `fetch`.

#### Scenario: Mismatched state
- **WHEN** the callback arrives with a `state` that differs from the cookie's
- **THEN** the response is a 400 page with `state.mismatch`, the cookie is cleared and no session exists

#### Scenario: The person declined
- **WHEN** the callback arrives with `error=access_denied`
- **THEN** the response is a page with `provider.denied` and a link to `/login` with the same return address, and no session exists

#### Scenario: The provider is down
- **WHEN** the token endpoint answers 503
- **THEN** the response is a 502 page with `provider.unavailable` and no user or session was created

#### Scenario: No provider token kept
- **WHEN** a sign-in completes
- **THEN** the store holds no field with the provider's access token and the test's stub token never appears in any stored value

### Requirement: One person, several providers
On a completed callback the service SHALL resolve the identity `(provider, provider id)` as
follows: an existing identity signs in its user and refreshes name, picture, email,
verification and, when the provider reports the email verified, its `verified_at`; a new
identity with the `link` flag and a valid current session attaches to that user whatever its
email, unless it belongs to another user (`identity.taken`); a new identity whose email the
provider verified and that an existing identity holds verified with a `verified_at` within the
last 90 days attaches to that identity's user; otherwise a new user and identity are created,
with `verified_at` set when the email is verified. When the merge failed only because the
matching identity's `verified_at` is older than 90 days, the callback SHALL sign the new user in
and, instead of redirecting, show a page saying that an account with that email exists,
offering to sign in with its provider and link this identity from the account page, with a link
to the return address. An unverified email SHALL never match anything.

#### Scenario: First sign-in creates the account
- **WHEN** a GitHub identity never seen before completes the flow
- **THEN** a user exists with the profile's name and picture, one identity, and the session names that user

#### Scenario: The same identity again
- **WHEN** the same GitHub identity completes the flow with a new name
- **THEN** no user is created and the identity's name is updated

#### Scenario: Two providers, one verified mailbox
- **WHEN** a Google identity with `email_verified` true completes the flow and a user holds a GitHub identity with the same email whose `verified_at` is ten days old
- **THEN** the Google identity attaches to that user and no new user is created

#### Scenario: A stale verified email creates a new user
- **WHEN** a Google identity with `email_verified` true completes the flow and the only identity holding that email verified has a `verified_at` 91 days old
- **THEN** a new user is created, the session names it, and the response is a page saying an account with that email exists, offering to sign in with GitHub and link from the account page, and linking to the return address

#### Scenario: Unverified emails never merge
- **WHEN** a Google identity with `email_verified` false carries the email of an existing user
- **THEN** a new user is created

#### Scenario: Linking while signed in
- **WHEN** a signed-in person starts `/login?provider=google&link=1` and the new identity has a different email
- **THEN** the identity attaches to the current user; and when that identity already belongs to another user, the response is a page with `identity.taken` and nothing changes

### Requirement: Localized, escaped pages under a policy
Every page of the service SHALL be served in English or Spanish (`?lang=en|es`, else the first
of those in `Accept-Language`, else English), declare `<html lang>`, escape every value it
shows, and answer with `Content-Security-Policy: default-src 'none'; style-src 'self'; img-src
'self' https://avatars.githubusercontent.com https://*.googleusercontent.com; form-action
'self' https://meltemi.dev https://*.meltemi.dev; base-uri 'none'; frame-ancestors 'none'`
(in development mode `form-action` SHALL also list the origins of `DEV_ORIGINS`, because
Chromium applies it to the redirect that follows a form post), `Referrer-Policy: same-origin`
(never `no-referrer`, under which a same-origin form post carries `Origin: null`) and
`X-Content-Type-Options: nosniff`. Words SHALL come from typed catalogs (`en.ts`, `es.ts`).

#### Scenario: Spanish by Accept-Language
- **WHEN** `GET /login` is requested with `Accept-Language: es-CL,es;q=0.9,en;q=0.8`
- **THEN** the page is in Spanish with `<html lang="es">` and links to `https://meltemi.dev/es/privacy/` and `https://meltemi.dev/es/terms/`

#### Scenario: The headers of a page with forms
- **WHEN** `GET /account` is requested by a signed-in person against the production configuration
- **THEN** the response carries `Referrer-Policy: same-origin` and a `Content-Security-Policy` whose `form-action` is exactly `'self' https://meltemi.dev https://*.meltemi.dev`

#### Scenario: Development origins in the policy only in development mode
- **WHEN** `DEV_ORIGINS` is `http://localhost:8788,http://localhost:8789` and `GET /logout` is requested
- **THEN** `form-action` also lists both origins when `DEV` is `true`, and lists neither otherwise

#### Scenario: An unsupported language falls back
- **WHEN** `GET /login?lang=fr` is requested
- **THEN** the page is in English

#### Scenario: A name is text, never markup
- **WHEN** the account page shows a user whose name is `<b>x</b>`
- **THEN** the HTML contains `&lt;b&gt;x&lt;/b&gt;` and the policy headers are present
