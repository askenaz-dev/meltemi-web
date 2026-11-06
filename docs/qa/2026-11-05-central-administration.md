# Central administration verification — 2026-11-05

## Implemented behavior

Identity owns one application shell for account profile, appearance/language, linked identities,
sessions, the owner documentation AI control and the existing hosted Diagrams administrative
operations. Production and staging use separate fixed private bindings, roles and records.
Documentation keeps generic public HTML and discovers owner navigation through a live private
cookie-only request. The central stylesheet has a content-derived revision in its URL so
returning visitors do not retain an older layout from the one-hour CSS cache.

## Local evidence

- Repository typecheck and lint passed. Full workspace tests passed after the product environment
  changes: 2,457 passing tests and one existing skip. The email transport correction passed the
  focused client suite and the real cross-repository composition below.
- `pnpm build` passed using the default offline fixture. The local-source portal build with
  `--from local --siblings C:/meltemi --embedder fake` also passed: 404 pages, including both new
  administration guides and their AI control links, without provider/AI calls.
- Identity's Wrangler production dry run bundled both named service bindings successfully.
  No upload, new secret, infrastructure mutation or billing change was performed.
- Docs browser suite passed all 15 groups: owner/ordinary/anonymous/unavailable/malformed states,
  EN/ES, 320/375/800/1280 widths, long escaped names, refresh/revocation/race handling, keyboard,
  search, Ask, motion, theme, policy and JavaScript-disabled guide access.
  The first remote browser run exposed a test race with the native disclosure's deferred toggle.
  The test now waits for the menu's new navigation response before asserting settled name/state;
  no timeout or assertion was weakened. The complete 15-group rerun passed locally.
- The Identity preview uses actual handlers, generated signed HttpOnly sessions, in-memory account
  data and an independent in-memory product service. HTTP checks covered 23 signed-in views.
  Native-browser review verified saving name/appearance/language, explicit staging lookup/revoke,
  unchanged production grants, global AI pause/enable, product outage with usable owner controls,
  and the account menu at 320 pixels.
- SQL/memory tests cover targeted concurrent writes, provider refresh, user isolation, deletion
  with foreign keys disabled and rollback of preferences with the account transaction. Session
  tests verify a name change preserves SID, issuance/expiry and remaining cookie age.
- Private navigation tests compose real Identity and Docs handlers, verifying saved name, account
  changes, revocation/deletion, storage failure and cookie/header minimization.
- A separate offline composition joins the actual Web and Diagrams handlers, real signed Web
  JWTs, fresh JWKS/session checks and separate product stores. It passed 52 product calls and
  204 Identity calls, with zero network traffic: owner/admin/invitee/ordinary roles, lookup,
  grant/revoke, invitations/acceptance/removal, environment isolation and immediate revocation.
  This found and fixed lookup of verified emails containing legal `/`, `%`, `?` and `#` characters;
  values remain in a constant POST body and an encoded internal route segment. Evidence lives
  in `C:/meltemi/artifacts/central-administration/wire-compatibility.json`.

The coordinated Diagrams backend passed the full product suite and actual local workerd named
entrypoint/D1 tests, including fresh revocation and persisted audit. Its evidence and protocol
are recorded in [Diagrams PR #16](https://github.com/askenaz-dev/meltemi-diagrams/pull/16).
The central application is [Web PR #31](https://github.com/askenaz-dev/meltemi-web/pull/31).
Their latest-HEAD check runs are the authoritative remote evidence; CI from a superseded SHA
does not authorize release. The initial Web run approved Node22/24 on Linux/Windows and Terraform,
and identified the disclosure-test synchronization issue described above.

Visual evidence stays outside Git in `C:/meltemi/artifacts/central-administration/`. The reviewed
console image is `account/central-workspace-es.jpg`, with `final-account-menu-320-es.jpg` and
separate Docs desktop/mobile captures. The preview listens only on `127.0.0.1:8891`; Docker on
8879 was not changed.

## Delivery and limits

Deploy the Diagrams private backend first, this Web console second, and the separate hosted
Diagrams navigation consolidation last. Both hosted backends must exist before Identity's new
bindings are deployed. No merge or production deployment is part of this verification.

The preview and automated provider tests are not a real development OAuth sign-in. No development
provider credentials were available, so the repository's real development-app sign-in requirement
remains a pre-archive check. The change stays active in OpenSpec. Production authorization and
the private bindings must be verified through the normal authenticated deployment sequence.
