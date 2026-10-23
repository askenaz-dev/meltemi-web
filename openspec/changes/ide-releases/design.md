## Context

The IDE's change `release-con-el-push` (in `askenaz-dev/meltemi`) moves its release from a tag
plus a signature made by hand to a pipeline that publishes on its own: a version commit on `main`
is asked about by a gate, and when the gate says yes the pipeline builds, attests and publishes,
then starts this repository's `deploy.yml` with a token that can only start workflows. Its design
names what it needs from here (its decisions D5, D6 and D7) and leaves to this repository how the
site shows a release.

What holds here today: `packages/infra/github.tf` declares `meltemi-web` and `meltemi-diagrams`
and states, with a test, that it does not manage the IDE repository; `deploy.yml` uploads the
identity Worker and then the site on pushes to `main` and on `workflow_dispatch`; the IDE's pages
under `packages/site/public/` were copied from the IDE's former `site/` and still describe the
maintainer's signature; the GitHub provider `~> 6.13` offers every resource this change uses
(`github_repository_ruleset` with `creation`, `update` and `deletion` rules,
`github_repository_environment`, `github_repository_environment_deployment_policy` with
`branch_pattern`, `github_actions_environment_secret`, `github_workflow_repository_permissions`;
checked against the provider's schema on 2026-10-23).

## Goals / Non-Goals

**Goals:** the IDE's release path has its protections in code; the notice credential has a home
and a narrow scope; the IDE's pages show the latest release and tell its verification as it is;
everything here keeps running locally with no network.

**Non-Goals:** managing the IDE repository's settings (description, topics, Pages, features); a
second deploy workflow for the site; a human approval on the IDE's releases.

## Decisions

### The IDE repository's protections, never the repository itself

The resources name `askenaz-dev/meltemi` by its name (`local.ide_repository`), as loose
resources: two rulesets, one environment and its deployment policy, one environment secret and
the workflow permissions. `github_repository` is not imported for the IDE: that resource
reconciles the description, the topics, Pages and the repository's features, and a first apply
could change things nobody asked for.

*Alternative:* import the IDE repository like `meltemi-web`. One owner for everything, but the
first plan would carry every setting the IDE repository has today as a change to review, for
protections that need none of them.

The GitHub token Terraform uses was created with access to all of the organisation's repositories
(`packages/infra/README.md`, step 4), so it reaches the IDE repository. If it does not, the plan of
the pull request fails on the first IDE resource with a 403, and the fix is the token's
repository access, not the code.

### Tags: no update and no deletion, creation left open

The ruleset on `refs/tags/v*` forbids updating and deleting a version tag, for everyone. It does not
restrict creation. Restricting it would need GitHub Actions as the ruleset's bypass actor, so that
the IDE's pipeline can still create the tag it publishes, and whether a repository ruleset accepts
that actor is unverified. Leaving creation open costs nothing the IDE's design relies on: no IDE
workflow listens to tags, so a tag pushed by hand publishes nothing, and the IDE's immutable
releases already lock the tag of every published release.

*Recommendation:* revisit when a ruleset is shown to accept the Actions integration as a bypass
actor; then add `creation = true` with that bypass.

### The `release` environment: `main` only, no reviewers

`deployment_branch_policy` uses custom branch policies, and one deployment policy admits the branch
`main`. The IDE's publishing jobs run on pushes to `main`, so they are admitted; a job on any other
ref is refused before it can read the notice token. There are no required reviewers: the owner
chose a release with no human step, and one reviewer on this environment is the way back, a line
here, should that choice be revisited.

### The notice token: optional, narrow, placed only when present

`var.web_dispatch_token` is sensitive and empty by default. The secret `WEB_DISPATCH_TOKEN` is
planned only when it is set, like the release tokens. Its value is a fine-grained token owned by
`askenaz-dev`, with access to `meltemi-web` only and the permission Actions: read and write — it
can start this repository's workflows and cannot write its code (a `repository_dispatch` would have
needed Contents: write). The bootstrap asks for it as it asks for the release tokens, and the
infrastructure workflows pass it as `TF_VAR_web_dispatch_token`.

### The notice redeploys `deploy.yml`, with no schedule

The IDE's pipeline starts `deploy.yml` on `main` and passes no input. The run redeploys the
identity Worker before the site: its migrations are already applied, so they do nothing, and its
code is unchanged, so the new version is the same. A lost notice leaves the IDE's pages late, never
wrong; re-running the IDE's notice job, or any later deploy, brings them up to date.

*Alternatives:* a `site.yml` that only uploads the site (cleaner, one more workflow and its tests);
a daily schedule on `deploy.yml` (repairs a lost notice by itself, at the price of a new identity
Worker version every day). *Recommendation:* neither, until a lost notice is seen to matter.

### The release on the page: rendered at deploy time, between markers

`packages/site/scripts/ide-release.mjs` exports pure functions and a small main:

- `releaseOf(json)` returns `{ tag, date }` from GitHub's answer for the latest release, or
  `undefined` when the answer is a draft, a pre-release, a tag that is not `v<x.y.z>` or a date that
  is not ISO 8601;
- `renderBlock(release, lang)` returns the sentence in English or Spanish, with the link built from
  the tag (`https://github.com/askenaz-dev/meltemi/releases/tag/<tag>`), never from a URL GitHub
  sent, and every value escaped;
- `inject(html, block)` replaces what stands between `<!-- ide-release -->` and
  `<!-- /ide-release -->`, or returns `undefined` when the markers are missing;
- `main(publicDir, { fetch, token })` asks
  `https://api.github.com/repos/askenaz-dev/meltemi/releases/latest` with the workflow's own token
  (`github.token`, read-only, never a secret of this repository), and rewrites the two pages.

When GitHub does not answer, answers an error or answers something `releaseOf` refuses, the script
says so and leaves the pages' committed sentence, and the deploy goes on. Markers missing from a
page are a mistake in this repository, and the script fails the run for it before anything is
uploaded. The committed pages carry no version, so the site's checks keep passing on the files as
they are; the rendered pages exist only in the runner. Tests call the functions with fixtures and
`main` with a stub `fetch`; nothing reaches the network.

### The pages tell the release as it is

The downloads page and its twin describe two checks — the checksum, and
`gh attestation verify <artifact> --repo askenaz-dev/meltemi --signer-workflow
askenaz-dev/meltemi/.github/workflows/release.yml` — with the bundle each release carries for the
offline check, and name no maintainer's key. The state tables say that releases are signed by the
workflow that published them. A test holds both.

### Order with `delivery`

`family-infrastructure` and `delivery-pipeline` exist only inside the `delivery` change, which is
not archived. This change modifies two of their requirements, so it archives after `delivery`.

## Risks / Trade-offs

- **A broader reach for this root.** Terraform now changes settings of a repository it does not
  own as a resource. The resources are listed in the specification and the files test fails on any
  other.
- **The token is a person's and expires.** The IDE's notice then fails in red with its release
  already published; replacing the value and applying again repairs it.
- **Tag creation stays open** until the bypass question is answered; the IDE's design shows why
  that is enough today.
- **GitHub's API in the deploy.** Rate limits and outages leave the page's own sentence; the
  workflow's token gives the run its own rate limit.
