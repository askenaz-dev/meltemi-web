# Design: the site in motion

## Context

See `proposal.md` for the motivation, and `specs/` for the behaviour this design must meet.

**The site today.** `packages/site/public/` is what is served: hand-written HTML in two languages,
`tokens.css` (a copy of the IDE client's tokens, checked by `pnpm site:tokens`) and `site.css`.
There is no build step. The policy in `_headers` allows no script at all, and
`packages/site/test/site.test.ts` enforces that, together with the pages' structure, their twins,
the figures and the links. Deployment is already a build: `deploy.yml` runs `pnpm build` before
`wrangler deploy`, and `ci.yml` runs typecheck, lint, build and test on Node 22 and 24, on Linux
and Windows.

**The brand.** The IDE's `brand/README.md` sets the rules. The mark is two paths:
- an `m` stroke whose arches are a foresail and a mainsail, and whose right end rises north-east
  as prow and gust;
- a hull below it, separated by a strip of air.

Its gradient runs from Aegean blue `#2563EB` to wind cyan `#22D3EE`. It must never gain a mast,
waves, a compass, an anchor, a shadow, a glow or a circular container. The site already serves
the mark at `/media/meltemi-mark-gradient.svg`.

**The wind.** The Etesian, or meltemi, is the dry wind that blows from the north across the Aegean
from mid-May to mid-September. It is strongest in the afternoon, brings clear skies, and raises a
short, steep sea with white crests. That is the picture this design draws in the language of the
reference the owner gave: a sea made of points, seen at a low angle. The stock footage the owner
shared is a watermarked preview and is not used.

## Goals / Non-Goals

**Goals:**
- One drawing system, `@meltemi/ocean`, that the site and Diagrams' sister change both use, with
  no runtime dependency.
- The brand drives the scene. The mark is the protagonist and the only boat drawn at full size.
  The wind continues its gust, and the sea uses its gradient.
- Progressive enhancement throughout. HTML and CSS carry all content; the script adds motion and
  nothing else.
- A policy as strict as today's apart from one addition: same-origin module scripts, with Trusted
  Types enforced.

**Non-Goals:**
- No 3D engine, no physics simulation, no sound, no cursor tracking (the owner chose ambient plus
  scroll).
- No change to the words, structure or links of the pages beyond the hero markup, the pause
  button and the reveal markers.
- No analytics of any kind, including performance beacons.

## Decisions

### D1. The sea is a hand-written WebGL2 point field, with a Canvas 2D fallback

**Choice.** `@meltemi/ocean` draws the sea as a grid of points displaced by a sum of Gerstner
waves.
- The waves are computed in a vertex shader from a time uniform.
- Each fragment is drawn as a round dot, coloured from troughs (Aegean) to crests (wind cyan) and
  fading with depth.
- The wind is a few hundred particles advected along a smooth flow field toward the mark's gust.
  They are updated on the CPU and drawn as short fading streaks.
- The Canvas 2D renderer uses the same math with fewer points.

**Alternatives.**
- **three.js (MIT).** It provides a scene graph, materials and loaders that this scene does not
  need. It costs about 150 KB gzipped, three times the whole page budget.
- **OGL (Unlicense).** It is small, but it is a dependency for perhaps 150 lines of WebGL we would
  still write ourselves.
- **SVG and CSS only.** It needs no script, but it cannot move thousands of points at frame rate.
  The proposal's still pictures already cover that case.

**Recommendation.** Hand-written, about 1,000 lines with both renderers, kept small by having one
pure wave function (D4).

### D2. The site's choreography uses Motion; the package uses no library

**Choice.** `motion` 14.2.0 (MIT) drives three things:
- the scroll progress through the hero, with `scroll()`, which uses the browser's native scroll
  timelines where they exist;
- the section reveals, with `inView` and `animate`;
- the intro draw of the mark's stroke, by animating `stroke-dashoffset`.

The site imports only those functions, bundled and self-hosted. `@meltemi/ocean` stays free of
dependencies: it exposes `setProgress` and `setWind`, and the site feeds them.

**Alternatives.**
- **anime.js 4.5 (MIT).** It is equally capable (`onScroll`, `createDrawable`), but only one
  library should ship.
- **Hand-written WAAPI plus IntersectionObserver.** It would work, but it re-implements Motion's
  scroll mapping and its reduced-motion handling.

**Recommendation.** Motion. It was named first by the owner, is tree-shakeable to a few kilobytes,
and is built on WAAPI.

### D3. The mark is the brand's SVG, inline in the hero, above the canvas

**Choice.** The hero carries the mark's two paths inline, copied from the IDE's brand file and
checked against it (D10). The canvas sits behind it.

**Why.**
- An inline SVG stays crisp at every size.
- Its colours are exactly the brand's.
- The intro can draw the `m` stroke with `stroke-dashoffset`.
- The package moves the mark by setting its `transform` only: a translation onto the sea's
  height at the mark's position, and a tilt from the slope, clamped to 4 degrees.

Wind particles fade out inside the mark's clear space (the width of the small sail's notch), so
nothing touches the mark.

**Alternatives.**
- **Draw the mark in WebGL.** The brand would become an approximation, and placing it accessibly
  would be harder.
- **Use the mark as an `<img>`.** The `m` stroke could not be drawn by the wind.

### D4. One pure function for the sea

**Choice.** `heightAt(x, z, t, state)` and `slopeAt(x, z, t, state)` are pure TypeScript.
- The vertex shader carries the same formula, generated from the same constants at build time so
  they cannot drift.
- The Canvas 2D renderer, the mark's placement and the still pictures call the TypeScript
  function directly.
- Unit tests pin its determinism and its amplitude bounds.

### D5. The sea states

Each page declares its state on its `<body>` as `data-sea="home|ide|diagrams|still"`.

- **`home`, the crossing.** A fresh breeze: amplitude 1, four waves at choppy frequencies.
  - Scroll progress 0 → 1 carries the mark from 18% to 82% of the hero's width.
  - The wind strength rises from 0.6 to 1.0, and crests whiten with it.
- **`ide`, "one heading, many sails".** Five small sails follow the mark's wake. They are plain
  sail triangles drawn in the canvas, at 20–35% of the mark's size, in the muted point colour.
  - At progress 0 their headings scatter by up to 25 degrees.
  - By progress 1 they have lined up on the mark's heading: many agents governed by one
    specification.
  - The sails are not copies of the mark, so the brand keeps a single boat.
- **`diagrams`, "the wind draws".** A calmer sea (amplitude 0.7).
  - Over progress 0 → 1, nine points ahead of the mark rise above the surface and link with
    animated edges into a three-node flow (`client → api → db`), echoing Diagrams' first example.
  - It is the reference footage's plexus, given a meaning.
- **`still`.** For the legal pages and the 404: the still picture only, with no script loaded.

### D6. Scroll, reveals and the motion marker

- **The marker.** The entry script runs only after it has checked `prefers-reduced-motion`. It
  then sets `class="motion"` on `<html>`. Every hidden starting state in `site.css` is scoped under
  `html.motion`, so without the script nothing is ever hidden. `site.test.ts` checks that scoping.
- **Reveals.** `[data-reveal]` elements fade and rise 12 px once, staggered by 60 ms within a
  group.
- **Scroll.** Hero progress comes from `scroll()` with the hero as target and offsets
  `["start start", "end start"]`. It is fed to `sea.setProgress()`.
- **Reduced motion.** The script loads the sea, draws one frame and wires nothing else.

### D7. Building the site

**Choice.** `packages/site` gains `src/` and a `build` script that runs esbuild 0.28.2 (MIT).
- The entry is `src/site.ts`, built to `public/assets/site.js`, with a stable name the pages link.
- Each sea state is a dynamic import, split by esbuild into a hashed `public/assets/chunk-*.js`.
  A page therefore loads its own state only: the budget counts the entry, Motion and that one
  chunk.
- The build also writes `public/assets/sea-<state>.svg` from `stillPicture()`.
- Output is minified ES2022 with no source maps shipped.
- `public/assets/` is ignored by Git. `pnpm -r build` reaches the site, so CI and `deploy.yml`
  build it before they test and upload, with no change to either workflow's build step.

**Caching.** `_headers` gives `/assets/chunk-*` `Cache-Control: public, max-age=31536000,
immutable`, because their names change with their content. `/assets/site.js` and the still
pictures get `max-age=300`.

**Alternatives.**
- **Vite.** A dev server and HTML pipeline we do not need: the pages stay hand-written, and
  `wrangler dev` already serves them.
- **Committing the built files.** Reviewable, but diffs of minified code are noise, and the
  workflows build anyway.

### D8. The policy: `script-src 'self'` and Trusted Types

**The Content-Security-Policy** becomes today's plus two parts (see `specs/product-site`):
- `script-src 'self'`;
- `require-trusted-types-for 'script'; trusted-types 'none'`.

There is no `'unsafe-inline'`, no `'unsafe-eval'`, no `'wasm-unsafe-eval'`, and no other origin.

**Why Trusted Types `'none'` is safe.** No code we ship writes HTML from a string. Text changes go
through `textContent`, and Motion writes styles through the CSSOM, which `style-src 'self'` does
not restrict. Trusted Types `'none'` turns any future `innerHTML` with a string into an error
instead of an opening.

**If a dependency ever needs a sink,** the answer is a single named policy that escapes, never
`'unsafe-*'`. The browser check (D11) listens for `securitypolicyviolation` on every page.

**The pages** link `<script type="module" src="/assets/site.js"></script>` at the end of
`<body>`. Modules are deferred and strict.

### D9. The pause button stores nothing, and its words live in the page

**Markup.** Each animated page carries the button in its own language:

```html
<button class="sea-pause" type="button" aria-pressed="false" hidden
        data-label-pause="Pause animation" data-label-play="Play animation">Pause animation</button>
```

The Spanish pages use "Pausar animación" and "Reanudar animación".

**Behaviour.**
- The script removes `hidden`, because without the script there is nothing to pause.
- It swaps the label from the data attributes, keeping the text in the page's HTML, and toggles
  `aria-pressed`.
- It stops both the sea and Motion's timelines.

**Why no storage.** Remembering the choice would need storage, and the site's privacy promise is
easier kept with none. Reduced motion covers people who never want motion. This meets WCAG 2.2.2
(Pause, Stop, Hide).

**Alternative.** Persisting the choice in `localStorage`. It is a small convenience, but it would
need a sentence on the privacy pages and a test of that sentence.

### D10. Checks in `pnpm test` (Node, no browser, no network)

`site.test.ts` replaces the no-script test with the rule in `specs/product-site`, and adds checks
for:
- the hero's canvas, mark and still picture on every product page;
- `data-sea` agreeing between twins;
- the mark's paths and gradient stops equal to the IDE brand file's;
- the pause button's labels per language;
- hidden states scoped under `html.motion`;
- token-only colours in the hero rules;
- gzipped budgets per page, read from the built `public/assets/` and esbuild's metafile.

The ocean package's tests run in Node:
- the determinism and bounds of the wave function;
- the still pictures (well-formed, size, colour rules, no external reference);
- the mark's placement against a minimal fake element;
- a handle with reduced motion requesting no frame, through injected `requestAnimationFrame` and
  `document` stubs;
- a source scan for network, storage and beacon calls.

### D11. A browser check outside `pnpm test`

**Choice.** `pnpm site:browser` builds the site, starts `wrangler dev` (local assets, no network,
`WRANGLER_SEND_METRICS=false`) and drives the installed Chrome. It uses `playwright-core` 1.63.0
(Apache-2.0), which downloads no browser, the same way Meltemi Diagrams drives the installed Edge
or Chrome. On every page it checks:
- no console error and no CSP violation;
- a non-blank canvas when motion is on;
- frames stop under reduced motion, the pause button, a hidden tab and an off-screen hero;
- the mark keeps the brand's attributes;
- a cumulative layout shift of 0;
- a scheme switch recolours the sea;
- a complete page with JavaScript off.

`ci.yml` gains a `browser` job on `ubuntu-latest`, where Chrome is installed.

**Why outside `pnpm test`.** Vitest stays fast and free of browsers on the Windows and Node 22
matrix.

### D12. Publishing `@meltemi/ocean`

- `release.yml` keeps `v*` for `@meltemi/identity` and adds `ocean-v*` for `@meltemi/ocean`.
- `scripts/release-tag.mjs` gains a prefix argument, so `ocean-v0.1.0` must name
  `packages/ocean/package.json`'s `0.1.0`.
- It publishes with provenance through the same job shape, skipping versions npm already has.
- The first version is `0.1.0`. Trusted publishing replaces the npm token in the `delivery`
  change, as it does for identity.

### D13. The contract for products

The package README is the contract Diagrams' sister change consumes. It covers:
- **The API:**
  - `createSea(canvas, options)` returns a `Sea` handle, with `renderer`, `state`, `frames`,
    `figures`, `start`, `stop`, `setProgress`, `setWind`, `restyle`, `resize` and `destroy`.
    `restyle()` re-reads `--sea-*`, so a page with its own scheme switch (the Diagrams
    playground has one) can recolour the sea without a media query;
  - `heightAt` and `slopeAt`;
  - `stillPicture(state)`;
  - `STATES`.
- **The colours** it reads from the canvas's computed style: `--sea-bg`, `--sea-point`,
  `--sea-crest` and `--sea-wind`, falling back to the brand's values.
- **What it never does:** network, storage, telemetry, dependencies.

On the site, `site.css` defines those four properties from the existing tokens for both schemes.
`docs/repositories.md` gains a sixth crossing that points at the README.

### D14. Decision 0006 and the project context

- `docs/decisions/0006-site-in-motion.md` records the owner's decision of 2026-10-28, what it
  amends in decision 0003 ("no JavaScript in pages"), the policy that replaces it, and the
  alternatives (D1, D2).
- `openspec/config.yaml`'s context changes "no JavaScript in pages" to "same-origin module scripts
  only (decision 0006)".
- `packages/site/README.md` loses "No framework, no build step, no JavaScript".

## Risks / Trade-offs

- **Battery and GPU on weak devices.** Mitigations:
  - the device pixel ratio is capped at 2 (1.5 on coarse pointers);
  - the number of points follows the hero's area;
  - after the first 90 frames, a p95 frame time above 20 ms halves the points;
  - no frames are drawn off-screen or in a hidden tab;
  - reduced motion and the pause button stop everything.
- **Motion sickness.** Mitigations: wave amplitude is bounded per state, there is no parallax of
  the page itself, and the reduced-motion and pause rules are checked in a real browser.
- **Supply chain of a runtime dependency.** Mitigations: Motion is pinned to a release older than
  two weeks, locked, bundled and served from the site with no CDN. Its updates follow the
  workspace's dependency review.
- **Trusted Types `'none'` breaking a dependency.** The browser check catches any violation before
  merge. The fallback is a named escaping policy (D8).
- **The brand diluted by the scene.** Mitigations:
  - the mark keeps its exact paths and its clear space;
  - the sails of `ide` are plain triangles, never the mark;
  - the owner signs off the look in both themes before the change is archived (tasks).
- **Largest Contentful Paint.** The hero's text paints first. The module is deferred, and the
  canvas fades in over the still picture after its first frame.
- **A blank canvas on an unexpected GPU.** The canvas is only shown after a frame is confirmed;
  until then the still picture stays.

## Rollout

Merging to `main` builds and deploys the site through `deploy.yml`, as today. Reverting the merge
deploys the previous site. The `ocean-v0.1.0` tag that publishes the package is pushed by the
owner after the merge, and the Diagrams sister change depends on that published version.

## Open Questions

- The exact wave constants and colours per state, tuned on screen during implementation within
  the bounds the tests pin.
- Whether the 404 page gets a small calm sea instead of the still picture alone. It is a one-line
  change of its `data-sea` state.
