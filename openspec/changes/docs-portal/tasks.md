# Tasks

## 1. The package and the fixture

- [ ] 1.1 Add `packages/docs` (`@meltemi/docs`, private, Apache-2.0) with `astro`,
      `@astrojs/starlight` and `@meltemi/diagrams-cli` pinned, `astro.config.mjs` as design
      decision 1, `src/messages/{en,es}.ts`, `src/styles/tokens.css` from `pnpm site:tokens`,
      `wrangler.jsonc` (assets, AI, ratelimits), `.gitignore` for `src/content/docs/`, `dist/`
      and `.cache/`. Verify `pnpm install --frozen-lockfile` and `pnpm typecheck` pass and the
      licences are MIT in the lockfile.
- [ ] 1.2 Write `test/fixtures/{diagrams,ide,web}`: a Diagrams index in both languages linking
      three pages with one unlinked, `player.md` with the links of the conversion scenarios,
      `language/stories.md` with the purchase story fence, a fragment fence and a prose fence,
      `media/editing-demo.gif`, an IDE `quickstart.md` in Spanish only, this repository's
      `repositories.md`. Verify the fixture pages are listed in `test/fixtures/README.md` with
      the rule each exercises.
- [ ] 1.3 Write `scripts/tar.ts` (gzip, ustar entries, path filter, escape refusal) and
      `test/tar.test.ts` that writes an archive with Node and reads it back. Verify the two
      archive scenarios pass.

## 2. Sources and conversion

- [ ] 2.1 Write `scripts/sources.ts`: the three modes, `releases/latest` with a 404 fallback to
      `main`, the archive download through an injectable `fetch`, `sources.json`. Verify
      `test/sources.test.ts` covers the release-and-no-release and unreadable-archive scenarios
      with stubbed answers, and that `fixture` is chosen without siblings.
- [ ] 2.2 Write `scripts/convert.ts` as design decision 3, one exported function per rule, and
      `test/convert.test.ts` with a case per rule (title, description, twin link, inner links
      with anchors, outer links to GitHub at the ref, media, source link, order from the index,
      the one-language notice page, the missing heading and the broken link). Verify all pass.
- [ ] 2.3 Write `scripts/pictures.ts` running the CLI per `text` fence with the hash cache, and
      `test/pictures.test.ts` on the fixture's three fences. Verify the drawn one yields an SVG
      with `client` and `api`, the fragment stays code and the cache is hit on the second run.
- [ ] 2.4 Write `scripts/build.ts` that chains sources, conversion, pictures, `astro build` and
      the index, with `--from release|local|fixture`. Verify `pnpm --filter @meltemi/docs build`
      builds the fixture into `dist/` with both locales and prints the mode.

## 3. The portal's pages

- [ ] 3.1 Override `Footer` (section's release from `sources.json`, "Source on GitHub") and
      `Search` (Starlight's search plus the Ask button), the home page in both languages, the
      tokens mapped to `--sl-color-*`, the lockup, the motion token and reduced motion. Verify
      `test/portal.test.ts` over a fixture build: titles, both locales, the sidebar order, the
      footer's version, the notice page, the figure, no external resource.
- [ ] 3.2 Write `public/_headers` as design decision 9 and verify Astro's CSP support on the
      installed version (hashes for Starlight's inline script and styles, or the build's own
      hashes written into `_headers`). Verify `scripts/browser.ts` loads the fixture build under
      `wrangler dev` with the policy enforced and reports no violation, searches "purchase" and
      finds the Stories page, and the tokens test passes.

## 4. Ask the docs

- [ ] 4.1 Write `scripts/index.ts` (passages, the embedder through Cloudflare's API in batches
      of fifty, the binary layout, the empty index without a token) and `test/index.test.ts` with
      the fake embedder. Verify the layout round-trips and the no-token build writes the empty
      header.
- [ ] 4.2 Write `src/ask.ts` and `src/worker.ts` as design decisions 5 to 7 with `ASK_MODEL`,
      and `test/ask.test.ts`: the sources, the "not covered" answer, the 501-character question,
      the limiter, the allowance, the unknown model's index, no logging, only the two AI calls,
      the ranking of ten thousand fake passages under 5 ms. Verify all pass.
- [ ] 4.3 Write the Ask dialog (`src/components/Ask.astro` and its script): the field, the
      answer as text with `[n]` links, the sources list, the allowance and error sentences in
      both languages, the motion. Verify `scripts/browser.ts` asks the fixture question against
      `wrangler dev` with a `.dev.vars` stub mode and sees the answer and its source, and the
      reduced-motion scenario passes.
- [ ] 4.4 Write the privacy sentences into `packages/site/public/privacy/index.html` and
      `es/privacy/index.html`, and the "Docs" header link and the product pages' buttons in every
      page of the site; extend `test/site.test.ts` with the portal-link and privacy checks.
      Verify `pnpm test` passes and `pnpm site:dev` shows the links in both languages.

## 5. Infrastructure and pipeline

- [ ] 5.1 Add `docs` to `local.workers`, `var.docs_deployed` to `attached`, "Workers AI Read" to
      `deploy_groups.web`, the Diagrams `WEB_DISPATCH_TOKEN` secret, and the cases to
      `tests/stages.tftest.hcl`. Verify `pnpm infra:fmt`, `pnpm infra:validate` and
      `pnpm infra:test` pass with the staged-domain and token-groups scenarios.
- [ ] 5.2 Add the `docs` job to `deploy.yml` and its rules to `test/workflows.test.ts`; in
      `C:\meltemi\diagrams`, add the `tell the web` job to `release.yml` as the IDE's, in a pull
      request of that repository. Verify `pnpm test` passes here and the Diagrams workflow test
      (its `names`/workflow checks) passes there.
- [ ] 5.3 Update `docs/repositories.md` (the portal, `docs.meltemi.dev`, the Worker and the
      notice), `README.md`'s table, `packages/docs/README.md` (the three modes, the fixture, the
      Ask route's contract) and write `docs/decisions/0007-documentation-portal.md`. Verify the
      links resolve and `pnpm lint` passes.

## 6. Gates

- [ ] 6.1 Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm site:browser`, the
      portal's browser check and `pnpm infra:test`, then `openspec validate "docs-portal"
      --strict`. Verify all green and record the results in the change's `validation.md`.

## Workflow follow-up

- First apply declares the Worker; first deploy uploads it; then `docs_deployed = true` attaches
  the domain (a second infrastructure commit).
- Archive the change after review.
