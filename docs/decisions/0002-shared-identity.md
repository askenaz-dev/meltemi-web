# 0002. Shared identity: GitHub and Google, a signed session, no passwords

Status: accepted (identity-service change, 13 October 2026)

## Context

Meltemi Diagrams is adding accounts so that a person's projects follow them between devices,
and sharing and collaboration need to know who someone is. The owner wants one account for the
family and no identity provider of their own to host: no password store, no reset flows, no
breach surface. The audience has GitHub; Google widens it. Auth0, Clerk and Supabase were
weighed: free tiers with vendor branding, another origin in every product's policy, pricing
that changes, and in Supabase's case projects that pause when idle.

## Decision

- **GitHub and Google only.** The providers are the identity; this service is their relying
  party: the OAuth dance, a user record, sessions. No passwords, ever. A new provider is a
  change to this service, not to the products.
- **A signed session in a domain cookie.** `meltemi_session` on `.meltemi.dev` carries an ES256
  JWT (`iss https://id.meltemi.dev`, `aud meltemi`, `sub`, `sid`, profile claims, `exp` thirty
  days). Products verify it with the public keys at `/.well-known/jwks.json` and need no call to
  sign a person in. Keys rotate by publishing two.
- **Lazy revocation.** Sessions are rows; `GET /sessions/:sid` answers 204 or 404, and each
  verifier instance of a product asks at most once an hour per session. Signing out everywhere
  or deleting the account takes effect within the hour, and the JWT alone never lives past
  thirty days.
- **One person, several providers.** An identity is `(provider, provider id)`. A new identity
  joins an existing account when its email is verified by the provider and already belongs to
  that account as an email verified within the last ninety days, or when the person links it
  from the account page while signed in; otherwise it is a new account. Unverified or stale
  emails never merge accounts.
- **Deletion reaches the products.** Deleting the account deletes everything here and sends a
  signed `user.deleted` event to each product, retried for seven days.
- **The service holds little.** User id, name, avatar URL, the emails and ids the providers
  gave, sessions, pending events. No analytics, no telemetry, no provider token kept after the
  profile is read.

## Alternatives considered

- **A third-party identity platform** (Auth0, Clerk, Supabase Auth): nothing to host, but a
  vendor's origin and branding in every product, limits that move, and a second platform next
  to Cloudflare.
- **Email and password.** The widest reach, and a password database, resets, rate limits and a
  breach surface the owner does not want; the providers already solve it.
- **Opaque session ids resolved by the service on every request.** The simplest revocation, and
  one network call per request in every product.
- **Short access tokens with a refresh cookie.** Immediate revocation, and a renewal every few
  minutes that would interrupt a live editor; the hourly check gives the same guarantee at a
  fraction of the traffic.
- **Ed25519 signatures.** Smaller keys; ES256 is supported by every WebCrypto, including the
  products' runtimes and Node.

## Consequences

- Products keep their own data by `sub`, cache `name` and `picture` from the token, handle the
  `user.deleted` event, and check `Origin` on state changes because every host under
  `meltemi.dev` shares the cookie. They never see a provider token.
- The family needs `meltemi.dev` on Cloudflare for the shared cookie; `*.workers.dev` cannot
  carry one (decision 0003).
- A privacy notice and terms exist on the site (`product-site`), named from the sign-in page
  and required by Google's consent screen.
- The reference verifier is strict: `alg` `ES256` and `typ` `JWT` before any key lookup, only
  P-256 signing keys from the JWKS, a refetch on an unknown `kid` at most once a minute,
  constant-time comparisons, a failing session check treated as no session, and caching per
  verifier instance (the hourly check is per instance, not per session). Pages with forms send
  `Referrer-Policy: same-origin`, since `no-referrer` makes a same-origin form post carry
  `Origin: null`, and a `form-action` naming the family's origins, since Chromium applies it to
  the redirect after a submission. A verified email merges a new identity into an existing
  account only when that account's identity reported the email verified within the last 90 days
  (`verified_at`); otherwise the person gets a new account and is offered to sign in with the
  existing provider and link from the account page.
