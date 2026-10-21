# 0001. One family, three repositories

Status: accepted (owner, 13 October 2026)

## Context

Meltemi is one brand with two products. The Meltemi IDE (Rust; desktop, terminal and a local
daemon) promises no accounts, no cloud service and no telemetry, and serves the product site
from its own `site/` folder through GitHub Pages. Meltemi Diagrams (TypeScript) works without
an account and is adding a hosted service: accounts, projects kept in the cloud, sharing and
collaboration at `diagrams.meltemi.dev`. An account for the family belongs to neither product:
the IDE does not want one, and a second product should not depend on the first.

## Decision

- **Three repositories.** The IDE repository keeps the IDE only. The Diagrams repository keeps
  the diagrams tool and its hosted service. This repository, Meltemi Web, holds the product site
  (`meltemi.dev`) and the shared identity service (`id.meltemi.dev`).
- **The site moves here.** The `product-site` change takes over the IDE's `site/` (the pages,
  their Spanish versions, the styles and the media), restructures it as the family's site with a
  page per product, and serves it from Cloudflare; the IDE repository stops serving it.
- **Contracts, not shared code.** What crosses between repositories is the session contract and
  the deletion events of the identity service, and links. Each product owns its data, API and
  storage. `docs/repositories.md` is the map.
- **Functionality before delivery.** Each repository implements and tests its changes locally
  first. GitHub repositories, pipelines, DNS, production OAuth apps and secrets come after, as
  the delivery change of each repository; the development OAuth apps the local sign-in uses are
  the owner's.
- **Licence.** Apache-2.0, the licence the moved site files carry; the owner confirms before
  the first publication. (Meltemi Diagrams is MIT.)

## Alternatives considered

- **Identity inside the IDE repository.** It serves the site today, but it is a Rust repository
  whose README promises no accounts and no cloud service; a Worker there would contradict both.
- **Identity inside the Diagrams repository.** The first consumer, but then the IDE's site and
  any future product would depend on the diagrams tool's releases.
- **One monorepo for everything.** Different languages (Rust, TypeScript), toolchains and
  release rhythms; the IDE's CI already enforces parity rules of its own.
- **Delivery first.** Repositories and pipelines before the code exists would be set up twice;
  the owner chose to validate the functionality first.

## Consequences

- When the site is served from here (an owner task of the delivery change), the IDE repository
  (`C:\forge\agentic-ide`) removes `site/`, the Pages job of `.github/workflows/release.yml`,
  `core/meltemid/tests/site.rs` and `core/meltemid/tests/scenarios_sitio.rs`, and retargets
  `scripts/capture-desktop.ps1` and `tui/examples/capture_svg.rs`; the token rule of `site.rs`
  becomes `pnpm site:tokens --ide <path>` in this repository.
- Repository names on GitHub are the owner's to confirm; Diagrams' manifests still name
  `meltemi/meltemi-diagrams`.
- The shared cookie makes every host under `meltemi.dev` one site: products check `Origin` on
  state changes and never serve user-authored content under `meltemi.dev`
  (`docs/repositories.md`).
