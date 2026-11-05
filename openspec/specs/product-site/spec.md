# product-site Specification

## Purpose
The family's site at meltemi.dev: the static bilingual pages that present Meltemi IDE and Meltemi Diagrams, link their downloads and documentation, and state the privacy and terms of the services the family runs.

## Requirements

### Requirement: The site links the documentation portal
Every page's header navigation SHALL carry "Docs" to `https://docs.meltemi.dev/` in the
page's language; the Diagrams page's documentation buttons SHALL lead to the portal's Diagrams
section and the IDE page's quickstart to its IDE section, in place of GitHub's `docs` folder and
readme; the privacy notice SHALL say that a question typed into the portal's "Ask the docs" is
sent to Cloudflare Workers AI to be answered and is not stored.

#### Scenario: The links
- **WHEN** the checks read `/diagrams/index.html` and `/es/diagrams/index.html`
- **THEN** both link the portal's Diagrams section in their language and no longer link
  `tree/main/docs`, and every page's header links the portal

#### Scenario: The privacy sentence
- **WHEN** the checks read `/privacy/index.html` and `/es/privacy/index.html`
- **THEN** both name Workers AI and say the question is not stored

#### Scenario: A twin that forgot the portal
- **WHEN** the Spanish IDE page lacks the portal link the English one has
- **THEN** `pnpm test` fails naming the link
