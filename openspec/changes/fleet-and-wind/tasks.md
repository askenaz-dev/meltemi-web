# Tasks — fleet-and-wind

One commit per task, referencing `(fleet-and-wind N.M)`. Gates at every task: `pnpm typecheck`,
`pnpm lint`, `pnpm test`. No new dependency.

## 1. The package

- [x] 1.1 `mark-shape.ts` (the brand's paths and gradient as constants) and `noise.ts` (2D simplex
  noise, deterministic, in −1..1), with tests; `fleetSize(state)` and the fleet per state in
  `states.ts`; `placeMark` with a scale. Verify the tests, and that the site's test can compare the
  constants with `media/meltemi-mark-gradient.svg`.
- [x] 1.2 `fleet.ts`: boats with a depth, a speed and a world x, advanced by the wind, re-entering
  from the left at a new depth behind the others; `compose` drops the triangle sails and the
  streaks, places the fleet and anchors the Diagrams flow to the hero's middle; `createSea` takes
  `fleet`, sails it and reports `figures.boats` and each boat's x. Verify the scenarios "Sailing the
  fleet", "The fleet loops" and "Bad options".
- [x] 1.3 `wind.ts`: `createWind` on Canvas 2D with persistent fading trails, the noise flow, the
  strength, reduced motion (one static frame), hidden document, restyle, resize, destroy. Verify
  the scenarios "Trails that persist and fade", "One frame under reduced motion" and "A strength
  outside the range".
- [x] 1.4 `still.ts`: the fleet as one `<defs>` mark and one `<use>` per boat, streamlines from the
  wind's field; README and `index.ts`. Verify every state in both schemes stays under 30 KB.

## 2. The site

- [x] 2.1 The pages: the wind canvas first in `<body>`, the boats as `<use>` of the lead mark's
  paths (as many as the state sails), the icon pause button with `aria-label`; `site.css`: the
  fixed wind layer behind the page, `.sea-boat`, the 36 px button. Verify the tests of boats,
  wind canvas, button and layering.
- [x] 2.2 `site.ts`: the wind layer, the fleet, the scroll feeding the wind only, the pause for both,
  restyle for both, `window.meltemiSea` with boats and the wind's frames. Verify under
  `pnpm site:dev` on every moving page.
- [x] 2.3 `scripts/browser.ts`: the fleet sailing on its own and looping, the wind rising with the
  scroll, the wind canvas drawn and idle when hidden or paused, the pause through `aria-label`.
  Verify `pnpm site:browser` passes, and record the weights here.


  Weights on 2026-10-28, gzipped: the entry 5.1 KB and the sea's chunk 9.9 KB, 15 KB per moving
  page of the 45 KB budget; the still pictures 25–27 KB of 30 KB. `pnpm site:browser` passes its
  nine checks in Chromium 153.
## 3. Sign-off

- [x] 3.1 Owner: the fleet, the wind and the button on `home`, `ide` and `diagrams`, both themes.
  Seen in production on 2026-10-28: "kudos, te quedó genial", with four adjustments (design D8).
- [x] 3.2 The owner's round: fleets of six, nine and five that re-enter at the edge; the sea's
  points up and the wind's trails down, sparser and shorter; the wind masked behind the column;
  boats that surge with gusts, sail faster with the wind and heel to 6 degrees. Verify the
  package and site tests, `pnpm site:browser`, and the owner's second look.
- [x] 3.3 The owner's third look (design D9): the wind cleared every frame, each particle drawing
  its own short streak that appears, travels a range and fades, sparser. Verify the scenario
  "Trails that fade and never pile up", the package and site tests, `pnpm site:browser`, the share
  of the wind canvas painted staying flat over 90 s, and the owner's look in production.
