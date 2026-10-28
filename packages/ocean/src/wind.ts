// The wind across a surface (specification `ocean-package`, "A wind across a surface"; design
// D3): particles carried by a smooth flow, the gust bent by noise of position and slow time,
// leaving trails that persist and fade, the way wind maps draw wind. Canvas 2D, one device pixel
// per CSS pixel: the trails are soft and the page behind shows through.

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

/** How much of a trail survives each frame at 60 frames per second. */
const RETAIN = 0.95;

/** The trails' opacity over the page. */
const ALPHA = 0.32;

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
export function particleCount(width: number, height: number, density = 8000): number {
  return Math.min(1400, Math.max(200, Math.round((width * height) / density)));
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
  age: number;
  life: number;
}

export interface WindOptions {
  /** Draw one static frame and never animate (`prefers-reduced-motion: reduce`). */
  readonly reducedMotion?: boolean;
  /** The wind's strength, between 0 and 1. */
  readonly strength?: number;
  /** CSS pixels of surface per particle; the default gives a laptop screen about 300. */
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
  /** Re-reads the canvas's size; the trails start over. */
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
  globalCompositeOperation: string;
  fillRect(x: number, y: number, w: number, h: number): void;
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

  const spawn = (p: Particle, anywhere: boolean) => {
    p.x = env.random() * width;
    p.y = env.random() * height;
    p.age = anywhere ? env.random() * 4 : 0;
    p.life = 3 + env.random() * 5;
  };

  const measure = () => {
    width = Math.max(1, canvas.clientWidth || canvas.width || 1);
    height = Math.max(1, canvas.clientHeight || canvas.height || 1);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const count = particleCount(width, height, options.density);
    if (particles.length !== count) {
      particles = Array.from({ length: count }, () => {
        const p = { x: 0, y: 0, age: 0, life: 1 };
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
    ctx.lineCap = "round";
  };

  /** One frame: the trails fade a little, and every particle strokes its next step. */
  const blow = (dt: number) => {
    if (!ctx || destroyed) return;
    const fade = 1 - Math.pow(RETAIN, dt * 60);
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = `rgba(0, 0, 0, ${fade.toFixed(4)})`;
    ctx.fillRect(0, 0, width, height);
    pen();
    ctx.beginPath();
    for (const p of particles) {
      const [dx, dy] = flowAt(p.x, p.y, time, noise);
      const step = speedAt(p.x, p.y, time, strength, noise) * dt;
      const nx = p.x + dx * step;
      const ny = p.y + dy * step;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(nx, ny);
      p.x = nx;
      p.y = ny;
      p.age += dt;
      if (p.age > p.life || nx > width + 4 || nx < -4 || ny < -4 || ny > height + 4) {
        spawn(p, false);
      }
    }
    ctx.stroke();
    frames += 1;
  };

  /** The one frame of a surface that cannot move: streamlines of the field. */
  const calm = () => {
    if (!ctx || destroyed) return;
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
