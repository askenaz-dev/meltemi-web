# 0008. A staging twin of the Diagrams service, declared beside production in the same root

Status: accepted (owner, 4 November 2026; the `diagrams-staging` change)

## Context

Meltemi Diagrams' change `agent-mcp` adds an MCP endpoint, an OAuth authorization server and
server-drawn previews to its hosted service, and its specification counts the delivery only once
thirty acceptance criteria pass on staging and on production, with a controlled test project.
Until now each Worker of the family had one environment: Diagrams' deploy took CI-approved `main`
straight to production, and nothing ran a suite against a host that was not production. Every
Worker, database, bucket, domain, secret and GitHub environment of the family is declared in this
repository's `packages/infra` ([decision 0004](0004-delivery.md)), so the twin is declared here
too.

## Decision

- **A twin per environment, in the same Terraform root.** Two more entries of `local.workers`,
  `meltemi-diagrams-staging` at `staging.diagrams.meltemi.dev` and
  `meltemi-diagrams-publish-staging` at `staging.meltemi.page`, with no `workers.dev` and no
  preview address, and their own D1 database `meltemi-diagrams-staging` and R2 bucket
  `meltemi-diagrams-staging-blobs`. Flat resources, as every other one here: no module for two
  entries. A precondition refuses two Workers with one name or one host, and the plan test
  refuses a staging database or bucket with a production name.
- **No KV.** Diagrams' OAuth authorization server keeps its clients, grants and tokens in each
  environment's D1 database. The first apply of this change could not create the two KV
  namespaces it then declared (this root's Cloudflare token has no KV permission), and the Free
  plan's thousand KV writes a day would not last a dozen agents refreshing their tokens hourly.
- **Staged like the portal.** The staging Custom Domains wait for `staging_deployed`: the apply
  that declares the Workers leaves it `false`, Diagrams' deploy uploads their first versions, and
  a commit then sets it `true`.
- **One identity service, one Store.** Staging signs in through `id.meltemi.dev` like any host
  under the cookie's domain. Its generated secrets are its own, `FORMS_SECRET_STAGING` and the
  events secret named `EVENTS_SECRET_DIAGRAMS_STAGING` for the identity service and
  `IDENTITY_EVENTS_SECRET_STAGING` for the Worker, so nothing signed for one environment is
  accepted by the other; `ADMIN_SUBS` and `SPONSORS_WEBHOOK_SECRET` are shared (the owner
  administers both, and the one Sponsors webhook delivers to production). Staging's deploy binds
  the suffixed names through its environment's `SECRETS_SUFFIX`. The identity service lists the
  product `diagrams-staging`, so deleting an account reaches staging too.
- **The `staging` environment of the Diagrams repository**, deployable from `main` only, holds the
  same deploy token as `production` and the names production's deploy reads, with staging's values
  (`CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, `SECRETS_STORE_ID`), plus `R2_BUCKET_NAME` and
  `SECRETS_SUFFIX` (`_STAGING`). Production gains `R2_BUCKET_NAME`; its suffix is empty, which
  GitHub reads from a variable that is not set.
- **The acceptance suite's tokens are received variables.** `mcp_test_tokens` (sensitive, empty
  by default) holds the `mdg_` tokens of two test accounts per environment; the infrastructure
  workflows pass it from four secrets of the `infrastructure` environment, one per token so that
  each is masked on its own, and Terraform writes each present one as `MELTEMI_TOKEN` or
  `MELTEMI_TOKEN_2` of its environment. Nothing is set by hand in the Diagrams repository.
- **No new token permission.** Cloudflare's Workers authorization says that deploying a Worker
  needs no separate permission on the resources it binds, and Wrangler (4.151.3) looks up an R2
  bucket at deploy (the reason for "Workers R2 Storage Read"). The Diagrams deploy token keeps
  its groups.

## Alternatives considered

- **A Terraform module instantiated twice**: one more layer for two entries, and the tests read
  flat resources.
- **A second Secrets Store for staging**: an account holds one, and the pattern is one per account.
- **A staging identity service**: a second issuer, keys and OAuth apps for a twin that only the
  suite and the owner use; the one service already serves two products.
- **Wrangler environments** (`env.staging` in Diagrams' `wrangler.jsonc`): names and ids would be
  written in the product repository, where today none is.
- **Tokens set by hand in GitHub**: nothing is configured from a machine (decision 0004).
- **Data copied from production**: staging holds only what the suite creates and deletes.

## Consequences

- The Free plan's limits are the account's, shared by both environments: D1 ten databases (three
  used), 500 MB each, 5 GB in all, five million rows read and 100,000 written a day; KV 100,000
  reads and 1,000 writes a day, 1 GB stored; R2 10 GB-month, one million Class A and ten million
  Class B operations a month; SQLite Durable Objects 100,000 requests and 13,000 GB-s a day, 5 GB;
  Workers 100,000 requests a day and 100 Workers (eight declared). A staging that only the suite
  and the owner use stays far below them.
- `staging.meltemi.page` serves what the suite publishes under test names, which the suite
  deletes; the host is linked from nowhere.
- The identity service's binding of the staging events secret and its product entry land in a
  second pull request, once the staging Workers answer: before then the Store secret it binds
  would not exist, and its deletion events would go to a host that does not answer.
- Diagrams' deploy (its change `agent-mcp`) reads the `staging` environment and writes its
  configuration from those names; the rollout gains a seventh step, the commit that sets
  `staging_deployed`.
