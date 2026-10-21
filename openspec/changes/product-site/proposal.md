## Why

The product site at `meltemi.dev` is the IDE's site, served by GitHub Pages from the IDE
repository's `site/` folder. The family now has two products and a shared account, and the
sign-in page and Google's consent screen need a privacy notice and terms. The site moves here
([decision 0001](../../../docs/decisions/0001-family-repositories.md)), becomes the family's
site with a page per product, and is served from Cloudflare with response headers and
redirects GitHub Pages cannot set
([decision 0003](../../../docs/decisions/0003-family-web-on-cloudflare.md)).

## What Changes

- New package `packages/site`: the static site as the assets of a Worker with no code
  (`wrangler.jsonc` with `assets`), previewed with `pnpm site:dev` (`wrangler dev` on
  `http://localhost:8789`).
- **The IDE's pages move here unchanged in content**: `index`, `method`, `agents`, `downloads`
  and their Spanish versions, the media and the two stylesheets, copied from the IDE
  repository at a named commit, now under `/ide/` and `/es/ide/`; the brand marks
  `brand/meltemi-mark-gradient.svg`, `brand/meltemi-lockup-dark.svg` and
  `brand/meltemi-lockup-light.svg`, which the IDE's release workflow stages into `site/media/`
  at publish time, are copied into `public/media/` at the same commit, so
  `/media/meltemi-mark-gradient.svg` (the favicon of every IDE page) keeps answering.
- **The family's home** at `/` and `/es/`: one brand, two products, each with its page.
- **The Diagrams page** at `/diagrams/` and `/es/diagrams/`: what it is, "Open the app"
  (`https://diagrams.meltemi.dev/`), the install commands, the extension, the repository and
  documentation, and the sentence that no account is needed and what the account adds.
- **Privacy notice and terms** at `/privacy/` and `/terms/` in both languages: what the site
  holds (nothing: no cookies, no analytics), what the identity service holds (the inventory of
  `identity-account`), what the Diagrams service holds (readable projects of signed-in people,
  deletion, sharing), and the owner's contact address.
- **Headers and redirects**: `_headers` with a Content-Security-Policy and the other security
  headers; `_redirects` so every address GitHub Pages served keeps answering with a 301; a
  `404.html`.
- **Checks** in `pnpm test`: every page exists in both languages with the same links, every
  internal link resolves, `hreflang` alternates are declared, no page carries a script or an
  external resource, every old address has a redirect, the headers file names the policy, the
  download links of `/ide/downloads/` and its twin carry no version literal and start with
  `https://github.com/askenaz-dev/meltemi/releases`, and the legal pages carry no placeholder.
- **Tokens**: `tokens.css` stays a copy of the IDE's; its header names the source commit and
  `pnpm site:tokens --ide <path>` compares every token declaration (light and dark) with
  `desktop/ui/src/app.css` of the IDE repository, refusing fewer than 30 tokens, replacing the
  token rule of the IDE's `site.rs` test.
- Documentation: `packages/site/README.md` (how to edit, both languages, tokens, preview).

## Capabilities

### New Capabilities

- `product-site`: the family's site: structure and languages, static assets under a policy,
  redirects from the old addresses, the Diagrams page, the privacy notice and terms, the tokens
  rule, preview and checks.

### Modified Capabilities

None.

## Non-goals

- DNS, the Cloudflare zone, deploying the site, retiring GitHub Pages and removing `site/` from
  the IDE repository: the delivery change of this repository (and an owner task in the IDE's).
- The products' documentation: it lives in each product's repository; the site links to it.

## Impact

- No runtime dependency; `wrangler` (already approved) for the preview; the checks are Node
  tests with no new package.
- The IDE's pages are copied verbatim at a named commit and only their links change; the new
  text in both languages is written here and read by the owner before archiving; the legal
  pages are plain-language drafts the owner reviews, with a contact address only the owner can
  provide.
- The identity service (`identity-service`) links `/privacy/` and `/terms/` from its pages.
