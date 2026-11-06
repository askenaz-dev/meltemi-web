# Validation

## Source and scope

Base: `2865be4fbd5e130dbfc693d24345bf9055b3831d`. The change touches only prompt-context assembly,
three existing HTTP 200 outcome headers, tests and this method record. The index, rank algorithm,
threshold, models, operational controls, source guides and response bodies remain unchanged.

An independent read-only review found no actionable issue in original-hit order, deduplication,
page/scope confinement, early skipping of long pages, atomic budgets or header classification.
The owner also reviewed the implementation before final checks.

## Offline checks

- `pnpm install --offline --frozen-lockfile`: cached dependencies, zero downloads or lock changes.
- `pnpm exec vitest run packages/docs/test/ask-context.test.ts packages/docs/test/ask.test.ts`:
  2 files and 43 tests passed. Fixtures deliberately exclude session instructions from the original
  top eight while unlink/delete ranks first, in both languages. Tests also cover no new pages or
  products, original-hit retention/order, deduplication, long pages, atomic budget skips, exact
  additional-budget boundaries, empty model output and all three outcome categories.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm test`: 67 files passed; 2,503 tests passed and 1 skipped, in 31.94 seconds.
- `pnpm build`: passed.
- `openspec validate docs-ask-context --strict`: valid before archive.
- `git diff --check`: passed.

No local browser rerun was needed for unchanged UI; the PR must pass the native Linux browser
suite, including its 18 checks. No source or configuration workaround for Windows Wrangler was
introduced.

## Saved production-index replay

The existing public index snapshot has SHA-256
`28cf4a883f8483b072ed6eb577ce43f13d436ed61b42d0624e2ef144a1613b1f`.
Controlled seeds for the English unlink/delete sections and Spanish equivalents all complete
their same account page and include logout instructions. Additional context including markers
is respectively 3,494, 3,513, 3,897 and 3,884 characters: each remains below 6,000, retains the
original seed first and introduces no new page. All four replay checks passed without AI or
credential access.

This replay proves context availability for the selected-page cases. It does not reconstruct the
historical query ranking or prove model compliance. The earlier separately authorized embedding
diagnostic received HTTP 401 on its first request and stopped without vectors or retries; that
attempt is preserved separately, not presented as a successful model test.

Evidence: `C:/meltemi/artifacts/docs-user-audit-production/ask-context-{typecheck,lint,tests,build}.log`
and `ask-retrieval-diagnosis/bounded-context-replay.json`. No live model request is part of this
change's validation. Deployment and any live regressions require their own authorization.
