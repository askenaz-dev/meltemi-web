# Agent guide

This repository is Meltemi Web: the product site (`meltemi.dev`) and the shared identity
service (`id.meltemi.dev`) of the Meltemi family. The products themselves live elsewhere:
[docs/repositories.md](docs/repositories.md) maps the three repositories and what crosses
between them. Decisions are in `docs/decisions/`.

## Working on it

Read [CONTRIBUTING.md](CONTRIBUTING.md). Changes are planned with OpenSpec under `openspec/`
(`/opsx:propose`, `/opsx:apply`, `/opsx:archive`); the context and rules that artifacts follow
are in `openspec/config.yaml`. Run `pnpm typecheck`, `pnpm lint` and `pnpm test` before asking
for review. `pnpm build` writes `packages/identity/dist/`, which Meltemi Diagrams links from its
`packages/cloud` ([docs/repositories.md](docs/repositories.md)); run it after changing the
verifier. Nothing here needs the cloud: the site previews with `pnpm site:dev`, the identity
service runs with `pnpm identity:dev` against `.dev.vars`, and every test runs in Node with
in-memory stores and stub providers.

## Rules that save iterations

- No download without the owner's approval. Approved: `wrangler`, `@cloudflare/workers-types`
  and the toolchain Meltemi Diagrams uses (typescript, vitest, eslint, prettier, tsx).
- Secrets never appear in code, fixtures, logs, pages or commits. `.dev.vars` is ignored by
  Git; `.dev.vars.example` lists the names.
- Words for people exist in English and Spanish, in typed catalogs; artifacts and code are in
  English.
- Every page declares a Content-Security-Policy and escapes what it shows.
- The session contract (`identity-session`) is consumed by other repositories: changing it is
  a change to that specification, announced to the products.
