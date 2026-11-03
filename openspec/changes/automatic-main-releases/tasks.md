# Tasks

- [x] 1.1 Implement and test API-backed CI source validation and current-head guard.
- [x] 1.2 Implement and test serial per-package version reservation, stamping and packaging.
- [x] 1.3 Implement independent npm/GitHub publication with retry and latest checks.
- [x] 2.1 Wire CI, release, deploy and apply to the validated source and retained queues.
- [x] 2.2 Update workflow tests and delivery/operations documentation.
- [x] 3.1 Run typecheck, lint, build and test; record results and remote verification limits.

Local verification, 2026-11-01, Windows:

- `pnpm install --frozen-lockfile`: synchronized the existing lockfile dependencies; no manifest changes.
- `pnpm typecheck`, `pnpm build`: pass.
- `pnpm lint`: pass (ESLint and Prettier).
- `pnpm test`: 48 files, 2207 passed, 1 skipped (the optional IDE-token check).
- `pnpm site:tokens --ide C:\meltemi\ide`: all 41 tokens match.
- Terraform format, validate and mocked tests: 11 passed, no credentials or remote apply.
- `openspec validate automatic-main-releases --strict`: valid.
- Remote publication and production reconciliation are not executed locally. The first approved
  main run must confirm npm credentials/provenance, release assets and Cloudflare operations.

Production verification, 2026-11-03:

- Main CI `41691007716` passed and automatically triggered release `41691532091`, deployment
  `41691532087` and infrastructure `41691532059`.
- Deploy and apply passed; infrastructure added two immutable-tag rulesets, updated six resources
  in place and destroyed none. GitHub published identity `0.2.15` and ocean `0.1.5`.
- npm rejected the overridden tag ref in its Sigstore provenance (E422). Preserve the runner's
  authentic ref/SHA instead; source identity remains in package metadata and the release manifest.
- Correction checked locally: typecheck, lint, build and 2,209 tests pass (one optional skip).
  Regression tests cover both current-source publication and recovery from a newer runner SHA.
- Recovery run `41693090631` passed all channels without replacing either GitHub asset.
  Public npm metadata for identity `0.2.15` and ocean `0.1.5` matches the original source
  `533375e` and GitHub archive integrity; their provenance names the authenticated runner `7fec39f`.
- The next approved main source `7fec39f` triggered release `41693598001` successfully, publishing
  identity `0.2.16` and ocean `0.1.6`. Deployment `41693598093` passed; all 24 public landing
  combinations (six EN/ES routes, two schemes and two widths) passed against the exact source CSS.

Production reconciliation correction, 2026-11-03:

- Infrastructure run `41693598158` planned zero creates, six in-place updates and zero destroys,
  then failed its provider consistency check because concurrent Wrangler deployment changed the
  identity/site Workers' `deployed_on` timestamps. The deployment itself succeeded.
- [x] 4.1 Give deploy and apply one retained production queue, preserving every source/CI guard.
- [x] 4.2 Declare matching observability in both Web Wrangler configurations and cover the
  shared queue and generated identity configuration in local regression tests.
- [x] 4.3 Run typecheck, lint, build, workspace tests and strict specification validation.
- [ ] 4.4 Verify CI and the first serialized production reconciliation after integration.

Local correction checks: focused workflow/configuration tests 40/40; full workspace 2,212 passed,
one optional skip; typecheck, lint, build and strict OpenSpec validation passed. Wrangler dry-runs
accepted the identity and site configurations without uploading anything.
