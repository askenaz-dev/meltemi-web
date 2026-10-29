## MODIFIED Requirements

### Requirement: Deployment on every push to main
`.github/workflows/deploy.yml` SHALL run on every push to `main` that touches `packages/identity`,
`packages/site`, `packages/ocean` or the workflow, and on `workflow_dispatch`, which is how the
IDE's release workflow tells the site that a release is out. It SHALL run in the `production`
environment, one run at a time without cancellation. It SHALL install, build, apply the identity
migrations, upload the identity Worker, write the IDE's latest release and, once verified, its
capabilities into the IDE's pages, and then upload the site Worker. `CLOUDFLARE_API_TOKEN` SHALL be
its only secret. When GitHub does not give the release or its capabilities, or they do not verify,
the site SHALL be uploaded with the pages' own wording and the run SHALL NOT fail for it. A failed
step SHALL end the run before the steps after it.

#### Scenario: A push to main
- **WHEN** a commit reaches `main`
- **THEN** the migrations are applied and the two Workers' versions are uploaded, identity first, and the log names each version

#### Scenario: A failed migration
- **WHEN** `wrangler d1 migrations apply DB --remote` fails
- **THEN** neither Worker is uploaded and the versions serving before the push keep serving

#### Scenario: A secret command in the file
- **WHEN** the workflow test reads `deploy.yml`
- **THEN** the only `secrets.` reference is `CLOUDFLARE_API_TOKEN`, and the file contains no `wrangler secret`, `SESSION_PRIVATE_KEY`, `STATE_SECRET`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET` or `EVENTS_SECRET_DIAGRAMS`

#### Scenario: The IDE publishes a release
- **WHEN** the IDE's release workflow dispatches `deploy.yml` after publishing a release
- **THEN** the IDE's latest release is written into `/ide/` and `/es/ide/` before the site is uploaded

#### Scenario: The capabilities are verified before they are painted
- **WHEN** the IDE's latest release carries `capabilities.json`
- **THEN** the workflow verifies it with `gh attestation verify` pinned with `--signer-workflow askenaz-dev/meltemi/.github/workflows/release.yml` before the script writes any row

#### Scenario: Capabilities that are missing or do not verify
- **WHEN** the latest release has no `capabilities.json`, or its attestation does not verify
- **THEN** the script does not run, the committed rows stay, and the run goes on

#### Scenario: GitHub does not give the release
- **WHEN** the request for the IDE's latest release fails or answers something that is not a published version
- **THEN** the site is uploaded with the pages' own wording and the run goes on
