# ide-state-from-release

> The IDE pages' capability table stops being written by hand: at deploy time the site paints it
> from `capabilities.json`, the file every IDE release publishes under its checksums and its
> attestation, after verifying that attestation. It is 4º of the IDE's batch `entrega-sin-huecos`
> and follows the IDE's `estado-que-publica-la-release`, which makes the release carry the file.

## Why

`ide-state-as-it-is` fixed the table by hand on 2026-10-29. The one before it went stale because
nothing tied it to the IDE: the IDE archived its mobile companion and the page kept saying
"nothing is shipped". A hand-written fix goes stale the same way.

The site already solved this once, for the version. `scripts/ide-release.mjs` asks GitHub for the
IDE's latest release at deploy time and writes its version and date between markers. The IDE is
about to publish, with each release, a machine-readable statement of what that release ships:
`capabilities.json`, one entry per capability with its state, its name and note in English and
Spanish, and its assets. The statement is generated from a file the IDE's tests tie to its
pipeline and its changes. The site can paint what the release says instead of what someone
remembered, and verify that the release said it.

## What Changes

- **Markers in the table**: `<!-- ide-capabilities -->` and `<!-- /ide-capabilities -->` around
  the rows of `/ide/` and `/es/ide/`. The committed rows between them stay the pages' own record,
  pinned by `ide-state-as-it-is`'s test.
- **A deploy step** in `.github/workflows/deploy.yml`, before the site is uploaded:
  - it downloads `capabilities.json` from the IDE's latest release with `gh release download`;
  - it verifies it with `gh attestation verify`, pinned with `--signer-workflow` to the IDE's
    release workflow;
  - only then does it run the new script. When the release has no such file, or it does not
    verify, the committed rows stay and the deploy goes on, as `ide-release.mjs` already does.
- **`packages/site/scripts/ide-capabilities.mjs`** validates the file and writes the rows into
  the two pages. It checks:
  - that the version matches the latest release's tag;
  - that every state is known;
  - that both languages are present;
  - that the strings are non-empty.

  It escapes every value and maps each state to the table's existing style (`ok`, `pending`,
  `absent`). A page without its markers stops the deploy, naming the page.
- **The markers helper is shared**: `escape` and the replacement between markers move from
  `ide-release.mjs` into `scripts/blocks.mjs`, used by both scripts.
- **A test proves the switch changes no words**: a fixture `capabilities.json` that mirrors the
  IDE's `docs/capacidades.toml` renders exactly the committed rows.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `product-site`: the IDE pages' capability table is painted from the IDE's attested release at
  deploy time, keeping the committed rows when it cannot be.
- `delivery-pipeline`: the deploy verifies and writes the IDE's capabilities before uploading the
  site, and its paths name `packages/ocean`, which it already watches.

## Impact

- `packages/site/scripts/{ide-capabilities.mjs, blocks.mjs, ide-release.mjs}`,
  `packages/site/test/{ide-capabilities.test.ts, ide-release.test.ts, site.test.ts}`,
  `packages/site/test/fixtures/capabilities.json`, `packages/site/public/{ide,es/ide}/index.html`,
  `.github/workflows/deploy.yml`, `test/workflows.test.ts`.
- No dependency. `gh` is on the runner; `pnpm test` reaches no network.

## Non-goals

- What each capability's state is, and the file that says it: the IDE repository
  (`estado-que-publica-la-release`).
- Signing the IDE's installers and building its APK: the IDE repository (`firma-de-plataforma`,
  `apk-en-la-release`).
