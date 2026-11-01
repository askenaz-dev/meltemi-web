## ADDED Requirements

### Requirement: Limit mutation to the Open VSX secret

The operation MUST use the pinned Terraform source with a temporary repository-name override
that removes the incidental D1 dependency, and MUST apply a saved plan only after
validating that its sole possible resource mutation is create or update of
`github_actions_secret.release["meltemi-diagrams/OVSX_PAT"]`. No-op plans SHALL be accepted for
retries. Imports, moves, deletions, replacements, deferred changes, other resource mutations
and invalid plans MUST be rejected before apply. The `complete:false` flag of a targeted plan
SHALL be accepted because its partial scope is intentional.

#### Scenario: First distribution

- **WHEN** the targeted plan creates only the allowed secret and reads its dependencies
- **THEN** the saved plan is accepted for apply.

#### Scenario: Dependency drift

- **WHEN** the targeted plan also updates its repository dependency
- **THEN** the operation fails before apply and reports no secret value.

### Requirement: Verify distribution without disclosing the token

The operation MUST require a nonempty environment token, keep plan material only on the
ephemeral runner, clean it up after execution, and never publish it as an artifact. After
apply, it MUST verify a targeted plan with no changes and the destination secret's name and
update time through GitHub's metadata API.

#### Scenario: Successful retry

- **WHEN** the secret is already managed with the supplied token and verification is unchanged
- **THEN** the operation succeeds without publishing or deploying a product.

#### Scenario: Missing token or failed verification

- **WHEN** the token is absent or the verification plan still proposes changes
- **THEN** the operation fails with a generic diagnostic and cleans up plan files.
