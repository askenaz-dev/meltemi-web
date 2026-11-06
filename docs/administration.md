# Administration and your account

[Español](es/administration.md)

The [Meltemi administration workspace](https://id.meltemi.dev/admin/?lang=en) brings the family's
service controls, authorized Diagrams operations and personal account pages into one application.
Sign in with your existing Meltemi account. Each section and action checks your current access.

## Open it from the documentation

The documentation header always offers **Account**. Signed-in readers get a menu with
**Profile**, **Preferences**, **Account security** and **Sign out**. A confirmed service owner also
sees **Administration** directly in the header, including on a phone. That link opens the central
workspace in the documentation page's language.

Only the exact service-owner identities in `ADMIN_SUBS` see this documentation entry. A Diagrams
administrator or invitee keeps the product access granted by Diagrams; that role does not grant
the owner-only documentation AI control.

The header verifies account navigation through a private, same-origin request. It clears old
privileged navigation before refreshing and after account changes. If verification fails, the
generic Account link remains available while guides and page search continue working.

## Personal account

These pages are available to every signed-in account:

| Page                                                              | What it changes                                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [Profile](https://id.meltemi.dev/account/profile?lang=en)         | Your display-name override. Clearing it restores the name supplied by your sign-in provider.            |
| [Preferences](https://id.meltemi.dev/account/preferences?lang=en) | Appearance (`system`, `light`, `dark`) and language (`system`, `en`, `es`) for the central application. |
| [Account security](https://id.meltemi.dev/account?lang=en)        | Linked sign-in providers, active sessions and the existing account security actions.                    |

Preferences are saved with your account. An explicit language chosen for a page takes precedence
over the saved language; System follows the browser. The documentation reader keeps its own
appearance and language controls, and editor options remain with their respective products.

**Sign out** opens Identity's confirmation page. When opened from the documentation account menu,
it returns to the public guide after confirmation.

## Service and Diagrams operations

Use the **Production** / **Staging** selector to choose the Diagrams environment. Its access,
permissions, sponsorships, publications and recent activity belong to the selected backend;
check that selection before submitting a product change. Personal account settings are shared.
The documentation AI control is global and keeps the same saved state in either selection.

The workspace shows the sections your service-owner status and current Diagrams role permit.
Product changes are handled by Diagrams with its existing permissions and audit records.

| Section                                                                    | Available work                                                                                                              |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [Documentation AI](https://id.meltemi.dev/admin/docs-ai?lang=en)           | Service owners pause or enable new documentation AI work. See [the AI control guide](documentation-ai.md).                  |
| [Access](https://id.meltemi.dev/admin/diagrams/access?lang=en)             | Review administrators and invitations; invite, revoke, accept or decline, remove access or leave as permitted by your role. |
| [Permissions](https://id.meltemi.dev/admin/diagrams/permissions?lang=en)   | Resolve an exact account and inspect or change explicit permission grants. Role-derived entitlement is shown separately.    |
| [Sponsorships](https://id.meltemi.dev/admin/diagrams/sponsorships?lang=en) | Review sponsorship records and resolve unclaimed sponsors before explicitly granting an account permission.                 |
| [Publications](https://id.meltemi.dev/admin/diagrams/publications?lang=en) | Take down a specified published address with an explicit confirmation and reason.                                           |
| [Recent activity](https://id.meltemi.dev/admin/diagrams/activity?lang=en)  | Review the latest fifty administrative audit entries.                                                                       |

Account lookup uses an exact identifier or email; it is not a browsable account directory. Each
form checks the live session, permission for the requested action, Identity's Origin and a
session-bound CSRF token. No API token needs to be created or copied into the browser.

If Diagrams is temporarily unavailable, its section shows a retry state. Personal account pages
and the documentation AI control remain independent of that product connection. The service
displays deployment configuration only when it is supplied by the product.
