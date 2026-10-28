## Purpose

The contract of `@meltemi/ocean`, the family's drawing of sea and wind. The site and every product
that wears the sea draw it from one package, with one behaviour and one set of guarantees.

## ADDED Requirements

### Requirement: A package that only draws
`@meltemi/ocean` SHALL be an Apache-2.0 ES module package with type declarations and no runtime
dependency. Its code SHALL make no network request, use no storage, cookie or beacon, and send no
telemetry.

#### Scenario: The package as published
- **WHEN** the checks read `packages/ocean/package.json` and the built files
- **THEN** the licence is `Apache-2.0`, `dependencies` is empty or absent, and `exports` names the module and its types

#### Scenario: Code that reaches out
- **WHEN** a source file of the package calls `fetch`, `XMLHttpRequest`, `WebSocket`, `navigator.sendBeacon`, `document.cookie`, `localStorage`, `sessionStorage` or `indexedDB`
- **THEN** `pnpm test` fails naming the file and the call

### Requirement: A sea on a canvas
`createSea(canvas, options)` SHALL draw a named sea state on the given canvas with WebGL2, or with Canvas 2D when WebGL2 is unavailable. When neither is available, it SHALL return a handle that reports `renderer: "none"` and draws nothing. The handle SHALL start, stop, take a scroll progress between 0 and 1, resize and be destroyed, releasing every resource it took.

#### Scenario: Falling back
- **WHEN** a canvas offers no WebGL2 context but offers Canvas 2D
- **THEN** the handle reports `renderer: "2d"` and draws the same state

#### Scenario: Bad options
- **WHEN** `createSea` receives an unknown state, or a progress outside 0 to 1 is set
- **THEN** it throws an error naming the option and the value it received

### Requirement: Named sea states
The package SHALL offer the states `home`, `ide`, `diagrams` and `still`, as the `site-motion` capability describes them, and SHALL expose the number of following sails and links each state draws.

#### Scenario: The states it knows
- **WHEN** a test lists the package's states
- **THEN** it finds exactly `home`, `ide`, `diagrams` and `still`

#### Scenario: A state without its figures
- **WHEN** the `ide` state reports fewer than three following sails, or the `diagrams` state reports no links
- **THEN** the package's tests fail naming the state

### Requirement: One deterministic sea
The height and slope of the sea SHALL be a pure function of position, time and state, returning the same values for the same inputs. The renderers, the placement of the mark and the still pictures SHALL all use that function.

#### Scenario: Same inputs, same sea
- **WHEN** a test asks for the height at the same position, time and state twice
- **THEN** both answers are equal, and they stay within the state's declared amplitude

#### Scenario: Inputs that are not numbers
- **WHEN** the height is asked for with a non-finite position or time
- **THEN** the function throws an error naming the input

### Requirement: The mark is placed, never redrawn
Given the mark's element, the package SHALL only set its transform: a translation onto the sea surface and a tilt of at most 4 degrees taken from the wave's slope. It SHALL never change the mark's paths, fills, strokes, filters or any other attribute.

#### Scenario: Sailing the mark
- **WHEN** a test runs the placement for 10 seconds of simulated time on an SVG mark
- **THEN** every attribute of the mark except its transform is unchanged, and no rotation exceeds 4 degrees

#### Scenario: A placement that alters the mark
- **WHEN** the placement writes any attribute of the mark other than its transform
- **THEN** the package's tests fail naming the attribute

### Requirement: Still pictures from the same sea
`stillPicture(state)` SHALL return a well-formed SVG of the state at rest of at most 30 KB. Its colours SHALL follow `prefers-color-scheme` from the brand's tokens, with the brand's values as fallbacks. It SHALL contain no script and no reference to another file.

#### Scenario: A still picture
- **WHEN** a test renders the still picture of every state
- **THEN** each parses as SVG, weighs at most 30 KB, holds a dark and a light colour rule, and has no `<script>`, `href` or `url(` to another file

#### Scenario: An oversize picture
- **WHEN** a change makes a still picture exceed 30 KB
- **THEN** the package's tests fail naming the state and the size

### Requirement: Motion only when allowed
A handle created with `reducedMotion: true`, or stopped, SHALL request no animation frame. A running handle SHALL request none while its canvas is out of view or the document is hidden.

#### Scenario: Reduced motion
- **WHEN** a test creates a handle with `reducedMotion: true` and starts it
- **THEN** exactly one frame is drawn and no animation frame is requested

#### Scenario: A loop that ignores visibility
- **WHEN** the document becomes hidden while a handle runs
- **THEN** the handle requests no further animation frame until it is visible again, and a test that sees one fails

### Requirement: Published with provenance
A tag `ocean-v<x.y.z>` that names the version in `packages/ocean/package.json` SHALL publish that version to npm with provenance. Any other tag SHALL publish nothing of the package, and a version npm already has SHALL be skipped.

#### Scenario: The tag names the version
- **WHEN** the tag `ocean-v0.1.0` is pushed and the package's version is `0.1.0`
- **THEN** the release workflow publishes `@meltemi/ocean@0.1.0` with provenance

#### Scenario: A tag that does not match
- **WHEN** the tag `ocean-v0.2.0` is pushed while the package's version is `0.1.0`
- **THEN** the workflow stops before publishing, naming both versions
