## Decision

Set `HTMLLIElement.value` to the source's existing `n`. Native ordered-list semantics then preserve
the same number used by answer links, including gaps. Renumbering the response or answer would
change the public citation contract and is unnecessary.

The answering prompt also requires the reader's exact operation, explicitly separates session
sign-out from unlinking a provider or deleting an account, and refuses destructive substitutes.
When retrieved passages lack instructions for that operation, the existing localized not-covered
answer applies. This is a prompt correction, without changing retrieval or model configuration.

## Modules and interfaces

The Ask dialog renderer, `packages/docs/src/ask.ts` prompt and `packages/docs/scripts/browser.ts`
change. `Source.n` and the `POST /api/ask` response stay unchanged. Products consume no new contract.

## Local verification

The browser check intercepts the local `/api/ask` response with source numbers `[1, 2, 3, 4, 6, 7]`.
It verifies native list-item values and matching citation/source destinations in both languages.
The existing browser harness blocks non-local requests; no model or production service is called.
Run the regression before and after the fix, then the required typecheck, lint, build, full test
suite and complete documentation browser checks. There are no unresolved choices.

Offline prompt/pipeline tests do not demonstrate model compliance. The coordinator will run two
explicitly authorized production regressions after deployment for the session sign-out question;
those results are separate from local tests and are not claimed before execution.
