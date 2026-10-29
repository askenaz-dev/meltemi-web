## MODIFIED Requirements

### Requirement: The IDE pages' capability table states what the IDE ships
`/ide/` and `/es/ide/` SHALL carry, in their section `state` and between
`<!-- ide-capabilities -->` and `<!-- /ide-capabilities -->`, one row per capability of the IDE
with its name, state and note. The committed rows SHALL be pinned by the checks. At deploy time
`packages/site/scripts/ide-capabilities.mjs` SHALL replace them with the rows of a verified
`capabilities.json` whose version is the latest release's, escaping every value, and SHALL keep
the committed rows when the file cannot be used.

#### Scenario: The rows as verified
- **WHEN** the checks read `/ide/` and `/es/ide/`
- **THEN** each carries the two markers once, and the committed rows match the pinned record in name, state and note

#### Scenario: A row that drifts
- **WHEN** a committed row's state or note differs from the pinned record
- **THEN** `pnpm test` fails naming the page and the row

#### Scenario: A published capabilities file
- **WHEN** the script is given a valid file for version `0.3.0` and the tag `v0.3.0`
- **THEN** both pages carry one row per capability in the file's order, with the state's style and words in each language, and every value escaped

#### Scenario: A file that cannot be used
- **WHEN** the file's version is not the tag's, a state is unknown, a language is missing or the JSON does not parse
- **THEN** the script writes nothing, says why, exits 0, and the committed rows stay

#### Scenario: Markers missing
- **WHEN** one of the two pages lacks its capability markers
- **THEN** the script fails naming the page, before the site is uploaded

#### Scenario: The switch changes no words
- **WHEN** the fixture that mirrors the IDE's record is rendered into the committed pages
- **THEN** the rows equal the committed rows, cell by cell, in both languages
