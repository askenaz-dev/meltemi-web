## MODIFIED Requirements

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
