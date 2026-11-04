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
