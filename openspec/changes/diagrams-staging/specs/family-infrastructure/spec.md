# Spec Delta

## ADDED Requirements

### Requirement: The staging twin of the Diagrams service
Terraform SHALL declare `meltemi-diagrams-staging` with the Custom Domain
`staging.diagrams.meltemi.dev` and `meltemi-diagrams-publish-staging` with `staging.meltemi.page`,
attached only once `var.staging_deployed` is true, the D1 database `meltemi-diagrams-staging`,
the R2 bucket `meltemi-diagrams-staging-blobs`, and the KV namespaces `meltemi-diagrams-oauth`
and `meltemi-diagrams-oauth-staging`.

#### Scenario: Staged domains
- **WHEN** the mocked plan runs with `staging_deployed = false`, then `true`
- **THEN** the first holds both staging Workers and no staging Custom Domain, and the second holds both domains

#### Scenario: The storage
- **WHEN** the mocked plan lists its resources
- **THEN** it holds the staging database, the staging bucket and the two namespaces, and production's database and bucket are unchanged

#### Scenario: A name that collides
- **WHEN** a staging resource is given a production name
- **THEN** `terraform validate` or the plan test fails naming it

### Requirement: Staging's secrets and the identity product
The Store SHALL hold `FORMS_SECRET_STAGING`, `EVENTS_SECRET_DIAGRAMS_STAGING` and
`IDENTITY_EVENTS_SECRET_STAGING` (the last two one generated value), and the identity service
SHALL list the product `diagrams-staging` with the events address
`https://staging.diagrams.meltemi.dev/_identity/events` and bind its secret; `ADMIN_SUBS` SHALL
be shared by both environments.

#### Scenario: The secrets
- **WHEN** the mocked plan lists the Store's secrets
- **THEN** the three staging names are present and the two events names carry the same value

#### Scenario: The product listed
- **WHEN** the identity package's configuration tests read `PRODUCTS`
- **THEN** it lists `diagrams` and `diagrams-staging` with `https:` events addresses and the Worker binds `EVENTS_SECRET_DIAGRAMS_STAGING_STORE`

#### Scenario: A rotation
- **WHEN** `rotations` names `EVENTS_SECRET_DIAGRAMS_STAGING`
- **THEN** the next plan replaces that value and its `IDENTITY_EVENTS_SECRET_STAGING` twin together

### Requirement: The Diagrams repository's staging environment and the test tokens
The Diagrams repository SHALL have a `staging` environment restricted to `main`, with the deploy
token as its secret and the variables `D1_DATABASE_ID`, `OAUTH_KV_ID`, `SECRETS_STORE_ID` and
`SECRETS_SUFFIX` (`_STAGING`; production gains `OAUTH_KV_ID` and an empty suffix), and each
environment SHALL receive `MELTEMI_TOKEN` and `MELTEMI_TOKEN_2` from `var.mcp_test_tokens` when
the owner has them.

#### Scenario: The environment's values
- **WHEN** the mocked plan lists the Diagrams repository's environments
- **THEN** `staging` exists with the branch policy `main`, the four variables and the deploy token, and `production` has `OAUTH_KV_ID` and `SECRETS_SUFFIX` empty

#### Scenario: Tokens absent
- **WHEN** `mcp_test_tokens` is empty
- **THEN** no `MELTEMI_TOKEN` secret exists in either environment and the plan is valid

#### Scenario: Tokens present
- **WHEN** `mcp_test_tokens.staging.token` is set
- **THEN** the `staging` environment has `MELTEMI_TOKEN` and the plan prints no value
