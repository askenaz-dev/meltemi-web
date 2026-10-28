// The browser check (design D11; specifications `site-motion` and `product-site`). It builds the
// site, serves it with `wrangler dev` on this machine only, and drives the installed Chrome through
// every page: no console error, no policy violation, no request beyond this machine.
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
import { PAGES, pageUrl } from "../test/support.js";
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
const twin = (url: string) => (url === "/" ? "/es/" : `/es${url}`);
const MOVING_URLS = Object.keys(MOVING).flatMap((url) => [url, twin(url)]);

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

const CHECKS: readonly [string, Check][] = [
  ["every page is quiet: no error, no policy violation, nothing beyond localhost", quiet],
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
