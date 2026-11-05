# `packages/infra`

The infrastructure of the Meltemi family as code: one Terraform root for everything on Cloudflare
and GitHub that the family's products run on. It is applied only by this repository's pipelines,
never from a machine. The decision is [`docs/decisions/0004`](../../docs/decisions/0004-delivery.md).

## What it declares

| File           | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `zones.tf`     | The zones `meltemi.dev` and `meltemi.page`, every record they hold (today the four GitHub Pages `A` records of the apex and `www`, behind `apex_on_github_pages`), their HTTPS, TLS and email settings, and a Web Analytics site per zone that injects no beacon                                                                                                                                                                                                                                                                                                                           |
| `workers.tf`   | The D1 databases `meltemi-identity`, `meltemi-diagrams` and `meltemi-diagrams-staging`, the R2 buckets `meltemi-diagrams-blobs` and `meltemi-diagrams-staging-blobs`, the KV namespaces `meltemi-diagrams-oauth` and `meltemi-diagrams-oauth-staging`, the seven Workers as entities with no `workers.dev` and no preview address, their Custom Domains (the portal's behind `docs_deployed`, Diagrams' staging twin's behind `staging_deployed`), and `meltemi-www`, the Worker that redirects `www.meltemi.dev` to the apex                                                              |
| `secrets.tf`   | The account's Secrets Store and the twelve secrets of the two products and Diagrams' staging twin, seven of them from five values generated here                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `tokens.tf`    | One deploy token per product repository (the owner's user token; the Secrets Store refuses account-owned tokens' bindings): upload Workers, bind Store secrets, migrate D1, and for the web's the Workers AI reading of the portal's embeddings, nothing else                                                                                                                                                                                                                                                                                                                              |
| `github.tf`    | The repositories `meltemi-web` and `meltemi-diagrams`, their `production` environments with the token and the ids, Diagrams' `staging` environment (branch `main`) with the same names and staging's values, the acceptance suite's test tokens of both Diagrams environments, the release tokens and Diagrams' notice token, vulnerability alerts and the rules of `main`; of the IDE repository, only what its release path relies on: the rules of its `main` and of its `v*` tags, its `release` environment (branch `main`) with the notice token, and read-only workflow permissions |
| `outputs.tf`   | Nameservers, zone status, ids, Worker names and attached domains; never a secret                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `variables.tf` | The five switches of the rollout and the values only people can obtain                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

The Workers' code is not here. Each product repository uploads its versions with `wrangler deploy`
onto the entities declared here (code, static assets and Durable Object migrations are Wrangler's),
and its `wrangler.jsonc` holds no route and keeps `workers_dev` and `preview_urls` off, so the two
never disagree about who owns what.

| Host                           | Worker                             | Repository         |
| ------------------------------ | ---------------------------------- | ------------------ |
| `meltemi.dev`                  | `meltemi-site`                     | `meltemi-web`      |
| `id.meltemi.dev`               | `meltemi-identity`                 | `meltemi-web`      |
| `diagrams.meltemi.dev`         | `meltemi-diagrams-cloud`           | `meltemi-diagrams` |
| `meltemi.page`                 | `meltemi-diagrams-publish`         | `meltemi-diagrams` |
| `docs.meltemi.dev`             | `meltemi-docs`                     | `meltemi-web`      |
| `staging.diagrams.meltemi.dev` | `meltemi-diagrams-staging`         | `meltemi-diagrams` |
| `staging.meltemi.page`         | `meltemi-diagrams-publish-staging` | `meltemi-diagrams` |

The last two are Diagrams' staging twin (change `diagrams-staging`, [decision 0008](../../docs/decisions/0008-diagrams-staging.md)):
the same code, uploaded by Diagrams' deploy before production's, onto its own database, bucket and
namespace.

## The pipelines

| Workflow          | When                                                          | What                                                                                     |
| ----------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ci.yml`          | Every push and pull request                                   | `terraform fmt`, `validate` and `test` (the stages against mocked providers), no secret  |
| `infra-plan.yml`  | Pull requests that change this folder                         | The plan, as the pull request's comment, replaced on every push                          |
| `infra-apply.yml` | Successful push CI for current `main`, and validated recovery | The plan, saved, and that plan applied; the outputs as the run's summary                 |
| `infra-drift.yml` | Mondays at 06:00 UTC, and by hand                             | A plan; a difference opens or updates the issue "Infrastructure drift", none closes it   |
| `registrar.yml`   | By hand, once                                                 | Points `meltemi.dev` and `meltemi.page` at Dynadot to the zones' nameservers (see below) |

All but `ci.yml` run in the `infrastructure` environment, which holds the bootstrap. Product
pipelines never see it: theirs are `production` and, for Diagrams, `staging`, which Terraform fills.

## What the product environments hold

Terraform writes these; nobody sets them by hand. The deploy workflows write the ids into their
Workers' configurations at deploy time (`scripts/deploy-config.mjs` here and in Diagrams).

| Repository and environment                    | Secrets                                                                                | Variables                                                                                                                                                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meltemi-web`, `production`                   | `CLOUDFLARE_API_TOKEN`                                                                 | `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID` (`meltemi-identity`), `SECRETS_STORE_ID`                                                                                                                                               |
| `meltemi-diagrams`, `production`              | `CLOUDFLARE_API_TOKEN`; `MELTEMI_TOKEN`, `MELTEMI_TOKEN_2` once given                  | `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID` (`meltemi-diagrams`), `SECRETS_STORE_ID`, `OAUTH_KV_ID` (`meltemi-diagrams-oauth`), `R2_BUCKET_NAME` (`meltemi-diagrams-blobs`); no `SECRETS_SUFFIX`, read as empty                    |
| `meltemi-diagrams`, `staging` (branch `main`) | `CLOUDFLARE_API_TOKEN` (the same token); `MELTEMI_TOKEN`, `MELTEMI_TOKEN_2` once given | `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID` (`meltemi-diagrams-staging`), `SECRETS_STORE_ID`, `OAUTH_KV_ID` (`meltemi-diagrams-oauth-staging`), `R2_BUCKET_NAME` (`meltemi-diagrams-staging-blobs`), `SECRETS_SUFFIX` (`_STAGING`) |

Staging binds `FORMS_SECRET_STAGING` and `IDENTITY_EVENTS_SECRET_STAGING` where production binds
`FORMS_SECRET` and `IDENTITY_EVENTS_SECRET`, and shares `ADMIN_SUBS` and `SPONSORS_WEBHOOK_SECRET`.
A GitHub variable cannot be relied on to hold an empty value, so production's empty suffix is a
variable that is not set, which a workflow reads as an empty string.

## The bootstrap

The short way, once the repository `askenaz-dev/meltemi-web` exists and `gh` is signed in with the
owner's account (`gh auth login`):

```bash
pnpm infra:bootstrap
```

It asks, in the terminal and without showing them, for Terraform's Cloudflare token, Terraform's
GitHub token, the Dynadot key, the two OAuth client ids and secrets and the optional release
tokens; it finds the account, creates the state bucket, derives the bucket's S3 credentials from
the Cloudflare token (its id, and the SHA-256 of its value), notes an existing Secrets Store,
finds zones added in the dashboard (Terraform then imports them, with the GitHub Pages records
they copied, and the script names any other record, such as Dynadot's parking page, to delete),
generates the identity service's signing key (the private half goes to the environment only, the
public half into `packages/identity/wrangler.jsonc` with the client ids), and creates the
`infrastructure` environment with every variable and secret. Running it again keeps what is set.
What it does by hand, step by step:

These exist before the first apply and are made by hand, once, because the state that would
manage them lives in them or the pipeline that would make them needs them:

1. The repository `askenaz-dev/meltemi-web` (Terraform imports it on the first apply).
2. In Cloudflare, the R2 bucket `meltemi-terraform-state`.
3. A Cloudflare API token for Terraform, the owner's user token (never the Global API Key), with
   no client IP filter (GitHub's runners use it). Zone permissions on all zones of the account:
   Zone, Zone Settings, DNS and Workers Routes (edit). Account permissions: Workers Scripts, D1,
   Workers R2 Storage, Secrets Store and Account API Tokens (edit), Account Settings (read and
   edit: the Web Analytics API reads with read only). User permission: API Tokens (edit), for the
   deploy tokens. The state bucket's S3 credentials are derived from it on the runner (key id: the
   token's id; secret: the SHA-256 of its value), so it needs no R2 token of its own.
4. A fine-grained GitHub token of the `askenaz-dev` organisation for the repositories
   `meltemi-web` and `meltemi-diagrams` (all repositories, to create the second): Administration,
   Environments, Secrets, Variables (read and write), Contents and Metadata (read), and Actions
   (read and write) for the IDE's release notice while it has no narrow token of its own. Its expiry is
   the owner's to renew; a GitHub App is the upgrade that removes it. With access to all
   repositories it also reaches the IDE repository, `askenaz-dev/meltemi`, of which this root
   declares only its release protections (change `ide-releases`).
5. The environment `infrastructure` in `meltemi-web`, with no deployment branch rule (the plan of a
   pull request needs it), holding:

| Kind     | Name                                                                                                             | From                                                                                                                                                                                                                                                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Variable | `CLOUDFLARE_ACCOUNT_ID`                                                                                          | The account's id (the dashboard's right column)                                                                                                                                                                                                                                                                                                                                        |
| Variable | `EXISTING_SECRETS_STORE_ID`                                                                                      | Only if the account already has a Secrets Store: its id, to import it                                                                                                                                                                                                                                                                                                                  |
| Secret   | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`                                                                       | Derived from step 3 by `pnpm infra:bootstrap`; the pipelines derive their own on the runner                                                                                                                                                                                                                                                                                            |
| Secret   | `CLOUDFLARE_API_TOKEN`                                                                                           | Step 3                                                                                                                                                                                                                                                                                                                                                                                 |
| Secret   | `GH_ADMIN_TOKEN`                                                                                                 | Step 4                                                                                                                                                                                                                                                                                                                                                                                 |
| Secret   | `SESSION_PRIVATE_KEY`                                                                                            | `pnpm identity:keys`, the private JWK (its public half goes in `wrangler.jsonc`)                                                                                                                                                                                                                                                                                                       |
| Secret   | `OAUTH_GITHUB_CLIENT_SECRET`                                                                                     | The production GitHub OAuth App of `askenaz-dev`                                                                                                                                                                                                                                                                                                                                       |
| Secret   | `OAUTH_GOOGLE_CLIENT_SECRET`                                                                                     | The production Google OAuth client                                                                                                                                                                                                                                                                                                                                                     |
| Secret   | `SPONSORS_WEBHOOK_SECRET`                                                                                        | The GitHub Sponsors webhook's secret, given to Meltemi Diagrams' Worker; may be absent until the owner creates the webhook                                                                                                                                                                                                                                                             |
| Secret   | `ADMIN_SUBS`                                                                                                     | Meltemi Diagrams' administrators' `sub`s; may be absent until the first sign-in                                                                                                                                                                                                                                                                                                        |
| Secret   | `NPM_TOKEN`, `VSCE_PAT`, `OVSX_PAT`                                                                              | npm, the Visual Studio Marketplace, Open VSX; each may be absent until it exists                                                                                                                                                                                                                                                                                                       |
| Secret   | `MCP_TEST_TOKEN_STAGING`, `MCP_TEST_TOKEN_2_STAGING`, `MCP_TEST_TOKEN_PRODUCTION`, `MCP_TEST_TOKEN_2_PRODUCTION` | The `mdg_` tokens of the two test accounts of Meltemi Diagrams' acceptance suite (its change `agent-mcp`), created by the owner on each host; Terraform writes each as `MELTEMI_TOKEN` or `MELTEMI_TOKEN_2` of that environment of the Diagrams repository (`mcp_test_tokens`); each may be absent until its account exists                                                            |
| Secret   | `WEB_DISPATCH_TOKEN`                                                                                             | The IDE's release notice: a fine-grained token of `askenaz-dev`, repository `meltemi-web` only, permission Actions (read and write); Terraform places it in the IDE's `release` environment; without it the workflows pass `GH_ADMIN_TOKEN` there, the owner's choice of 2026-10-23; the narrow token alone also becomes Diagrams' repository secret, which the admin token never does |

Nothing else is ever set by hand: every other secret, token, variable, record and domain is a
resource here.

## The rollout

The first apply runs with the defaults, `apex_on_github_pages = true` and
`attach_domains = false`: zones, records, databases, the bucket, the Worker entities, the Store,
the tokens and the repositories, and no Custom Domain, since a Custom Domain needs a Worker that
has a version.

1. `registrar.yml` points the two domains at the zones' nameservers. Until the registry switches,
   `zone_status` says `pending`; GitHub Pages keeps serving the apex throughout.
2. Each product repository's `deploy.yml` uploads its Workers' first versions.
3. A commit sets `attach_domains` to `true`: `id.meltemi.dev`, `diagrams.meltemi.dev` and
   `meltemi.page` attach.
4. A commit sets `apex_on_github_pages` to `false`: the five GitHub Pages records go.
5. The next commit sets `site_on_apex` to `true`: the family site takes `meltemi.dev`, and
   `www.meltemi.dev` attaches to `meltemi-www`, a redirect Worker declared and uploaded here.
   Cloudflare refuses a Custom Domain on a hostname that still has records, and one apply cannot
   order the records' removal before the domains' creation, so the apex answers nothing for the
   few minutes between the two applies. The IDE repository then retires its Pages site.

6. The documentation portal (change `docs-portal`) repeats steps 2 and 3 for its own Worker: the
   apply that declares `meltemi-docs` leaves `docs_deployed` `false`, the next `deploy.yml` uploads
   the portal's first version, and a commit then sets `docs_deployed` to `true`, which attaches
   `docs.meltemi.dev`.

7. Diagrams' staging twin (change `diagrams-staging`) repeats them for its two Workers: the apply
   that declares `meltemi-diagrams-staging` and `meltemi-diagrams-publish-staging` leaves
   `staging_deployed` `false`, Diagrams' `deploy.yml` uploads their first versions from the
   `staging` environment, and a commit then sets `staging_deployed` to `true`, which attaches
   `staging.diagrams.meltemi.dev` and `staging.meltemi.page`. The identity service's product
   `diagrams-staging` lands after that, in its own pull request: it binds a Store secret the first
   apply creates and sends deletion events to a host that must answer. The owner then creates the
   two test accounts on each host and sets their tokens in the `infrastructure` environment.

Each step is a pull request whose plan shows exactly that.

## What Terraform cannot do

- **Dynadot** has no Terraform provider (none is published; its newer API signs every request),
  and its API answers only the IP addresses whitelisted on its API page, which GitHub's runners
  cannot be. `scripts/dynadot-nameservers.mjs` stands in for the provider and runs once from the
  owner's machine, with that machine's IP whitelisted: it reads the nameservers from the first
  apply's outputs, changes a domain only when they differ, and asks for the key without showing it.

  ```bash
  pnpm registrar:nameservers packages/infra/nameservers.json
  ```

  `registrar.yml` does the same from a runner whose address Dynadot accepts (a self-hosted runner).
  Dynadot stays the registrar of both domains (the owner's decision): Cloudflare serves their DNS
  only, and the step runs again only if Cloudflare ever assigns other nameservers. DNSSEC, if it is
  wanted, is `cloudflare_zone_dnssec` here plus the DS record at Dynadot; it is not set up.

- Registering a domain, the OAuth apps at GitHub and Google, and the npm and marketplace accounts
  and tokens have no API: their values enter as the environment's secrets above.
- Private vulnerability reporting has no GitHub provider resource: it is turned on in each
  repository's settings.

## Working here

```bash
pnpm infra:fmt
```

```bash
pnpm infra:validate
```

```bash
pnpm infra:test
```

`infra:validate` and `infra:test` download the providers (`terraform init -backend=false`) and
need no credential: the tests in `tests/` plan the stages against mocked providers. The Vitest
checks in `test/` read the files' invariants. Nobody runs `plan` or `apply` with real credentials
from a machine.

**Rotating a secret** is a commit. A generated one (`STATE_SECRET`, `FORMS_SECRET`,
`FORMS_SECRET_STAGING`, the events secret shared by `EVENTS_SECRET_DIAGRAMS` and
`IDENTITY_EVENTS_SECRET`, staging's shared by `EVENTS_SECRET_DIAGRAMS_STAGING` and
`IDENTITY_EVENTS_SECRET_STAGING`) gets a new entry in the
default of `rotations`, such as `{ STATE_SECRET = "2027-01-15" }`, and the plan shows it replaced; a
received one gets a new value in the `infrastructure` environment and an apply dispatched by hand.
The Workers read the new value when their isolates restart. Rotating the signing key also changes
`SESSION_PUBLIC_KEYS` in `packages/identity/wrangler.jsonc`, keeping the old public key for thirty
days. **Importing:** a resource that exists already (a zone added by hand, a Store created in the
dashboard) is brought in with an `import` block in a pull request.

## Approved automatic delivery

`infra-apply.yml` now validates a successful push/main CI run through the API, checks out that
exact SHA and applies only while it is still current main. Recovery requires `ci_run_id` and
uses the same checks; [RELEASING.md](../../RELEASING.md) describes the commands. Web and Diagrams
version tags cannot be moved or deleted; their creation remains available to release workflows.
`VSCE_PAT` stays optional for historical Diagrams recovery. New Marketplace publication may use
GitHub OIDC after the publisher policy is configured; `OVSX_PAT` remains a separate requirement.
