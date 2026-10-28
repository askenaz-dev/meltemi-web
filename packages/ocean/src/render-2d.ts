// The Canvas 2D renderer: the same sea as WebGL2, with fewer points, its heights computed by
// `heightAt` on the CPU. Each row is drawn in two passes (troughs and crests) at one opacity, so a
// frame costs a few dozen fills rather than one per point.

import type { Palette } from "./colors.js";
import { lattice, latticeSize, type Frame, type Renderer } from "./frame.js";
import { FAR, NEAR, project } from "./scene.js";
import { declaredAmplitude, heightAt } from "./waves.js";

/** The part of a 2D context this renderer uses, so tests can hand it a recorder. */
export type Context2D = Pick<
  CanvasRenderingContext2D,
  | "clearRect"
  | "beginPath"
  | "rect"
  | "moveTo"
  | "lineTo"
  | "closePath"
  | "fill"
  | "stroke"
  | "setTransform"
> & {
  fillStyle: CanvasRenderingContext2D["fillStyle"];
  strokeStyle: CanvasRenderingContext2D["strokeStyle"];
  globalAlpha: number;
  lineWidth: number;
  lineCap: CanvasLineCap;
};

export function canvasRenderer(ctx: Context2D, palette: Palette): Renderer {
  let colours = palette;
  let width = 1;
  let height = 1;
  let gridKey = "";
  let grid: Float32Array = new Float32Array(0);
  let rowStarts: number[] = [];

  const ensureGrid = (frame: Frame) => {
    const key = `${frame.view.width}x${frame.view.height}:${frame.quality}`;
    if (key === gridKey) return;
    const { columns, rows } = latticeSize("2d", frame.quality);
    grid = lattice(frame.view, columns, rows);
    rowStarts = [];
    for (let i = 0; i < grid.length; i += 2) {
      if (i === 0 || grid[i + 1] !== grid[i - 1]) rowStarts.push(i);
    }
    rowStarts.push(grid.length);
    gridKey = key;
  };

  return {
    kind: "2d",
    resize(w, h) {
      width = w;
      height = h;
    },
    restyle(p) {
      colours = p;
    },
    draw(frame) {
      ensureGrid(frame);
      const { view, dpr, t, state } = frame;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const max = declaredAmplitude(state);
      const crestFrom = 0.35 * max;
      const base = frame.quality === "high" ? 2.6 : 3.2;
      for (let r = 0; r + 1 < rowStarts.length; r++) {
        const start = rowStarts[r]!;
        const end = rowStarts[r + 1]!;
        const z = grid[start + 1]!;
        const depth = (z - NEAR) / (FAR - NEAR);
        const size = Math.max(1, (base * NEAR) / z);
        const alpha = (1 - depth) * (1 - 0.35 * depth);
        for (const crest of [false, true]) {
          const colour = crest ? colours.crest : colours.point;
          ctx.globalAlpha = alpha * colour.a;
          ctx.fillStyle = colour.css;
          ctx.beginPath();
          let any = false;
          for (let i = start; i < end; i += 2) {
            const x = grid[i]!;
            const y = heightAt(x, z, t, state);
            if (y > crestFrom !== crest) continue;
            const p = project(view, x, y, z);
            if (p.sx < -size || p.sx > view.width + size) continue;
            ctx.rect(p.sx - size / 2, p.sy - size / 2, size, size);
            any = true;
          }
          if (any) ctx.fill();
        }
      }
      ctx.lineCap = "round";
      for (const s of frame.shapes) {
        if (s.alpha <= 0) continue;
        const colour = colours[s.ink];
        ctx.globalAlpha = s.alpha * colour.a;
        if (s.kind === "segment") {
          ctx.strokeStyle = colour.css;
          ctx.lineWidth = s.width;
          ctx.beginPath();
          ctx.moveTo(s.x0, s.y0);
          ctx.lineTo(s.x1, s.y1);
          ctx.stroke();
        } else if (s.kind === "triangle") {
          const p = s.points;
          ctx.fillStyle = colour.css;
          ctx.beginPath();
          ctx.moveTo(p[0], p[1]);
          ctx.lineTo(p[2], p[3]);
          ctx.lineTo(p[4], p[5]);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillStyle = colour.css;
          ctx.beginPath();
          ctx.rect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    },
    destroy() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
    },
  };
}
