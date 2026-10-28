// One frame above the sea, as a pure function of the view, the time, the state and the fleet:
// where every boat sits and how it tilts, and the figures of the state (the Diagrams flow). Both
// renderers draw the shapes it returns; the page places the boats it returns.

import { placementOf, type Boat } from "./fleet.js";
import type { Shape } from "./frame.js";
import type { MarkPlacement } from "./mark.js";
import { project, worldX, type View } from "./scene.js";
import { definitionOf, type SeaState } from "./states.js";
import { heightAt } from "./waves.js";

export interface SceneInput {
  readonly view: View;
  /** Seconds of sea time. */
  readonly t: number;
  readonly state: SeaState;
  /** Scroll progress through the hero, 0 to 1: the Diagrams flow forms with it. */
  readonly progress: number;
  /** Wind strength, 0 to 1. */
  readonly wind: number;
  readonly boats: readonly Boat[];
}

export interface SceneFigures {
  /** How many boats sail, the lead included. */
  readonly boats: number;
  /** The lead's keel on the canvas, in CSS pixels. */
  readonly leadX: number;
  /** Every boat's keel x, in the fleet's order. */
  readonly xs: readonly number[];
  /** How many links of the Diagrams flow are drawn. */
  readonly links: number;
}

export interface Scene {
  readonly shapes: readonly Shape[];
  /** Where each boat sits, in the fleet's order. */
  readonly placements: readonly MarkPlacement[];
  readonly figures: SceneFigures;
}

const ease = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

const ramp = (p: number, from: number, to: number) => ease((p - from) / (to - from));

/** The Diagrams flow: three nodes across the hero's middle, three points each. */
const NODE_ACROSS = [0.38, 0.55, 0.72] as const;
const NODE_Z = 2.4;
const NODE_POINTS = [
  [-0.07, 0],
  [0.07, 0],
  [0, -0.09],
] as const;

export function compose(input: SceneInput): Scene {
  const { view, t, state, progress } = input;
  const definition = definitionOf(state);
  const shapes: Shape[] = [];

  const placements = input.boats.map((boat) => placementOf(boat, view, t, state));
  const lead = placements[0];

  // The Diagrams flow: nine points lift out of the sea and the wind links them into three nodes.
  let links = 0;
  if (definition.links > 0) {
    const strokeWidth = Math.max(1, view.height / 520);
    const lift = ramp(progress, 0, 0.35) * 0.22;
    const nodes = NODE_ACROSS.map((across) =>
      NODE_POINTS.map(([dx, dz]) => {
        const x = worldX(view, across * view.width, NODE_Z) + dx;
        const z = NODE_Z + dz;
        return project(view, x, heightAt(x, z, t, state) + lift, z);
      }),
    );
    const dot = Math.max(3, view.height / 140);
    const inner = ramp(progress, 0.25, 0.55);
    for (const node of nodes) {
      for (const [i, j] of [
        [0, 1],
        [1, 2],
        [2, 0],
      ] as const) {
        const a = node[i]!;
        const b = node[j]!;
        if (inner > 0.01) links += 1;
        shapes.push({
          kind: "segment",
          x0: a.sx,
          y0: a.sy,
          x1: b.sx,
          y1: b.sy,
          width: strokeWidth,
          ink: "wind",
          alpha: inner * 0.85,
        });
      }
    }
    const centre = (node: { sx: number; sy: number }[]) => ({
      x: node.reduce((s, p) => s + p.sx, 0) / node.length,
      y: node.reduce((s, p) => s + p.sy, 0) / node.length,
    });
    for (const [from, to, start] of [
      [0, 1, 0.5],
      [1, 2, 0.7],
    ] as const) {
      const a = centre(nodes[from]!);
      const b = centre(nodes[to]!);
      const shown = ramp(progress, start, start + 0.25);
      if (shown > 0.01) links += 1;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const gap = dot * 3;
      const x0 = a.x + ux * gap;
      const y0 = a.y + uy * gap;
      const x1 = a.x + ux * (gap + (len - 2 * gap) * shown);
      const y1 = a.y + uy * (gap + (len - 2 * gap) * shown);
      shapes.push({
        kind: "segment",
        x0,
        y0,
        x1,
        y1,
        width: strokeWidth * 1.4,
        ink: "wind",
        alpha: shown,
      });
      const head = dot * 2.2;
      shapes.push({
        kind: "triangle",
        points: [
          x1 + ux * head * 0.4,
          y1 + uy * head * 0.4,
          x1 - ux * head + -uy * head * 0.55,
          y1 - uy * head + ux * head * 0.55,
          x1 - ux * head - -uy * head * 0.55,
          y1 - uy * head - ux * head * 0.55,
        ],
        ink: "wind",
        alpha: shown,
      });
    }
    for (const node of nodes) {
      for (const p of node) {
        shapes.push({
          kind: "dot",
          x: p.sx,
          y: p.sy,
          size: dot,
          ink: "crest",
          alpha: 0.45 + 0.55 * ramp(progress, 0, 0.35),
        });
      }
    }
  }

  return {
    shapes,
    placements,
    figures: {
      boats: placements.length,
      leadX: lead?.x ?? 0,
      xs: placements.map((p) => p.x),
      links,
    },
  };
}
