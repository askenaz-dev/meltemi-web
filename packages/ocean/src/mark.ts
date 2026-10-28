// The fleet sails (specification `ocean-package`, "The mark is placed, never redrawn"): the
// package only ever writes an element's CSS transform, a translation onto the sea, a scale from
// its depth and a heel of at most six degrees. Its paths, fills, strokes and filters are the
// brand's and are never touched.

/** The most a boat may heel, in degrees. */
export const MAX_TILT = 6;

/** Where the hull's keel sits within the mark's box, from its top (the brand file's 220 of 256). */
export const KEEL = 0.86;

export interface MarkPlacement {
  /** The keel's point on the canvas, in CSS pixels. */
  readonly x: number;
  readonly y: number;
  /** Clockwise tilt in degrees, already within MAX_TILT. */
  readonly angle: number;
  /** The boat's size against the lead's: 1 nearest, smaller farther away. */
  readonly scale: number;
}

/** What the placement needs of a boat: its size and its style's transform. */
export interface MarkElement {
  readonly offsetWidth: number;
  readonly offsetHeight: number;
  readonly style: { transform: string };
}

/** The tilt the sea's slope asks for, clamped: a surface rising to the right lifts the bow. */
export function tiltOf(slope: number): number {
  const degrees = (-Math.atan(slope) * 180) / Math.PI;
  return Math.max(-MAX_TILT, Math.min(MAX_TILT, degrees));
}

/**
 * Writes the element's transform, and nothing else, so its keel sits on the placement's point.
 * The element's `transform-origin` is its keel (50% 86%), so the scale and the tilt pivot there
 * and the keel stays on the wave at any size.
 */
export function placeMark(mark: MarkElement, placement: MarkPlacement): void {
  const left = placement.x - mark.offsetWidth / 2;
  const top = placement.y - mark.offsetHeight * KEEL;
  const angle = Math.max(-MAX_TILT, Math.min(MAX_TILT, placement.angle));
  const scale = Math.max(0.05, Math.min(1, placement.scale));
  mark.style.transform = `translate(${left.toFixed(2)}px, ${top.toFixed(2)}px) scale(${scale.toFixed(3)}) rotate(${angle.toFixed(3)}deg)`;
}
