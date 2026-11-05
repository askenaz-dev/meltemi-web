# Design

## Context

See proposal.md for motivation. Identity already owns authentication, account forms, D1 and the
Secrets Store. The existing `ADMIN_SUBS` allowlist identifies the family owner. Docs serves guides
as static assets; only questions invoke Workers AI. Builds also embed changed passages with AI.

## Goals / Non-Goals

Provide an operational stop without a redeploy and preserve that choice across deployments.
Use the current account and no new provider, dependency, paid plan or credential. Product-specific
administration remains in its product repository.

## Decisions

1. **Administration lives at `id.meltemi.dev/admin/docs-ai`.** Reuse identity's live session
   verification, owner allowlist, exact issuer Origin and session-bound CSRF protection. The
   account page links the control only for owners. Alternatives were another Docs login/store
   or Diagrams' admin: both duplicate or cross product boundaries unnecessarily.
2. **Keep one boolean in identity's existing D1.** A seed enables it only on first creation;
   deployments never reset an off state. Reads use the primary database without caching. A
   failed/missing read blocks AI. A setting in Wrangler would require a redeploy and could be
   overwritten; KV propagation would delay an emergency stop.
3. **Publish only `{enabled:boolean}` at `GET /api/docs-ai`, with no-store.** Docs uses an HTTP
   service binding to identity; build checks use the fixed identity HTTPS URL. Neither request
   carries a question, a cookie, an answer or account data. Docs exposes its own same-origin
   `GET /api/ask/status` for the dialog. No public mutation endpoint is introduced.
4. **Check before each AI operation.** Runtime checks before embedding and again before
   generation; builds check before every live batch. Off and unavailable have distinct reasons
   from exhausted allowance. Already-started calls may complete; a stop cannot recall them.
5. **Keep cached embeddings while off.** The build indexes only current passages with cached
   vectors and omits uncached passages; static content and Pagefind continue normally. Re-enabling
   immediately restores questions against the available index. The next enabled publication
   fills missing embeddings. No stale document content is reused.
6. **Offline verification.** Memory and SQLite adapters test the same state transitions. Fake
   AI, service bindings, fetch and browser fixtures prove no paid calls occur while stopped.
   Development fixture mode remains explicitly offline and never deploys.

## Risks / Trade-offs

- Identity unavailable → only AI fails closed; assets and browser search bypass this dependency.
- Concurrent calls already authorized → document the bounded in-flight work; recheck before the
  next generation or batch rather than promise cancellation of requests already accepted by AI.
- Off builds without cached vectors → omit Ask until a subsequent enabled build has an index;
  the operator guide explains this, and guides/search remain available.
- This switch is not a billing cap or plan monitor → keep Workers Free; upgrading the Cloudflare
  plan remains a separate explicit account action.

## Delivery

Apply the identity schema before uploading identity, then build and deploy Docs with its identity
binding through the existing approved-main workflow. Keep the persisted flag enabled. Validate
local enabled/off/unavailable cases with fakes; do not send production test questions to AI.
