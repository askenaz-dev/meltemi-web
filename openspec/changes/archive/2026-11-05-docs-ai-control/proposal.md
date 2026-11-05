# Proposal

## Why

The documentation's AI currently has no operational stop control. The owner wants to keep it
active on Workers Free and be able to stop it quickly without taking guides or search offline.

## What Changes

- Add an owner-only documentation AI control to the existing Meltemi account administration.
- Persist its state across deployments, initially enabled, without adding credentials or services.
- Block question embeddings, generated answers and new build embeddings while disabled; fail
  closed when the state cannot be verified.
- Explain the paused state in English and Spanish while preserving guides and browser search.

## Capabilities

### New Capabilities

- `docs-ai-control`: authenticated administration, persistent operational state and enforcement
  across runtime questions and documentation builds.

### Modified Capabilities

- `docs-ask`: describe non-personal control reads without forwarding questions or answers.

## Impact

`packages/identity` gains a settings row and administrative routes. `packages/docs` gains runtime
and build guards and paused-state UI. The deployment binds the docs Worker to identity. Existing
sessions and product authentication contracts stay unchanged. There are no new dependencies.

## Non-goals

Meltemi Diagrams' product administration, data and local Docker runtime belong to
`meltemi-diagrams`; this control affects only the shared documentation portal.
