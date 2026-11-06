# User documentation and product discovery — 2026-11-06

This change audits the portal's remaining sources after the Decisions and AI-guide changes.
It implements the owner's requested product scope for both search and Ask. It does not record
a deployment of this new change.

## Sources and audience

The combined review uses isolated working trees based on Web `f2b1af3`, Diagrams `50c06db` and
IDE `928e23c`, including their uncommitted documentation audits. These are source baselines, not
newly published versions.

- Web replaces its contributor overview and repository/operator maps with three real bilingual
  user pages: account overview, account tasks and authorized administration. The page-by-page
  source review is [the Web audit](2026-11-06-web-user-docs-audit.md).
- Diagrams reviews all forty previously public pairs, excludes the generated benchmark report,
  corrects installed CLI examples and capability/privacy claims, and separates implementation
  and service-operation notes from user and integration contracts.
- IDE keeps thirteen canonical guides, adds twelve Spanish translations and an English remote
  access translation, and supplies a bilingual user index. Its mixed canonical languages and
  generated CLI reference remain intact. Pending constitutional amendments are not ratified.
- The converter recognizes explicit English/Spanish folders, keeps genuine links in the source
  locale and handles wrapped Markdown labels. Literal links in code remain literal. Internal
  sources stay available through pinned GitHub links without acquiring public portal routes.

The first combined render contains **112 genuine guide pages**: Diagrams 78, IDE 28, Web 6.
Together with the two portal homes and the 404 page it produces **115 HTML pages**. No current
guide needs an untranslated-content notice. Older-release/fixture notices remain supported.

## Discovery behaviour

The family home defaults to all products; a product route defaults to that product. Both dialogs
offer a labelled selector and an explicit all-documentation option. Changing scope preserves
the query. Reopening the dialog preserves its selection; navigating selects the new route's
default. Search's visible label, accessible name, input placeholder and tooltip follow the
selection.

Pagefind applies the product filter within the reader's language. An empty query stays empty,
and an unmatched product query stays unmatched. Ask accepts optional `section` values
`diagrams`, `ide`, `web`; omission remains global. Invalid values return 400 before AI calls.
Retrieval filters passages before choosing candidates. Scope changes abort pending requests
and clear stale answers. Existing AI controls, model, rate limits and privacy are unchanged.

The search shell uses Pagefind's existing standalone bundle and public `triggerFilters` API.
There is no additional dependency or downloaded browser. Provider failures no longer claim
that a daily allowance has certainly been spent.

## Verification

Completed on Windows with the existing Node/pnpm/Chrome toolchain:

- `pnpm typecheck`, `pnpm lint`, `pnpm build` and `git diff --check` passed.
- `pnpm test --maxWorkers=2`: **2,496 passed, one skipped**, 66 files. Added regressions cover
  mixed-root locale routing, source selection, wrapped links, invalid scopes and ranking under
  cross-product collisions. No selected-product coverage means no answering-model call.
- All **17 documentation browser checks** passed. The suite exercises both locales, all route defaults and overrides,
  cross-product terminology, no automatic widening, empty search, Escape/focus, keyboard,
  mobile touch controls, stale answers and Ask's search fallback. It also retains account,
  CSP, offline, theme, reduced-motion and no-JavaScript checks.
- An independent scope review found a stale search-button label after selection changes; the
  label, accessible name and input tooltip were corrected and a browser regression added.
- The final full-source browser review visited all 114 normal pages, found no JavaScript
  errors or desktop overflow, checked three mobile routes and captured twelve EN/ES desktop,
  mobile and dark-theme views. Real-source searches returned only the selected product.
- The combined HTML checker checks locale twins, product defaults/filter metadata and every
  local link/anchor. The final **115-page / 8,962-link** check passed with no broken destination,
  translation notice, missing locale twin, wrong product default or retired/internal route.
  Earlier findings were corrected: links into extracted cloud operations, a wrapped Gantt link,
  an obsolete IDE FAQ anchor and translated anchors affected by the source audit.
- Independent Diagrams review also checked the cloud cleanup against its baseline: both locales
  retain matching public routes and API tables, presence response JSON, connection/heartbeat
  contracts, administration responses and quotas. Restored public subsections were checked before
  the final render; private service/development endpoints remain in the internal record.
- Web CI [42264021975](https://github.com/askenaz-dev/meltemi-web/actions/runs/42264021975)
  passed on `0072c2a`: Node 22/24 on Windows/Linux, the site and portal in Chrome, and Terraform.
  The final evidence/spec-only commit receives its own PR checks.

Local evidence is under `C:/meltemi/artifacts/docs-user-audit/`; repository gates also have
`docs-user-audit-{typecheck,lint,build,tests,browser}.log` in the parent artifacts folder.
All embedding/answer checks use the offline fake model. No production AI request, account
mutation, identity runtime change or manual deployment was needed.
