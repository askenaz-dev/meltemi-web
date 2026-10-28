## MODIFIED Requirements

### Requirement: A sea on a canvas
`createSea(canvas, options)` SHALL draw a named sea state on the given canvas with WebGL2, or with Canvas 2D when WebGL2 is unavailable. When neither is available, it SHALL return a handle that reports `renderer: "none"` and draws nothing. It SHALL take a fleet of elements, the lead first, and sail them: every boat to the right, surging and easing with the gusts, re-entering just off the left edge at a new depth when it leaves, at a speed that grows with the wind. The handle SHALL start, stop, take a scroll progress between 0 and 1, take a wind strength between 0 and 1, re-read its colours from the canvas's `--sea-*` properties, resize and be destroyed, releasing every resource it took. `fleetSize(state)` SHALL say how many boats a state sails.

#### Scenario: Falling back
- **WHEN** a canvas offers no WebGL2 context but offers Canvas 2D
- **THEN** the handle reports `renderer: "2d"` and draws the same state

#### Scenario: The fleet loops
- **WHEN** a test sails a fleet for 60 seconds of simulated time at full wind
- **THEN** every boat's x grows between frames except when it re-enters, every boat re-enters at least once, and none re-enters inside another's box

#### Scenario: A page's own scheme switch
- **WHEN** a page changes the `--sea-*` properties on the canvas and calls the handle's `restyle()`
- **THEN** the next frame uses the new colours, with no new context created

#### Scenario: Bad options
- **WHEN** `createSea` receives an unknown state, a progress or a wind outside 0 to 1, or a fleet larger than the state sails
- **THEN** it throws an error naming the option and the value it received

### Requirement: The mark is placed, never redrawn
Given the fleet's elements, the package SHALL only set each one's transform: a translation onto the sea surface, a scale from its depth, and a heel of at most 6 degrees taken from the wave's slope. It SHALL never change an element's paths, fills, strokes, filters or any other attribute. The mark's own shape SHALL be exported as constants (`MARK_M`, `MARK_HULL`, `MARK_GRADIENT`) equal to the IDE's brand file, for pages and stills.

#### Scenario: Sailing the fleet
- **WHEN** a test runs the placement for 10 seconds of simulated time on a fleet of SVG elements
- **THEN** every attribute of every element except its transform is unchanged, every transform is a translation, a scale and a rotation, and no rotation exceeds 6 degrees

#### Scenario: A placement that alters the mark
- **WHEN** the placement writes any attribute of an element other than its transform
- **THEN** the package's tests fail naming the attribute

### Requirement: Still pictures from the same sea
`stillPicture(state, { scheme, colours })` SHALL return a well-formed SVG of the state at rest of at most 30 KB, for the light or the dark scheme, in the colours it is given, with the brand's values as fallbacks, carrying the state's fleet as one definition of the mark and one `<use>` per boat, and a few streamlines of the wind. It SHALL carry its colours as attributes, contain no script, no style element and no reference to another file, so a page's Content-Security-Policy never blocks it.

#### Scenario: Every state in both schemes
- **WHEN** a test renders every state in the light and the dark scheme
- **THEN** each picture parses as SVG, weighs at most 30 KB, carries the given colours and `fleetSize(state)` uses of the mark, and contains no `<style>`, `<script>` or external reference

#### Scenario: A colour that is not a colour
- **WHEN** a colour given is not `#hex` or `rgb()`
- **THEN** `stillPicture` throws naming the colour

## ADDED Requirements

### Requirement: A wind across a surface
`createWind(canvas, options)` SHALL draw the wind on a canvas with Canvas 2D: particles carried by a smooth flow, the gust bent by noise of position and time, each drawing a short streak in the colour of the canvas's `--sea-wind`. A strength between 0 and 1 SHALL speed the streams. The handle SHALL start, stop, set the strength, re-read its colour, resize and be destroyed; without a 2D context it SHALL report `renderer: "none"` and draw nothing.

#### Scenario: A strength outside the range
- **WHEN** `setStrength` receives a value below 0, above 1 or not a number
- **THEN** it throws an error naming the option and the value it received

### Requirement: Streaks that never pile up
Each streak SHALL appear, travel a range, fade and start again elsewhere, its length SHALL be bounded whatever its speed, and nothing a streak drew SHALL remain on the surface once it has passed, however long the wind blows.

#### Scenario: Trails that fade and never pile up
- **WHEN** a test drives the wind for 20 seconds of simulated time on a recording context
- **THEN** every frame starts from a cleared surface, no streak drawn is longer than its tail, the streaks are fainter at their tails and at the ends of their ranges, and the wind still draws in the last frame

### Requirement: The wind moves only when allowed
Under `reducedMotion` the wind SHALL draw one frame of static streamlines and request no animation frame. While the document is hidden it SHALL request none, and it SHALL resume when the document shows.

#### Scenario: One frame under reduced motion
- **WHEN** the wind is created with `reducedMotion: true` and started
- **THEN** exactly one frame is drawn and no animation frame is requested

#### Scenario: A hidden document
- **WHEN** the document hides while the wind runs
- **THEN** no frame is requested until it shows again
