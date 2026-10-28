// The specification `ocean-package`, "A wind across a surface" and "The wind moves only when
// allowed": a field that heads to the upper right and bends, trails that persist and fade, one
// frame under reduced motion, none while hidden, and a strength that is checked.

import { describe, expect, it } from "vitest";
import { noise2, seeded } from "../src/noise.js";
import { createWind, flowAt, particleCount, speedAt, streamlines } from "../src/wind.js";
import { fakeCanvas, harness, recordingContext } from "./fakes.js";

const asCanvas = (c: unknown) => c as HTMLCanvasElement;

describe("the wind's field", () => {
  const noise = noise2(5);

  it("heads to the upper right on the whole, bending on the way", () => {
    let sumX = 0;
    let sumY = 0;
    let bent = false;
    for (let x = 0; x < 1600; x += 40) {
      for (let y = 0; y < 900; y += 40) {
        const [dx, dy] = flowAt(x, y, 2, noise);
        expect(Math.hypot(dx, dy)).toBeCloseTo(1, 12);
        sumX += dx;
        sumY += dy;
        if (Math.abs(Math.atan2(dy, dx) + (19 * Math.PI) / 180) > 0.2) bent = true;
      }
    }
    expect(sumX).toBeGreaterThan(0);
    expect(sumY).toBeLessThan(0);
    expect(bent, "the flow is not one straight angle").toBe(true);
  });

  it("blows faster in a fresher wind, and breathes", () => {
    expect(speedAt(100, 100, 0, 1, noise)).toBeGreaterThan(speedAt(100, 100, 0, 0.2, noise));
    const speeds = new Set<number>();
    for (let x = 0; x < 2000; x += 50) speeds.add(speedAt(x, 300, 0, 0.6, noise));
    expect(speeds.size).toBeGreaterThan(10);
  });

  it("draws the same streamlines from the same seed", () => {
    const a = streamlines(800, 400, 5, seeded(9), noise2(3));
    const b = streamlines(800, 400, 5, seeded(9), noise2(3));
    expect(a).toEqual(b);
    expect(a).toHaveLength(5);
    expect(a[0]).toHaveLength(82);
  });

  it("carries a few hundred particles on a laptop screen, and never too many", () => {
    expect(particleCount(1280, 800)).toBe(200);
    expect(particleCount(3840, 2160)).toBe(1382);
    expect(particleCount(7680, 4320)).toBe(1400);
    expect(particleCount(320, 480)).toBe(200);
  });
});

describe("a wind across a surface", () => {
  it("fades the surface and strokes every particle each frame, never clearing it", () => {
    // Scenario: Trails that persist and fade.
    const ctx = recordingContext();
    const h = harness();
    const wind = createWind(asCanvas(fakeCanvas({ "2d": ctx })), {}, h.env);
    expect(wind.renderer).toBe("2d");
    wind.start();
    for (let i = 0; i < 125; i++) h.advance(16);
    expect(wind.frames).toBe(125);
    expect(ctx.calls.filter((c) => c === "fillRect")).toHaveLength(125);
    expect(ctx.calls.filter((c) => c === "stroke")).toHaveLength(125);
    expect(ctx.calls).not.toContain("clearRect");
    expect(ctx.rects[0]).toMatch(/^destination-out rgba\(0, 0, 0, 0\.0\d+\)$/);
    expect(ctx.calls.filter((c) => c === "lineTo").length).toBe(125 * wind.particles);
    expect(ctx.strokeStyle).toBe("#22d3ee");
    wind.destroy();
    expect(h.pending()).toBe(0);
  });

  it("draws one frame of streamlines and requests none under reduced motion", () => {
    // Scenario: One frame under reduced motion.
    const ctx = recordingContext();
    const h = harness();
    const wind = createWind(asCanvas(fakeCanvas({ "2d": ctx })), { reducedMotion: true }, h.env);
    wind.start();
    expect(wind.frames).toBe(1);
    expect(h.pending()).toBe(0);
    expect(ctx.calls).toContain("stroke");
    expect(ctx.calls).not.toContain("fillRect");
  });

  it("requests no frame while the document is hidden, and resumes when it shows", () => {
    // Scenario: A hidden document.
    const h = harness();
    const wind = createWind(asCanvas(fakeCanvas({ "2d": recordingContext() })), {}, h.env);
    wind.start();
    h.advance(16);
    h.setHidden(true);
    expect(h.pending()).toBe(0);
    const drawn = wind.frames;
    h.advance(1000);
    expect(wind.frames).toBe(drawn);
    h.setHidden(false);
    expect(h.pending()).toBe(1);
  });

  it("strokes in --sea-wind after restyle", () => {
    const ctx = recordingContext();
    const h = harness();
    h.style.set("--sea-wind", "#ff0000");
    const wind = createWind(asCanvas(fakeCanvas({ "2d": ctx })), {}, h.env);
    wind.start();
    h.advance(16);
    expect(ctx.strokeStyle).toBe("#ff0000");
    h.style.set("--sea-wind", "rgb(1, 2, 3)");
    wind.restyle();
    h.advance(16);
    expect(ctx.strokeStyle).toBe("rgb(1, 2, 3)");
  });

  it("refuses a strength outside 0 to 1, naming it", () => {
    // Scenario: A strength outside the range.
    const wind = createWind(asCanvas(fakeCanvas({ "2d": recordingContext() })), {}, harness().env);
    expect(() => wind.setStrength(1.5)).toThrow("strength must be between 0 and 1; received 1.5");
    expect(() => wind.setStrength(Number.NaN)).toThrow("received NaN");
    expect(() =>
      createWind(
        asCanvas(fakeCanvas({ "2d": recordingContext() })),
        { strength: -1 },
        harness().env,
      ),
    ).toThrow("strength must be between 0 and 1; received -1");
  });

  it("reports no renderer and draws nothing without a 2D context", () => {
    const h = harness();
    const wind = createWind(asCanvas(fakeCanvas({})), {}, h.env);
    expect(wind.renderer).toBe("none");
    wind.start();
    expect(wind.frames).toBe(0);
    expect(h.pending()).toBe(0);
  });
});
