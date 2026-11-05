# 0007. The documentation portal: the released docs of the family, one site, with search and questions

Status: accepted (owner, 4 November 2026; the `docs-portal` change)

## Context

The family's documentation is Markdown in each repository: Meltemi Diagrams has sixty guides in
English and Spanish (`docs/` and its mirror `docs/es/`), the IDE some seventy guides and reports,
in English or in Spanish, with no index of its own, and this repository the family's map and its
decisions. Readers met it as files on GitHub, through the site's "Read the documentation" buttons:
no table of contents across pages, no search, no language switch, pictures written as code. On
2026-11-04 the owner asked for a portal at a `docs` address of `meltemi.dev`, in both languages,
with search and a box that answers questions from the pages.

## Decision

- **The portal lives here**, as `packages/docs`, beside the site it extends, and is served at
  `docs.meltemi.dev` by the Worker `meltemi-docs`: static pages, and one route of code,
  `POST /api/ask`. Terraform declares the Worker and its Custom Domain, staged by `docs_deployed`
  as the apex was by `site_on_apex`.
- **Its sources are the releases.** At deploy the build asks GitHub for each product's latest
  published release (its `main` while it has none) and reads `docs/` and the readmes from that
  release's archive, with a tar reader of this repository; this repository's section comes from
  the source being deployed. A portal page therefore says what a release holds, and names that
  release in its footer. The products' release workflows start this repository's deploy, so a
  release reaches the portal on its own.
- **The content is generated.** A Starlight site (Astro, MIT) whose `src/content/docs/` the build
  writes from the sources: titles, descriptions, links, media and the sidebar come from the
  products' own Markdown and indexes by fixed rules, each tested on a fixture. A guide in one
  language is shown in the other locale as a one-sentence notice with a link; nothing is machine
  translated.
- **Pictures from the code.** A `text` fence that the Diagrams command line exports is followed
  by its picture, drawn at build; a fragment stays code. The product docs need no new markup.
- **Search in the reader's browser** (Pagefind, which Starlight bundles), in each language.
- **Ask the docs with Workers AI.** The build embeds every page's passages with `@cf/baai/bge-m3`
  through Cloudflare's API (the web's deploy token gains "Workers AI Read") and writes the index
  as a file of the portal's assets: sign bits for a first pass, int8 vectors for the rescoring,
  and the passages' text. A question costs one embedding and one answer from a small model, both
  inside the Free plan's daily allowance and the Worker's CPU limit; it is never logged or stored,
  and the privacy notice says so. Without Workers AI at build the portal deploys with its search
  and without the Ask button.
- **The family's identity**: the site's tokens, name and value, the lockup with a "Docs" pill as
  Diagrams wears its "DIAGRAMS" one, the home's still sea from `@meltemi/ocean`, light and dark
  with a switch, a phone's width, reduced motion, every page readable without JavaScript, a
  Content-Security-Policy of the portal's own origin, no cookie, no analytics.

## Alternatives considered

- **A hand-written static generator** over a Markdown library: every feature of a documentation
  site (sidebar, search, locales, theme switch) to write and keep.
- **Docusaurus or VitePress**: heavier (React) or as capable (Vue), without Pagefind and fallback
  locales built in.
- **The products' `main` branches**, or git submodules: a portal ahead of what people can
  install, or a commit here for every release.
- **GitHub's contents API**: one request per file, under its rate limit.
- **Vectorize or AI Search** for the index: resources Terraform cannot declare (or created in the
  dashboard), a second service per question, citations undocumented.
- **Float vectors searched in full**: twelve megabytes and over the Worker's CPU limit.
- **A `meltemi` fence tag** for pictures: a change to the products' files, where detecting by
  exporting needs none.

## Consequences

- `packages/docs` depends on `astro` 7.3.8 and `@astrojs/starlight` 0.42.9 (MIT, with Pagefind),
  and, for development, on `@meltemi/diagrams-cli` 1.11.7 (MIT). Astro 7.3 keeps the workspace's
  Node floor of 22.12; 7.4 raised it to 22.23.4.
- `pnpm build` builds the portal too: from the fixture on CI, from the sibling checkouts on the
  owner's machine (slower the first time; pictures and embeddings are cached in `.cache/`).
- The deploy has a `docs` job after the site's; a product whose documentation cannot be read
  fails that job and leaves the portal as it was.
- A day's free allowance answers some four hundred questions; past it the dialog says so and
  offers the search.
- "Open in the app" under a picture, the products' readmes linking the portal, and the content
  and translation of the products' documentation stay with the products' repositories.
