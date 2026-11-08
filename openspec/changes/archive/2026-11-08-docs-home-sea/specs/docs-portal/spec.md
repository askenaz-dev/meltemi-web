## ADDED Requirements

### Requirement: The home's sea in motion
The home in both languages SHALL carry the still picture of the family's sea in its HTML and,
when the browser draws with WebGL2 or Canvas 2D and motion is allowed, SHALL play
`@meltemi/ocean`'s `home` state over it: the waves, the state's fleet of Meltemi marks sailing and
the wind's streamlines. The still picture SHALL give way only after the sea has drawn a frame.

#### Scenario: The sea plays
- **WHEN** the English home is opened in Chrome at 1280 px without reduced motion
- **THEN** the sea's canvas has drawn frames, the still picture is hidden, and six marks are
  placed on the waves

#### Scenario: A phone
- **WHEN** the Spanish home is opened at 375 px
- **THEN** the sea draws within the page's width, with no horizontal scroll

#### Scenario: No drawing surface
- **WHEN** the browser offers neither WebGL2 nor Canvas 2D, or runs no script
- **THEN** the still picture stays, the marks stay hidden, and the page reports no error

### Requirement: The home's sea can be stopped
A pause button named in the page's language SHALL stop and restart the sea's motion, and the sea
SHALL request no animation frame while it is out of view or the document is hidden.

#### Scenario: Paused
- **WHEN** the reader presses the button named "Pause animation"
- **THEN** the canvas draws no further frame, the button is pressed and named "Play animation",
  and pressing it again draws frames again

#### Scenario: The Spanish button
- **WHEN** the Spanish home plays its sea
- **THEN** its button is named "Pausar animación"

#### Scenario: Out of view
- **WHEN** the reader scrolls the sea out of view
- **THEN** its frame count stays the same until it is in view again

### Requirement: The home's sea under reduced motion
Under reduced motion the home SHALL show the still picture of the reader's scheme, show no pause
button and fetch none of the sea's code.

#### Scenario: Reduced motion
- **WHEN** the home is opened with reduced motion
- **THEN** the still picture of the scheme is shown, no pause button is shown, and no request
  fetches the sea's code

### Requirement: The home's sea in the reader's scheme
The moving sea SHALL draw in the portal's `--sea-*` colours of the active scheme, and SHALL re-read
them when the theme picker or the system changes the scheme.

#### Scenario: The scheme changes
- **WHEN** the theme picker switches the home from light to dark while the sea plays
- **THEN** the sea's canvas reads the dark scheme's `--sea-point`, and the next frames use it

### Requirement: The home's sea within the policy
The sea's code SHALL be a file served from the portal's origin, and the home SHALL hold no inline
script beyond Starlight's own.

#### Scenario: The policy
- **WHEN** the built home is read
- **THEN** its sea's script is a file under `/_astro/`, and the build's inline-script hashes are
  the same as without the sea
