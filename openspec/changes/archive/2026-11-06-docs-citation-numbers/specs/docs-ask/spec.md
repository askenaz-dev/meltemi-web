## ADDED Requirements

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
