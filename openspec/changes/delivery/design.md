## Context

`packages/identity` is the identity Worker of decision 0002 and the reference verifier products
import; `packages/site` is the family's site of decision 0003, static assets of a Worker with no
code. Both run under `wrangler dev` (ports 8787 and 8789) and pass their suites in Node with
in-memory stores and stub providers. Three owner tasks remain in their changes.

The state found on 2026-10-20: `meltemi.dev` has Dynadot's nameservers (`ns1/ns2.dyna-ns.net`),
its apex `A` records point at GitHub Pages, which serves the IDE's landing from
`askenaz-dev/meltemi/site`; `id.meltemi.dev` does not resolve; neither this folder nor Diagrams'
is a Git repository; the GitHub organisation `askenaz-dev` and the npm organisation `meltemi`
are the owner's; `meltemi.page`, bought that day for Diagrams' publications, is registered at
Dynadot too, and `meltemi.dev` holds no record but the four GitHub Pages `A` records. Diagrams'
`packages/cloud` depends on this package through a `link:` and verifies sessions against
`https://id.meltemi.dev`, so its delivery waits for this one.

The owner's two rules of 2026-10-20: infrastructure configuration is Terraform everywhere it
can be, and everything executes as GitHub pipelines. What was verified before designing:

- The Cloudflare Terraform provider 5.x has `cloudflare_zone`, `cloudflare_dns_record`,
  `cloudflare_d1_database`, `cloudflare_r2_bucket`, `cloudflare_worker` (the Worker as an
  entity, with `subdomain.enabled` and `previews_enabled`, observability), `cloudflare_worker_version`
  and `cloudflare_workers_deployment`, `cloudflare_workers_custom_domain`, `cloudflare_secrets_store`
  and `cloudflare_secrets_store_secret` (value write-only), `cloudflare_api_token`. It has no
  registrar resource and no classic Worker-secret resource; a classic secret is a binding of a
  version. Cloudflare's own guidance is to manage the Worker entity in Terraform and let
  Wrangler upload versions; versions with static assets are not covered by Terraform, and a
  Durable Object binding cannot be created in a first apply.
- Secrets Store is in open beta; a Worker binds a secret with `secrets_store_secrets`
  (`binding`, `store_id`, `secret_name`) and reads it with `await env.X.get()`; production
  values cannot be read locally.
- R2's S3 API supports atomic `If-None-Match` on `PutObject`, which is what Terraform's S3
  backend lock file (`use_lockfile`, Terraform 1.10+) relies on.
- No Terraform provider for Dynadot is published on the registry (four unpublished GitHub
  repositories exist, none with users). Dynadot's `api3` has `set_ns` (key in the query; the
  nameservers must first be added to the account); its newer RESTful API needs an HMAC
  signature per request, which a generic REST provider cannot compute.
- Terraform 1.15.4 is installed on the owner's machine.

## Goals / Non-Goals

**Goals:**

- Every Cloudflare and GitHub resource of the family declared in one Terraform root, applied
  only by a pipeline, with drift reported.
- No secret ever typed into a Worker from a machine: Terraform generates or receives every
  value and the Workers read them from the Store.
- `id.meltemi.dev` and `meltemi.dev` live from this repository's pipelines; `@meltemi/identity`
  on npm with provenance; Diagrams' resources ready for its own delivery.
- The handful of actions no API offers listed once, in order, with the page or command.

**Non-Goals:**

- Terraform-managed Worker versions (code): Wrangler uploads them (decision 4).
- The IDE repository, the two functional changes' owner tasks, Diagrams' repository contents.
- `www.meltemi.dev`, staging, previews, analytics, paid plans.

## Decisions

### 1. The repository: `askenaz-dev/meltemi-web`, Apache-2.0

Public from the first push, named as `docs/repositories.md` anticipated. `LICENSE` (Apache-2.0)
at the root and in the identity package's tarball; the owner confirms the licence before the
push. `.gitignore` keeps `node_modules/`, `dist/`, `.wrangler/`, `.vitest/`, `*.tsbuildinfo`, the
OS files, `.dev.vars*` with `!.dev.vars.example`, and Terraform's local files (`.terraform/`,
`*.tfstate*`, `*.tfvars` except `*.auto.tfvars.example`, `crash.log`, `*.tfplan`). The first
commit is the whole tree on `main`; the repository is created in the browser or after `gh auth
login` with the personal account (the work account's token is invalid); then Terraform imports
it (decision 6) and manages it from there.

Alternatives: a private repository (products install a package whose source nobody could
read); MIT (the site files carry Apache-2.0; decision 0001 kept it).

### 2. Where the infrastructure lives: `packages/infra` in this repository

One Terraform root in this repository, which decision 0001 made the home of what the family
shares. It declares the shared things (the zones, the GitHub organisation's repositories) and
each product's cloud resources (databases, buckets, Worker entities, domains, secrets), with
one state. Diagrams' repository keeps only its code and a `wrangler.jsonc` that binds the ids
this root outputs (`terraform output -json`, copied into the file by the owner once, checked by
a test there against the names this design fixes). The products still own their data: Terraform
creates the database and the bucket; the product's migrations and code own what is in them.

Alternatives: a fourth repository `askenaz-dev/meltemi-infra` (cleaner separation, one more
bootstrap and one more set of root secrets; the folder moves there as it is if the estate
grows); one Terraform root per product repository (two states fighting over one zone, and the
zone's owner would have to be one of them anyway).

### 3. State in R2, locked

The backend is `s3` against the account's R2 endpoint, bucket `meltemi-terraform-state`, key
`family.tfstate`, `use_lockfile = true`, with the AWS-specific checks skipped
(`skip_credentials_validation`, `skip_region_validation`, `skip_requesting_account_id`,
`skip_metadata_api_check`, `skip_s3_checksum`), credentials from an R2 API token (S3 access
key and secret) in the pipeline's secrets. R2's atomic `If-None-Match` makes the lock file a
real lock, and the apply workflow runs one at a time anyway. The bucket is the one resource
created by hand (the bootstrap), because the state that would manage it lives in it; the
README names it.

Alternatives: HCP Terraform's free tier (remote runs, a UI, a third account and a third place
for secrets); state in the repository (secrets in Git, never).

### 4. Terraform declares, Wrangler uploads

The split follows Cloudflare's guidance and the verified limits:

- Terraform: `cloudflare_zone` for both domains (created by Terraform, so their nameservers are
  an output for the registrar step), `cloudflare_dns_record` for every record (the apex `A`
  records to GitHub Pages behind a variable `apex_on_github_pages`, `true` until the site swap,
  `proxied = false` so GitHub's certificate keeps working; a zone created through the API starts
  empty, so nothing is imported), `cloudflare_d1_database` (`meltemi-identity`, `meltemi-diagrams`), `cloudflare_r2_bucket`
  (`meltemi-diagrams-blobs`), `cloudflare_worker` × 4 with `subdomain = { enabled = false,
  previews_enabled = false }` and observability on, `cloudflare_workers_custom_domain` × 4
  (`id.meltemi.dev` → `meltemi-identity`, `meltemi.dev` → `meltemi-site`,
  `diagrams.meltemi.dev` → `meltemi-diagrams-cloud`, `meltemi.page` →
  `meltemi-diagrams-publish`), the Secrets Store and its secrets (decision 5), the deploy
  tokens (decision 6), and GitHub (decision 6).
- Wrangler, from each product's `deploy.yml`: `wrangler d1 migrations apply DB --remote` and
  `wrangler deploy`, which uploads the version (code, static assets, Durable Object
  migrations) to the entity Terraform created. `wrangler.jsonc` keeps `workers_dev: false` and
  `preview_urls: false` so a deploy never re-enables what Terraform disabled, has no `routes` (a
  route in both places would be two owners of one thing) and no `account_id`, and keeps
  placeholder ids: Terraform writes `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID` and
  `SECRETS_STORE_ID` as variables of the repository's `production` environment, Wrangler reads the
  first, and `scripts/deploy-config.mjs` writes the other two into `wrangler.deploy.json` before
  the upload, refusing to leave a placeholder. Nobody copies an id; `wrangler dev` keeps working
  with the placeholders.

The Worker entity must exist before Wrangler uploads to it (else Terraform would find a Worker
it did not create: an `import` fixes that, the README says how), and a Custom Domain needs a
Worker with a version. The first apply therefore runs with `attach_domains = false`, the
product pipelines deploy, and a second apply with `attach_domains = true` (the default from
then on) attaches the four domains. After the bootstrap, both repositories deploy independently.

Alternatives: Terraform-managed versions (`cloudflare_worker_version` with the bundle of
`wrangler deploy --dry-run --outdir`): every binding and secret would be Terraform's and the
ordering problem would vanish, but the playground and the site are static assets, which the
provider does not deploy, and a Durable Object binding needs a two-step apply; Wrangler-managed
Custom Domains (`routes` with `custom_domain: true`): no bootstrap step, but a domain declared
outside Terraform.

### 5. Secrets: generated or received by Terraform, read from the Store

`cloudflare_secrets_store` `meltemi` holds eight `cloudflare_secrets_store_secret`s scoped to
`workers`: `SESSION_PRIVATE_KEY`, `STATE_SECRET`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET`,
`EVENTS_SECRET_DIAGRAMS` for the identity Worker; `FORMS_SECRET`, `IDENTITY_EVENTS_SECRET` and
`ADMIN_SUBS` for Diagrams' main Worker. `STATE_SECRET`, `FORMS_SECRET` and the shared events
secret are `random_password` resources (64 characters; `EVENTS_SECRET_DIAGRAMS` and
`IDENTITY_EVENTS_SECRET` are the same value, so the two Workers agree by construction; rotation
is `terraform taint`). The OAuth secrets, the session private key (from `pnpm identity:keys`)
and `ADMIN_SUBS` are sensitive variables fed from the pipeline's secrets (`TF_VAR_…`). Values
are write-only on the API and sensitive in the plan; the state holds them, in the private
bucket, which is the trade-off of managing them at all.

The identity Worker binds them as `secrets_store_secrets` with binding names
`<NAME>_STORE` (`SESSION_PRIVATE_KEY_STORE`, …). Its entry (`src/worker.ts`) calls
`resolveSecrets(env)` (`src/secrets.ts`) before anything else: every `<NAME>_STORE` binding is read
once per isolate into `<NAME>`, unless a non-empty string `<NAME>` exists (`.dev.vars`, the
tests), which wins and leaves the binding uncalled; a binding that cannot give its value is logged
by name and asked again next time. Every handler keeps reading `env.<NAME>` as a string, so the
service's code and its tests do not change. The entry refuses to start without
`SESSION_PRIVATE_KEY` (as before) or `STATE_SECRET` (new), answering `500` with the name in the
log; a missing provider secret keeps answering the `provider.unavailable` page. The suffix keeps
development and production from naming one binding twice, which Wrangler refuses; Wrangler's
local mode accepts the bindings (an empty local store rejects `get()`, which the strings make
moot). Secret values are capped at 1,024 bytes; the signing JWK is about 220.

Alternatives: `wrangler secret put` in the product pipelines from GitHub secrets Terraform
places there (no code change; the values live in two places and a removed secret stays on the
Worker); `secret_text` bindings on Terraform-managed versions (decision 4 rules versions out).

### 6. GitHub and the tokens, by Terraform

The `integrations/github` provider, authenticated with a fine-grained personal access token of
the owner scoped to the `askenaz-dev` organisation (repository administration, secrets,
environments; an expiry the owner renews) in the pipeline's secrets, declares:
`github_repository` for `meltemi-web` (imported) and `meltemi-diagrams` (created: public, MIT
is in its tree, issues on, wiki off, squash merges, `vulnerability_alerts`), a
`github_repository_environment` `production` in each, `github_actions_environment_secret`
`CLOUDFLARE_API_TOKEN` in each from a `cloudflare_api_token` Terraform mints per repository
(a user token of the owner: on 2026-10-21 the Secrets Store, in open beta, refused an account-owned
token's bindings at upload with 10021 and accepted a user token's; Workers Scripts Write and D1 Write, R2 read
for Diagrams, the Secrets Store's write group (binding a secret needs it), nothing else; a
precondition names any group the account does not list), `github_actions_environment_variable`
`CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID` and `SECRETS_STORE_ID` in each, `github_actions_secret`
`NPM_TOKEN` in both and `VSCE_PAT`, `OVSX_PAT` in `meltemi-diagrams` once their variables are
set, `github_repository_vulnerability_alerts`, and a `github_repository_ruleset` on the default
branch of each (no deletion, no force push). The root token
Terraform itself uses (Cloudflare: zones, DNS, D1, R2, Workers, Secrets Store, API Tokens
write) and the GitHub token are the bootstrap secrets, set by hand in this repository's
`infrastructure` environment, and the only ones that are. Private vulnerability reporting is
turned on by hand where the provider lacks it.

Alternatives: a GitHub App for the provider (no expiry, finer permissions; more setup for one
owner; the README names it as the upgrade); one Cloudflare token for everything (a product's
pipeline could then edit the zone).

### 7. The registrar: a pipeline step, not Terraform

No provider exists for Dynadot, so `registrar.yml` (`workflow_dispatch` with a dry-run input,
environment `infrastructure`) runs `packages/infra/scripts/dynadot-nameservers.mjs` with
`DYNADOT_API_KEY`: it reads both zones' nameservers from `terraform output -json nameservers`,
reads each domain's current ones (`get_ns`), and, only when they differ, adds the hosts the
account lacks (`server_list`, `add_ns`) and calls `set_ns` for `meltemi.dev` and `meltemi.page`;
it prints what it did and never the key, even when Dynadot's error repeats it. It is idempotent and run once. The
registrar stays Dynadot for both domains (the owner's decision of 2026-10-20: Cloudflare serves
DNS only). Dynadot's API answers only whitelisted IP addresses, which GitHub's runners cannot be,
so the step runs once from the owner's machine (`pnpm registrar:nameservers`), with the key typed
in the terminal; `registrar.yml` stays for a self-hosted runner. DNSSEC is not set up: it would
need a DS record at Dynadot too, whose mistake takes the domain offline.

Alternatives: an unpublished community provider (no users, no releases); the generic REST
provider against Dynadot's RESTful API (needs an HMAC signature per request it cannot compute);
changing the nameservers in Dynadot's panel (a click outside any pipeline, against the owner's
rule).

### 8. The infrastructure pipelines

- `infra-plan.yml`: pull requests touching `packages/infra`; `terraform fmt -check`, `init`,
  `validate`, `plan -no-color`, the plan written as the pull request's comment (updated in
  place); read-only token use.
- `infra-apply.yml`: pushes to `main` touching `packages/infra` and `workflow_dispatch`;
  `concurrency: infra` without cancellation; `init`, `plan -out`, `apply` of that plan; the
  outputs (ids, nameservers; never values) as the run's summary.
- `infra-drift.yml`: weekly `plan -detailed-exitcode`; exit code 2 opens or updates an issue
  titled "Infrastructure drift" with the plan.
- `registrar.yml`: decision 7.

Terraform runs with `hashicorp/setup-terraform` pinned to a 1.x minor; providers are pinned
with `~>` constraints (cloudflare 5.28, github 6.13, random 3.9) and the lock file is committed
with every platform's hashes. `ci.yml` also runs `terraform fmt`, `validate` and `test`: the
stages planned against mocked providers, with no credential.

### 9. The code pipelines and the package

`ci.yml` (Node 22 and 24 on `ubuntu-latest` and `windows-latest`: install, typecheck, lint,
test, build; `concurrency`; no secret), `deploy.yml` (push to `main` touching the packages or
the workflows; `production` environment; `pnpm build`; the identity migrations; `wrangler
deploy` of identity, then of the site) and `release.yml` (tags `v*`: the version check, tests
and build, `npm publish --access public --provenance` skipped when the version exists, the
GitHub release) are as the previous design described; the deploy token now comes from
Terraform. The package's manifest gains the publish fields, `files` `["dist", "README.md",
"LICENSE"]` and `engines`; its README says how to install it and how to `pnpm link` a local
checkout. Trusted publishing on npm is the owner's follow-up once the package exists.

### 10. The production OAuth apps

GitHub: an OAuth App of the `askenaz-dev` organisation, callback
`https://id.meltemi.dev/callback/github`. Google: a web application OAuth client with redirect
`https://id.meltemi.dev/callback/google` and the consent screen in production status with the
privacy and terms links; scopes `openid`, `email`, `profile`. The client ids go into
`wrangler.jsonc`; the secrets into the pipeline's secrets, which Terraform puts in the Store.
Neither provider offers an API for this.

### 11. Order and hand-offs

1. The functional changes' owner tasks, both archived.
2. The repository (1); the bootstrap: the state bucket and its keys, the root Cloudflare
   token, the GitHub token, the Dynadot key, the `infrastructure` environment; `meltemi.page`
   registered (the zone appears); the OAuth apps (10); the key pair; the variables' values.
3. `packages/infra` applied with `apex_on_github_pages = true`, `attach_domains = false`: the
   zones (their nameservers in the outputs), records, databases, bucket, Worker entities, Store,
   tokens, GitHub repositories, their environments, variables and secrets. `registrar.yml` moves
   both domains' nameservers; the IDE's landing keeps answering.
4. This repository's `deploy.yml` uploads identity and the site; Diagrams' delivery uploads its
   two Workers. Both read the ids from their `production` environments.
5. `attach_domains = true`: three domains attach. Then `apex_on_github_pages = false` (the GitHub
   Pages records go) and, in the next commit, `site_on_apex = true`: the family site answers at
   the apex and `www` redirects to it. The manual sign-in in production; the IDE repository's
   clean-up.
6. The tag `v0.1.0`; `@meltemi/identity@0.1.0` on npm; Diagrams replaces its `link:`.

What runs locally: everything as before (`wrangler dev` with `.dev.vars`, the suites); the
tests of this change read the Terraform files, the workflows and the configuration files and
never reach the network; `terraform validate` runs offline after `init` cached the providers.

## Risks / Trade-offs

- [Secrets in Terraform state] → the bucket is private, its keys are two pipeline secrets, the
  state is never downloaded to a machine; rotation is a taint or a new variable value.
- [Secrets Store is in open beta] → the adapter keeps `.dev.vars` strings working, so a
  fallback to classic secrets is one binding type away; the beta's limits are read at apply
  time and the README names them.
- [A Custom Domain refuses a Worker without a version] → `attach_domains` and the bootstrap
  order (decision 4); afterwards a plan shows no change.
- [`wrangler dev` starts with a Store binding that has no local value] → the adapter never
  calls `get()` when the `.dev.vars` string exists; the browser suite's configuration copy
  strips the bindings.
- [Records lost in the nameserver move] → Terraform declares them before the move; the drift
  plan shows what the import missed; the old nameservers answer until the registry switches.
- [Dynadot retires `api3` before the step runs] → the script targets whichever endpoint Dynadot
  documents for nameservers at apply time; the step only runs again if Cloudflare assigns other
  nameservers.
- [The GitHub token expires] → `infra-apply.yml` fails naming the provider; the owner renews it;
  the GitHub App is the upgrade.
- [A plan comment leaks a value] → every secret is a sensitive variable or resource attribute;
  the plan test asserts `(sensitive value)` for them.
- [`apex_on_github_pages` flipped before the site is ready] → the swap is two commits the plan
  shows; reverting the first restores the records in the next apply, and `site_on_apex` is
  refused while GitHub Pages holds the apex.
