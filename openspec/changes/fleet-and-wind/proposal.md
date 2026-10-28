# fleet-and-wind

> Sister of `site-in-motion`, which it amends before archive. It comes from the owner's review of
> the live site on 2026-10-28, after the first sea was deployed.

## Why

The owner read meltemi.dev with the sea on it and asked for four things:

- **The fleet is the brand.** The IDE's following sails are plain triangles, so the home shows
  one boat and the IDE page shows one boat and five shapes that are not Meltemi. Every boat
  should be the Meltemi mark, and the home should sail a fleet too.
- **The fleet sails.** The mark moves only with the scroll: at the top of a page it bobs in
  place. The boats should sail to the right on their own, in a loop that never ends, and the
  scroll should freshen the wind rather than tow the boat.
- **The wind looks drawn.** Short straight streaks at one angle read as rigid and amateur, and
  they live only in the hero: the rest of the page is still. The wind should be the living thing
  of the whole page: smooth streams that bend and fade, flowing behind every section.
- **The pause button is loud.** A labelled button in the hero's corner takes more room than the
  thing it pauses. It should be a small icon.

## What Changes

- **A fleet of marks.** `@meltemi/ocean` places a fleet of elements, all copies of the mark
  (`<use>` of the one inline mark), on the sea: the lead boat nearest, the others farther and
  smaller, all sailing to the right and re-entering from the left when they leave, forever.
  Every state has a fleet (`home` 4, `ide` 7, `diagrams` 3); the IDE's triangle sails and the
  scroll-driven crossing go. The scroll through the hero freshens the wind, which speeds the
  fleet. The still pictures carry the fleet at rest.
- **A wind across the page.** `createWind(canvas, options)` draws wind on a canvas that covers
  the whole viewport, fixed behind the page: particles carried by a smooth, time-varying flow
  (simplex noise, written in the package) that leave trails which fade, the technique of wind
  maps. It takes the wind's colour from `--sea-wind`, draws no frame while the tab is hidden,
  draws one static frame of streamlines under reduced motion, and stops with the pause button.
  Every moving page carries it; the still pages carry no script and no wind.
- **An icon-only pause button.** The button keeps its words in `aria-label` (English and
  Spanish) and shows a pause or a play glyph, 36 px square, in the hero's corner. It pauses
  the sea and the wind together.
- **The checks follow.** `pnpm test` checks the boats on every moving page (count by state,
  copies of the mark), the wind canvas, the button's label, the stills; `pnpm site:browser`
  checks that the fleet sails on its own, that the wind rises with the scroll, that the wind
  layer draws and stops, and the pause through `aria-label`.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `site-motion`: the fleet on every hero, the wind across every moving page, the fleet sailing
  on its own with the scroll freshening the wind, the icon pause button, the stills with the
  fleet, the wind layer's frame budget.
- `ocean-package`: `createSea` takes a fleet; `createWind` on a surface; the still pictures
  carry the fleet; the mark's shape as exported constants.

## Impact

- `packages/ocean/src/{states,compose,sea,mark,still,wind,index}.ts`, new `fleet.ts`,
  `noise.ts`, `mark-shape.ts`; the package tests and README.
- `packages/site/src/site.ts`, `public/site.css`, the twelve moving pages (boats, the wind
  canvas, the button), `test/site.test.ts`, `scripts/browser.ts`.
- No new dependency: the noise is written in the package (the public-domain simplex algorithm).
- `playground-sea` in Meltemi Diagrams consumes `createSea` and reads the README when it is
  implemented; the package is unpublished, so no version changes.

## Non-goals

- The Diagrams playground's own sea: `playground-sea` in the Diagrams repository.
- Publishing `@meltemi/ocean`: the tag is the owner's (`site-in-motion`, delivery).
