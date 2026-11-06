# Design

## Context

See proposal.md. Identity has live cookie-session checks, account forms, D1 and the owner
allowlist. Diagrams already implements administration APIs, transactional audit and role checks.
Documentation pages are cached static assets and must not embed a visitor's account or role.

## Visual and interaction direction

**Visual thesis:** a calm Meltemi application workspace with a clear brand anchor, useful density,
quiet separators and one blue action accent; settings occupy the working surface rather than a
centered sign-in card.

**Content plan:** persistent product/account navigation, compact account header, current section
title and real status/actions, followed by the relevant people, settings or activity rows. No
invented traffic, spend, account directories or publication counts.

**Interaction thesis:** native accessible account disclosure, precise focus/hover/active
navigation transitions and saved-state feedback. Responsive navigation and tables preserve the
primary action; reduced motion removes transitions. Sign-in and confirmation pages keep the
existing compact layout.

## Decisions

1. **One application at `/admin/`.** Owners see family controls and all product administration.
   Existing Diagrams administrators/invitees access only the operations their product role grants;
   that role does not grant the owner-only Docs control. Personal pages remain available to every
   signed-in user through the same shell. A collection of external product-panel links was rejected
   by the owner: the operations are rendered and submitted in this application.
2. **Private product adapter.** Identity binds to Diagrams' named `Administration` Worker
   entrypoint. Requests contain only the validated session bearer, a fixed allowlisted operation
   and its bounded data. Diagrams validates the session freshly and reuses its current handlers,
   per-action ACL and audit. No provider token, service secret or product database is copied into
   identity. The adapter has no public route and is absent from local Docker.
3. **Actual available operations.** The central product pages implement invitations, admin removal
   and self-leave, invitation acceptance/decline, exact account resolution, explicit permission
   grants/revocations, sponsorship records and publication takedown. Recent activity is labelled as
   the latest fifty entries. Role-derived entitlement is distinct from an explicit grant. Deployment
   configuration is shown only when supplied by the service; unsupported edits are not invented.
4. **Browser forms stay at identity.** Every mutation checks the live cookie session, exact
   identity Origin, session-bound CSRF, explicit action/target and validated input before calling
   the product. Account/email lookup is POSTed, not placed in identity URLs or invocation logs.
   Sensitive responses use no-store and never log request bodies or product response contents.
5. **Preferences are independent data.** Add a user-keyed preferences row with nullable display
   name override, theme `system|light|dark` and language `system|en|es`. Provider sign-in still
   refreshes the original provider profile. Column-specific writes preserve concurrent settings;
   deletion removes preferences in the existing atomic deletion. Effective display name is used
   for views and newly issued JWTs. Updating it re-signs the current live SID without extending
   its original iat/exp. No token claim is added.
6. **Language and appearance.** Explicit `?lang` wins over a saved language, then browser language.
   The validated theme is rendered as an HTML attribute and CSS; no inline script or new CSP
   privilege is needed. Preferences initially govern this central application; product-specific
   editor options remain in their owning product rather than being overwritten silently.
7. **Private discovery, public guides.** Docs' header uses a same-origin `/api/account-menu` request.
   Its Worker forwards only the session cookie to identity's fixed `/api/navigation` endpoint.
   Identity returns minimal authenticated/name/owner state from live authorization. All outcomes
   are private/no-store and vary by Cookie. The client clears old privileged state before refreshing
   and on account changes; errors leave the generic account link and no Administration link.
   Public guide HTML, search assets and AI control requests receive no account profile.
8. **Existing costs and boundaries.** Reuse current Workers, D1, service bindings and brand tokens.
   IDE remains local and has no hosted admin backend; its actual distribution information and
   documentation belong in the product context, not fabricated remote machine settings.

## Packages and contracts

Hosted production and staging have independent product data and grants. The central workspace
uses an explicit validated `environment=staging` selection and separate fixed
`DIAGRAMS_ADMIN`/`DIAGRAMS_ADMIN_STAGING` service bindings, with no fallback between them.
Every product form and navigation preserves the selection; the hosted product entry carries
its own environment. Unknown or duplicated selections are rejected before service calls.

- Identity: `renderAppPage`, preferences/store/session composition, `/admin/` and product sections,
  personal profile/preferences routes, `/api/navigation` and a private diagrams service client.
- Docs: Header/AccountMenu, client navigation, `/api/account-menu`, existing IDENTITY binding.
- Diagrams: coordinated private administration entrypoint and eventual hosted panel consolidation.
- Browser authentication remains the existing family cookie; products still consume the existing
  JWT/JWKS/session/deletion-event contract.

## Risks / Trade-offs

- Product outage → central account and Docs controls stay usable; product pages show a real retry
  state and never report an empty list or successful save.
- Legacy panel retirement → deploy the private backend first, the central application second and
  the product navigation consolidation last, verifying each boundary.
- Profile/name races → atomic targeted preference writes and preserved session claims.
- Shared-cache leaks → no personal HTML in Docs assets, no-store navigation, no auth-role cache.
- Long identities and dense tables → wrapping metadata, labelled table scrolling and mobile tests.

## Local verification

Handlers run in Node against memory and SQLite stores, fake private service bindings and generated
sessions; no test contacts providers or AI. Browser fixtures cover owner, product administrator,
invitee, ordinary user, revoked sessions and outages in EN/ES, both themes, mobile and keyboard.
An actual workerd check validates service-binding transport and unavailable-service behavior.
