// The fleet (design D1, D2): boats at depths, each a copy of the mark, all sailing to the right.
// A boat that has left the right edge re-enters from the left, behind every other, at a new
// depth, so the crossing never ends and the boats never pile up. The lead sails nearest, at the
// depth the mark always had; the rest sail farther and smaller.

import { KEEL, tiltOf, type MarkPlacement } from "./mark.js";
import { MARK_Z, project, worldX, type View } from "./scene.js";
import { definitionOf, fleetSize, type SeaState } from "./states.js";
import { heightAt, slopeAt } from "./waves.js";

export interface Boat {
  /** World x, at the boat's own depth. */
  x: number;
  /** Depth: MARK_Z for the lead, deeper for the rest. */
  z: number;
  /** Its own pace against the fleet's, around 1. */
  readonly pace: number;
}

/** The depths the fleet is dealt, after the lead, and the pool a re-entering boat picks from. */
export const DEPTHS = [2.1, 3.2, 2.6, 4.0, 1.9, 3.6, 2.3, 2.9] as const;

/** The least and the most a boat is scaled by its depth. */
const MIN_SCALE = 0.3;

/** How a boat's size follows its depth: the lead at 1, a boat twice as far at about half. */
export function scaleOf(z: number): number {
  return Math.max(MIN_SCALE, Math.min(1, MARK_Z / z));
}

/** World units per second at a wind strength: a lead boat crosses a wide hero in about 20 s. */
export function paceAt(wind: number, z: number): number {
  // Far boats would crawl under pure perspective; they keep most of the lead's screen pace.
  return (0.16 + 0.14 * wind) * Math.pow(z / MARK_Z, 0.6);
}

/** The fleet of a state at rest: the lead where the still picture rests it, the others spread. */
export function fleetOf(state: SeaState, view: View, random: () => number): Boat[] {
  const definition = definitionOf(state);
  const count = fleetSize(state);
  const across = definition.markFrom + (definition.markTo - definition.markFrom) * definition.rest;
  const boats: Boat[] = [{ x: worldX(view, across * view.width, MARK_Z), z: MARK_Z, pace: 1 }];
  for (let i = 1; i < count; i++) {
    const z = DEPTHS[(i - 1) % DEPTHS.length]!;
    // Spread along the width, each in its own slot so the fleet starts without a pile.
    const slot = (i + random() * 0.6 - 0.3) / count;
    boats.push({
      x: worldX(view, ((slot + 0.5) % 1) * view.width, z),
      z,
      pace: 0.85 + random() * 0.3,
    });
  }
  return boats;
}

/** Where a boat's keel sits on the sea, and how it tilts, at a moment. */
export function placementOf(boat: Boat, view: View, t: number, state: SeaState): MarkPlacement {
  const keel = project(view, boat.x, heightAt(boat.x, boat.z, t, state), boat.z);
  return {
    x: keel.sx,
    y: keel.sy,
    angle: tiltOf(slopeAt(boat.x, boat.z, t, state)),
    scale: scaleOf(boat.z),
  };
}

/** A boat's box on the canvas, in CSS pixels, from its placement and the lead's size. */
export function boxOf(
  placement: MarkPlacement,
  markWidth: number,
  markHeight: number,
): { left: number; right: number; top: number; bottom: number } {
  const w = markWidth * placement.scale;
  const h = markHeight * placement.scale;
  return {
    left: placement.x - w / 2,
    right: placement.x + w / 2,
    top: placement.y - h * KEEL,
    bottom: placement.y + h * (1 - KEEL),
  };
}

/**
 * Sails the fleet for `dt` seconds. A boat whose box has left the right edge re-enters from the
 * left, behind every other boat's box, at a new depth (the lead keeps its own). Returns the boats
 * that re-entered, for the checks.
 */
export function sail(
  boats: Boat[],
  dt: number,
  wind: number,
  view: View,
  t: number,
  state: SeaState,
  markWidth: number,
  random: () => number,
): Boat[] {
  const reentered: Boat[] = [];
  for (const boat of boats) boat.x += paceAt(wind, boat.z) * boat.pace * dt;
  for (let i = 0; i < boats.length; i++) {
    const boat = boats[i]!;
    const placement = placementOf(boat, view, t, state);
    const half = (markWidth * placement.scale) / 2;
    if (placement.x - half <= view.width) continue;
    if (i > 0) boat.z = DEPTHS[Math.floor(random() * DEPTHS.length)]!;
    const scale = scaleOf(boat.z);
    let leftmost = 0;
    for (const other of boats) {
      if (other === boat) continue;
      const p = placementOf(other, view, t, state);
      leftmost = Math.min(leftmost, p.x - (markWidth * p.scale) / 2);
    }
    const gap = markWidth * scale * (0.4 + random() * 0.8);
    boat.x = worldX(view, leftmost - gap - (markWidth * scale) / 2, boat.z);
    reentered.push(boat);
  }
  return reentered;
}
