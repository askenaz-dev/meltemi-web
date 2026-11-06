# docs-ai-control Specification

## Purpose
Let the family owner stop and resume documentation AI without disrupting guides or browser search,
with a persisted choice enforced by question handling and documentation publication.

## Requirements

### Requirement: Owner administration
The system SHALL offer EN/ES documentation AI administration inside the central `/admin/`
application to live cookie sessions whose user is in the family owner allowlist. A state-changing
form MUST have an exact identity-service Origin, a valid session-bound CSRF token and an explicit
boolean state. Other users MUST NOT change it.

#### Scenario: Owner disables AI
- **WHEN** an authorized owner submits the valid disable form
- **THEN** the state is saved and the administration shows AI disabled

#### Scenario: Unauthorized or forged request
- **WHEN** a non-owner, revoked session, bearer-only request, foreign/missing Origin, invalid CSRF
  or non-boolean value attempts a change
- **THEN** the change is refused and the stored state remains unchanged

#### Scenario: Central context
- **WHEN** an owner opens the documentation AI section
- **THEN** it uses the same product/account navigation as the rest of the central application
  and preserves the existing saved AI state

### Requirement: Persistent operational state
The documentation AI state SHALL initially be enabled and SHALL survive deployments. Successful
administrative confirmation MUST follow a successful write. Missing state or a failed read MUST
NOT authorize AI. Public reads SHALL expose only the boolean and SHALL NOT be cached.

#### Scenario: Deployment preserves off
- **WHEN** the owner disabled AI and a new deployment applies its schema
- **THEN** the state remains disabled

#### Scenario: Storage fails
- **WHEN** a state read or write fails
- **THEN** reads cannot enable AI and writes do not show success

### Requirement: Every AI operation is guarded
The portal MUST verify the current state before question embedding and again before answer
generation. Publication MUST verify it before every new embedding batch. Disabled or unverifiable
state SHALL prevent the next AI operation, without a redeploy or an isolate-cached permission.
Calls already started may complete.

#### Scenario: Disable between runtime calls
- **WHEN** an embedding completes and the owner disables AI before answer generation
- **THEN** no answer generation starts and the response reports AI disabled

#### Scenario: Disable between publication batches
- **WHEN** the control turns off after one embedding batch
- **THEN** no subsequent AI batch starts and the build continues without new embeddings

#### Scenario: Unavailable or malformed control
- **WHEN** the binding is missing, times out, fails or returns an invalid state
- **THEN** no subsequent AI operation starts and the failure is reported as control unavailable

### Requirement: Guides and search remain available
Disabling AI SHALL preserve static guides and browser search, including during publication.
Current passages with cached embeddings SHALL remain usable after re-enabling; uncached passages
SHALL be omitted from the AI index while AI is off. The dialog SHALL distinguish an operator stop
or unavailable control from an exhausted daily allowance, in English and Spanish.

#### Scenario: Disabled question
- **WHEN** a reader opens Ask while the owner disabled AI
- **THEN** submitting is disabled and the dialog explains that guides and search remain available

#### Scenario: Re-enable without redeploy
- **WHEN** the owner enables AI again and the reader reopens Ask with an available index
- **THEN** asking is available without a documentation redeploy

#### Scenario: Publish with incomplete cache while off
- **WHEN** new guide passages lack cached vectors and AI is disabled
- **THEN** the complete guides and search publish, current cached passages form the AI index,
  and the build makes no new AI calls
