## 1. The requirement and its checks

- [ ] 1.1 `specs/product-site/spec.md`: the requirement "The agents pages point to the guide for a model of your own, honestly" with its three scenarios
- [ ] 1.2 `packages/site/test/site.test.ts`: one block that reads both pages and checks the section, the link, the claim and the names; shown to fail when each one is broken on a copy of the page
- [ ] 1.3 `pnpm typecheck`, `pnpm lint`, `pnpm test`; `openspec validate agents-page-own-model --strict`

## 2. The owner's part

- [ ] 2.1 Read the pull request and merge it; the deployment that runs on merge changes no page. Archive this change after `product-site` and `delivery`, in the order the other changes follow
