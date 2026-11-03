## ADDED Requirements

### Requirement: Delivery consumes approved source

Release, deploy and apply SHALL accept only successful completed CI runs caused by a push to
main in this repository, checked through the API and against the configured CI workflow id.
The source SHA SHALL be an ancestor of main. Dispatch SHALL run from main and SHALL enforce
the same checks. Automation code SHALL come from the workflow revision, separately from source.

#### Scenario: Approved push
- WHEN CI succeeds for a main push
- THEN delivery uses exactly that run's head SHA.

#### Scenario: Invalid recovery
- WHEN the supplied run belongs to a pull request, fork, other workflow, failed or unfinished run
- THEN delivery refuses it before secrets or publication are used.

#### Scenario: IDE notice
- WHEN a deployment notice supplies no run id
- THEN it can deploy only the current main SHA with successful push CI, never an older success.

### Requirement: Every approved SHA has recoverable package versions

Identity and ocean SHALL independently reserve patch versions using immutable tags at the CI
source SHA. A retry SHALL reuse the same tags. Packaging SHALL stamp only its local checkout,
and SHALL record its source SHA. CI and release queues SHALL retain pending main runs.

#### Scenario: Two approved pushes
- WHEN two main commits pass CI
- THEN both receive distinct versions for each package without commits written to main.

#### Scenario: Partial reservation
- WHEN identity's tag exists and ocean's reservation failed
- THEN retry reuses identity's tag and reserves only the missing ocean tag.

#### Scenario: Registry or tag conflict
- WHEN an API fails or an existing version names another source
- THEN publication fails with a diagnostic and does not overwrite the version.

### Requirement: Publication channels recover independently

npm and GitHub SHALL publish independently from the same packaged artifacts and release plan.
Existing versions SHALL be checked and reused, and latest pointers SHALL never move backwards.

#### Scenario: npm fails
- WHEN npm fails and the GitHub channel is available
- THEN GitHub can still publish, and npm can resume with the same version later.

#### Scenario: Older retry
- WHEN a release older than latest is retried
- THEN it is published or confirmed without replacing latest.

#### Scenario: Provenance on main or historical recovery
- WHEN npm publishes from a main workflow execution, including recovery of older approved source
- THEN provenance preserves the runner ref and SHA authenticated by its OIDC certificate
- AND package metadata and the integrity manifest identify the approved packaged source.

### Requirement: Reconciliation does not deploy superseded source

Deploy and infrastructure apply SHALL check that approved source still equals main immediately
before mutation and SHALL skip superseded source. They SHALL never bypass CI during recovery.

#### Scenario: Retry after a newer push
- WHEN the selected successful run's SHA no longer equals main
- THEN deploy and apply skip, while release remains recoverable for that SHA.
