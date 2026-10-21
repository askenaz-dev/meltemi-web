## ADDED Requirements

### Requirement: The family's site in two languages
`packages/site/public/` SHALL hold the pages `/`, `/ide/`, `/ide/method/`, `/ide/agents/`,
`/ide/downloads/`, `/diagrams/`, `/privacy/` and `/terms/` as `index.html` files, each with a
Spanish twin under `/es/` of the same path; every page SHALL declare `<html lang>` and
`<link rel="alternate">` for `en`, `es` and `x-default`; the home SHALL present both products
with a link to each product's page; the IDE's pages SHALL keep the content of the IDE
repository's `site/` at the commit named in `packages/site/README.md`, with only their links
changed; `public/media/` SHALL hold the IDE's two media files and the brand marks
`meltemi-mark-gradient.svg`, `meltemi-lockup-dark.svg` and `meltemi-lockup-light.svg` copied
from the IDE repository's `brand/` at the same commit (the IDE's release workflow stages them
into `site/media/` at publish time; `site/` alone lacks them). The checks SHALL fail on a page
without its twin.

#### Scenario: Every page has its twin
- **WHEN** the checks walk `public/`
- **THEN** every `index.html` outside `/es/` has one at the same path under `/es/`, and vice versa, each with `<html lang>` and the three alternates

#### Scenario: A missing twin fails
- **WHEN** `/es/diagrams/index.html` is removed
- **THEN** `pnpm test` fails naming `/diagrams/`

### Requirement: Static assets with no script and no external resource
No page SHALL contain a `<script>` element, an inline event handler, or a stylesheet, image or
font from another origin; `_headers` SHALL apply to `/*` the `Content-Security-Policy:
default-src 'none'; img-src 'self'; style-src 'self'; font-src 'self'; base-uri 'none';
form-action 'none'; frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`,
`X-Content-Type-Options: nosniff`, `Permissions-Policy: camera=(), microphone=(),
geolocation=()` and `Strict-Transport-Security: max-age=31536000`. `wrangler.jsonc` SHALL
declare `assets`, `dev: { port: 8789 }` and no `main`.

#### Scenario: Headers present
- **WHEN** the checks read `public/_headers`
- **THEN** the rule for `/*` names every header above with those values

#### Scenario: An external stylesheet fails
- **WHEN** a page links `https://fonts.googleapis.com/css`
- **THEN** `pnpm test` fails naming the page and the address

### Requirement: The old addresses keep answering
`public/_redirects` SHALL send every address GitHub Pages served (`/index.html`,
`/method.html`, `/agents.html`, `/downloads.html` and their `/es/` versions) to the new address
with a 301; the media GitHub Pages served (`/media/meltemi-mark-gradient.svg` among them) SHALL
keep answering at the same addresses; and every internal link of every page SHALL resolve to a
file or to a folder with an `index.html`.

#### Scenario: The former method page
- **WHEN** `pnpm site:dev` serves the site and `/method.html` is requested
- **THEN** the answer is a 301 to `/ide/method/`

#### Scenario: The mark keeps its address
- **WHEN** `pnpm site:dev` serves the site and `/media/meltemi-mark-gradient.svg` is requested
- **THEN** the answer is 200 with the SVG copied from the IDE's `brand/`, and removing that file makes `pnpm test` fail naming every IDE page that links it

#### Scenario: A broken link fails
- **WHEN** a page links `/ide/methods/`
- **THEN** `pnpm test` fails naming the page and the link

### Requirement: The Diagrams page
`/diagrams/` and `/es/diagrams/` SHALL describe Meltemi Diagrams and carry "Open the app" to
`https://diagrams.meltemi.dev/`, the install command `npm install --global @meltemi/diagrams-cli`
(the npm package; `meltemi-diagrams`, alias `mdg`, is the command it installs), the VS Code
extension, the repository's documentation, and a paragraph stating that the app needs no
account and what signing in with GitHub or Google adds; the twins SHALL carry the same set of
external links.

#### Scenario: The app link
- **WHEN** the checks read `/diagrams/index.html` and `/es/diagrams/index.html`
- **THEN** both link `https://diagrams.meltemi.dev/` and contain `npm install --global @meltemi/diagrams-cli`

#### Scenario: Twins with different links fail
- **WHEN** the Spanish page lacks a link the English page has
- **THEN** `pnpm test` fails naming the link

### Requirement: Privacy notice and terms
`/privacy/` and `/terms/` SHALL exist in both languages. The notice SHALL state that the site
sets no cookie and runs no analytics, list what the identity service holds (users, identities,
sessions, pending deletion events; no password, no provider token), how an account is deleted
and that products delete within seven days, and what the Diagrams service holds for signed-in
people; both pages SHALL name the owner's contact address. The checks SHALL fail while the
placeholder `OWNER-CONTACT` remains on any page.

#### Scenario: The inventory is stated
- **WHEN** the checks read `/privacy/index.html`
- **THEN** it names the identity service's inventory (users, identities, sessions, events) and the seven-day deletion

#### Scenario: The placeholder blocks the checks
- **WHEN** any page contains `OWNER-CONTACT`
- **THEN** `pnpm test` fails naming the page

### Requirement: The tokens stay the IDE's
`public/tokens.css` SHALL carry a header naming the IDE repository commit it was copied from,
and `pnpm site:tokens --ide <path>` SHALL collect every `--name: value;` declaration of
`public/tokens.css` and of the IDE's `desktop/ui/src/app.css` (light and dark blocks, the values
of each name as an ordered list), fail naming the token when a site token is missing in the
client or a site value is not among the client's values for that name, refuse fewer than 30 site
tokens, and exit 0 only when every token passes, 1 otherwise naming each divergence.

#### Scenario: Equal tokens
- **WHEN** the script runs against a copy of the IDE repository whose tokens match
- **THEN** it exits 0 after comparing every declaration, `--bg` and `--text` included, not only the two `--mel-*` ones

#### Scenario: A changed value
- **WHEN** one value differs in `tokens.css`
- **THEN** it exits 1 naming the token and both values

#### Scenario: A token the client lacks
- **WHEN** `tokens.css` declares `--site-only: #fff`
- **THEN** it exits 1 naming `--site-only` as missing in the client

#### Scenario: Too few tokens
- **WHEN** `tokens.css` declares 29 tokens
- **THEN** it exits 1 naming the count and the floor of 30

### Requirement: The downloads page stays version-free
`/ide/downloads/` and `/es/ide/downloads/` SHALL contain none of the version literals `/v0.`,
`/v1.`, `meltemi-v` and `version=v`, and every link whose address contains `/releases/` SHALL
start with `https://github.com/askenaz-dev/meltemi/releases`; the checks SHALL fail otherwise
naming the page and the link or literal.

#### Scenario: The latest-release form
- **WHEN** the checks read both downloads pages
- **THEN** every `/releases/` link starts with `https://github.com/askenaz-dev/meltemi/releases` and no version literal appears

#### Scenario: A pinned version fails
- **WHEN** a download link names `/releases/download/v1.2.0/meltemi-Windows.zip`
- **THEN** `pnpm test` fails naming the page and the literal `/v1.`

### Requirement: Preview and checks
`pnpm site:dev` SHALL serve `public/` with `wrangler dev` on `http://localhost:8789`, honouring
`_redirects`, `_headers` and the trailing-slash addresses; `pnpm test` SHALL run the checks of
this specification with no network access.

#### Scenario: Preview honours the files
- **WHEN** `pnpm site:dev` serves the site and `http://localhost:8789/ide/method` (no slash) is requested
- **THEN** the answer redirects to `/ide/method/` and the page carries the policy header
