## Visual direction

The sea and page form one calm, continuous surface; spacing and typography organize the
content. The existing sequence remains hero, product explanation, detail and final links.
Motion keeps its current roles: sailing marks, page-wide wind and section reveals; no motion
is added and the existing pause and reduced-motion behavior remain intact.

## Decisions

Remove the `border-bottom` from the shared `.hero` rule in `packages/site/public/site.css`.
The Home, IDE and Diagrams pages and both languages already use that class, as do their
supporting pages, so there is no per-page override or duplicated markup. Preserve padding
and containers. The one-pixel decorative border no longer contributes to hero height.

The sea points currently end abruptly at the same edge. Add a short alpha fade to the
`.sea-canvas` and `.sea-still` drawing layers only, using the existing spacing token. This
works for the animated renderer, reduced motion, and the no-script still image, without
changing the sailing marks, layout or renderer. Retain the stage's upper mask that protects
the hero text. Header/footer chrome, card and table boundaries, button borders and keyboard
focus outlines retain their existing roles.

The alternative of extending the sea across the whole page would change its composition,
scroll behavior and text legibility. The selected change is limited to the offending seam.
No unresolved choices remain.

## Validation and scope

Use existing local unit and browser checks, with no network-dependent tests or downloads.
Preview with `pnpm site:dev`; inspect Home, IDE and Diagrams in EN/ES at desktop and mobile
widths in both schemes. Capture before/after evidence and verify no horizontal overflow,
continuous hero/main geometry, readable controls and successful pause behavior. Existing
browser checks cover reduced motion, no JavaScript, policy, rendering and layout stability.

Web has no application-preferences panel to reorganize into tabs. Its site is static; the
identity service's focused account actions are separate from this visual boundary change.
No public interface or product-consumed identity contract changes.
