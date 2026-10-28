// Stand-ins for what the sea takes from a browser: a canvas, a recording 2D context, animation
// frames advanced by hand, a document whose visibility a test flips, an IntersectionObserver a
// test triggers, and the computed style of `--sea-*`. No DOM library is needed.

import type { Environment } from "../src/sea.js";

export interface Recorder {
  readonly calls: string[];
  fillStyle: string;
  strokeStyle: string;
  globalAlpha: number;
  lineWidth: number;
  lineCap: CanvasLineCap;
  globalCompositeOperation: string;
  /** The fill styles in use at each `fill()`, in order. */
  readonly fills: string[];
  /** The fill styles in use at each `fillRect()`, in order. */
  readonly rects: string[];
  /** Every polyline drawn: `moveTo` starts one, `lineTo` extends it, as flat x, y pairs. */
  readonly lines: number[][];
  /** The `globalAlpha` in use at each `stroke()`, in order. */
  readonly alphas: number[];
}

/** A 2D context that records what it is asked to do. */
export function recordingContext(): Recorder & Record<string, unknown> {
  const calls: string[] = [];
  const fills: string[] = [];
  const rects: string[] = [];
  const lines: number[][] = [];
  const alphas: number[] = [];
  const ctx: Recorder & Record<string, unknown> = {
    calls,
    fills,
    rects,
    lines,
    alphas,
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    globalCompositeOperation: "source-over",
  };
  for (const name of ["clearRect", "beginPath", "rect", "closePath", "setTransform"]) {
    ctx[name] = () => calls.push(name);
  }
  ctx["moveTo"] = (x: number, y: number) => {
    calls.push("moveTo");
    lines.push([x, y]);
  };
  ctx["lineTo"] = (x: number, y: number) => {
    calls.push("lineTo");
    lines.at(-1)?.push(x, y);
  };
  ctx["stroke"] = () => {
    calls.push("stroke");
    alphas.push(ctx.globalAlpha);
  };
  ctx["fill"] = () => {
    calls.push("fill");
    fills.push(ctx.fillStyle);
  };
  ctx["fillRect"] = () => {
    calls.push("fillRect");
    rects.push(`${ctx.globalCompositeOperation} ${ctx.fillStyle}`);
  };
  return ctx;
}

export interface FakeCanvas {
  clientWidth: number;
  clientHeight: number;
  width: number;
  height: number;
  readonly asked: string[];
  getContext(kind: string): unknown;
  addEventListener(): void;
  removeEventListener(): void;
}

/** A canvas that offers the contexts it is given and records which ones were asked for. */
export function fakeCanvas(contexts: { webgl2?: unknown; "2d"?: unknown }): FakeCanvas {
  const asked: string[] = [];
  return {
    clientWidth: 800,
    clientHeight: 400,
    width: 0,
    height: 0,
    asked,
    getContext(kind: string) {
      asked.push(kind);
      return (contexts as Record<string, unknown>)[kind] ?? null;
    },
    addEventListener() {},
    removeEventListener() {},
  };
}

export interface Harness {
  readonly env: Partial<Environment>;
  /** Animation frames requested and not yet run. */
  pending(): number;
  /** Runs the pending frames once, `ms` after the last ones. */
  advance(ms: number): void;
  /** Hides or shows the document, telling the sea. */
  setHidden(hidden: boolean): void;
  /** Puts the canvas in or out of view, telling the sea. */
  setInView(inView: boolean): void;
  /** The `--sea-*` values the computed style answers. */
  readonly style: Map<string, string>;
}

export function harness(): Harness {
  let now = 0;
  let next = 1;
  const queue = new Map<number, (time: number) => void>();
  let hidden = false;
  const visibility = new Set<() => void>();
  const observers: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
  const style = new Map<string, string>();
  const env: Partial<Environment> = {
    requestFrame: (cb) => {
      const id = next++;
      queue.set(id, cb);
      return id;
    },
    cancelFrame: (id) => {
      queue.delete(id);
    },
    document: {
      get hidden() {
        return hidden;
      },
      addEventListener: (_: string, listener: () => void) => visibility.add(listener),
      removeEventListener: (_: string, listener: () => void) => visibility.delete(listener),
    },
    IntersectionObserver: class {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {}
    } as unknown as Environment["IntersectionObserver"],
    devicePixelRatio: () => 3,
    coarsePointer: () => false,
    style: () => ({ getPropertyValue: (name: string) => style.get(name) ?? "" }),
    random: (() => {
      let s = 1;
      return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
      };
    })(),
  };
  return {
    env,
    style,
    pending: () => queue.size,
    advance(ms) {
      now += ms;
      const due = [...queue.entries()];
      queue.clear();
      for (const [, cb] of due) cb(now);
    },
    setHidden(value) {
      hidden = value;
      for (const listener of visibility) listener();
    },
    setInView(value) {
      for (const cb of observers) cb([{ isIntersecting: value }]);
    },
  };
}
