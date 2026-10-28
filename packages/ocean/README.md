# @meltemi/ocean

The Meltemi family's sea in motion: a field of points rising and falling in waves, a fleet of
Meltemi marks sailing on them, and the Etesian wind blowing across the page the way the mark's
gust points. It draws with WebGL2 and Canvas 2D, falls back to Canvas 2D, and gives still pictures
for pages where nothing moves.

This README is the contract for every product that wears the sea (meltemi.dev, the Diagrams
playground). The package is specified by the `ocean-package` capability of
[Meltemi Web](https://github.com/askenaz-dev/meltemi-web) (changes `site-in-motion` and
`fleet-and-wind`, decision 0006).

## What it never does

- **No network.** No `fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon`; a test scans the
  sources for them.
- **No storage.** No cookie, `localStorage`, `sessionStorage` or `indexedDB`.
- **No telemetry.** It counts frames for its own adaptive quality and reports nothing anywhere.
- **No dependency.** It is plain TypeScript built to ES2022 modules, Apache-2.0. The noise the
  wind bends with is the public-domain simplex algorithm, written here.
- **No change to the mark.** Given the fleet's elements, it only writes their CSS `transform`.

## The states

| State      | What it draws                                                                      |
| ---------- | ---------------------------------------------------------------------------------- |
| `home`     | The crossing: a fleet of six marks sailing to the right, the lead nearest.         |
| `ide`      | One heading, many sails: a fleet of nine.                                          |
| `diagrams` | The wind draws: a fleet of five, and nine points that link into a three-node flow. |
| `still`    | A calm sea with one boat, drawn once.                                              |

`STATES` lists them. An unknown state is an error that names the option and the value.
`fleetSize(state)` is how many boats a state sails, the lead included: a page carries that many
elements. `restProgress(state)` is the progress where a state tells its story without motion:
the still pictures are drawn there, and a page that does not move draws its one frame there.

## Drawing a sea

```ts
import { createSea } from "@meltemi/ocean";

const sea = createSea(canvas, {
  state: "home", // one of STATES
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  progress: 0, // scroll progress through the hero, 0 to 1: the Diagrams flow forms with it
  wind: 0.6, // wind strength, 0 to 1: the fleet sails faster in a fresher wind
  fleet: [leadElement, ...boatElements], // optional: placed on the sea by their transform only
});
sea.start();
```

`createSea(canvas, options)` returns a `Sea` handle:

| Member             | Meaning                                                                            |
| ------------------ | ---------------------------------------------------------------------------------- |
| `renderer`         | `"webgl2"`, `"2d"`, or `"none"` when the canvas has neither context.               |
| `state`            | The state it draws.                                                                |
| `frames`           | How many frames it has drawn.                                                      |
| `figures`          | What the last frame drew: `boats`, the lead's `leadX`, every boat's `xs`, `links`. |
| `progress`, `wind` | The values it draws with.                                                          |
| `quality`          | `"high"`, or `"low"` after slow frames halved the lattice.                         |
| `start()`          | Starts the loop; a reduced or `still` sea draws one frame and no loop.             |
| `stop()`           | Stops the loop; the last frame stays.                                              |
| `setProgress(p)`   | Takes a scroll progress between 0 and 1; anything else throws, naming it.          |
| `setWind(s)`       | Takes a wind strength between 0 and 1.                                             |
| `restyle()`        | Re-reads the `--sea-*` colours; the next frame uses them.                          |
| `resize()`         | Re-reads the canvas's size.                                                        |
| `destroy()`        | Stops and releases the context's programs and buffers.                             |

The loop never requests an animation frame under reduced motion, while the document is hidden or
while the canvas is out of view. It caps the device pixel ratio at 2 (1.5 on a coarse pointer),
and halves the lattice when the 95th percentile of the first 90 frames is slower than 20 ms.

## The fleet

Every boat is the Meltemi mark. Give the lead as an element that holds the brand's two paths, and
every other boat as an element that uses them (`<use href="#…">`), so the brand's shape exists
once in the page. The package writes each element's `transform` and nothing else: a translation
that puts its keel on the wave at its depth, a scale from the depth (the lead at 1, the farthest
at about 0.35) and a heel of at most `MAX_TILT` (6) degrees; gusts make every boat surge and
ease on its way. Give the elements
`transform-origin: 50% 86%` so they pivot on the keel. The fleet sails to the right on its own;
a boat that leaves the right edge re-enters from the left, behind every other, at a new depth.
`placeMark(element, placement)` is the same placement, exported for pages that position boats
themselves. The mark's own shape is exported as `MARK_M`, `MARK_HULL`, `MARK_STROKE`, `MARK_BOX`
and `MARK_GRADIENT`, equal to the IDE's brand file.

## The wind

```ts
import { createWind } from "@meltemi/ocean";

const wind = createWind(windCanvas, {
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  strength: 0.6, // 0 to 1
});
wind.start();
```

`createWind(canvas, options)` returns a `Wind` handle. The wind draws on a canvas that covers
whatever surface you give it, with Canvas 2D at one
device pixel per CSS pixel: particles carried by a smooth flow, the gust bent by noise of
position and slow time, leaving trails that persist and fade, the way wind maps draw wind. Put
the canvas behind the page (`position: fixed; inset: 0; pointer-events: none`) and the wind
blows across every section. The handle: `renderer` (`"2d"` or `"none"`), `frames`, `strength`,
`particles`, `start()`, `stop()`, `setStrength(s)` (0 to 1, else it throws), `restyle()` (re-reads
`--sea-wind`), `resize()` and `destroy()`. Under reduced motion it draws one frame of static
streamlines and requests no animation frame; while the document is hidden it requests none.

## Colours

The sea reads four CSS custom properties from the canvas's computed style. Define them from your
own tokens, for each of your schemes:

| Property      | Paints                                              | Brand fallback |
| ------------- | --------------------------------------------------- | -------------- |
| `--sea-point` | the sea's points, in troughs                        | `#2563eb`      |
| `--sea-crest` | the points on the crests                            | `#22d3ee`      |
| `--sea-wind`  | the wind's trails and the Diagrams links            | `#22d3ee`      |
| `--sea-bg`    | read for completeness; the canvas stays transparent | transparent    |

Call `restyle()` on the sea and the wind when your page changes scheme. A page that follows
`prefers-color-scheme` calls them on the media query's change, and a page with its own switch
calls them from the switch.

## The sea as a function

`heightAt(x, z, t, state)` and `slopeAt(x, z, t, state)` are the sea's height and its slope along
x, as pure functions of position, time and state. `declaredAmplitude(state)` bounds the height. The
renderers, the fleet's placement and the still pictures all use them.

## Still pictures

`stillPicture(state, { scheme, colours })` returns the state at rest as an SVG string of at most
30 KB, for `scheme: "light"` or `"dark"`, in the `point`, `crest` and `wind` colours given (the
brand's when missing, `BRAND_STILL`), with the state's fleet (the mark defined once, used once per
boat) and a few streamlines of the wind. Its colours are attributes: it has no `<style>`, no
script and no reference to another file, so no page policy blocks it. Serve one file per scheme
and let the page choose:

```html
<picture>
  <source srcset="/assets/sea-home-dark.svg" media="(prefers-color-scheme: dark)" />
  <img src="/assets/sea-home-light.svg" alt="" />
</picture>
```

## Publishing

A tag `ocean-v<x.y.z>` naming this package's version publishes it to npm with provenance from
Meltemi Web's release workflow, skipping a version npm already has.
