// What a renderer is asked to draw in one frame, and the lattice of the sea's points. Both
// renderers draw the same frame: WebGL2 computes the sea's heights on the GPU from the wave table,
// Canvas 2D computes them with `heightAt`; the shapes above the sea (wind, sails, links) are
// computed once, on the CPU, in CSS pixels.

import type { Palette } from "./colors.js";
import { FAR, NEAR, halfWidthAt, type View } from "./scene.js";
import type { SeaState } from "./states.js";

export type Quality = "high" | "low";

/** Which colour of the palette a shape takes. */
export type Ink = "point" | "crest" | "wind";

export type Shape =
  | {
      readonly kind: "segment";
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
      readonly width: number;
      readonly ink: Ink;
      readonly alpha: number;
    }
  | {
      readonly kind: "triangle";
      readonly points: readonly [number, number, number, number, number, number];
      readonly ink: Ink;
      readonly alpha: number;
    }
  | {
      readonly kind: "dot";
      readonly x: number;
      readonly y: number;
      readonly size: number;
      readonly ink: Ink;
      readonly alpha: number;
    };

export interface Frame {
  readonly view: View;
  /** Device pixels per CSS pixel, already capped. */
  readonly dpr: number;
  /** Seconds of sea time. */
  readonly t: number;
  readonly state: SeaState;
  readonly quality: Quality;
  /** Shapes above the sea, in CSS pixels, drawn after it in order. */
  readonly shapes: readonly Shape[];
}

export interface Renderer {
  readonly kind: "webgl2" | "2d";
  /** The canvas's backing size changed (device pixels). */
  resize(width: number, height: number): void;
  restyle(palette: Palette): void;
  draw(frame: Frame): void;
  destroy(): void;
}

/** The lattice's size: columns across the far row, and rows from near to far. */
export function latticeSize(
  kind: Renderer["kind"],
  quality: Quality,
): {
  readonly columns: number;
  readonly rows: number;
} {
  if (kind === "webgl2")
    return quality === "high" ? { columns: 320, rows: 56 } : { columns: 160, rows: 34 };
  return quality === "high" ? { columns: 150, rows: 28 } : { columns: 96, rows: 20 };
}

/**
 * The sea's points at rest, as world (x, z) pairs: rows evenly spaced in depth, columns on one
 * lattice across every row so they converge toward the horizon, and only the points each row can
 * show (with a margin for the waves).
 */
export function lattice(view: View, columns: number, rows: number): Float32Array {
  const farHalf = halfWidthAt(view, FAR);
  const step = (2 * farHalf) / columns;
  const points: number[] = [];
  for (let r = 0; r < rows; r++) {
    const z = NEAR + ((FAR - NEAR) * r) / (rows - 1);
    const half = halfWidthAt(view, z) + step;
    const first = Math.ceil(-half / step);
    const last = Math.floor(half / step);
    for (let c = first; c <= last; c++) points.push(c * step, z);
  }
  return new Float32Array(points);
}
