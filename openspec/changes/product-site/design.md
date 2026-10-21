## Context

The current site is thirteen files: four English pages, their four Spanish twins, two
stylesheets (`tokens.css` derived token for token from the IDE's desktop client, `site.css`),
two media files, a `CNAME`. Every page also links `media/meltemi-mark-gradient.svg` (favicon
and header mark), which is not in `site/`: the Pages job of the IDE's
`.github/workflows/release.yml` copies that mark and the two lockups
(`meltemi-lockup-dark.svg`, `meltemi-lockup-light.svg`) from `brand/` into `site/media/` at
publish time, so the served site is sixteen files. No framework, no build step, no JavaScript:
what is in the repository is what is served, and the IDE's `core/meltemid/tests/site.rs` fails
the IDE's build when the tokens drift from the client's. GitHub Pages serves it with `.html`
addresses (`/method.html`, `/es/downloads.html`) and cannot set response headers.

The family needs a home that presents both products, a page for Diagrams that opens the app,
and the legal pages the identity service and Google's consent screen require. Decision 0003
serves the site from Cloudflare Workers as static assets, which honour `_headers` and
`_redirects` files and clean URLs.

## Goals / Non-Goals

**Goals:**

- Keep what works: hand-written HTML in two languages, the IDE's tokens, no script, no build.
- A clear structure: the family at `/`, each product under its own path, Spanish mirrored
  under `/es/`.
- Every old address keeps answering; every page gets the policy headers.
- The checks catch a missing twin, a broken link, an external resource or a placeholder before
  anyone deploys.

**Non-Goals:**

- Deploying, DNS, retiring Pages (the delivery change).
- Product documentation (the products' repositories).

## Decisions

### Static assets of a Worker with no code

`packages/site/wrangler.jsonc` declares `assets: { directory: "./public",
html_handling: "auto-trailing-slash", not_found_handling: "404-page" }`, `dev: { port: 8789 }`
and no `main`. `public/` is the site; `pnpm site:dev` runs `wrangler dev` on
`http://localhost:8789` (the `SITE_URL` the identity service's `.dev.vars` names, beside
identity on 8787 and the Diagrams Worker on 8788) so `_redirects`, `_headers` and the clean
URLs behave as in production. Nothing is generated: what is in `public/` is what is served.

Alternative: a small generator for the shared chrome (header, footer, language switch) of each
page. It would remove repetition, but the IDE's site chose byte-for-byte publishing on purpose
and the pages are few; the checks keep the twins aligned instead. Recommended: no generator.

### Structure and addresses

```
/                 /es/                 the family: one brand, two products
/ide/             /es/ide/             the IDE (the former index)
/ide/method/      /es/ide/method/
/ide/agents/      /es/ide/agents/
/ide/downloads/   /es/ide/downloads/
/diagrams/        /es/diagrams/        Meltemi Diagrams
/privacy/         /es/privacy/
/terms/           /es/terms/
/404.html                              English, with a link to the Spanish home
/media/                                the IDE's two media files and the three brand SVGs
                                       copied from the IDE's `brand/`, at their old addresses
```

Each page is `index.html` in its folder; links are root-relative (`/ide/method/`,
`/media/meltemi-mark-gradient.svg`); each page
declares `<link rel="alternate" hreflang="en|es|x-default">` to its twin and itself, and
`<html lang>`. The navigation of the family's pages is Home, IDE, Diagrams, the language switch;
the IDE's pages keep their own navigation under `/ide/`.

`_redirects`:

```
/index.html            /ide/             301
/method.html           /ide/method/      301
/agents.html           /ide/agents/      301
/downloads.html        /ide/downloads/   301
/es/index.html         /es/ide/          301
/es/method.html        /es/ide/method/   301
/es/agents.html        /es/ide/agents/   301
/es/downloads.html     /es/ide/downloads/ 301
```

An old address leads to where its content now lives: `/index.html` was the IDE's product page, so
it goes to `/ide/`, while `/` itself is the family's home.

Alternative: keep `.html` addresses. Clean URLs read better in the products' links and the
redirects cost nothing. Recommended: clean URLs with a trailing slash.

### Headers

`_headers` applies to `/*`: `Content-Security-Policy: default-src 'none'; img-src 'self';
style-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors
'none'`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`,
`Permissions-Policy: camera=(), microphone=(), geolocation=()`, and `Strict-Transport-Security:
max-age=31536000` (the zone serves `https:` only once on Cloudflare). The policy allows no
script, so a page with `<script>` would simply not run: the checks refuse it earlier.

### The Diagrams page

Both languages, same structure as the IDE's product page: what it is (diagrams as code for
flow, free, sequence and C4; the same canvas in the browser and in VS Code; exports to SVG,
PNG, PDF, HTML player and video), "Open the app" to `https://diagrams.meltemi.dev/`, "Install"
with `npm install --global @meltemi/diagrams-cli` (the npm package; the command it installs is
`meltemi-diagrams`, alias `mdg`) and the VS Code extension, "Documentation" to the
Diagrams repository's `docs/`, and the account paragraph: the app works without an account;
signing in with GitHub or Google keeps projects between devices and enables sharing and
collaboration. Install commands and addresses are identical across languages; the checks
compare the links of each pair of twins.

### Privacy notice and terms

Plain-language drafts in both languages, structured as: who runs the site (the owner, with a
contact address), what the site collects (nothing: no cookies, no analytics, no forms), what the
identity service holds and why (the inventory of `identity-account`, the providers, the session
cookie, deletion from the account page, the seven-day propagation), what the Diagrams service
holds for signed-in people (projects, versions, shares, collaborators; readable by the service;
deleted with the account), and the terms (no warranty, acceptable use, the owner's right to
remove published content, the law of the owner's country). The contact address is the
placeholder `OWNER-CONTACT` until the owner provides it; the checks fail while it remains, so
the change cannot be archived with a draft address.

Alternative: a generated notice from a template service. The family's inventory is short and
known; a human-readable page the owner edits is better. Recommended: hand-written.

### Tokens

`tokens.css` keeps its header comment, extended with the IDE commit it was copied at.
`scripts/tokens.mjs` (`pnpm site:tokens --ide <path to the IDE repository>`) collects every
`--name: value;` declaration of `public/tokens.css` and of `desktop/ui/src/app.css` there into
one ordered list of values per name (the light block first, the dark block second; the client
also declares its explicit `data-theme` overrides, so its lists are longer). It fails naming the
token when a site token does not exist in the client or a site value is not among the client's
values for that name, refuses fewer than 30 site tokens, and exits 1 on any failure, 0
otherwise; the owner runs it when the IDE's tokens change. Only two tokens carry the `--mel-`
prefix (`--mel-aegean`, `--mel-wind`); the design tokens are `--bg`, `--surface`, `--text` and
the rest, which is why every declaration is compared, as the IDE's `site.rs` rule does. The IDE
repository drops its `site.rs` test when it drops `site/`.

### Checks

`packages/site/test/site.test.ts` (vitest, Node, no dependency beyond the file system) walks
`public/`: every `index.html` under `/es/` has a twin outside and vice versa; every `href` and
`src` that is root-relative or relative resolves to a file or a folder with `index.html`; no
`<script`, no `http(s)://` in `src`, `<link rel="stylesheet">` or `@import`; each page declares
`<html lang>` and the three `hreflang` alternates; twins carry the same set of external links
(each language's own readme of the IDE repository counts as one: `README.md` and `LEEME.md`);
`_redirects` lists every address of the old site; `_headers` names the policy; no page contains
`OWNER-CONTACT`; on `/ide/downloads/` and `/es/ide/downloads/` every link whose address contains
`/releases/` starts with `https://github.com/askenaz-dev/meltemi/releases` and the page contains
none of the version literals `/v0.`, `/v1.`, `meltemi-v`, `version=v` (the downloads rule of
the IDE's `site.rs`, which only knew `site/`). The IDE's pages are checked like the rest.

## Risks / Trade-offs

- **Moving `index.html` to `/ide/`.** People who bookmarked `meltemi.dev` now land on the
  family's home with the IDE one click away; the home shows both products above the fold.
- **Legal text.** Drafts are not legal advice; the owner reviews them. The checks only keep
  the placeholder from shipping.
- **Two copies of the tokens** (site and identity pages). Both are copies of one source; the
  comparison script takes either path.
