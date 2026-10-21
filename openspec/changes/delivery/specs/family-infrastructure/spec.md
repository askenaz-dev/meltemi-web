## ADDED Requirements

### Requirement: One Terraform root with remote state
`packages/infra` SHALL be one Terraform root (`required_version` pinned to a 1.x minor, the
providers `cloudflare/cloudflare` 5.x, `integrations/github` 6.x and `hashicorp/random` 3.x
pinned with `~>` and a committed `.terraform.lock.hcl` holding every platform's hashes) whose
state is the `s3` backend on the account's R2 bucket `meltemi-terraform-state`, key
`family.tfstate`, with `use_lockfile = true` and the AWS-only checks skipped, and whose endpoint
and credentials come from the environment. `terraform fmt -check` and `terraform validate` SHALL
pass, `terraform test` SHALL plan the rollout's stages against mocked providers, and a test SHALL
read the files and assert the backend, the lock file and the version constraints.

#### Scenario: Formatting, validity and the stages
- **WHEN** `terraform fmt -check -recursive`, `terraform validate` and `terraform test` run in `packages/infra`
- **THEN** all three exit 0 with no credential and no network beyond the providers' download

#### Scenario: A provider without a constraint
- **WHEN** a provider entry loses its `version` constraint
- **THEN** the test fails naming the provider

### Requirement: The zones and their records
The root SHALL create `cloudflare_zone` for `meltemi.dev` and `meltemi.page` (both registered at
Dynadot), declare every record either zone holds as `cloudflare_dns_record` (on 2026-10-20 only
the four apex `A` records of `meltemi.dev`, to GitHub Pages, unproxied, behind the variable
`apex_on_github_pages`, `true` until the site answers from its Worker), and output each zone's
nameservers and status. Both domains SHALL stay registered at Dynadot, with Cloudflare serving
their DNS only. A zone already on the account (added in the dashboard) SHALL be imported by its id
(`existing_zone_ids`), with the GitHub Pages records it copied (`existing_apex_record_ids`), not
created twice.

#### Scenario: Before the swap
- **WHEN** the stages are planned with `apex_on_github_pages = true`
- **THEN** the plan holds four unproxied `A` records of `meltemi.dev` and no Custom Domain for `meltemi.dev`

#### Scenario: The swap
- **WHEN** `apex_on_github_pages` is `false` and `attach_domains` is `true`
- **THEN** the plan has no GitHub Pages record and attaches `meltemi.dev` to `meltemi-site`

#### Scenario: A record retyped instead of imported
- **WHEN** a `cloudflare_dns_record` is added for a record the zone already has
- **THEN** `terraform apply` fails on the conflict and an `import` block resolves it, as the README says

### Requirement: Workers, databases, buckets and domains
The root SHALL declare the D1 databases `meltemi-identity` and `meltemi-diagrams`, the R2 bucket
`meltemi-diagrams-blobs`, the Workers `meltemi-identity`, `meltemi-site`,
`meltemi-diagrams-cloud` and `meltemi-diagrams-publish` as `cloudflare_worker` with
`subdomain.enabled = false`, `subdomain.previews_enabled = false` and observability on, and,
when `attach_domains` is `true`, the Custom Domains `id.meltemi.dev`, `diagrams.meltemi.dev` and
`meltemi.page` on their Workers, and `meltemi.dev` on `meltemi-site` once `apex_on_github_pages`
is `false`. The nameservers, zone status, database ids, the bucket name, the Store id, the
Worker names and the attached domains SHALL be outputs.

#### Scenario: The outputs
- **WHEN** `terraform output -json` runs after an apply
- **THEN** it names `nameservers`, `zone_status`, `identity_database_id`, `diagrams_database_id`, `diagrams_bucket`, `secrets_store_id`, `workers` and `domains`, and no secret value

#### Scenario: A Worker given an address
- **WHEN** `subdomain.enabled` is set to `true` on any Worker
- **THEN** the test of the files fails

#### Scenario: Domains before the first upload
- **WHEN** `attach_domains` is `false`
- **THEN** the plan holds no `cloudflare_workers_custom_domain`

#### Scenario: Domains while GitHub Pages holds the apex
- **WHEN** `attach_domains` is `true` and `apex_on_github_pages` is `true`
- **THEN** the plan attaches `id.meltemi.dev`, `diagrams.meltemi.dev` and `meltemi.page` only

### Requirement: Secrets in the Store and tokens
The root SHALL declare the account's Secrets Store `meltemi` (importing an existing one when
`existing_secrets_store_id` is set, since an account holds one) and its secrets scoped to
`workers`: `STATE_SECRET`, `FORMS_SECRET` and the pair `EVENTS_SECRET_DIAGRAMS` /
`IDENTITY_EVENTS_SECRET` (one `random_password` each, the pair sharing one, each replaced when
its entry of `rotations` changes), and `SESSION_PRIVATE_KEY`, `GITHUB_CLIENT_SECRET`,
`GOOGLE_CLIENT_SECRET` and `ADMIN_SUBS` from sensitive variables; and two
`cloudflare_api_token`s (user tokens: the Secrets Store refuses account-owned tokens' bindings), one
per product repository, holding Workers Scripts Write and D1
Write (and Workers R2 Storage Read for Diagrams, and the Secrets Store's read group when the
account lists one) and nothing else, refused by a precondition naming the groups when the account
lists none of that name. No value SHALL appear in a file, a plan, an output or a log.

#### Scenario: The tokens' reach
- **WHEN** the stages are planned
- **THEN** the web token holds the Workers Scripts, D1 and Secrets Store groups and the diagrams token also R2's, and no zone, DNS or token group

#### Scenario: A permission group the account does not list
- **WHEN** the account's groups lack `D1 Write`
- **THEN** the plan fails on the token's precondition, naming the groups, before anything is made

#### Scenario: Rotation
- **WHEN** `rotations` gains `{ STATE_SECRET = "2027-01-15" }`
- **THEN** only `STATE_SECRET`'s generated value is replaced

#### Scenario: A value in the code
- **WHEN** a stored secret's value is written as a literal in a `.tf` file
- **THEN** the test of the files fails naming the secret

### Requirement: GitHub repositories, environments, variables and secrets
The root SHALL declare the public repositories `askenaz-dev/meltemi-web` (imported) and
`askenaz-dev/meltemi-diagrams`, vulnerability alerts on both, a `production` environment in each
(protected branches only) with the environment secret `CLOUDFLARE_API_TOKEN` from the token
minted for it and the environment variables `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID` and
`SECRETS_STORE_ID`, the repository secrets `NPM_TOKEN` (both), `VSCE_PAT` and `OVSX_PAT`
(`meltemi-diagrams`) only once their variables are set, and a ruleset on the default branch of
each forbidding deletion and force pushes. The root SHALL NOT manage the IDE repository nor the
`infrastructure` environment, which holds the bootstrap.

#### Scenario: A product's deploy environment
- **WHEN** the stages are planned
- **THEN** each repository's `production` environment gets its token and its three ids, six variables in all

#### Scenario: Release tokens not yet obtained
- **WHEN** `npm_token`, `vsce_pat` and `ovsx_pat` are empty
- **THEN** no release secret is planned, and setting `npm_token` and `vsce_pat` plans `NPM_TOKEN` in both repositories and `VSCE_PAT` in Diagrams'

#### Scenario: The IDE repository
- **WHEN** the files are read
- **THEN** no resource names `askenaz-dev/meltemi`

### Requirement: Plan, apply, drift and the registrar step
`infra-plan.yml` SHALL run on pull requests that touch `packages/infra` (`fmt -check`, `init`,
`validate`, `plan`) and write the plan as one comment of the pull request, updated in place;
`infra-apply.yml` SHALL run on pushes to `main` that touch `packages/infra` and on
`workflow_dispatch`, one at a time, `plan -out` then `apply` of that plan, with the outputs as
the run's summary; `infra-drift.yml` SHALL run weekly and by hand, open or update an issue titled
"Infrastructure drift" when `plan -detailed-exitcode` exits 2, and close it when it exits 0;
`registrar.yml` SHALL run on `workflow_dispatch` only (with a dry-run input) and point
`meltemi.dev` and `meltemi.page` at Dynadot to the zones' nameservers from
`terraform output -json nameservers`, adding hosts the account lacks, changing a domain only when
its nameservers differ, printing what it did and never the key, and failing on Dynadot's refusal
with the command named. All four SHALL run in the `infrastructure` environment.

#### Scenario: A pull request's plan
- **WHEN** a pull request changes `packages/infra/zones.tf`
- **THEN** the run ends with one comment holding the plan, and a second push replaces it

#### Scenario: Drift
- **WHEN** a record is changed in the Cloudflare dashboard and the weekly run executes
- **THEN** an issue "Infrastructure drift" exists with the plan that restores the record

#### Scenario: The registrar step already done
- **WHEN** `registrar.yml` runs and Dynadot already lists a domain's nameservers, in any case and with or without a trailing dot
- **THEN** it changes nothing for that domain and says so

#### Scenario: Dynadot refuses
- **WHEN** Dynadot answers `set_ns` with an error that repeats the key
- **THEN** the step fails with `set_ns: Dynadot refused: …` and the key replaced by `<key>`

### Requirement: The Workers read secrets from the Store
`packages/identity/wrangler.jsonc` SHALL bind `SESSION_PRIVATE_KEY`, `STATE_SECRET`,
`GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET` and `EVENTS_SECRET_DIAGRAMS` as
`secrets_store_secrets` named `<NAME>_STORE`, with placeholder store and database ids that the
deploy workflow replaces from the `production` environment's `SECRETS_STORE_ID` and
`D1_DATABASE_ID` (`scripts/deploy-config.mjs`, which refuses to leave a placeholder and writes
`wrangler.deploy.json`), and SHALL name `workers_dev: false`, `preview_urls: false`, the
production `SESSION_PUBLIC_KEYS` and client ids, and no `account_id`, `routes`, `DEV`,
`DEV_ORIGINS` or secret value. The Worker's entry SHALL read every `<NAME>_STORE` binding into
`<NAME>` once per isolate, unless a non-empty string `<NAME>` (`.dev.vars`) is set, which wins
and leaves the binding uncalled; a binding that cannot give its value SHALL be logged by name,
never by value, and asked again on the next request. A service with no `SESSION_PRIVATE_KEY` or
no `STATE_SECRET` SHALL answer `500` naming the setting in the log only; a missing provider
secret SHALL answer the `provider.unavailable` page, naming it in the log only.
`packages/site/wrangler.jsonc` SHALL have `workers_dev: false`, `preview_urls: false`, the assets
directory, and no `main`, binding, `account_id` or `routes`.

#### Scenario: Development strings
- **WHEN** `.dev.vars` holds `STATE_SECRET` and the Worker runs under `wrangler dev` with its Store bindings
- **THEN** the string is used and the binding is never called

#### Scenario: Production binding
- **WHEN** `env.STATE_SECRET` is unset and `env.STATE_SECRET_STORE.get()` resolves
- **THEN** the handlers read that value, and a second request in the same isolate does not call `get()` again

#### Scenario: A secret absent everywhere
- **WHEN** neither the string nor the binding of `STATE_SECRET` gives a value
- **THEN** the answer is `500 The service is not configured.`, the log names `STATE_SECRET`, and the body names nothing

#### Scenario: Deploying with a placeholder
- **WHEN** the deploy workflow runs without `D1_DATABASE_ID`
- **THEN** `deploy-config.mjs` fails naming `D1_DATABASE_ID` and nothing is uploaded

#### Scenario: A route in the file
- **WHEN** `routes` is added to either `wrangler.jsonc`
- **THEN** the configuration test fails
