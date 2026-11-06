# Central administration verification — 2026-11-05

## Implemented behavior

Identity owns one application shell for account profile, appearance/language, linked identities,
sessions, the owner documentation AI control and the existing hosted Diagrams administrative
operations. Production and staging use separate fixed private bindings, roles and records.
Documentation keeps generic public HTML and discovers owner navigation through a live private
cookie-only request. The central stylesheet has a content-derived revision in its URL so
returning visitors do not retain an older layout from the one-hour CSS cache.

## Local evidence

- Repository typecheck, lint and build passed after the OAuth-context correction. Full workspace
  tests passed: 2,471 passing tests and one existing skip across 65 files. The email transport
  correction passed the focused client suite and the real cross-repository composition below.
- `pnpm build` passed using the default offline fixture. The local-source portal build with
  `--from local --siblings C:/meltemi --embedder fake` also passed: 404 pages, including both new
  administration guides and their AI control links, without provider/AI calls.
- Identity's Wrangler production dry run bundled both named service bindings successfully.
  No upload, production secret, infrastructure mutation or billing change was performed.
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
- Real development OAuth was exercised on 2026-11-06 at `http://localhost:8787` against local Wrangler and D1,
  using separate owner-approved GitHub and Google development applications. GitHub sign-in,
  linking Google, signing out, a fresh Google sign-in, unlinking GitHub while retaining Google,
  and relinking GitHub completed through the actual providers. No production OAuth secret was
  copied into this development configuration.
- A second actual browser signed in through GitHub. The account listed both Chrome and the
  in-app browser sessions. **Sign out of other devices** from Chrome left only that session;
  reloading the other browser returned it to the Spanish sign-in page with the Spanish account
  return address preserved. This was a real two-browser revocation, not a generated-session probe.
- The real linking flow exposed a lost-language return from `/account?lang=es`. The account link
  and reauthentication builders now carry the chosen language and explicit valid product
  environment through the signed return address. Focused regressions follow rendered links,
  signed OAuth state and callbacks for both providers on hosted/local origins, plus unlink,
  device revocation, reauthentication and invalid/duplicate environment refusal. Native rechecks
  confirmed Google unlink/relink returns to `/account?lang=es` in Spanish, and GitHub
  unlink/relink returns to `/account?lang=es&environment=staging` with both selections intact and
  the existing session retained.
- The final native logout check opened the Spanish confirmation, submitted **Sign out** and
  returned to the Spanish login page. The real provider and account checks did not inspect or
  export cookies or provider credentials in the browser.
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
The final real OAuth captures are `delivery/oauth-link-return-es.png`,
`delivery/oauth-link-return-es-staging.png` and `delivery/oauth-logout-local.png` beneath the
same evidence directory.

## Delivery and limits

Deploy the Diagrams private backend first, this Web console second, and the separate hosted
Diagrams navigation consolidation last. Both hosted backends must exist before Identity's new
bindings are deployed. No merge or production deployment is part of this verification.

The preview and automated provider tests are separate from the real development OAuth and
two-browser checks recorded above. The completed native checks satisfy the repository's
development sign-in requirement before archive. The `central-administration` change is archived
with its capability deltas synchronized into the main specifications. Production authorization
and the private bindings still need verification through the normal authenticated deployment
sequence.
