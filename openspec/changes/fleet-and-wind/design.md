# Design — fleet-and-wind

## Context

`site-in-motion` shipped one mark placed on the sea by its transform, the IDE's sails as
triangles drawn in the canvas, short wind streaks drawn in the hero's canvas, and a labelled pause
button. `compose()` builds one frame as a pure function; `createSea()` owns the loop and places
the mark. The owner's review asks for a fleet of marks sailing on their own, a wind that lives
across the page and looks like wind, and a quieter button.

## Goals / Non-Goals

- Goals: the fleet, the page-wide wind, the icon button, with the same policy, the same budgets'
  spirit (a little more weight is accepted) and the same accessibility (reduced motion, pause,
  nothing stored).
- Non-goals: a library for the wind (D2), a 3D sea, a different sea.

## Decisions

### D1. The fleet is placed, like the mark was

**Choice.** `createSea` takes `fleet: MarkElement[]`, the lead first. Each element is a copy of
the mark: the lead is the inline mark with the brand's two paths; the others are
`<svg class="sea-boat"><use href="#sea-mark-m"/><use href="#sea-mark-hull"/></svg>`, so the
brand's paths exist once in the page and every boat is exactly the mark. The package writes each
element's `transform` only: `translate(x, y) scale(s) rotate(a)`, the keel on the wave at the
boat's depth, the scale from the depth (the lead at 1, the farthest at about 0.35), the heel at
most 6 degrees. `fleetSize(state)` says how many a state sails; the page carries that many.

**Why.** The spec's "placed, never redrawn" rule keeps the mark the brand's; `<use>` keeps the
page honest (one shape, checked against the brand file) and cheap.

**Alternative rejected.** Drawing the marks in WebGL from a rasterised texture: the brand
becomes a bitmap, the gradient a texture, and placing them accessibly is harder.

### D2. The fleet sails on its own; the scroll freshens the wind

**Choice.** Each boat has a world x, a depth z and a speed. Every frame, x advances with the
wind: `(0.045 + 0.11 · wind)` world units per second, so perspective makes the far boats slower
on screen. A boat whose screen box has left the right edge re-enters from the left at a new
depth, behind the others, so the loop never ends and never piles up. The scroll through the hero
maps to the wind (0.6 → 1) as before; it no longer tows the lead. The lead starts where the still
picture rests it (`restProgress`), so the intro draws it where it will sail from.

**Why.** "Moverse hacia la derecha con otros barcos en bucle infinito" is the ask. The scroll
keeps a role the browser check can read (the wind), without fighting the sailing.

### D3. The wind is the wind-map technique, in the package, with no library

**Choice.** `createWind(canvas, { reducedMotion, strength })` on Canvas 2D: a few hundred to a
thousand particles (by area, capped) carried by a flow whose angle is the gust (−19°) bent by
simplex noise of position and slow time, at a speed that also breathes with the noise. Each
frame fades the canvas slightly (`destination-out`) and strokes each particle's step, so the
trails persist and fade: the look of wind maps. The canvas is drawn at 1 device pixel per CSS
pixel (trails are soft), full viewport, `position: fixed` behind the page, with
`pointer-events: none`. The colour is `--sea-wind` of the canvas, at a low alpha; `restyle()`
re-reads it. The loop stops while the document is hidden and with the pause. Under reduced
motion it draws one frame: static streamlines integrated along the field. The simplex noise is
the public-domain algorithm, about sixty lines, with tests of range and determinism.

**Why.** The owner asked for "una librería más pro". The professional look of wind is a
technique, not a library: particles on a smooth field with persistent fading trails. The
libraries considered ship none of it: `three.js` (MIT, ~150 KB gzipped) is a 3D scene graph
and would still need this code as a shader; `tsParticles` (MIT) draws generic particles, not a
flow; `anime.js`/`motion` tween values. Writing the sixty lines keeps the package free of
dependencies, as its contract promises.

**Alternative kept open.** If the owner prefers a library after seeing the result, `three.js`
with a GPGPU particle pass is the one that scales to tens of thousands of particles; it would
end the no-dependency promise and the 45 KB budget.

### D4. The wind sits behind the whole page

**Choice.** `<canvas class="wind" aria-hidden="true">` is the first child of `<body>`, fixed and
full-viewport at `z-index: 0`; the header, the hero, the main and the footer sit above it
(`position: relative; z-index: 1`). Cards keep their opaque surfaces, so the wind flows between
them; text on the page's background sits over faint trails. The hero's sea canvas is transparent,
so the wind shows through the sea's sky. The wind canvas is sized to the viewport on resize.

### D5. The pause button is an icon

**Choice.** 36 px square, bottom-right of the hero, an inline SVG glyph (two bars, or a
triangle when paused) and the words in `aria-label` and `title`, swapped with the state, from
the page's `data-label-*` attributes. `aria-pressed` as before. It stops and resumes the sea and
the wind within a frame. The spec keeps "labelled" through `aria-label`.

### D6. The still pictures carry the fleet

**Choice.** `stillPicture` defines the mark once in `<defs>` (the two paths and the gradient,
from `mark-shape.ts`) and places each boat with `<use transform="translate(…) scale(…)">`, at
the fleet's rest positions, deterministically. The wind in the stills becomes a few streamlines
from the same field. The 30 KB budget holds: a `<use>` is about seventy bytes.

### D8. The owner's round (2026-10-28)

Seen in production: "a veces se queda sin barcos", the water reads less than the wind, words with
no surface behind them fight the trails, and the boats could answer the wind more. So:

- fleets of six, nine and five (from four, seven and three), and a boat that leaves re-enters just
  off the left edge, pushed left only as far as another boat's box forces, so the hero is never
  empty;
- the sea's points a little larger (3.3 px at the near row, from 2.6), the wind's trails at 0.32
  alpha (from 0.5), sparser (8000 px² per particle, from 6000) and shorter (0.95 retained per frame,
  from 0.955);
- the wind's canvas masked to 55% behind the column where the words are, full at the margins;
- the boats surge and ease with gusts (a slow noise over the hero multiplies their pace by 0.7 to
  1.3), sail faster with the scroll's wind (`0.14 + 0.2 · wind`), and heel up to 6 degrees.

### D7. Checks

- `pnpm test`: boats per state and their `<use>` references; the wind canvas on every moving
  page and none on a still page; the button's `aria-label` per language and no text; the stills
  with `<use>`; `.wind` fixed; the mark's constants equal the brand file.
- `pnpm site:browser`: the lead's x grows over one second with no scroll; a boat re-enters
  within a bounded time (simulated by reading `figures.boats` and positions); the wind rises
  with the scroll; the wind canvas is not blank; no wind frame while hidden or paused; the
  pause through `aria-label`.

## Modules and interfaces

- `@meltemi/ocean`: `createSea(canvas, { state, fleet?, reducedMotion?, progress?, wind? })`;
  `createWind(canvas, { reducedMotion?, strength?, density? })` → `Wind` (`frames`, `strength`,
  `start`, `stop`, `setStrength`, `restyle`, `resize`, `destroy`); `fleetSize(state)`;
  `MARK_M`, `MARK_HULL`, `MARK_GRADIENT`; `placeMark` with `scale`.
- Everything runs locally; the package tests inject `requestAnimationFrame`, the document and
  a recording 2D context, as before.
