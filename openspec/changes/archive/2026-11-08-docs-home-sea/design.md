## Context

The portal (`packages/docs`, decision 0007) is a Starlight site whose home is written by
`scripts/home.ts` as MDX. Its sea is two `<img>` of `stillPicture("home")`, written by
`scripts/build.ts` into `media/` in the site's colours. The product site (`packages/site`,
decision 0006) plays the same state in motion: a canvas under the still picture, the lead mark
and five boats placed by `createSea`, a wind canvas, a pause button, and the still picture
hidden only once the sea has drawn (`html.sea`). The portal's policy allows scripts from its own
origin and the hashes of Starlight's inline scripts; `assetsInlineLimit: 0` keeps every script a
file.

## Goals / Non-Goals

**Goals:** the portal's home sea moves like meltemi.dev's, degrades to the still picture, can be
paused, and costs nothing under reduced motion.

**Non-Goals:** the site's scroll-driven progress and its page-wide wind; seas on other portal
pages.

## Decisions

### D1. A component and a module, the still picture kept

`src/components/HomeSea.astro` writes the block: the two still pictures, the sea's canvas, the
wind's canvas, the lead mark (the brand's two paths, `MARK_M`, `MARK_HULL`, `MARK_GRADIENT`) and
`fleetSize("home") - 1` boats that `<use>` them, all in an `aria-hidden` stage, and the pause
button outside it, `hidden` until the sea plays. Its `<script>` imports `src/scripts/home-sea.ts`,
which Astro bundles into `/_astro/`. `home.ts` writes `<HomeSea lang=… />` where the two `<img>`
were. The component takes `lang` from the home, so the button's words come from the typed
catalogs (`home.seaPause`, `home.seaPlay`).

Alternative: raw HTML in the MDX and a script in `public/`. Rejected: it would bypass the
bundler's hashing and the catalogs.

### D2. Continuous motion with a pause, as on the site

The sea keeps moving while it is in view, as meltemi.dev's does, with a pause button (WCAG 2.2.2)
and no frames out of view (an `IntersectionObserver`) or in a hidden tab (the package already
requests none then). Alternative: play to rest within 5 seconds, as Meltemi Diagrams' web app
does. Rejected for the portal: the owner asked for meltemi's animation, and the home is a landing
surface, not a work surface where motion would distract. Recommendation: continuous, paused on
request.

### D3. Progress at rest, no scroll

The sea starts and stays at `restProgress("home")`, the progress the still picture is drawn at,
so the first frame takes the picture's place without a jump. Alternative: the site's
scroll-driven progress with `motion`'s `scroll()`. Rejected: it adds a dependency to the portal
for a block that sits under the hero, mostly in view.

### D4. The ocean from its source, loaded on demand

`home-sea.ts` reads `prefers-reduced-motion` first and, unless motion is reduced, imports
`../../../ocean/src/index.js` dynamically, so its code is a separate same-origin chunk fetched
only when it plays. The build scripts already import the package's source this way; no
dependency entry is added and the package need not be built first.

### D5. Colours from the portal's tokens

`portal.css` gives `.portal-sea` the `--sea-point`, `--sea-crest` and `--sea-wind` of each scheme
from the tokens the still pictures use (`stillColours`: light `--mel-aegean`, `--mel-wind`,
`--accent`; dark `--accent`, `--mel-wind`, `--info`). The module calls `restyle()` when
Starlight's `data-theme` changes (a `MutationObserver` on the root) and when the system's scheme
changes.

### D6. The swap and the failure path

`start()` draws the first frame at once; when the sea's `frames` is still 0 (no WebGL2 and no
Canvas 2D), the module destroys both handles and leaves the page as it was. Otherwise it marks
the block `is-playing`: CSS hides the still pictures and shows the canvases and boats, and the
button appears. `window.meltemiDocsSea` exposes read-only `renderer`, `frames`, `paused` and
`figures` for the browser check.

## Testing

Unit tests (`pnpm test`, Node, no browser): the home's MDX holds `<HomeSea>` in both languages;
the built home holds the stage, both canvases, six marks, the hidden button with both words and
no new inline script. The browser check (`pnpm docs:browser`, Chrome on this machine, nothing
beyond `127.0.0.1`) adds `homeSea`: frames drawn and still hidden at 1280 px, the Spanish button
at 375 px without horizontal scroll, pause and resume, no frames out of view, reduced motion with
no ocean chunk requested, and the dark scheme's `--sea-point` after the theme switch.

## Risks / Trade-offs

- A WebGL loop on a documentation home costs a phone's battery while it is in view → the pause
  button, no frames out of view or in a hidden tab, and none at all under reduced motion.
- The home's chunk grows by the ocean's code (about 9 KB gzipped) → loaded after the page, only
  when it plays.
