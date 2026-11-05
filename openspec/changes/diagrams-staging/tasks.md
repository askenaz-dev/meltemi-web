# Tasks

## 1. Resources

- [x] 1.1 Add the two staging entries to `local.workers` with `var.staging_deployed` in
      `attached`, `cloudflare_d1_database.diagrams_staging`,
      `cloudflare_r2_bucket.diagrams_staging_blobs` and the two
      `cloudflare_workers_kv_namespace` resources, with outputs. Verify `pnpm infra:fmt`,
      `pnpm infra:validate` and the staged-domains and storage cases of `pnpm infra:test`.
- [x] 1.2 Add the staging secrets to `secrets.tf` with their rotations, and the product
      `diagrams-staging` to `packages/identity/wrangler.jsonc`'s `PRODUCTS` with the
      `EVENTS_SECRET_DIAGRAMS_STAGING_STORE` binding (and `deploy-config.mjs` if it names the
      bindings). Verify the identity configuration tests and the secrets case of `pnpm infra:test`.
      The Store half is done with the Terraform commits; the identity half is the branch's last
      commit, a second pull request that lands once Terraform has created the secret and the
      staging Workers answer (design, "Settled during apply" 2). `deploy-config.mjs` names no
      binding and does not change.
- [x] 1.3 Add the Diagrams `staging` environment, its branch policy, the deploy token secret,
      the per-environment variables and `var.mcp_test_tokens` with the four conditional secrets
      in `github.tf` and `variables.tf`. Verify the environment, tokens-absent and
      tokens-present cases of `pnpm infra:test` and that `terraform plan -json` prints no token.

## 2. Records

- [x] 2.1 Update `docs/repositories.md` (the staging domains and what serves them),
      `packages/infra/README.md` (`staging_deployed`, `mcp_test_tokens`, the bootstrap steps) and
      write `docs/decisions/0008-diagrams-staging.md`. Verify `pnpm lint` and the links.
- [x] 2.2 Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm infra:test` and
      `openspec validate "diagrams-staging" --strict`. Verify all green and record the results in
      the change's `validation.md`.

## Workflow follow-up

- Apply in two infrastructure commits: declare, then `staging_deployed = true` after the Diagrams
  deploy workflow (its change `agent-mcp`) has uploaded the staging Workers once.
- Land the identity commit (`PRODUCTS` gains `diagrams-staging`, the Worker binds
  `EVENTS_SECRET_DIAGRAMS_STAGING_STORE`) as a second pull request after both: before the first
  apply the Store secret it binds does not exist, and before the staging deploy its deletion
  events have no host to reach.
- The owner creates the two test accounts' tokens on each host and sets them as the
  `infrastructure` environment's secrets `MCP_TEST_TOKEN_STAGING`, `MCP_TEST_TOKEN_2_STAGING`,
  `MCP_TEST_TOKEN_PRODUCTION` and `MCP_TEST_TOKEN_2_PRODUCTION` (`mcp_test_tokens`), then
  dispatches an apply.
- Archive the change after review.
