## MODIFIED Requirements

### Requirement: GitHub repositories, environments, variables and secrets
The root SHALL declare the public repositories `askenaz-dev/meltemi-web` (imported) and
`askenaz-dev/meltemi-diagrams`, vulnerability alerts on both, a `production` environment in each
(protected branches only) with the environment secret `CLOUDFLARE_API_TOKEN` from the token
minted for it and the environment variables `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID` and
`SECRETS_STORE_ID`, the repository secrets `NPM_TOKEN` (both), `VSCE_PAT` and `OVSX_PAT`
(`meltemi-diagrams`) only once their variables are set, and a ruleset on the default branch of
each forbidding deletion and force pushes. Of the IDE repository, `askenaz-dev/meltemi`, the root
SHALL declare only what its release path relies on: a ruleset on its default branch forbidding
deletion and force pushes, a ruleset on its `v*` tags forbidding their update and deletion, the
environment `release` deployable from `main` only, the environment secret `WEB_DISPATCH_TOKEN`
only once `web_dispatch_token` is set, and read-only default permissions for its workflows. The
root SHALL NOT manage the IDE repository itself nor the `infrastructure` environment, which holds
the bootstrap.

#### Scenario: A product's deploy environment
- **WHEN** the stages are planned
- **THEN** each repository's `production` environment gets its token and its three ids, six variables in all

#### Scenario: Release tokens not yet obtained
- **WHEN** `npm_token`, `vsce_pat` and `ovsx_pat` are empty
- **THEN** no release secret is planned, and setting `npm_token` and `vsce_pat` plans `NPM_TOKEN` in both repositories and `VSCE_PAT` in Diagrams'

#### Scenario: The IDE repository
- **WHEN** the files are read
- **THEN** no `github_repository` resource names `askenaz-dev/meltemi`, and the resources that name it are its two rulesets, its `release` environment and that environment's deployment policy, the notice secret and its workflow permissions

#### Scenario: The IDE's release protections
- **WHEN** the stages are planned
- **THEN** the IDE's default branch forbids deletion and force pushes, its `v*` tags forbid update and deletion, its `release` environment admits the branch `main` only, and its workflows default to read-only permissions

#### Scenario: The notice token not yet obtained
- **WHEN** `web_dispatch_token` is empty
- **THEN** no `WEB_DISPATCH_TOKEN` secret is planned, and setting it plans the secret in the IDE's `release` environment
