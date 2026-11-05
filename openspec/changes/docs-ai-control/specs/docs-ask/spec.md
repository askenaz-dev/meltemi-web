## MODIFIED Requirements

### Requirement: The index in the assets
The index SHALL be one file in the portal's assets holding, per passage, its page's section,
title, URL and language, its text, a sign-bit vector and an int8 vector of the embedding model
named in its header; the Worker SHALL load it once per isolate, rank by the sign bits and
rescore the best fifty by the int8 vectors, and SHALL refuse an index whose model is not its
own with `503`. When new embeddings are refused, the build SHALL retain valid cached vectors
for current passages and omit uncached passages.

#### Scenario: Ranking under the limit
- **WHEN** ten thousand fake passages are ranked in the test
- **THEN** the eight returned are the ones with the highest int8 scores among the fifty best by
  sign bits, in under 5 ms

#### Scenario: A build without Workers AI
- **WHEN** the build runs with no Cloudflare token or account, or Workers AI refuses the embeddings
  and no valid cached vectors are available
- **THEN** the index holds no passage, the pages carry no Ask button, the portal and its search
  are built, and the route answers `503` with `reason: "allowance"` when the control is enabled

#### Scenario: Another model's index
- **WHEN** the index header names a model the Worker does not know
- **THEN** the route answers `503` with `reason: "index"` and the dialog offers the search

#### Scenario: A partial embedding cache
- **WHEN** new embeddings are refused and current passages have valid cached vectors
- **THEN** those passages remain in the index with their current pages and citations, and the
  complete guides and search still build

### Requirement: Nothing of a question is kept
The route SHALL not log, store or forward the question or the answer anywhere but to Workers
AI for the embedding and the answer; the privacy notice SHALL say so. Operational state reads
SHALL carry neither question/answer text nor session cookies or personal request headers.

#### Scenario: No logging
- **WHEN** the route runs with a spying `console`
- **THEN** no call carries the question's text

#### Scenario: Only the AI binding is called
- **WHEN** the route runs with fakes that record every call
- **THEN** only the AI binding receives one embedding and one answer, and operational reads
  carry only a request for the fixed state endpoint without question or personal data
