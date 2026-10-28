// The specification `ocean-package`, "A wind across a surface" and "The wind moves only when
// allowed": a field that heads to the upper right and bends, short trails that fade and never pile
// up, one frame under reduced motion, none while hidden, and a strength that is checked.

import { describe, expect, it } from "vitest";
import { noise2, seeded } from "../src/noise.js";
import {
  ALPHA,
  RANGE_MIN,
  RANGE_SPREAD,
  SPACING,
  TAIL,
  createWind,
  envelope,
  flowAt,
  particleCount,
  speedAt,
  streamlines,
} from "../src/wind.js";
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

  it("carries about a hundred particles on a laptop screen, and never too many", () => {
    expect(particleCount(1280, 800)).toBe(100);
    expect(particleCount(1920, 1080)).toBe(189);
    expect(particleCount(3840, 2160)).toBe(754);
    expect(particleCount(7680, 4320)).toBe(800);
    expect(particleCount(320, 480)).toBe(100);
  });

  it("shows a streak only in the middle of its range, appearing and fading at its ends", () => {
    const range = RANGE_MIN + RANGE_SPREAD / 2;
    expect(envelope(0, range)).toBe(0);
    expect(envelope(range, range)).toBe(0);
    expect(envelope(range * 0.5, range)).toBe(1);
    expect(envelope(range * 0.05, range)).toBeGreaterThan(0);
    expect(envelope(range * 0.05, range)).toBeLessThan(envelope(range * 0.1, range));
    expect(envelope(range * 0.9, range)).toBeLessThan(envelope(range * 0.7, range));
    expect(envelope(range * 2, range), "past its range a streak is gone").toBe(0);
  });
});

describe("a wind across a surface", () => {
  it("draws short streaks from a clear surface, so nothing piles up", () => {
    // Scenario: Trails that fade and never pile up.
    const ctx = recordingContext();
    const h = harness();
    const wind = createWind(asCanvas(fakeCanvas({ "2d": ctx })), {}, h.env);
    expect(wind.renderer).toBe("2d");
    wind.start();
    const frames = 1250; // 20 seconds at 60 frames per second
    for (let i = 0; i < frames; i++) h.advance(16);
    expect(wind.frames).toBe(frames);

    // Every frame starts from a clear surface; nothing is left to fade by painting over it.
    expect(ctx.calls.filter((c) => c === "clearRect")).toHaveLength(frames);
    expect(ctx.calls).not.toContain("fillRect");

    // No streak is longer than its tail: what a frame draws is bounded by the particles' tails.
    const length = (line: number[]) => {
      let sum = 0;
      for (let i = 2; i < line.length; i += 2) {
        sum += Math.hypot(line[i]! - line[i - 2]!, line[i + 1]! - line[i - 1]!);
      }
      return sum;
    };
    const drawn = ctx.lines.reduce((sum, line) => sum + length(line), 0);
    expect(drawn / frames).toBeLessThanOrEqual(wind.particles * (TAIL + 2 * SPACING));
    for (const line of ctx.lines) expect(length(line)).toBeLessThanOrEqual(TAIL + 2 * SPACING);

    // Streaks fade: the head of one in mid-life is the most opaque thing drawn, and fainter steps
    // exist along the tails and at the ends of ranges.
    expect(Math.max(...ctx.alphas)).toBeLessThanOrEqual(ALPHA + 1e-9);
    expect(Math.min(...ctx.alphas)).toBeLessThan(ALPHA / 4);

    // After 20 seconds every particle has travelled its range at least once and started again:
    // the wind is still blowing.
    const last = ctx.calls.lastIndexOf("clearRect");
    expect(ctx.calls.slice(last).filter((c) => c === "stroke").length).toBeGreaterThan(0);
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
