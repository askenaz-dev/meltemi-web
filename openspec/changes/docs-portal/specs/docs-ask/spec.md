# Spec Delta

## Purpose
"Ask the docs": a question answered from the portal's own pages by a Worker route, with the passages' pages as sources, its limits, its privacy and what it says when it cannot answer.

## ADDED Requirements

### Requirement: A question answered from the pages
`POST /api/ask` with JSON `{ question, lang }` (1 to 500 characters; `en` or `es`) SHALL find
the eight passages of the index closest to the question, ask the model to answer in the
question's language from those passages only, citing them as `[n]`, and answer `{ answer,
sources: [{ n, title, url, lang }] }` with the pages the passages come from; anything else in
the body SHALL be `400` with a reason.

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
The index SHALL be one file in the portal's assets holding, per passage, its section, title,
URL, language, first 300 characters, a sign-bit vector and an int8 vector of the embedding
model named in its header; the Worker SHALL load it once per isolate, rank by the sign bits and
rescore the best fifty by the int8 vectors, and SHALL refuse an index whose model is not its
own with `503`.

#### Scenario: Ranking under the limit
- **WHEN** ten thousand fake passages are ranked in the test
- **THEN** the eight returned are the ones with the highest int8 scores among the fifty best by
  sign bits, in under 5 ms

#### Scenario: Another model's index
- **WHEN** the index header names a model the Worker does not know
- **THEN** the route answers `503` with `reason: "index"` and the dialog offers the search

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
AI for the embedding and the answer; the privacy notice SHALL say so.

#### Scenario: No logging
- **WHEN** the route runs with a spying `console`
- **THEN** no call carries the question's text

#### Scenario: Only the AI binding is called
- **WHEN** the route runs with fakes that record every call
- **THEN** the calls are one embedding and one answer, and no fetch to any other host
