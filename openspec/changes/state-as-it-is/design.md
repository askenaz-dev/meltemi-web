# Design — state-as-it-is

## Context

Two tables describe the family's state: the home's "Honest state of each product" and the
Diagrams page's "What depends on an account". Both were written on 2026-10-13, when the account
and the Diagrams cloud were specified and not built. Both are now built and live, and the identity
service is live, so the tables are wrong in the direction a product site must never be wrong.

## Decisions

### D1. The words

- A live part says **Live** / **En producción** with the `ok` style, and its note says where:
  "Sign in at id.meltemi.dev", "In the app, with an account".
- The Diagrams page keeps "No account needed" as its heading and first row, because it stays
  true; the notice becomes "Available with an account" and names the five things signing in adds.
- The home's lead sentence "What does not exist yet, stated plainly" becomes "Where each part
  stands, stated plainly", and the notice drops "do not exist yet".

### D2. The check

`site.test.ts` holds the expected state of every row of both tables, in both languages, with the
date it was verified and how. A row whose status text differs fails naming the page and the row.
The verification is not automated against the products (no network in `pnpm test`): the test
is the record of a verification, and the next one updates it.

## Modules

- `packages/site/public/*.html` (four pages) and `packages/site/test/site.test.ts`. No script.
