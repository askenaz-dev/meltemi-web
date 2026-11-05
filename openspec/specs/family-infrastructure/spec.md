# family-infrastructure Specification

## Purpose
TBD - created by archiving change docs-portal. Update Purpose after archive.

## Requirements

### Requirement: The docs Worker, its domain and what the build may read
Terraform SHALL declare the Worker `meltemi-docs` for this repository with the Custom Domain
`docs.meltemi.dev`, attached only once `var.docs_deployed` is true (a domain needs an uploaded
version); this repository's deploy token SHALL also read Workers AI, for the build's embeddings;
and the Diagrams repository SHALL receive `WEB_DISPATCH_TOKEN` from
`var.narrow_web_dispatch_token`, the narrow token only, never the admin token the workflows pass
to the IDE's release environment in its place.

#### Scenario: Staged domain
- **WHEN** the mocked plan runs with `docs_deployed = false`
- **THEN** it holds the Worker `meltemi-docs` and no Custom Domain for `docs.meltemi.dev`; with
  `docs_deployed = true` it holds both

#### Scenario: The token's groups
- **WHEN** the mocked plan lists the permission groups
- **THEN** the web deploy token has "Workers Scripts Write", "D1 Write" and "Workers AI Read",
  and the Diagrams one is unchanged

#### Scenario: The admin fallback stays with the IDE
- **WHEN** the mocked plan runs with `web_dispatch_token` set and `narrow_web_dispatch_token` empty
- **THEN** the IDE's release environment holds `WEB_DISPATCH_TOKEN` and the Diagrams repository
  holds none

#### Scenario: A missing group
- **WHEN** the account lists no group named "Workers AI Read"
- **THEN** the precondition fails naming it
