# Validation

Recorded on 2026-11-04 (America/Santiago) in the worktree `C:\meltemi\worktrees\diagrams-staging`,
branch `diagrams-staging` from `origin/main` `43e63a1`, on Windows 11, Node 24.15.0, pnpm 10.33.2,
Terraform 1.15.4 (providers cloudflare 5.28.0, github 6.13.0, random 3.9.1 from the lock file).
Nothing here reached Cloudflare or GitHub with a credential: Terraform ran against the mocked
providers of `pnpm infra:test`, the environment held no Cloudflare or GitHub token, and the
portal's build used its fixture and its offline embedder. No apply, no push, no pull request.

## Two landings

The branch holds two pull requests' worth of commits, in order:

1. **Terraform and records** (this file's first section): the staging Workers, storage and KV
   namespaces, the Store's staging secrets, the Diagrams `staging` environment and its variables,
   `mcp_test_tokens` and the infrastructure workflows that pass it, decision 0008, the maps. It
   is green on its own.
2. **The identity service** (the branch's last commit, alone): `PRODUCTS` gains
   `diagrams-staging` and the Worker binds `EVENTS_SECRET_DIAGRAMS_STAGING_STORE`. It lands as a
   second pull request once the first has been applied (the Store secret exists), Diagrams' deploy
   has uploaded the staging Workers and `staging_deployed` is `true` (the events address answers).
   Merged earlier, the identity deploy would fail on the binding, or the service would sign
   deletion events for a host that does not exist.

## Gates of the first landing (task 2.2)

| Gate                                            | Result                                                                                                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                                  | Up to date with the lockfile                                                                                                                                                            |
| `pnpm typecheck`                                | Green in every package                                                                                                                                                                  |
| `pnpm lint`                                     | ESLint clean; Prettier: all matched files formatted                                                                                                                                     |
| `pnpm build`                                    | Green; the portal from its fixture: 24 pages, 1 picture from 4 `text` fences, 36 passages                                                                                               |
| `pnpm test`                                     | 55 files, 2,311 passed, 1 skipped (the IDE-token check that needs `MELTEMI_IDE`)                                                                                                        |
| `pnpm infra:fmt`                                | Formatted                                                                                                                                                                               |
| `pnpm infra:validate`                           | The configuration is valid                                                                                                                                                              |
| `pnpm infra:test`                               | 26 runs passed, 0 failed (15 before; new: `staging_staged`, `staging_attached`, `staging_before_domains`, `staging_storage`, `staging_secrets`, `staging_rotation`, `staging_environment`, `mcp_test_tokens_present`, `mcp_test_tokens_staging_only`, `mcp_test_tokens_empty`, `mcp_test_tokens_unknown_environment`; extended: `first_apply`, `domains_attach`, `docs_attached`) |
| `openspec validate "diagrams-staging" --strict` | Valid                                                                                                                                                                                   |

## Gates of the second landing (the identity commit)

The branch's last commit adds the product `diagrams-staging`
(`https://staging.diagrams.meltemi.dev/_identity/events`) to `PRODUCTS` in
`packages/identity/wrangler.jsonc` and the binding `EVENTS_SECRET_DIAGRAMS_STAGING_STORE` of the
Store secret `EVENTS_SECRET_DIAGRAMS_STAGING`. `scripts/deploy-config.mjs` writes the Store's id
into every binding and names none, so it does not change; its test counts six bindings.

| Gate                                            | Result                                                                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                | Green in every package                                                                                                                       |
| `pnpm lint`                                     | ESLint clean; Prettier: all matched files formatted                                                                                          |
| `pnpm build`                                    | Green                                                                                                                                        |
| `pnpm test`                                     | 55 files, 2,312 passed, 1 skipped; `packages/identity` and `test/scripts.test.ts`: 29 files, 1,937 tests                                     |
| `pnpm infra:fmt`, `infra:validate`, `infra:test` | Formatted; valid; 26 runs passed (unchanged by this commit)                                                                                |
| `openspec validate "diagrams-staging" --strict` | Valid                                                                                                                                        |

The scenario "The product listed" is `packages/identity/test/config.test.ts`: the committed
variables read as a production environment list `diagrams` and `diagrams-staging` with `https:`
events addresses and their secret names, the Worker binds `EVENTS_SECRET_DIAGRAMS_STAGING`, and
every product listed has its secret bound.

## The scenarios, where each is checked

| Scenario (spec delta)                 | Check                                                                                                                                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staged domains                        | `staging_staged` (both Workers, no `workers.dev` or preview address, no staging domain, production's five kept), `staging_attached` (both hosts, their Workers, seven domains), `staging_before_domains` (none before `attach_domains`) |
| The storage                           | `staging_storage`; `first_apply` lists the seven Workers                                                                                                                                                                                |
| A name that collides                  | Renaming the staging bucket and database to `meltemi-diagrams-blobs` and `meltemi-diagrams` failed `staging_storage` with "A staging database has a production name: meltemi-diagrams." and "The staging bucket has production's name: meltemi-diagrams-blobs."; renaming the staging publish Worker to `meltemi-diagrams-publish` failed every plan on the precondition "Each Worker needs a name and a host of its own: meltemi-diagrams-publish is given twice." Both reverted |
| The secrets                           | `first_apply` (the Store's twelve names), `staging_secrets` (with the generated values given at plan: staging's two events names equal, staging's values differ from production's, no `ADMIN_SUBS_STAGING` or `SPONSORS_WEBHOOK_SECRET_STAGING`), `files.test.ts` (each name from a variable or a `random_password`; the twin names read the same resource) |
| A rotation                            | `staging_rotation`: only `random_password.diagrams_events_secret_staging` changes its keeper; both its names read that one resource                                                                                                    |
| The product listed                    | The second landing (above)                                                                                                                                                                                                              |
| The environment's values              | `staging_environment`: the environment and its `main` policy, the token in both environments, staging's six variables with staging's database, namespace and bucket and `_STAGING`, production's five, the web's three; `first_apply` counts 3 tokens and 14 variables |
| Tokens absent                         | `first_apply` (default `{}`) and `mcp_test_tokens_empty` (four empty strings, what the workflows pass while the secrets are absent): no `MELTEMI_TOKEN` secret, the plan valid                                                         |
| Tokens present                        | `mcp_test_tokens_present`, `mcp_test_tokens_staging_only`; the plan prints no value (below)                                                                                                                                             |
| An environment Diagrams does not have | `mcp_test_tokens_unknown_environment`: the variable's validation refuses `preview`                                                                                                                                                      |

## The plan prints no token

- `terraform test -json` (the plan's message stream) and `terraform test` (text) were searched for
  every token and generated value the tests give (`mdg_staging-first-token`,
  `mdg_production-first-token`, `mdg_production-second-token`, `mdg_preview-token`, the
  overridden `staging-events`, `production-events`, `staging-forms`, `production-forms`) and for
  the existing `github-secret` and `google-secret`: none appears.
- `terraform test -verbose -json` embeds each run's JSON plan, which holds every sensitive value
  in clear, the existing secrets included (`github-secret` appears 25 times): a property of the
  JSON plan format, not of this change. The pipelines print the text plan only; the drift
  workflow reduces its JSON plan to addresses and deletes it. The file was deleted after the check.

## The workflows' token variable

`TF_VAR_mcp_test_tokens` as `infra-apply.yml` renders it (the folded scalar joined with spaces,
each `${{ secrets.NAME }}` replaced) was given to `terraform test` through the environment:

- with every secret absent, `{"staging": {"token": "", "token_2": ""}, "production": {"token": "", "token_2": ""}}`: 26 of 26 runs passed;
- with `MCP_TEST_TOKEN_STAGING` set to a base64url `mdg_` value: `first_apply`, which asserts that
  no token secret exists, failed with "No test token exists before the owner has one", so
  Terraform parsed the value and planned the secret; the value did not appear in the output.

`test/workflows.test.ts` checks that the three infrastructure workflows read the four secrets and
render that object with them in place.

## Moved addresses

Production's token secrets and variables are now keyed per environment. Eight `moved` blocks
carry `cloudflare_api_token["meltemi-web"]`, `["meltemi-diagrams"]` and the six
`deploy["<repository>/<NAME>"]` to `["<repository>/production"]` and
`["<repository>/production/<NAME>"]`. Mocked providers have no state, so the tests cannot show the
move: the pull request's plan comment should show those eight as moved and no destroy of a
production variable or secret.

## For the Diagrams side (its change `agent-mcp`)

Names that Diagrams' deploy workflow and `scripts/deploy-config.mjs` read. Today they read the
first three variables and the secret from `production`; the rest are new.

| Environment  | Secrets                                                                                   | Variables                                                                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `production` | `CLOUDFLARE_API_TOKEN`; `MELTEMI_TOKEN`, `MELTEMI_TOKEN_2` once the owner has them        | `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, `SECRETS_STORE_ID`; new: `OAUTH_KV_ID`, `R2_BUCKET_NAME` (`meltemi-diagrams-blobs`); `SECRETS_SUFFIX` not set, read as `""`                                                             |
| `staging`    | `CLOUDFLARE_API_TOKEN` (the same token); `MELTEMI_TOKEN`, `MELTEMI_TOKEN_2` once given    | `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID` (of `meltemi-diagrams-staging`), `SECRETS_STORE_ID`, `OAUTH_KV_ID` (of `meltemi-diagrams-oauth-staging`), `R2_BUCKET_NAME` (`meltemi-diagrams-staging-blobs`), `SECRETS_SUFFIX` (`_STAGING`) |

- The new names Diagrams needs: `OAUTH_KV_ID` (the `OAUTH_KV` binding's `id`, in both
  environments), `R2_BUCKET_NAME` (the `BLOBS` binding's `bucket_name`, in both Workers'
  configurations) and `SECRETS_SUFFIX` (appended to `FORMS_SECRET` and `IDENTITY_EVENTS_SECRET`
  only; `ADMIN_SUBS` and `SPONSORS_WEBHOOK_SECRET` are shared and have no `_STAGING` twin).
  `D1_DATABASE_ID` keeps its name with staging's value.
- What Terraform does not hand over and Diagrams writes for staging itself: the Worker names
  `meltemi-diagrams-staging` and `meltemi-diagrams-publish-staging`, the D1 `database_name`
  `meltemi-diagrams-staging`, `ORIGIN` `https://staging.diagrams.meltemi.dev`, `PUBLISH_HOST`
  `staging.meltemi.page`, and `workers_dev` and `preview_urls` kept `false`.
- The deploy token needs no new permission for the KV binding as long as the binding carries its
  `id` (design, "Settled during apply" 1).
- The test tokens are not set by hand in the Diagrams repository (its `agent-mcp` task 4.4 says
  "store them in the staging and production environments"): the owner sets
  `MCP_TEST_TOKEN_STAGING`, `MCP_TEST_TOKEN_2_STAGING`, `MCP_TEST_TOKEN_PRODUCTION` and
  `MCP_TEST_TOKEN_2_PRODUCTION` in this repository's `infrastructure` environment, and the next
  apply writes them.
- The staging Custom Domains attach only after Diagrams' first staging upload and a commit here
  setting `staging_deployed`; until then the suite cannot reach `staging.diagrams.meltemi.dev`.
- The identity service names the twin `diagrams-staging`: staging's account calls (Diagrams'
  `packages/cloud/src/routes/account.ts` signs them as `PRODUCT_NAME = "diagrams"` today) must be
  signed as `diagrams-staging` with `IDENTITY_EVENTS_SECRET_STAGING`, or the service refuses them;
  the product name becomes per environment on the Diagrams side. Its deletion events arrive
  signed with that same secret.

## Not verified here

- Any real plan or apply, the moved addresses against the real state, and the deploy token's
  reach to the staging Workers, database, bucket and namespace (they belong to the same account
  the token already covers).
- GitHub's answer to an empty variable value, which this change avoids rather than tests.

## Landed (5 November 2026)

- askenaz-dev/meltemi-web#24 declared the twin. Its apply created the staging Workers, database,
  bucket, Store secrets and the `staging` environment, then stopped on the two KV namespaces
  ("Unauthorized": this root's token has no KV permission), so no environment variable was
  written. askenaz-dev/meltemi-web#27 dropped the namespaces and `OAUTH_KV_ID` (Diagrams keeps its
  OAuth state in D1, its migration 0010); its apply wrote the variables: staging's five, with
  `SECRETS_SUFFIX=_STAGING`, and production's four.
- Diagrams' deploy of 0e536f0 (askenaz-dev/meltemi-diagrams#8) uploaded `meltemi-diagrams-staging`
  and `meltemi-diagrams-publish-staging` before production; the suite was skipped with its notice,
  the host not attached yet.
- askenaz-dev/meltemi-web#28 set `staging_deployed = true` and added the identity service's product
  `diagrams-staging`; its apply and deploy were green. Afterwards
  https://staging.diagrams.meltemi.dev answered 200 and `POST /mcp` without a token 401, and
  https://staging.meltemi.page answered 404 at its root, as https://meltemi.page does.
- askenaz-dev/meltemi-web#26 turned off the request line of Diagrams' four Workers, matching their
  Wrangler configuration (no log holds an access link).
- Still the owner's: the test accounts' tokens (`MCP_TEST_TOKEN_*` in the `infrastructure`
  environment), after which the staging suite runs its authenticated steps.
