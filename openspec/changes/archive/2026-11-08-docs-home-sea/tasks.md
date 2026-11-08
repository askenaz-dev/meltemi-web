## 1. The block and its words

- [x] 1.1 Add `home.seaPause` and `home.seaPlay` to `src/messages/en.ts` and `es.ts` ("Pause
  animation", "Play animation"; "Pausar animación", "Reanudar animación", as on meltemi.dev).
- [x] 1.2 Write `src/components/HomeSea.astro` (design D1): the stills, both canvases, the lead
  mark and the boats, the hidden pause button, and its `<script>`. Have `scripts/home.ts` write
  `<HomeSea lang=… />` in both homes instead of the two `<img>`.
- [x] 1.3 Give `.portal-sea` its stage, canvases, boats and button in `portal.css`, the `--sea-*`
  colours of both schemes (design D5), and the `is-playing` swap. Verify with the unit tests.

## 2. The motion

- [x] 2.1 Write `src/scripts/home-sea.ts` (designs D2, D3, D4, D6): reduced motion first, the
  dynamic import, `createSea` and `createWind` at rest progress, the swap after a first frame,
  the pause button, stopping out of view, `restyle()` on the theme and the system's scheme, and
  `window.meltemiDocsSea`.

## 3. Tests and docs

- [x] 3.1 Extend `test/portal.test.ts`: the home MDX in both languages, the built block, the
  button's words, no new inline script.
- [x] 3.2 Add the `homeSea` browser check (design, Testing) and run `pnpm docs:browser`.
- [x] 3.3 Describe the moving sea in `packages/docs/README.md`.
- [x] 3.4 Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm docs:browser` and
  `openspec validate docs-home-sea --strict`; record the results in `validation.md`, with
  screenshots of the home in both schemes and at 375 px.
