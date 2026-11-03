# Design

## D1 — Trust the CI run, not an input SHA

`ci-source.mjs` checks the run's workflow id, repository, head repository, branch, event,
completion and success through GitHub's API, and checks ancestry to main. `workflow_run`
consumers additionally filter successful push/main events from this repository. Manual dispatch
is allowed only from main; a run id cannot bypass the checks. Deploy notices without an id look
up successful CI for the current main head. API errors fail closed.

Automation scripts are checked out at `github.workflow_sha` in `.automation`; source is checked
out in `source` at the validated SHA. Thus recovery can build historical commits that predate
these scripts without executing scripts taken from an unvalidated checkout.

## D2 — Serial reservations and immutable source tags

Release has one workflow concurrency group with `cancel-in-progress: false`, `queue: max`.
CI also retains queued main pushes (the platform limit is 100 pending workflows; overflow must
be recovered using a successful CI run id). Each package reuses its exact source tag or derives
the version from its nearest first-parent ancestor tag plus commit distance. A greater manifest
floor anchors a new base at its introduction; a smaller manual bump cannot regress the ancestor
version. Descendant tags never influence an old SHA. All pre-automation source is refused,
including exact historical tags, whose packages lack the source metadata this workflow verifies.
Tags are created without force and point to the CI source SHA, never an untested bot commit.

Only the packaging checkout receives the assigned version and `meltemiRelease.sourceSha`.
The package build and npm pack happen once; artifacts carry both archives and the release plan.
The manifest versions on main are version floors, not the current published versions. Artifact
names include source/run/attempt and are passed as prepare outputs for failed-only reruns.

## D3 — Independent publication and monotonic latest

Separate npm and GitHub matrix jobs consume the artifact, with fail-fast disabled. npm checks
existing versions and source metadata, publishes with provenance, and only advances latest to a
greater version. Older releases use a version-specific dist-tag. npm provenance preserves the
authentic runner ref/SHA and workflow identity required by the OIDC certificate; package metadata,
immutable tags and the integrity manifest identify the separately validated CI source. GitHub releases use generated
notes bounded by the same package's previous tag and immutable source tags. Drafts upload the
tarball and source/version/integrity manifest before publishing. Identity owns latest; ocean releases
are visible but never replace that pointer. No update changes assets of an existing release.

## D4 — Deployment is current-state reconciliation

Deploy and Terraform apply require the validated SHA still to be main's head. They check it
again immediately before the first remote mutation. Superseded commits still receive releases,
but do not deploy or apply stale configuration. Deploy and apply share the workflow-level
`production-reconciliation` concurrency group, with cancellation disabled and `queue: max`.
The group covers the plan as well as apply: Wrangler must not change a Worker's `deployed_on`
between Terraform's refresh and its provider consistency check. Independent groups caused that
failure in production run `41693598158`; retrying after deploy stops can recover the apply,
but cannot prevent the next overlap. A shared group prevents it within this repository;
GitHub concurrency does not lock deployments from the separate Diagrams repository.

Identity and site Wrangler configurations explicitly enable observability and invocation logs,
matching Terraform's Worker settings. Omitting the setting makes Wrangler disable it and causes
the next infrastructure plan to restore it. No path filter is needed: every current approved
commit reconciles the intended state. Read-only infrastructure workflows retain their own groups
and Terraform's state lock; release publication remains independent of production reconciliation.

## D5 — Verification and limits

Unit tests inject GitHub and registry responses, exercise trust refusals, version allocation,
retry reuse and latest ordering without network access. Workflow tests pin the security gates
and exact checkout. Existing workspace quality checks remain required. Local tests do not prove
remote npm scopes, publisher settings or Cloudflare deployment; the first approved remote run
provides that evidence. Existing session and ocean APIs are unchanged.
