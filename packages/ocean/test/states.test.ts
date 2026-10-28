// The specification `ocean-package`, "Named sea states": the package knows exactly four states,
// each with its fleet, and the Diagrams flow is drawn by links that appear with progress.

import { describe, expect, it } from "vitest";
import { compose } from "../src/compose.js";
import { fleetOf } from "../src/fleet.js";
import { seeded } from "../src/noise.js";
import { viewOf } from "../src/scene.js";
import { STATES, definitionOf, fleetSize, restProgress } from "../src/states.js";

const view = viewOf(1200, 560);
const scene = (state: (typeof STATES)[number], progress: number, t = 3) =>
  compose({
    view,
    t,
    state,
    progress,
    wind: 0.8,
    boats: fleetOf(state, view, seeded(3)),
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
    expect(() => fleetSize("storm" as never)).toThrow("state must be one of");
  });

  it("rests each state where its story is told", () => {
    for (const state of STATES) {
      expect(restProgress(state)).toBeGreaterThanOrEqual(0);
      expect(restProgress(state)).toBeLessThanOrEqual(1);
    }
    expect(restProgress("ide")).toBe(1);
    expect(restProgress("diagrams")).toBe(1);
    expect(() => restProgress("storm" as never)).toThrow("state must be one of");
  });

  it("places every boat of the fleet and reports them", () => {
    for (const state of STATES) {
      const { placements, figures } = scene(state, 0.5);
      expect(placements).toHaveLength(fleetSize(state));
      expect(figures.boats).toBe(fleetSize(state));
      expect(figures.xs).toHaveLength(fleetSize(state));
      expect(figures.leadX).toBe(placements[0]!.x);
      expect(placements[0]!.scale).toBe(1);
    }
  });

  it("draws the Diagrams flow as links that appear with progress", () => {
    expect(scene("diagrams", 0).figures.links).toBe(0);
    expect(scene("diagrams", 0.5).figures.links).toBeGreaterThan(0);
    expect(scene("diagrams", 1).figures.links).toBe(11);
    const dots = scene("diagrams", 1).shapes.filter((s) => s.kind === "dot");
    expect(dots.length).toBe(9);
  });

  it("draws nothing above the sea on the home's crossing but its fleet", () => {
    const home = scene("home", 0.7);
    expect(home.shapes).toEqual([]);
    expect(home.figures.links).toBe(0);
    expect(home.figures.boats).toBe(6);
  });
});
