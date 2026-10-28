// The fleet (specification `ocean-package`, "A sea on a canvas", scenario "The fleet loops"):
// every state is dealt its boats, the lead nearest; all sail to the right, and a boat that leaves
// re-enters from the left, behind every other, at a new depth, so the loop never ends.

import { describe, expect, it } from "vitest";
import { boxOf, fleetOf, paceAt, placementOf, sail, scaleOf } from "../src/fleet.js";
import { seeded } from "../src/noise.js";
import { MARK_Z, viewOf } from "../src/scene.js";
import { STATES, fleetSize } from "../src/states.js";

const view = viewOf(1200, 560);
const MARK = 120;

describe("the fleet", () => {
  it("deals each state its fleet: the lead nearest, the rest farther and smaller", () => {
    for (const state of STATES) {
      const boats = fleetOf(state, view, seeded(1));
      expect(boats).toHaveLength(fleetSize(state));
      expect(boats[0]!.z).toBe(MARK_Z);
      for (const boat of boats.slice(1)) {
        expect(boat.z).toBeGreaterThan(MARK_Z);
        expect(scaleOf(boat.z)).toBeLessThan(1);
        expect(scaleOf(boat.z)).toBeGreaterThanOrEqual(0.3);
      }
    }
    expect(fleetSize("home")).toBe(4);
    expect(fleetSize("ide")).toBe(7);
    expect(fleetSize("diagrams")).toBe(3);
    expect(fleetSize("still")).toBe(1);
  });

  it("sails faster in a fresher wind", () => {
    expect(paceAt(1, MARK_Z)).toBeGreaterThan(paceAt(0.3, MARK_Z));
    expect(paceAt(0, MARK_Z)).toBeGreaterThan(0);
  });

  it("loops: every boat sails right and re-enters from the left, behind the others, within 60 s", () => {
    // Scenario: The fleet loops.
    const random = seeded(4);
    const boats = fleetOf("ide", view, random);
    const reentries = boats.map(() => 0);
    let t = 0;
    let previous = boats.map((b) => placementOf(b, view, t, "ide").x);
    for (let frame = 0; frame < 3750; frame++) {
      const dt = 0.016;
      t += dt;
      const reentered = sail(boats, dt, 1, view, t, "ide", MARK, random);
      const now = boats.map((b) => placementOf(b, view, t, "ide"));
      boats.forEach((boat, i) => {
        if (reentered.includes(boat)) {
          reentries[i] = (reentries[i] ?? 0) + 1;
          const mine = boxOf(now[i]!, MARK, MARK);
          boats.forEach((_, j) => {
            if (j === i) return;
            const theirs = boxOf(now[j]!, MARK, MARK);
            const apart = mine.right <= theirs.left || mine.left >= theirs.right;
            expect(apart, `boat ${i} re-entered inside boat ${j} at ${t.toFixed(1)} s`).toBe(true);
          });
        } else {
          expect(now[i]!.x, `boat ${i} sails right at ${t.toFixed(1)} s`).toBeGreaterThan(
            previous[i]!,
          );
        }
      });
      previous = now.map((p) => p.x);
    }
    for (const [i, count] of reentries.entries()) {
      expect(count, `boat ${i} re-enters`).toBeGreaterThanOrEqual(1);
    }
    expect(boats[0]!.z, "the lead keeps its depth").toBe(MARK_Z);
  });
});
