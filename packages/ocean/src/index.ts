// @meltemi/ocean: the Meltemi family's sea in motion. A field of points rising and falling in
// waves, a fleet of marks sailing on them, and the Etesian wind blowing across the page the way
// the mark's gust points. It draws with WebGL2 and Canvas 2D, makes no request, keeps nothing,
// and depends on nothing. The README is the contract products consume.

export { STATES, restProgress, fleetSize, type SeaState } from "./states.js";
export { heightAt, slopeAt, declaredAmplitude } from "./waves.js";
export { createSea, type Sea, type SeaOptions, type Figures, type Environment } from "./sea.js";
export { createWind, type Wind, type WindOptions } from "./wind.js";
export { placeMark, MAX_TILT, type MarkElement, type MarkPlacement } from "./mark.js";
export { MARK_M, MARK_HULL, MARK_GRADIENT, MARK_STROKE, MARK_BOX } from "./mark-shape.js";
export {
  stillPicture,
  BRAND_STILL,
  type Scheme,
  type StillColours,
  type StillOptions,
} from "./still.js";
