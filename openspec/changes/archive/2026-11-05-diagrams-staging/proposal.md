# A staging twin of the Diagrams service

## Why

Meltemi Diagrams' change `agent-mcp` adds an MCP endpoint, an OAuth authorization server and
server-drawn previews to its hosted service, and the specification behind it demands that its
thirty acceptance criteria pass "en staging y en el entorno de producción elegido, con un proyecto
de prueba controlado" before the delivery counts. Today the family has one hosted environment per
Worker: the Diagrams deploy goes from CI-approved main straight to production, and nothing runs a
suite against a host that is not production. This repository declares every Worker, database,
bucket, domain, secret and GitHub environment of the family (decisions 0003 and 0004), so the
staging twin is declared here: the same code, uploaded by the Diagrams deploy workflow first,
proven, and only then uploaded to production. The authorization server also needs a KV namespace
per environment, which only Terraform creates.

## What changes

- **The staging Workers and their storage.** `meltemi-diagrams-staging` at
  `staging.diagrams.meltemi.dev` and `meltemi-diagrams-publish-staging` at
  `staging.meltemi.page`, with their own D1 database `meltemi-diagrams-staging`, R2 bucket
  `meltemi-diagrams-staging-blobs` and Custom Domains, declared beside the production ones in
  `local.workers` and attached by stages as the others were.
- **KV for the authorization server.** `meltemi-diagrams-oauth` and
  `meltemi-diagrams-oauth-staging`, bound as `OAUTH_KV` by each environment's deploy
  configuration.
- **Secrets of the twin.** `FORMS_SECRET_STAGING` and `EVENTS_SECRET_DIAGRAMS_STAGING` (its
  `IDENTITY_EVENTS_SECRET`) generated, `ADMIN_SUBS` shared, in the family's Store; the identity
  service's `PRODUCTS` gains `diagrams-staging` with its events address, so deleting an account
  reaches staging too.
- **The Diagrams repository's `staging` environment** restricted to `main`, with the ids as
  variables (`D1_DATABASE_ID`, `OAUTH_KV_ID`, `SECRETS_STORE_ID`) beside the production ones,
  and the acceptance suite's tokens for both environments (`MELTEMI_TOKEN`, `MELTEMI_TOKEN_2`),
  received variables of this root that stay empty until the owner has them, like
  `web_dispatch_token`.
- **Records.** `docs/repositories.md` (the staging domains), `packages/infra/README.md` (the
  bootstrap values), decision note 0008.

No new dependency.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `family-infrastructure`: added, the staging twin, the KV namespaces, the staging secrets and
  product entry, the `staging` environment and the test tokens.

## Impact

`packages/infra` (`workers.tf`, `secrets.tf`, `github.tf`, `variables.tf`, `outputs.tf`,
`tests/stages.tftest.hcl`, `test/files.test.ts`), the infrastructure workflows (the test tokens'
variable) and `test/workflows.test.ts`, `packages/identity/wrangler.jsonc` (`PRODUCTS` and the new
secret binding, in a second pull request; `scripts/deploy-config.mjs` names no binding and is
unchanged), `docs/repositories.md`, `packages/infra/README.md`, one decision note. The Diagrams repository's deploy workflow and its use of the environment are
`agent-mcp`'s. Nothing changes for the site or for production's Workers.

## Non-goals

The Diagrams deploy workflow, the acceptance suite and the test accounts' creation, which belong
to Meltemi Diagrams (`agent-mcp`); the registration of the staging domains' records beyond the
Custom Domains, and the GitHub environment's protection rules beyond the branch, which the
`delivery` change's staging of `attach_domains` and environments already governs.
