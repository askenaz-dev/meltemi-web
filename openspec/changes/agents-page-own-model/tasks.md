## 1. The requirement and its checks

- [x] 1.1 `specs/product-site/spec.md`: the requirement "The agents pages point to the guide for a model of your own, honestly" with its three scenarios
- [x] 1.2 `packages/site/test/site.test.ts`: one block that reads both pages and checks the section, the link, the claim and the names; shown to fail when each one is broken on a copy of the page
  <!-- 2026-10-24: five breaks, each detected and named by page and cause: the link gone, the claim about the engine removed, a vendor's name in the section, the landmark lost, and the Spanish claim removed. The pages were restored after each. -->
- [x] 1.3 `pnpm typecheck`, `pnpm lint`, `pnpm test`; `openspec validate agents-page-own-model --strict`
  <!-- 2026-10-24: all green; `pnpm test` 2066 passed and 1 skipped, the 2064 of before plus the two new checks. -->

## 2. The owner's part

- [ ] 2.1 Read the pull request and merge it; the deployment that runs on merge changes no page. Archive this change after `product-site` and `delivery`, in the order the other changes follow
