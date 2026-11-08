# Validation

Recorded on 2026-11-07 on the owner's Windows machine (Chrome 156.0.8078.80), in the worktree
`C:\meltemi\worktrees\web-docs-sea`, branch `docs-home-sea`.

## The moving sea in Chrome (task 3.2)

`pnpm docs:browser` built the fixture, served it with `wrangler dev` on `127.0.0.1` and passed all
19 checks, among them the new one, "the home's sea plays, pauses, rests out of view and follows the
scheme; still under reduced motion":

- `/` at 1280 px, light: the sea drew with WebGL2, the still picture hidden, one sea canvas shown,
  six marks shown and placed, the wind drawing, the button named "Pause animation", and
  `--sea-point` `#2563eb`.
- The button: pressed, named "Play animation", 0 frames in 600 ms; pressed again, frames again.
- Out of view (a 320 px high window scrolled to the end): 0 frames in 600 ms; back in view, frames.
- The theme picker to dark: `--sea-point` `#60a5fa`, the still picture still hidden.
- `/es/` at 375 px, dark: no sideways scroll, the button named "Pausar animación", 44 × 44 px.
- Reduced motion: no sea, one still picture, no mark, no button, and the moving sea's own chunk
  never requested.
- No drawing surface (`getContext` returning `null`) and no script: one still picture, no mark, no
  canvas, no error.

Every other check stayed green, among them "every page is quiet" (no console error, no policy
violation, nothing beyond `127.0.0.1`) and "the headers".

## The build (tasks 1.2, 3.1)

- The home's MDX imports `HomeSea.astro`; the built home in both languages holds the stage, the two
  still pictures, both canvases, six marks (the brand's paths written once), the hidden button with
  both words, and `/_astro/HomeSea….js`.
- The sea's entry is 3459 bytes (1666 gzipped); `@meltemi/ocean` is a chunk of its own, 20215 bytes
  (8352 gzipped), fetched only when the sea plays.
- No inline script mentions the sea; the build lists the same Starlight inline-script hashes.

## Looks

Screenshots in `screenshots/`: the home in dark at 1280 px, the moving sea in light at 1280 px, the
still picture it replaces (reduced motion), and the Spanish home in dark at 375 px. The sea is a
band across the content's width, as the site's hero sea is (it was 640 px wide before, tied to its
height by `aspect-ratio`); the wind is drawn at 45% opacity, as light as the still picture's
streamlines, and the marks are 34 to 76 px.

## Gates (task 3.4)

- `pnpm typecheck`: green.
- `pnpm lint` (ESLint and Prettier): green.
- `pnpm test`: 67 files, 2505 passed, 1 skipped.
- `pnpm docs:browser`: 19 of 19.
- `openspec validate docs-home-sea --strict`: valid.
