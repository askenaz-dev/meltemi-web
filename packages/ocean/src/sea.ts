// `createSea`: a sea state drawn on a canvas, with a handle to drive it (specification
// `ocean-package`, "A sea on a canvas"). The handle owns the frame loop, which runs only while
// motion is allowed, the document is visible and the canvas is in view; it sails the fleet the
// page gave it, placing each boat by its transform, and moves nothing else of the page.

import { paletteOf, type Palette } from "./colors.js";
import { compose, type SceneFigures } from "./compose.js";
import { browserEnvironment, checkUnit, type Environment } from "./environment.js";
import { fleetOf, sail, type Boat } from "./fleet.js";
import type { Quality, Renderer } from "./frame.js";
import { placeMark, type MarkElement } from "./mark.js";
import { canvasRenderer, type Context2D } from "./render-2d.js";
import { webglRenderer } from "./render-webgl.js";
import { viewOf, type View } from "./scene.js";
import { definitionOf, fleetSize, type SeaState } from "./states.js";

export type { Environment } from "./environment.js";

export interface SeaOptions {
  /** The sea state to draw. */
  readonly state: SeaState;
  /** Draw one frame and never animate (`prefers-reduced-motion: reduce`). */
  readonly reducedMotion?: boolean;
  /** The scroll progress through the hero, between 0 and 1. */
  readonly progress?: number;
  /** The wind's strength, between 0 and 1: it speeds the fleet. */
  readonly wind?: number;
  /**
   * The fleet's elements, the lead first, each placed on the sea by its transform only. At most
   * `fleetSize(state)` of them; a shorter fleet sails as many boats as it has elements.
   */
  readonly fleet?: readonly MarkElement[] | null;
}

export type Figures = SceneFigures;

export interface Sea {
  readonly renderer: "webgl2" | "2d" | "none";
  readonly state: SeaState;
  /** How many frames have been drawn. */
  readonly frames: number;
  /** What the last frame drew: the boats, the lead's place, every boat's x, the links. */
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

/** The lead's size when the page gave no element: a fifth of the canvas's height. */
const DEFAULT_MARK = 0.2;

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
  const fleet = options.fleet ?? [];
  if (fleet.length > fleetSize(definition.state)) {
    throw new RangeError(
      `fleet must have at most ${fleetSize(definition.state)} elements for state "${definition.state}"; received ${fleet.length}`,
    );
  }

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
  let boats: Boat[] = [];
  let figures: Figures = { boats: 0, leadX: 0, xs: [], links: 0 };

  const visible = () => !(env.document?.hidden ?? false);
  const markWidth = () => fleet[0]?.offsetWidth || view.height * DEFAULT_MARK;

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
    // The fleet is dealt once, for the first size; the boats keep their world places after.
    if (boats.length === 0) {
      boats = fleetOf(definition.state, view, env.random).slice(
        0,
        Math.max(1, fleet.length || fleetSize(definition.state)),
      );
    }
  };

  const draw = () => {
    if (!renderer || destroyed) return;
    const scene = compose({ view, t: seaTime, state: definition.state, progress, wind, boats });
    fleet.forEach((element, i) => {
      const placement = scene.placements[i];
      if (placement) placeMark(element, placement);
    });
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
    sail(boats, dt, wind, view, seaTime, definition.state, markWidth(), env.random);
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
