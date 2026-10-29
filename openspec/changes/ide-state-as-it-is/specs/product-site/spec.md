## ADDED Requirements

### Requirement: The IDE pages' capability table states what the IDE ships
`/ide/` and `/es/ide/` SHALL carry, in their section `state`, one row per capability of the IDE,
each with its name, its state and a note that says what ships and what is missing, as last
verified against the IDE's repository and its latest release. The checks SHALL pin every row's
name, state and note in both languages and SHALL fail naming the page and the row that differs.

#### Scenario: The rows as verified
- **WHEN** the checks read `/ide/` and `/es/ide/`
- **THEN** the mobile companion is "In development" / "En desarrollo" with a note that says it is built from source, tested on an emulator and has no published APK, and the SDK is "Not yet" / "Todavía no" with a note that names the public JSON Schemas

#### Scenario: A row that drifts
- **WHEN** a row's state or note differs from the pinned record, for instance the companion back to "Not yet"
- **THEN** `pnpm test` fails naming the page and the row
