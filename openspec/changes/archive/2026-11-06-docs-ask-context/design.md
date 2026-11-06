## Selected-page completion

`packages/docs/src/ask.ts` retains the original unique hit indices and their order as a prefix.
It scans only pages those hits already selected, considering pages in best-hit order. A page's
complete indexed passages can be appended only when its total prompt contribution is at most
6,000 characters and all missing passages fit the remaining 6,000 additional-character budget.
Text and the citation marker/separator count toward both limits. Long pages or additions that do
not fit keep their original hits; no section is partly appended and no new page is introduced.

The first selected account page fits this bound: its six indexed passages contain 4,058 English
or 4,516 Spanish text characters. Completing it includes session sign-out alongside provider
unlinking and account deletion. This guarantees available context, not model compliance.

## Outcome classification

The three existing HTTP 200 branches add `X-Meltemi-Ask-Outcome`: `no-match` for no eligible hit or
a score below the existing threshold; `not-covered` for an empty/refusing model response; and
`answered` otherwise. Bodies remain identical. The header contains no question, passage, score,
identifier or account data, and introduces neither persistence nor a debug route.

## Validation

Offline route tests place session instructions outside the original top eight while an unlink
or delete passage ranks first. Separate tests enforce budgets, atomicity, scope, original-hit
preservation and deduplication. Existing route cases verify the outcome branches. Required Web
checks run without live provider calls; production model testing remains separately authorized.

Ranking, threshold, models, operational controls, source guides and index format remain intact.
There is no new dependency or debug endpoint. The products' consumed `identity-session` contract
does not change; the only HTTP addition is the categorical header on the docs route.
