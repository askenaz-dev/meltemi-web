# Design: MCP credential bootstrap

## Context and scope

The existing `github_actions_environment_secret.mcp_test_token` resource maps Web's sensitive
`mcp_test_tokens` input to Diagrams' `MELTEMI_TOKEN` and `MELTEMI_TOKEN_2` in staging and
production. Both source and destination secret metadata were absent during read-only discovery.
The operator will authenticate the two authorized test accounts separately on each host.

This operation changes `.github/workflows/infra-apply.yml` only on
`codex/mcp-credentials-bootstrap-only`, plus scripts, tests and operational documentation.
Runtime packages, public APIs, identity/session contracts and the canonical Terraform declarations
are unchanged. The branch is not a candidate for merging.

## Decisions

### 1. Reuse existing declarations at an approved, current source

Pin source `f2b1af34fb448f497a6dc741beae74dd94266661` and successful push/main CI
`42252346648`. Checkout operation controls at `github.workflow_sha`, and Terraform separately
at the pinned source. Resolve that CI through the existing `ci-source.mjs` authority validator
before accessing the state backend. Check current main again before planning and immediately
before applying. A newer main requires a fresh source/CI review, not a bypass.

Use the retained `production-reconciliation` queue shared by ordinary Terraform apply and Deploy.
The alternative, normal full apply, can include unrelated changes and is outside this operation.

### 2. Cut incidental dependencies in a disposable checkout

Copy a small Terraform override into the runner's source root. It sets only
`repository = "meltemi-diagrams"` and `environment = each.value.environment` on the existing
MCP resource. This removes repository/environment-map dependencies on D1/R2 while preserving
the canonical `for_each`, resource addresses, secret names and sensitive input values.
Permanently changing the canonical root is unnecessary for this one-off operation.

### 3. Enforce an exact four-resource boundary

The input preflight requires exactly staging/production with token/token_2, four distinct
`mdg_` values with the current 32-byte base64url shape. It is a syntax/separation check; it does
not establish which account a token authenticates. The operator verifies actual account and
host assignment before importing the four source secrets.

Save the four-target plan with restrictive permissions. The stdin-only validator requires the
four exact unique addresses, repository, environment and secret name, including old identity
on update/no-op. Permit only create/update/no-op. Reject all other managed changes, replacement,
deletion, move, import, deposed instances, unknown destinations, deferred or errored plans and
malformed input. Apply exactly that saved plan. The second targeted plan must exit zero and
all four targets must be no-op. No blind retry if convergence fails.

### 4. Keep values inside the established secret boundary

Only the four test inputs and the minimum account/signing-key backend requirements are passed
as Terraform variables. The GitHub administrator credential authenticates the provider and
cannot be a test-token fallback. Individually named GitHub secrets remain separately masked.
No secret value enters a CLI argument, summary, exception or artifact. Terraform's sensitive
plan JSON is streamed directly into the guard. Always delete runner-local plans and override.
There is no artifact upload. The existing encrypted infrastructure backend retains managed
state as usual; no state is downloaded to the operator's machine.

### 5. Separate distribution from acceptance

Metadata and a no-op follow-up plan prove distribution/convergence, not remote MCP behavior.
Diagrams owns the acceptance suite, its currently incomplete OAuth cases and any fixtures.
An authorized current-main Deploy can exercise staging then production, but the operator must
review its side effects and exact current CI source first. A green run with skipped cases is
not evidence that all authenticated checks ran.

## Local validation

Node tests exercise dummy plans, malformed/private JSON diagnostics, source/queue/workflow
boundaries and preflight input errors without a network. A mocked-provider Terraform fixture
uses the real source root and dummy tokens to prove exactly four creates and no incidental
Cloudflare resources. Backend initialization is disabled, providers come from the existing
cache, and temporary root files are removed after the fixture. No apply or remote write occurs.

## Risks and unresolved choices

- Token ownership/host correctness must be checked separately from syntax before import.
- Main can advance while preparation is reviewed; source guards intentionally refuse that run.
- Regular Terraform workflows need the four source inputs retained after the bootstrap so their
  canonical map stays populated. Removing them could propose deletion of destination secrets.
- Execution, token import and complete Diagrams acceptance remain unperformed at preparation.
  No unresolved implementation choice requires a new public contract.
