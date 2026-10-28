# Tasks

## 1. The policy, the build and a first sea on the home

- [ ] 1.1 Write `docs/decisions/0006-site-in-motion.md`: the owner's decision of 2026-10-28, what it amends in 0003, the policy that replaces "no JavaScript in pages", and the alternatives of design D1 and D2. Update the context of `openspec/config.yaml` and the opening of `packages/site/README.md` to match. Verify `pnpm lint` passes.
- [ ] 1.2 Add `esbuild` 0.28.2 and `motion` 14.2.0 (pinned) to `packages/site`, with a `build` script that bundles `src/site.ts` into `public/assets/site.js` with code splitting. Add `packages/site/public/assets/` to `.gitignore`. Verify `pnpm build` writes `public/assets/site.js` and `git status` shows no built file.
- [ ] 1.3 Rewrite the policy in `public/_headers`: the CSP of `specs/product-site` (`script-src 'self'`, Trusted Types) and the cache rules for `/assets/` (design D7). Replace the no-script test in `site.test.ts` with the four scenarios of "Self-hosted scripts and no external resource". Verify `pnpm test` passes, and that a page with an inline `<script>`, an `onclick` or a CDN script makes it fail naming the page.
- [ ] 1.4 Scaffold `packages/ocean`: a `package.json` with licence Apache-2.0, no `dependencies`, and `exports` with types; plus `tsconfig.json`, `src/index.ts` and a README skeleton. Add tests for the package's shape and a source scan for `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `document.cookie`, `localStorage`, `sessionStorage` and `indexedDB`. Verify `pnpm typecheck` and `pnpm test` pass, and that a planted `fetch(` fails naming the file.
- [ ] 1.5 Write `heightAt` and `slopeAt` (design D4), with tests for determinism, amplitude bounds and non-finite inputs. Then build a first runnable slice: a WebGL2 point field for `home` behind `createSea`, the home hero in both languages (canvas, `data-sea="home"`, the module script), and `src/site.ts` creating the sea. Verify `pnpm test` passes and `pnpm site:dev` shows a moving sea on `/` and `/es/` with no console error.

## 2. The sea, the wind and the mark in `@meltemi/ocean`

- [ ] 2.1 Wind particles along a flow field toward the mark's gust, fading inside the mark's clear space (design D1, D3). Verify unit tests that the flow points to the upper right and that particles inside the clear-space box have zero opacity.
- [ ] 2.2 The Canvas 2D renderer on the same wave function, and the `renderer: "none"` handle. Verify tests with fake canvases that a canvas without WebGL2 reports `"2d"` and one without any context reports `"none"` and draws nothing.
- [ ] 2.3 The mark's placement: a translation onto the sea's height and a tilt from the slope clamped to 4 degrees, written to `transform` only. Verify the test that runs 10 seconds of simulated time on a fake mark, sees no other attribute change and no rotation above 4 degrees.
- [ ] 2.4 The frame loop:
  - `start` and `stop`;
  - one frame and no loop under `reducedMotion`;
  - no frame while the document is hidden or the canvas is out of view;
  - a device-pixel-ratio cap, and points halved when the p95 frame time exceeds 20 ms.

  Verify the tests with injected `requestAnimationFrame`, `document` and `IntersectionObserver` stubs.
- [ ] 2.5 The states:
  - `ide`: five sails that converge on the mark's heading with progress;
  - `diagrams`: nine points that lift and link into a three-node flow;
  - `still`;
  - the `figures` counts, and option errors that name the option and value.

  Verify tests that the package knows exactly the four states, that `ide` reports at least three sails, that `diagrams` reports links, and that an unknown state or a progress outside 0 to 1 throws.
- [ ] 2.6 `stillPicture(state)`: an SVG of the state at rest, with light and dark rules on `--sea-*` and the brand's values as fallbacks. Verify tests that every state's picture parses, weighs at most 30 KB, and has no `<script>`, `href` or external `url(`.
- [ ] 2.7 Write the package README as the contract for products (design D13), and add the sixth crossing, the motion package, to `docs/repositories.md`. Verify `pnpm lint` passes and every API the README names is exported, checked by a test that imports them.

## 3. The site in motion

- [ ] 3.1 In `site.css`, define:
  - the `--sea-*` properties from the existing tokens for both schemes;
  - the hero layout: canvas behind the text, still picture beneath the canvas, a fixed hero height so nothing shifts;
  - the reveal and pause-button styles, with every hidden state scoped under `html.motion`.

  Verify the new tests that hero rules use tokens only and that no rule hides content outside `html.motion`.
- [ ] 3.2 Put the hero on every product page in both languages: the canvas, the inline mark copied from the IDE's brand file, the still picture `/assets/sea-<state>.svg`, `data-sea`, and the pause button with its labels in the page's language. Give the legal pages and the 404 `data-sea="still"` with their still picture and no script. Have the build write the still pictures. Verify the tests that every product page has its hero, twins declare the same state, the mark's paths and stops equal the brand file's, and the button labels match the language.
- [ ] 3.3 In `src/site.ts`:
  - the `html.motion` marker after the reduced-motion check;
  - Motion's `scroll()` feeding `setProgress` and `setWind`;
  - the intro, drawing the `m` stroke in at most 1.6 seconds and raising the hull;
  - `inView` reveals on `[data-reveal]`;
  - the pause button, stopping the sea and Motion, setting `aria-pressed`, swapping labels and storing nothing;
  - recolouring on a scheme change.

  Verify under `pnpm site:dev` on every product page in both languages.
- [ ] 3.4 The budgets: from esbuild's metafile, a test gzips what each page loads (entry, Motion, its state's chunk) and fails above 45 KB, and fails on a still picture above 30 KB. Verify `pnpm build && pnpm test` passes, and that an oversized fixture fails naming the page and size.

## 4. The browser check

- [ ] 4.1 Add `playwright-core` 1.63.0 and `pnpm site:browser`: build, start `wrangler dev` with `WRANGLER_SEND_METRICS=false`, drive the installed Chrome, and on every page assert no console error and no `securitypolicyviolation`. Verify it passes locally with no network access beyond `localhost`.
- [ ] 4.2 Add the motion checks of `specs/site-motion`:
  - a canvas that is not blank;
  - the mark's attributes after 2 seconds;
  - scroll moving the mark forward and raising the wind on the home;
  - the `ide` sails converging, and the `diagrams` links appearing;
  - no frames under reduced motion, with the mark at rest;
  - the pause button stopping and resuming, with storage and cookies empty;
  - no frames in a hidden tab or with the hero off screen;
  - a layout shift of 0;
  - a scheme switch recolouring the sea;
  - complete pages with JavaScript off.

  Verify `pnpm site:browser` passes.
- [ ] 4.3 Add a `browser` job on `ubuntu-latest` to `ci.yml`, and update `test/workflows.test.ts` for it. Verify `pnpm test` passes and the job is green on the pull request.

## 5. Publishing `@meltemi/ocean`

- [ ] 5.1 Give `scripts/release-tag.mjs` a tag-prefix argument, with tests in `test/scripts.test.ts`. Verify that `ocean-v0.1.0` against version `0.1.0` passes, that `ocean-v0.2.0` against `0.1.0` fails naming both, and that the identity's `v*` behaviour is unchanged.
- [ ] 5.2 Make `release.yml` publish `@meltemi/ocean` with provenance on `ocean-v*`, skipping a version npm already has, and update `test/workflows.test.ts`. Verify `pnpm test` passes.

## 6. Integration and sign-off

- [ ] 6.1 Run the full set: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm site:browser`, `pnpm site:tokens --ide <path to the IDE>` and `openspec validate site-in-motion --strict`. Verify all pass, and record the results here.
- [ ] 6.2 Under `pnpm site:dev`, read every changed page in both languages and both schemes, with motion, with reduced motion, and with JavaScript off. Measure the home with Chrome's Lighthouse on mobile, with performance at 90 or more. Record what was seen and measured here.
- [ ] 6.3 Owner: sign off the look of `home`, `ide` and `diagrams` in both themes (the brand gate), on the pull request's screenshots or a local preview.

## Workflow follow-up

- Archive this change after `product-site` and `delivery`, in the order the other changes follow, so that `product-site` exists in `openspec/specs/` before its requirement is renamed and modified here.
- After the merge, the owner pushes `ocean-v0.1.0`. The sister change in `askenaz-dev/meltemi-diagrams`, which wears the sea on diagrams.meltemi.dev's welcome and setup pages, depends on that published version.
