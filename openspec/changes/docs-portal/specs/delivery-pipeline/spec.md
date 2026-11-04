# Spec Delta

## ADDED Requirements

### Requirement: The portal is deployed after the site and told of releases
`deploy.yml` SHALL run a `docs` job after the site's, from the same approved source and in the
same production queue, that builds the portal in `release` mode with GitHub's and Cloudflare's
tokens and uploads `meltemi-docs`; a product whose documentation cannot be fetched SHALL fail
the job and leave the portal as it was; the IDE's and Diagrams' release workflows SHALL start
this deploy with `WEB_DISPATCH_TOKEN` after a publication.

#### Scenario: The job's place and secrets
- **WHEN** the workflow test reads `deploy.yml`
- **THEN** `docs` needs `deploy`, runs in the `production` environment under
  `production-reconciliation`, reads `CLOUDFLARE_API_TOKEN` as a secret and prints none

#### Scenario: A fetch that fails
- **WHEN** the build in `release` mode cannot read a product's archive
- **THEN** the job fails before `wrangler deploy` and the site's job is unaffected

#### Scenario: Diagrams tells the web
- **WHEN** the Diagrams release workflow is read
- **THEN** it has a `tell the web` job after publication that runs `gh workflow run deploy.yml
  --repo askenaz-dev/meltemi-web --ref main` with `WEB_DISPATCH_TOKEN` and fails naming the
  secret when it is unset
