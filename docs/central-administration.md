# Central administration

The family workspace is `https://id.meltemi.dev/admin/`. It integrates the existing hosted
Diagrams administration operations and the documentation AI control in one server-rendered
application. Personal profile, preferences, linked sign-ins and sessions use the same shell.
The public documentation header discovers the current owner privately and shows an Administration
link only to the exact `ADMIN_SUBS` allowlist.

## Authority and data

- Identity validates its live cookie, own Origin and session CSRF on every browser action.
- The private `DIAGRAMS_ADMIN` service binding addresses the named `Administration` entrypoint
  of `meltemi-diagrams-cloud`. It carries only the verified session token as a bearer credential.
  There is no browser-facing proxy, shared service secret or role forwarded by the caller.
- Diagrams independently verifies the session with no positive revocation cache, then applies
  its own current roles, limits and existing audit/storage operations. Product administration
  delegates do not acquire the family owner's Docs AI authority.
- Account/email lookup is POSTed in the browser and private service request body. Bodies, people,
  responses and tokens are never logged by the bridge. The browser sends no lookup value in a URL.
- Profile names are independent of provider refreshes. Targeted preference writes do not replace
  each other; deletion removes the preference row in the account's existing atomic transaction.
- Theme/language currently apply to the account and administration workspace. Product editor-local
  preferences retain their own scope. No remote administration is invented for the local IDE.

`GET /api/navigation` returns only `{authenticated:false}` or
`{authenticated:true,name,owner}` after a live session check. The Docs `GET /api/account-menu`
proxy forwards only `meltemi_session` to that fixed endpoint through `IDENTITY`. Both use
`Cache-Control: private, no-store` and `Vary: Cookie`. Public HTML stays generic. The client clears
old privileges before each refresh and after suspension, without storing roles in localStorage.

## Integrated operations

Production and staging are explicitly selected in the workspace. Staging uses the separate
`DIAGRAMS_ADMIN_STAGING` binding and `staging.diagrams.meltemi.dev` origin; links and forms keep
`environment=staging`. Roles and records are evaluated independently. An unavailable staging
service never falls back to production, and malformed or duplicated selections are rejected.

The Diagrams module includes owner/admin roles, invite/revoke/accept/decline, removing an
invited administrator or leaving a delegated role, exact account permission lookup and explicit
grant/revoke, sponsorship records, publication takedown and recent administrative activity.
Sponsorship and activity lists are the existing latest 50 records; they are not full directories.
No complete account or publication directory is implied by the available APIs.

Owners, OAuth configuration, origins, domains, limits, webhook secrets and platform billing
remain deployment/IaC managed where no existing safe runtime mutation API exists. The UI does
not present them as editable settings or claim to read live Cloudflare billing.
The existing documentation AI switch remains an explicit enabled/paused assignment and does
not upgrade the Workers plan, select a paid model or create a spending budget.

## Delivery order

1. Deploy the Diagrams private `Administration` entrypoint first, preserving the current public
   application. Verify fresh session checks and that the private transport is absent locally.
2. Deploy this Web change. The normal deployment applies `0003_account_preferences.sql` before
   uploading Identity, then uploads the public documentation. Test the central workspace with
   owner, delegated admin, invitee, ordinary and anonymous sessions.
3. Consolidate the hosted Diagrams administration entry into the central workspace, preserving
   unsaved-work confirmation. The local Docker product keeps its existing standalone behavior.

A missing product binding or unavailable Diagrams service shows a retryable error; account
security and the owner documentation control remain independently available. Do not merge Web
before the named Diagrams entrypoint exists in production. No infrastructure dashboard edit or
new secret is required: the Worker code deployment owns this service binding.

## Verification limits

Automated tests use generated keys, fake provider responses, in-memory stores and the actual SQL
migrations over SQLite. Browser fixtures exercise the actual Identity handlers with test sessions;
they do not represent an OAuth sign-in with a development provider application. Development
OAuth credentials must be supplied through the ignored `.dev.vars` before completing that
repository-required archival check. Production testing requires the normal reviewed deployment.
