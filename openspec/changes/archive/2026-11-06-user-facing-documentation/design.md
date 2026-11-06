# Design

## Audience selection before conversion

`packages/docs/scripts/convert.ts` selects user guides before constructing its page/link map.
Exclude known contributor directories and a small documented set of implementation-only files,
normalizing the `docs/es/` prefix. Keep the full source tree: existing links to an excluded file
then use the converter's existing GitHub fallback at the exact source ref. Missing files still
fail conversion. Advanced public references, installation checks and performance guides remain.

Decision: exclude internal sources rather than hiding sidebar groups. Sidebar-only hiding leaves
public routes and search/Ask passages. An exhaustive guide allowlist would unnecessarily hide
future product guides; a bounded internal-source policy preserves their existing publication.

## Effects and verification

Only selected pages reach Starlight, locale notices, Pagefind and the Ask index. The existing clean
build removes old generated routes. No runtime API or product contract changes. Fixture-based
conversion and build tests prove exclusion and pinned source links without network access;
the browser suite covers navigation, search, Ask and both languages. A local-source build reviews
the current products and the revised Diagrams guides together.
