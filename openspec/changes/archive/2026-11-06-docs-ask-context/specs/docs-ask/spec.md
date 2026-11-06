## MODIFIED Requirements

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

## ADDED Requirements

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
