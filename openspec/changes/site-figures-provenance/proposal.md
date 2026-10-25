## Why

The IDE's capture procedure (`docs/ux/capturas.md` in the IDE repository) says that every figure of
the site carries descriptive alternative text and its provenance, and that the site's lint, here,
enforces both. It does not. The lint lived in the IDE's `site/` and left with it when the site
moved (the IDE's change `release-con-el-push`); `site.test.ts` only checks that the media files
exist and that no tag loads an external resource.

So a page edit can today shorten an alt text to "screenshot", drop a caption, remove the words
"simulated agent" from it, or add a picture with no provenance at all, and `pnpm test` would pass.
These are the two figures of `/ide/` and `/es/ide/`, and the rule that they are real captures over a
temporary fixture is what keeps the product page honest about what it shows.

The IDE's change `demo-animada-del-sitio` adds an animated demonstration to the same page. Its site
half is a change here, and it needs these rules to exist first.

## What Changes

- A requirement of `product-site`: every `<figure>` holds an image with a descriptive alt text and a
  caption that states the surface, the temporary fixture, the simulated agent, the state of the
  product and the platform; a picture that says something is a figure; both languages show the same
  figures.
- Checks in `packages/site/test/site.test.ts` that read every page and fail naming the page, the
  figure and what is missing.
- No page changes: both existing figures already comply, in both languages.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `product-site`: the figures are real captures, declared as such.

## Non-goals

- Video. The change that embeds the animated demonstration extends this rule, and until then a
  figure without an image fails.
- Judging what is inside the pixels. That is the human's review in the IDE's capture procedure; a
  lint cannot inspect a raster.
- A weight budget for media. It belongs to the change that adds something heavier than a PNG.

## Impact

- `packages/site/test/site.test.ts`.
- Deploys on merge only if a page changes; none does.
