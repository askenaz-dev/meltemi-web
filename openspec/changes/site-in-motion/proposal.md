# Proposal: the site in motion

## Why

Meltemi is named after the Etesian, the dry north wind that blows across the Aegean every
summer, and its mark is a boat that wind drives: an `m` whose two arches are sails, a hull below
them, and a prow that rises north-east as a gust. Yet nothing on meltemi.dev moves or says wind
or sea. Today's site has a flat hero, two screenshots and hand-written cards, while the sites of
comparable tools (onorca.dev, for one) move. A visitor decides in a few seconds, and the brand's
own story is not on the page.

The stillness was a rule, not an accident. The `product-site` change forbade any `<script>`, and
decision 0003 says "no JavaScript in pages". On 2026-10-28 the owner decided to rewrite that rule.
The family's pages may now carry the JavaScript and CSS that a modern, animated site needs, as long
as they keep the security of today's policy and good practice. The owner also chose the scope
(the family's home, the IDE pages and the Diagrams page, with diagrams.meltemi.dev in a sister
change), the behaviour (the sea and wind move on their own, and scrolling sails the boat) and the
theme (light and dark, as the system says).

## What Changes

- **A digital sea under every product page.** The hero of the home, of the IDE pages and of the
  Diagrams page, in English and Spanish, draws three things:
  - the sea, as a field of points rising and falling in waves;
  - the wind, as streams of particles that blow the way the mark's gust points;
  - the Meltemi mark, sailing on that sea.

  It uses the brand's own colours (Aegean blue to wind cyan) in both themes.
- **The mark prevails.** When the page loads, the wind draws the mark's `m` stroke from end to
  end, and the hull rises out of the sea. After that the mark sails, rising and tilting with the
  wave beneath it. It is never deformed or recoloured, and it never gains a glow, a mast or a wave
  of its own (the rules of the IDE's `brand/README.md`).
- **Each page has its own sea state**, all on one system:
  - **Home: the crossing.** The boat crosses the sea.
  - **IDE: one heading, many sails.** Smaller sails, the agents, follow the mark's wake and fall
    into line on its heading as the page scrolls. This is the IDE's motto made visible.
  - **Diagrams: the wind draws.** Points of the sea lift and link into nodes and edges until they
    form a small flow diagram.
  - **Legal pages and the 404** keep a calm, still sea.
- **Scroll sails the boat.** While the hero is in view, scrolling moves the boat forward and
  strengthens the gusts. The sections below the hero reveal themselves as they enter the view.
- **Motion is always optional.**
  - With `prefers-reduced-motion`, nothing moves.
  - A pause button (in English and Spanish) stops all motion for the rest of the visit, and stores
    nothing.
  - Without JavaScript, or without WebGL and Canvas, each page shows a still picture of its sea.
  - Every word, link and download works without a script.
- **BREAKING (policy): pages may load scripts, from the site only.**
  - Pages load bundled ES modules served from `/assets/`, and the Content-Security-Policy gains
    `script-src 'self'` and Trusted Types enforcement.
  - Still forbidden: inline scripts, inline event handlers, `eval`, and any other origin's script,
    style, font or image.
  - Decision 0006 records the amendment of decision 0003.
- **A build step for the site.** esbuild bundles `packages/site/src/` into `packages/site/public/assets/`
  at build time, in CI and in the deploy workflow. The built files are not committed.
- **A shared sea: `@meltemi/ocean`.** `packages/ocean` holds the waves, the wind, the mark's sailing
  and the still pictures.
  - It renders with WebGL2, falls back to Canvas 2D, and has no runtime dependency.
  - It is published to npm with provenance from this repository, on tags `ocean-v<x.y.z>`, beside
    `@meltemi/identity`, so the Diagrams app wears the same sea.
- **Budgets with a check.**
  - At most 45 KB of gzipped script per page.
  - A still picture of at most 30 KB.
  - No layout shift from the sea.
  - No frame drawn while the hero is out of view, the tab is hidden or the visitor paused.
- **The pages in a real browser.** A check drives the built site, under `wrangler dev`, in the
  installed Chrome. Every page must:
  - load with no console error and no CSP violation;
  - draw the sea, and stop it under reduced motion or the pause button;
  - stay complete with JavaScript off.

New dependencies, approved by the owner on 2026-10-28 ("motion.dev, animejs, or whatever is
needed"):

| Package           | Version | Licence    | Use                                                         |
| ----------------- | ------- | ---------- | ----------------------------------------------------------- |
| `motion`          | 14.2.0  | MIT        | the site's scroll-linked and reveal animations (runtime)    |
| `esbuild`         | 0.28.2  | MIT        | bundles the site's TypeScript (development)                 |
| `playwright-core` | 1.63.0  | Apache-2.0 | drives the installed Chrome for the browser checks (development; the version Meltemi Diagrams uses) |

`@meltemi/ocean` itself has no dependency. The reference footage the owner shared is a
watermarked stock preview: it is inspiration only, and nothing from it is used.

## Capabilities

### New Capabilities

- `site-motion`: what the family's pages show in motion and how they behave. That covers:
  - the sea, the wind and the sailing mark;
  - the sea state of each page;
  - scroll and reveals;
  - reduced motion, the pause button and the still fallbacks;
  - both themes;
  - the weight and frame budgets.
- `ocean-package`: the contract of `@meltemi/ocean` for every product that draws the sea. That
  covers:
  - its API and presets;
  - its still pictures;
  - what it never does (no network, no storage, no telemetry, no dependency);
  - how it is published.

### Modified Capabilities

- `product-site`: the requirement "Static assets with no script and no external resource"
  becomes "Self-hosted scripts and no external resource".
  - What changes: the policy admits same-origin module scripts and enforces Trusted Types.
  - What stays forbidden: inline scripts, inline handlers and any other origin.
  - The capability is introduced by the `product-site` change, which this change archives after.

## Impact

- **`packages/site`**
  - New: `src/` (the entry script and the scroll choreography), a `build` script, and the built
    `public/assets/`, which is ignored by Git.
  - Changed: every page in both languages (hero markup, the pause button, one module script),
    `site.css` (hero, still picture, reveals) and `_headers` (the policy).
  - The README loses "No framework, no build step, no JavaScript".
- **`packages/ocean`**: new, Apache-2.0, with its README as the contract for products.
- **Tests**
  - `packages/site/test/site.test.ts`: the no-script rule is replaced by the self-hosted-script
    rule, plus checks for the hero, both languages, the still pictures and the budgets.
  - New: the ocean package's own unit tests and the browser check.
  - `test/workflows.test.ts`: covers the new release trigger and the browser job.
- **Workflows**
  - `ci.yml` gains a browser job on Linux.
  - `release.yml` publishes `@meltemi/ocean` on `ocean-v*`, through `scripts/release-tag.mjs`.
  - `deploy.yml` is unchanged: it already builds before it uploads the site.
- **Docs**
  - `docs/decisions/0006-site-in-motion.md` (new).
  - `docs/repositories.md` gains a sixth crossing, the motion package.
  - `openspec/config.yaml` context: "no JavaScript in pages" no longer holds.

## Non-goals

- **diagrams.meltemi.dev wearing the sea.** The playground and its pages live in
  `askenaz-dev/meltemi-diagrams`. A sister change there consumes `@meltemi/ocean` on the
  playground's welcome and setup pages, never behind the canvas where people edit.
- **The IDE's own applications.** The desktop and terminal clients live in `askenaz-dev/meltemi`
  and are not touched.
- **The recording of the product demo.** The IDE's change `demo-animada-del-sitio` produces it, in
  the IDE repository.
- **The npm trusted publishing of the new package and its token.** That belongs to the `delivery`
  change (its task 8.2), like the identity package's.
