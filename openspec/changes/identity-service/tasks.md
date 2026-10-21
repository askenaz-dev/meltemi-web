## 1. Workspace

- [x] 1.1 Root: `package.json` (scripts `typecheck`, `lint`, `test`, `build`, `identity:dev`, `identity:migrate`, `identity:keys`, `site:dev`, `site:tokens`), `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `vitest.config.ts`, `.gitignore` (`node_modules/`, `dist/`, `.wrangler/`, `.dev.vars`); `pnpm install` with the approved dependencies pinned; `pnpm typecheck && pnpm lint && pnpm test` pass on an empty workspace
- [x] 1.2 `packages/identity`: `package.json` (`exports` `.` → `./dist/verify.js` with `./dist/verify.d.ts`, `./testing` → `./dist/testing.js` with `./dist/testing.d.ts`; script `build` = `tsc -p tsconfig.build.json`), `tsconfig.json`, `tsconfig.build.json` (emits `dist/` with declarations), `wrangler.jsonc` (`main`, D1 binding `DB`, `triggers.crons`, vars `ISSUER`, `COOKIE_DOMAIN`, `SITE_URL`, `SESSION_PUBLIC_KEYS`, `PRODUCTS`, `GITHUB_CLIENT_ID`, `GOOGLE_CLIENT_ID`), `packages/identity/.dev.vars.example` next to it (where `wrangler dev` reads `.dev.vars`: every name of `Env` with the development values `ISSUER=http://localhost:8787`, `SITE_URL=http://localhost:8789`, `DEV_ORIGINS=http://localhost:8788,http://localhost:8789`, `PRODUCTS` with `http://localhost:8788/_identity/events`, `DEV=true`), `src/worker.ts`, `src/handler.ts` with `identity()` answering 404 to unknown routes, `src/env.ts`; test support `test/support/` (`memoryStore`, `stubProviders`, `testKeys`, `request` helper, fake clock); a first test of the 404; `pnpm build` emits `dist/`

## 2. Sign-in slice

- [x] 2.1 Pages: `src/messages/en.ts` and `es.ts` (typed), `src/pages/layout.ts` with escaping, language resolution (`?lang`, `Accept-Language`), the policy headers (`form-action 'self' https://meltemi.dev https://*.meltemi.dev` plus `DEV_ORIGINS` in development mode, `Referrer-Policy: same-origin`), the legal links (`<SITE_URL>/privacy/`, `<SITE_URL>/terms/` and the `/es/` twins), `/identity.css`; tests of both languages, fallback, escaping and the headers
- [x] 2.2 `/login`: the chooser (provider links, no form); the provider redirect for GitHub and Google (scopes, `state`, PKCE for Google); the signed `meltemi_oauth` cookie; `return_to` validation (`src/return-to.ts`) with development origins; tests of the redirects, the cookie and the five return-address cases
- [x] 2.3 Providers (`src/providers/github.ts`, `google.ts`): exchange and profile through `deps.fetch`; the callback's checks (signature, provider, `state`, `error`, failures) and cookie clearing; tests with stubs for denied, mismatch and unavailable, and that no token is stored
- [x] 2.4 Identity resolution (`src/resolve.ts`) with `verifiedAt`, the 90-day window and the "an account with that email exists" page; the `IdentityStore` user and identity methods in `memoryStore`; tests of the five rules and of the stale verified email
- [x] 2.5 Sessions and the token (`src/session.ts`, `src/jwt.ts`): `sid`, coarse label, ES256 signing with `kid`, the cookie (production and development attributes), `/.well-known/jwks.json`; `scripts/keys.mjs`; tests of claims, tampering, rotation with two keys and the unknown `kid`
- [ ] 2.6 Owner: register the development OAuth apps at GitHub and Google (callback `http://localhost:8787/callback/github` and `http://localhost:8787/callback/google`) and fill `.dev.vars` from `.dev.vars.example`
- [x] 2.7 `migrations/0001_identity.sql` (users, identities with `verified_at`, sessions, outbox, indexes on verified email and due events), `src/store/d1.ts` over `D1Like`; `pnpm identity:migrate --local` applies the migration to `wrangler dev`'s local D1
- [ ] 2.8 Vertical slice by hand: `pnpm identity:migrate --local`, `pnpm identity:dev`, sign in with the development apps in a browser, see the cookie, sign out from the `GET /logout` confirmation page in Edge or Chrome and land on `return_to`; the steps written in the package README

## 3. The contract

- [x] 3.1 `GET /sessions/:sid` (204/404, last seen, `no-store`), `POST /logout` with the `Origin` rule, `GET /logout` confirmation page with the family's hosts in `form-action`; tests
- [x] 3.2 `src/verify.ts`: `parseSessionCookie`, `sessionVerifier` with the options `issuer`, `jwks` (inline, URL or function), `fetch`, `checkSession`, `cacheMs` (the `alg`/`typ` and JWKS entry checks, the JWKS cache with at most one refetch per minute on unknown `kid`s, the session check cached per instance, leeway, constant-time comparisons), `verifyEventSignature`; no Cloudflare types in the public surface; `src/testing.ts` exported as `@meltemi/identity/testing` (`testKeys`, `signSessionToken` with its claim defaults, `testJwks`) and a test that the Worker bundle does not reference it; tests with the same keys and fake fetches, including `alg: none`, `alg: HS256` with the public key, a throwing session check and ten unknown `kid`s within a minute
- [x] 3.3 Outbox and events (`src/events.ts`): enqueue on deletion, `scheduled` delivery with signature and ten-second timeout, the retry schedule, failed after seven days with `console.error`; tests with the fake clock and a stub product

## 4. The account

- [x] 4.1 `GET /account` (redirect when signed out, for the `POST` actions too; identities with their link dates, sessions, forms with `csrf`, `no-store`); the `Origin` and `csrf` checks (`src/forms.ts`); tests
- [x] 4.2 Link (`link=1` through the cookie; `identity.taken`) and `POST /account/unlink` (`identity.last`, `provider.unknown`); tests
- [x] 4.3 `POST /account/sessions/revoke-others` and `POST /account/delete` (confirmation word per language, cascade, events, cookie cleared, the deleted page); tests

## 5. D1

- [x] 5.1 A store conformance suite run over `memoryStore` and `d1Store`, the D1 one through a `node:sqlite` adapter (skipped when Node lacks it); the exact-tables test over the migration
- [ ] 5.2 `wrangler dev` with the local D1 through the whole flow by hand (sign in, account, unlink, delete); the `scheduled` handler triggered with `wrangler dev --test-scheduled` (run in `workerd` on 2026-10-14 with a seeded user and generated keys: every page and action, the cron delivering a signed event; the sign-in itself with the real providers waits for 2.6)

## 6. Documentation

- [x] 6.1 `packages/identity/README.md`: the contract for products (endpoints, cookie, token claims, JWKS, session check, signing out, the `Origin` rule, events and `verifyEventSignature`, verifier usage in Node and Workers with every option), development setup (`.dev.vars` and its development values, the development OAuth apps' callback addresses, `identity:keys`), the `pnpm install` and `pnpm build` a linking consumer runs here first, the secrets' names, the inventory of data held (with `verified_at`)
- [x] 6.2 Cross-check decision 0002 and `docs/repositories.md` against the implemented contract; `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` green
