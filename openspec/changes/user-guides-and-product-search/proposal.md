## Why

The portal still exposes repository-oriented overviews and mixed internal/user instructions.
Several IDE guides have only one genuine language version. Search and Ask also mix products,
so a reader using Diagrams can receive unrelated IDE or account instructions.

## What Changes

- Audit all published guides, retain product tasks and public references, and keep implementation
  and operator evidence in GitHub. Publish real English/Spanish user indexes and guide pairs.
- Scope search and Ask to the current product by default. The portal home searches all products.
  Both dialogs expose a translated scope selector so readers can choose another product or all.
- Tag indexed pages with their product and filter retrieval before candidate selection, rather
  than hiding unrelated results after retrieval.
- Support explicit `docs/en/` and `docs/es/` translations alongside mixed-language canonical IDE
  paths, preserving correct locale links and legacy one-language notices for older sources.

## Capabilities

- Modified: `docs-sources`, `docs-portal`, `docs-ask`.

## Dependencies

No new dependency. Reuse the installed Pagefind 1.6.0 index and its bundled Default UI (MIT),
Astro/Starlight and the existing Workers AI index.

## Non-goals

Product runtime features, foundational policy ratification and native client localization belong
to the IDE and Diagrams repositories. Their guide edits accompany this portal change in their
own repositories. Production publishing follows the existing delivery workflows.
