## Why

The agents pages of the IDE tell a visitor how to bring a model of their own and link the guide
that holds the verified recipes. That section came with the site when it left the IDE repository,
and it is the one place on those pages that says what Meltemi does not do yet: it has no engine of
its own. Nothing here guards it.

The requirement that did lived in the IDE's `product-site` specification, with its lint, and both
were removed from that repository when the site moved here (the IDE's change
`release-con-el-push`). The IDE's change `guia-modelos-locales` handed the requirement to this
repository before it was archived, so that archiving it would not recreate a site specification
there.

Today a page edit can drop the link, delete the sentence that is honest about the missing engine,
or put a vendor's name in the section, and `pnpm test` would pass.

## What Changes

- A requirement of `product-site`: the section "Your own model" of `/ide/agents/` and
  `/es/ide/agents/` links the IDE's local models guide, says that Meltemi's own engine does not
  exist yet, and names no third-party product.
- Checks in `packages/site/test/site.test.ts` that read both pages and, when they fail, name the
  page and the name.
- No page changes: both pages already carry the section.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `product-site`: the agents pages point to the guide for a model of your own, honestly.

## Non-goals

- The guide itself (`docs/local-models.md`) and its recipes belong to the IDE repository.
- A rule on third-party names for the whole site. The IDE's old lint had one; this change guards
  one section.
- Checking that the guide's address still resolves. The checks read files and use no network; see
  the design for what a rename of the guide implies.

## Impact

- `packages/site/test/site.test.ts`.
- This change's own files under `openspec/changes/agents-page-own-model/`.
