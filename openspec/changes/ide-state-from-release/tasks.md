# Tasks — ide-state-from-release

Commits reference `(ide-state-from-release N.M)`. Gates: `pnpm typecheck`, `pnpm lint`,
`pnpm test`. Starts after `ide-state-as-it-is` is archived and after the IDE's
`estado-que-publica-la-release` has written its `docs/capacidades.toml`; the first deploy that
paints from a release needs an IDE release that carries `capabilities.json`.

## 1. The script

- [ ] 1.1 `scripts/blocks.mjs` with `escape` and `between`, and `ide-release.mjs` on it with its
  tests unchanged and green (design D3)
- [ ] 1.2 `scripts/ide-capabilities.mjs`: `capabilitiesOf`, `renderRows`, `main`, with the
  fixtures of design D2 (valid, wrong version, unknown state, missing Spanish note, invalid JSON,
  page without markers) — scenarios "A published capabilities file", "A file that cannot be
  used" and "Markers missing"

## 2. The pages

- [ ] 2.1 The markers around the rows of `/ide/` and `/es/ide/`; `test/fixtures/capabilities.json`
  mirroring the IDE's record, and the test that renders it into the committed pages (design D4)
  — scenarios "The rows as verified" and "The switch changes no words"

## 3. The deploy

- [ ] 3.1 The step of design D1 in `deploy.yml`, before "Family site", and `packages/ocean` named
  in the requirement's paths; `test/workflows.test.ts` asserts the step's order, its
  `--signer-workflow`, that `node` runs in the body of the `if` and not in its condition, and that
  no new secret appears —
  scenarios "The capabilities are verified before they are painted", "Capabilities that are
  missing or do not verify" and "A secret command in the file"
- [ ] 3.2 After the first IDE release that carries `capabilities.json`: a dispatched deploy paints
  the table from it, and `/ide/` in production matches the release; noted here with the version
