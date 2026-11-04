# Tasks

## 1. Resources

- [ ] 1.1 Add the two staging entries to `local.workers` with `var.staging_deployed` in
      `attached`, `cloudflare_d1_database.diagrams_staging`,
      `cloudflare_r2_bucket.diagrams_staging_blobs` and the two
      `cloudflare_workers_kv_namespace` resources, with outputs. Verify `pnpm infra:fmt`,
      `pnpm infra:validate` and the staged-domains and storage cases of `pnpm infra:test`.
- [ ] 1.2 Add the staging secrets to `secrets.tf` with their rotations, and the product
      `diagrams-staging` to `packages/identity/wrangler.jsonc`'s `PRODUCTS` with the
      `EVENTS_SECRET_DIAGRAMS_STAGING_STORE` binding (and `deploy-config.mjs` if it names the
      bindings). Verify the identity configuration tests and the secrets case of `pnpm infra:test`.
- [ ] 1.3 Add the Diagrams `staging` environment, its branch policy, the deploy token secret,
      the per-environment variables and `var.mcp_test_tokens` with the four conditional secrets
      in `github.tf` and `variables.tf`. Verify the environment, tokens-absent and
      tokens-present cases of `pnpm infra:test` and that `terraform plan -json` prints no token.

## 2. Records

- [ ] 2.1 Update `docs/repositories.md` (the staging domains and what serves them),
      `packages/infra/README.md` (`staging_deployed`, `mcp_test_tokens`, the bootstrap steps) and
      write `docs/decisions/0008-diagrams-staging.md`. Verify `pnpm lint` and the links.
- [ ] 2.2 Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm infra:test` and
      `openspec validate "diagrams-staging" --strict`. Verify all green and record the results in
      the change's `validation.md`.

## Workflow follow-up

- Apply in two infrastructure commits: declare, then `staging_deployed = true` after the Diagrams
  deploy workflow (its change `agent-mcp`) has uploaded the staging Workers once.
- The owner creates the two test accounts' tokens on each host and sets `mcp_test_tokens`.
- Archive the change after review.
