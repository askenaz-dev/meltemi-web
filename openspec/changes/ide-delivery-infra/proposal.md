# ide-delivery-infra

> The Terraform side of the IDE's batch `entrega-sin-huecos` (1º there; in `askenaz-dev/meltemi`,
> `.meltemi/changes/entrega-sin-huecos/`). It declares the two new environments the IDE's delivery
> path needs, `release-pr` and `signing`, both deployable from `main` only. It places the owner's
> GitHub App and the platform signing credentials there once they exist, with one switch per
> platform derived from their presence. The App becomes the credential of the IDE's notice to this
> site, replacing the notice token and the administration token that stands in for it.

## Why

The owner decided on 2026-10-29 to automate the IDE's releases up to one human gesture, the merge
of a release pull request. They also decided to amend the IDE's signing policy so its installers
and its Android APK carry platform signatures, and to use the GitHub App they already have for
every token of the path. The IDE's changes that do this (`version-que-propone-ci`,
`firma-de-plataforma`, `apk-en-la-release`, `distribucion-y-actualizacion`) read environments,
secrets and variables that do not exist. Decision 0004 says every piece of infrastructure
configuration of the family is Terraform in this repository, and `ide-releases` already declares
the IDE's release protections here.

One fact makes this urgent rather than tidy. The IDE's `release` environment holds
`WEB_DISPATCH_TOKEN`, and the infrastructure workflows fill it with
`secrets.WEB_DISPATCH_TOKEN || secrets.GH_ADMIN_TOKEN`. The owner chose that fallback on
2026-10-23 while the scoped token did not exist, so today the administration token, with access
to every repository, sits in an environment of another repository. An App token minted per run,
limited to `meltemi-web` and to Actions, removes it.

## What Changes

- **Two environments of the IDE**, `release-pr` and `signing`, each with a deployment policy for
  `main` only, like `release`.
- **The App's credentials**: the variable `MELTEMI_APP_ID` and the secret
  `MELTEMI_APP_PRIVATE_KEY` in the IDE's `release` and `release-pr` environments, planned only
  once both `meltemi_app_id` and `meltemi_app_private_key` are set. A plan with only one of the
  two fails naming the other.
- **The signing credentials** in `signing`, each planned only once set:
  - Apple: the Developer ID certificate in base64 and its password, the signing identity, the
    Team ID, and the App Store Connect API key with its id and issuer;
  - Android: the keystore in base64, its password, the key alias and its password;
  - Windows: the provider and two maps, secrets and variables, since the provider names its own
    credentials.

  Non-secret values are environment variables, never secrets.
- **One switch per platform** on the IDE repository: `MELTEMI_SIGN_MACOS`,
  `MELTEMI_SIGN_ANDROID`, `MELTEMI_SIGN_WINDOWS` (`on` or `off`) and
  `MELTEMI_SIGN_WINDOWS_PROVIDER`. A switch is `on` exactly when its platform's set is complete,
  and a partial set fails the plan naming what is missing. A switch cannot be on without its
  credentials, nor credentials sit unused with the switch off.
- **The notice moves to the App**: once the IDE's release workflow mints its notice token from
  the App, `web_dispatch_token`, the `WEB_DISPATCH_TOKEN` environment secret and the
  `|| secrets.GH_ADMIN_TOKEN` fallbacks of the three infrastructure workflows are removed.
- **Bootstrap and README**: `pnpm infra:bootstrap` prompts for the new values (each skippable),
  the infrastructure workflows pass them as `TF_VAR_*`, and `packages/infra/README.md` lists
  them. It also lists the repositories the owner installs the App on, with the permissions each
  path needs.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `family-infrastructure`: the IDE's environments, its App and signing credentials, its signing
  switches, and the notice without its own token.

## Impact

- `packages/infra/{github.tf, variables.tf, README.md}`, `packages/infra/tests/stages.tftest.hcl`,
  `packages/infra/test/files.test.ts`,
  `.github/workflows/{infra-plan.yml, infra-apply.yml, infra-drift.yml}`,
  `test/workflows.test.ts`, `scripts/bootstrap.mjs`.
- No dependency. The `integrations/github` provider already declares environments, environment
  secrets and variables, and repository variables.

## Non-goals

- The IDE's workflows that read these values (release PR, signing jobs, the APK, the package
  managers, the notice's App token): the IDE repository.
- Creating and installing the GitHub App, buying the certificates, generating the APK key and
  choosing the Windows signing provider: the owner's steps, as `delivery` leaves the registration
  of production apps and their secrets to the owner. This change declares where their results
  live.
- The Homebrew tap, the Scoop bucket and winget's token: the IDE repository's
  `distribucion-y-actualizacion`, which names them and the decisions they wait on.
