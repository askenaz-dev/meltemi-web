## 1. Product-signed calls

- [x] 1.1 `packages/identity/src/product-call.ts`: the canonical string, `signProductRequest({ product, secret, method, url, body, now })` → headers, `verifyProductRequest(request, body, secretOf, now)` → `{ product } | undefined` (constant-time compare, five-minute window, unknown product refused); `test/product-call.test.ts` (round trip, stale timestamp, wrong secret, altered body, altered path, query and method, malformed headers)
- [x] 1.2 `src/verify.ts` (the package's main entry) exports the signer, the verifier, the header names and the types `AccountView`, `AccountIdentity`, `AccountSession`, `AccountProvider`, `AccountApiError` (`src/account-view.ts`); `src/testing.ts` gains `signedProductCall({ product, secret, url, method?, body?, token, now? })`; `package.json` 0.2.0; `test/product-call.test.ts` covers the exports and the helper, `test/isolation.test.ts` the new modules of the verifier's and the testing module's graphs

## 2. The account API

- [x] 2.1 `src/routes/api-account.ts`: `productCaller(ctx)` (body through the 8 KiB cap, product signature, bearer token verified against the current key set with `iss`, `aud`, `exp`, the session live and the person's through `sessionFromToken`; `401 product.unauthorized` / `401 session.invalid`), `GET /api/account`, `POST /api/account/unlink`, `POST /api/account/sessions/revoke-others`, `POST /api/account/sessions/:sid/revoke` (`409 session.current`, `404 session.not-found`), every action answering the whole view, answers `no-store`, the rate limit (`src/limits.ts`, one counter per isolate or the harness's own through `Deps.limits`; `429 rate.limited`); `test/api-account.test.ts` with every spec scenario
- [x] 2.2 `src/handler.ts`: the routes; cookies ignored under `/api`; `OPTIONS` and unknown `/api` paths answer JSON `404 not-found`, errors JSON `500 internal`; no CORS header anywhere (`test/api-account.test.ts` asserts the absence on the API's answers and the preflight)

## 3. The page

- [x] 3.1 `src/pages/account.ts` and `src/routes/account.ts`: "Sign out" per session that is not current (`POST /account/sessions/revoke` with `sid`, through `accountAction`; `404 session.not-found` for a stranger's, `409 session.current` for the current one), the current row posting to `/logout` (the page-level Sign out moved there); `return_to` kept through the forms and the link flows, "Back to <host>" at the top, the deleted page's link, a signed-out person sent to sign in and back with it; an address outside the family refused with `return_to.invalid`, one a form carries dropped; messages en/es; `test/account.test.ts` (six forms) and `test/account-product.test.ts`

## 4. Documentation and gates

- [x] 4.1 `packages/identity/README.md`: "The account API" under "For products" (the calls, the two credentials, the canonical string, the error codes, what stays a navigation, `return_to` into the page), the secret described as the product's secret, the routes table and the codes; `docs/decisions/0005-account-api-for-products.md`
- [ ] 4.2 Gates: `pnpm typecheck`, `pnpm lint`, `pnpm test` (2047 passed, 1 skipped) and `openspec validate identity-account-api` green on 2026-10-21; `pnpm --filter @meltemi/identity build` writes the new `dist/`. Left: archive after `identity-service` is archived, and fill the Purpose of the touched specs if it is still TBD
