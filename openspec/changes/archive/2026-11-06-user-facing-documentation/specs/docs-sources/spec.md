## ADDED Requirements

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

## MODIFIED Requirements

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
