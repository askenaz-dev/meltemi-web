// `createSea`: a sea state drawn on a canvas, with a handle to drive it (specification
// `ocean-package`, "A sea on a canvas"). The handle owns the frame loop, which runs only while
// motion is allowed, the document is visible and the canvas is in view; it places the mark, if
// the page gave one, and moves nothing else of the page.

import { paletteOf, type Palette, type StyleSource } from "./colors.js";
import { compose, type SceneFigures } from "./compose.js";
import type { Quality, Renderer } from "./frame.js";
import { placeMark, type MarkElement } from "./mark.js";
import { canvasRenderer, type Context2D } from "./render-2d.js";
import { webglRenderer } from "./render-webgl.js";
import { viewOf, type View } from "./scene.js";
import { definitionOf, type SeaState } from "./states.js";
import { particles, step, type Particle } from "./wind.js";

export interface SeaOptions {
  /** The sea state to draw. */
  readonly state: SeaState;
  /** Draw one frame and never animate (`prefers-reduced-motion: reduce`). */
  readonly reducedMotion?: boolean;
  /** The scroll progress through the hero, between 0 and 1. */
  readonly progress?: number;
  /** The wind's strength, between 0 and 1. */
  readonly wind?: number;
  /** The mark's element, placed on the sea by its transform only. */
  readonly mark?: MarkElement | null;
}

export type Figures = SceneFigures;

export interface Sea {
  readonly renderer: "webgl2" | "2d" | "none";
  readonly state: SeaState;
  /** How many frames have been drawn. */
  readonly frames: number;
  /** What the last frame drew: following sails, links, the sails' spread and the mark's place. */
  readonly figures: Figures;
  readonly progress: number;
  readonly wind: number;
  /** The lattice's density: halved after slow frames. */
  readonly quality: Quality;
  /** Starts the loop, or draws the one frame a still or reduced sea shows. */
  start(): void;
  /** Stops the loop; the last frame stays on the canvas. */
  stop(): void;
  setProgress(progress: number): void;
  setWind(strength: number): void;
  /** Re-reads the `--sea-*` colours from the canvas; the next frame uses them. */
  restyle(): void;
  /** Re-reads the canvas's size. */
  resize(): void;
  /** Stops and releases everything the sea took. */
  destroy(): void;
}

/** What the sea needs from the page; tests give their own. */
export interface Environment {
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(handle: number): void;
  readonly document?: {
    readonly hidden: boolean;
    addEventListener(type: "visibilitychange", listener: () => void): void;
    removeEventListener(type: "visibilitychange", listener: () => void): void;
  };
  readonly IntersectionObserver?: new (
    callback: (entries: readonly { readonly isIntersecting: boolean }[]) => void,
  ) => { observe(target: Element): void; disconnect(): void };
  devicePixelRatio(): number;
  coarsePointer(): boolean;
  style(element: Element): StyleSource | undefined;
  random(): number;
}

function browserEnvironment(): Environment {
  const g = globalThis as typeof globalThis & Partial<Window>;
  return {
    requestFrame: (cb) => g.requestAnimationFrame!(cb),
    cancelFrame: (h) => g.cancelAnimationFrame!(h),
    document: g.document,
    IntersectionObserver: g.IntersectionObserver,
    devicePixelRatio: () => g.devicePixelRatio ?? 1,
    coarsePointer: () => g.matchMedia?.("(pointer: coarse)").matches ?? false,
    style: (el) => g.getComputedStyle?.(el),
    random: Math.random,
  };
}

/** The most device pixels a CSS pixel may cost: 2, or 1.5 on a coarse (touch) pointer. */
export function pixelRatioCap(ratio: number, coarse: boolean): number {
  return Math.max(1, Math.min(ratio, coarse ? 1.5 : 2));
}

/** The 95th percentile of frame times, in milliseconds. */
export function percentile95(times: readonly number[]): number {
  if (times.length === 0) return 0;
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
}

/** Frames measured before the quality is judged, and the p95 above which points are halved. */
export const JUDGED_FRAMES = 90;
export const SLOW_FRAME_MS = 20;

function checkUnit(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be between 0 and 1; received ${String(value)}`);
  }
  return value;
}

/** The canvas the sea draws on, as far as choosing a renderer goes. */
export interface CanvasLike {
  getContext(kind: "webgl2", options?: WebGLContextAttributes): WebGL2RenderingContext | null;
  getContext(kind: "2d"): Context2D | null;
}

/** Picks a renderer: WebGL2 first, then Canvas 2D, else none. */
export function chooseRenderer(canvas: CanvasLike, palette: Palette): Renderer | undefined {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  if (gl) {
    try {
      return webglRenderer(gl, palette);
    } catch {
      // A context whose programs fail cannot become 2D: the canvas keeps nothing and the still
      // picture beneath it shows.
      return undefined;
    }
  }
  const ctx = canvas.getContext("2d");
  return ctx ? canvasRenderer(ctx, palette) : undefined;
}

/** How many wind particles a canvas of this area carries. */
export function windCount(view: View, quality: Quality): number {
  const count = Math.round((view.width * view.height) / 9000);
  const capped = Math.min(110, Math.max(36, count));
  return quality === "high" ? capped : Math.round(capped / 2);
}

/** Draws a sea state on a canvas and returns its handle. */
export function createSea(
  canvas: HTMLCanvasElement,
  options: SeaOptions,
  environment?: Partial<Environment>,
): Sea {
  const env: Environment = { ...browserEnvironment(), ...environment };
  const definition = definitionOf(options.state);
  let progress = checkUnit("progress", options.progress ?? 0);
  let wind = checkUnit("wind", options.wind ?? 0.6);
  const still = options.reducedMotion === true || !definition.animated;
  const mark = options.mark ?? undefined;

  let palette = paletteOf(env.style(canvas));
  const renderer = chooseRenderer(canvas as unknown as CanvasLike, palette);

  let frames = 0;
  let running = false;
  let destroyed = false;
  let handle: number | undefined;
  let inView = true;
  let quality: Quality = "high";
  let dpr = 1;
  let view: View = viewOf(1, 1);
  let seaTime = 0;
  let last: number | undefined;
  const times: number[] = [];
  let wake: Particle[] = [];
  let figures: Figures = { sails: definition.sails, links: 0, spread: 0, markX: 0 };

  const visible = () => !(env.document?.hidden ?? false);

  const measure = () => {
    dpr = pixelRatioCap(env.devicePixelRatio(), env.coarsePointer());
    const width = Math.max(1, canvas.clientWidth || canvas.width || 1);
    const height = Math.max(1, canvas.clientHeight || canvas.height || 1);
    view = viewOf(width, height);
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    renderer?.resize(w, h);
    const count = windCount(view, quality);
    if (wake.length !== count) wake = particles(count, env.random);
  };

  const draw = () => {
    if (!renderer || destroyed) return;
    const scene = compose({
      view,
      t: seaTime,
      state: definition.state,
      progress,
      wind,
      particles: wake,
      mark: mark ? { width: mark.offsetWidth, height: mark.offsetHeight } : undefined,
    });
    if (mark) placeMark(mark, scene.placement);
    figures = scene.figures;
    renderer.draw({
      view,
      dpr,
      t: seaTime,
      state: definition.state,
      quality,
      shapes: scene.shapes,
    });
    frames += 1;
  };

  const tick = (now: number) => {
    handle = undefined;
    if (!running || destroyed) return;
    const dt = last === undefined ? 0 : Math.min(0.05, (now - last) / 1000);
    if (last !== undefined && times.length < JUDGED_FRAMES) {
      times.push(now - last);
      if (
        times.length === JUDGED_FRAMES &&
        quality === "high" &&
        percentile95(times) > SLOW_FRAME_MS
      ) {
        quality = "low";
        measure();
      }
    }
    last = now;
    seaTime += dt;
    step(wake, dt, seaTime, wind, env.random);
    draw();
    schedule();
  };

  const schedule = () => {
    if (handle !== undefined || !running || still || !inView || !visible() || destroyed) return;
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

  const observer = env.IntersectionObserver
    ? new env.IntersectionObserver((entries) => {
        inView = entries.some((e) => e.isIntersecting);
        if (inView) schedule();
        else unschedule();
      })
    : undefined;
  observer?.observe(canvas);

  measure();

  const sea: Sea = {
    get renderer() {
      return renderer?.kind ?? "none";
    },
    state: definition.state,
    get frames() {
      return frames;
    },
    get figures() {
      return figures;
    },
    get progress() {
      return progress;
    },
    get wind() {
      return wind;
    },
    get quality() {
      return quality;
    },
    start() {
      if (destroyed || !renderer) return;
      if (still) {
        if (frames === 0) draw();
        return;
      }
      running = true;
      if (frames === 0) draw();
      schedule();
    },
    stop() {
      running = false;
      unschedule();
    },
    setProgress(value) {
      progress = checkUnit("progress", value);
      if (!running && frames > 0) draw();
    },
    setWind(value) {
      wind = checkUnit("wind", value);
    },
    restyle() {
      palette = paletteOf(env.style(canvas));
      renderer?.restyle(palette);
      if (!running && frames > 0) draw();
    },
    resize() {
      measure();
      if (!running && frames > 0) draw();
    },
    destroy() {
      sea.stop();
      destroyed = true;
      env.document?.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
      renderer?.destroy();
    },
  };
  return sea;
}
