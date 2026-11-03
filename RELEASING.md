# Releases and deployment

Every push to `main` runs CI. A successful **push/main CI run in this repository** starts
`release.yml`, `deploy.yml` and `infra-apply.yml`. Each validates the run again through GitHub's
API: workflow id/path, repository, branch, event, completed success and ancestry to main. PR CI,
forks, arbitrary successful workflows and direct tags do not publish.

CI and delivery use retained concurrency queues (`queue: max`, no cancellation). GitHub supports
100 pending runs per group; a run cancelled by that platform limit needs recovery below. Release
serializes the whole workflow, including all channels, so two runs cannot race version reservations.

## Source and version

Automation code comes from `github.workflow_sha` in `.automation`. Product source is checked out
separately at the validated CI SHA. Each package (`@meltemi/identity` and `@meltemi/ocean`) derives
its version from its own first-parent history:

- An exact version tag at the source SHA is reused.
- Otherwise the nearest ancestor version tag advances by the first-parent commit distance.
- An explicitly higher manifest version starts a new base at the commit introducing it; a lower
  manual bump cannot regress the version derived from the ancestor tag.
- Tags on later or unrelated commits never affect an older source's version. There can be gaps
  for commits that never passed CI. No version commit is written back to main.

The immutable tags are `vX.Y.Z` for identity and `ocean-vX.Y.Z` for ocean. They point to the tested
source SHA. The version and `meltemiRelease.sourceSha` are stamped only in the packaging checkout;
the source manifest is a version floor, not a report of npm's latest version. Terraform declares
update/deletion protection on the version tags in Web and Diagrams, without preventing creation.
All source predating this automation is refused, including historically tagged SHAs: use its
historical release path instead. Its packages do not carry this automation's source metadata.

The build runs once and npm archives plus `plan.json` become an artifact named for source, run and
attempt. Failed-only reruns read the successful prepare job's artifact output; full reruns create a
new artifact. Artifacts are retained for 90 days. If a rebuild differs from an already published
archive, the integrity check stops it rather than overwriting that package version.

## Independent channels

npm and GitHub jobs run independently for each package. A registry outage does not suppress its
GitHub release or the other package's npm result. npm uses provenance and verifies the source SHA
and archive integrity of a version already present. It advances `latest` only to a newer version;
older releases use a `release-X.Y.Z` dist-tag. npm provenance retains the actual runner's ref,
SHA and workflow identity, which must match its OIDC certificate. It identifies the publication
execution; for an older recovery that revision can differ from the packaged source. The package's
`meltemiRelease.sourceSha`, immutable tag and integrity manifest identify the CI-approved source.

GitHub drafts are published after the tarball and its source/version/integrity manifest have been
uploaded; partial uploads resume without replacing existing assets. Notes use the prior ancestor
tag of the same package. Identity owns the repository's `latest`; ocean has separate releases
that do not replace it. Published releases are never reopened or overwritten.

## Current production

Deploy and infrastructure apply require CI success **and** that the SHA is still current main.
They check main again immediately before the first deployment or the saved Terraform plan's apply.
An old recovery still publishes its immutable release, but cannot roll production or infrastructure
back. All current approved pushes reconcile production; there are no path filters. Terraform
changes still belong in reviewed code; nothing runs `apply` locally.

The IDE's release notice continues dispatching `deploy.yml` without inputs. That resolves only a
successful push CI run for current main. If current CI is pending or failed, the notice fails with
an explanation; the later successful main CI deploy will include the IDE's latest release.

## Recovery

Use the workflow's **Run workflow** on main and enter the successful CI run id (`ci_run_id`), or:

```sh
gh workflow run release.yml --ref main -f ci_run_id=123456789
gh workflow run deploy.yml --ref main -f ci_run_id=123456789
gh workflow run infra-apply.yml --ref main -f ci_run_id=123456789
```

These commands do not bypass validation. Fix failed CI and rerun it first. For partial channel
failures, rerunning failed jobs preserves the prepared artifact. If it expired, rerun all jobs or
dispatch the original successful CI id; the source tags preserve the assigned versions.

`NPM_TOKEN` remains supported through Terraform until trusted publishing is configured for both
packages. Diagrams' legacy `VSCE_PAT` resource also remains optional for its historical recovery;
new Marketplace publication can use publisher-configured GitHub OIDC. `OVSX_PAT` is separate.

Local tests use injected GitHub/registry answers and mocked Terraform providers. A successful
local run does not prove production credentials or remote publication: inspect all channels in
the first approved main execution and record any required account configuration.
