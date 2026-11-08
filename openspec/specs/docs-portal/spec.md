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
Each section's sidebar SHALL list its selected user guides in the order the repository's own
index links them
(the `docs/README.md` of the language, under its `##` headings, else the repository's README),
the selected guides the index does not link after them in path order (in a folded group per
folder for those in a folder), with the titles of the pages; a page's own heading SHALL
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

### Requirement: Visible authorized administration access
The documentation header SHALL offer account navigation and a clearly labelled Administration
entry only after a live owner session is confirmed. The entry SHALL open the central `/admin/`
workspace in the page's language and remain usable on mobile. Anonymous and ordinary signed-in
visitors SHALL not see an administrative entry.

#### Scenario: Owner reads documentation
- **WHEN** the header confirms a live family-owner session
- **THEN** it shows Administration and personal account navigation without requiring a memorized URL

#### Scenario: Ordinary user or anonymous visitor
- **WHEN** the visitor is signed out or has no family-owner role
- **THEN** the header offers the appropriate account action but no visible Administration entry

### Requirement: Private navigation discovery
Personal navigation SHALL use a same-origin, private/no-store response derived from a freshly
verified identity session. Public guide HTML and search assets SHALL contain no user's profile
or role. Only the necessary session cookie SHALL reach the fixed identity navigation service;
question text, Authorization, IP and unrelated browser headers SHALL not be forwarded.

#### Scenario: Shared guide cache
- **WHEN** an owner and an anonymous visitor load the same cached guide
- **THEN** its HTML remains identical and only the owner's private navigation can display admin access

#### Scenario: Revocation or service failure
- **WHEN** authorization is revoked, a response is malformed or the identity service is unavailable
- **THEN** the client clears prior privileged navigation and retains usable guides, search and
  a generic account link

### Requirement: Search follows the current product
The portal home in either language SHALL search all user guides in that language. A product page
SHALL initially search only that product. The search dialog SHALL visibly name its scope and
offer all products or a single product, preserving the query when the scope changes. Navigation
to another product SHALL select that route's default. Filtering SHALL constrain Pagefind's
search, not merely hide rendered results. Search SHALL retain keyboard and mobile access.

#### Scenario: The same term belongs to multiple products
- **WHEN** a reader searches for a session on a Diagrams guide
- **THEN** every result belongs to Diagrams until the reader explicitly selects another scope

#### Scenario: Global search
- **WHEN** a reader searches that term on the portal home
- **THEN** matching guides from all products in the reader's language are available

#### Scenario: No result in a product
- **WHEN** a query has matches only outside the selected product
- **THEN** search shows no matching result without widening the scope automatically

### Requirement: The home's sea in motion
The home in both languages SHALL carry the still picture of the family's sea in its HTML and,
when the browser draws with WebGL2 or Canvas 2D and motion is allowed, SHALL play
`@meltemi/ocean`'s `home` state over it: the waves, the state's fleet of Meltemi marks sailing and
the wind's streamlines. The still picture SHALL give way only after the sea has drawn a frame.

#### Scenario: The sea plays
- **WHEN** the English home is opened in Chrome at 1280 px without reduced motion
- **THEN** the sea's canvas has drawn frames, the still picture is hidden, and six marks are
  placed on the waves

#### Scenario: A phone
- **WHEN** the Spanish home is opened at 375 px
- **THEN** the sea draws within the page's width, with no horizontal scroll

#### Scenario: No drawing surface
- **WHEN** the browser offers neither WebGL2 nor Canvas 2D, or runs no script
- **THEN** the still picture stays, the marks stay hidden, and the page reports no error

### Requirement: The home's sea can be stopped
A pause button named in the page's language SHALL stop and restart the sea's motion, and the sea
SHALL request no animation frame while it is out of view or the document is hidden.

#### Scenario: Paused
- **WHEN** the reader presses the button named "Pause animation"
- **THEN** the canvas draws no further frame, the button is pressed and named "Play animation",
  and pressing it again draws frames again

#### Scenario: The Spanish button
- **WHEN** the Spanish home plays its sea
- **THEN** its button is named "Pausar animación"

#### Scenario: Out of view
- **WHEN** the reader scrolls the sea out of view
- **THEN** its frame count stays the same until it is in view again

### Requirement: The home's sea under reduced motion
Under reduced motion the home SHALL show the still picture of the reader's scheme, show no pause
button and fetch none of the sea's code.

#### Scenario: Reduced motion
- **WHEN** the home is opened with reduced motion
- **THEN** the still picture of the scheme is shown, no pause button is shown, and no request
  fetches the sea's code

### Requirement: The home's sea in the reader's scheme
The moving sea SHALL draw in the portal's `--sea-*` colours of the active scheme, and SHALL re-read
them when the theme picker or the system changes the scheme.

#### Scenario: The scheme changes
- **WHEN** the theme picker switches the home from light to dark while the sea plays
- **THEN** the sea's canvas reads the dark scheme's `--sea-point`, and the next frames use it

### Requirement: The home's sea within the policy
The sea's code SHALL be a file served from the portal's origin, and the home SHALL hold no inline
script beyond Starlight's own.

#### Scenario: The policy
- **WHEN** the built home is read
- **THEN** its sea's script is a file under `/_astro/`, and the build's inline-script hashes are
  the same as without the sea
