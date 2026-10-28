// Still pictures (specification `ocean-package`, "Still pictures from the same sea"): the state at
// rest, drawn from the same wave function, wind and figures as the moving sea, as an SVG that
// pages show where nothing moves (no script, no WebGL or Canvas). One picture per scheme, its
// colours as attributes: an SVG's own `<style>` would fall under the page's policy.

import { compose } from "./compose.js";
import { lattice } from "./frame.js";
import { FAR, NEAR, project, viewOf } from "./scene.js";
import { definitionOf, type SeaState } from "./states.js";
import { declaredAmplitude, heightAt } from "./waves.js";
import { particles, seeded } from "./wind.js";

export type Scheme = "light" | "dark";

export interface StillColours {
  readonly point: string;
  readonly crest: string;
  readonly wind: string;
}

/** The brand's values: Aegean blue points, wind cyan crests and wind. */
export const BRAND_STILL: Readonly<Record<Scheme, StillColours>> = {
  light: { point: "#2563eb", crest: "#22d3ee", wind: "#2563eb" },
  dark: { point: "#60a5fa", crest: "#22d3ee", wind: "#22d3ee" },
};

export interface StillOptions {
  readonly scheme?: Scheme;
  readonly colours?: Partial<StillColours>;
  /** The picture's size in its own units; it is drawn to cover the hero. */
  readonly width?: number;
  readonly height?: number;
}

/** Where each state rests: the story told without motion. */
const REST: Readonly<Record<SeaState, number>> = { home: 0.35, ide: 1, diagrams: 1, still: 0 };

/** A moment of the sea that reads well at rest. */
const MOMENT = 2.2;

const round = (n: number) => Math.round(n * 10) / 10;

function safe(colour: string): string {
  if (!/^(#[0-9a-f]{3,8}|rgba?\([\d.,\s/%]+\))$/i.test(colour.trim())) {
    throw new RangeError(
      `a still picture's colour must be #hex or rgb(); received ${JSON.stringify(colour)}`,
    );
  }
  return colour.trim();
}

/** The SVG of a state at rest, for one scheme. */
export function stillPicture(state: SeaState, options: StillOptions = {}): string {
  definitionOf(state);
  const scheme = options.scheme ?? "light";
  const colours: StillColours = {
    point: safe(options.colours?.point ?? BRAND_STILL[scheme].point),
    crest: safe(options.colours?.crest ?? BRAND_STILL[scheme].crest),
    wind: safe(options.colours?.wind ?? BRAND_STILL[scheme].wind),
  };
  const width = options.width ?? 1600;
  const height = options.height ?? 640;
  const view = viewOf(width, height);
  const max = declaredAmplitude(state);
  const grid = lattice(view, 110, 14);

  // Rows of dots, grouped by depth (one opacity) and by trough or crest (one colour); within a
  // row each square moves relative to the last, which keeps the picture small.
  const rows = new Map<
    number,
    { point: [number, number, number][]; crest: [number, number, number][] }
  >();
  for (let i = 0; i < grid.length; i += 2) {
    const x = grid[i]!;
    const z = grid[i + 1]!;
    const y = heightAt(x, z, MOMENT, state);
    const p = project(view, x, y, z);
    const size = round(Math.max(1.2, (3.4 * NEAR) / z));
    if (p.sx < -size || p.sx > width + size) continue;
    const row = rows.get(z) ?? { point: [], crest: [] };
    rows.set(z, row);
    (y > 0.35 * max ? row.crest : row.point).push([
      round(p.sx - size / 2),
      round(p.sy - size / 2),
      size,
    ]);
  }
  const squares = (dots: [number, number, number][]): string => {
    let d = "";
    let px = 0;
    let py = 0;
    dots.forEach(([x, y, s], i) => {
      d += i === 0 ? `M${x} ${y}` : `m${round(x - px)} ${round(y - py)}`;
      d += `h${s}v${s}h-${s}z`;
      px = x;
      py = y;
    });
    return d;
  };
  const groups: string[] = [];
  for (const [z, row] of rows) {
    const depth = (z - NEAR) / (FAR - NEAR);
    const opacity = round((1 - depth) * (1 - 0.35 * depth) * 100) / 100;
    if (row.point.length)
      groups.push(
        `<path fill="${colours.point}" fill-opacity="${opacity}" d="${squares(row.point)}"/>`,
      );
    if (row.crest.length)
      groups.push(
        `<path fill="${colours.crest}" fill-opacity="${opacity}" d="${squares(row.crest)}"/>`,
      );
  }

  // The wind and the figures, as the moving sea draws them at this moment.
  const scene = compose({
    view,
    t: MOMENT,
    state,
    progress: REST[state],
    wind: 0.7,
    particles: definitionOf(state).animated ? particles(26, seeded(11)) : [],
    mark: { width: height * 0.2, height: height * 0.2 },
  });
  const inks = { point: colours.point, crest: colours.crest, wind: colours.wind };
  const shapes: string[] = [];
  for (const s of scene.shapes) {
    if (s.alpha <= 0.02) continue;
    const a = round(s.alpha * 100) / 100;
    if (s.kind === "segment") {
      shapes.push(
        `<path d="M${round(s.x0)} ${round(s.y0)}L${round(s.x1)} ${round(s.y1)}" stroke="${inks[s.ink]}" stroke-opacity="${a}" stroke-width="${round(s.width * 1.2)}" stroke-linecap="round"/>`,
      );
    } else if (s.kind === "triangle") {
      const p = s.points.map(round);
      shapes.push(
        `<path d="M${p[0]} ${p[1]}L${p[2]} ${p[3]}L${p[4]} ${p[5]}Z" fill="${inks[s.ink]}" fill-opacity="${a}"/>`,
      );
    } else {
      const h = s.size / 2;
      shapes.push(
        `<path d="M${round(s.x - h)} ${round(s.y - h)}h${round(s.size)}v${round(s.size)}h-${round(s.size)}z" fill="${inks[s.ink]}" fill-opacity="${a}"/>`,
      );
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="xMidYMax slice">`,
    ...groups,
    ...shapes,
    "</svg>",
    "",
  ].join("\n");
}
