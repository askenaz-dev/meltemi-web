## MODIFIED Requirements

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
