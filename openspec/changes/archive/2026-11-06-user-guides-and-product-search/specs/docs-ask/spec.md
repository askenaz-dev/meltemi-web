## ADDED Requirements

### Requirement: Ask follows the selected product
Ask SHALL initially use the page's product, or all products on the portal home, with a labelled
scope selector. Changing scope SHALL cancel an
in-flight answer and clear stale results while preserving the typed question.

#### Scenario: The reader changes product while an answer is pending
- **WHEN** the reader selects another product before the response arrives
- **THEN** the question remains, pending work is cancelled and its stale answer stays hidden

### Requirement: Retrieval enforces the requested product
The endpoint SHALL accept an optional section of diagrams/ide/web; omission SHALL retain global
retrieval. Other section values SHALL return 400 before a model call. Candidate ranking and all
answer sources SHALL be restricted to that section before selecting the closest passages,
without fallback to other products.

#### Scenario: Better-ranked passages belong to another product
- **WHEN** an IDE question is requested with section diagrams
- **THEN** only Diagrams passages can reach the answering model or its citations

#### Scenario: The chosen product has no relevant passage
- **WHEN** the selected product does not cover the question
- **THEN** the existing not-covered response has no sources and no answer-model call

#### Scenario: Invalid section
- **WHEN** section is null, a list or an unknown name
- **THEN** the endpoint returns 400 and makes no embedding or answer call
