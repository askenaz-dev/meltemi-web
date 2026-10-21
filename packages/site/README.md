# `packages/site`

The product site of the Meltemi family, served at `meltemi.dev` as the static assets of a
Cloudflare Worker with no code: hand-written HTML in English and Spanish, the IDE's design
tokens, `_headers` and `_redirects`. No framework, no build step, no JavaScript: what is in
`public/` is what is served.

Written by the OpenSpec change
[`product-site`](../../openspec/changes/product-site/proposal.md). The decisions are in
[`docs/decisions/0001`](../../docs/decisions/0001-family-repositories.md) and
[`0003`](../../docs/decisions/0003-family-web-on-cloudflare.md).

## Pages

```
public/
├── index.html  es/index.html              the family's home: one brand, two products
├── ide/  es/ide/                          the Meltemi IDE: index, method/, agents/, downloads/
├── diagrams/  es/diagrams/                Meltemi Diagrams: open the app, install, the account
├── privacy/  terms/  es/privacy/  es/terms/
├── 404.html                               English, with a way to the Spanish home
├── media/                                 the IDE's two screenshots and the three brand SVGs
├── tokens.css  site.css                   the IDE's tokens; the site's one stylesheet
└── _headers  _redirects                   the policy of every path; the old addresses
```

Every page is an `index.html` in its folder, linked with root-relative addresses and a trailing
slash (`/ide/method/`), and every page has a twin in the other language at the same path under
`/es/`. A page declares `<html lang>` and three alternates: `en` and `x-default` point at the
English page, `es` at the Spanish one.

## Preview and checks

```bash
pnpm site:dev     # wrangler dev on http://localhost:8789: clean URLs, _redirects and _headers as in production
pnpm test         # the checks of the site, with the rest of the workspace
```

The port is the `SITE_URL` the identity service's `.dev.vars` names, beside the identity service
on 8787 and the Diagrams Worker on 8788.

`test/site.test.ts` walks `public/` and reports every offender by page and address: each page has
its twin, `<html lang>` and alternates; Spanish pages link Spanish pages; every internal link
(and anchor) leads to a file; no script, style, form, event handler or resource from another
origin; the twins link the same external places (each language's readme of the IDE repository
counts as one); the old addresses redirect with a 301 and the policy headers are set; the Diagrams
page opens the app and gives the exact install command; the privacy notice states the inventory;
the downloads pages name no version; and **no page still says `OWNER-CONTACT`**.

## Editing a page

1. Edit the English page and its Spanish twin in the same change: same structure, same facts,
   the same external links. Spanish is natural Latin American Spanish, not a word-for-word copy.
2. Use the classes of `site.css` (`hero`, `card` in a `grid`, `btn`, `notice`, `tableWrap`,
   `state`, `figure`, `details`); do not add a script, inline style or external resource: the
   policy in `_headers` would block them and `pnpm test` refuses them first.
3. A new page is `public/<name>/index.html` and `public/es/<name>/index.html`, linked from the
   navigation or the page that introduces it.
4. Run `pnpm site:dev` and read the page in both languages, then `pnpm test`.

## The tokens

`public/tokens.css` is a copy of the design tokens of the IDE's desktop client
(`desktop/ui/src/app.css`, whose normative source is the IDE repository's `design-system/`). Its
header names the commit it was copied from. Never edit a value here: change the client's token and
copy it across. After the IDE's tokens change, or to check the copy:

```bash
pnpm site:tokens --ide C:\forge\agentic-ide
```

The script compares **every** `--name: value;` declaration (the design tokens are `--bg`,
`--surface`, `--text` and the rest; only two carry the `--mel-` prefix), light and dark blocks,
as the ordered list of values of each name. It fails naming the token when the site has one the
client lacks or a value the client does not declare for it, and it refuses fewer than 30 tokens.
Exit 0 means every token matches, 1 a divergence, 2 a bad argument or an unreadable file. This is
the replacement for the IDE repository's `core/meltemid/tests/site.rs`, which leaves with its
`site/` folder.

## Where the pages come from

The IDE's four pages and their Spanish twins, `site.css`, `tokens.css` and the two screenshots were
moved from `site/` of the IDE repository, and the three brand SVGs (`meltemi-mark-gradient.svg`,
`meltemi-lockup-dark.svg`, `meltemi-lockup-light.svg`) from its `brand/`, all at the commit
**`463c34e8cda2043536abd85ccab67314b3289cca`** of `askenaz-dev/meltemi`. The IDE's release
workflow staged those SVGs into `site/media/` at publish time, so the folder alone never had them;
`site/CNAME` was a GitHub Pages file and is not copied. Only the links of the moved pages changed
(to the new structure); their words are the IDE's. One file differs from its source:
`media/tui-sessions.svg` has a one-line comment fixed (`--example` became ``(example `capture_svg`)``),
because XML forbids `--` inside a comment and the original was not valid XML, so the image never
rendered on the live site either; the IDE's generator (`tui/examples/capture_svg.rs`) has the same
comment and needs the same fix.

The old GitHub Pages addresses (`/method.html`, `/es/downloads.html`…) redirect with a 301 to the
page that now holds their content, and `/media/meltemi-mark-gradient.svg` keeps answering.

## The owner's part

The privacy notice and the terms are plain-language drafts, not legal advice. They say
`OWNER-CONTACT` where the contact address goes; put the address there in all four pages and
read the drafts before the site is published.

## Deployment

`.github/workflows/deploy.yml` uploads `public/` with `wrangler deploy` on every push to `main`.
Everything else is declared in `packages/infra` and applied by its pipeline: the Worker
`meltemi-site` itself, the zone `meltemi.dev`, and the Custom Domain `meltemi.dev` that replaces
the GitHub Pages records when `apex_on_github_pages` turns `false`. `wrangler.jsonc` therefore has
no route and keeps `workers_dev` and `preview_urls` off.
