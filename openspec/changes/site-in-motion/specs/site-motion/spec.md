## Purpose

What the family's pages show in motion and how that motion behaves: a digital sea, the Etesian
wind and the Meltemi mark sailing on them, tied to scroll, optional by design, and held to weight
and frame budgets.

## ADDED Requirements

### Requirement: A sea, a wind and the mark in every product hero
The hero of the home, of the four IDE pages and of the Diagrams page, in English and Spanish, SHALL
draw a sea of points that rise and fall in waves, wind particles blowing toward the upper right
(the direction of the mark's gust), and the Meltemi mark sailing on the sea. The text, links and
buttons of the hero SHALL stay in the page's HTML above the drawing.

#### Scenario: The home draws its sea
- **WHEN** the browser check opens `/` and `/es/` with motion allowed
- **THEN** the hero's canvas has drawn at least one frame that is not blank, and the mark is visible in the hero

#### Scenario: A product page without its sea
- **WHEN** a page among `/`, `/ide/`, `/ide/method/`, `/ide/agents/`, `/ide/downloads/`, `/diagrams/` or their `/es/` twins loses its hero canvas, its mark or its still picture
- **THEN** `pnpm test` fails naming the page and what is missing

### Requirement: The mark is drawn by the wind and stays the brand's
When the page loads, the hero SHALL draw the mark's `m` stroke from its start to the north-east tip in at most 1.6 seconds and raise its hull from the sea. After that, it SHALL move the mark only by translation and a tilt of at most 4 degrees, following the wave beneath it. The mark's paths and colours SHALL stay those of the IDE's `brand/meltemi-mark-gradient.svg`, with no filter, glow, shadow, mast or wave added.

#### Scenario: The mark after the intro
- **WHEN** the browser check reads the hero's mark 2 seconds after load
- **THEN** its path data and gradient stops equal the brand file's, it carries no `filter`, and its transform is a translation with a rotation of at most 4 degrees

#### Scenario: A mark that drifts from the brand
- **WHEN** a page's mark has a path, a gradient stop or a filter that differs from the IDE's brand file
- **THEN** `pnpm test` fails naming the page and the difference

### Requirement: Each page has its own sea state
Each page SHALL declare one sea state and draw it:
- `home`: the boat crossing the sea.
- `ide`: smaller sails that follow the mark's wake and line up on its heading as the page scrolls.
- `diagrams`: points of the sea that lift and link into nodes and edges forming a small flow diagram.
- `still`: no motion, for the legal pages and the 404.

A page and its Spanish twin SHALL declare the same state.

#### Scenario: The IDE page's fleet
- **WHEN** the browser check opens `/ide/` and scrolls through the hero
- **THEN** the drawing reports the `ide` state with at least three following sails, and their heading converges on the mark's

#### Scenario: An unknown or mismatched state
- **WHEN** a page declares a state outside `home`, `ide`, `diagrams` and `still`, or declares a state different from its twin's
- **THEN** `pnpm test` fails naming the page and the state

### Requirement: Scroll sails the boat
While the hero is in view, the page's scroll progress through the hero SHALL move the mark forward across the hero and strengthen the wind, and scrolling back SHALL undo it. Below the hero, sections SHALL reveal themselves once as they enter the view. Their hidden starting state SHALL apply only after the script has run.

#### Scenario: Scrolling forward
- **WHEN** the browser check scrolls the home from the top to the end of its hero
- **THEN** the mark's horizontal position increases at every step and the reported wind strength rises

#### Scenario: No script, nothing hidden
- **WHEN** a page is read with JavaScript disabled, or a stylesheet hides a section without the script's marker on the document
- **THEN** every section is visible, and `pnpm test` fails on any rule that hides content outside that marker

### Requirement: Reduced motion stops all motion
Under `prefers-reduced-motion: reduce`, a page SHALL request no animation frame and run no scroll-linked motion or reveal. The mark SHALL sit at rest, and the page SHALL show its still picture or a single drawn frame.

#### Scenario: Reduced motion
- **WHEN** the browser check opens each animated page emulating reduced motion and waits 2 seconds
- **THEN** no animation frame has been drawn after the first and the mark has not moved

#### Scenario: A motion that ignores the preference
- **WHEN** a reveal or a scroll-linked effect runs while reduced motion is emulated
- **THEN** the browser check fails naming the page and the effect

### Requirement: A pause button for the visit
Every animated page SHALL carry a keyboard-reachable button in its own language that stops all motion within one frame and resumes it. It SHALL be labelled "Pause animation" or "Play animation", and in Spanish "Pausar animación" or "Reanudar animación". It SHALL show its state with `aria-pressed`. It SHALL store nothing: no cookie, local storage, session storage or other storage.

#### Scenario: Pausing and resuming
- **WHEN** the browser check presses the button on `/es/ide/`, waits 1 second, then presses it again
- **THEN** no frame is drawn while paused, frames resume after the second press, and the page's storage and cookies are empty

#### Scenario: A button in the wrong language
- **WHEN** an animated page lacks the button, or its label is not in the page's language
- **THEN** `pnpm test` fails naming the page

### Requirement: Still pictures where nothing can move
Every page SHALL show its sea state's still picture behind the drawing, the light or the dark one as `prefers-color-scheme` says. When JavaScript is off, or when neither WebGL2 nor Canvas 2D is available, that still picture SHALL remain, and every word, link and download of the page SHALL work.

#### Scenario: JavaScript off
- **WHEN** the browser check opens every page with JavaScript disabled
- **THEN** the still picture is visible, the canvas is not, and every link of the page is present

#### Scenario: A missing still picture
- **WHEN** a page's still picture is missing, empty or not well-formed SVG
- **THEN** `pnpm test` fails naming the page and the file

### Requirement: Light and dark seas
The sea, the wind and the still pictures SHALL take their colours from the brand tokens the site already carries, follow `prefers-color-scheme`, and recolour without a reload when it changes. The hero's styles SHALL use no colour that is not a token.

#### Scenario: Switching the scheme
- **WHEN** the browser check opens `/diagrams/` in the light scheme and then switches the emulation to dark
- **THEN** the drawing's background and point colours change to the dark tokens without a navigation

#### Scenario: A colour outside the tokens
- **WHEN** a hero or sea rule in `site.css` names a literal colour instead of a token
- **THEN** `pnpm test` fails naming the rule

### Requirement: Weight and frame budgets
The gzipped scripts a page loads SHALL total at most 45 KB, and each still picture SHALL weigh at most 30 KB. The hero SHALL cause no layout shift. No frame SHALL be drawn while the tab is hidden or the hero is out of view.

#### Scenario: Over budget
- **WHEN** the built scripts of a page total more than 45 KB gzipped, or a still picture exceeds 30 KB
- **THEN** `pnpm test` fails naming the page or the file and its size

#### Scenario: Out of view
- **WHEN** the browser check scrolls the hero out of view, or hides the tab, for 1 second
- **THEN** no frame is drawn in that second, and the layout shift measured since load is 0
