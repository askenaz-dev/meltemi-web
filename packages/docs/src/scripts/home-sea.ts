// The home's sea in motion (specification `docs-portal`; design D2 to D6). Under reduced motion it
// does nothing at all, so the still picture stays and the sea's code is never fetched. Otherwise it
// loads `@meltemi/ocean` as its own chunk, draws the `home` state at its rest progress (the
// progress the still picture is drawn at, so the first frame takes its place without a jump),
// sets the fleet sailing and the wind blowing, and only then lets the still picture step aside.
// Without WebGL2 or Canvas 2D the sea draws no frame and the page stays as it was written.
// The sea itself requests no frame out of view or in a hidden tab; the wind is stopped out of
// view here. The pause button stops both and starts them again. It stores nothing.

import type { Sea, Wind } from "../../../ocean/src/index.js";

/** What the browser check reads of the drawing (`pnpm docs:browser`); it can change nothing. */
export interface DocsSeaReport {
  readonly renderer: string;
  readonly frames: number;
  readonly figures: Sea["figures"];
  readonly paused: boolean;
  readonly windFrames: number;
}

declare global {
  interface Window {
    meltemiDocsSea?: DocsSeaReport;
  }
}

/** The wind the fleet sails in, as meltemi.dev's hero opens with (0 to 1). */
const WIND = 0.6;

/** The button's glyphs: two bars, and a triangle while paused. */
const PAUSE_GLYPH = "M4 3h3v10H4zM9 3h3v10H9z";
const PLAY_GLYPH = "M5 3l8 5-8 5z";

const host = document.querySelector<HTMLElement>(".portal-sea[data-sea]");
if (host && !matchMedia("(prefers-reduced-motion: reduce)").matches) void sail(host);

async function sail(host: HTMLElement): Promise<void> {
  const canvas = host.querySelector<HTMLCanvasElement>(".portal-sea-canvas");
  const windCanvas = host.querySelector<HTMLCanvasElement>(".portal-sea-wind");
  const button = host.querySelector<HTMLButtonElement>(".portal-sea-pause");
  const boats = [...host.querySelectorAll<HTMLElement>(".portal-sea-boat")];
  if (!canvas) return;

  const { createSea, createWind, restProgress } = await import("../../../ocean/src/index.js");
  const sea = createSea(canvas, {
    state: "home",
    reducedMotion: false,
    progress: restProgress("home"),
    wind: WIND,
    fleet: boats,
  });
  sea.start();
  if (sea.frames === 0) {
    sea.destroy();
    return;
  }
  const wind: Wind | undefined = windCanvas
    ? createWind(windCanvas, { reducedMotion: false, strength: WIND })
    : undefined;
  wind?.start();
  host.classList.add("is-playing");

  let paused = false;
  let inView = true;
  const playWind = () => (!paused && inView ? wind?.start() : wind?.stop());

  if (wind && "IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      inView = entries.some((entry) => entry.isIntersecting);
      playWind();
    }).observe(host);
  }

  if (button) {
    const glyph = button.querySelector("path");
    button.hidden = false;
    button.addEventListener("click", () => {
      paused = !paused;
      host.classList.toggle("is-paused", paused);
      button.setAttribute("aria-pressed", String(paused));
      const label = (paused ? button.dataset["labelPlay"] : button.dataset["labelPause"]) ?? "";
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
      glyph?.setAttribute("d", paused ? PLAY_GLYPH : PAUSE_GLYPH);
      if (paused) sea.stop();
      else sea.start();
      playWind();
    });
  }

  const restyle = () => {
    sea.restyle();
    wind?.restyle();
  };
  // Starlight's theme picker writes `data-theme` on the root; the system's scheme matters when
  // the reader chose "auto".
  new MutationObserver(restyle).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", restyle);

  let resizing: number | undefined;
  new ResizeObserver(() => {
    if (resizing !== undefined) cancelAnimationFrame(resizing);
    resizing = requestAnimationFrame(() => {
      resizing = undefined;
      sea.resize();
      wind?.resize();
    });
  }).observe(host);

  window.meltemiDocsSea = Object.freeze({
    get renderer() {
      return sea.renderer;
    },
    get frames() {
      return sea.frames;
    },
    get figures() {
      return sea.figures;
    },
    get paused() {
      return paused;
    },
    get windFrames() {
      return wind?.frames ?? 0;
    },
  });
}
