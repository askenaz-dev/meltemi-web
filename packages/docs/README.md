# `packages/docs`

The documentation portal of the Meltemi family at `https://docs.meltemi.dev/`: the released
documentation of Meltemi Diagrams, the Meltemi IDE and this repository as one
[Starlight](https://starlight.astro.build/) site in English and Spanish, with search in the
reader's browser and "Ask the docs". Served as the static assets of the Worker `meltemi-docs`,
whose code serves `POST /api/ask` and `GET /api/ask/status`. Written by the OpenSpec change
[`docs-portal`](../../openspec/changes/docs-portal/proposal.md);
[decision 0007](../../docs/decisions/0007-documentation-portal.md) says why it is built this way.

## Build

```bash
pnpm docs:build                                          # local where C:\meltemi\{diagrams,ide} exist, fixture elsewhere
pnpm --filter @meltemi/docs build --from release         # the products' latest GitHub releases (the deploy)
pnpm --filter @meltemi/docs build --from local --siblings C:\meltemi   # from a worktree that is not beside them
pnpm docs:dev                                            # build with the offline embedder, then wrangler dev on :8790
pnpm docs:browser                                        # the fixture in Chrome: search, Ask, schemes, phone, no script
pnpm docs:tokens                                         # rewrite src/styles/tokens.css from the site's tokens
```

The build reads and converts everything before it writes anything, so a product whose
documentation cannot be read, or a page that cannot be converted, fails it with the portal as it
was. It prints the mode it chose.

| Mode      | Sources                                                                                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `release` | Each product's latest published release (`GET /repos/{repo}/releases/latest`; `main` when it answers 404), read from `codeload.github.com`'s archive by `scripts/tar.ts`; this repository's docs from the checkout being built (`SOURCE_SHA` names it) |
| `local`   | The sibling checkouts `../../../diagrams` and `../../../ide` (or `--siblings`), each at what `git describe` says, and this repository                                                                                                                  |
| `fixture` | `test/fixtures/` ([its README](test/fixtures/README.md) lists the rule each page exercises): what `pnpm test`, `pnpm build` on CI and the browser check build, with no network                                                                         |

The steps, each a module of `scripts/` with its test:

1. `sources.ts` — the trees: `docs/**` and the readmes (`README.md`, `README.es.md`, `LEEME.md`,
   `CONTRIBUTING.md`, `CHANGELOG.md`) of each repository, and `sources.json` (repository, ref,
   version, date), which the footers and the home name.
2. `audience.ts` selects product guides before `convert.ts` creates pages. Decisions, QA and
   verification evidence, research, interface design, pilot/launch operations and explicit
   implementation plans and generated benchmark reports stay in GitHub; the policy applies to both languages and all source
   modes. These sources create no route, locale notice, sidebar item, Pagefind result or Ask
   passage. Links to existing excluded files still reach GitHub at the source ref; missing
   references still fail the build. Advanced product references, compatibility and installation
   verification remain public. `convert.ts` then applies one function per rule: the first
   `# Heading` is the title, the first paragraph
   the description, the first-line `[Español](…)` link is dropped, links to pages become portal
   routes (anchors kept), files outside `docs/` GitHub at the ref, `docs/media/` the copied files,
   pictures from other hosts their words; the sidebar follows the section's index (`docs/README.md`
   by its `##` headings, else the repository's readme), the unlinked pages after it; a guide in one
   language is written to the other locale as a notice page for older releases. Explicit `docs/en/`
   and `docs/es/` translations share the canonical page's route; the IDE can keep its original
   mixed-language root filenames. Relative links prefer the reader's language when a genuine
   translation exists; explicit locale links stay explicit. Duplicate translations fail the build.
3. `pictures.ts` — every `text` fence is handed to `meltemi-diagrams export --stdout --fonts
system`; one that draws is followed by its SVG, inline, in a `<figure>`; one that does not stays
   code. Cached in `.cache/pictures/` by the command line's version and the fence.
4. `index.ts` — the passages of every page (a heading and its paragraphs, at most 1,500
   characters, overlapping by one paragraph) embedded with `@cf/baai/bge-m3` through Cloudflare's
   API in batches of fifty with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, cached in
   `.cache/embeddings/`; written to `public/ask/index.bin` in the layout of `src/ask-index.ts`.
   Each live batch first reads the identity service's saved AI control. A paused or unreadable
   control prevents new AI calls; valid cached passages remain in the index and passages without
   a vector are omitted. Without the token and account, or when no cached or new vector is
   available, the index holds no passage and the pages leave the Ask button out. The portal and
   its search still build and deploy.
5. `astro build`, with Astro's telemetry off; Pagefind indexes both languages.
6. `_headers` — the build adds the SHA-256 of each inline script Starlight writes (its theme,
   before the first paint) to `script-src`, so the policy admits those exact scripts and nothing
   else that is not a file of the portal.

What the build writes is ignored by Git: `src/content/docs/`, `src/generated/`, `public/` but
`_headers`, `.cache/`, `.astro/`, `dist/` and `wrangler.dev.json`.

## Ask the docs

Search and Ask start with all products on the portal home, and the current product on a product
page. Both dialogs show a labelled product selector, including an explicit all-guides option.
Changing scope keeps the query. Search applies Pagefind's `product` filter, within the current
language. Ask filters eligible passages before candidate selection and answer generation; an
uncovered product never falls back to other products. Changing its selector aborts a pending
request and clears the previous answer. Neither selector changes another page's route default.

`POST /api/ask` (`src/ask.ts`, a plain function of the request and its dependencies;
`src/bindings.ts` builds them from the Worker's bindings):

| Request                                                                                                                                                                                                      | Answer                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `{ "question": "…", "lang": "en" \| "es", "section"?: "diagrams" \| "ide" \| "web" }`, 1 to 500 characters, `Content-Type: application/json`, from the portal's origin; omitted `section` means all products | `200 { answer, sources: [{ n, title, url, lang }] }`; `[n]` in the answer names a source |
| Anything else in the body                                                                                                                                                                                    | `400 { reason, message }` (`json`, `fields`, `lang`, `section`, `question`, `size`)      |
| Another method / another `Origin`                                                                                                                                                                            | `405` / `403`                                                                            |
| Over ten questions a minute from one address                                                                                                                                                                 | `429 { reason: "limit" }`, `Retry-After: 60`                                             |
| The owner has paused documentation AI                                                                                                                                                                        | `503 { reason: "disabled" }`, with no new AI call                                        |
| The central control cannot be read or is invalid                                                                                                                                                             | `503 { reason: "control" }`, with no new AI call                                         |
| Workers AI refuses a request, or the index holds no passage                                                                                                                                                  | `503 { reason: "allowance" }`                                                            |
| An index of another embedding model, or none                                                                                                                                                                 | `503 { reason: "index" }`                                                                |
| The closest passage scores below `MIN_SCORE`                                                                                                                                                                 | `200` with "The documentation does not cover this." and no source, and no model call     |

A covered question uses one embedding and one answer (`ASK_MODEL`, currently
`@cf/zai-org/glm-4.7-flash`, with thinking disabled and at most 400 completion tokens). A failed
call does not automatically retry with another model. The Worker loads the index once per
isolate, ranks every passage by the Hamming distance of its sign bits, rescores the best fifty by
the cosine of their int8 vectors and keeps eight. Nothing of a question is logged, stored or sent
anywhere but to Workers AI; the limiter is keyed by a hash of the address. The dialog
(`src/components/Ask.astro`, `src/scripts/ask-dialog.ts`) writes the answer as text and links each
`[n]` to its page.

## Persistent AI control

Owners in the existing `ADMIN_SUBS` identity allowlist manage the saved switch at
[`/admin/docs-ai?lang=en`](https://id.meltemi.dev/admin/docs-ai?lang=en) or
[`?lang=es`](https://id.meltemi.dev/admin/docs-ai?lang=es), also linked from their account page.
Invited Diagrams administrators do not receive access. An explicit pause survives deployments;
guides and page search remain available, and requests already running may finish.

`GET https://id.meltemi.dev/api/docs-ai` returns only `{ "enabled": true }` or
`{ "enabled": false }`, without caching or a model call. Production reads it through the
`IDENTITY` service binding before each runtime AI call; build-time embedding batches use its
fixed HTTPS address. Missing bindings, timeouts, errors and malformed responses fail closed.

The browser reads `GET /api/ask/status` when opening the dialog: `200 { "enabled": true | false }`
or, when the control is unavailable, `503 { "enabled": false, "reason": "control" }`. This route
is read-only, uses `Cache-Control: no-store` and makes no model call. The server enforces the
switch independently of the browser's last status read.

Enabling restores queries against deployed cached passages immediately. New or changed passages
join the index after the next enabled build. A paused build with no cached passages deploys no
Ask button; it needs an enabled build before that button and answers can return.

This switch does not monitor the account's plan or enforce a spending cap. Workers Free's
account-wide 10,000 Neurons/day allowance resets at 00:00 UTC and rejects excess calls; Workers
Paid can charge for excess usage. A billing alert is a notification, not a cap. See the current
[Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) and the
[operator guide](../../docs/documentation-ai.md) ([Español](../../docs/es/documentation-ai.md)).
The local Docker distribution, MCP server and external agent models are unaffected.

`pnpm docs:dev` and the browser check run the Worker with `wrangler.dev.json`, which
`scripts/dev-config.ts` writes from `wrangler.jsonc` without the Workers AI binding (`wrangler dev`
can reach it only in the cloud) and with `ASK_STUB = "fixture"`: the route then answers with the
offline embedder and a stub model, on an index the build made with the same embedder.

## Looks

`src/styles/tokens.css` is the site's tokens, name and value (the dark scheme's selectors changed
so Starlight's theme switch can choose a scheme against the system's; `pnpm docs:tokens` writes it,
`test/portal.test.ts` fails when it drifts). `src/styles/portal.css` maps them onto Starlight's
`--sl-color-*` properties and holds the lockup with its pill, the Ask dialog, the footer, the
pictures and the home; motion uses the IDE client's `--dur-*` and `--ease-out`, and nothing moves
under reduced motion. The lockups and the mark are copied from `packages/site/public/media/`, and
the home's sea is `@meltemi/ocean`'s still picture in the site's colours. The language picker is a
link to the twin, and every page reads without JavaScript.

## Deployment

`.github/workflows/deploy.yml`'s `docs` job runs after the site's, in the `production` environment
and the `production-reconciliation` queue, with the web's deploy token (which reads Workers AI):
`pnpm --filter @meltemi/docs build --from release`, then `wrangler deploy`. The Worker and its
Custom Domain are declared in `packages/infra`; the domain attaches once `docs_deployed` is true,
after the first upload. The IDE's and Diagrams' release workflows start this deploy with
`WEB_DISPATCH_TOKEN` after a publication.
