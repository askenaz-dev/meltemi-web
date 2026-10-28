// The mark sails (specification `ocean-package`, "The mark is placed, never redrawn"): the package
// only ever writes the mark's CSS transform, a translation onto the sea and a tilt of at most four
// degrees. Its paths, fills, strokes and filters are the brand's and are never touched.

/** The most the mark may tilt, in degrees. */
export const MAX_TILT = 4;

/** Where the hull's keel sits within the mark's box, from its top (the brand file's 226 of 256). */
export const KEEL = 0.86;

export interface MarkPlacement {
  /** The keel's point on the canvas, in CSS pixels. */
  readonly x: number;
  readonly y: number;
  /** Clockwise tilt in degrees, already within MAX_TILT. */
  readonly angle: number;
}

/** What the placement needs of the mark: its size and its style's transform. */
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

/** Writes the mark's transform, and nothing else, so its keel sits on the placement's point. */
export function placeMark(mark: MarkElement, placement: MarkPlacement): void {
  const left = placement.x - mark.offsetWidth / 2;
  const top = placement.y - mark.offsetHeight * KEEL;
  const angle = Math.max(-MAX_TILT, Math.min(MAX_TILT, placement.angle));
  mark.style.transform = `translate(${left.toFixed(2)}px, ${top.toFixed(2)}px) rotate(${angle.toFixed(3)}deg)`;
}
