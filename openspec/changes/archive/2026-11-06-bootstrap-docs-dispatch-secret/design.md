# Design: Documentation notice bootstrap

Use the existing manual dispatch path `infra-apply.yml` on a temporary, repository/ref-guarded
operation branch. Its Terraform source is pinned to main `8169b0c`, with successful push CI
`42128386923`; reuse `resolveSource` to validate the CI authority and require current main. Check
current main again before applying the saved plan. Preserve the exact retained
`production-reconciliation` queue shared with normal main Terraform and Wrangler operations.

The explicit `WEB_DISPATCH_TOKEN` environment secret feeds `TF_VAR_narrow_web_dispatch_token`.
Reject absence and equality with the provider's admin token in runner memory. Neither the name
nor that comparison proves fine-grained scope; actual `tell the web` dispatch verifies the required
Actions permission after distribution. Never distribute the admin fallback.

The temporary Terraform override changes only the GitHub secret resource's repository lookup to
the existing literal name in `each.value.repository`. This removes D1/repository graph dependencies
without changing the managed address, secret name or value. A mocked real-root plan must prove
the sole resource change is the notice secret. No permanent root override is committed.

The validator consumes Terraform plan JSON through stdin. Only create/update/no-op of the exact
target is accepted, with known expected destination before/after an update. Other managed changes,
deletion, replacement, moves, imports, duplicates, deferred changes and malformed plans are rejected.
Apply uses only the validated saved plan. The second plan must be unchanged and pass `--verify`.
Only name/update time are reported; no plan or JSON artifact is uploaded. Runner plans are private
and always cleaned. Initialization adds platform hashes if needed without changing provider versions.

Alternatives: a full apply can reconcile unrelated resources; a direct secret edit bypasses IaC;
reusing the admin token violates the existing narrow-only declaration. The operation must never merge.

Interfaces: the branch-local workflow, `scripts/docs-dispatch-bootstrap-plan.mjs` stdin/`--verify`,
the repository-only override and mocked fixture; no public identity or product contract changes.
Local validation uses dummy values, mocked providers, no backend and cached tools, so it does not
read secrets or call cloud services. Normal main workflow assertions remain intact; dedicated
operation tests check the exceptional branch boundaries.
