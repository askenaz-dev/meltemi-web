# docs-portal Specification

## Purpose
The documentation portal at docs.meltemi.dev: the released documentation of the family's three repositories as one site in English and Spanish, with sections, sidebars, pictures, search, theme and headers, as a reader sees it.

## Requirements

### Requirement: One portal, three sections, two languages
The portal SHALL serve `/`, `/diagrams/`, `/ide/` and `/web/` and their twins under `/es/`, each
section from one repository's documentation, with a home that names the three products and
links their sections; every page SHALL carry a title, a language picker, a sidebar of its
section and the section's release in its footer. A page that exists in one language only SHALL
be served in both locales, the other one carrying a one-sentence notice and a link to it.

#### Scenario: A guide in both languages
- **WHEN** the fixture's `diagrams/docs/player.md` and `diagrams/docs/es/player.md` are built
- **THEN** `/diagrams/player/` and `/es/diagrams/player/` exist, each with a link to the other as
  its language picker and "From Meltemi Diagrams v1.11.0" ("Desde Meltemi Diagrams v1.11.0") in
  the footer

#### Scenario: A guide in Spanish only
- **WHEN** the fixture's `ide/docs/quickstart.md` is built
- **THEN** `/es/ide/quickstart/` holds the guide and `/ide/quickstart/` holds its title, the
  sentence "This guide exists in Spanish only." and a link to `/es/ide/quickstart/`

#### Scenario: A page without a heading
- **WHEN** a source page has no `# Heading`
- **THEN** the build fails naming the page and that a title could not be read

### Requirement: The language picker works without a script
Every page's language picker SHALL be a link to the page's twin in the other language, marked
with that language, so a reader changes language with no script.

#### Scenario: The picker of a guide
- **WHEN** `/diagrams/player/` is read with JavaScript off
- **THEN** its picker is a link to `/es/diagrams/player/` marked `hreflang="es"`

#### Scenario: A page whose picker leads nowhere
- **WHEN** the checks find a page whose picker does not lead to its twin
- **THEN** `pnpm test` fails naming the page and the twin it lacks

### Requirement: The sidebar follows the index
Each section's sidebar SHALL list its pages in the order the repository's own index links them
(the `docs/README.md` of the language, under its `##` headings, else the repository's README),
the pages the index does not link after them in path order (in a folded group per folder for
those in a folder), with the titles of the pages; a page's own heading SHALL
not be repeated in its body.

#### Scenario: The index's order
- **WHEN** the fixture's Diagrams index links `getting-started.md`, then `features.md`, then
  `language/stories.md`, and `cli.md` is not linked
- **THEN** the Diagrams sidebar reads Getting started, Features, Stories, then The command line

#### Scenario: A link to a page that does not exist
- **WHEN** the fixture index links `missing.md`
- **THEN** the build fails naming the index and the link

### Requirement: Pictures from the code
A `text` fence that is a Meltemi source the Diagrams command line can export SHALL be followed
by its picture, an SVG with an `alt` from the page's title; a fence that does not export SHALL
stay code alone.

#### Scenario: A diagram drawn
- **WHEN** the fixture's `language/stories.md` holds the purchase story's source in a `text`
  fence
- **THEN** the page shows the fence and, under it, a `<figure>` holding an `<svg>` with the
  `client` and `api` boxes

#### Scenario: A fragment stays code
- **WHEN** a `text` fence holds `reveal client, api over 800ms` alone
- **THEN** the page shows the fence and no figure, and the build reports nothing

### Requirement: Search in the reader's browser
The portal SHALL offer full-text search of the pages of the reader's language, run in the
browser from a static index with no request to any other host, and SHALL answer an empty query
with nothing.

#### Scenario: A word found
- **WHEN** the reader searches "purchase" on the fixture build in English
- **THEN** the results list the Stories page and no Spanish page

#### Scenario: Nothing typed
- **WHEN** the search box is opened and left empty
- **THEN** no result is shown and no part of the index is fetched

### Requirement: Headers, no tracking and no external resource
Every response SHALL carry a Content-Security-Policy that allows scripts, styles, fonts, images
and connections from the portal's own origin only (WebAssembly from it, data images), with
`frame-ancestors 'none'`, and the site's referrer, content-type, permissions and transport
headers; no page SHALL set a cookie, load a resource from another host or include analytics.

#### Scenario: The headers of a page
- **WHEN** `/diagrams/player/` is served by `wrangler dev`
- **THEN** its `Content-Security-Policy` has `default-src 'none'`, `connect-src 'self'` and
  `frame-ancestors 'none'`, and no `Set-Cookie`

#### Scenario: An external script would fail the checks
- **WHEN** a built page references `https://example.com/x.js`
- **THEN** `pnpm test` fails naming the page and the address

### Requirement: The family's looks and motion
The portal SHALL take its colours from the family's tokens (equal, name and value, to the
site's), show the lockup, offer light and dark schemes following the system with a toggle, and
move its dialogs over the family's motion token with nothing moving under reduced motion.

#### Scenario: The tokens
- **WHEN** the tokens check compares the portal's `tokens.css` with the site's
- **THEN** every token is equal, name and value

#### Scenario: Reduced motion
- **WHEN** the Ask dialog opens with `prefers-reduced-motion: reduce`
- **THEN** its transition duration is 0 s
