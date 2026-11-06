# Documentation notice token bootstrap

This is a temporary operation branch, `codex/docs-dispatch-bootstrap-only`, based on Web main
`8169b0c60e8ff503e721266fcfc2b6ecde8f752b` and its successful push CI `42128386923`.
**Never merge this branch into main.** Its replacement `infra-apply.yml` is manual-only and
refuses every repository/ref except this operation branch. It does not publish a product.

## Input and scope

The owner supplies a fine-grained token owned by `askenaz-dev`, for `meltemi-web` only, with
Actions read/write, as `WEB_DISPATCH_TOKEN` in Web's `infrastructure` environment. Do not copy
the value into code, a file, a report or a chat. The workflow rejects an empty value and a value
equal to `GH_ADMIN_TOKEN`. This checks the input boundary, not the token's scope or validity.

Terraform uses its existing `narrow_web_dispatch_token` declaration to manage exactly:

```text
github_actions_secret.release["meltemi-diagrams/WEB_DISPATCH_TOKEN"]
```

`GH_ADMIN_TOKEN` authenticates the GitHub provider; it is never used as the distributed value.
Only the required account/signing-key inputs and the explicit notice token are supplied to this
targeted Terraform operation. Other optional values retain their defaults and must not be applied.

The runner copies [the temporary override](../../scripts/docs-dispatch-bootstrap-override.tf)
into its disposable Terraform checkout. It changes only `repository = each.value.repository`,
removing the repository map's accidental D1 dependency. Resource address, secret name and value
remain the declarations from the pinned source. The shared source has no permanent override.

## Gates

- The pinned source must still be current main and have the exact successful main-push CI.
- The workflow retains the complete `production-reconciliation` queue used by main apply/deploy.
- Initialization may add runner-platform lockfile checksums but never upgrades providers. Exact
  selected versions must remain Cloudflare 5.28.0, GitHub 6.13.0 and random 3.9.1.
- A targeted plan is saved with restrictive permissions. The stdin validator permits only one
  create/update of the named secret, or a no-op retry; other managed changes, deletion,
  replacement, moves, imports, unknown destination and deferred changes are rejected.
- Main is checked again immediately before applying that saved plan. No fresh implicit plan is applied.
- A second targeted plan must exit with no differences and pass the validator's `--verify` mode.
- Only destination secret name/update time enter the summary. Plans/JSON are never uploaded;
  sensitive runner-local plans and the override are removed even after failure.

If main changes, review the new Terraform declaration and CI, update both source pins and the CI
identifier, and rerun the local checks before considering another dispatch. Do not bypass the guard.

## Local checks

No credentials, backend access, real provider calls or apply are needed. The existing toolchain
was installed from its local pnpm cache. The focused controls are:

```powershell
pnpm exec vitest run test/docs-dispatch-bootstrap.test.ts
pnpm exec eslint scripts/docs-dispatch-bootstrap-plan.mjs test/docs-dispatch-bootstrap.test.ts
pnpm exec prettier --check .github/workflows/infra-apply.yml scripts/docs-dispatch-bootstrap-plan.mjs test/docs-dispatch-bootstrap.test.ts docs/operations/docs-dispatch-bootstrap.md
terraform fmt -check scripts/docs-dispatch-bootstrap-override.tf scripts/docs-dispatch-bootstrap-tests/bootstrap.tftest.hcl
```

The mocked fixture exercises the real pinned Terraform root with only dummy inputs. Temporarily
copy the override to `packages/infra/docs_dispatch_bootstrap_override.tf` and the fixture into
`packages/infra/docs-dispatch-operation-tests/bootstrap.tftest.hcl`, then run:

```powershell
terraform -chdir=packages/infra init -backend=false -input=false -lockfile=readonly -plugin-dir=C:/meltemi/web/packages/infra/.terraform/providers
terraform -chdir=packages/infra validate -no-color
terraform -chdir=packages/infra test -test-directory=docs-dispatch-operation-tests -json -verbose
```

Use only the existing cached provider directory shown above. Remove the temporary override and
fixture after validation. The recorded test passed and produced exactly one `create`, at the
allowed address; its resource changes also passed the operation validator. No Cloudflare or D1
resources appeared in that targeted mocked plan.

The complete `pnpm test` suite was not run on this exceptional branch. Its unchanged
`test/workflows.test.ts` intentionally requires the production, CI-triggered main apply shape:
`workflow_run`, the main-ref gate, normal source-job outputs, all regular Terraform input secrets
and `apply.tfplan`. Those assertions are incompatible with this manual branch and its minimal
inputs/target plan. The dedicated operation controls check its exceptional boundaries instead;
none of main's tests were skipped or weakened. This workflow must never replace main through a
merge. Runtime packages and contracts are unchanged.

## Execution by the operator

Preparation is local and uncommitted. After the owner confirms the input exists, the operator
reviews and commits the operation files, and records that exact revision, the future commands are:

```powershell
git push -u origin codex/docs-dispatch-bootstrap-only
gh workflow run infra-apply.yml --repo askenaz-dev/meltemi-web --ref codex/docs-dispatch-bootstrap-only
```

Record the resulting run/revision, allowed mutation count, unchanged second plan and destination
metadata. Do not run a full apply or directly edit the destination secret. Do not upload plans.

## Verify the notice permission

Distribution/convergence and metadata do not prove the token can dispatch Web. A subsequent
Diagrams release's `tell the web` job must start Web's normal CI-gated Deploy workflow. If the
release is already complete, an operator may rerun only its existing `tell the web` job, using
the job's `databaseId` from `gh run view --json jobs`; do not republish packages to test a notice.
Then verify the Web `docs` build/upload really ran and the public guides show the new release.

## Preparation evidence

Forty-five focused tests, full `pnpm lint`, Terraform formatting/validation, the existing 26
mocked Terraform stage plans and the operation's single mocked-root plan passed on 5 November 2026. An independent read-only review found no material boundary issue and verified that the
`infrastructure` environment permits the operation branch. Metadata-only summary and mocked
dummy-data logs are outside Git in `C:/meltemi/artifacts/direct-local-compose-docs/docs-dispatch-bootstrap/`:

- `focused-tests.log`: the 45 validator/CLI/workflow controls.
- `lint.log`: full ESLint/Prettier workspace validation.
- `terraform-init.log`: backend-disabled initialization from existing cached providers.
- `terraform-mocked.jsonl` and `terraform-mocked-stderr.log`: the dummy-data operation fixture.
- `terraform-mocked-summary.json`: metadata-only one-create plan and validator result.
- `terraform-existing-tests.log`: the 26 existing mocked stage plans after temporary files were removed.

The operation has not been pushed, dispatched or applied, and no real secret has been read.
