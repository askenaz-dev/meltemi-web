// One frame of the scene above the sea, as a pure function of time, progress, wind and the mark's
// size: where the mark sails and how it tilts, the wind's streaks around its clear space, and the
// figures of the state (the IDE's sails, the Diagrams flow). Both renderers draw what it returns.

import type { Shape } from "./frame.js";
import { KEEL, tiltOf, type MarkPlacement } from "./mark.js";
import { MARK_Z, project, worldX, type View } from "./scene.js";
import { definitionOf, type SeaState } from "./states.js";
import { heightAt, slopeAt } from "./waves.js";
import { alphaOf, streak, type Box, type Particle } from "./wind.js";

export interface SceneInput {
  readonly view: View;
  readonly t: number;
  readonly state: SeaState;
  readonly progress: number;
  readonly wind: number;
  readonly particles: readonly Particle[];
  /** The mark's size in CSS pixels, when the page gave a mark. */
  readonly mark?: { readonly width: number; readonly height: number };
}

export interface SceneFigures {
  readonly sails: number;
  readonly links: number;
  /** The widest gap, in degrees, between a following sail's heading and the mark's. */
  readonly spread: number;
  /** The mark's keel, across the canvas, in CSS pixels. */
  readonly markX: number;
}

export interface Scene {
  readonly shapes: Shape[];
  readonly placement: MarkPlacement;
  readonly clearSpace: Box | undefined;
  readonly figures: SceneFigures;
}

/** How the mark's size is guessed when the page gave none: a share of the canvas's height. */
const DEFAULT_MARK = 0.2;

const ease = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

const ramp = (p: number, from: number, to: number) => ease((p - from) / (to - from));

/** How the following sails scatter from the mark's heading at progress 0, in degrees. */
export const SCATTER = [22, -17, 25, -12, 19] as const;

/** Where the following sails sail, behind the mark: back along x and further away in z. */
const SAIL_BEHIND = [0.42, 0.84, 1.26, 1.68, 2.1] as const;
const SAIL_DEPTH = [0.55, 1.1, 0.25, 1.6, 0.9] as const;

/** The Diagrams flow: three nodes ahead of the mark, three points each. */
const NODE_AHEAD = [0.75, 1.35, 1.95] as const;
const NODE_Z = 2.4;
const NODE_POINTS = [
  [-0.07, 0],
  [0.07, 0],
  [0, -0.09],
] as const;

function rotate(x: number, y: number, degrees: number): [number, number] {
  const r = (degrees * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
}

export function compose(input: SceneInput): Scene {
  const { view, t, state, progress, wind } = input;
  const definition = definitionOf(state);
  const shapes: Shape[] = [];

  // The mark: across the canvas with progress, its keel on the sea, tilted by the slope.
  const across = definition.markFrom + (definition.markTo - definition.markFrom) * progress;
  const mx = worldX(view, across * view.width, MARK_Z);
  const keel = project(view, mx, heightAt(mx, MARK_Z, t, state), MARK_Z);
  const angle = tiltOf(slopeAt(mx, MARK_Z, t, state));
  const placement: MarkPlacement = { x: keel.sx, y: keel.sy, angle };
  const markHeight = input.mark?.height ?? view.height * DEFAULT_MARK;
  const markWidth = input.mark?.width ?? markHeight;

  // Its clear space: the mark's box, widened by the small sail's notch on every side.
  const margin = markWidth * 0.12;
  const clearSpace: Box | undefined = input.mark
    ? {
        left: (keel.sx - markWidth / 2 - margin) / view.width,
        right: (keel.sx + markWidth / 2 + margin) / view.width,
        top: (keel.sy - markHeight * KEEL - margin) / view.height,
        bottom: (keel.sy + markHeight * (1 - KEEL) + margin) / view.height,
      }
    : undefined;

  // The wind's streaks.
  const strokeWidth = Math.max(1, view.height / 520);
  for (const p of input.particles) {
    const alpha = alphaOf(p, wind, clearSpace) * 0.6;
    if (alpha <= 0.01) continue;
    const [u0, v0, u1, v1] = streak(p, t, wind);
    shapes.push({
      kind: "segment",
      x0: u0 * view.width,
      y0: v0 * view.height,
      x1: u1 * view.width,
      y1: v1 * view.height,
      width: strokeWidth,
      ink: "wind",
      alpha,
    });
  }

  // The IDE's following sails: they converge on the mark's heading as the page scrolls.
  let spread = 0;
  for (let i = 0; i < definition.sails; i++) {
    const x = mx - SAIL_BEHIND[i]!;
    const z = MARK_Z + SAIL_DEPTH[i]!;
    const base = project(view, x, heightAt(x, z, t, state), z);
    const heading = angle + SCATTER[i]! * (1 - ease(progress));
    spread = Math.max(spread, Math.abs(heading - angle));
    const h = markHeight * 0.4 * (MARK_Z / z);
    const corner = (dx: number, dy: number): [number, number] => {
      const [rx, ry] = rotate(dx * h, dy * h, heading);
      return [base.sx + rx, base.sy + ry];
    };
    const fade = 0.55 + 0.4 * (1 - (z - MARK_Z) / 2);
    const [ax, ay] = corner(0.05, -1);
    const [bx, by] = corner(0.05, -0.12);
    const [cx, cy] = corner(-0.62, -0.12);
    shapes.push({ kind: "triangle", points: [ax, ay, bx, by, cx, cy], ink: "point", alpha: fade });
    const [hx0, hy0] = corner(-0.5, 0);
    const [hx1, hy1] = corner(0.4, 0);
    shapes.push({
      kind: "segment",
      x0: hx0,
      y0: hy0,
      x1: hx1,
      y1: hy1,
      width: Math.max(1.5, h * 0.09),
      ink: "point",
      alpha: fade,
    });
  }

  // The Diagrams flow: nine points lift out of the sea and the wind links them into three nodes.
  let links = 0;
  if (definition.links > 0) {
    const lift = ramp(progress, 0, 0.35) * 0.22;
    const nodes = NODE_AHEAD.map((ahead) =>
      NODE_POINTS.map(([dx, dz]) => {
        const x = mx + ahead + dx;
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
    placement,
    clearSpace,
    figures: { sails: definition.sails, links, spread, markX: keel.sx },
  };
}
