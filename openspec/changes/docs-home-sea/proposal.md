## Why

The owner opened docs.meltemi.dev on a phone and found the family's sea standing still: the home
shows `@meltemi/ocean`'s still picture, two SVG files, on every width and in both schemes. The
product site at meltemi.dev plays the same sea in motion, with the fleet of Meltemi marks sailing
on it, so the portal reads as a different family member. The still picture was a deliberate
first step of the portal, and it remains the right fallback.

## What Changes

- The home's sea plays like meltemi.dev's home: the `home` state's waves drawn by `createSea`,
  its six marks sailing, and the wind's streamlines, in the portal's own `--sea-*` colours of the
  scheme the reader chose.
- The still picture stays in the page and gives way only once the sea has drawn a frame; without
  a script, without WebGL2 or Canvas 2D, or under reduced motion it is what the reader sees, and
  under reduced motion the sea's code is never fetched.
- A pause button, in English and Spanish, stops and restarts the motion; the sea also stops while
  it is out of view or the tab is hidden.
- The theme picker and the system's scheme recolour the moving sea at once.
- The browser check and the unit tests cover the moving sea, its pause, reduced motion, the
  schemes and a phone's width. The portal's README describes it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `docs-portal`: the home's sea in motion, with its fallback, pause and schemes.

## Non-goals

The products' own pages and their seas stay in their repositories (Meltemi Diagrams' web app has
its own, `playground-sea`). Deployment, DNS and headers' delivery belong to the delivery change;
this change sends no new header and no request beyond the portal's origin.

## Dependencies

None new. The portal already builds its still pictures from `packages/ocean` (Apache-2.0, this
repository's own package); the page's script now bundles the same source.
