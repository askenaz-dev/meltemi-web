// The specification `ocean-package`, "A sea on a canvas" and "Motion only when allowed": the
// handle picks its renderer, draws, re-reads its colours, and runs its loop only while motion is
// allowed, the document is visible and the canvas is in view. Fake canvases and frames stand in
// for the browser.

import { describe, expect, it } from "vitest";
import { createSea, percentile95, pixelRatioCap } from "../src/sea.js";
import { fakeCanvas, harness, recordingContext } from "./fakes.js";

const asCanvas = (c: unknown) => c as HTMLCanvasElement;

describe("a sea on a canvas", () => {
  it("falls back to Canvas 2D on a canvas without WebGL2, and draws the same state", () => {
    const ctx = recordingContext();
    const canvas = fakeCanvas({ "2d": ctx });
    const h = harness();
    const sea = createSea(asCanvas(canvas), { state: "home" }, h.env);
    expect(canvas.asked).toEqual(["webgl2", "2d"]);
    expect(sea.renderer).toBe("2d");
    sea.start();
    expect(sea.frames).toBe(1);
    expect(ctx.calls.filter((c) => c === "rect").length).toBeGreaterThan(100);
  });

  it("reports no renderer and draws nothing on a canvas with no context at all", () => {
    const canvas = fakeCanvas({});
    const h = harness();
    const sea = createSea(asCanvas(canvas), { state: "home" }, h.env);
    sea.start();
    expect(sea.renderer).toBe("none");
    expect(sea.frames).toBe(0);
    expect(h.pending()).toBe(0);
  });

  it("sizes the canvas's backing store to its CSS size at a capped pixel ratio", () => {
    const canvas = fakeCanvas({ "2d": recordingContext() });
    createSea(asCanvas(canvas), { state: "home" }, harness().env);
    expect([canvas.width, canvas.height]).toEqual([1600, 800]);
    expect(pixelRatioCap(3, false)).toBe(2);
    expect(pixelRatioCap(3, true)).toBe(1.5);
    expect(pixelRatioCap(0.5, false)).toBe(1);
  });

  it.each([
    ["an unknown state", () => ({ state: "storm" }), /^state must be one of .*received "storm"$/],
    [
      "a progress above 1",
      () => ({ state: "home", progress: 1.5 }),
      /^progress must be between 0 and 1; received 1\.5$/,
    ],
  ])("refuses %s, naming the option and the value", (_, options, message) => {
    const canvas = fakeCanvas({ "2d": recordingContext() });
    expect(() => createSea(asCanvas(canvas), options() as never, harness().env)).toThrow(message);
  });

  it("refuses a progress outside 0 to 1 once running", () => {
    const sea = createSea(
      asCanvas(fakeCanvas({ "2d": recordingContext() })),
      { state: "home" },
      harness().env,
    );
    expect(() => sea.setProgress(-0.1)).toThrow("progress must be between 0 and 1; received -0.1");
    expect(() => sea.setWind(Number.NaN)).toThrow("wind must be between 0 and 1; received NaN");
  });
});

describe("motion only when allowed", () => {
  it("runs a loop of frames while it is started", () => {
    const h = harness();
    const sea = createSea(
      asCanvas(fakeCanvas({ "2d": recordingContext() })),
      { state: "home" },
      h.env,
    );
    sea.start();
    for (let i = 0; i < 5; i++) h.advance(16);
    expect(sea.frames).toBe(6);
    sea.stop();
    expect(h.pending()).toBe(0);
  });

  it("draws exactly one frame and requests none under reduced motion", () => {
    const h = harness();
    const sea = createSea(
      asCanvas(fakeCanvas({ "2d": recordingContext() })),
      { state: "home", reducedMotion: true },
      h.env,
    );
    sea.start();
    expect(sea.frames).toBe(1);
    expect(h.pending()).toBe(0);
  });

  it("draws one frame and no loop for the still state", () => {
    const h = harness();
    const sea = createSea(
      asCanvas(fakeCanvas({ "2d": recordingContext() })),
      { state: "still" },
      h.env,
    );
    sea.start();
    expect([sea.frames, h.pending()]).toEqual([1, 0]);
  });

  it("requests no frame while the document is hidden, and resumes when it shows", () => {
    const h = harness();
    const sea = createSea(
      asCanvas(fakeCanvas({ "2d": recordingContext() })),
      { state: "home" },
      h.env,
    );
    sea.start();
    h.setHidden(true);
    expect(h.pending()).toBe(0);
    h.advance(1000);
    expect(sea.frames).toBe(1);
    h.setHidden(false);
    expect(h.pending()).toBe(1);
  });

  it("requests no frame while the canvas is out of view", () => {
    const h = harness();
    const sea = createSea(
      asCanvas(fakeCanvas({ "2d": recordingContext() })),
      { state: "home" },
      h.env,
    );
    sea.start();
    h.setInView(false);
    expect(h.pending()).toBe(0);
    h.setInView(true);
    h.advance(16);
    expect(sea.frames).toBe(2);
  });

  it("halves the lattice when the 95th percentile of the first frames is slower than 20 ms", () => {
    const h = harness();
    const sea = createSea(
      asCanvas(fakeCanvas({ "2d": recordingContext() })),
      { state: "home" },
      h.env,
    );
    sea.start();
    for (let i = 0; i < 100; i++) h.advance(40);
    expect(sea.quality).toBe("low");
    const fast = harness();
    const quick = createSea(
      asCanvas(fakeCanvas({ "2d": recordingContext() })),
      { state: "home" },
      fast.env,
    );
    quick.start();
    for (let i = 0; i < 100; i++) fast.advance(16);
    expect(quick.quality).toBe("high");
    expect(percentile95([1, 2, 3, 4, 100])).toBe(100);
  });

  it("releases its loop on destroy", () => {
    const h = harness();
    const sea = createSea(
      asCanvas(fakeCanvas({ "2d": recordingContext() })),
      { state: "home" },
      h.env,
    );
    sea.start();
    sea.destroy();
    expect(h.pending()).toBe(0);
    h.advance(16);
    expect(sea.frames).toBe(1);
  });
});

describe("restyle", () => {
  it("re-reads --sea-* from the canvas, and the next frame uses the new colours", () => {
    const ctx = recordingContext();
    const h = harness();
    h.style.set("--sea-point", "#ff0000");
    const sea = createSea(
      asCanvas(fakeCanvas({ "2d": ctx })),
      { state: "home", reducedMotion: true },
      h.env,
    );
    sea.start();
    expect(ctx.fills).toContain("#ff0000");
    h.style.set("--sea-point", "#00ff00");
    ctx.fills.length = 0;
    sea.restyle();
    expect(ctx.fills).toContain("#00ff00");
    expect(ctx.fills).not.toContain("#ff0000");
  });

  it("falls back to the brand's colours when a property is missing", () => {
    const ctx = recordingContext();
    const sea = createSea(
      asCanvas(fakeCanvas({ "2d": ctx })),
      { state: "home", reducedMotion: true },
      harness().env,
    );
    sea.start();
    expect(ctx.fills).toContain("#2563eb");
  });
});

describe("the mark is placed, never redrawn", () => {
  /** A mark that records every write: only `style.transform` may change. */
  function fakeMark() {
    const writes: string[] = [];
    const style = new Proxy({ transform: "" } as Record<string, string>, {
      set(target, key, value) {
        writes.push(`style.${String(key)}`);
        target[key as string] = value;
        return true;
      },
    });
    const mark = new Proxy(
      {
        offsetWidth: 120,
        offsetHeight: 120,
        style,
        setAttribute: (name: string) => writes.push(`setAttribute ${name}`),
        removeAttribute: (name: string) => writes.push(`removeAttribute ${name}`),
      } as Record<string, unknown>,
      {
        set(target, key, value) {
          writes.push(`property ${String(key)}`);
          target[key as string] = value;
          return true;
        },
      },
    );
    return { mark, style, writes };
  }

  it("sails 10 seconds writing nothing but its transform, never tilting past 4 degrees", () => {
    const { mark, style, writes } = fakeMark();
    const h = harness();
    const sea = createSea(
      asCanvas(fakeCanvas({ "2d": recordingContext() })),
      { state: "home", mark: mark as never },
      h.env,
    );
    sea.start();
    const angles: number[] = [];
    for (let i = 0; i < 625; i++) {
      h.advance(16);
      const rotation = /rotate\((-?[\d.]+)deg\)/.exec(style["transform"] ?? "");
      angles.push(Number(rotation?.[1]));
    }
    expect(new Set(writes)).toEqual(new Set(["style.transform"]));
    expect(Math.max(...angles.map(Math.abs))).toBeLessThanOrEqual(4);
    expect(new Set(angles).size, "it rocks with the sea").toBeGreaterThan(10);
  });

  it("moves the mark across the canvas with progress", () => {
    const { mark } = fakeMark();
    const sea = createSea(
      asCanvas(fakeCanvas({ "2d": recordingContext() })),
      { state: "home", mark: mark as never, reducedMotion: true },
      harness().env,
    );
    sea.start();
    const at = (p: number) => {
      sea.setProgress(p);
      return sea.figures.markX;
    };
    expect(at(0)).toBeCloseTo(800 * 0.18, 0);
    expect(at(1)).toBeCloseTo(800 * 0.82, 0);
    expect(at(0.5)).toBeGreaterThan(at(0.25));
  });
});
