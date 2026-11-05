# Design

## Context

`workers.tf` declares the family's Workers in `local.workers` (name, repository, hostname,
zone) with `cloudflare_worker` and `cloudflare_workers_custom_domain` over `local.attached`,
which excludes a Worker until `attach_domains` (and `site_on_apex`, and `docs_deployed` from
`docs-portal`) says a version exists; D1 databases and the R2 bucket are single resources.
`secrets.tf` holds `local.secrets` (generated `random_password`s with `rotations`, and received
variables) written to the one Secrets Store, each bound by the Workers as `<NAME>_STORE`;
`github.tf` declares the product repositories' environments, their branch policies, the deploy
token secret and the deploy variables (`local.deploy_variables`, from the resources' ids), and
the received `WEB_DISPATCH_TOKEN`. `tokens.tf` scopes the Diagrams deploy token to Workers
Scripts, D1 and R2 of the whole account, so a second Worker and database need no new token. The
identity service lists the products that receive its events in `PRODUCTS`
(`packages/identity/wrangler.jsonc`: `[{ name, events }]`), each with a secret
`EVENTS_SECRET_<NAME>` the Store holds and the Worker binds; `return_to` accepts any host under
the cookie domain, so `staging.diagrams.meltemi.dev` signs in without a change. `tests/stages.tftest.hcl`
checks the plan without credentials. See proposal.md for the motivation.

## Goals / Non-Goals

**Goals:**

- Staging is production's twin in resources and configuration, differing only in names and ids,
  so a suite that passes there says something about production.
- Everything staging needs is declared here and reaches the Diagrams repository as the
  `staging` environment's variables and secrets.

**Non-Goals:**

- A staging identity service or site: the one identity service serves both, as it serves two
  products.
- Data copied from production to staging.

## Decisions

1. **Two entries per Diagrams Worker, not a module.** `local.workers` gains `diagrams_staging =
   { name = "meltemi-diagrams-staging", repository = "meltemi-diagrams", hostname =
   "staging.diagrams.meltemi.dev", zone = "dev" }` and `publish_staging = { name =
   "meltemi-diagrams-publish-staging", repository = "meltemi-diagrams", hostname =
   "staging.meltemi.page", zone = "page" }`, attached when `var.staging_deployed` is true (the
   first apply declares, the first deploy uploads, the next apply attaches, as the docs Worker);
   `cloudflare_d1_database.diagrams_staging`, `cloudflare_r2_bucket.diagrams_staging_blobs`,
   `cloudflare_workers_kv_namespace.diagrams_oauth` and `.diagrams_oauth_staging`. Alternative:
   a module instantiated twice (one more layer for two entries; the tests read flat resources).

2. **Secrets.** `random_password.forms_secret_staging` and
   `random_password.diagrams_events_secret_staging` join `local.secrets` as
   `FORMS_SECRET_STAGING`, `EVENTS_SECRET_DIAGRAMS_STAGING` and `IDENTITY_EVENTS_SECRET_STAGING`
   (one value, two names, as production's); `ADMIN_SUBS` is shared (the owner administers both).
   The Diagrams staging deploy configuration binds `FORMS_SECRET_STAGING` as `FORMS_SECRET_STORE`
   and so on, which `deploy-config.mjs` of that repository writes from the environment's
   `SECRETS_SUFFIX = "_STAGING"`. Alternative: a second Store (one per account is the pattern).

3. **The identity service's product.** `PRODUCTS` in `packages/identity/wrangler.jsonc` lists
   `{ "name": "diagrams-staging", "events": "https://staging.diagrams.meltemi.dev/_identity/events" }`
   beside `diagrams`, and the identity Worker binds `EVENTS_SECRET_DIAGRAMS_STAGING_STORE`; a
   deletion event reaches both hosts, retried as today.

4. **The GitHub environment and its values.** `github_repository_environment` `staging` for the
   Diagrams repository with the branch policy `main`, the deploy token as its secret,
   `local.deploy_variables` extended per environment (`D1_DATABASE_ID`, `OAUTH_KV_ID`,
   `SECRETS_STORE_ID`, `SECRETS_SUFFIX`; production gains `OAUTH_KV_ID` and an empty suffix),
   and the received variables `var.mcp_test_tokens = { staging = { token, token_2 },
   production = { token, token_2 } }` (sensitive, empty by default) written as `MELTEMI_TOKEN`
   and `MELTEMI_TOKEN_2` of each environment when present. Alternative: tokens set by hand in
   GitHub (nothing is configured from a machine, decision 0004).

5. **What runs locally and how tests avoid the network.** `tests/stages.tftest.hcl` gains the
   staging cases with the mocked providers: the two Workers and their domains present only with
   `staging_deployed`, the database, the bucket, the two namespaces, the five secrets, the
   environment with its variables, and the tokens absent when the variables are empty; no plan
   needs a credential.

6. **The decision note.** `docs/decisions/0008-diagrams-staging.md`: a twin per environment in
   the same root, shared identity and Store, the test tokens as received variables.

## Risks / Trade-offs

- [The Free plan's limits are shared by both environments] → D1 (ten databases), R2, KV and
  Durable Objects duration are well under the limits for a staging that only the suite and the
  owner use; the plan's figures are in the note.
- [A staging publication on `staging.meltemi.page`] → the host serves what the suite publishes
  under test names and deletes; the Diagrams suite cleans up, and the host is not linked anywhere.
- [The owner forgets to flip `staging_deployed`] → the plan test names the stage; the Custom
  Domain is the only thing waiting.

## Settled after the first apply (5 November 2026)

The first apply created the staging Workers, database, bucket, secrets and environment, then
failed on the two KV namespaces: `POST /storage/kv/namespaces` answered "Unauthorized", because
this root's Cloudflare token (step 3 of the bootstrap) has no Workers KV permission, so no
environment variable was written. Rather than widen the owner's token, the namespaces and
`OAUTH_KV_ID` are gone: Diagrams' authorization server keeps its state in each environment's D1
database (its migration 0010), which also lifts the Free plan's thousand KV writes a day from a
sign-in that writes about five entries and an hourly refresh about three. The paragraphs below
that name the namespaces and `OAUTH_KV_ID` describe the first apply.

## Settled during apply (4 November 2026)

1. **The deploy token needs no KV permission.** Cloudflare's Workers authorization
   (<https://developers.cloudflare.com/workers/authorization/workers/>) says that deploying a
   Worker needs `Editor` on the Worker (the legacy "Workers Scripts Write") and that "you do not
   need separate permissions on the bound resources to deploy the Worker". Wrangler 4.151.3, the
   version Diagrams deploys with, agrees in its binding provisioning
   (`deploy-helpers/src/deploy/helpers/provision-bindings.ts` in `wrangler-dist/cli.js`): a KV
   binding is "fully specified" when it has an `id` and is never looked up, while an R2 binding
   is looked up by `bucket_name` (`getR2Bucket`), which is why the Diagrams token already reads R2.
   `deploy_groups.diagrams` is unchanged. Diagrams' deploy configuration must therefore always
   write `OAUTH_KV_ID` (its `deploy-config.mjs` refuses placeholders); a KV binding without an id
   would make Wrangler list namespaces. If the first staging deploy is nevertheless refused for KV,
   the fix is "Workers KV Storage Read" (a lookup) in that list, which the token's precondition
   names if the account lacks it.
2. **Two landings.** The Terraform half (tasks 1.1, 1.2's Store secrets, 1.3, 2.1) is the first
   pull request. The identity service's half of task 1.2, the product `diagrams-staging` in
   `PRODUCTS` and the binding `EVENTS_SECRET_DIAGRAMS_STAGING_STORE`, is the branch's last commit,
   alone, for a second pull request: the identity deploy would fail on a binding to a Store secret
   that the first apply has not created yet, and the service would sign deletion events for a host
   that does not answer until Diagrams has deployed staging and `staging_deployed` is `true`
   (it would retry them for seven days, then drop them). It lands after both.
3. **What Diagrams' deploy reads.** The `staging` environment holds the names production's deploy
   reads today (`CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, `SECRETS_STORE_ID`, and the secret
   `CLOUDFLARE_API_TOKEN`) with staging's values, plus `OAUTH_KV_ID` and `SECRETS_SUFFIX`
   (`_STAGING`) from decision 4 and **`R2_BUCKET_NAME`**, which decision 4 does not list: Wrangler
   binds a bucket by name, Diagrams' committed `wrangler.jsonc` names production's, and Terraform
   owns the name, so both environments carry it (`meltemi-diagrams-blobs`,
   `meltemi-diagrams-staging-blobs`). Production gains `OAUTH_KV_ID` and `R2_BUCKET_NAME`.
   **Production's `SECRETS_SUFFIX` is not created** rather than created empty: the GitHub API's
   documentation marks `value` required and says nothing of an empty one, and an apply refused by
   GitHub would stop the automatic pipeline; GitHub's contexts documentation says a configuration
   variable that has not been set reads as an empty string, which is the value decision 4 wants.
   Names Diagrams' deploy must still write itself, as it does for production (Terraform does not
   hand them over): the Worker names `meltemi-diagrams-staging` and
   `meltemi-diagrams-publish-staging`, the D1 `database_name` `meltemi-diagrams-staging`,
   `ORIGIN` `https://staging.diagrams.meltemi.dev` and `PUBLISH_HOST` `staging.meltemi.page`.
4. **No public address of their own.** The staging Workers are entries of `local.workers`, so
   `cloudflare_worker.family` gives them `subdomain = { enabled = false, previews_enabled = false }`
   and production's observability; Diagrams' staging configuration keeps `workers_dev` and
   `preview_urls` `false`, as its production one does. The plan test asserts both Workers.
5. **`SPONSORS_WEBHOOK_SECRET` is shared, like `ADMIN_SUBS`.** It joined the Store (Web #21) after
   this design was written. The one Sponsors webhook delivers to production; a staging value would
   be a secret no sender holds, so staging binds production's name and the twin keeps the same set
   of bindings. The Store therefore holds twelve secrets: production's nine and the three staging
   names of decision 2 (decision 5's "five secrets" are those three and the two shared ones).
6. **Per-environment keys.** `github_actions_environment_secret.cloudflare_api_token` and
   `github_actions_environment_variable.deploy` are keyed `<repository>/<environment>` and
   `<repository>/<environment>/<NAME>` over `local.deploy_environments`; eight `moved` blocks
   carry production's two secrets and six variables to their new keys, so the first plan shows
   them moved, not destroyed and created. The `production` environments themselves keep their
   resource; `staging` is `github_repository_environment.diagrams_staging` with
   `github_repository_environment_deployment_policy.diagrams_staging_main`, as the IDE's `release`.
7. **How `mcp_test_tokens` reaches Terraform.** Its type is
   `map(object({ token = optional(string, ""), token_2 = optional(string, "") }))`, keys
   `staging` and `production` only (a validation refuses others), default `{}`. The infrastructure
   workflows compose `TF_VAR_mcp_test_tokens` from four secrets of the `infrastructure`
   environment, `MCP_TEST_TOKEN_STAGING`, `MCP_TEST_TOKEN_2_STAGING`, `MCP_TEST_TOKEN_PRODUCTION`
   and `MCP_TEST_TOKEN_2_PRODUCTION`, one per token rather than one JSON secret, because GitHub
   masks a secret's whole value and advises against structured secrets; an absent one is an empty
   string and writes nothing. `mdg_` tokens are base64url, which needs no escaping inside the JSON
   string. The file invariant "every sensitive variable is empty or required" accepts `{}`.
8. **Name collisions.** A precondition on `cloudflare_worker.family` refuses two entries of
   `local.workers` with one name or one host and names it; the plan test `staging_storage` refuses
   a staging database, bucket or namespace with a production name and names it. Both were checked
   by renaming a staging resource to its production name.
9. **What a plan prints.** `terraform test -json` (the plan's message stream) and the text output
   hold none of the test tokens or generated values; `terraform test -verbose` embeds each run's
   JSON plan, which, as every JSON plan, holds all sensitive values in clear (the existing secrets
   too). The pipelines never print one: the plan comment is the text plan, and the drift workflow
   reduces its JSON plan to addresses (`plan-changes.mjs`) and deletes it.
