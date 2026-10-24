## 1. The statements and their checks

- [x] 1.1 `packages/site/public/privacy/index.html` and `packages/site/public/es/privacy/index.html`: the three statements in the IDE section; the date moves to 24 October 2026
  <!-- 2026-10-24: the three statements as a list after the existing paragraph; the Terms pages keep their date. -->
- [x] 1.2 `packages/site/test/site.test.ts`: one block that reads both sections and checks the five statements, the folders of the three platforms and the two dates; shown to fail when each one is broken on a copy of the page
  <!-- 2026-10-24: ten breaks, each detected and named by page and cause: each of three claims removed in English, two in Spanish, a Windows and a Linux folder wrong, the landmark lost, the Spanish date apart from the English one, and a month that is not one. The pages were restored after each. -->
- [x] 1.3 `pnpm typecheck`, `pnpm lint`, `pnpm test`; `pnpm exec prettier --check`; `openspec validate ide-privacy-statements --strict`
  <!-- 2026-10-24: all green; `pnpm test` 2069 passed and 1 skipped, the 2066 of before plus the three new checks. -->

## 2. The owner's part

- [ ] 2.1 Read the pull request and merge it; the deployment that runs on merge changes the two pages. Archive this change after `product-site` and `delivery`, in the order the other changes follow
