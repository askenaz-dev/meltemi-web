# 0006. The site in motion: same-origin scripts on the family's pages

Status: accepted (site-in-motion change, 28 October 2026)

## Context

Decision 0003 made the site static assets of a Worker, with "no JavaScript in pages". The
`product-site` change wrote that as a rule: no `<script>` anywhere, and a Content-Security-Policy
with no `script-src`. The site came out quick, safe and still. Meltemi is named after the Etesian,
the summer wind of the Aegean, and its mark is a boat that wind drives, yet nothing on the pages
moves. On 28 October 2026 the owner decided the family's pages should carry the motion a modern
site has, with any JavaScript and CSS that needs, as long as the security of today's policy and
good practice are kept.

## Decision

- **Same-origin module scripts are allowed.** A page may load ES modules that the site itself
  serves from `/assets/`. These are built from `packages/site/src/` by esbuild at build time and
  never committed.
- **Everything else the policy forbade stays forbidden:** inline scripts, inline event handlers,
  `javascript:` addresses, `eval`, and any script, style, font or image from another origin. The
  Content-Security-Policy gains `script-src 'self'` and Trusted Types enforcement
  (`require-trusted-types-for 'script'; trusted-types 'none'`), and nothing else.
- **Motion is progressive.** HTML and CSS carry every word, link and download. The scripts add the
  sea, the wind and the sailing mark, and never hide content without them. Reduced motion, a pause
  button and still pictures keep motion optional.
- **The drawing is a package.** `@meltemi/ocean` (`packages/ocean`, Apache-2.0, no runtime
  dependency) draws the sea with WebGL2 and falls back to Canvas 2D. It is published with
  provenance so Meltemi Diagrams can wear the same sea. The site's choreography (scroll and
  reveals) uses `motion` (MIT), bundled and served from the site.

## Alternatives considered

- **Keep the rule and animate with CSS and SVG only.** No script at all, but a field of thousands
  of points cannot move at frame rate in SVG. The still pictures keep this path for people who
  turn scripts off.
- **A 3D engine (three.js).** Its scene graph, materials and loaders are not needed by a field of
  points, and it costs about three times the whole budget a page has for scripts.
- **anime.js instead of Motion.** It is equally capable for scroll and reveals, but one animation
  library is enough, and the owner named Motion first.
- **A CDN for the libraries.** Faster to start with, but a second origin in `script-src` is a
  dependency on someone else's integrity at run time. Bundling keeps every byte the site serves its
  own.

## Consequences

- `packages/site` gains `src/` and a build step. `pnpm build`, which CI and `deploy.yml` already
  run, writes `public/assets/`, which Git ignores.
- `packages/site/test/site.test.ts` checks the new rule (only `/assets/` module scripts, no inline
  script or handler), the heroes, both languages and the budgets. A browser check under
  `wrangler dev` reports any CSP violation.
- `docs/repositories.md` gains a sixth crossing: the motion package, which products consume as
  they consume `@meltemi/identity`.
