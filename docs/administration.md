# Use administration

[Español](es/administration.md)

The [administration workspace](https://id.meltemi.dev/admin/?lang=en) is for service owners and
people invited to administer Diagrams. It shows the sections your current role permits. For
ordinary account settings, use [your account guide](account.md).

## Open the workspace

Sign in with the Meltemi account that holds your role. Open **Administration** from the product's
account menu, or use the link above. Service owners also see **Administration** in the documentation
header after their account is confirmed.

Check **Diagrams environment** before changing product data: **Production** affects the live
service; **Staging** is its separate test environment. Roles, invitations, permissions,
sponsorships, publications and activity belong to the selected environment. Personal account
settings are shared, and the documentation AI control is global.

## Roles and invitations

Open [Roles and invitations](https://id.meltemi.dev/admin/diagrams/access?lang=en).

- Owners can invite administrators, revoke pending invitations and remove administrative roles.
- Administrators can leave their own role with **Leave administration**.
- An invited person can accept or decline the invitation after signing in with the invited,
  verified email.

To invite someone, enter their email and choose **Invite administrator**. No invitation email is
sent: ask the person to open the administration workspace. Invitations expire after seven days.
The page supports up to twenty administrators and ten pending invitations. Removing a role
requires the confirmation shown in the form.

## Account permissions and sponsorships

In [Account permissions](https://id.meltemi.dev/admin/diagrams/permissions?lang=en), enter the exact
account ID, Meltemi handle or verified email and choose **Find account**. Check the resolved person
before choosing **Grant permission** or **Revoke explicit grant**. If several accounts share an
email, ask the person for their account ID.

**Explicit grant** and **Effective access** are different: owners and administrators already
receive Diagrams permissions through their role. Revoking an explicit grant does not remove that
role's access.

Use [Sponsorships](https://id.meltemi.dev/admin/diagrams/sponsorships?lang=en) to review recent
sponsorship records. For an unclaimed sponsorship, resolve the Meltemi account supplied by the
person before granting a permission. A GitHub login may differ from a Meltemi handle. Cancelling
a sponsorship keeps an existing export permission; manage permission changes separately.

## Moderate a publication

1. Open [Publication moderation](https://id.meltemi.dev/admin/diagrams/publications?lang=en).
2. Enter the publication's exact address or its `handle/slug` on the publication host shown.
3. Add a reason if needed, check the confirmation and choose **Remove publication**.

This addresses one publication rather than a directory of published pages. Its owner sees that
the service removed it. Check the selected environment and address before confirming.

[Recent activity](https://id.meltemi.dev/admin/diagrams/activity?lang=en) shows the latest fifty
recorded administrative actions, including invitations, permission changes and publication
removals.

## Pause or enable documentation AI

Service owners can open [Documentation AI](https://id.meltemi.dev/admin/docs-ai?lang=en), also
labelled **AI answers** in the workspace navigation. A Diagrams administrator role alone does not
grant this control.

Choose **Pause answers** or **Enable answers** and check the saved state. Pausing stops new AI
work; requests already running may finish. The state survives deployments. It applies to the
documentation portal in every environment, regardless of the Diagrams environment selector.

The guides and page search remain available while answers are paused or unavailable. This control
does not configure the models used by external coding agents or by local Diagrams assistance.

## If an action does not work

If Diagrams cannot be reached, use **Try again**. Account settings and the documentation AI
control can remain available while the product is unavailable. If a form cannot be verified,
reload the page and retry; check the current state before submitting the action again.

If a section is missing or an address says **Not found**, check which account is signed in and
whether its administrative role is still active. Signing in does not grant an administrative
role by itself.
