## Why

Ask keeps the backend's citation numbers in answer links, but the browser's source list uses
consecutive numbering. When returned sources skip a number, a reference such as `[6]` points to
a source displayed as item 5. A separate production answer substituted provider unlinking or
account deletion for the requested operation of signing out other sessions.

## What Changes

- Preserve each source's `n` as its native ordered-list item value.
- Exercise nonconsecutive references in the real browser dialog in English and Spanish.
- Require answers about the exact requested operation; keep session sign-out, provider unlinking
  and account deletion distinct, and use the existing not-covered response when instructions
  for that operation are absent.

No new dependencies.

## Non-goals

- Product APIs, account data and storage remain owned by the Diagrams and IDE repositories.
- Publication and deployment configuration remain owned by the delivery change.

## Capabilities

### Modified Capabilities

- `docs-ask`: source-list numbering agrees with the answer's citation links.

## Impact

`packages/docs/src/scripts/ask-dialog.ts`, `packages/docs/src/ask.ts`, the local browser regression
and the Ask specification. The endpoint response, retrieval, model selection and configuration
are unchanged.
