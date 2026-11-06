# docs-ask Specification

## Purpose
"Ask the docs": a question answered from the portal's own pages by a Worker route, with the passages' pages as sources, its limits, its privacy and what it says when it cannot answer.

## Requirements

### Requirement: A question answered from the pages

`POST /api/ask` with JSON `{ question, lang }` (1 to 500 characters; `en` or `es`) SHALL rank up to
eight seed passages, complete bounded context from their selected pages, and ask the model to
answer in the question's language from that context only, citing `[n]`. It SHALL return
`{ answer, sources: [{ n, title, url, lang }] }`; invalid input SHALL return `400` with a reason.

#### Scenario: A question with sources

- **WHEN** the fixture index holds the Stories and Player pages and the question is "How do I
  export a story as a video?" with the fake model
- **THEN** the answer carries `[1]` and `sources[0]` is the Stories page with its portal URL

#### Scenario: Nothing in the docs

- **WHEN** the passages found score below the threshold
- **THEN** the answer says the documentation does not cover the question and `sources` is empty

#### Scenario: A question too long

- **WHEN** the question has 501 characters
- **THEN** the route answers `400` naming the limit and calls neither the embedder nor the model

### Requirement: The index in the assets
The index SHALL be one file in the portal's assets holding, per passage, its page's section,
title, URL and language, its text, a sign-bit vector and an int8 vector of the embedding model
named in its header; the Worker SHALL load it once per isolate, rank by the sign bits and
rescore the best fifty by the int8 vectors, and SHALL refuse an index whose model is not its
own with `503`.

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
- **THEN** the build SHALL retain those cached current passages and omit uncached passages;
  their current pages and citations remain in the index, and complete guides and search still build

### Requirement: Limits and the allowance
The route SHALL limit each address to ten questions a minute (`429` beyond), SHALL answer `503`
with `reason: "allowance"` when Workers AI refuses the embedding or the answer, and the dialog
SHALL then say the answers are paused for today and offer the search.

#### Scenario: Over the limit
- **WHEN** the fake limiter says no
- **THEN** the route answers `429` and calls neither the embedder nor the model

#### Scenario: The allowance spent
- **WHEN** the fake model throws the allowance error
- **THEN** the route answers `503` with `reason: "allowance"` and the dialog shows the
  allowance sentence with a link to the search

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

### Requirement: Citation numbers match the source list

The Ask dialog SHALL preserve each returned source's `n` in the displayed ordered source list.
The list item and the answer's `[n]` link SHALL identify the same source, including when the
returned numbers are nonconsecutive.

#### Scenario: Filtered sources leave a gap

- **WHEN** an answer returns sources numbered `[1, 2, 3, 4, 6, 7]`
- **THEN** the English and Spanish source lists display those numbers without renumbering
- **AND** every citation and source-list link retain the matching destination

### Requirement: Answer the requested operation

The answering instructions SHALL require the specific operation requested by the reader.
Session sign-out, unlinking a sign-in provider and deleting an account SHALL be described as
distinct operations. A destructive operation SHALL not be offered as a substitute for another
operation or recommended without the reader asking for it.

#### Scenario: Related account passages describe another operation

- **WHEN** the reader asks how to sign out other sessions and retrieved passages describe
  unlinking providers or deleting an account
- **THEN** the answering instructions forbid substituting those operations for session sign-out

#### Scenario: The requested operation has no instructions

- **WHEN** the retrieved passages do not explain the requested operation
- **THEN** the answering instructions require the existing localized not-covered response

### Requirement: Bounded context from selected pages

Context completion SHALL retain unique original hits in rank order and append complete indexed
passages only from their pages. In best-hit page order, atomic completion SHALL require a full
page contribution of at most 6,000 characters and additions fitting a shared 6,000-character
budget, including markers/separators. Other pages retain only original hits; no new page/product
or repeated index is allowed.

#### Scenario: A nearby account action ranks instead of session sign-out

- **WHEN** an unlink or delete passage is ranked but the session-sign-out passage of the same
  small page is outside the top eight
- **THEN** the context includes its missing session instructions without another page or product

#### Scenario: A page is too long or its missing context does not fit

- **WHEN** the full page exceeds its limit or its entire addition exceeds the remaining budget
- **THEN** its original hits remain and no part of its missing context is appended

#### Scenario: Duplicate hits and multiple selected pages

- **WHEN** input hits repeat an index and select multiple pages
- **THEN** original unique hits retain order, additions follow best-hit page order and each index
  appears at most once within the total additional budget

### Requirement: Categorical Ask outcome

HTTP 200 replies SHALL include `X-Meltemi-Ask-Outcome` as `no-match`, `not-covered` or `answered`
according to the existing retrieval, refusal and answer branches. The header SHALL reveal no
question, text, score or identifier and SHALL not alter the response body or error paths.

#### Scenario: Retrieval does not pass its existing gate

- **WHEN** no eligible hit exists or the best hit is below the existing threshold
- **THEN** the unchanged not-covered body has outcome `no-match` and the answer model is not called

#### Scenario: The answer model refuses or returns empty text

- **WHEN** the model returns the not-covered sentence or an empty answer
- **THEN** the unchanged not-covered body has outcome `not-covered`

#### Scenario: An answer survives existing cleanup

- **WHEN** the route returns an answer with its existing sources
- **THEN** its body remains unchanged and its outcome is `answered`
