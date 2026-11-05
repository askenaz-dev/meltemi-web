# family-infrastructure Specification

## Purpose
The family's infrastructure declared as code in `packages/infra`: the Cloudflare Workers, their domains, databases, storage and secrets, the deploy tokens and their permissions, and the GitHub environments and secrets the product repositories receive, applied only by the pipeline.

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

### Requirement: The staging twin of the Diagrams service
Terraform SHALL declare `meltemi-diagrams-staging` with the Custom Domain
`staging.diagrams.meltemi.dev` and `meltemi-diagrams-publish-staging` with `staging.meltemi.page`,
with no `workers.dev` and no preview address, their domains attached only once `attach_domains`
and `var.staging_deployed` are true, the D1 database `meltemi-diagrams-staging`,
and the R2 bucket `meltemi-diagrams-staging-blobs`; no KV namespace, since Diagrams' OAuth server
keeps its state in each environment's database.

#### Scenario: Staged domains
- **WHEN** the mocked plan runs with `staging_deployed = false`, then `true`
- **THEN** the first holds both staging Workers and no staging Custom Domain, and the second holds both domains

#### Scenario: The storage
- **WHEN** the mocked plan lists its resources
- **THEN** it holds the staging database and the staging bucket, no KV namespace, and production's database and bucket are unchanged

#### Scenario: A name that collides
- **WHEN** a staging resource is given a production name
- **THEN** the plan (a Worker's name or host) or the plan test (a database or bucket) fails naming it

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
token and the variables `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, `OAUTH_KV_ID`,
`R2_BUCKET_NAME`, `SECRETS_STORE_ID` and `SECRETS_SUFFIX` (`_STAGING`); production SHALL gain
`OAUTH_KV_ID` and `R2_BUCKET_NAME` and leave `SECRETS_SUFFIX` unset; each environment SHALL
receive `MELTEMI_TOKEN` and `MELTEMI_TOKEN_2` from `var.mcp_test_tokens` when present.

#### Scenario: The environment's values
- **WHEN** the mocked plan lists the Diagrams repository's environments
- **THEN** `staging` exists with the branch policy `main`, its six variables with staging's ids and the deploy token, and `production` has `OAUTH_KV_ID`, `R2_BUCKET_NAME` and no `SECRETS_SUFFIX`, which GitHub reads as empty

#### Scenario: Tokens absent
- **WHEN** `mcp_test_tokens` is empty
- **THEN** no `MELTEMI_TOKEN` secret exists in either environment and the plan is valid

#### Scenario: Tokens present
- **WHEN** `mcp_test_tokens.staging.token` is set
- **THEN** the `staging` environment has `MELTEMI_TOKEN` and the plan prints no value

#### Scenario: An environment Diagrams does not have
- **WHEN** `mcp_test_tokens` names an environment other than `staging` and `production`
- **THEN** the variable's validation refuses it
