## MODIFIED Requirements

### Requirement: Deployment on every push to main
`.github/workflows/deploy.yml` SHALL run on every push to `main` that touches `packages/identity`,
`packages/site` or the workflow, and on `workflow_dispatch` — which is also how the IDE's release
workflow tells the site that a release is out (`askenaz-dev/meltemi`) — in the `production`
environment, one run at a time without cancellation, and SHALL install, build, apply the identity
migrations to the remote database (`wrangler d1 migrations apply DB --remote` in
`packages/identity`), upload the identity Worker, write the IDE's latest published release into
the IDE's pages (`packages/site/scripts/ide-release.mjs`, with the workflow's own read-only token)
and then upload the site Worker with `wrangler deploy`, with `CLOUDFLARE_API_TOKEN` (the deploy
token Terraform placed in the environment) as its only secret. When GitHub does not give the
release, the site SHALL be uploaded with the pages' own version-free wording and the run SHALL
NOT fail for it. The workflow SHALL run no `wrangler secret` command and create no resource. A
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

#### Scenario: The IDE publishes a release
- **WHEN** the IDE's release workflow dispatches `deploy.yml` after publishing a release
- **THEN** the IDE's latest release is written into `/ide/` and `/es/ide/` before the site is uploaded

#### Scenario: GitHub does not give the release
- **WHEN** the request for the IDE's latest release fails or answers something that is not a published version
- **THEN** the site is uploaded with the pages' own wording and the run goes on
