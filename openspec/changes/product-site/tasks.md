## 1. The package and the moved pages

- [x] 1.1 `packages/site`: `package.json`, `wrangler.jsonc` (`assets` only: `./public`, `auto-trailing-slash`, `404-page`; `dev: { port: 8789 }`), `public/` with the IDE repository's `site/` files (thirteen) copied at a named commit (recorded in the README) plus `brand/meltemi-mark-gradient.svg`, `brand/meltemi-lockup-dark.svg` and `brand/meltemi-lockup-light.svg` copied into `public/media/` at the same commit; the root scripts `site:dev` and `site:tokens` are added to the workspace identity-service 1.1 creates (or created the same way when this change is applied first); `pnpm site:dev` serves the copied site on `http://localhost:8789` and `/media/meltemi-mark-gradient.svg` answers
- [x] 1.2 Restructure: the former `index`, `method`, `agents` and `downloads` under `/ide/` and `/es/ide/`, root-relative links, `hreflang` alternates, `<html lang>`, `404.html`; `pnpm site:dev` shows every page in both languages
- [x] 1.3 `public/_redirects` for every old address and `public/_headers` with the policy; verified in `pnpm site:dev` (`/method.html` answers 301)

## 2. New pages

- [x] 2.1 The family's home `/` and `/es/`: both products, navigation, language switch; read in both languages
- [x] 2.2 The Diagrams page `/diagrams/` and `/es/diagrams/`: description, open the app, install, extension, documentation, the account paragraph; identical links across twins
- [x] 2.3 `/privacy/`, `/terms/` and their twins: the drafts of the design with the inventory of `identity-account` and `OWNER-CONTACT` where the owner's address goes

## 3. Checks

- [x] 3.1 `packages/site/test/site.test.ts`: twins, alternates and `lang`, internal links resolve, no script or external resource, twins' external links equal, `_redirects` covers the old addresses, `_headers` names the policy, no `OWNER-CONTACT`, the `/releases/` links of `/ide/downloads/` and its twin start with `https://github.com/askenaz-dev/meltemi/releases` and neither page contains `/v0.`, `/v1.`, `meltemi-v` or `version=v`; `pnpm test` runs it
- [x] 3.2 `scripts/tokens.mjs` (root script `site:tokens`, `pnpm site:tokens --ide <path>`): every `--name: value;` declaration of `public/tokens.css` against `desktop/ui/src/app.css` (light and dark blocks, values as ordered lists), a token missing in the client or a value not among the client's fails naming it, fewer than 30 tokens refused; the source-commit header in `tokens.css`; run once against `C:\forge\agentic-ide` and exit 0, once with one value changed and exit 1

## 4. Documentation and the owner's part

- [x] 4.1 `packages/site/README.md`: how to edit a page in both languages, the tokens rule and script, preview, the source commit of the moved pages
- [ ] 4.2 Owner: the contact address replaces `OWNER-CONTACT`; the legal drafts and the new pages read in both languages; `pnpm typecheck`, `pnpm lint`, `pnpm test` green
