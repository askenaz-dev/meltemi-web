## Why

Open VSX publication needs a token obtained by the owner. Terraform already declares its
distribution from the Web `infrastructure` environment to the Diagrams repository. The current
full apply would also reconcile unrelated Cloudflare changes, outside this operation's scope.

## What Changes

- Prepare a temporary, manual workflow that applies only the existing Open VSX secret resource.
- Remove the incidental D1 dependency with a temporary override of the repository-name lookup.
- Validate the saved plan before applying it and verify convergence afterwards.
- Keep the workflow on an operation branch; do not merge it or activate product releases.

## Capabilities

### New Capabilities

- `open-vsx-secret-bootstrap`: constrained, auditable distribution of the owner's token.

## Impact

The temporary workflow, a plan validator, a runner-only Terraform override and local tests.
No shared Terraform source, product interface or dependency changes. No new dependency or
licence is introduced.

## Non-goals

Product publication belongs to the Diagrams delivery change. Reconciliation of other
infrastructure and activation of automatic releases belong to their existing delivery changes.
