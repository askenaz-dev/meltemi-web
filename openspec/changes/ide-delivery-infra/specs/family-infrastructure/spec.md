## MODIFIED Requirements

### Requirement: GitHub repositories, environments, variables and secrets
The root SHALL declare the public repositories `askenaz-dev/meltemi-web` (imported) and
`askenaz-dev/meltemi-diagrams`, vulnerability alerts on both, a `production` environment in each
(protected branches only) with the environment secret `CLOUDFLARE_API_TOKEN` from the token
minted for it and the environment variables `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID` and
`SECRETS_STORE_ID`, the repository secrets `NPM_TOKEN` (both), `VSCE_PAT` and `OVSX_PAT`
(`meltemi-diagrams`) only once their variables are set, and a ruleset on the default branch of
each forbidding deletion and force pushes. Of the IDE repository, `askenaz-dev/meltemi`, the root
SHALL declare only what its delivery path relies on: a ruleset on its default branch forbidding
deletion and force pushes, a ruleset on its `v*` tags forbidding their update and deletion, the
environments `release`, `release-pr` and `signing`, each deployable from `main` only, the
credentials and switches of the IDE's delivery, and read-only default permissions for its
workflows. The root SHALL NOT manage the IDE repository itself nor the `infrastructure`
environment, which holds the bootstrap.

#### Scenario: A product's deploy environment
- **WHEN** the stages are planned
- **THEN** each repository's `production` environment gets its token and its three ids, six variables in all

#### Scenario: Release tokens not yet obtained
- **WHEN** `npm_token`, `vsce_pat` and `ovsx_pat` are empty
- **THEN** no release secret is planned, and setting `npm_token` and `vsce_pat` plans `NPM_TOKEN` in both repositories and `VSCE_PAT` in Diagrams'

#### Scenario: The IDE repository
- **WHEN** the files are read
- **THEN** no `github_repository` resource names `askenaz-dev/meltemi`, and the resources that name it are its two rulesets, its three environments and their deployment policies, its delivery credentials, its signing switches and its workflow permissions

#### Scenario: The IDE's delivery protections
- **WHEN** the stages are planned
- **THEN** the IDE's default branch forbids deletion and force pushes, its `v*` tags forbid update and deletion, its `release`, `release-pr` and `signing` environments admit the branch `main` only, and its workflows default to read-only permissions

## ADDED Requirements

### Requirement: The IDE's GitHub App credentials
The root SHALL place the GitHub App's id as the variable `MELTEMI_APP_ID` and its private key as
the secret `MELTEMI_APP_PRIVATE_KEY` in the IDE's `release` and `release-pr` environments, only
once both are set. The IDE's notice to this site SHALL use no credential of its own: no
`WEB_DISPATCH_TOKEN` and no administration token SHALL be placed in any IDE environment. A plan
with only one of the two App values SHALL fail naming the other.

#### Scenario: The App not yet installed
- **WHEN** `meltemi_app_id` and `meltemi_app_private_key` are empty
- **THEN** no App variable or secret is planned in any IDE environment

#### Scenario: The App set
- **WHEN** both values are set
- **THEN** `MELTEMI_APP_ID` and `MELTEMI_APP_PRIVATE_KEY` are planned in `release` and in `release-pr`, and in no other environment

#### Scenario: Half an App
- **WHEN** only `meltemi_app_id` is set
- **THEN** the plan fails naming `meltemi_app_private_key`

#### Scenario: No token of its own for the notice
- **WHEN** the files and the infrastructure workflows are read
- **THEN** no `WEB_DISPATCH_TOKEN` secret is declared and no `TF_VAR_*` falls back to `GH_ADMIN_TOKEN`

### Requirement: The IDE's platform signing credentials and switches
The root SHALL place each platform's signing values in the IDE's `signing` environment only once
set, the secret ones as environment secrets and the rest as environment variables, and SHALL
declare on the IDE repository the variables `MELTEMI_SIGN_MACOS`, `MELTEMI_SIGN_ANDROID` and
`MELTEMI_SIGN_WINDOWS`, each `on` exactly when its platform's set is complete and `off`
otherwise, and `MELTEMI_SIGN_WINDOWS_PROVIDER`. A partial set SHALL fail the plan naming what is
missing.

#### Scenario: Nothing signs yet
- **WHEN** no signing value is set
- **THEN** nothing is planned in `signing` and the three switches are planned `off`

#### Scenario: A complete platform
- **WHEN** every Apple value is set
- **THEN** its secrets and variables are planned in `signing` and `MELTEMI_SIGN_MACOS` is planned `on`, with the other two switches `off`

#### Scenario: A partial platform
- **WHEN** the Android keystore is set without its password
- **THEN** the plan fails naming `android_keystore_password`

#### Scenario: An unknown Windows provider
- **WHEN** `windows_signing_provider` is set to a name outside `azure`, `signpath` and `sslcom`
- **THEN** the plan fails naming the three it accepts
