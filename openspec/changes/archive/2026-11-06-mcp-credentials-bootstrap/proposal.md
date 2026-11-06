# Proposal: Constrained MCP test credential distribution

## Why

Diagrams' remote MCP acceptance checks need two test accounts in both staging and production.
The four input and destination secrets are absent. Web already declares their distribution;
a bounded bootstrap can populate those declarations without reconciling unrelated resources.

## What Changes

- Prepare a manual-only operation branch from current Web main with successful push CI.
- Require all four explicit test-token inputs and restrict the saved plan to their existing
  Terraform environment-secret addresses.
- Verify convergence with a second unchanged plan and expose only destination metadata.
- Prove the override and guard locally with dummy tokens and mocked providers before execution.

## Capabilities

### New Capabilities

- `mcp-test-credential-bootstrap`: constrained distribution and verification of the four
  existing MCP acceptance credentials.

### Modified Capabilities

None. The existing `family-infrastructure` token mapping remains unchanged.

## Non-goals

- Test-account authentication, token issuance and OAuth acceptance fixtures belong to Diagrams.
- General infrastructure reconciliation belongs to Web's regular delivery workflow.
- Remote acceptance implementation and product publication belong to Diagrams' delivery.

## Dependencies

No new dependency. Use the existing Node, Terraform, pnpm and cached provider toolchains.

## Impact

Only the temporary branch's apply workflow, operation scripts, tests and instructions change.
Never merge this branch. Preparation does not create secrets, publish or dispatch a workflow.
