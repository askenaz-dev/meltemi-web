# delivery-pipeline Specification

## Purpose
How this repository puts what it builds into production: the workflows that deploy the site, the identity service and the documentation portal from CI-approved sources of main, in one production queue with the infrastructure apply, and the notices from the products' release workflows that start them.

## Requirements

### Requirement: The portal is deployed after the site and told of releases
`deploy.yml` SHALL run a `docs` job after the site's, from the same approved source and in the
same production queue, that builds the portal in `release` mode with GitHub's and Cloudflare's
tokens and uploads `meltemi-docs` once Terraform has declared it; a product whose documentation
cannot be fetched SHALL fail the job and leave the portal as it was; the IDE's and Diagrams'
release workflows SHALL start this deploy with `WEB_DISPATCH_TOKEN` after a publication.

#### Scenario: The job's place and secrets
- **WHEN** the workflow test reads `deploy.yml`
- **THEN** `docs` needs `deploy`, runs in the `production` environment under
  `production-reconciliation`, reads `CLOUDFLARE_API_TOKEN` as a secret and prints none

#### Scenario: The Worker not yet declared
- **WHEN** Cloudflare answers 404 for `meltemi-docs` by name
- **THEN** the job says so in a notice and uploads nothing, so the Worker is never created
  outside Terraform

#### Scenario: A fetch that fails
- **WHEN** the build in `release` mode cannot read a product's archive
- **THEN** the job fails before `wrangler deploy` and the site's job is unaffected

#### Scenario: Diagrams tells the web
- **WHEN** the Diagrams release workflow is read
- **THEN** it has a `tell the web` job after publication that runs `gh workflow run deploy.yml
  --repo askenaz-dev/meltemi-web --ref main` with `WEB_DISPATCH_TOKEN` after the GitHub
  release, and warns naming the secret, without failing the published release, when it is unset
