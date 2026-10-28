// The sea states: what each page of the family shows. Every number the renderers, the fleet's
// placement and the still pictures use comes from here, so they cannot drift apart.

/** The states, in the order the site's specification names them. */
export const STATES = ["home", "ide", "diagrams", "still"] as const;

export type SeaState = (typeof STATES)[number];

/** One component of the sea: a sine travelling over the surface. */
export interface Wave {
  /** The direction it travels in, over the surface (x across, z away from the viewer). */
  readonly direction: readonly [number, number];
  /** Its wavelength, in world units (the camera stands one unit above the sea). */
  readonly length: number;
  /** Its height, in world units, before the state's overall amplitude. */
  readonly amplitude: number;
  /** Its phase at time 0, in radians. */
  readonly phase: number;
}

export interface StateDefinition {
  readonly state: SeaState;
  /** Scales every wave: the state's sea is calmer or fresher than the home's. */
  readonly amplitude: number;
  /** Whether the state moves at all; `still` draws one frame. */
  readonly animated: boolean;
  /** Where the lead boat rests, as fractions of the width, at progress 0 and at progress 1. */
  readonly markFrom: number;
  readonly markTo: number;
  /** How many boats the state sails, the lead included. */
  readonly boats: number;
  /** How many links the wind draws between points (the Diagrams flow). */
  readonly links: number;
  /** The progress the state rests at: the story told without motion. */
  readonly rest: number;
}

/**
 * The Etesian sea: a short, steep sea under a steady wind, its components travelling with the
 * gust, away from the viewer and to the right.
 */
export const WAVES: readonly Wave[] = [
  { direction: [0.8, 0.6], length: 2.4, amplitude: 0.055, phase: 0 },
  { direction: [0.95, 0.31], length: 1.35, amplitude: 0.032, phase: 1.7 },
  { direction: [0.6, 0.8], length: 0.82, amplitude: 0.018, phase: 4.1 },
  { direction: [0.99, -0.15], length: 0.47, amplitude: 0.01, phase: 2.6 },
];

/** Deep-water speed, slowed so the sea reads as calm motion rather than storm. */
export const GRAVITY = 9.81;
export const SPEED = 0.32;

const DEFINITIONS: Readonly<Record<SeaState, StateDefinition>> = {
  home: {
    state: "home",
    amplitude: 1,
    animated: true,
    markFrom: 0.18,
    markTo: 0.82,
    boats: 6,
    links: 0,
    rest: 0.35,
  },
  ide: {
    state: "ide",
    amplitude: 0.9,
    animated: true,
    markFrom: 0.3,
    markTo: 0.78,
    boats: 9,
    links: 0,
    rest: 1,
  },
  diagrams: {
    state: "diagrams",
    amplitude: 0.7,
    animated: true,
    markFrom: 0.12,
    markTo: 0.34,
    boats: 5,
    links: 11,
    rest: 1,
  },
  still: {
    state: "still",
    amplitude: 0.6,
    animated: false,
    markFrom: 0.18,
    markTo: 0.18,
    boats: 1,
    links: 0,
    rest: 0,
  },
};

/** Whether a value names a sea state. */
export function isState(value: unknown): value is SeaState {
  return typeof value === "string" && (STATES as readonly string[]).includes(value);
}

/** The definition of a state, or an error that names the option and the value received. */
export function definitionOf(state: unknown): StateDefinition {
  if (!isState(state)) {
    throw new RangeError(
      `state must be one of ${STATES.join(", ")}; received ${JSON.stringify(state)}`,
    );
  }
  return DEFINITIONS[state];
}

/**
 * Where a state rests: the still pictures are drawn at this progress, and a page that does not
 * move draws its one frame there, so the lead sits where the still picture leaves room for it.
 */
export function restProgress(state: SeaState): number {
  return definitionOf(state).rest;
}

/** How many boats a state sails, the lead included: the page carries that many elements. */
export function fleetSize(state: SeaState): number {
  return definitionOf(state).boats;
}
