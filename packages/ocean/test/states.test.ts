// The specification `ocean-package`, "Named sea states": the package knows exactly four states,
// the IDE's sails fall into line on the mark's heading as progress grows, and the Diagrams flow is
// drawn by links that appear with progress.

import { describe, expect, it } from "vitest";
import { compose } from "../src/compose.js";
import { STATES, definitionOf, restProgress } from "../src/states.js";
import { viewOf } from "../src/scene.js";
import { particles, seeded } from "../src/wind.js";

const view = viewOf(1200, 560);
const scene = (state: (typeof STATES)[number], progress: number, t = 3) =>
  compose({
    view,
    t,
    state,
    progress,
    wind: 0.8,
    particles: particles(60, seeded(3)),
    mark: { width: 120, height: 120 },
  });

describe("named sea states", () => {
  it("knows exactly home, ide, diagrams and still", () => {
    expect([...STATES]).toEqual(["home", "ide", "diagrams", "still"]);
    for (const state of STATES) expect(definitionOf(state).state).toBe(state);
  });

  it("refuses an unknown state, naming the option and the value", () => {
    expect(() => definitionOf("storm")).toThrow(
      'state must be one of home, ide, diagrams, still; received "storm"',
    );
  });

  it("rests each state where its story is told: the sails in line, the flow drawn", () => {
    for (const state of STATES) {
      expect(restProgress(state)).toBeGreaterThanOrEqual(0);
      expect(restProgress(state)).toBeLessThanOrEqual(1);
    }
    expect(restProgress("ide")).toBe(1);
    expect(restProgress("diagrams")).toBe(1);
    expect(() => restProgress("storm" as never)).toThrow("state must be one of");
  });

  it("follows the IDE's mark with at least three sails that line up on its heading", () => {
    const start = scene("ide", 0);
    const end = scene("ide", 1);
    expect(start.figures.sails).toBeGreaterThanOrEqual(3);
    expect(start.figures.spread).toBeGreaterThan(20);
    expect(scene("ide", 0.5).figures.spread).toBeLessThan(start.figures.spread);
    expect(end.figures.spread).toBeCloseTo(0, 6);
    const sails = end.shapes.filter((s) => s.kind === "triangle");
    expect(sails.length).toBe(end.figures.sails);
  });

  it("draws the Diagrams flow as links that appear with progress", () => {
    expect(scene("diagrams", 0).figures.links).toBe(0);
    expect(scene("diagrams", 0.5).figures.links).toBeGreaterThan(0);
    expect(scene("diagrams", 1).figures.links).toBe(11);
    const dots = scene("diagrams", 1).shapes.filter((s) => s.kind === "dot");
    expect(dots.length).toBe(9);
  });

  it("draws neither sails nor links on the home's crossing", () => {
    const home = scene("home", 0.7);
    expect([home.figures.sails, home.figures.links]).toEqual([0, 0]);
    expect(home.shapes.every((s) => s.ink === "wind")).toBe(true);
  });

  it("keeps the wind out of the mark's clear space", () => {
    const { shapes, clearSpace } = scene("home", 0.5);
    expect(clearSpace).toBeDefined();
    const box = clearSpace!;
    for (const s of shapes) {
      if (s.kind !== "segment") continue;
      const u = s.x1 / view.width;
      const v = s.y1 / view.height;
      const inside = u >= box.left && u <= box.right && v >= box.top && v <= box.bottom;
      expect(inside, `a streak's head at ${u.toFixed(3)},${v.toFixed(3)}`).toBe(false);
    }
  });
});
