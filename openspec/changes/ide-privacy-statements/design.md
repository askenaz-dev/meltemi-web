## Context

The section of the notice on the IDE is two short paragraphs. The IDE's promises come from its
constitution: the daemon listens only on a local endpoint with permissions for the user alone and
remote access is an SSH tunnel (§3); agents run with the authentication each one manages and
Meltemi never reads, stores or reuses it (§2); no telemetry (§9). The IDE finds its folders with
the `directories` crate under the project name `meltemi`.

## Goals / Non-Goals

**Goals**: the notice says the three missing things, in both languages, and the checks fail when
a page edit drops one.

**Non-Goals**: the Terms, the sign-in service, Diagrams, and any change to the IDE.

## Decisions

### Three statements in a list, after the existing first paragraph

The existing sentence (no account, no telemetry) stays as it is. The three new statements follow
it as a `<ul>` with one `<li>` each, the markup the page already uses for its lists. A list is what
a reader scanning for "does it open a port" or "where is my data" finds fastest. The paragraph on
the vendors' terms stays last, so the section still ends on the thing the notice does not cover.

### The folders are written out

"In the data folder of your user account" tells nobody where to look or what to delete. The notice
says the folders, as the `directories` crate resolves them for the project name `meltemi`:

| | data | configuration |
|---|---|---|
| Windows | `%APPDATA%\meltemi\data` | `%APPDATA%\meltemi\config` |
| macOS | `~/Library/Application Support/meltemi` | the same folder |
| Linux | `~/.local/share/meltemi` | `~/.config/meltemi` |

The Windows folders were read on a machine that runs the IDE; the other two come from the crate's
documented behaviour for the same call. On Linux the XDG variables move them, which the notice
does not need to say.

### What is kept is described by kind

The data folder holds the logs of the sessions and of the background service, the index of
projects and the context a project subscribes to; the configuration folder holds the settings and
the permission rules. The notice says the kinds, not the file names, because the file names are the
IDE's to change. The project folder `.meltemi` holds the project's specifications and is inside the
repository the user already has.

### The checks read the section and look for the claim

Each page is cut at `<section aria-labelledby="ide">` up to its `</section>`. The statements are
checked by a short fixed phrase per language ("opens no network port" / "no abre ningún puerto de
red"), as the agents page's checks do, so the rest of a sentence can be reworded; the folders are
checked as literal strings, because a wrong folder is the failure that matters. The two dates are
parsed and compared, because the usual mistake in a bilingual page is editing one language.

## Risks / Trade-offs

- **The folders drift if the IDE changes its project name or its crate.** The checks read this
  repository only. Accepted: the IDE's own tests pin its paths, and a change there that moves them
  is a change that must edit this requirement.
- **The macOS and Linux folders were not run here.** They follow from the crate's documentation. If
  the owner or a user finds a difference, the fix is one line in two pages and the requirement does
  not move.
