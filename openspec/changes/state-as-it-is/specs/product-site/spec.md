## MODIFIED Requirements

### Requirement: The Diagrams page
`/diagrams/` and `/es/diagrams/` SHALL describe Meltemi Diagrams and carry "Open the app" to
`https://diagrams.meltemi.dev/`, the install command `npm install --global @meltemi/diagrams-cli`
(the npm package; `meltemi-diagrams`, alias `mdg`, is the command it installs), the VS Code
extension, the repository's documentation, and a paragraph stating that the app needs no
account and what signing in with GitHub or Google adds, each part with the state the product
ships; the twins SHALL carry the same set of external links. The home's table of the family's
state SHALL say the same of every part.

#### Scenario: The app link
- **WHEN** the checks read `/diagrams/index.html` and `/es/diagrams/index.html`
- **THEN** both link `https://diagrams.meltemi.dev/` and contain `npm install --global @meltemi/diagrams-cli`

#### Scenario: Twins with different links fail
- **WHEN** the Spanish page lacks a link the English page has
- **THEN** `pnpm test` fails naming the link

#### Scenario: A state that is not the product's
- **WHEN** a row of the home's state table or of the Diagrams page's account table says a part is not built, in development or available while the recorded verification says otherwise
- **THEN** `pnpm test` fails naming the page and the row
