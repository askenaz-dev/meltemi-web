## ADDED Requirements

### Requirement: Explicit narrow-token input

The temporary operation SHALL distribute only `WEB_DISPATCH_TOKEN` from Web's `infrastructure`
environment through the existing `narrow_web_dispatch_token` declaration. It SHALL reject an empty
value or one equal to the provider admin credential without logging either value.

#### Scenario: Ready input

- **WHEN** the owner has supplied a distinct notice token and the operator dispatches the reviewed branch
- **THEN** that explicit value is the only notice-secret value used by Terraform

#### Scenario: Missing or admin input

- **WHEN** the input is empty or equals the admin credential
- **THEN** the operation stops before planning and no value is printed

### Requirement: Approved source and one saved target plan

The operation SHALL be manual-only and restricted to its repository/branch, use pinned current
main with successful push CI, retain the shared production queue, and apply only a saved plan
validated to mutate the exact Diagrams notice secret. All other managed mutations, replacement,
deletion, moves, imports and deferred changes SHALL be rejected.

#### Scenario: Targeted creation or retry

- **WHEN** the saved plan creates/updates only the expected secret or is an unchanged retry
- **THEN** it may apply after rechecking current main

#### Scenario: Expanded scope or superseded source

- **WHEN** another resource would change, the target identity is unknown/different, or main changed
- **THEN** the workflow stops before apply

### Requirement: Convergence and metadata-only evidence

The operation SHALL require an unchanged second plan, report only destination name/update time,
upload no plan or JSON, and clean sensitive runner-local plans even after failure. Distribution
SHALL NOT be presented as proof of token permissions; a real notice dispatch verifies that capability.

#### Scenario: Converged distribution

- **WHEN** apply completes and the follow-up plan is no-op
- **THEN** only permitted metadata is reported and plans are removed

#### Scenario: Follow-up difference or malformed plan

- **WHEN** verification has differences or the plan cannot be safely parsed
- **THEN** it fails with generic diagnostics that include no token/plan values
