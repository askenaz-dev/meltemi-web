# Automatic releases from approved main commits

## Why

The owner requests a release for every push to main, after its quality checks. Today deployments
race CI and npm releases require manually pushed tags. A failure in one publication channel
must not prevent the other channels from recording the approved source.

## What Changes

- CI retains main runs; completed successful push/main CI runs start release, deployment and
  infrastructure apply. Every consumer validates the run through GitHub's API and uses its SHA.
- Identity and ocean independently reserve the next patch version as immutable source tags.
  Versions are stamped into build copies only; no automated commit is written to main.
- npm and GitHub publish independently and can resume an existing version. Older retries never
  move latest backwards. Deploy and apply skip commits superseded by main.
- Recovery accepts a CI run id, with the same validation. The IDE's deployment notice may omit
  it, in which case only a successful CI run for the current main head is accepted.

## Capabilities

- Modified: `delivery-pipeline` (CI-gated, recoverable release and deployment).

## Dependencies

None. Node, Git, npm, GitHub Actions and the existing toolchain are sufficient.

## Non-goals

The IDE's and Diagrams' publication workflows belong to their repositories. Publisher account
ownership and Marketplace policies belong to the delivery bootstrap in those repositories.
