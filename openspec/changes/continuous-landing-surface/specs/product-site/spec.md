## ADDED Requirements

### Requirement: Continuous sea-to-content transition

The product site's shared hero SHALL have no decorative bottom divider. Its sea drawing
SHALL blend into the page at its lower edge without changing the layout, sailing marks or
interactive boundaries.

#### Scenario: Family landing pages

- **WHEN** Home, IDE or Diagrams is viewed in English or Spanish, in either color scheme
- **THEN** the hero and first content section share a continuous background without a
  horizontal dividing rule or an abrupt edge in the sea drawing.

#### Scenario: Static and narrow presentations

- **WHEN** motion is reduced, JavaScript is unavailable, or the viewport is narrow
- **THEN** the same transition remains visible and the existing text, links, focus indicators
  and applicable animation controls retain their behavior and readability.
