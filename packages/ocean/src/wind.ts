// The wind (design D1, D3): particles blowing the way the mark's gust points, up and to the
// right, along a smooth flow that bends with time like air over water. Positions are fractions
// of the canvas (u across, v down). A particle fades in, fades out, and is invisible inside the
// mark's clear space, so nothing ever touches the mark.

/** The gust's heading on screen: 19 degrees above the horizontal, to the right. */
export const GUST = (-19 * Math.PI) / 180;

/** How far the flow may bend from the gust, in radians. */
const BEND = 0.32;

export interface Particle {
  u: number;
  v: number;
  /** Seconds lived, and seconds it will live. */
  age: number;
  life: number;
  /** Fraction of the width per second, at full wind. */
  speed: number;
}

/** A box in canvas fractions: the mark's clear space. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The flow's direction at (u, v) and time t, as a unit vector (du right, dv down). */
export function flowAt(u: number, v: number, t: number): readonly [number, number] {
  const angle = GUST + BEND * Math.sin(u * 3.1 + t * 0.21) * Math.cos(v * 2.3 - t * 0.17);
  return [Math.cos(angle), Math.sin(angle)];
}

/** A particle somewhere the gust will carry it across the canvas from. */
export function spawn(random: () => number, anywhere: boolean): Particle {
  return {
    u: anywhere ? random() : -0.08 + random() * 0.55,
    v: anywhere ? random() : 0.18 + random() * 0.82,
    age: anywhere ? random() * 3 : 0,
    life: 3 + random() * 4,
    speed: 0.05 + random() * 0.07,
  };
}

export function particles(count: number, random: () => number): Particle[] {
  return Array.from({ length: count }, () => spawn(random, true));
}

/** Advances every particle by dt seconds at a wind strength between 0 and 1. */
export function step(
  all: Particle[],
  dt: number,
  t: number,
  strength: number,
  random: () => number,
): void {
  for (let i = 0; i < all.length; i++) {
    const p = all[i]!;
    const [du, dv] = flowAt(p.u, p.v, t);
    const pace = p.speed * (0.45 + 0.55 * strength) * dt;
    p.u += du * pace;
    p.v += dv * pace;
    p.age += dt;
    if (p.age > p.life || p.u > 1.08 || p.v < -0.08) all[i] = spawn(random, false);
  }
}

export function inside(box: Box | undefined, u: number, v: number): boolean {
  return box !== undefined && u >= box.left && u <= box.right && v >= box.top && v <= box.bottom;
}

/** How visible a particle is: it fades in and out, grows with the wind, and vanishes in the box. */
export function alphaOf(p: Particle, strength: number, box: Box | undefined): number {
  if (inside(box, p.u, p.v)) return 0;
  const phase = Math.min(1, Math.max(0, p.age / p.life));
  return Math.sin(Math.PI * phase) * (0.25 + 0.75 * strength);
}

/** The particle's streak: its head, and a tail behind it along the flow. */
export function streak(
  p: Particle,
  t: number,
  strength: number,
): readonly [number, number, number, number] {
  const [du, dv] = flowAt(p.u, p.v, t);
  const length = p.speed * (0.6 + 0.8 * strength) * 0.55;
  return [p.u - du * length, p.v - dv * length, p.u, p.v];
}

/** A random source that repeats from a seed (a linear congruential generator), for tests and stills. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
