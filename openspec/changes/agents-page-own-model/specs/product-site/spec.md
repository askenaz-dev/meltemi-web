## ADDED Requirements

### Requirement: The agents pages point to the guide for a model of your own, honestly
`/ide/agents/` and `/es/ide/agents/` SHALL each carry one `<section aria-labelledby="model">` that links the IDE's local models guide (`https://github.com/askenaz-dev/meltemi/blob/main/docs/local-models.md`) and says, in a sentence, how a model of your own comes today, through an agent of the fleet that talks to local and self-hosted providers by its own configuration, and that Meltemi's own engine does not exist yet. The section MUST NOT name a third-party product and MUST NOT announce as available a capability that is not published. The checks SHALL fail otherwise, naming the page and, for a name, the name.

#### Scenario: The section in both languages
- **WHEN** the checks read both agents pages
- **THEN** each has the section once, with the link to the guide, and says that the engine of its own does not exist yet, "has no engine of its own yet" in English and "todavía no tiene motor propio" in Spanish

#### Scenario: A vendor's name in the section
- **WHEN** the section of either page names a third-party product
- **THEN** `pnpm test` fails naming the page and the name

#### Scenario: The link or the section goes missing
- **WHEN** a page loses the section or the link to the guide
- **THEN** `pnpm test` fails naming the page
