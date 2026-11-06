# User-facing documentation

## Why

The public portal currently turns every Markdown file under `docs/` into a guide. Architecture
decisions and internal QA reports crowd the navigation, page search and Ask the docs. Readers
need instructions for using Meltemi, including a clear route to the Diagrams AI and agent guides.

## What changes

- Publish product guides while keeping decisions, implementation plans and internal evidence in
  their source repositories. Apply the same audience boundary in both languages and all modes.
- Resolve links to excluded material to GitHub at the source revision, preserving references.
- Improve the Diagrams AI guides in the Diagrams repository; this portal consumes their release.

## Capabilities

Modified: `docs-sources` (which Markdown sources become public guides).

## Dependencies

No new dependency.

## Non-goals

The Diagrams repository owns the product's AI, skill and MCP capabilities and their guide text.
Production publication follows the existing delivery workflows.
