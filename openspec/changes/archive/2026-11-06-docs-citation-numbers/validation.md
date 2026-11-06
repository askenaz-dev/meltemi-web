## Reproduction

The production replay at
`C:/meltemi/artifacts/docs-user-audit-production/citation-numbering-replay.json` preserves source
numbers `[1, 2, 3, 4, 6, 7]` but shows no explicit list-item values. The new browser case failed
before the renderer fix in both languages: native `li.value` was zero for every item, while the
answer's citation destinations remained correct. After assigning the source number, the same
case passed with every gap and destination retained.

The separate account-operation prompt correction follows the observed session-sign-out answer.
Its source/retrieval diagnosis is retained by the coordinator under
`C:/meltemi/artifacts/docs-user-audit-production/ask-retrieval-diagnosis/`. The patch changes only
answering instructions; it does not change ranking, models, configuration or documentation.

## Local checks

- Offline installation: 466 packages installed, zero downloads and no dependency changes.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm build`: passed, including the fixture portal and the site/identity/ocean packages.
- `pnpm test --maxWorkers=2`: 66 files, 2,496 tests passed and one skipped.
- Independent offline Ask target: 36/36 passed.
- Browser regression before the renderer fix: failed as expected in English and Spanish.
- Browser checks after the fix: all 18 passed in installed Chrome 156.0.8078.80 through the
  coordinator-approved local fallback described below.
- Independent read-only renderer/regression review: no actionable findings.
- Strict OpenSpec validation and `git diff --check`: passed.

## Browser runtime limitation and fallback

The ordinary `pnpm docs:browser "citation numbers"` built the fixture but its local Wrangler
process exited with Windows status 3221226505 before the browser could run. This was a runner
startup failure, not the expected regression failure. No product or configuration was changed
to bypass it.

The approved fallback copied the same browser checks into an external artifact runner, changing
only its local server and module-import paths. A Node HTTP server served the built assets with
their generated headers and the unchanged Worker handler with its explicit `ASK_STUB=fixture`
binding. All 18 browser checks then ran against the built renderer; the new case intercepted only
the local Ask response. Non-local browser requests remained blocked. No live model, provider or
production account was used.

Logs and the fallback runner are under `C:/meltemi/artifacts/docs-citation-numbers/`, including
`browser-before.log` (Wrangler startup), `browser-static-before.log` (expected regression failure),
`browser-static-after.log`, `typecheck.log`, `lint.log`, `build.log` and `tests.log`.
The original Wrangler-backed browser suite remains a required fresh Linux CI gate on the PR.

## Model verification boundary

Offline pipeline tests and deterministic browser responses do not prove that the production
answering model follows the new operation guard. The coordinator will run two explicitly
authorized session-sign-out regressions after deployment. No such model result is claimed here.
