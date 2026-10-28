// `createSea`: a sea state drawn on a canvas, with a handle to drive it (specification
// `ocean-package`, "A sea on a canvas"). The handle owns the frame loop, which runs only while
// motion is allowed, the document is visible and the canvas is in view.

import { paletteOf, type StyleSource } from "./colors.js";
import type { Frame, Quality, Renderer, Shape } from "./frame.js";
import { webglRenderer } from "./render-webgl.js";
import { viewOf, type View } from "./scene.js";
import { definitionOf, type SeaState } from "./states.js";

export interface SeaOptions {
  /** The sea state to draw. */
  readonly state: SeaState;
  /** Draw one frame and never animate (`prefers-reduced-motion: reduce`). */
  readonly reducedMotion?: boolean;
  /** The scroll progress through the hero, between 0 and 1. */
  readonly progress?: number;
  /** The wind's strength, between 0 and 1. */
  readonly wind?: number;
}

export interface Figures {
  /** The sails following the mark. */
  readonly sails: number;
  /** The links the wind draws between points. */
  readonly links: number;
}

export interface Sea {
  readonly renderer: "webgl2" | "2d" | "none";
  readonly state: SeaState;
  /** How many frames have been drawn. */
  readonly frames: number;
  readonly figures: Figures;
  readonly progress: number;
  readonly wind: number;
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
    callback: (entries: { readonly isIntersecting: boolean }[]) => void,
  ) => { observe(target: Element): void; disconnect(): void };
  devicePixelRatio(): number;
  coarsePointer(): boolean;
  style(element: Element): StyleSource | undefined;
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

/** Frames measured before the quality is judged, and the p95 above which it is halved. */
export const JUDGED_FRAMES = 90;
export const SLOW_FRAME_MS = 20;

function checkUnit(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be between 0 and 1; received ${String(value)}`);
  }
  return value;
}

/** Picks a renderer for the canvas: WebGL2 first, then Canvas 2D, else none. */
export type RendererFactory = (
  canvas: HTMLCanvasElement,
  palette: ReturnType<typeof paletteOf>,
) => Renderer | undefined;

export const chooseRenderer: RendererFactory = (canvas, palette) => {
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
      return undefined;
    }
  }
  return undefined;
};

/** Draws a sea state on a canvas and returns its handle. */
export function createSea(
  canvas: HTMLCanvasElement,
  options: SeaOptions,
  environment?: Partial<Environment>,
  factory: RendererFactory = chooseRenderer,
): Sea {
  const env: Environment = { ...browserEnvironment(), ...environment };
  const definition = definitionOf(options.state);
  let progress = checkUnit("progress", options.progress ?? 0);
  let wind = checkUnit("wind", options.wind ?? 0.6);
  const still = options.reducedMotion === true || !definition.animated;

  let palette = paletteOf(env.style(canvas));
  const renderer = factory(canvas, palette);

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
  };

  const shapes = (): Shape[] => [];

  const draw = () => {
    if (!renderer || destroyed) return;
    const frame: Frame = {
      view,
      dpr,
      t: seaTime,
      state: definition.state,
      quality,
      shapes: shapes(),
    };
    renderer.draw(frame);
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
      }
    }
    last = now;
    seaTime += dt;
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
      return { sails: definition.sails, links: definition.links };
    },
    get progress() {
      return progress;
    },
    get wind() {
      return wind;
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
      if (!running) draw();
    },
    setWind(value) {
      wind = checkUnit("wind", value);
    },
    restyle() {
      palette = paletteOf(env.style(canvas));
      renderer?.restyle(palette);
      if (!running) draw();
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
