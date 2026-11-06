# User documentation and AI guides — 2026-11-06

The portal selects user guides before page conversion. Internal decisions, implementation plans
and evidence remain in source trees for revision-pinned GitHub references, but produce no page,
locale notice, sidebar entry, Pagefind result or Ask passage. Both locales and every source mode
use the same policy. Advanced public references and installation verification remain available.

## Validation

- `pnpm typecheck`, `pnpm lint` and `pnpm build`: passed.
- Full `pnpm test --maxWorkers=2`: 2,475 passed, one skipped; the unchanged Ocean wind-frame
  test exceeded its existing five-second timeout under concurrent machine load. Its isolated
  follow-up passed all 11 tests in 3.26 seconds without code or timeout changes. The original
  checkout also passed that test. All changed portal tests, including the full fixture build,
  passed. The initial new-fixture source-list expectation was corrected before this final run.
- `pnpm docs:browser`: every check passed, including EN/ES, navigation, page search, Ask with
  sources, headers, phone layout, themes and reading without JavaScript.
- OpenSpec strict validation and independent code review: passed. Specifications synchronized.

## Combined source review

Built the portal from Web `992e282`, IDE `v0.2.29` and the revised Diagrams AI guides based on
`3cc55c0` / `v1.11.23`, through local sibling junctions. The build produced 116 pages, with 42
diagrams drawn from 153 code fences. Local preview embeddings were deterministic test vectors;
no production AI call was made.

Reviewed both AI guides in English and Spanish. Sixteen browser views covered both languages,
light/dark schemes and 1440/390-pixel widths, without horizontal page overflow. The AI section
appears directly after Start. Four representative retired decision/QA URLs returned 404.

Evidence outside Git: `C:/meltemi/artifacts/web-user-docs-preview/verification.json` and screenshots;
`web-user-docs-{build,browser,tests-final,wind-final}.log` under the same artifacts root. These
are local previews and checks; this change does not itself record a production deployment.
