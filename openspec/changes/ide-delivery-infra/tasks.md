# Tasks — ide-delivery-infra

Commits reference `(ide-delivery-infra N.M)`. Gates: `pnpm typecheck`, `pnpm lint`, `pnpm test`,
`pnpm infra:fmt`, `pnpm infra:validate`, `pnpm infra:test`. Fixtures use placeholders, never
anything shaped like a real key.

## 1. The environments

- [ ] 1.1 `release-pr` and `signing` on the IDE with their `main` policies; `files.test.ts` and a
  `stages.tftest.hcl` run updated — scenarios "The IDE repository" and "The IDE's delivery
  protections"

## 2. The App

- [ ] 2.1 `meltemi_app_id` and `meltemi_app_private_key` with the pair validation, and the
  variable and secret in `release` and `release-pr` (design D1) — scenarios "The App not yet
  installed", "The App set" and "Half an App"
- [ ] 2.2 `MELTEMI_APP_ID` and `MELTEMI_APP_PRIVATE_KEY` through the three infrastructure
  workflows and `bootstrap.mjs` (skippable), and the README's rows with the repositories and
  permissions of the App's installation (design D1)

## 3. Signing

- [ ] 3.1 The Apple, Android and Windows variables with their completeness validations, the
  secrets and variables in `signing`, and the four switches (design D2, D3) — scenarios "Nothing
  signs yet", "A complete platform", "A partial platform" and "An unknown Windows provider"
- [ ] 3.2 The values through the infrastructure workflows (the Windows maps as JSON from one
  secret and one variable) and `bootstrap.mjs`, and the README's rows

## 4. The notice

- [ ] 4.1 After the IDE's `notify-web` mints its token from the App (`version-que-propone-ci` in
  the IDE): remove `web_dispatch_token`, the `ide_web_dispatch` secret and the three
  `|| secrets.GH_ADMIN_TOKEN` fallbacks, with `workflows.test.ts` asserting that no `TF_VAR_*`
  names `GH_ADMIN_TOKEN` (design D4) — scenario "No token of its own for the notice"
- [ ] 4.2 The apply that deletes `WEB_DISPATCH_TOKEN` from the IDE's `release` environment, and the
  next IDE release's notice reaching this site's deploy; noted here
