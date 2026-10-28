// The wind across a surface (specification `ocean-package`, "A wind across a surface"; design
// D3, D9): particles carried by a smooth flow, the gust bent by noise of position and slow time.
// Each draws a short streak that appears, travels a range, fades and starts again elsewhere, the
// way wind maps draw wind. The surface is cleared every frame and each streak is drawn whole from
// its own short tail, so nothing it drew outlives it. Canvas 2D, one device pixel per CSS pixel:
// the streaks are soft and the page behind shows through.

import { BRAND, parseColour, type Colour } from "./colors.js";
import { browserEnvironment, checkUnit, type Environment } from "./environment.js";
import { noise2, seeded, type Noise2 } from "./noise.js";

export { seeded };

/** The gust's heading on screen: 19 degrees above the horizontal, to the right. */
export const GUST = (-19 * Math.PI) / 180;

/** How far the flow may bend from the gust, in radians, and how large its eddies are. */
const BEND = 0.85;
const EDDY = 1 / 640;

/** How the field drifts with time: slowly, like weather. */
const DRIFT_X = 0.045;
const DRIFT_Y = -0.03;

/** A streak's tail, in CSS pixels, and the spacing of the points that carry it. */
export const TAIL = 60;
export const SPACING = 6;
const TAIL_POINTS = Math.round(TAIL / SPACING);

/** How far a streak travels before it starts again elsewhere, in CSS pixels: 140 to 320. */
export const RANGE_MIN = 140;
export const RANGE_SPREAD = 180;

/** The share of its range a streak spends appearing, and disappearing. */
const RISE = 0.15;
const FALL = 0.35;

/** The steps of opacity a frame strokes in: along a tail, and over a streak's life. */
const BANDS = 4;
const LEVELS = 5;

/** A streak's opacity at its head, at the middle of its life. */
export const ALPHA = 0.36;

/** How visible a streak is from how far it has travelled of its range: 0 at both ends, 1 between. */
export function envelope(travelled: number, range: number): number {
  const done = Math.min(1, Math.max(0, travelled / range));
  const e = Math.min(1, done / RISE, (1 - done) / FALL);
  return e * e * (3 - 2 * e);
}

/** The flow's direction at a point and time, as a unit vector (dx right, dy down). */
export function flowAt(x: number, y: number, t: number, noise: Noise2): readonly [number, number] {
  const angle = GUST + BEND * noise(x * EDDY + t * DRIFT_X, y * EDDY + t * DRIFT_Y);
  return [Math.cos(angle), Math.sin(angle)];
}

/** The flow's speed at a point, in CSS pixels per second: it breathes with a second noise. */
export function speedAt(x: number, y: number, t: number, strength: number, noise: Noise2): number {
  const breath = (noise(x * EDDY * 2.3 + 17, y * EDDY * 2.3 - t * 0.02) + 1) / 2;
  return (26 + 74 * strength) * (0.65 + 0.7 * breath);
}

/** How many particles a surface of this size carries. */
export function particleCount(width: number, height: number, density = 11000): number {
  return Math.min(800, Math.max(100, Math.round((width * height) / density)));
}

/** Static streamlines of the field at time 0, as flat polylines, for a surface that cannot move. */
export function streamlines(
  width: number,
  height: number,
  count: number,
  random: () => number,
  noise: Noise2,
  steps = 40,
): number[][] {
  const lines: number[][] = [];
  for (let i = 0; i < count; i++) {
    let x = random() * width;
    let y = random() * height;
    const line = [x, y];
    for (let step = 0; step < steps; step++) {
      const [dx, dy] = flowAt(x, y, 0, noise);
      x += dx * 7;
      y += dy * 7;
      line.push(x, y);
    }
    lines.push(line);
  }
  return lines;
}

interface Particle {
  x: number;
  y: number;
  /** How far it has travelled, and how far it will, in CSS pixels. */
  travelled: number;
  range: number;
  /** How far it has moved since it last left a point in its tail. */
  since: number;
  /** Its tail, oldest point first, as flat x, y pairs: at most `TAIL / SPACING` points. */
  tail: number[];
}

export interface WindOptions {
  /** Draw one static frame and never animate (`prefers-reduced-motion: reduce`). */
  readonly reducedMotion?: boolean;
  /** The wind's strength, between 0 and 1. */
  readonly strength?: number;
  /** CSS pixels of surface per particle; the default gives a laptop screen about 100. */
  readonly density?: number;
}

export interface Wind {
  readonly renderer: "2d" | "none";
  /** How many frames have been drawn. */
  readonly frames: number;
  readonly strength: number;
  /** How many particles blow. */
  readonly particles: number;
  start(): void;
  stop(): void;
  setStrength(strength: number): void;
  /** Re-reads `--sea-wind` from the canvas; the next frame strokes in it. */
  restyle(): void;
  /** Re-reads the canvas's size; the streaks keep blowing on the new surface. */
  resize(): void;
  destroy(): void;
}

/** What the wind asks of a 2D context. */
export interface WindContext {
  fillStyle: string;
  strokeStyle: string;
  globalAlpha: number;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  globalCompositeOperation: string;
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
}

/** Draws the wind on a canvas and returns its handle. */
export function createWind(
  canvas: HTMLCanvasElement,
  options: WindOptions = {},
  environment?: Partial<Environment>,
): Wind {
  const env: Environment = { ...browserEnvironment(), ...environment };
  let strength = checkUnit("strength", options.strength ?? 0.6);
  const still = options.reducedMotion === true;
  const ctx = (canvas as unknown as { getContext(kind: "2d"): WindContext | null }).getContext(
    "2d",
  );
  const noise = noise2(Math.floor(env.random() * 1e9));

  let colour: Colour = parseColour(BRAND.wind)!;
  let width = 1;
  let height = 1;
  let particles: Particle[] = [];
  let frames = 0;
  let running = false;
  let destroyed = false;
  let handle: number | undefined;
  let time = 0;
  let last: number | undefined;

  const visible = () => !(env.document?.hidden ?? false);

  /** A streak starts again somewhere else; on the first frame, part-way through its range. */
  const spawn = (p: Particle, anywhere: boolean) => {
    p.x = env.random() * width;
    p.y = env.random() * height;
    p.range = RANGE_MIN + env.random() * RANGE_SPREAD;
    p.travelled = anywhere ? env.random() * p.range : 0;
    p.since = 0;
    p.tail.length = 0;
  };

  /** One polyline list per step of opacity, reused frame after frame: NaN starts a polyline. */
  const groups: number[][] = Array.from({ length: LEVELS * BANDS }, () => []);

  const measure = () => {
    width = Math.max(1, canvas.clientWidth || canvas.width || 1);
    height = Math.max(1, canvas.clientHeight || canvas.height || 1);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const count = particleCount(width, height, options.density);
    if (particles.length !== count) {
      particles = Array.from({ length: count }, () => {
        const p: Particle = { x: 0, y: 0, travelled: 0, range: 1, since: 0, tail: [] };
        spawn(p, true);
        return p;
      });
    }
  };

  const restyle = () => {
    const value = env.style(canvas)?.getPropertyValue("--sea-wind") ?? "";
    colour = parseColour(value) ?? parseColour(BRAND.wind)!;
  };

  const pen = () => {
    if (!ctx) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = colour.css;
    ctx.globalAlpha = ALPHA * colour.a;
    ctx.lineWidth = 1.1;
    // Butt caps where two steps of opacity meet, so a joint is never painted twice.
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
  };

  /** Files a particle's streak, head first, under its step of life and each step of its tail. */
  const file = (p: Particle) => {
    const level = Math.ceil(envelope(p.travelled, p.range) * LEVELS);
    if (level === 0) return;
    let hx = p.x;
    let hy = p.y;
    let band = -1;
    let k = 0;
    for (let i = p.tail.length - 2; i >= 0; i -= 2) {
      const tx = p.tail[i]!;
      const ty = p.tail[i + 1]!;
      if (tx === hx && ty === hy) continue;
      const next = Math.min(BANDS - 1, Math.floor((k * BANDS) / TAIL_POINTS));
      const group = groups[(level - 1) * BANDS + next]!;
      if (next !== band) {
        group.push(Number.NaN, hx, hy);
        band = next;
      }
      group.push(tx, ty);
      hx = tx;
      hy = ty;
      k += 1;
    }
  };

  /** Strokes every filed polyline, one stroke per step of opacity. */
  const strokeGroups = () => {
    if (!ctx) return;
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g]!;
      if (group.length === 0) continue;
      const level = Math.floor(g / BANDS) + 1;
      const band = g % BANDS;
      ctx.globalAlpha = ALPHA * colour.a * (level / LEVELS) * (1 - band / BANDS);
      ctx.beginPath();
      for (let i = 0; i < group.length;) {
        if (Number.isNaN(group[i])) {
          ctx.moveTo(group[i + 1]!, group[i + 2]!);
          i += 3;
        } else {
          ctx.lineTo(group[i]!, group[i + 1]!);
          i += 2;
        }
      }
      ctx.stroke();
    }
  };

  /**
   * One frame: the surface starts clear, every particle takes its next step, and every streak is
   * drawn whole from its own tail. A streak that has travelled its range, or left the surface,
   * starts again elsewhere; nothing it drew survives it (design D9).
   */
  const blow = (dt: number) => {
    if (!ctx || destroyed) return;
    ctx.clearRect(0, 0, width, height);
    for (const group of groups) group.length = 0;
    for (const p of particles) {
      const [dx, dy] = flowAt(p.x, p.y, time, noise);
      const step = speedAt(p.x, p.y, time, strength, noise) * dt;
      p.x += dx * step;
      p.y += dy * step;
      p.travelled += step;
      p.since += step;
      if (p.since >= SPACING) {
        p.tail.push(p.x, p.y);
        p.since = 0;
        if (p.tail.length > 2 * TAIL_POINTS) p.tail.splice(0, 2);
      }
      if (p.travelled >= p.range || p.x > width + 4 || p.x < -4 || p.y < -4 || p.y > height + 4) {
        spawn(p, false);
        continue;
      }
      file(p);
    }
    pen();
    strokeGroups();
    frames += 1;
  };

  /** The one frame of a surface that cannot move: streamlines of the field. */
  const calm = () => {
    if (!ctx || destroyed) return;
    ctx.clearRect(0, 0, width, height);
    pen();
    ctx.globalAlpha = ALPHA * 0.55 * colour.a;
    ctx.beginPath();
    const count = Math.max(40, Math.round(particles.length / 4));
    for (const line of streamlines(width, height, count, env.random, noise, 22)) {
      ctx.moveTo(line[0]!, line[1]!);
      for (let i = 2; i < line.length; i += 2) ctx.lineTo(line[i]!, line[i + 1]!);
    }
    ctx.stroke();
    frames += 1;
  };

  const tick = (now: number) => {
    handle = undefined;
    if (!running || destroyed) return;
    const dt = last === undefined ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    blow(dt);
    schedule();
  };

  const schedule = () => {
    if (handle !== undefined || !running || still || !visible() || destroyed) return;
    handle = env.requestFrame(tick);
  };

  const unschedule = () => {
    if (handle !== undefined) env.cancelFrame(handle);
    handle = undefined;
    last = undefined;
  };

  const onVisibility = () => {
    if (visible()) schedule();
    else unschedule();
  };
  env.document?.addEventListener("visibilitychange", onVisibility);

  measure();
  restyle();

  const wind: Wind = {
    get renderer() {
      return ctx ? "2d" : "none";
    },
    get frames() {
      return frames;
    },
    get strength() {
      return strength;
    },
    get particles() {
      return particles.length;
    },
    start() {
      if (destroyed || !ctx) return;
      if (still) {
        if (frames === 0) calm();
        return;
      }
      running = true;
      schedule();
    },
    stop() {
      running = false;
      unschedule();
    },
    setStrength(value) {
      strength = checkUnit("strength", value);
    },
    restyle,
    resize() {
      measure();
      if (still && frames > 0) calm();
    },
    destroy() {
      wind.stop();
      destroyed = true;
      env.document?.removeEventListener("visibilitychange", onVisibility);
    },
  };
  return wind;
}
