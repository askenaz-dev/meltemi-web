# Control documentation AI

[Español](es/documentation-ai.md)

The documentation portal's **Ask the docs** can be paused and enabled without rebuilding or
removing the guides. The control covers new answer requests and new documentation embeddings.

## Pause or enable answers

Open [Documentation AI administration](https://id.meltemi.dev/admin/docs-ai?lang=en) and sign in
with a service owner's Meltemi account. The same page is linked from that owner's account page.
Access is limited to the exact identity `sub`s in the existing `ADMIN_SUBS` allowlist; being an
invited Meltemi Diagrams administrator or moderator grants no access to this control.

Choose **Pause answers** to stop new AI work, or **Enable answers** to allow it again. The page
shows the saved state after the action. The setting is persisted in the identity service's
database and stays paused across deployments until an owner enables it. The server checks a
live session, the owner allowlist, its own Origin and a session-bound CSRF token for each change.

The guides and page search remain available in either state. Requests already sent to the AI
provider may finish after a pause; the switch cannot recall that work.

## Runtime and builds

The documentation Worker reads the control before embedding a question and again before asking
for an answer. Each new batch of build-time embeddings also checks the saved control. A failed,
missing or malformed control response prevents new AI calls.

Builds retain valid cached passages while paused and omit passages that still need a new
embedding. Enabling answers immediately permits queries against the passages in the deployed
index. New or changed passages become available after the next build with AI enabled. If a
paused build has no cached passage, it deploys without the Ask button; enabling alone cannot
create its index, so run an enabled build to restore the button and answers.

These read-only status URLs make no model call:

| URL                                                      | Result                                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [Identity control](https://id.meltemi.dev/api/docs-ai)   | `200` with `{"enabled":true}` or `{"enabled":false}`; an unreadable or missing setting returns a non-200 status.   |
| [Portal status](https://docs.meltemi.dev/api/ask/status) | `200` with the same boolean, or `503` with `{"enabled":false,"reason":"control"}` when the control cannot be read. |

Both responses use `Cache-Control: no-store`. The status reports permission to run AI, not the
availability of indexed passages or the account's remaining allowance. The question endpoint,
`POST /api/ask`, returns `503 {"reason":"disabled"}` when paused and
`503 {"reason":"control"}` when it cannot verify the control. The dialog explains the state and
offers page search.

## Allowance, billing and alerts

The switch does not inspect the Cloudflare plan, track spending or enforce a budget. The
ten-questions-per-minute limit is per IP address and is not a global daily spending limit.

Cloudflare Workers AI includes **10,000 Neurons per day for the account**, shared by model calls
and build-time embeddings, resetting at **00:00 UTC**. On Workers Free, calls beyond the free
allocation fail. On Workers Paid, use above that allocation can incur charges; the saved switch
does not automatically pause when the account's plan changes. Review the current
[Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) and the
account's usage before changing plans.

[Cloudflare budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)
notify you when spending crosses a threshold. An alert does not pause usage or cap charges.

## Other Meltemi uses

This control applies to the hosted documentation portal and its embedding builds. It does not
affect Meltemi Diagrams running locally with Docker Compose, its local MCP server, or the models
used by an external agent such as Claude Code or Codex. Those agents retain their own model
configuration, account and billing.
