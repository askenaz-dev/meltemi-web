// The specification `ocean-package`, "One deterministic sea": the height and slope of the sea are
// pure, bounded by the state's declared amplitude, and refuse inputs that are not numbers.

import { describe, expect, it } from "vitest";
import { STATES } from "../src/states.js";
import { declaredAmplitude, heightAt, slopeAt, waveTable } from "../src/waves.js";

describe("one deterministic sea", () => {
  it("answers the same height and slope for the same position, time and state", () => {
    for (const state of STATES) {
      expect(heightAt(0.3, 2.1, 4.7, state)).toBe(heightAt(0.3, 2.1, 4.7, state));
      expect(slopeAt(-1.2, 1.5, 9.25, state)).toBe(slopeAt(-1.2, 1.5, 9.25, state));
    }
  });

  it("stays within each state's declared amplitude", () => {
    for (const state of STATES) {
      const bound = declaredAmplitude(state);
      let highest = 0;
      for (let x = -6; x <= 6; x += 0.37) {
        for (let z = 1; z <= 8; z += 0.41) {
          for (let t = 0; t < 30; t += 2.9) {
            const h = Math.abs(heightAt(x, z, t, state));
            highest = Math.max(highest, h);
            expect(h).toBeLessThanOrEqual(bound + 1e-12);
          }
        }
      }
      expect(highest, `${state} actually moves`).toBeGreaterThan(bound * 0.3);
    }
  });

  it("is the derivative of its height along x", () => {
    const h = 1e-5;
    for (const [x, z, t] of [
      [0.4, 1.7, 2.2],
      [-2.1, 3.3, 11.5],
      [5.2, 6.1, 0.4],
    ] as const) {
      const numeric = (heightAt(x + h, z, t, "home") - heightAt(x - h, z, t, "home")) / (2 * h);
      expect(slopeAt(x, z, t, "home")).toBeCloseTo(numeric, 5);
    }
  });

  it("moves with time", () => {
    expect(heightAt(0.5, 2, 0, "home")).not.toBe(heightAt(0.5, 2, 1, "home"));
  });

  it("hands every renderer the same table: unit directions and the deep-water dispersion", () => {
    for (const w of waveTable()) {
      expect(Math.hypot(w.dx, w.dz)).toBeCloseTo(1, 12);
      expect(w.omega).toBeCloseTo(Math.sqrt(9.81 * w.k) * 0.32, 12);
    }
  });

  it.each([
    ["x", () => heightAt(Number.NaN, 1, 0, "home")],
    ["z", () => heightAt(0, Number.POSITIVE_INFINITY, 0, "home")],
    ["t", () => slopeAt(0, 1, Number.NaN, "home")],
  ])("refuses a %s that is not a finite number, naming it", (name, call) => {
    expect(call).toThrow(new RegExp(`^${name} must be a finite number`));
  });

  it("refuses an unknown state, naming the option and the value", () => {
    expect(() => heightAt(0, 1, 0, "storm" as never)).toThrow(
      'state must be one of home, ide, diagrams, still; received "storm"',
    );
  });
});
