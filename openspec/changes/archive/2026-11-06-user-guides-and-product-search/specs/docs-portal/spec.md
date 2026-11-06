## ADDED Requirements

### Requirement: Search follows the current product
The portal home in either language SHALL search all user guides in that language. A product page
SHALL initially search only that product. The search dialog SHALL visibly name its scope and
offer all products or a single product, preserving the query when the scope changes. Navigation
to another product SHALL select that route's default. Filtering SHALL constrain Pagefind's
search, not merely hide rendered results. Search SHALL retain keyboard and mobile access.

#### Scenario: The same term belongs to multiple products
- **WHEN** a reader searches for a session on a Diagrams guide
- **THEN** every result belongs to Diagrams until the reader explicitly selects another scope

#### Scenario: Global search
- **WHEN** a reader searches that term on the portal home
- **THEN** matching guides from all products in the reader's language are available

#### Scenario: No result in a product
- **WHEN** a query has matches only outside the selected product
- **THEN** search shows no matching result without widening the scope automatically
