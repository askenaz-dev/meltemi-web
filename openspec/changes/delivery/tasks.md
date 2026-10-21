## 1. Prerequisites: the functional changes finished

- [ ] 1.1 Owner: `identity-service` tasks 2.6 (development OAuth apps, `.dev.vars`), 2.8 and 5.2 (the manual sign-in, account, unlink, delete, and the cron under `wrangler dev --test-scheduled`); `openspec archive identity-service --yes`
- [ ] 1.2 Owner: `product-site` task 4.2 (the contact address in place of `OWNER-CONTACT`, the legal drafts read in both languages; until then exactly one test fails, in CI too); `openspec archive product-site --yes`

## 2. The public repository

- [x] 2.1 `LICENSE` (Apache-2.0) at the root; `.gitignore` with `.dev.vars*`, `!.dev.vars.example`, `wrangler.deploy.json` and Terraform's local files; `test/repository.test.ts` (root tests included by `vitest.config.ts`) asserts what is ignored and what is kept; `README.md` "Status", `docs/repositories.md` (names, domains, the published package, delivery) and `CONTRIBUTING.md` (what CI runs, how infrastructure and code reach production)
- [ ] 2.2 Owner: confirm Apache-2.0; sign `gh` in with the personal account or use the browser; create the public repository `askenaz-dev/meltemi-web`; `git init -b main`, the first commit, `git remote add origin git@github.com:askenaz-dev/meltemi-web.git`, `git push -u origin main`; Settings → Code security: private vulnerability reporting on (no provider resource exists for it)

## 3. The Workers read secrets from the Store

- [x] 3.1 `packages/identity/src/secrets.ts`: `resolveSecrets(env)` reads every `<NAME>_STORE` binding into `<NAME>` once per isolate, a non-empty string wins, a failing binding is logged by name and asked again; `test/secrets.test.ts` covers the string, the binding, the cache, the events secret, other bindings untouched and the failure
- [x] 3.2 `src/worker.ts` resolves the secrets at the entry (fetch and scheduled) and refuses to start without `STATE_SECRET` as without `SESSION_PRIVATE_KEY` (`500`, the name in the log only); handlers and their tests unchanged; `src/env.ts` documents the bindings; `README.md` "Configuration" and `.dev.vars.example` describe the Store and the strings
- [x] 3.3 `packages/identity/wrangler.jsonc`: the five `secrets_store_secrets` bindings (placeholder store id), `workers_dev: false`, `preview_urls: false`, no `routes`, no `account_id`; `test/config.test.ts` asserts the bindings, the flags, that a secret's name appears only as a `secret_name`, and the published keys' shape; a Wrangler dry run lists the bindings and Wrangler's local mode starts with them
- [x] 3.4 `packages/site/wrangler.jsonc`: `workers_dev: false`, `preview_urls: false`, no `routes`; `packages/site/test/site.test.ts` asserts them, no binding and no `main`; `packages/site/README.md` "Deployment"

## 4. The identity package, publishable

- [x] 4.1 `packages/identity/package.json`: public, `publishConfig` (`access`, `provenance`), `repository` with `directory`, `homepage`, `bugs`, `engines`, `files`, `sideEffects`; the build empties `dist/` first and writes no source maps; `LICENSE` in the package; `test/package.test.ts` runs `npm pack --dry-run --json` and asserts the tarball (manifest, README, licence, `dist/` only, every export present, nothing of the service) and the manifest
- [x] 4.2 `packages/identity/README.md`: "Installing the package" (`pnpm add @meltemi/identity`, the two entry points, `pnpm link` for a local checkout) replaces "Linking the package"; `docs/repositories.md` updated

## 5. The Terraform root

- [x] 5.1 `packages/infra`: `versions.tf` (Terraform `~> 1.15`; cloudflare `~> 5.28`, github `~> 6.13`, random `~> 3.9`), `.terraform.lock.hcl` with every platform's hashes, `backend.tf` (R2, `use_lockfile`, endpoint and credentials from the environment), `providers.tf` (no credential), `variables.tf` (the account, `apex_on_github_pages`, `attach_domains`, `existing_secrets_store_id`, `rotations`, `permission_group_ids` for the tests, the sensitive values); `package.json` with `fmt`, `validate`, `test:terraform`; root scripts `infra:fmt`, `infra:validate`, `infra:test`; `test/files.test.ts` asserts the files' invariants
- [x] 5.2 `zones.tf`: both zones created (both domains are registered at Dynadot), the four GitHub Pages `A` records behind `apex_on_github_pages` (the only records `meltemi.dev` had on 2026-10-20); zones added in the dashboard first are imported (`existing_zone_ids`, `existing_apex_record_ids`, found by `pnpm infra:bootstrap`); Dynadot stays the registrar, DNSSEC is not set up; outputs `nameservers`, `zone_status`
- [x] 5.3 `workers.tf`: the two D1 databases, the bucket, the four `cloudflare_worker` entities (no `workers.dev`, no previews, observability on), the four Custom Domains behind `attach_domains`, the apex's only once `apex_on_github_pages` is false; outputs `identity_database_id`, `diagrams_database_id`, `diagrams_bucket`, `workers`, `domains`
- [x] 5.4 `secrets.tf`: the Store (imported when one exists), three `random_password`s with rotation keepers, the eight secrets scoped to Workers; `tokens.tf`: two deploy tokens (user tokens, Secrets Store write) from the account's permission groups, with a precondition naming a missing group; output `secrets_store_id`
- [x] 5.5 `github.tf`: both repositories (`meltemi-web` imported), vulnerability alerts, `production` environments with `CLOUDFLARE_API_TOKEN` and the variables `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, `SECRETS_STORE_ID`, the release secrets once their values exist, rulesets on the default branch; `tests/stages.tftest.hcl` plans eight stages against mocked providers (first apply, tokens' reach, domains, swap, release tokens, missing group, bad account id, rotation)
- [x] 5.6 `packages/infra/README.md`: what it declares, the pipelines, the bootstrap with every secret and variable of the `infrastructure` environment, the rollout's stages, what Terraform cannot do, rotation and imports

## 6. The infrastructure and registrar pipelines

- [x] 6.1 `.github/workflows/infra-plan.yml` (the plan as one comment, updated in place), `infra-apply.yml` (the saved plan applied, outputs in the summary), `infra-drift.yml` (weekly; opens, updates or closes "Infrastructure drift"); `test/workflows.test.ts` asserts triggers, environments, order and which secrets each workflow may name
- [x] 6.2 `packages/infra/scripts/dynadot-nameservers.mjs` (both domains; `get_ns`, `server_list`, `add_ns`, `set_ns`; unchanged when equal; `--dry-run`; the key never printed) with `test/dynadot-nameservers.test.ts` over a stub of the API; `.github/workflows/registrar.yml`
- [ ] 6.3 Owner, the bootstrap: create Terraform's Cloudflare API token, the fine-grained GitHub token, the Dynadot key and the production OAuth apps, then run `pnpm infra:bootstrap` (`scripts/bootstrap.mjs`, tested in `test/bootstrap.test.ts`): it asks for each value without showing it, creates the state bucket, derives its S3 credentials from the Cloudflare token, notes an existing Secrets Store, generates the signing key, writes the public key and the client ids into `packages/identity/wrangler.jsonc` (commit it), and fills the `infrastructure` environment
- [ ] 6.4 Owner, optional at first: the npm token (needed for 8.1) and the marketplace tokens (Diagrams' release), by running `pnpm infra:bootstrap` again
- [ ] 6.5 Owner: push to `main` (or dispatch `infra-apply.yml`): the first apply green with `apex_on_github_pages = true` and `attach_domains = false`; the summary lists the nameservers and ids; both repositories' `production` environments hold `CLOUDFLARE_API_TOKEN` and the three variables
- [ ] 6.6 Owner: Dynadot answers only whitelisted IPs, so this runs from your machine: whitelist its public IP on Dynadot's API page (wait ten minutes), then `pnpm registrar:nameservers packages/infra/nameservers.json --dry-run` and without `--dry-run` (the file holds the first apply's `nameservers` output; the script asks for the key without showing it); wait until `nslookup -type=NS meltemi.dev` and `meltemi.page` answer Cloudflare's names; `https://meltemi.dev` still shows the IDE's landing

## 7. The code pipelines and the first deployment

- [x] 7.1 `.github/workflows/ci.yml` (the matrix, the Terraform job, no secret), `deploy.yml` (`production`; build; `scripts/deploy-config.mjs` writes `wrangler.deploy.json` from the environment's ids; the identity migrations; identity, then the site; no `wrangler secret`), `release.yml` (`scripts/release-tag.mjs` first; tests and build; publish with provenance unless the version exists; the GitHub release); `test/scripts.test.ts` covers both scripts; `test/workflows.test.ts` extended
- [ ] 7.2 Owner: CI green on `main` (the one `product-site` placeholder test aside until 1.2); dispatch `deploy.yml` (the Worker entities exist from 6.5): the identity migration and both uploads green; Meltemi Diagrams' delivery uploads its two Workers; then a pull request setting `attach_domains = true` (plan: three Custom Domains), merged; then one setting `apex_on_github_pages = false` (plan: four records removed, the apex attached to `meltemi-site`), merged
- [ ] 7.3 Owner: verify `https://meltemi.dev/` shows the family's home in both languages, `https://meltemi.dev/method.html` answers 301 to `/ide/method/`, `/privacy/` and `/terms/` exist, `https://id.meltemi.dev/.well-known/jwks.json` lists the production key, sign-in with GitHub and with Google returns to `https://meltemi.dev`, the account page unlinks and signs out of other devices, and the dashboard shows no Worker with a `workers.dev` address
- [ ] 7.4 Owner, in `C:\forge\agentic-ide`: remove `site/` (its `CNAME` included), the Pages job of `.github/workflows/release.yml`, `core/meltemid/tests/site.rs` and `core/meltemid/tests/scenarios_sitio.rs`, retarget `scripts/capture-desktop.ps1` and `tui/examples/capture_svg.rs`; turn GitHub Pages off in that repository's settings (decision 0001)

## 8. The release of the package, and afterwards

- [ ] 8.1 Owner: `git tag -a v0.1.0 -m "Meltemi Web 0.1.0"`, `git push origin v0.1.0`; the release run green; `npm view @meltemi/identity version` prints `0.1.0` with provenance; tell Diagrams' delivery (its task 2.1)
- [ ] 8.2 Owner, afterwards: trusted publishing for `@meltemi/identity` on npm, then remove `NPM_TOKEN` from the environment once Diagrams has done the same (Dynadot stays the registrar of both domains; Cloudflare serves their DNS only)
- [ ] 8.3 Owner: after the first sign-in on Diagrams, the owner's `sub` as the `ADMIN_SUBS` secret of the `infrastructure` environment; dispatch `infra-apply.yml`
- [x] 8.4 `docs/decisions/0004-delivery.md`: the root here and its state, Terraform declares and Wrangler uploads, ids through the environments, the Store and the entry's resolution, the tokens, the registrar step (Dynadot stays the registrar), the pipelines, the bootstrap, the published package, the repository and its licence

## 9. Gates

- [ ] 9.1 `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm infra:fmt`, `pnpm infra:test` green (on 2026-10-20 all green but the `product-site` placeholder test, task 1.2); `openspec validate delivery`; after the owner's tasks, `openspec archive delivery --yes` and the `## Purpose` of `openspec/specs/family-infrastructure/spec.md` and `openspec/specs/delivery-pipeline/spec.md`
