// The Meltemi mark's shape, as the IDE's `brand/meltemi-mark-gradient.svg` draws it: the `m`
// stroke, the hull, and the gradient from Aegean blue to wind cyan. Pages compare these constants
// with the brand file; the still pictures draw the fleet from them. The package never changes
// them, and never changes a mark it is given.

/** The side of the mark's box, in its own units. */
export const MARK_BOX = 256;

/** The `m`: one stroke from the keel's left to the north-east tip. */
export const MARK_M =
  "M43 178C43 125 57 100 78 100C99 100 109 127 109 176C109 105 132 67 158 67C185 67 199 97 196 132C194 154 185 169 172 177C189 176 205 166 217 152C224 144 230 133 234 122";

/** The hull, filled. */
export const MARK_HULL =
  "M45 199C87 211 145 215 202 189C195 204 177 216 151 220C106 226 67 215 45 199Z";

/** The stroke's width, in the box's units. */
export const MARK_STROKE = 25;

/** The gradient, in the box's units (`gradientUnits="userSpaceOnUse"`). */
export const MARK_GRADIENT = {
  x1: 38,
  y1: 222,
  x2: 219,
  y2: 54,
  from: "#2563eb",
  to: "#22d3ee",
} as const;
