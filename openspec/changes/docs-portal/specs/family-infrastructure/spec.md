# Spec Delta

## ADDED Requirements

### Requirement: The docs Worker, its domain and what the build may read
Terraform SHALL declare the Worker `meltemi-docs` for this repository with the Custom Domain
`docs.meltemi.dev`, attached only once `var.docs_deployed` is true (a domain needs an uploaded
version); this repository's deploy token SHALL also read Workers AI, for the build's embeddings;
and the Diagrams repository SHALL receive `WEB_DISPATCH_TOKEN` from `var.web_dispatch_token`
when the owner has it, as the IDE's does.

#### Scenario: Staged domain
- **WHEN** the mocked plan runs with `docs_deployed = false`
- **THEN** it holds the Worker `meltemi-docs` and no Custom Domain for `docs.meltemi.dev`; with
  `docs_deployed = true` it holds both

#### Scenario: The token's groups
- **WHEN** the mocked plan lists the permission groups
- **THEN** the web deploy token has "Workers Scripts Write", "D1 Write" and "Workers AI Read",
  and the Diagrams one is unchanged

#### Scenario: A missing group
- **WHEN** the account lists no group named "Workers AI Read"
- **THEN** the precondition fails naming it
