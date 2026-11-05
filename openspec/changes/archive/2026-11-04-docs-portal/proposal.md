# The documentation portal

## Why

On 2026-11-04 the owner asked for a portal at a `docs` address of `meltemi.dev`: the family's
documentation is Markdown in each product's repository, read today as files on GitHub (the site's
"Read the documentation" buttons point at `tree/main/docs`), with no table of contents across
pages, no search, no language switch and no way to ask a question. Meltemi Diagrams has sixty
guides in English and Spanish, the IDE forty in Spanish, and this repository the family's map and
decisions; a reader who does not know a file's name cannot find it, and a reader who does gets raw
Markdown with pictures that are code. The portal shows the released documentation of the three
repositories as one site, in both languages, with full-text search and an "Ask the docs" box
that answers from the pages and names them.

## What changes

- **A new package `packages/docs`**, the portal at `https://docs.meltemi.dev/`: a Starlight site
  (Astro) built from the products' documentation, served as the assets of a Worker with one
  route of code. Sections `/diagrams/`, `/ide/` and `/web/` (and under `/es/`), each from one
  repository's `docs/` folder, with a sidebar in the order the repository's own index links its
  pages, the product's release named on every page, a "Source on GitHub" link, light and dark
  schemes from the family's tokens and the lockup, and no analytics, no cookies and no external
  resource. Untranslated pages are shown in the language they exist in, with a notice.
- **The sources are the releases.** At deploy the build asks GitHub for each product's latest
  published release (its `main` when there is none yet), reads `docs/` and the READMEs from the
  release's archive, and converts each page: the title from its first heading, links between
  pages rewritten to the portal's addresses and links outside `docs/` to GitHub at that tag,
  the twin-language link dropped, media copied. This repository's own docs come from the deployed
  source. Locally the build reads the sibling checkouts under `C:\meltemi`, and the tests a fixture:
  nothing in `pnpm test` reaches the network.
- **Pictures from the code.** A `text` fence that is a Meltemi source is exported with the
  Diagrams command line at build and shown as the picture under the code, so the language guides
  show what they describe.
- **Search and questions.** Full-text search in both languages (Pagefind, static, in the
  reader's browser); and **Ask the docs**: a question typed in the portal is answered by a
  Worker route that finds the closest passages in an index built at deploy (Workers AI
  embeddings of every page's passages) and asks a Workers AI model to answer in the question's
  language from those passages only, with the pages it used as numbered sources; the question
  is never stored or logged, the route is rate limited per address, and when the day's free
  allowance is spent the dialog says so and offers the search.
- **Infrastructure and pipeline.** Terraform declares the `meltemi-docs` Worker and its Custom
  Domain `docs.meltemi.dev`, adds Workers AI reading to this repository's deploy token (the build
  computes the embeddings through Cloudflare's API), and gives the Diagrams repository the same
  notice token the IDE has; the deploy workflow gains a `docs` job after the site's; the two
  products' release workflows tell the web when a release is out (the IDE's does already; the
  Diagrams one gains the job).
- **The site** links the portal: "Docs" in every header, the documentation buttons of the
  Diagrams and IDE pages, and the privacy notice's sentence on what a question sent to the
  portal's "Ask" reaches.
- **Records.** `docs/repositories.md` (the portal and its domain), README, decision note 0007.

New dependencies (approved by the owner on 2026-11-04 with this proposal's defaults):
`astro` (MIT), `@astrojs/starlight` (MIT; it brings `pagefind` and `@pagefind/default-ui`, MIT),
and `@meltemi/diagrams-cli` (MIT, the family's own, a development dependency that draws the
pictures at build). No other package: the release archives are read with a tar reader of this
repository over `node:zlib`.

## Capabilities

### New Capabilities

- `docs-portal`: the portal's pages, sections, languages, navigation, pictures, search, theme
  and headers, as a reader sees them.
- `docs-sources`: how the products' released documentation is fetched, converted and ordered
  into the portal, and how the build runs locally and in tests without the network.
- `docs-ask`: the "Ask the docs" route: its input, the index, the answer with sources, the
  limits, the privacy and what it says when it cannot answer.

### Modified Capabilities

- `product-site`: added, the links to the portal and the privacy notice's sentence on the Ask
  box.
- `family-infrastructure`: added, the docs Worker, its domain, the deploy token's Workers AI
  reading and the Diagrams repository's notice token.
- `delivery-pipeline`: added, the `docs` job of the deploy and the products' notices.

## Impact

`packages/docs` (new: the Starlight site, the fetch and conversion scripts, the index builder,
the Worker with its `/api/ask` route, the messages in both languages, tests and fixtures),
`packages/site` (the header of every page, the two product pages, the privacy notice in both
languages, the checks), `packages/infra` (`workers.tf`, `tokens.tf`, `github.tf`,
`variables.tf`, the Terraform tests), `.github/workflows/deploy.yml` and `test/workflows.test.ts`,
`docs/repositories.md`, README, one decision note; in `meltemi-diagrams`, a `tell the web` job
in `release.yml`. No change to the identity contract, to the products' APIs or storage, or to the
products' documentation files.

## Non-goals

What belongs to the product repositories: an "Open in the app" link under each picture, which
needs Meltemi Diagrams to publish the share-link encoder its app keeps private; the products'
READMEs linking the portal; the content, structure and translation of their documentation (the
portal shows what a release holds). What belongs to the `delivery` change: the registration of
the `docs` Custom Domain follows that change's `attach_domains` staging, and the notice token is
the one `var.web_dispatch_token` already carries.
