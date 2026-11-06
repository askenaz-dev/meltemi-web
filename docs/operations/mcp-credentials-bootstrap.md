# MCP test credential bootstrap

**Authorized Terraform operation; executed successfully on 2026-11-06.** The operator imported
the four source secrets after verifying both authorized account identities on each host.
Run [42254707033](https://github.com/askenaz-dev/meltemi-web/actions/runs/42254707033), operation
revision `6ea7bc9`, applied exactly four creates, zero updates and zero destroys. The second
targeted plan reported no changes, all four destination metadata records were verified, and
the run uploaded zero artifacts. This proves distribution and convergence; MCP acceptance
is tracked separately below.

This temporary branch, `codex/mcp-credentials-bootstrap-only`, starts at Web main
`f2b1af34fb448f497a6dc741beae74dd94266661`, approved by successful push CI `42252346648`.
**Never merge this branch.** It replaces `infra-apply.yml` with a manual-only, branch/repository
restricted operation and uses the normal `production-reconciliation` queue.

## Four canonical inputs and destinations

The operator has verified the owner-authorized primary and secondary test accounts separately
on each Diagrams host. Their identity metadata and receipts remain in private local artifacts;
this public operation note records only those account labels. Never copy an owner/admin
credential into a test input. The input syntax check below does not prove account identity or
remote capabilities.

| Web `infrastructure` input    | Diagrams environment | Destination       | Test account |
| ----------------------------- | -------------------- | ----------------- | ------------ |
| `MCP_TEST_TOKEN_STAGING`      | `staging`            | `MELTEMI_TOKEN`   | primary      |
| `MCP_TEST_TOKEN_2_STAGING`    | `staging`            | `MELTEMI_TOKEN_2` | secondary    |
| `MCP_TEST_TOKEN_PRODUCTION`   | `production`         | `MELTEMI_TOKEN`   | primary      |
| `MCP_TEST_TOKEN_2_PRODUCTION` | `production`         | `MELTEMI_TOKEN_2` | secondary    |

For this authorized operation, supply each source value through stdin to `gh secret set`, using
an in-memory subprocess input. The command shape is:

```text
gh secret set <EXACT_SOURCE_NAME_ABOVE> --repo askenaz-dev/meltemi-web --env infrastructure
```

This is an import instruction, not a command to paste a value into terminal history. Do not use
`--body <value>`, command interpolation, screenshots or a plaintext token file. Read only the
source/destination names and timestamps afterward. GitHub cannot reveal stored secret values.
Keep all four source secrets after execution: normal apply/plan/drift already map them to
`TF_VAR_mcp_test_tokens`, and removing an input can propose destination deletion.

## Exact Terraform scope

The operation uses the existing sensitive input/resource declarations from approved main:

```text
github_actions_environment_secret.mcp_test_token["meltemi-diagrams/staging/MELTEMI_TOKEN"]
github_actions_environment_secret.mcp_test_token["meltemi-diagrams/staging/MELTEMI_TOKEN_2"]
github_actions_environment_secret.mcp_test_token["meltemi-diagrams/production/MELTEMI_TOKEN"]
github_actions_environment_secret.mcp_test_token["meltemi-diagrams/production/MELTEMI_TOKEN_2"]
```

The runner copies [the operation override](../../scripts/mcp-credentials-bootstrap-override.tf)
to its disposable Terraform checkout. Only `repository = "meltemi-diagrams"` and
`environment = each.value.environment` change. This cuts incidental repository/environment-map
dependencies on D1/R2 while preserving `for_each`, addresses, names and sensitive values.
The canonical `packages/infra` root has no permanent override.

## Gates and evidence boundaries

- The workflow validates the exact successful push/main CI through GitHub and refuses a stale
  source at startup, before planning and immediately before applying.
- Input preflight requires exactly two fields in each of staging/production, four distinct
  values with the current `mdg_` plus 32-byte base64url shape, and no fallback.
- Provider versions remain Cloudflare 5.28.0, GitHub 6.13.0 and random 3.9.1. Init can add a
  missing runner-platform checksum but cannot upgrade providers; selected versions are checked.
- A four-target plan is saved with restrictive permissions. Its stdin-only guard requires all
  four unique, exact destinations, permits only create/update/no-op, and rejects other managed
  changes, deletion/replacement, imports/moves/deposed instances, unknown destinations,
  deferred work and errors. Updates/no-ops must also have the correct old destination.
- Apply consumes that exact saved plan. A second targeted plan must exit zero and the guard's
  `--verify` mode requires all four targets to be no-op. Stop and diagnose any residual diff.
- Summary contains only destination environment/name/update metadata. There are no artifact
  uploads, Terraform outputs or JSON logging. Always-cleanup removes plans and the override.
  Terraform's managed sensitive state remains in the existing infrastructure backend.

Read-only preflight found `infrastructure` without reviewers/branch restrictions. Diagrams
staging accepts only main; production accepts protected branches and main is protected. Verify
these policies again before dispatch; do not weaken them for this operation.

## Local preparation checks

Use the existing offline pnpm cache and provider directory; no credential or backend access is
needed. The Node tests check invalid/ambiguous plans, no-op verification, input errors, secret
redaction and workflow boundaries with dummy values.

```powershell
pnpm install --offline --frozen-lockfile --ignore-scripts
pnpm exec vitest run test/mcp-credentials-bootstrap.test.ts
pnpm exec eslint scripts/mcp-credentials-bootstrap-plan.mjs test/mcp-credentials-bootstrap.test.ts
pnpm exec prettier --check .github/workflows/infra-apply.yml scripts/mcp-credentials-bootstrap-plan.mjs test/mcp-credentials-bootstrap.test.ts docs/operations/mcp-credentials-bootstrap.md
terraform fmt -check scripts/mcp-credentials-bootstrap-override.tf scripts/mcp-credentials-bootstrap-tests/bootstrap.tftest.hcl
openspec validate mcp-credentials-bootstrap --strict
git diff --check
```

For the real-root mocked plan, temporarily copy the override to
`packages/infra/mcp_credentials_bootstrap_override.tf` and its fixture to
`packages/infra/mcp-credentials-operation-tests/bootstrap.tftest.hcl`. Run:

```powershell
terraform -chdir=packages/infra init -backend=false -input=false -lockfile=readonly -plugin-dir=C:/meltemi/web/packages/infra/.terraform/providers
terraform -chdir=packages/infra validate -no-color
terraform -chdir=packages/infra test -test-directory=mcp-credentials-operation-tests -json -verbose
```

Remove only those two temporary files and the empty fixture directory in a `finally` block.
Pass the mocked plan's `resource_changes` to `validateMcpCredentialPlan` and require exactly
four creates and no incidental Cloudflare resources. Mocked JSON contains dummy data only;
never use a real saved plan as a local test fixture.

Main's existing `test/workflows.test.ts` requires the ordinary CI-triggered apply workflow,
including its source job, normal optional variables and `apply.tfplan`. This branch intentionally
has a different manual-only shape. Preserve those main assertions; the operation's focused
tests validate its narrower boundaries. Record any full-suite workflow-shape failures honestly
instead of skipping, relaxing or modifying main tests.

## Authorized execution

Review current main, approved CI, the exact operation diff/revision and the four source-secret
metadata records before publishing. If main advanced, inspect its Terraform changes, update
all source pins and CI identifier, and repeat local controls. Never bypass the source guards.

After reviewing the exact revision and checks, the operator can publish and dispatch only this branch:

```powershell
git push -u origin codex/mcp-credentials-bootstrap-only
gh workflow run infra-apply.yml --repo askenaz-dev/meltemi-web --ref codex/mcp-credentials-bootstrap-only
```

Verify a successful saved-plan apply with at most four changes, no other mutations, an unchanged
second plan, four destination metadata records and zero uploaded artifacts. Record the run ID,
operation/source revisions, action counts, verification result and metadata only. Do not run
normal full apply or directly edit Diagrams' destination secrets.

## Acceptance is separate

Diagrams' existing Deploy runs the MCP acceptance suite against staging, then production, using
each environment's two secrets. It redeploys Workers before testing; it is not a read-only test
dispatcher. The authorized dispatch must resolve the then-current Diagrams main and
its successful push CI, for example:

```text
gh workflow run deploy.yml --repo askenaz-dev/meltemi-diagrams --ref main -f ci_run_id=<CURRENT_SUCCESSFUL_PUSH_MAIN_CI>
```

Do not use the Web CI ID here or recover an older Diagrams source. Alternatively, an authorized
operator can run `pnpm acceptance:mcp` against each existing host with its own environment's
inputs and separate result directories, without redeploying. Do not expose values in arguments.

Distribution/convergence alone cannot prove all MCP tests pass. The current suite has two OAuth
steps with incomplete implementations that remain skipped even with both tokens; Diagrams owns
those fixes/fixtures. The delivery target is a real report with 34 passed, zero failed and zero
skipped on each host after those cases are implemented. Never infer that result from a green
workflow which permits omissions.

The separate Diagrams implementation subsequently completed a direct operator-run proof against
both deployed `1.11.25` hosts: **34 passed, zero failed, zero skipped** on staging and production.
Both cleanups verified zero residuals. The pre-change GitHub deploy run `42255433477` honestly
reported 32 passed and two skipped on both hosts. The new strict delivery gate must still be
published and verified through its own Diagrams CI; these results do not claim it already ran.

## Preparation evidence and execution status

Local preparation used no credentials, backend access or remote writes. Evidence is outside Git
at `C:/meltemi/artifacts/mcp-credentials/bootstrap/`:

- Focused plan/input/CLI/workflow controls pass, including private parse-error redaction.
- Full workspace lint, typecheck and fixture build pass.
- Terraform formatting/validation and all 26 existing mocked-root plans pass.
- The operation's mocked fixture passes with exactly four creates at the four permitted
  addresses, with no incidental Cloudflare resources. Its resource changes pass the guard;
  `terraform-mocked-summary.json` records the names/actions only.
- Full `pnpm test` ran: 2532 passed, one skipped, five failed. All five failures are unchanged
  `test/workflows.test.ts` assertions for main's ordinary apply shape: source-job checkout,
  complete regular variable input, IDE notice fallback, Diagrams notice mapping, and normal
  `apply.tfplan`/source-output gates. This exceptional branch deliberately replaces that shape;
  no test was skipped, weakened or edited. The operation's dedicated controls pass separately.

The operator reports the four source-secret metadata updates at 16:34–16:36 UTC on 6 November
2026 and verified two distinct subjects on each intended host. Its metadata-only token receipts
are outside Git at `C:/meltemi/artifacts/complete-mcp-acceptance/token-receipts.json`.
Publication/dispatch of this branch, actual Terraform convergence and authenticated acceptance
remain pending. Source-secret import does not claim those later results.
