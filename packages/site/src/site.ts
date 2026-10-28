// The script every moving page loads (decision 0006; specifications `site-motion`). It does only
// what the visit allows:
//   - under reduced motion, it draws the sea's one frame at its state's rest, one frame of the
//     wind's streamlines, and wires nothing else;
//   - otherwise it marks the document `html.motion`, reveals the sections once as they enter the
//     view, sails the fleet, blows the wind across the page, ties the wind to the scroll through
//     the hero, and gives the pause button its work.
// It stores nothing. The sea comes as a dynamic import, which the build splits into a hashed
// chunk, so this entry stays small and the pages can link it by a stable name.

import { inView, scroll } from "motion";
import type { Sea, SeaState, Wind } from "@meltemi/ocean";

/** What the browser check reads of the drawing (`pnpm site:browser`); it can change nothing. */
export interface SeaReport {
  readonly renderer: string;
  readonly state: string;
  readonly frames: number;
  readonly figures: Sea["figures"];
  readonly progress: number;
  readonly wind: number;
  readonly quality: string;
  readonly paused: boolean;
  /** The wind layer: its renderer and how many frames it has drawn. */
  readonly windRenderer: string;
  readonly windFrames: number;
}

declare global {
  interface Window {
    meltemiSea?: SeaReport;
  }
}

/** The wind freshens from 0.6 to 1 as the page scrolls through the hero (design D2). */
const windAt = (progress: number) => 0.6 + 0.4 * progress;

/** How far apart sections that enter the view together start to rise. */
const STAGGER_MS = 60;

/** How long the intro waits in `site.css` before the wind draws the mark. */
const INTRO_WAIT_MS = 400;

/** The pause button's glyphs: two bars, and a triangle while paused. */
const PAUSE_GLYPH = "M4 3h3v10H4zM9 3h3v10H9z";
const PLAY_GLYPH = "M5 3l8 5-8 5z";

const root = document.documentElement;
const state = document.body.dataset["sea"];
const hero = document.querySelector<HTMLElement>(".hero.sea");
const canvas = hero?.querySelector<HTMLCanvasElement>(".sea-canvas");
const windCanvas = document.querySelector<HTMLCanvasElement>("canvas.wind");
const mark = hero?.querySelector<HTMLElement>(".sea-mark") ?? undefined;
const boats = hero ? [...hero.querySelectorAll<HTMLElement>(".sea-boat")] : [];
const button = hero?.querySelector<HTMLButtonElement>(".sea-pause");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

let sea: Sea | undefined;
let wind: Wind | undefined;
let paused = false;
let unfollow: VoidFunction | undefined;

/** Sections rise into view once. What is in view when the page opens stays as it is. */
function reveal(): void {
  const sections = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
  for (const section of sections) {
    if (section.getBoundingClientRect().top < innerHeight) section.classList.add("is-in");
  }
  root.classList.add("motion");
  let batch = 0;
  const below = sections.filter((section) => !section.classList.contains("is-in"));
  inView(
    below,
    (section) => {
      if (batch === 0) queueMicrotask(() => (batch = 0));
      (section as HTMLElement).style.transitionDelay = `${batch * STAGGER_MS}ms`;
      batch += 1;
      section.classList.add("is-in");
    },
    { amount: 0.15 },
  );
}

/** Feeds the scroll progress through the hero to the sea, and freshens the wind with it. */
function follow(): void {
  if (!sea || !hero || unfollow) return;
  const target = sea;
  unfollow = scroll(
    (value: number) => {
      const progress = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
      target.setProgress(progress);
      target.setWind(windAt(progress));
      wind?.setStrength(windAt(progress));
    },
    { target: hero, offset: ["start start", "end start"] },
  );
}

/** The pause button: stops the sea, the wind, the scroll and every animation of the page, and back. */
function pauseButton(control: HTMLButtonElement): void {
  control.hidden = false;
  const glyph = control.querySelector("path");
  control.addEventListener("click", () => {
    paused = !paused;
    root.classList.toggle("sea-paused", paused);
    control.setAttribute("aria-pressed", String(paused));
    const label = (paused ? control.dataset["labelPlay"] : control.dataset["labelPause"]) ?? "";
    control.setAttribute("aria-label", label);
    control.setAttribute("title", label);
    glyph?.setAttribute("d", paused ? PLAY_GLYPH : PAUSE_GLYPH);
    if (paused) {
      sea?.stop();
      wind?.stop();
      unfollow?.();
      unfollow = undefined;
    } else {
      sea?.start();
      wind?.start();
      follow();
    }
  });
}

/**
 * The intro began when the page was painted, at the mark's place in the still picture. Once the
 * sea has put the mark on its wave, the intro starts over there, so the mark is never seen being
 * drawn in one place and then jumping to another.
 */
function rewindIntro(element: HTMLElement): void {
  if (typeof element.getAnimations !== "function") return;
  for (const animation of element.getAnimations({ subtree: true })) {
    animation.currentTime = INTRO_WAIT_MS;
  }
}

async function sail(surface: HTMLCanvasElement, name: string): Promise<void> {
  const { STATES, createSea, createWind, restProgress } = await import("@meltemi/ocean");
  if (!(STATES as readonly string[]).includes(name)) return;
  const seaState = name as SeaState;
  const progress = reduced ? restProgress(seaState) : 0;
  sea = createSea(surface, {
    state: seaState,
    reducedMotion: reduced,
    progress,
    wind: windAt(progress),
    fleet: mark ? [mark, ...boats] : boats,
  });
  if (windCanvas) {
    wind = createWind(windCanvas, { reducedMotion: reduced, strength: windAt(progress) });
  }
  sea.start();
  wind?.start();
  if (paused) {
    sea.stop();
    wind?.stop();
  }
  if (sea.frames > 0) {
    // The still picture steps aside for the drawing, and the fleet leaves its place in it.
    root.classList.add("sea");
    if (mark && !reduced) rewindIntro(mark);
  }
  const drawn = sea;
  const blown = wind;
  addEventListener("resize", () => {
    drawn.resize();
    blown?.resize();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    drawn.restyle();
    blown?.restyle();
  });
  if (!reduced && !paused) follow();

  window.meltemiSea = Object.freeze({
    get renderer() {
      return drawn.renderer;
    },
    get state() {
      return drawn.state;
    },
    get frames() {
      return drawn.frames;
    },
    get figures() {
      return drawn.figures;
    },
    get progress() {
      return drawn.progress;
    },
    get wind() {
      return drawn.wind;
    },
    get quality() {
      return drawn.quality;
    },
    get paused() {
      return paused;
    },
    get windRenderer() {
      return blown?.renderer ?? "none";
    },
    get windFrames() {
      return blown?.frames ?? 0;
    },
  });
}

if (state && state !== "still" && canvas) {
  if (!reduced) {
    reveal();
    if (button) pauseButton(button);
  }
  void sail(canvas, state);
}
