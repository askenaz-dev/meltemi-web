## Purpose

Provide one coherent authenticated administration workspace for Meltemi's shared service and
product controls, retaining the authoritative permission rules of each product.

## ADDED Requirements

### Requirement: One central workspace
`/admin/` SHALL provide a responsive EN/ES application with product navigation, an account menu,
current-section context and real service state. Owners SHALL have family-wide access. Product
administrators and invitees SHALL access only their authorized product operations. Ordinary users
SHALL retain personal account access without receiving administrative controls.

#### Scenario: Owner orientation
- **WHEN** a live owner opens `/admin/`
- **THEN** the central workspace offers Docs controls, integrated Diagrams administration and
  personal account settings in one consistent navigation

#### Scenario: Ordinary or revoked session
- **WHEN** a non-administrator or revoked session requests an administrative operation
- **THEN** access is refused without exposing protected product data or changing state

### Requirement: Existing product operations are integrated
The central application SHALL render and execute Diagrams administrator/invitation management,
exact account resolution, permission grants/revocations, sponsorship records, publication takedown
and recent activity using the product's authoritative operations. Lists and entitlements SHALL be
labelled according to their actual coverage and source.

#### Scenario: Product administrator manages a grant
- **WHEN** an authorized administrator resolves an exact account and saves an explicit permission
- **THEN** the product validates the target, changes the stored grant and records its audit event

#### Scenario: Ambiguous account or implicit role entitlement
- **WHEN** account resolution is ambiguous or a requested permission is already implied by a role
- **THEN** the application reports the ambiguity or role-derived entitlement without presenting a
  stored flag as the complete effective access

#### Scenario: Bounded product records
- **WHEN** the product returns its latest fifty sponsorship or audit records
- **THEN** the central view identifies that bounded coverage rather than implying a complete history

### Requirement: Private product authority
Product administration SHALL use a private service capability with a freshly verified user session,
fixed product destination and bounded allowlisted operations. The product SHALL enforce its own
roles, target validation and audit. Browser navigation or caller-supplied role, origin or account
headers MUST NOT authorize an operation.

#### Scenario: Trusted central operation
- **WHEN** identity submits an authorized action through the private service
- **THEN** Diagrams executes the existing operation with the verified user's authority and audit

#### Scenario: Forged or exposed transport
- **WHEN** a request has a forged/revoked token, unsupported method/path or public adapter URL
- **THEN** it cannot execute a product administrative operation

### Requirement: Browser action protection
Central browser mutations and private account lookups MUST require a live cookie session, exact
identity Origin, valid session-bound CSRF and explicit validated action/target. Sensitive inputs
and product responses SHALL NOT appear in URLs, logs or shared caches. Destructive operations
SHALL require an explicit confirmation.

#### Scenario: Valid owner form
- **WHEN** an owner submits a valid invitation or confirmed moderation form
- **THEN** the application acknowledges success only after the authoritative service succeeds

#### Scenario: Invalid or stale form
- **WHEN** the Origin, CSRF, session, target, confirmation or supplied fields are invalid
- **THEN** the request is refused without calling a mutation on the product

### Requirement: Explicit product environment isolation
The workspace SHALL identify the selected hosted Diagrams environment and offer explicit
production/staging navigation. Each environment SHALL use its own fixed service binding,
origin, live roles and product data. Forms and navigation SHALL preserve the validated
environment. Invalid or duplicate environment selections MUST fail closed before a private call.

#### Scenario: Staging administration
- **WHEN** an authorized person opens the staging product administration entry
- **THEN** the central workspace labels staging and reads or modifies only staging data

#### Scenario: Missing staging service
- **WHEN** staging is selected but its binding or service is unavailable
- **THEN** the workspace shows unavailability without falling back to production

### Requirement: Independent service failure
A missing, unavailable or malformed product service SHALL produce a clear retryable error and
SHALL NOT look like an empty successful list or saved action. Personal account pages and owner
Docs controls SHALL remain usable when Diagrams is unavailable.

#### Scenario: Product outage
- **WHEN** the private Diagrams service fails or returns invalid data
- **THEN** its section shows unavailability while account and documentation settings remain usable

### Requirement: Accessible family application
The application SHALL use Meltemi's canonical brand and tokens, clear section navigation, visible
focus, semantic controls and responsive layouts. Account disclosures and administrative forms
SHALL work with keyboard input and without JavaScript. Reduced-motion users SHALL receive no
ornamental motion, and long identities SHALL not hide primary actions.

#### Scenario: Narrow keyboard viewport
- **WHEN** an owner navigates the account menu and a wide product list at mobile width or zoom
- **THEN** the section, identity, focused control and primary action remain accessible
