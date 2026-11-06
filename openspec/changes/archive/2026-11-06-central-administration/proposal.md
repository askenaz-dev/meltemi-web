# Proposal

## Why

The documentation AI control is an isolated form, while account settings and Diagrams
administration live in separate interfaces. The owner wants one professional administration
workspace at `id.meltemi.dev/admin/`, including the actual product controls, with an obvious
owner-only entry from documentation.

## What Changes

- Create a shared application shell with product navigation, an account menu and EN/ES layouts.
- Integrate Diagrams administration inside the central workspace: administrators, invitations,
  account permissions, sponsorships, publication moderation and recent activity.
- Incorporate the documentation AI control while preserving its saved state and owner gate.
- Add durable personal display-name, theme and language settings; retain linked identities,
  live sessions and account deletion in the same application experience.
- Add a cache-safe account menu and owner-only Administration entry to the documentation header.
- Coordinate a private Diagrams administration service and removal of its separate hosted panel.

## Capabilities

### New Capabilities

- `central-administration`: one authenticated application for family and product administration,
  real operations, scoped permissions and clear service failures.
- `account-personalization`: durable personal display name and application appearance/language,
  independent from provider refresh and isolated between accounts.

### Modified Capabilities

- `docs-portal`: discoverable owner administration and personal account navigation without
  putting private state in cached guide HTML.
- `docs-ai-control`: the existing owner control participates in the central application.

## Impact

`packages/identity` gains the application shell, preferences storage, navigation response and
private product-service client. `packages/docs` gains header navigation and a same-origin proxy.
The coordinated `meltemi-diagrams` change provides its private administration entrypoint and
consolidates hosted navigation. Existing session claim names and authentication protocols remain
unchanged. There are no new dependencies, paid services or credentials.

## Non-goals

Product data and authorization remain in `meltemi-diagrams`; the local IDE and local Docker
workspace keep their existing local operation. Platform credentials, DNS and publishing
infrastructure remain owned by the repositories' delivery/IaC systems.
