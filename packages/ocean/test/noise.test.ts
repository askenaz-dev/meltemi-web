// The noise the wind bends with: seeded, bounded and smooth.

import { describe, expect, it } from "vitest";
import { noise2, seeded } from "../src/noise.js";

describe("the noise", () => {
  it("repeats from the same seed, and differs by seed", () => {
    const a = noise2(7);
    const b = noise2(7);
    const c = noise2(8);
    expect(a(1.3, 2.7)).toBe(b(1.3, 2.7));
    expect(a(1.3, 2.7)).not.toBe(c(1.3, 2.7));
    expect(seeded(3)()).toBe(seeded(3)());
  });

  it("stays within -1..1 over a grid", () => {
    const n = noise2(1);
    for (let x = -20; x <= 20; x += 0.37) {
      for (let y = -20; y <= 20; y += 0.41) {
        const v = n(x, y);
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is smooth: a small step changes it a little", () => {
    const n = noise2(2);
    for (let i = 0; i < 200; i++) {
      const x = i * 0.73;
      const y = i * 0.31;
      expect(Math.abs(n(x + 0.001, y) - n(x, y))).toBeLessThan(0.02);
    }
  });
});
