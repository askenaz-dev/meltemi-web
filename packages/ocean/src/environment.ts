// What the sea and the wind take from the page, and what tests give instead: animation frames,
// the document's visibility, an IntersectionObserver, the pixel ratio, computed styles and a
// random source. Nothing here reaches beyond the page.

import type { StyleSource } from "./colors.js";

export interface Environment {
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(handle: number): void;
  readonly document?: {
    readonly hidden: boolean;
    addEventListener(type: "visibilitychange", listener: () => void): void;
    removeEventListener(type: "visibilitychange", listener: () => void): void;
  };
  readonly IntersectionObserver?: new (
    callback: (entries: readonly { readonly isIntersecting: boolean }[]) => void,
  ) => { observe(target: Element): void; disconnect(): void };
  devicePixelRatio(): number;
  coarsePointer(): boolean;
  style(element: Element): StyleSource | undefined;
  random(): number;
}

export function browserEnvironment(): Environment {
  const g = globalThis as typeof globalThis & Partial<Window>;
  return {
    requestFrame: (cb) => g.requestAnimationFrame!(cb),
    cancelFrame: (h) => g.cancelAnimationFrame!(h),
    document: g.document,
    IntersectionObserver: g.IntersectionObserver,
    devicePixelRatio: () => g.devicePixelRatio ?? 1,
    coarsePointer: () => g.matchMedia?.("(pointer: coarse)").matches ?? false,
    style: (el) => g.getComputedStyle?.(el),
    random: Math.random,
  };
}

/** A value between 0 and 1, or an error naming the option and the value received. */
export function checkUnit(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be between 0 and 1; received ${String(value)}`);
  }
  return value;
}
