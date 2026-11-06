# Proposal: Constrained documentation notice token bootstrap

## Why

Diagrams' released documentation reaches the portal when its release workflow dispatches Web's
Deploy workflow. The `WEB_DISPATCH_TOKEN` repository secret is missing. Web already declares its
distribution from `narrow_web_dispatch_token`; the owner must first supply the narrow input.

## What Changes

- Prepare a manual-only temporary operation branch from approved Web main.
- Target only Diagrams' existing notice-secret address, with a strict saved-plan validator.
- Verify a no-difference follow-up plan and return only destination metadata.
- Exercise the real root with mocked providers and dummy values before any authorized execution.

## Capabilities

- `docs-dispatch-secret-bootstrap`: bounded, auditable distribution of the explicit notice token.

## Non-goals

- Token issuance and general infrastructure reconciliation belong to the `delivery` bootstrap.
- Product version/channel policies belong to the products' delivery changes.

## Dependencies

No new dependency. Use the existing Terraform, Node/pnpm toolchain and cached providers.

## Impact

Only the operation branch's apply workflow, scripts, focused tests and operational instructions.
The branch never merges; normal main delivery and all product/identity contracts stay unchanged.
