## Why

The privacy notice has a section on the IDE, and it says two things: the IDE has no account and
sends no telemetry, and the coding agents it runs are their vendors' own programs. The site's other
pages and the IDE's own promises say more than that, and a visitor who reads only the privacy notice
cannot find it:

- the IDE's background service opens no network port: it listens on a local endpoint that only the
  user's account can reach, and remote access is an SSH tunnel the user sets up;
- the IDE never reads, stores or reuses the credentials of the agents it runs: each agent signs in by
  its own means;
- what the IDE keeps stays on the user's computer, and the notice never says where.

The IDE's change `antes-de-anunciar` planned to write this page in the IDE repository. The site
left that repository (the IDE's change `release-con-el-push`), so the page is here, and the IDE's
change was re-pointed: its announcement waits on this one, because the notice is what the
announcement links.

## What Changes

- The section "The Meltemi IDE" of `/privacy/` and "El IDE de Meltemi" of `/es/privacy/` gain three
  statements: no network port, no agent credentials, and what is kept and where.
- Both pages' "Last updated" date moves to 24 October 2026.
- A requirement of `product-site` and checks in `packages/site/test/site.test.ts` that read the
  section of both pages and fail naming the page and the statement.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `product-site`: the privacy notice states, for the IDE, what it does not do and where it keeps
  its data.

## Non-goals

- The Terms pages and their date.
- Anything about the sign-in service or Meltemi Diagrams.
- Links from the notice to the IDE's documentation: the notice says the folders itself.

## Impact

- `packages/site/public/privacy/index.html` and `packages/site/public/es/privacy/index.html`.
- `packages/site/test/site.test.ts`.
- Deploys on merge, like any change under `packages/site/`; no infrastructure.
