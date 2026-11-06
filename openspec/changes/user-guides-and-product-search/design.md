## Source curation and language pairs

The portal selects user sources in `packages/docs/scripts/audience.ts`. Internal architecture,
benchmark and operator documents stay readable in GitHub at the source ref. Web's public section
uses its own user index and account/administration guides instead of the contributor README.
The products own their guide audits and translations.

`sourcePages` recognizes explicit en/es folders. Canonical IDE root files retain their detected
language even when a Spanish mirror is present. A relative guide link prefers its source page's
locale when a genuine translation exists. Explicit locale links remain explicit. Duplicate
locale/id sources and nonexistent references still fail the build.

## Search interface

The route determines the initial scope: all on the portal home, otherwise diagrams/ide/web.
Each indexed guide carries a Pagefind product filter. A small owned search shell uses Pagefind's
existing bundled UI and its public `triggerFilters` API, with a labelled native select. This
avoids intercepting Starlight's private UI instance or maintaining a full copy of its component.
The dialog preserves keyboard shortcuts, focus, Escape/backdrop closing, empty-query behaviour,
local-only requests, translated status strings and touch targets. Scope resets from the route
on navigation and persists while reopening the same dialog.

## Ask

The same choices apply to Ask, as explicitly requested by the owner. The JSON request gains an
optional `section` enum; omission keeps the global API behaviour. Invalid sections are rejected
before AI calls. `rank` excludes other products before selecting its candidates. A selected
product with no covering passages returns the existing not-covered response; retrieval never
falls back to another product. Existing AI control, rate limits, privacy and model stay intact.
Changing scope aborts any in-flight answer and clears its stale result while keeping the question.

## Verification

Unit tests cover mixed-root locale routing, duplicate/missing sources, invalid request sections,
ranking under cross-product collisions and no-coverage behaviour. Browser tests use common
session terminology across all products to prove home-global and per-product defaults in EN/ES,
scope overrides, preserved questions, keyboard/mobile behaviour and stale-response handling.
All AI tests use the existing fake embedder/model. No new download or production AI call is needed.
