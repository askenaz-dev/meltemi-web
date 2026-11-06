# mcp-test-credential-bootstrap Specification

## Purpose
TBD - created by archiving change mcp-credentials-bootstrap. Update Purpose after archive.

## Requirements

### Requirement: Approved source and explicit credential inputs

The operation SHALL run only manually on the named operation branch of `askenaz-dev/meltemi-web`,
from pinned successful push/main CI while its source is current main, in the shared retained
production reconciliation queue. It SHALL require exactly four distinct, correctly shaped
test-token inputs from the `infrastructure` environment and SHALL never substitute an admin token.

#### Scenario: Prepared operation
- **WHEN** the named branch is dispatched with the reviewed source still current and four valid inputs
- **THEN** the workflow validates its source and inputs before initializing the state backend

#### Scenario: Stale source or invalid credentials
- **WHEN** main changes, CI is unapproved, an input is missing/malformed, or values repeat
- **THEN** the workflow refuses the operation without exposing input values

### Requirement: Exact saved-plan scope

The operation SHALL target exactly the existing four `mcp_test_token` environment secrets in
Diagrams. Its disposable override SHALL alter only the repository/environment dependency lookups.
The guard SHALL permit only create/update/no-op with known exact before/after destinations and
unchanged dependencies, and SHALL apply only the validated saved plan after a fresh main check.

#### Scenario: Four permitted targets
- **WHEN** the plan contains the four exact targets and only permitted actions
- **THEN** the guard accepts it and reports only its mutation count

#### Scenario: Scope escape or ambiguous plan
- **WHEN** a target is missing, duplicated or unknown, another resource changes, or a plan
  includes deletion, replacement, import, movement, deferred work or an error
- **THEN** the guard rejects the plan and no apply is performed

### Requirement: Convergence and private evidence

The operation SHALL require a second targeted plan with exit zero and all four resources
unchanged. It SHALL publish only secret name/environment/update metadata, SHALL upload no plans
or state, and SHALL always remove sensitive runner-local plans and the override.

#### Scenario: Successful convergence
- **WHEN** all four applied targets are unchanged in the second plan
- **THEN** metadata-only verification can complete without claiming remote MCP acceptance

#### Scenario: Residual differences or private diagnostic input
- **WHEN** the follow-up plan differs or the JSON parser receives malformed private content
- **THEN** verification fails with a fixed diagnostic that includes no private value, and cleanup runs
