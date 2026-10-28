## MODIFIED Requirements

### Requirement: A sea, a wind and the mark in every product hero
The hero of the home, of the four IDE pages and of the Diagrams page, in English and Spanish, SHALL
draw a sea of points that rise and fall in waves and a fleet of Meltemi marks sailing on it, and
every one of those pages SHALL draw the wind across its whole viewport, behind its content: streams
that bend and fade, heading toward the upper right (the direction of the mark's gust). The text,
links and buttons of every page SHALL stay in the page's HTML above both drawings.

#### Scenario: The home draws its sea and its wind
- **WHEN** the browser check opens `/` and `/es/` with motion allowed
- **THEN** the hero's canvas has drawn at least one frame that is not blank, the lead mark is visible in the hero, and the wind canvas has drawn trails that are not blank

#### Scenario: A product page without its sea or its wind
- **WHEN** a page among `/`, `/ide/`, `/ide/method/`, `/ide/agents/`, `/ide/downloads/`, `/diagrams/` or their `/es/` twins loses its hero canvas, its wind canvas, its lead mark, a boat of its fleet or its still picture
- **THEN** `pnpm test` fails naming the page and what is missing

### Requirement: The mark is drawn by the wind and stays the brand's
When the page loads, the hero SHALL draw the lead mark's `m` stroke from its start to the north-east tip in at most 1.6 seconds and raise its hull from the sea. Every other boat SHALL be a `<use>` of the lead mark's two paths, so the brand's shape exists once in the page. After the intro, the page SHALL move every boat only by translation, a scale from its depth and a heel of at most 6 degrees, following the wave beneath it, surging and easing with the gusts. The mark's paths and colours SHALL stay those of the IDE's `brand/meltemi-mark-gradient.svg`, with no filter, glow, shadow, mast or wave added.

#### Scenario: The mark after the intro
- **WHEN** the browser check reads the hero's lead mark 2 seconds after load
- **THEN** its path data and gradient stops equal the brand file's, it carries no `filter`, and its transform is a translation, a scale and a rotation of at most 6 degrees

#### Scenario: A mark that drifts from the brand
- **WHEN** a page's lead mark has a path, a gradient stop or a filter that differs from the IDE's brand file, or a boat references anything but the lead mark's paths
- **THEN** `pnpm test` fails naming the page and the difference

### Requirement: Each page has its own sea state
Each page SHALL declare one sea state and draw it, each with a fleet of marks sailing to the right and re-entering from the left, forever:
- `home`: a fleet of six, the lead nearest.
- `ide`: "one heading, many sails": a fleet of nine.
- `diagrams`: a fleet of five, and points of the sea that lift and link into nodes and edges forming a small flow diagram.
- `still`: no motion, for the legal pages and the 404: the still picture with its one boat at rest.

A page and its Spanish twin SHALL declare the same state, and a page SHALL carry exactly the boats its state sails.

#### Scenario: The IDE page's fleet
- **WHEN** the browser check opens `/ide/` and waits 2 seconds without scrolling
- **THEN** the drawing reports the `ide` state with nine boats, and every boat's horizontal position has grown

#### Scenario: The fleet loops
- **WHEN** the browser check reads a boat's position on `/`, then reads it again after the boat has left the right edge
- **THEN** the boat has re-entered from the left of the hero

#### Scenario: An unknown or mismatched state, or a short fleet
- **WHEN** a page declares a state outside `home`, `ide`, `diagrams` and `still`, declares a state different from its twin's, or carries fewer or more boats than its state sails
- **THEN** `pnpm test` fails naming the page and the state or the count

### Requirement: Scroll sails the boat
The fleet SHALL sail on its own. While the hero is in view, the page's scroll progress through the hero SHALL strengthen the wind, which speeds the fleet and the wind layer's streams, and scrolling back SHALL ease it. Below the hero, sections SHALL reveal themselves once as they enter the view. Their hidden starting state SHALL apply only after the script has run.

#### Scenario: Scrolling forward
- **WHEN** the browser check scrolls the home from the top to the end of its hero
- **THEN** the reported wind strength rises at every step, and the lead's horizontal position keeps growing

#### Scenario: Hidden without the script
- **WHEN** a page is read with JavaScript disabled, or a stylesheet hides a section without the script's marker on the document
- **THEN** every section is visible, and `pnpm test` fails on any rule that hides content outside that marker

### Requirement: A pause button for the visit
Every animated page SHALL carry a keyboard-reachable button that stops all motion of the sea and the wind within one frame and resumes it. It SHALL show a pause glyph, then a play glyph, and no text; its accessible name SHALL be "Pause animation" or "Play animation", and in Spanish "Pausar animación" or "Reanudar animación", through `aria-label`. It SHALL show its state with `aria-pressed`. It SHALL store nothing: no cookie, local storage, session storage or other storage.

#### Scenario: Pausing and resuming
- **WHEN** the browser check presses the button on `/es/ide/`, waits 1 second, then presses it again
- **THEN** no frame of the sea or the wind is drawn while paused, frames resume after the second press, the name read is "Reanudar animación" while paused, and the page's storage and cookies are empty

#### Scenario: A button in the wrong language, or with words
- **WHEN** an animated page lacks the button, its `aria-label` is not in the page's language, or it carries visible text
- **THEN** `pnpm test` fails naming the page

### Requirement: Still pictures where nothing can move
Every page SHALL show its sea state's still picture behind the drawing, the light or the dark one as `prefers-color-scheme` says, with the state's fleet at rest and a few streamlines of wind. When JavaScript is off, or when neither WebGL2 nor Canvas 2D is available, that still picture SHALL remain, and every word, link and download of the page SHALL work.

#### Scenario: JavaScript off
- **WHEN** the browser check opens every page with JavaScript disabled
- **THEN** the still picture is visible, neither canvas is, and every link of the page is present

#### Scenario: A missing still picture
- **WHEN** a page's still picture is missing, empty, not well-formed SVG, or without its fleet
- **THEN** `pnpm test` fails naming the page and the file

### Requirement: Weight and frame budgets
The gzipped scripts a page loads SHALL total at most 45 KB, and each still picture SHALL weigh at most 30 KB. The hero SHALL cause no layout shift. No frame of the sea SHALL be drawn while the tab is hidden or the hero is out of view, and no frame of the wind while the tab is hidden.

#### Scenario: Over budget
- **WHEN** the built scripts of a page total more than 45 KB gzipped, or a still picture exceeds 30 KB
- **THEN** `pnpm test` fails naming the page or the picture and its size

#### Scenario: Idle when unseen
- **WHEN** the browser check scrolls the hero out of view, or hides the tab, for 1 second
- **THEN** the sea has drawn no frame in that second, and with the tab hidden neither has the wind
