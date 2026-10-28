// The wind of design D1 and D3: it blows up and to the right, the way the mark's gust points, and
// a particle inside the mark's clear space is never drawn.

import { describe, expect, it } from "vitest";
import { alphaOf, flowAt, particles, seeded, step, streak, type Box } from "../src/wind.js";

describe("the wind", () => {
  it("blows up and to the right everywhere, at every time", () => {
    for (let u = 0; u <= 1; u += 0.05) {
      for (let v = 0; v <= 1; v += 0.05) {
        for (const t of [0, 3.7, 41]) {
          const [du, dv] = flowAt(u, v, t);
          expect(du, `right at ${u},${v},${t}`).toBeGreaterThan(0);
          expect(dv, `up at ${u},${v},${t}`).toBeLessThan(0);
          expect(Math.hypot(du, dv)).toBeCloseTo(1, 12);
        }
      }
    }
  });

  it("carries particles across the canvas, and stronger wind carries them further", () => {
    const run = (strength: number) => {
      const all = particles(200, seeded(7));
      const before = all.map((p) => p.u);
      step(all, 0.1, 1, strength, seeded(8));
      return all.reduce((sum, p, i) => sum + (p.u - before[i]!), 0);
    };
    expect(run(1)).toBeGreaterThan(run(0.2));
    expect(run(0.2)).toBeGreaterThan(0);
  });

  it("draws nothing inside the mark's clear space", () => {
    const box: Box = { left: 0.4, top: 0.5, right: 0.6, bottom: 0.8 };
    const inside = { u: 0.5, v: 0.6, age: 2, life: 4, speed: 0.1 };
    const outside = { u: 0.2, v: 0.6, age: 2, life: 4, speed: 0.1 };
    expect(alphaOf(inside, 1, box)).toBe(0);
    expect(alphaOf(outside, 1, box)).toBeGreaterThan(0.9);
  });

  it("fades a particle in and out over its life", () => {
    expect(alphaOf({ u: 0.2, v: 0.5, age: 0, life: 4, speed: 0.1 }, 1, undefined)).toBe(0);
    expect(alphaOf({ u: 0.2, v: 0.5, age: 4, life: 4, speed: 0.1 }, 1, undefined)).toBeCloseTo(0);
  });

  it("trails each particle behind its head, along the flow", () => {
    const p = { u: 0.5, v: 0.5, age: 1, life: 4, speed: 0.1 };
    const [u0, v0, u1, v1] = streak(p, 0, 1);
    expect(u1).toBe(0.5);
    expect(v1).toBe(0.5);
    expect(u0).toBeLessThan(u1);
    expect(v0).toBeGreaterThan(v1);
  });

  it("repeats the same particles from the same seed", () => {
    expect(particles(5, seeded(42))).toEqual(particles(5, seeded(42)));
  });
});
