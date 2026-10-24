## Context

`/ide/agents/` and `/es/ide/agents/` end their list of agents with a section, `<section
aria-labelledby="model">`, titled "Your own model" and "Tu propio modelo". It says that Meltemi
keeps no catalog of models and has no engine of its own yet, that a model of your own comes today
through an agent of the fleet that talks to local and self-hosted providers by its own
configuration, and it links the guide in the IDE repository with the recipes.

The text came from the IDE's `guia-modelos-locales`, which also wrote a test for it in the IDE's
site lint. That lint left with `site/`. What stayed behind is the text, not the guard.

## Goals / Non-Goals

**Goals**: a requirement that says what the section must keep, and checks that fail when a page
edit breaks it.

**Non-Goals**: changing the pages, checking the guide's address over the network, a rule on
third-party names for the whole site.

## Decisions

### The section is found by its landmark

The checks look for exactly one `<section aria-labelledby="model">` in each page and read up to
its `</section>`. The landmark is what the IDE's lint used, and it keeps the checks off the rest
of the page, which is allowed to name the agents of the fleet in the places where it does.

### The sentence is checked by its claim, not by its wording

The section must say that the engine of its own does not exist yet: "has no engine of its own
yet" in English, "todavía no tiene motor propio" in Spanish. The rest of the sentence can be
reworded without touching the checks. The claim is the part that must not be dropped when the
engine ships, and removing it then is a decision for that change, which edits this requirement.

### The names that must stay out

The list is the IDE lint's (Claude, Codex, Copilot, Gemini, Cursor, OpenAI, Anthropic, VS Code,
JetBrains, Aider, OpenCode) plus the three providers the guide itself names (Ollama, LiteLLM,
OpenRouter). The guide may name them: they are interoperability data. The section that links it
may not, because on a product page they would read as endorsements. Names are matched as whole
words, ignoring case. The list is closed; a new recipe in the guide that names another provider
adds it here.

### The guide's address points at `main`

`https://github.com/askenaz-dev/meltemi/blob/main/docs/local-models.md` follows the IDE's current
guide, which is what a visitor wants: a guide pinned to a release would age with it. The cost is a
rename or a move of the file in the IDE, which would leave a dead link that these checks cannot
see because they use no network. A rename of the guide is therefore a change in both repositories.

## Risks / Trade-offs

- **A dead link after a rename in the IDE.** Accepted for the reason above. The IDE's own test of
  the guide (`local_models_guide.rs`) names the file, so a rename there fails first, and the person
  making it finds this requirement by searching for the address.
- **A closed list of names ages.** It ages in the safe direction: a vendor not listed passes until
  someone adds it.
