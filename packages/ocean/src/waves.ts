// The one sea (design D4): its height and slope are pure functions of position, time and state.
// The WebGL2 shader computes the same sum from the same constants, which it receives as uniforms
// from `waveTable`, so the drawing, the mark's placement and the still pictures cannot disagree.

import { GRAVITY, SPEED, WAVES, definitionOf, type SeaState } from "./states.js";

/** One wave, ready to evaluate: unit direction, wavenumber, angular speed, height, phase. */
export interface WaveTerm {
  readonly dx: number;
  readonly dz: number;
  readonly k: number;
  readonly omega: number;
  readonly amplitude: number;
  readonly phase: number;
}

const TERMS: readonly WaveTerm[] = WAVES.map((wave) => {
  const [x, z] = wave.direction;
  const norm = Math.hypot(x, z);
  const k = (2 * Math.PI) / wave.length;
  return {
    dx: x / norm,
    dz: z / norm,
    k,
    omega: Math.sqrt(GRAVITY * k) * SPEED,
    amplitude: wave.amplitude,
    phase: wave.phase,
  };
});

/** The wave terms every renderer uses, in order. */
export function waveTable(): readonly WaveTerm[] {
  return TERMS;
}

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number; received ${String(value)}`);
  }
}

/** The height of the sea above its rest level at (x, z) and time t, in world units. */
export function heightAt(x: number, z: number, t: number, state: SeaState): number {
  finite("x", x);
  finite("z", z);
  finite("t", t);
  const { amplitude } = definitionOf(state);
  let y = 0;
  for (const w of TERMS)
    y += w.amplitude * Math.sin(w.k * (w.dx * x + w.dz * z) - w.omega * t + w.phase);
  return amplitude * y;
}

/** The slope of the sea along x (rise over run) at (x, z) and time t. */
export function slopeAt(x: number, z: number, t: number, state: SeaState): number {
  finite("x", x);
  finite("z", z);
  finite("t", t);
  const { amplitude } = definitionOf(state);
  let dy = 0;
  for (const w of TERMS) {
    dy += w.amplitude * w.k * w.dx * Math.cos(w.k * (w.dx * x + w.dz * z) - w.omega * t + w.phase);
  }
  return amplitude * dy;
}

/** The most the sea can rise or fall in a state: the sum of its waves' heights. */
export function declaredAmplitude(state: SeaState): number {
  const { amplitude } = definitionOf(state);
  return amplitude * TERMS.reduce((sum, w) => sum + w.amplitude, 0);
}
