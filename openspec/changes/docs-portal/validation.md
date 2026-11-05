# Validation

Recorded on 2026-11-04 (America/Santiago) in the worktree `C:\meltemi\worktrees\docs-portal`, branch
`docs-portal` from `origin/main` `f5fea6e`, on Windows 11, Node 24.15.0, pnpm 10.33.2, Terraform
1.15.4, Chrome 156.0.8078.80. Nothing here reached Cloudflare or GitHub with a credential:
the builds ran in `fixture` and `local` modes, the route ran with its offline stubs, and Terraform
ran against mocked providers.

## Gates (task 6.1)

| Gate                                     | Result                                                                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`         | Up to date with the lockfile                                                                                                             |
| `pnpm typecheck`                         | Green in the four packages (docs, identity, ocean, site)                                                                                 |
| `pnpm lint`                              | ESLint clean; Prettier: all matched files formatted                                                                                     |
| `pnpm build`                             | Green; the portal from `fixture` (no sibling checkout beside the worktree): 24 pages, 1 picture from 4 `text` fences, 36 passages, 5 inline script hashes in `_headers`, 5 s |
| `pnpm test`                              | 55 files, 2,308 passed, 1 skipped (the IDE-token check that needs `MELTEMI_IDE`); `packages/docs` alone: 7 files, 88 tests               |
| `pnpm site:browser`                      | 9 of 9 checks                                                                                                                             |
| `pnpm docs:browser` (the portal's check) | 9 of 9 checks: quiet pages (no console error, no policy violation, nothing beyond localhost), headers, search, Ask in both languages, the spent allowance, motion and reduced motion, light and dark with the switch, a 375 px phone, no JavaScript |
| `pnpm infra:fmt`                         | Formatted                                                                                                                                 |
| `pnpm infra:validate`                    | The configuration is valid                                                                                                               |
| `pnpm infra:test`                        | 14 runs passed, 0 failed (new: `docs_staged`, `docs_attached`, `missing_workers_ai_group`; extended: `first_apply`, `deploy_tokens`, `apex_swap`, `ide_notice_token`) |
| `openspec validate "docs-portal" --strict` | Valid                                                                                                                                   |

`pnpm test` ran seven times in this session. Two runs, while other processes held the machine
at about 84 % of its CPU (Defender scanning the builds' files and other sessions), timed out in
existing timing-bound tests of other packages (`packages/ocean/test/wind.test.ts` "draws short
streaks…", `packages/site/test/site.test.ts` "writes every state's picture…", once
`packages/identity/test/api-account.test.ts` "answers 429…"); each passes alone and the five other
runs were green. To keep the portal's own load out of those timings, `vitest.config.ts` now runs
the portal's timed test (`ask.test.ts`) and the tests that start processes (`pictures.test.ts`,
`sources.test.ts`, `portal.test.ts`, whose Astro build also runs at a lower priority) as later
groups, after the rest of the workspace.

## The real documentation (`local` mode)

`pnpm --filter @meltemi/docs build --from local --siblings C:\meltemi --embedder fake`, against the
owner's checkouts (Diagrams `v1.11.7`, IDE `v0.2.29`, this repository `f5fea6e`): 376 pages (153
Diagrams guides, 66 IDE guides, 8 of this repository, the rest notice pages), 42 pictures drawn
from 138 `text` fences, 3,406 passages of 227 pages (`ask/index.bin` 7.4 MB), 683 files, 7 inline
script hashes, 51 s from an empty cache. A walk of the result found 38,020 internal links, none
broken, and no page or stylesheet loading anything from another host. Every source page has a
`# Heading`; Expressive Code highlights `ebnf` fences as plain text. Read in the browser: the
Diagrams sidebar grouped by its index's headings, the IDE section from its readme, pictures under
the language guides, the footers' releases.

## Dependencies

| Package                 | Version  | Licence | Why this version                                                                   |
| ----------------------- | -------- | ------- | ---------------------------------------------------------------------------------- |
| `astro`                 | 7.3.8    | MIT     | Starlight 0.42.9 asks for `^7.2.10`; 7.4 raised Node's floor to 22.23.4 (the workspace's is 22.12) |
| `@astrojs/starlight`    | 0.42.9   | MIT     | The latest; brings `pagefind` 1.6.0 and `@pagefind/default-ui` 1.6.0 (MIT)          |
| `@meltemi/diagrams-cli` | 1.11.7   | MIT     | Development dependency; the latest on npm, drawing SVG with no browser              |

`pnpm licenses list --filter @meltemi/docs` names the three as MIT. `sharp` (libvips, LGPL) was in
the lockfile before this change, through `wrangler`'s `miniflare`; the portal's passthrough image
service does not use it.

## Left for Meltemi Diagrams (task 5.2b)

Not done here: the job belongs to `askenaz-dev/meltemi-diagrams`, whose files this implementation
does not touch. Terraform here declares the repository secret it reads,
`github_actions_secret.release["meltemi-diagrams/WEB_DISPATCH_TOKEN"]`, once `web_dispatch_token`
is set. What `.github/workflows/release.yml` of Diagrams needs, as the IDE's `tell the web`:

```yaml
  tell-the-web:
    name: tell the web
    # After the publication: every channel that publishes (npm, Marketplace, Open VSX, GitHub);
    # name them as that workflow's jobs are named.
    needs: [<the publishing jobs>]
    if: always() && <the release was published>
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Start the web's deploy
        shell: bash
        env:
          GH_TOKEN: ${{ secrets.WEB_DISPATCH_TOKEN }}
        run: |
          if [ -z "$GH_TOKEN" ]; then
            echo "::error::WEB_DISPATCH_TOKEN is not set (meltemi-web's Terraform declares it from web_dispatch_token); the release is published, the web was not told"
            exit 1
          fi
          gh workflow run deploy.yml --repo askenaz-dev/meltemi-web --ref main
```

Its checks there: the job runs after the publication, reads `secrets.WEB_DISPATCH_TOKEN` and no
other secret, prints none, fails naming the secret when it is unset, and runs exactly
`gh workflow run deploy.yml --repo askenaz-dev/meltemi-web --ref main` (the delta of
`delivery-pipeline`, "Diagrams tells the web"). `deploy.yml` here accepts that dispatch on `main`
and resolves the current CI-approved source itself.

## What the first deploy needs

1. Merge with `docs_deployed = false` (the default): `infra-apply.yml` creates the Worker
   `meltemi-docs` (no `workers.dev`, no previews) and adds "Workers AI Read" to the web's deploy
   token; the account must list that permission group, or the plan stops naming it.
2. The same push's `deploy.yml` runs the `docs` job: `pnpm --filter @meltemi/docs build --from
   release` (GitHub's latest releases; Workers AI embeddings with the job's token, about 3,400
   passages the first time, cached in `.cache/` afterwards) and `wrangler deploy` of the first
   version. A product whose archive cannot be read fails this job only. Deploy and the apply share
   one queue in either order: when Deploy runs first, the job finds no `meltemi-docs` (Cloudflare
   answers 404 by name), says so in a notice and uploads nothing, so the Worker is never created
   outside Terraform; a dispatch of `deploy.yml` after the apply uploads the first version.
3. A commit sets `docs_deployed`'s default to `true` in `packages/infra/variables.tf`: the next
   apply attaches `docs.meltemi.dev`. The test runs name `docs_deployed` where they depend on it,
   so the flip changes no test.
4. When the owner sets `web_dispatch_token`, Diagrams gets its `WEB_DISPATCH_TOKEN`; then task 5.2b.
