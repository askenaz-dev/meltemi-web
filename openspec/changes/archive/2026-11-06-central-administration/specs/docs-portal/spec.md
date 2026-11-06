## ADDED Requirements

### Requirement: Visible authorized administration access
The documentation header SHALL offer account navigation and a clearly labelled Administration
entry only after a live owner session is confirmed. The entry SHALL open the central `/admin/`
workspace in the page's language and remain usable on mobile. Anonymous and ordinary signed-in
visitors SHALL not see an administrative entry.

#### Scenario: Owner reads documentation
- **WHEN** the header confirms a live family-owner session
- **THEN** it shows Administration and personal account navigation without requiring a memorized URL

#### Scenario: Ordinary user or anonymous visitor
- **WHEN** the visitor is signed out or has no family-owner role
- **THEN** the header offers the appropriate account action but no visible Administration entry

### Requirement: Private navigation discovery
Personal navigation SHALL use a same-origin, private/no-store response derived from a freshly
verified identity session. Public guide HTML and search assets SHALL contain no user's profile
or role. Only the necessary session cookie SHALL reach the fixed identity navigation service;
question text, Authorization, IP and unrelated browser headers SHALL not be forwarded.

#### Scenario: Shared guide cache
- **WHEN** an owner and an anonymous visitor load the same cached guide
- **THEN** its HTML remains identical and only the owner's private navigation can display admin access

#### Scenario: Revocation or service failure
- **WHEN** authorization is revoked, a response is malformed or the identity service is unavailable
- **THEN** the client clears prior privileged navigation and retains usable guides, search and
  a generic account link
