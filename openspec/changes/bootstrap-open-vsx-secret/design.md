## Context and decision

The owner authorized configuring Open VSX. The bootstrap value enters Web's `infrastructure`
environment; Terraform owns the resulting Diagrams repository secret. Direct repository secret
edits would bypass that ownership. A full apply is unsuitable because the current plan contains
unrelated Cloudflare updates.

Use the existing `infra-apply.yml` workflow path on a temporary branch. GitHub already registers
its manual dispatch on main. This operation replaces its branch-local implementation with a
manual-only job and pins the Terraform checkout to main commit
`d48ed8ed0725b4672c1b7656c8fc4cffe452683a`. A separate checkout provides the reviewed validator.
The operation retains the shared `infrastructure` concurrency group and environment.

Provider versions remain those in the pinned source lock file. Initialization may add the
runner platform's checksums to its ephemeral copy, then explicitly verifies the three selected
versions. A first dispatch on 2026-11-03 stopped before planning because `-lockfile=readonly`
prevented recording Linux hashes; no resource was applied. Allowing normal initialization
retains signed-provider verification and does not enable upgrades.

The plan targets `github_actions_secret.release["meltemi-diagrams/OVSX_PAT"]`. The normal
repository lookup brings both D1 databases into the graph through `local.repositories`.
A temporary runner-local override sets only `repository = each.value.repository`, the same
known repository name from `local.release_secrets`, removing that incidental dependency.
The resource address, secret name, value and state backend remain unchanged. No override is
added to the shared `packages/infra` source. The override is removed in cleanup.

Terraform can include dependencies, so a validator rejects every managed resource mutation
except a single create or update of that exact resource. It also rejects replacement, deletion,
imports, moves, deferred changes and malformed plans. Terraform marks targeted plans
`complete:false` by design; this deliberate partiality is accepted. A retry may have no
mutation. All other resources must be no-op or data reads. Apply uses the saved, validated
plan, never a fresh plan.

After apply, a second targeted plan must have no resource mutations and exit with Terraform's
no-difference status. A GitHub API read confirms only the secret name and update time. This
proves distribution and convergence, not token validity or permission to publish Open VSX.

## Secret handling

The workflow requires a nonempty bootstrap token. It never prints values or enables shell
tracing. The sensitive plan stays in the ephemeral runner with restrictive permissions; its
JSON is streamed directly to the validator. Neither plan nor JSON is uploaded. Cleanup runs
even after failure. Diagnostics name allowed resource addresses/actions only, never values or
raw parsing errors. Existing GitHub environment secrets supply the Terraform variables and
backend authentication. No real credentials or cloud calls are used by local tests.

## Alternatives and risks

A full main apply would modify unrelated resources. A direct repository secret edit would
bypass Terraform. Local Terraform conflicts with the delivery policy. The targeted workflow
is an exceptional operation, not a general delivery mechanism. Dependency drift stops the
job for review; it must never silently expand scope. The operation branch is not merged.

## Modules and interfaces

Only `.github/workflows/infra-apply.yml`, the validator and override in `scripts/`, and tests
are executable changes. The public identity contract and products' data/storage APIs are unchanged.
Local validation uses Node tests and the existing toolchain without network access.

The fixture in `scripts/ovsx-bootstrap-tests` exercises the real Terraform root with mocked
providers and dummy values. To repeat it, temporarily copy the override into
`packages/infra/ovsx_bootstrap_override.tf` and the fixture directory into
`packages/infra/ovsx-operation-tests`, initialize with `-backend=false`, then run
`terraform test -test-directory=ovsx-operation-tests -json -verbose` from that root. Inspect
only the `test_plan.resource_changes` addresses/actions: the sole action must be creation of
the Open VSX secret. Remove both temporary copies afterwards. No backend credentials, real
provider operation or apply is involved.

## Execution

The operator confirmed the environment secret was ready on 2026-11-03. The first dispatch
stopped before planning because of the platform-checksum issue described above. After that
correction, [run 41665657409](https://github.com/askenaz-dev/meltemi-web/actions/runs/41665657409)
at revision `bac1791034d179965fc76b3b3c482baa621efc41` completed: one allowed creation, no other
changes, and an unchanged verification plan. The destination metadata reports `OVSX_PAT`
created and updated at `2026-11-03T15:36:55Z`; `NPM_TOKEN` retained its prior update time.
The run uploaded no artifacts and cleaned up its sensitive plans. This operation did not
merge a branch, run a full infrastructure apply or publish any product.
