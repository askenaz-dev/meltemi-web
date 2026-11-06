# docs-sources Specification

## Purpose
How the products' released documentation reaches the portal: the sources at each release, the conversion of their Markdown into the portal's pages, the build's three modes and the network it never needs in tests.

## Requirements

### Requirement: The sources are the latest releases
In `release` mode the build SHALL take each product's documentation from the archive of its
latest published GitHub release (`main` when the repository has none), reading `docs/`,
`README.md`, `README.es.md`, `LEEME.md`, `CONTRIBUTING.md` and `CHANGELOG.md`, and this repository's from the
checkout being built, writing `sources.json` with each product's repository, ref, version and
date; an archive that cannot be read SHALL fail the build naming the product.

#### Scenario: A release and no release
- **WHEN** GitHub answers `v0.2.29` for the IDE and 404 for Diagrams, with stubbed answers
- **THEN** `sources.json` names `v0.2.29` for the IDE and `main` for Diagrams, with their dates

#### Scenario: An unreadable archive
- **WHEN** the stubbed archive of the IDE is truncated
- **THEN** the build fails naming the IDE and writes no page

### Requirement: Local and fixture modes
`local` mode SHALL read the sibling checkouts `../../../diagrams` and `../../../ide` and this
repository; `fixture` mode SHALL read `test/fixtures/`; `pnpm build` SHALL choose `local` when
the siblings exist and `fixture` otherwise; `pnpm test` and CI SHALL use `fixture` and make no
network request.

#### Scenario: Fixture by default on CI
- **WHEN** the build runs where no sibling checkout exists and no mode is given
- **THEN** it builds the fixture and prints the mode it chose

#### Scenario: An unknown mode
- **WHEN** `--from elsewhere` is given
- **THEN** the build refuses with the three modes named

### Requirement: Conversion of a page
A selected user-guide source page SHALL become a portal page whose title is its first heading,
whose description is its first paragraph, whose twin-language first-line link is dropped, whose links to pages
inside `docs/` become portal routes with their anchors, whose links to files outside `docs/`
become GitHub links at the source's ref, whose media links point at the copied files, and whose
source link is the file on GitHub at that ref; a link to a page that does not exist SHALL fail
the build naming it.

Links to excluded internal sources SHALL become GitHub links at the source ref, with their
anchors preserved.

#### Scenario: Links rewritten
- **WHEN** the fixture's `docs/player.md` links `language/stories.md#exports`, `../CHANGELOG.md`
  and `media/editing-demo.gif`
- **THEN** the page links `/diagrams/language/stories/#exports`,
  `https://github.com/askenaz-dev/meltemi-diagrams/blob/v1.11.0/CHANGELOG.md` and
  `/diagrams/media/editing-demo.gif`, and the GIF is in the build

#### Scenario: The twin link dropped
- **WHEN** the page's first line is `[Español](es/player.md)`
- **THEN** the portal page has no such link and `/es/diagrams/player/` is reached by the picker

#### Scenario: A broken link
- **WHEN** a page links `nowhere.md`
- **THEN** the build fails naming the page and `nowhere.md`

### Requirement: A picture from another host is its words
A picture a source page loads from another host (a readme's badges) SHALL become its alternative
text, kept as a link when it was one, so no page of the portal loads anything from elsewhere.

#### Scenario: A badge from another host
- **WHEN** a readme holds `[![CI](https://github.com/…/badge.svg)](https://github.com/…/ci.yml)`
- **THEN** the page links `CI` to the workflow and loads no picture from another host

#### Scenario: A picture with no words
- **WHEN** a picture from another host has an empty alternative text
- **THEN** it is left out, and the checks of the build find no address of another host

### Requirement: A repository without a Spanish mirror
In a repository with no `docs/es/`, a page's language SHALL be read from its words, and a
section with no `docs/README.md` SHALL take the repository's readmes (`README.md`; `README.es.md`
or `LEEME.md`) as its index in each language.

#### Scenario: A guide's language read from its words
- **WHEN** the IDE's fixture has no `docs/es/` and its `quickstart.md` is written in Spanish
- **THEN** it is the Spanish page `/es/ide/quickstart/`, and `README.md` and `LEEME.md` are the
  section's index in English and in Spanish

#### Scenario: Two pages for one place
- **WHEN** two sources would be the same page of one language
- **THEN** the build fails naming both

### Requirement: The archive reader
The build SHALL read a gzipped tar archive entry by entry with this repository's own reader,
keeping only the paths asked for, and SHALL refuse an entry whose path leaves its folder or
whose header is malformed.

#### Scenario: An archive written by the test
- **WHEN** the test writes an archive with `repo-1.0/docs/a.md` and `repo-1.0/src/x.ts`
- **THEN** the reader returns `docs/a.md` alone

#### Scenario: A path that escapes
- **WHEN** an entry is named `repo-1.0/docs/../../etc/passwd`
- **THEN** the reader refuses it naming the entry

### Requirement: Public guides are for product users
The portal SHALL select user-facing guides before generating pages. Architecture decisions,
internal QA and verification reports, research, interface design, launch/pilot operations and
explicit implementation plans SHALL remain repository material, excluded from public routes,
both locale sidebars, page search and Ask the docs in every source mode. Advanced product
references and user-facing installation, security and performance guidance SHALL remain public.

#### Scenario: Internal material in either language
- **WHEN** a source tree includes `docs/decisions/0001-parser.md`, its Spanish twin and an
  internal QA report alongside a user guide
- **THEN** only the user guide becomes a public guide or locale notice and only it is indexed

#### Scenario: A guide refers to an internal decision
- **WHEN** a user guide links an existing excluded decision with an anchor
- **THEN** the portal links its source on GitHub at the source ref with the anchor preserved

#### Scenario: The referenced file is missing
- **WHEN** a guide links a nonexistent decision file
- **THEN** conversion fails naming the guide and the missing link
