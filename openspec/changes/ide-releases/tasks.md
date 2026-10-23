## 1. The IDE repository's release protections

- [x] 1.1 `packages/infra/variables.tf`: `web_dispatch_token` (sensitive, empty by default); `packages/infra/github.tf`: `local.ide_repository`, the IDE's default-branch ruleset (deletion, non-fast-forward), its `v*` tag ruleset (update, deletion), the environment `release` with custom branch policies and a deployment policy for `main`, the secret `WEB_DISPATCH_TOKEN` counted on the variable, the workflow permissions (read, no approvals); `terraform fmt -check`, `terraform validate`
- [x] 1.2 `packages/infra/tests/stages.tftest.hcl`: the first apply plans the IDE's protections and no notice secret; a run with `web_dispatch_token` plans the secret in the IDE's `release` environment; `terraform test` with the mocked providers
- [x] 1.3 `packages/infra/test/files.test.ts`: the IDE test becomes "no `github_repository` names the IDE, and only the listed resources do"; `pnpm test`
- [x] 1.4 `infra-plan.yml`, `infra-apply.yml`, `infra-drift.yml` pass `TF_VAR_web_dispatch_token` from the `infrastructure` environment; `test/workflows.test.ts` names it among Terraform's secrets
- [x] 1.5 `scripts/bootstrap.mjs` asks for `WEB_DISPATCH_TOKEN` as an optional value; `packages/infra/README.md`: the token's scope and how to create it, the GitHub token's reach over the IDE repository, the row in the environment's table

## 2. The IDE's release on its pages

- [x] 2.1 `packages/site/scripts/ide-release.mjs`: `releaseOf`, `renderBlock`, `inject`, `main`; `packages/site/test/ide-release.test.ts` with every scenario of the requirement (a published release in both languages, a tag that is not a version, a draft, a pre-release, a date that is not ISO, escaping, markers missing, `main` with a stub `fetch` that answers, fails and refuses); no network
- [x] 2.2 `/ide/` and `/es/ide/`: the block between the markers in the hero, with the version-free sentence; `site.css`: `.hero .release-note`; the state tables of `/`, `/es/`, `/ide/` and `/es/ide/` say releases are signed by their workflow; `site.test.ts` checks the markers and the sentence at rest
- [x] 2.3 `/ide/downloads/` and `/es/ide/downloads/` describe the two checks with the offline bundle and name no maintainer's key; `site.test.ts` checks it
- [ ] 2.4 `deploy.yml`: the step that runs the script with `github.token`, after the identity Worker and before the site's upload; `test/workflows.test.ts` checks the order and that no secret is added

## 3. Documentation and checks

- [ ] 3.1 `docs/repositories.md`: the IDE's release notice and the protections declared here
- [ ] 3.2 `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm infra:fmt`, `pnpm infra:validate`, `pnpm infra:test`; `openspec validate ide-releases`

## 4. The owner's part

- [ ] 4.1 Create the notice token: fine-grained, owner `askenaz-dev`, repository `meltemi-web` only, permission Actions read and write; run `pnpm infra:bootstrap` to store it in the `infrastructure` environment
- [ ] 4.2 Read the plan the pull request receives; merge it, which applies; check on `askenaz-dev/meltemi` that the two rulesets, the `release` environment (branch `main`) and its secret exist and that workflows default to read
- [ ] 4.3 After the IDE's first release through its new path, check that `/ide/` names it; then archive this change after `delivery`
