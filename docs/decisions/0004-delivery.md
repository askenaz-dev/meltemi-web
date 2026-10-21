# 0004. Delivery: the family's infrastructure as code, applied by pipelines

Status: accepted (owner, 20 October 2026; the `delivery` change)

## Context

Decision 0001 left the GitHub repositories, the pipelines, DNS, the production OAuth apps and the
secrets to a delivery change per repository, after the functionality was validated locally. On
20 October 2026 the owner decided to go to production, with two rules: every piece of
infrastructure configuration is Terraform (Cloudflare, the registrar, GitHub, anything else that
holds configuration), and everything runs as GitHub pipelines, never from a machine.

What was found that day: `meltemi.dev` and `meltemi.page` are registered at Dynadot with its
nameservers; the apex of `meltemi.dev` holds only the four `A` records of the IDE's GitHub Pages
site; neither repository was a Git repository; the GitHub organisation is `askenaz-dev` and the
npm organisation `meltemi`. The Cloudflare provider declares Workers as entities, their Custom
Domains, D1, R2, zones, records, the Secrets Store (one per account, open beta) and account-owned
tokens, but cannot deploy a Worker's static assets nor create a Durable Object binding in a first
apply; no Terraform provider exists for Dynadot.

## Decision

- **One Terraform root, here.** `packages/infra` declares the zones and their records, the
  databases, the bucket, the four Workers as entities (no `workers.dev`, no previews), their
  Custom Domains, the Secrets Store and its eight secrets, a deploy token per product repository,
  and on GitHub both product repositories, their `production` environments with the token and the
  ids, the release tokens and the rules of `main`. Its state is in R2 behind the S3 backend's lock
  file. This repository holds it because it already holds what the family shares (decision 0001).
- **Terraform declares, Wrangler uploads.** Each product's `deploy.yml` uploads versions (code,
  static assets, Durable Object migrations) onto the entities with `wrangler deploy`. The
  `wrangler.jsonc` files hold no route, keep `workers_dev` and `preview_urls` off, and keep
  placeholder ids; `scripts/deploy-config.mjs` writes the real ones from the variables Terraform
  set in the `production` environment, so nobody copies an id.
- **Secrets from the Store.** Terraform generates the secrets nobody needs to know (the state
  secret, the forms secret, the events secret the two products share) and receives the others as
  sensitive variables; the Workers bind them as `<NAME>_STORE` and read them once per isolate at
  their entry. `wrangler secret put` is never run. Rotation is a commit (`rotations`).
- **Pipelines.** `infra-plan` comments the plan on a pull request; `infra-apply` applies the plan
  it made on `main`; `infra-drift` opens an issue when the cloud differs; `registrar` points the
  domains at the zones' nameservers through Dynadot's API, once, standing in for the provider that
  does not exist. `ci`, `deploy` and `release` build, upload and publish the code.
- **The bootstrap is the only thing done by hand:** the repository, the state bucket and its key,
  Terraform's Cloudflare and GitHub tokens, the Dynadot key and the values only people can obtain
  (the signing key, the OAuth secrets, the npm and marketplace tokens), in the `infrastructure`
  environment.
- **The package is published.** `@meltemi/identity` goes to npm, public, with provenance, from
  `release.yml` on a version tag; products install it instead of linking it.
- **Repository and licence.** `askenaz-dev/meltemi-web`, public, Apache-2.0.

## Alternatives considered

- **Terraform-managed Worker versions** (`cloudflare_worker_version` with Wrangler's bundle): one
  owner for bindings and secrets, but no static assets (the site, Diagrams' playground) and a
  two-step apply for Durable Objects.
- **Classic Worker secrets set by the deploy workflow** from GitHub secrets: no change to the
  Workers, but every value in two places and stale secrets left behind.
- **A community Dynadot provider or a generic REST provider**: none is published; the REST API's
  per-request signature is beyond a generic provider. Dynadot also answers only whitelisted IP
  addresses, so the nameserver step runs once from the owner's machine.
- **Transferring the domains to Cloudflare Registrar**: it would leave no registrar outside
  Cloudflare; the owner keeps Dynadot as the registrar and uses Cloudflare for DNS only.
- **HCP Terraform** for state and runs: a third account and a third home for secrets.
- **A fourth repository for the infrastructure**: cleaner, with one more bootstrap; the folder can
  move there unchanged if the estate grows.

## Consequences

- The rollout has stages, each a pull request whose plan shows it: the first apply without
  domains, the registrar step, the products' first deploys, `attach_domains`, then
  `apex_on_github_pages = false`, which hands the apex to the family site and lets the IDE
  repository retire its Pages site.
- Secrets live in the Terraform state, which lives in a private bucket whose keys are two secrets
  of the `infrastructure` environment.
- Dynadot stays the registrar; the nameserver step is the one action run outside a pipeline, from
  a whitelisted IP. DNSSEC is not set up: it would need the DS record at Dynadot as well.
- Meltemi Diagrams' delivery binds what this root outputs and creates nothing.
