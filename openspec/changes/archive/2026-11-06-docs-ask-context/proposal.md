## Why

A documented account-session action returned a not-covered answer after the operation guard was
added. Correct instructions exist in the index, but a prompt built from isolated best hits can
omit related sections of the same guide. The historical query vector and prompt were not saved,
so the exact ranking-versus-generation cause is not established.

## What Changes

- Preserve every original ranked hit and append complete context from already selected small
  pages, atomically within per-page and additional-context budgets.
- Add a categorical response header identifying no retrieval match, model refusal or an answer.
- Test missing session instructions, scope, ordering, deduplication and both budget boundaries
  without live models.

## Capabilities

### Modified Capabilities

- `docs-ask`: bounded completion from selected pages and non-content response outcomes.

## Non-goals

Product agents and diagram operations remain in Meltemi IDE and Meltemi Diagrams. Infrastructure,
publication, OAuth registration and secrets remain with the delivery change.
