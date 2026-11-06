# account-personalization Specification

## Purpose
Let each Meltemi user maintain a personal display name and central application preferences
without losing them during provider sign-in or affecting another account.

## Requirements

### Requirement: Durable personal preferences
Every live user SHALL be able to save a nullable display-name override, theme `system|light|dark`
and language `system|en|es`. Missing preferences SHALL use provider/system defaults. Provider
profile synchronization SHALL preserve overrides, and independent preference writes SHALL not
overwrite each other.

#### Scenario: Provider returns after customization
- **WHEN** a user signs in again after saving a display-name override and appearance
- **THEN** the override and appearance persist while the underlying provider profile can refresh

#### Scenario: Invalid preferences
- **WHEN** a save contains an unsupported enum, oversized/control-containing name or extra fields
- **THEN** it is refused with no stored preference change

#### Scenario: Concurrent independent edits
- **WHEN** a profile-name save and appearance save complete concurrently
- **THEN** both changes survive without either replacing the other's fields

### Requirement: Authenticated personal saves
Profile and appearance saves SHALL require the current live cookie user, identity's own Origin
and a valid session-bound CSRF token. Values MUST be escaped in HTML. Changing a display name
SHALL update the current profile cookie without creating another session or extending its original
issuance or expiry; token claim names remain unchanged.

#### Scenario: Display name update
- **WHEN** a live user saves a valid custom name
- **THEN** the central application reflects it and the reissued token retains SID, iat and exp

#### Scenario: Cross-account or forged save
- **WHEN** another account's CSRF, an expired/revoked session or a foreign Origin submits a save
- **THEN** no preference or session is changed

### Requirement: Explicit language and theme selection
Authenticated central pages SHALL use explicit `?lang` before saved language before browser
language. The validated saved theme SHALL select light, dark or system presentation without an
inline-script permission. Preferences SHALL not silently overwrite a product editor's own options.

#### Scenario: Explicit language overrides preference
- **WHEN** an English-preferring user opens a central page with `?lang=es`
- **THEN** the page and its actions use Spanish

#### Scenario: System appearance
- **WHEN** a user selects the system theme
- **THEN** central pages follow the system color scheme and remain readable in either scheme

### Requirement: Preferences belong to the account lifecycle
Preferences SHALL be isolated by user and deleted in the existing atomic account-deletion
operation. A failed save or deletion SHALL not report success. Deleting personal preferences
SHALL NOT change shared documentation AI state or another user's settings.

#### Scenario: Account deletion
- **WHEN** an account is deleted successfully
- **THEN** its preferences disappear with its sessions and identities, while other preferences
  and the shared AI control retain their values

#### Scenario: Store failure
- **WHEN** storage rejects a preference write or transactional deletion
- **THEN** the application reports failure and does not issue a success redirect or new cookie
