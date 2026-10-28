// Where the sea is seen from: a camera one unit above it, looking at the horizon. World x runs
// across, z away from the viewer, y up. The view maps the world to the canvas in CSS pixels; the
// renderers scale by the device pixel ratio themselves.

/** The nearest row of the sea, at the bottom edge of the canvas. */
export const NEAR = 1;
/** The farthest row, just under the horizon, where the sea fades out. */
export const FAR = 8;
/** The camera's height above the sea. */
export const CAMERA_HEIGHT = 1;
/** The horizon, as a fraction of the canvas's height from its top. */
export const HORIZON = 0.46;
/** The depth the mark sails at: near, so it reads at full size. */
export const MARK_Z = 1.5;

export interface View {
  /** The canvas's size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** The horizon's distance from the top, in CSS pixels. */
  readonly horizon: number;
  /** The focal length, in CSS pixels: a point at sea level and depth NEAR sits on the bottom edge. */
  readonly focal: number;
}

export function viewOf(width: number, height: number): View {
  const horizon = height * HORIZON;
  return { width, height, horizon, focal: ((height - horizon) * NEAR) / CAMERA_HEIGHT };
}

/** Where a point of the world lands on the canvas, in CSS pixels, and how much it is scaled. */
export function project(
  view: View,
  x: number,
  y: number,
  z: number,
): { readonly sx: number; readonly sy: number; readonly scale: number } {
  const scale = view.focal / z;
  return { sx: view.width / 2 + x * scale, sy: view.horizon + (CAMERA_HEIGHT - y) * scale, scale };
}

/** The world x that lands at a given horizontal position of the canvas, at depth z. */
export function worldX(view: View, sx: number, z: number): number {
  return ((sx - view.width / 2) * z) / view.focal;
}

/** The half-width of the world the canvas sees at depth z. */
export function halfWidthAt(view: View, z: number): number {
  return (view.width / 2) * (z / view.focal);
}
