## Why

The shared hero's horizontal rule makes the animated sea look like a separate panel above
the page. The owner wants the family landing pages to flow continuously into their content.

## What Changes

- Remove the shared hero's decorative bottom rule.
- Fade only the sea drawing's lower edge into the existing page background, leaving the
  sailing marks and controls fully legible.
- Preserve the current content, spacing, animation, navigation and accessible controls in
  English and Spanish, light and dark schemes, and narrow layouts.

## Capabilities

### Modified Capabilities

- `product-site`: a continuous transition from the sea hero to the landing-page content.

## Impact

`packages/site/public/site.css` only. No new dependency or licence, product interface,
identity contract, runtime script or release workflow changes.

## Non-goals

Application settings and editor panels belong to the IDE and Diagrams repositories.
Publication and infrastructure remain the responsibility of the delivery changes.
