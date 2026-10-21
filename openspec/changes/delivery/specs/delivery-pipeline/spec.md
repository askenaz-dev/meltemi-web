## ADDED Requirements

### Requirement: Continuous integration
`.github/workflows/ci.yml` SHALL run on every push to `main` and every pull request a job on
Node 22 and 24, on `ubuntu-latest` and `windows-latest`, that installs with
`pnpm install --frozen-lockfile` and runs `pnpm typecheck`, `pnpm lint`, `pnpm test` and
`pnpm build`, grouped by ref with cancellation of the superseded run, with
`permissions: contents: read`, no secret and no deployment. A test SHALL read the workflow and
assert its triggers, its steps and that it names no secret.

#### Scenario: A pull request
- **WHEN** a pull request is opened
- **THEN** the four jobs run and the pull request shows each as a check

#### Scenario: A lockfile out of date
- **WHEN** a push changes a `package.json` without updating `pnpm-lock.yaml`
- **THEN** the install step fails naming the lockfile and no later step runs

#### Scenario: A secret added to the workflow
- **WHEN** `ci.yml` is edited to read `${{ secrets.NPM_TOKEN }}`
- **THEN** the workflow test fails naming the secret

### Requirement: Deployment on every push to main
`.github/workflows/deploy.yml` SHALL run on every push to `main` that touches `packages/identity`,
`packages/site` or the workflow, and on `workflow_dispatch`, in the `production` environment,
one run at a time without cancellation, and SHALL install, build, apply the identity
migrations to the remote database (`wrangler d1 migrations apply DB --remote` in
`packages/identity`), upload the identity Worker and then the site Worker with `wrangler
deploy`, with `CLOUDFLARE_API_TOKEN` (the deploy token Terraform placed in the environment) as
its only secret. The workflow SHALL run no `wrangler secret` command and create no resource. A
failed step SHALL end the run before the steps after it.

#### Scenario: A push to main
- **WHEN** a commit reaches `main`
- **THEN** the migrations are applied and the two Workers' versions are uploaded, identity first, and the log names each version

#### Scenario: A failed migration
- **WHEN** `wrangler d1 migrations apply DB --remote` fails
- **THEN** neither Worker is uploaded and the versions serving before the push keep serving

#### Scenario: A secret command in the file
- **WHEN** the workflow test reads `deploy.yml`
- **THEN** the only `secrets.` reference is `CLOUDFLARE_API_TOKEN`, and the file contains no `wrangler secret`, `SESSION_PRIVATE_KEY`, `STATE_SECRET`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET` or `EVENTS_SECRET_DIAGRAMS`

### Requirement: The identity package is published on a version tag
`packages/identity` SHALL be a public package `@meltemi/identity` with `publishConfig.access`
`public`, `repository` (`git+https://github.com/askenaz-dev/meltemi-web.git`, directory
`packages/identity`), `homepage`, `bugs`, `license` `Apache-2.0`, `engines.node`, and a tarball
that holds `dist/`, `README.md` and `LICENSE` and nothing else (no `src/`, `wrangler.jsonc`,
migrations or Worker entry); its README SHALL say how to install it and how to `pnpm link` a
local checkout. `.github/workflows/release.yml` SHALL run on a tag `v<x.y.z>`, fail before
publishing when the tag's version differs from the package's, run the tests and the build,
publish the package with `--access public --provenance` unless the registry already has that
version, and create the GitHub release `v<x.y.z>`; `NPM_TOKEN` SHALL be the repository secret
Terraform placed, never written to a file or the log.

#### Scenario: The tarball
- **WHEN** `npm pack --dry-run` runs in `packages/identity`
- **THEN** the listed files are `package.json`, `README.md`, `LICENSE` and files under `dist/`, the `./testing` entry among them, and no file under `src/`

#### Scenario: The tag of the release
- **WHEN** the tag `v0.1.0` is pushed with the package at 0.1.0
- **THEN** `@meltemi/identity@0.1.0` is on npm with provenance and the release `v0.1.0` exists

#### Scenario: A tag that does not match
- **WHEN** the tag `v0.2.0` is pushed while the package says 0.1.0
- **THEN** the run fails in its first job naming both versions and nothing is published

#### Scenario: A run resumed
- **WHEN** the publish job failed after the package reached the registry and the run is re-run
- **THEN** the publish is skipped because the version exists, and the release is created

### Requirement: What the public repository holds
The repository SHALL carry `LICENSE` (Apache-2.0) at its root, and `.gitignore` SHALL exclude
`node_modules/`, `dist/`, `.wrangler/`, `.vitest/`, `*.tsbuildinfo`, the OS files, `.dev.vars*`
while keeping `.dev.vars.example`, and Terraform's local files (`.terraform/`, `*.tfstate`,
`*.tfstate.*`, `*.tfplan`, `crash.log`, `*.tfvars` while keeping `*.auto.tfvars.example`). A
test SHALL read `.gitignore` and assert the entries, and that `.dev.vars.example` of each package
and `.terraform.lock.hcl` are not ignored.

#### Scenario: A local secrets file
- **WHEN** `packages/identity/.dev.vars`, `packages/infra/terraform.tfvars` and `packages/infra/.terraform/` exist and `git status` is read
- **THEN** none is untracked or modified, and `.dev.vars.example` and `.terraform.lock.hcl` are tracked

#### Scenario: An entry removed
- **WHEN** `*.tfstate` is removed from `.gitignore`
- **THEN** the test fails naming the entry
