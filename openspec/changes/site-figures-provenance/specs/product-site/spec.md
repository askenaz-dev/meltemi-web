## ADDED Requirements

### Requirement: The figures are real captures, declared as such
Every `<figure>` of the site SHALL hold an `<img>` whose `alt` describes what it shows (at least 40 characters) and whose `src` is a file of the site, and a `<figcaption>` that states, in the page's language, the surface shown, that it was captured over a temporary fixture repository with the simulated agent, the state of the product and the platform. An `<img>` with a non-empty `alt` MUST be inside a `<figure>`; a decorative one MUST carry `alt=""`. A page and its Spanish twin SHALL show the same figures in the same order. The checks SHALL fail naming the page, the figure and what is missing.

#### Scenario: The figures as they are
- **WHEN** the checks read the pages
- **THEN** the two figures of `/ide/` and of `/es/ide/` pass, each with its alt text, an existing file and a caption that makes the five statements

#### Scenario: A caption loses its provenance
- **WHEN** a caption drops the surface, the fixture, the simulated agent, the state of the product or the platform
- **THEN** `pnpm test` fails naming the page, the figure and the statement

#### Scenario: A picture that says something is not a figure
- **WHEN** a page carries an `<img>` with a non-empty `alt` outside a `<figure>`
- **THEN** `pnpm test` fails naming the page and the file

#### Scenario: The twins show different figures
- **WHEN** a page and its Spanish twin do not show the same image files in the same order
- **THEN** `pnpm test` fails naming both pages
