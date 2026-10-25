## 1. The requirement and its checks

- [x] 1.1 `specs/product-site/spec.md`: the requirement "The figures are real captures, declared as such" with its four scenarios
- [x] 1.2 `packages/site/test/site.test.ts`: one block that reads every page and checks the figures, the pictures outside them and the twins; shown to fail when each rule is broken on a copy of the page
  <!-- 2026-10-24: nine breaks, each detected and named by page, figure and cause: an alt text cut to one word, the simulated agent, the platform (every platform name) and the product state dropped from a caption, the fixture dropped from the Spanish one, an image that is not a file, a figcaption removed, a meaningful picture outside a figure, and the Spanish twin showing the other image. The pages were restored after each. -->
- [x] 1.3 `pnpm typecheck`, `pnpm lint`, `pnpm test`; `openspec validate site-figures-provenance --strict`
  <!-- 2026-10-24: all green; `pnpm test` 2072 passed and 1 skipped, the 2069 of before plus the three new checks. -->

## 2. The owner's part

- [ ] 2.1 Read the pull request and merge it; no page changes, so the deployment that runs on merge changes nothing. Archive this change after `product-site` and `delivery`, in the order the other changes follow
