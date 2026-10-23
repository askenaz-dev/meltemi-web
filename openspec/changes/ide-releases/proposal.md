## Why

On 2026-10-23 the owner decided that the Meltemi IDE releases with no hand on it: a commit that
carries a new version and reaches the IDE's `main` opens its release path, and its pipeline runs
the gates, builds, signs what it built with an attestation and publishes it (the IDE's change
`release-con-el-push`). Nobody downloads, signs or presses publish any more.

That pipeline leans on three things that are not the IDE repository's to declare, because every
piece of configuration in the family is Terraform, and the family's Terraform lives here
(decision 0004):

- with no person between a version commit and a publication, the IDE repository needs the
  protections that close the doors next to it: `main` never deleted or rewritten, version tags
  never moved or deleted, an environment for the publishing jobs that admits `main` only, and
  workflows that start read-only;
- once a release is out, its workflow tells the site, which needs a credential that can start
  this repository's deploy and nothing else;
- the site has to show what was released. Today the IDE's pages say nothing about the release,
  and the downloads page still describes the old procedure: a signature made with the
  maintainer's key, which no longer exists.

## What Changes

- **The IDE repository's release protections** are declared here, as loose resources that name
  the repository, never as the repository itself: a ruleset on its default branch (no deletion,
  no force push), a ruleset on its `v*` tags (no update, no deletion), the environment `release`
  deployable from `main` only, the environment secret `WEB_DISPATCH_TOKEN` once its value exists,
  and read-only default permissions for its workflows.
- **The notice token** joins the bootstrap: a fine-grained token of `askenaz-dev` with access to
  `meltemi-web` only and the single permission Actions (read and write), asked by
  `pnpm infra:bootstrap` as an optional value and passed by the infrastructure workflows to
  Terraform, which places it in the IDE's `release` environment.
- **The deploy writes the IDE's latest release into the IDE's pages**: before the site is
  uploaded, a script reads the newest published release of `askenaz-dev/meltemi` and replaces a
  marked sentence of `/ide/` and `/es/ide/` with its version, date and link. The committed pages
  keep a version-free sentence, which stays when GitHub does not answer; a deploy never fails for
  it. `deploy.yml` already accepts the IDE's `workflow_dispatch`.
- **The IDE's pages tell the release as it is**: the downloads page describes two checks, the
  checksum and `gh attestation verify` against the IDE's release workflow, and names no
  maintainer's key; the state tables say how a release is signed now.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `family-infrastructure`: the GitHub requirement declares the IDE repository's release
  protections and the notice secret, still without managing the repository itself.
- `delivery-pipeline`: the deployment writes the IDE's latest release into its pages before the
  site is uploaded, and names the IDE's release workflow as the source of a dispatch.
- `product-site`: the IDE's pages carry the release block and describe verification as it is.

## Non-goals

- The IDE's own pipeline, its gate, its attestation and the job that sends the notice belong to
  the IDE repository (`askenaz-dev/meltemi`, change `release-con-el-push`).
- Creating the notice token and running the bootstrap again are the owner's, as every value only
  a person can obtain (the delivery change's bootstrap).
- Meltemi Diagrams' release path is unchanged; it keeps its own `release.yml`.

## Impact

- `packages/infra/github.tf`, `variables.tf`, `tests/stages.tftest.hcl`, `test/files.test.ts`,
  `README.md`; `.github/workflows/infra-plan.yml`, `infra-apply.yml`, `infra-drift.yml`,
  `deploy.yml`; `scripts/bootstrap.mjs`; `test/workflows.test.ts`.
- `packages/site/scripts/ide-release.mjs` (new) and its test; `packages/site/public/ide/`,
  `es/ide/`, the home pages' state tables, `site.css`; `packages/site/test/site.test.ts`.
- `docs/repositories.md`: what crosses between the repositories.
- No new dependency: the script uses Node's own `fetch`.
- This change modifies requirements of `delivery`, which is not archived yet; it archives after
  `delivery`.
