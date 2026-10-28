# @meltemi/ocean

The Meltemi family's sea in motion: a field of points rising and falling in waves, the Etesian
wind blowing the way the mark's gust points, and the Meltemi mark sailing on them. It draws with
WebGL2, falls back to Canvas 2D, and gives still pictures for pages where nothing moves.

This README is the contract for every product that wears the sea (meltemi.dev, the Diagrams
playground). The package is specified by the `ocean-package` capability of
[Meltemi Web](https://github.com/askenaz-dev/meltemi-web) (change `site-in-motion`, decision 0006).

## What it never does

- **No network.** No `fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon`; a test scans the
  sources for them.
- **No storage.** No cookie, `localStorage`, `sessionStorage` or `indexedDB`.
- **No telemetry.** It counts frames for its own adaptive quality and reports nothing anywhere.
- **No dependency.** It is plain TypeScript built to ES2022 modules, Apache-2.0.
- **No change to the mark.** Given the mark's element, it only writes its CSS `transform`.

## The states

| State      | What it draws                                                                    |
| ---------- | -------------------------------------------------------------------------------- |
| `home`     | The crossing: the mark sails from 18% to 82% of the width as progress grows.     |
| `ide`      | One heading, many sails: five sails follow the mark and line up on its heading.  |
| `diagrams` | The wind draws: nine points lift out of the sea and link into a three-node flow. |
| `still`    | A calm sea, drawn once.                                                          |

`STATES` lists them. An unknown state is an error that names the option and the value.
`restProgress(state)` is the progress where a state tells its story without motion: the still
pictures are drawn there, and a page that does not move draws its one frame there.

## Drawing a sea

```ts
import { createSea } from "@meltemi/ocean";

const sea = createSea(canvas, {
  state: "home", // one of STATES
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  progress: 0, // scroll progress through the hero, 0 to 1
  wind: 0.6, // wind strength, 0 to 1
  mark: markElement, // optional: placed on the sea by its transform only
});
sea.start();
```

`createSea(canvas, options)` returns a `Sea` handle:

| Member             | Meaning                                                                              |
| ------------------ | ------------------------------------------------------------------------------------ |
| `renderer`         | `"webgl2"`, `"2d"`, or `"none"` when the canvas has neither context.                 |
| `state`            | The state it draws.                                                                  |
| `frames`           | How many frames it has drawn.                                                        |
| `figures`          | What the last frame drew: `sails`, `links`, the sails' `spread`, the mark's `markX`. |
| `progress`, `wind` | The values it draws with.                                                            |
| `quality`          | `"high"`, or `"low"` after slow frames halved the lattice.                           |
| `start()`          | Starts the loop; a reduced or `still` sea draws one frame and no loop.               |
| `stop()`           | Stops the loop; the last frame stays.                                                |
| `setProgress(p)`   | Takes a scroll progress between 0 and 1; anything else throws, naming it.            |
| `setWind(s)`       | Takes a wind strength between 0 and 1.                                               |
| `restyle()`        | Re-reads the `--sea-*` colours; the next frame uses them.                            |
| `resize()`         | Re-reads the canvas's size.                                                          |
| `destroy()`        | Stops and releases the context's programs and buffers.                               |

The loop never requests an animation frame under reduced motion, while the document is hidden or
while the canvas is out of view. It caps the device pixel ratio at 2 (1.5 on a coarse pointer),
and halves the lattice when the 95th percentile of the first 90 frames is slower than 20 ms.

## Colours

The sea reads four CSS custom properties from the canvas's computed style. Define them from your
own tokens, for each of your schemes:

| Property      | Paints                                              | Brand fallback |
| ------------- | --------------------------------------------------- | -------------- |
| `--sea-point` | the sea's points, in troughs                        | `#2563eb`      |
| `--sea-crest` | the points on the crests                            | `#22d3ee`      |
| `--sea-wind`  | the wind and the links                              | `#22d3ee`      |
| `--sea-bg`    | read for completeness; the canvas stays transparent | transparent    |

Call `restyle()` when your page changes scheme. A page that follows `prefers-color-scheme` calls it
on the media query's change, and a page with its own switch calls it from the switch.

## The mark

Pass the mark's element as `mark`. Its keel sits on the wave beneath it, at the depth the sea
places it, and it tilts with the slope, by at most `MAX_TILT` (4) degrees. The package writes
`style.transform` and nothing else. Give the element `transform-origin: 50% 86%` so it pivots on
its keel. `placeMark(element, placement)` is the same placement, exported for pages that position
the mark themselves.

## The sea as a function

`heightAt(x, z, t, state)` and `slopeAt(x, z, t, state)` are the sea's height and its slope along
x, as pure functions of position, time and state. `declaredAmplitude(state)` bounds the height. The
renderers, the mark's placement and the still pictures all use them.

## Still pictures

`stillPicture(state, { scheme, colours })` returns the state at rest as an SVG string of at most
30 KB, for `scheme: "light"` or `"dark"`, in the `point`, `crest` and `wind` colours given (the
brand's when missing, `BRAND_STILL`). Its colours are attributes: it has no `<style>`, no script
and no reference to another file, so no page policy blocks it. Serve one file per scheme and let
the page choose:

```html
<picture>
  <source srcset="/assets/sea-home-dark.svg" media="(prefers-color-scheme: dark)" />
  <img src="/assets/sea-home-light.svg" alt="" />
</picture>
```

## Publishing

A tag `ocean-v<x.y.z>` naming this package's version publishes it to npm with provenance from
Meltemi Web's release workflow, skipping a version npm already has.
