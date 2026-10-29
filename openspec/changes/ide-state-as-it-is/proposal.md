# ide-state-as-it-is

> Fast path: the IDE page's "Capability status" table says the mobile companion is "specified for
> phase 3; nothing is shipped" while the IDE has built and archived it, and its desktop and SDK
> notes say less than what is known. From the owner's review of 2026-10-29. It is 0º of the IDE's
> batch `entrega-sin-huecos` (in `askenaz-dev/meltemi`, `.meltemi/changes/entrega-sin-huecos/`):
> this change fixes the rows by hand now, and `ide-state-from-release` stops writing them by hand.

## Why

Checked against the IDE repository and its release v0.2.0 on 2026-10-29:

- **Mobile companion**: the IDE's change `companero-movil` was archived on 2026-10-28 with its
  eight tasks done and its seven scenarios verified. Its arm64 release APK measures 10.69 MB and
  was installed and started on an emulator. No workflow builds it and no release publishes it. The
  page says "Not yet — Specified for phase 3; nothing is shipped", which was true when written and
  is false now.
- **Desktop client**: "In development" stays true, and "the shell is being polished" says less
  than what is known. The MSI and the DMG ship without platform signatures, so Windows and macOS
  warn on first run, and the desktop transcript shows each tool call by its title only.
- **Public SDK**: "Not yet" stays true. "Planned for phase 2, after the contract settles" omits
  what exists today: the contract between the daemon and its clients is public as JSON Schemas in
  the repository, and the command line is scriptable with `--json`.

## What Changes

- The three rows of `/ide/` and `/es/ide/`, in English and Spanish:
  - **Desktop client**: In development. Installers ship with each release; Windows and macOS warn
    on first run until they carry platform signatures, and tool calls show only their title.
  - **Public SDK**: Not yet. There is no packaged SDK yet; the contract is public as JSON Schemas,
    and the command line is scriptable with `--json`.
  - **Mobile companion**: In development. Android, built from source and tested on an emulator; no
    APK is published yet.
- The lead sentence "What does not exist yet, stated plainly" becomes "Where each part stands,
  stated plainly", as the home's did in `state-as-it-is`.
- A test pins every row of both pages (name, state and note) to what was verified, dated, so a row
  that drifts fails naming the page and the row.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `product-site`: the IDE pages' capability table states what the IDE ships, and is checked.

## Impact

- `packages/site/public/{ide/index.html, es/ide/index.html}`, `packages/site/test/site.test.ts`.
- No dependency.

## Non-goals

- Building, signing or publishing the companion's APK: the IDE repository (`apk-en-la-release`,
  `firma-de-plataforma`).
- The IDE's own record of each capability's state, and the file its releases publish from it: the
  IDE repository (`estado-que-publica-la-release`).
