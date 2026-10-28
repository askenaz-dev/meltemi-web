# state-as-it-is

> Fast path: the home's "Honest state of each product" table and the Diagrams page's "What depends
> on an account" table say three parts do not exist that the products ship today. From the owner's
> review of 2026-10-28.

## Why

The site promises honesty about what exists. Checked against the repositories and the live
services on 2026-10-28:

- **Sign-in with GitHub or Google** is live: `https://id.meltemi.dev/login` offers both, and the
  GitHub start answers a redirect to `github.com/login/oauth/authorize` with the production
  callback `https://id.meltemi.dev/callback/github`. The home says "In development".
- **Meltemi Diagrams' account, cloud projects, sharing, editing together, catalogs and the
  command line's push and pull** are built and deployed: the changes `cloud-accounts`,
  `cloud-projects`, `sharing-and-permissions`, `live-collaboration`, `live-sessions`,
  `cli-cloud` and `account-panel` are archived in the Diagrams repository (2026-10-15 to 23),
  `packages/cloud` deploys its main and publish Workers from `main`, and
  `https://diagrams.meltemi.dev/api/session` answers with the sign-in address. The home says
  "Not yet — specified, not built" and the Diagrams page says "Specified, not released" on five
  rows.
- **The IDE's desktop client** is in development, as the home says: installers ship with every
  release and the signing of MSI and DMG is still pending in the IDE's plan.

## What Changes

- The home's notice, lead sentence and the two rows (Diagrams' account parts, the family's
  sign-in) say these are live, in English and Spanish.
- The Diagrams page's notice and its five account rows say they are available with an account,
  each with what it is, in both languages.
- A test pins the state of every row to what was verified, dated, so a row that drifts fails
  naming it.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `product-site`: the Diagrams page's account paragraph and table state what the products ship,
  and the home's state table is checked.

## Impact

- `packages/site/public/{index.html, es/index.html, diagrams/index.html, es/diagrams/index.html}`,
  `test/site.test.ts`.
- No dependency.

## Non-goals

- The products' own pages and documentation of these features: the Diagrams repository.
- Signing the IDE's installers: the IDE repository.
