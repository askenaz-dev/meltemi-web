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
