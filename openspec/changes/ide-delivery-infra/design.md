# Design — ide-delivery-infra

## Context

`packages/infra/github.tf` declares the IDE's release protections as loose resources that name
`local.ide_repository`. Those are its two rulesets, the `release` environment with its `main`
policy, the `WEB_DISPATCH_TOKEN` environment secret (counted on `var.web_dispatch_token != ""`)
and its workflow permissions. `files.test.ts` pins that list, and `stages.tftest.hcl` plans it
with overridden providers, so no test reaches GitHub or Cloudflare. Optional secrets follow one
pattern: a `sensitive` variable with default `""`, and a resource counted on its presence.

The IDE's changes need three things from here:

| IDE change | Reads | In |
| --- | --- | --- |
| `version-que-propone-ci` | the App's id and private key | environment `release-pr` |
| `version-que-propone-ci` (the notice) | the same | environment `release` |
| `firma-de-plataforma` | Apple, Android and Windows credentials | environment `signing` |
| `firma-de-plataforma`, `apk-en-la-release` | `MELTEMI_SIGN_*` | repository variables |

## Decisions

### D1. The App: credentials here, installation by hand

Two alternatives:

- Declare the App's installation on each repository with `github_app_installation_repository`.
  That needs the installation id and a token that may change installations, which is a user token
  with power over the App, in the infrastructure pipeline.
- **Declare only the credentials; the owner installs the App by hand** (recommended). The
  installation is a one-time act in GitHub's settings. The README lists where and with which
  permissions:
  - `askenaz-dev/meltemi`: Contents (read and write), Pull requests (read and write);
  - `askenaz-dev/meltemi-web`: Actions (read and write);
  - the tap and the bucket when they exist: Contents (read and write).

  Each IDE job narrows its token further when it mints it.

The App id is not a secret and goes as an environment variable; the private key is a secret. Both
are planned only when both variables are set. A `validation` on `meltemi_app_private_key`
rejects a plan with one and not the other, naming the missing one.

### D2. Switches derived from presence

Two alternatives:

- The owner sets the switches by hand. A switch could then be `on` with a secret missing, which
  the IDE's release would only discover at publish time.
- **Each switch is computed from its set** (recommended). `MELTEMI_SIGN_MACOS` is `on` exactly
  when every Apple value is set, and likewise for Android and Windows. A partial set fails the plan
  with the list of what is missing, through a `validation` on the last variable of the set.
  Switches always exist, `off` by default, so the IDE reads an explicit value and never an empty
  one.

| Switch | Complete set |
| --- | --- |
| `MELTEMI_SIGN_MACOS` | `apple_certificate_p12_b64`, `apple_certificate_password`, `apple_signing_identity`, `apple_team_id`, `apple_notary_key_p8`, `apple_notary_key_id`, `apple_notary_issuer_id` |
| `MELTEMI_SIGN_ANDROID` | `android_keystore_b64`, `android_keystore_password`, `android_key_alias`, `android_key_password` |
| `MELTEMI_SIGN_WINDOWS` | `windows_signing_provider` (one of `azure`, `signpath`, `sslcom`) and a non-empty `windows_signing_secrets` or `windows_signing_variables` |

Secrets become environment secrets in `signing` (`MELTEMI_APPLE_CERTIFICATE_P12_B64`,
`MELTEMI_APPLE_CERTIFICATE_PASSWORD`, `MELTEMI_APPLE_NOTARY_KEY_P8`,
`MELTEMI_ANDROID_KEYSTORE_B64`, `MELTEMI_ANDROID_KEYSTORE_PASSWORD`,
`MELTEMI_ANDROID_KEY_PASSWORD`, and `MELTEMI_WINDOWS_<KEY>` for each entry of the Windows map).
The rest become environment variables (`MELTEMI_APPLE_SIGNING_IDENTITY`, `MELTEMI_APPLE_TEAM_ID`,
`MELTEMI_APPLE_NOTARY_KEY_ID`, `MELTEMI_APPLE_NOTARY_ISSUER_ID`, `MELTEMI_ANDROID_KEY_ALIAS`,
`MELTEMI_WINDOWS_<KEY>`).

### D3. Windows as two maps

The three providers the IDE's `firma-de-plataforma` D4 weighs authenticate differently:

- Azure Artifact Signing uses OIDC and needs only non-secret ids;
- SignPath needs an API token and slugs;
- SSL.com needs credentials and a TOTP seed.

Typed variables for all three would declare credentials for two services nobody uses. Two maps,
`windows_signing_secrets` (sensitive) and `windows_signing_variables`, take whatever the chosen
provider names. The infrastructure workflows pass them as JSON from one secret and one variable
of the `infrastructure` environment. The provider's name is validated against the three.

### D4. The notice without its own token

Today the notice to this site uses `WEB_DISPATCH_TOKEN`, or the administration token when that
is unset. With the App, the IDE's `notify-web` mints a token limited to `meltemi-web` with Actions
(read and write), which is exactly the notice's permission. The last task of this change removes
`web_dispatch_token`, the `ide_web_dispatch` secret and the three `|| secrets.GH_ADMIN_TOKEN`
fallbacks. Terraform then deletes the secret from the IDE's `release` environment. That task waits
for the IDE's change to have moved `notify-web` to the App (`version-que-propone-ci`), so that no
release goes out without a way to tell the site.

### D5. Terraform's own GitHub token stays

The provider authenticates with `GH_ADMIN_TOKEN`, a fine-grained token the owner renews. Two
alternatives:

- `app_auth` with the same App. The App would then need Administration on every repository, and
  its private key in the `infrastructure` environment. That is the same power held by a key that
  does not expire.
- **Keep the token** (recommended). It is scoped, it expires, and the README already names its
  renewal. Nothing in the IDE's batch needs the change.

## Modules

- `packages/infra/variables.tf`: the variables of D1–D3 with their validations.
- `packages/infra/github.tf`:
  - `github_repository_environment.ide_release_pr` and `.ide_signing`, with their `main`
    policies;
  - `github_actions_environment_variable.ide_app_id` and
    `github_actions_environment_secret.ide_app_key`, for each of `release` and `release-pr`;
  - `github_actions_environment_secret.ide_signing` and
    `github_actions_environment_variable.ide_signing` (`for_each` over the present values);
  - `github_actions_variable.ide_sign` (the four switches).
- `scripts/bootstrap.mjs` and the three infrastructure workflows.

## Runs locally, tests without network

`terraform test` plans with overridden providers, as `stages.tftest.hcl` already does. The runs
are:

- nothing set;
- the App set;
- only the App id set (expected to fail);
- a complete Apple set;
- a partial Android set (expected to fail);
- a Windows provider with its maps.

Fixtures use placeholders such as `"app-key"` and `"keystore"`, never anything shaped like a real
key. `files.test.ts` pins the resources that name `local.ide_repository`. `workflows.test.ts`
pins the new `TF_VAR_*` lines and, after D4, the absence of `GH_ADMIN_TOKEN` from every
`TF_VAR_*`.
