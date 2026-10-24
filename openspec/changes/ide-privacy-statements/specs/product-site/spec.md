## ADDED Requirements

### Requirement: The privacy notice states what the IDE does not do and where it keeps its data
The section on the IDE of `/privacy/` and of `/es/privacy/` (`<section aria-labelledby="ide">`)
SHALL state that the IDE has no account and sends no telemetry; that its background service opens no
network port; that it does not read, store or reuse the credentials of the coding agents it runs;
and that what it keeps stays on the user's computer, naming the data folder, the configuration
folder and the project folder `.meltemi`, with the data and configuration folders for Windows, macOS
and Linux. Both pages SHALL carry the same "Last updated" date. The checks SHALL fail otherwise,
naming the page and the statement.

#### Scenario: The statements in both languages
- **WHEN** the checks read both privacy pages
- **THEN** each has the IDE section once, and it makes the five statements, in English and in Spanish, with the folders of the three platforms

#### Scenario: A statement goes missing
- **WHEN** either page drops one of the statements or the section
- **THEN** `pnpm test` fails naming the page and the statement

#### Scenario: The dates differ
- **WHEN** the two pages carry different "Last updated" dates
- **THEN** `pnpm test` fails naming both dates
