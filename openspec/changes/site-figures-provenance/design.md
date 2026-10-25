## Context

`/ide/` and `/es/ide/` end with a section of two figures: the terminal client's sessions view as an
SVG and the desktop client's as a PNG. Each has an alt text of about two hundred characters and a
caption that says the surface, that it was captured over a temporary fixture repository with the
simulated agent, the version state ("Meltemi pre-1.0") and the platform. The text came from the
IDE's `sitio-web-producto` and its lint; the lint did not come with it.

## Goals / Non-Goals

**Goals**: the rule the IDE's procedure already states, as checks that fail when a page edit breaks
it, for the figures that exist and the ones to come.

**Non-Goals**: video, the content of the pixels, a weight budget, changing a page.

## Decisions

### A figure is found as a block, and its image is read with the tag reader

The checks cut every `<figure>…</figure>` out of each page (comments removed first) and read its
`<img>` with the same tag reader the other checks use. A figure with no `<img>` fails, which is the
point where the change that embeds a video extends the rule.

### The caption is checked by what it states, per language

Five statements, each a short pattern in English and in Spanish: the surface ("terminal surface",
"desktop surface" / "superficie de terminal", "superficie de escritorio"), the temporary fixture, the
simulated agent, the state of the product ("Meltemi pre-1.0", "Meltemi previo a 1.0" or a version
number) and the platform (Windows, macOS or Linux). The rest of the sentence can be reworded. A
caption that says a version stops saying "pre-1.0" without touching the checks.

### The alt text must be at least forty characters

The two existing alt texts are about two hundred. Forty rules out "screenshot" and "sessions" and
does not dictate wording. It is a floor, not a judgement of whether the text is good.

### A picture with an alt text is a figure

The brand mark and the other decorative images carry `alt=""`, and the checks leave them alone. An
image with a non-empty alt outside a figure fails: if it says something, it has provenance to
declare. The rule is cheap now (no page has one) and expensive to add after a page does.

### The twins are compared by their images, not their captions

A page and its Spanish twin must show the same image files in the same order. The captions are
checked on their own, in their own language, so a comparison between them would only repeat that.

## Risks / Trade-offs

- **A new platform name or surface breaks the patterns.** It fails loudly on the page that adds it,
  and the fix is one line in the checks, in the same change that adds the page.
- **Forty characters is arbitrary.** Accepted: the aim is to refuse the empty gesture, and a higher
  floor would start to dictate prose.
