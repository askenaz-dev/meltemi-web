// The browser check (design D11; specifications `site-motion` and `product-site`). It builds the
// site, serves it with `wrangler dev` on this machine only, and drives the installed Chrome through
// every page: no console error, no policy violation, no request beyond this machine, and the
// motion the specification asks for, read from the page's own report (`window.meltemiSea`).
//
//   pnpm site:browser                                  (Chrome, where it is installed)
//   MELTEMI_BROWSER=/path/to/chrome pnpm site:browser  (any Chromium build)
//   pnpm site:browser pause scheme                     (only the checks whose names say so)
//
// It downloads nothing. It stays outside `pnpm test`, so the unit tests stay free of browsers.

import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { PAGES, pageUrl, read, tags } from "../test/support.js";
import { SITE, buildSite } from "./build.js";

/** The pages whose hero moves, and the state each one draws. */
const MOVING: Readonly<Record<string, string>> = {
  "/": "home",
  "/ide/": "ide",
  "/ide/method/": "ide",
  "/ide/agents/": "ide",
  "/ide/downloads/": "ide",
  "/diagrams/": "diagrams",
};
/** How many boats each state sails, the lead included (`fleetSize`). */
const MOVING_FLEET: Readonly<Record<string, number>> = { home: 6, ide: 9, diagrams: 5 };
const twin = (url: string) => (url === "/" ? "/es/" : `/es${url}`);
const MOVING_URLS = Object.keys(MOVING).flatMap((url) => [url, twin(url)]);

const LABELS = {
  en: { pause: "Pause animation", play: "Play animation" },
  es: { pause: "Pausar animación", play: "Reanudar animación" },
};

/** What the page reports of its drawing; see `src/site.ts`. */
interface Report {
  readonly renderer: string;
  readonly state: string;
  readonly frames: number;
  readonly figures: { boats: number; leadX: number; xs: readonly number[]; links: number };
  readonly progress: number;
  readonly wind: number;
  readonly paused: boolean;
  readonly windRenderer: string;
  readonly windFrames: number;
}

/** How much of the wind canvas is painted, read from its own pixels (it is a 2D canvas). */
const windShare = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas.wind");
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return -1;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    let seen = 0;
    for (let i = 3; i < data.length; i += 4 * 7) {
      seen += 1;
      if (data[i]! > 12) painted += 1;
    }
    return painted / Math.max(1, seen);
  });

// ---------------------------------------------------------------------------------------------
// The server and the browser.

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => done(typeof address === "object" && address ? address.port : 0));
    });
  });
}

/** `wrangler dev` on 127.0.0.1, with its metrics off, ready when the home answers. */
async function serve(): Promise<{ origin: string; child: ChildProcess }> {
  const [port, inspector] = [await freePort(), await freePort()];
  const manifest = createRequire(import.meta.url).resolve("wrangler/package.json");
  const wrangler = join(dirname(manifest), "bin", "wrangler.js");
  const child = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      String(inspector),
      "--show-interactive-dev-session=false",
      "--log-level",
      "warn",
    ],
    { cwd: SITE, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: "inherit" },
  );
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited with ${child.exitCode}`);
    try {
      if ((await fetch(`${origin}/`)).ok) return { origin, child };
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error("wrangler dev did not answer within 60 seconds");
}

function launch(): Promise<Browser> {
  const executablePath = process.env["MELTEMI_BROWSER"];
  return chromium.launch({
    ...(executablePath ? { executablePath } : { channel: "chrome" }),
    // A software WebGL, the same on every machine, GPU or not. The pages are our own.
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
}

// ---------------------------------------------------------------------------------------------
// One page, watched.

interface Watched {
  readonly page: Page;
  readonly context: BrowserContext;
  /** Console errors, page errors, policy violations and requests beyond this machine. */
  readonly problems: string[];
}

interface Visit {
  readonly scheme?: "light" | "dark";
  readonly reducedMotion?: boolean;
  readonly javaScript?: boolean;
  /** The address answers 404 on purpose: its own status is not a problem. */
  readonly notFound?: boolean;
}

async function open(browser: Browser, origin: string, url: string, visit: Visit = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: visit.scheme ?? "light",
    reducedMotion: visit.reducedMotion ? "reduce" : "no-preference",
    javaScriptEnabled: visit.javaScript ?? true,
  });
  const problems: string[] = [];
  await context.route("**/*", (route) => {
    const { hostname, href } = new URL(route.request().url());
    if (hostname === "127.0.0.1" || hostname === "localhost") return route.continue();
    problems.push(`a request beyond this machine: ${href}`);
    return route.abort();
  });
  // tsx keeps function names with a helper the page lacks; the functions handed to the page
  // below would call it.
  await context.addInitScript({ content: "globalThis.__name = (f) => f;" });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) =>
      console.error(`policy violation: ${e.violatedDirective} ${e.blockedURI}`),
    );
    const w = window as unknown as { layoutShift: number };
    w.layoutShift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
      })[]) {
        if (!entry.hadRecentInput) w.layoutShift += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const own = m.location().url === origin + url && /status of 404/.test(m.text());
    if (!(visit.notFound && own)) problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  await page.goto(origin + url, { waitUntil: "load" });
  return { page, context, problems } satisfies Watched;
}

const report = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { meltemiSea?: Report }).meltemiSea ?? null,
  ) as Promise<Report | null>;

/** Waits for the sea to report itself, at most 5 seconds. */
async function drawn(page: Page): Promise<Report | null> {
  await page
    .waitForFunction(() => (window as unknown as { meltemiSea?: Report }).meltemiSea, null, {
      timeout: 5000,
    })
    .catch(() => undefined);
  return report(page);
}

/** The hero's height, and a scroll to a fraction of it past the hero's top. */
async function scrollHero(page: Page, fraction: number): Promise<void> {
  await page.evaluate((f) => {
    const hero = document.querySelector<HTMLElement>(".hero.sea")!;
    scrollTo(0, hero.offsetTop + hero.offsetHeight * f);
  }, fraction);
  await page.waitForTimeout(250);
}

/**
 * How much of the canvas is painted, and its colours, from a screenshot read in a blank page (the
 * site's policy rightly refuses the `data:` image this needs).
 */
async function pixels(watched: Watched) {
  const png = await watched.page.locator(".sea-canvas").screenshot();
  const blank = await watched.context.newPage();
  try {
    return await blank.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const counts = new Map<string, number>();
      for (let i = 0; i < data.length; i += 4) {
        const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const background = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      const [br, bg, bb] = background.split(",").map(Number) as [number, number, number];
      let painted = 0;
      const sum: [number, number, number] = [0, 0, 0];
      for (let i = 0; i < data.length; i += 4) {
        const d =
          Math.abs(data[i]! - br) + Math.abs(data[i + 1]! - bg) + Math.abs(data[i + 2]! - bb);
        if (d > 24) {
          painted += 1;
          sum[0] += data[i]!;
          sum[1] += data[i + 1]!;
          sum[2] += data[i + 2]!;
        }
      }
      const n = Math.max(1, painted);
      return {
        background,
        share: painted / (data.length / 4),
        ink: sum.map((v) => Math.round(v / n)) as [number, number, number],
      };
    }, png.toString("base64"));
  } finally {
    await blank.close();
  }
}

// ---------------------------------------------------------------------------------------------
// The checks. Each returns what failed, page by page.

type Check = (browser: Browser, origin: string) => Promise<string[]>;

/** Every page, in both schemes: no console error, no policy violation, nothing beyond localhost. */
const quiet: Check = async (browser, origin) => {
  const failures: string[] = [];
  const urls = [...PAGES.map(pageUrl), "/no-such-page/"];
  for (const scheme of ["light", "dark"] as const) {
    for (const url of urls) {
      const watched = await open(browser, origin, url, {
        scheme,
        notFound: url === "/no-such-page/",
      });
      await watched.page.waitForTimeout(MOVING_URLS.includes(url) ? 1200 : 300);
      failures.push(...watched.problems.map((p) => `${url} (${scheme}): ${p}`));
      await watched.context.close();
    }
  }
  return failures;
};

const BRAND = (() => {
  const found = tags(read("media/meltemi-mark-gradient.svg"));
  return {
    paths: found.filter((t) => t.name === "path").map((t) => t.attrs["d"]),
    stops: found
      .filter((t) => t.name === "stop")
      .map((t) => `${t.attrs["offset"]} ${t.attrs["stop-color"]?.toLowerCase()}`),
  };
})();

/** Every moving page: a sea drawn, the mark the brand's and on its wave, no layout shift. */
const heroes: Check = async (browser, origin) => {
  const failures: string[] = [];
  for (const url of MOVING_URLS) {
    const watched = await open(browser, origin, url);
    const { page } = watched;
    const sea = await drawn(page);
    await page.waitForTimeout(2000);
    if (!sea) {
      failures.push(`${url}: no drawing reported`);
      await watched.context.close();
      continue;
    }
    if (sea.renderer !== "webgl2") failures.push(`${url}: drawn with ${sea.renderer}, not webgl2`);
    if (sea.state !== MOVING[url.replace(/^\/es\//, "/")]) {
      failures.push(`${url}: draws ${sea.state}`);
    }
    const { share } = await pixels(watched);
    if (share < 0.01) failures.push(`${url}: the canvas is blank (${(share * 100).toFixed(2)}%)`);
    const mark = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>(".sea-mark")!;
      const box = element.getBoundingClientRect();
      const hero = document.querySelector(".hero.sea")!.getBoundingClientRect();
      const m = element.querySelector(".sea-mark-m")!;
      const hull = element.querySelector(".sea-mark-hull")!;
      return {
        transform: element.style.transform,
        inHero: box.width > 0 && box.top >= hero.top && box.bottom <= hero.bottom + 1,
        drawn: getComputedStyle(m).strokeDashoffset,
        hull: getComputedStyle(hull).opacity,
        paths: [...element.querySelectorAll("path")].map((p) => p.getAttribute("d")),
        stops: [...element.querySelectorAll("stop")].map(
          (s) => `${s.getAttribute("offset")} ${s.getAttribute("stop-color")?.toLowerCase()}`,
        ),
        filters: [...element.querySelectorAll("*")].filter(
          (e) => e.hasAttribute("filter") || getComputedStyle(e).filter !== "none",
        ).length,
      };
    });
    const tilt =
      /^translate\(-?[\d.]+px, -?[\d.]+px\) scale\([\d.]+\) rotate\((-?[\d.]+)deg\)$/.exec(
        mark.transform,
      );
    if (!tilt) failures.push(`${url}: the mark's transform is "${mark.transform}"`);
    else if (Math.abs(Number(tilt[1])) > 6) failures.push(`${url}: the mark heels ${tilt[1]}°`);
    if (!mark.inHero) failures.push(`${url}: the mark is not in the hero`);
    if (parseFloat(mark.drawn) > 0.001 || mark.hull !== "1") {
      failures.push(`${url}: the mark is not drawn after 2 s (${mark.drawn}, ${mark.hull})`);
    }
    if (mark.paths.join("|") !== BRAND.paths.join("|")) failures.push(`${url}: the mark's paths`);
    if (mark.stops.join("|") !== BRAND.stops.join("|")) failures.push(`${url}: the mark's stops`);
    if (mark.filters) failures.push(`${url}: a filter on the mark`);
    if (sea.figures.boats !== MOVING_FLEET[sea.state]) {
      failures.push(`${url}: ${sea.figures.boats} boats, not ${MOVING_FLEET[sea.state]}`);
    }
    const blown = await windShare(page);
    if (blown < 0.002) {
      failures.push(`${url}: the wind canvas is blank (${(blown * 100).toFixed(2)}%)`);
    }
    if (sea.windRenderer !== "2d") failures.push(`${url}: the wind drawn with ${sea.windRenderer}`);
    await scrollHero(page, 1);
    await scrollHero(page, 0);
    const shift = await page.evaluate(
      () => (window as unknown as { layoutShift: number }).layoutShift,
    );
    if (shift !== 0) failures.push(`${url}: a layout shift of ${shift}`);
    failures.push(...watched.problems.map((p) => `${url}: ${p}`));
    await watched.context.close();
  }
  return failures;
};

/** The fleet sails on its own, and the wind rises with the scroll. */
const crossing: Check = async (browser, origin) => {
  const failures: string[] = [];
  for (const url of ["/", "/es/"]) {
    const watched = await open(browser, origin, url);
    const { page } = watched;
    const start = await drawn(page);
    if (!start) {
      failures.push(`${url}: no drawing reported`);
      await watched.context.close();
      continue;
    }
    // Without scrolling, the lead sails right: four samples over 1.2 s, each ahead of the last
    // unless the boat re-entered from the left.
    let ahead = 0;
    let last = start.figures.leadX;
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(300);
      const now = (await report(page))!.figures.leadX;
      if (now > last || now < last - 200) ahead += 1;
      last = now;
    }
    if (ahead < 4) failures.push(`${url}: the lead did not sail on its own (${ahead} of 4)`);
    let wind = start.wind;
    for (const step of [0.2, 0.4, 0.6, 0.8]) {
      await scrollHero(page, step);
      const now = await report(page);
      if (!now) break;
      if (!(now.wind > wind)) failures.push(`${url}: the wind did not rise at ${step}`);
      wind = now.wind;
    }
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(250);
    const back = await report(page);
    if (back && !(back.wind < wind)) {
      failures.push(`${url}: scrolling back kept the wind at ${back.wind}`);
    }
    failures.push(...watched.problems.map((p) => `${url}: ${p}`));
    await watched.context.close();
  }
  return failures;
};

/** The IDE's fleet of nine sails together; the Diagrams links appear with the scroll. */
const stories: Check = async (browser, origin) => {
  const failures: string[] = [];
  for (const url of ["/ide/", "/es/ide/", "/diagrams/", "/es/diagrams/"]) {
    const watched = await open(browser, origin, url);
    const { page } = watched;
    const top = await drawn(page);
    if (!top) {
      failures.push(`${url}: no drawing reported`);
      await watched.context.close();
      continue;
    }
    if (url.includes("/ide/")) {
      if (top.figures.boats !== 9) failures.push(`${url}: ${top.figures.boats} boats`);
      const before = [...top.figures.xs];
      await page.waitForTimeout(1000);
      const after = (await report(page))!.figures.xs;
      const stuck = after.filter((x, i) => !(x > before[i]! || x < before[i]! - 200)).length;
      if (stuck) failures.push(`${url}: ${stuck} boats did not sail in a second`);
    } else {
      if (top.figures.boats !== 5) failures.push(`${url}: ${top.figures.boats} boats`);
      await scrollHero(page, 0.95);
      const end = await report(page);
      if (!end || !(end.figures.links > top.figures.links)) {
        failures.push(`${url}: the links went ${top.figures.links} → ${end?.figures.links}`);
      }
    }
    failures.push(...watched.problems.map((p) => `${url}: ${p}`));
    await watched.context.close();
  }
  return failures;
};

/** Under reduced motion: one frame, the mark at rest, nothing hidden, no button. */
const reduced: Check = async (browser, origin) => {
  const failures: string[] = [];
  for (const url of MOVING_URLS) {
    const watched = await open(browser, origin, url, { reducedMotion: true });
    const { page } = watched;
    const first = await drawn(page);
    const at = await page.evaluate(
      () => document.querySelector<HTMLElement>(".sea-mark")!.style.transform,
    );
    await scrollHero(page, 0.6);
    await page.waitForTimeout(1000);
    const later = await report(page);
    const state = await page.evaluate(() => ({
      motion: document.documentElement.classList.contains("motion"),
      hidden: [...document.querySelectorAll("[data-reveal]")].some(
        (s) => getComputedStyle(s).opacity !== "1",
      ),
      button: document.querySelector<HTMLButtonElement>(".sea-pause")!.hidden,
      transform: document.querySelector<HTMLElement>(".sea-mark")!.style.transform,
    }));
    if (!first || !later) failures.push(`${url}: no drawing reported`);
    else {
      if (first.frames !== 1 || later.frames !== 1) {
        failures.push(`${url}: ${later.frames} frames under reduced motion`);
      }
      if (later.windFrames !== 1) {
        failures.push(`${url}: ${later.windFrames} wind frames under reduced motion`);
      }
    }
    if (state.transform !== at) failures.push(`${url}: the mark moved under reduced motion`);
    if (state.motion || state.hidden) failures.push(`${url}: motion or a hidden section`);
    if (!state.button) failures.push(`${url}: a pause button with nothing to pause`);
    failures.push(...watched.problems.map((p) => `${url}: ${p}`));
    await watched.context.close();
  }
  return failures;
};

/** The pause button: reached by keyboard, stops every frame, resumes, and stores nothing. */
const pause: Check = async (browser, origin) => {
  const failures: string[] = [];
  for (const url of ["/", "/es/", "/ide/", "/es/diagrams/"]) {
    const watched = await open(browser, origin, url);
    const { page, context } = watched;
    await drawn(page);
    const words = LABELS[url.startsWith("/es/") ? "es" : "en"];
    let reached = false;
    for (let i = 0; i < 80 && !reached; i += 1) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(
        () => document.activeElement?.classList.contains("sea-pause") ?? false,
      );
    }
    if (!reached) failures.push(`${url}: the pause button is not reached by Tab`);
    await page.locator(".sea-pause").focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(100);
    const stopped = (await report(page))!;
    await page.waitForTimeout(1000);
    const still = (await report(page))!;
    const button = page.locator(".sea-pause");
    if (still.frames !== stopped.frames) {
      failures.push(`${url}: ${still.frames - stopped.frames} frames while paused`);
    }
    if (still.windFrames !== stopped.windFrames) {
      failures.push(`${url}: ${still.windFrames - stopped.windFrames} wind frames while paused`);
    }
    if ((await button.getAttribute("aria-pressed")) !== "true") {
      failures.push(`${url}: aria-pressed`);
    }
    if ((await button.getAttribute("aria-label")) !== words.play) {
      failures.push(`${url}: the play label`);
    }
    if ((await button.textContent())?.trim()) failures.push(`${url}: words in the button`);
    await page.keyboard.press("Space");
    await page.waitForTimeout(600);
    const resumed = (await report(page))!;
    if (!(resumed.frames > still.frames)) failures.push(`${url}: no frames after resuming`);
    if (!(resumed.windFrames > still.windFrames)) failures.push(`${url}: no wind after resuming`);
    if ((await button.getAttribute("aria-label")) !== words.pause) {
      failures.push(`${url}: the pause label`);
    }
    const stored = await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      cookie: document.cookie,
      databases: (await indexedDB.databases()).length,
    }));
    const cookies = await context.cookies();
    if (stored.local || stored.session || stored.cookie || stored.databases || cookies.length) {
      failures.push(`${url}: something stored: ${JSON.stringify({ ...stored, cookies })}`);
    }
    failures.push(...watched.problems.map((p) => `${url}: ${p}`));
    await context.close();
  }
  return failures;
};

/** No frame while the hero is off screen, or while the tab is hidden. */
const idle: Check = async (browser, origin) => {
  const failures: string[] = [];
  for (const url of ["/", "/ide/", "/diagrams/"]) {
    const watched = await open(browser, origin, url);
    const { page } = watched;
    await drawn(page);
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(200);
    const away = (await report(page))!.frames;
    await page.waitForTimeout(1000);
    if ((await report(page))!.frames !== away) {
      failures.push(`${url}: frames with the hero off screen`);
    }
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(400);
    // A hidden tab, as the page sees one: headless Chrome keeps a background tab visible.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(200);
    const hidden = (await report(page))!;
    await page.waitForTimeout(1000);
    const later = (await report(page))!;
    if (later.frames !== hidden.frames) failures.push(`${url}: frames while the tab is hidden`);
    if (later.windFrames !== hidden.windFrames) {
      failures.push(`${url}: wind frames while the tab is hidden`);
    }
    failures.push(...watched.problems.map((p) => `${url}: ${p}`));
    await watched.context.close();
  }
  return failures;
};

/** A scheme switch recolours the sea, without a navigation. */
const schemes: Check = async (browser, origin) => {
  const failures: string[] = [];
  const url = "/diagrams/";
  const watched = await open(browser, origin, url);
  const { page } = watched;
  await drawn(page);
  await page.waitForTimeout(800);
  await page.evaluate(() => ((window as unknown as { stayed: boolean }).stayed = true));
  const light = await pixels(watched);
  const lightPoint = await page.evaluate(() =>
    getComputedStyle(document.querySelector(".sea-canvas")!).getPropertyValue("--sea-point"),
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(500);
  const dark = await pixels(watched);
  const darkPoint = await page.evaluate(() =>
    getComputedStyle(document.querySelector(".sea-canvas")!).getPropertyValue("--sea-point"),
  );
  const stayed = await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed);
  if (!stayed) failures.push(`${url}: the switch navigated`);
  if (lightPoint === darkPoint) failures.push(`${url}: --sea-point did not change`);
  const windDark = await page.evaluate(() =>
    getComputedStyle(document.querySelector("canvas.wind")!).getPropertyValue("--sea-wind"),
  );
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(100);
  const windLight = await page.evaluate(() =>
    getComputedStyle(document.querySelector("canvas.wind")!).getPropertyValue("--sea-wind"),
  );
  if (windDark === windLight) failures.push(`${url}: --sea-wind did not change`);
  if (light.background === dark.background) failures.push(`${url}: the background did not change`);
  const moved = light.ink.reduce((sum, v, i) => sum + Math.abs(v - dark.ink[i]!), 0);
  if (moved < 30)
    failures.push(`${url}: the points kept their colour (${light.ink} → ${dark.ink})`);
  failures.push(...watched.problems.map((p) => `${url}: ${p}`));
  await watched.context.close();
  return failures;
};

/** With JavaScript off, every page: its still picture shown, no canvas, every link there. */
const withoutScript: Check = async (browser, origin) => {
  const failures: string[] = [];
  for (const file of PAGES) {
    const url = pageUrl(file);
    const watched = await open(browser, origin, url, { javaScript: false });
    const { page } = watched;
    const links = tags(read(file)).filter((t) => t.name === "a" && t.attrs["href"]).length;
    const seen = await page.evaluate(() => {
      const still = document.querySelector<HTMLImageElement>(".sea-still");
      const canvas = document.querySelector(".sea-canvas");
      const wind = document.querySelector("canvas.wind");
      return {
        wind: wind ? getComputedStyle(wind).visibility !== "hidden" : false,
        still: still
          ? getComputedStyle(still).visibility === "visible" && still.naturalWidth > 0
          : false,
        canvas: canvas ? getComputedStyle(canvas).visibility !== "hidden" : false,
        links: document.querySelectorAll("a[href]").length,
        hidden: [...document.querySelectorAll("main section")].some(
          (s) => getComputedStyle(s).opacity !== "1",
        ),
      };
    });
    if (!seen.still) failures.push(`${url}: the still picture is not shown`);
    if (seen.canvas) failures.push(`${url}: the canvas shows without the script`);
    if (seen.wind) failures.push(`${url}: the wind canvas shows without the script`);
    if (seen.links !== links) failures.push(`${url}: ${seen.links} links of ${links}`);
    if (seen.hidden) failures.push(`${url}: a hidden section`);
    failures.push(...watched.problems.map((p) => `${url}: ${p}`));
    await watched.context.close();
  }
  return failures;
};

const CHECKS: readonly [string, Check][] = [
  ["every page is quiet: no error, no policy violation, nothing beyond localhost", quiet],
  [
    "every moving hero draws its sea and its wind, the brand's mark on its wave, with no layout shift",
    heroes,
  ],
  ["the fleet sails on its own, and the wind rises with the scroll", crossing],
  ["the IDE's fleet of nine sails together, and the Diagrams links appear", stories],
  ["reduced motion draws one frame, the mark at rest", reduced],
  ["the pause button stops and resumes, and stores nothing", pause],
  ["no frame off screen or in a hidden tab", idle],
  ["a scheme switch recolours the sea", schemes],
  ["without JavaScript, every page is whole", withoutScript],
];

// ---------------------------------------------------------------------------------------------

async function main(): Promise<number> {
  const only = process.argv.slice(2);
  const chosen = CHECKS.filter(
    ([name]) => !only.length || only.some((word) => name.includes(word)),
  );
  if (!chosen.length) throw new Error(`no check is named by ${only.join(", ")}`);
  await buildSite(join(SITE, "public"));
  const { origin, child } = await serve();
  let browser: Browser | undefined;
  let failed = 0;
  try {
    browser = await launch();
    console.log(`${browser.version()} against ${origin}`);
    for (const [name, check] of chosen) {
      const failures = await check(browser, origin);
      console.log(`${failures.length ? "✗" : "✓"} ${name}`);
      for (const failure of failures) console.log(`    ${failure}`);
      if (failures.length) failed += 1;
    }
  } finally {
    await browser?.close();
    child.kill();
  }
  console.log(failed ? `${failed} of ${chosen.length} checks failed` : "Every check passed");
  return failed ? 1 : 0;
}

process.exitCode = await main();
