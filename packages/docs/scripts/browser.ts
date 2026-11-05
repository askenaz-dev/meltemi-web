// The portal's browser check (design decision 11): builds the fixture, serves it with `wrangler
// dev` on this machine only (the development configuration, whose route answers with the offline
// stubs), and drives the installed Chrome: no console error, no policy violation, no request
// beyond this machine, the search, Ask the docs, both schemes, a phone's width, reduced motion and
// pages without JavaScript.
//
//   pnpm docs:browser                                  (Chrome, where it is installed)
//   MELTEMI_BROWSER=/path/to/chrome pnpm docs:browser  (any Chromium build)
//   pnpm docs:browser search ask                       (only the checks whose names say so)
//
// It downloads nothing. It stays outside `pnpm test`, so the unit tests stay free of browsers.

import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, relative, sep } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { buildPortal, DIST } from "./build.js";
import { writeDevConfig } from "./dev-config.js";
import { PACKAGE } from "./sources.js";

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

/** `wrangler dev` on 127.0.0.1 with the development configuration, ready when the home answers. */
async function serve(): Promise<{ origin: string; child: ChildProcess }> {
  const [port, inspector] = [await freePort(), await freePort()];
  const config = writeDevConfig(port);
  const manifest = createRequire(import.meta.url).resolve("wrangler/package.json");
  const wrangler = join(dirname(manifest), "bin", "wrangler.js");
  const child = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "-c",
      config,
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
    { cwd: PACKAGE, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: "inherit" },
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
  return chromium.launch(executablePath ? { executablePath } : { channel: "chrome" });
}

/** Every page of the build, by its address. */
function pages(dir = DIST): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return pages(full);
    if (name !== "index.html") return [];
    return [`/${relative(DIST, dirname(full)).split(sep).join("/")}/`.replace(/^\/\/$/, "/")];
  });
}

interface Visit {
  readonly scheme?: "light" | "dark";
  readonly reducedMotion?: boolean;
  readonly javaScript?: boolean;
  readonly width?: number;
}

interface Watched {
  readonly page: Page;
  readonly context: BrowserContext;
  readonly problems: string[];
  readonly requests: string[];
}

async function open(
  browser: Browser,
  origin: string,
  url: string,
  visit: Visit = {},
): Promise<Watched> {
  const width = visit.width ?? 1280;
  const context = await browser.newContext({
    viewport: { width, height: width < 600 ? 812 : 860 },
    colorScheme: visit.scheme ?? "light",
    reducedMotion: visit.reducedMotion ? "reduce" : "no-preference",
    javaScriptEnabled: visit.javaScript ?? true,
    ...(width < 600 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  const problems: string[] = [];
  const requests: string[] = [];
  await context.route("**/*", (route) => {
    const { hostname, href } = new URL(route.request().url());
    requests.push(href);
    if (hostname === "127.0.0.1" || hostname === "localhost") return route.continue();
    problems.push(`a request beyond this machine: ${href}`);
    return route.abort();
  });
  await context.addInitScript({ content: "globalThis.__name = (f) => f;" });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) =>
      console.error(`policy violation: ${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  await page.goto(origin + url, { waitUntil: "load" });
  return { page, context, problems, requests };
}

type Check = (browser: Browser, origin: string) => Promise<string[]>;

/** Every page, once: no error, no policy violation, nothing beyond this machine. */
const quiet: Check = async (browser, origin) => {
  const failures: string[] = [];
  for (const url of pages()) {
    const watched = await open(browser, origin, url);
    failures.push(...watched.problems.map((p) => `${url}: ${p}`));
    await watched.context.close();
  }
  return failures;
};

/** The headers of a page as the Worker serves them. */
const headers: Check = async (_browser, origin) => {
  const failures: string[] = [];
  const response = await fetch(`${origin}/diagrams/player/`);
  const policy = response.headers.get("content-security-policy") ?? "";
  for (const part of [
    "default-src 'none'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
  ]) {
    if (!policy.includes(part)) failures.push(`/diagrams/player/: the policy lacks ${part}`);
  }
  if (response.headers.get("set-cookie")) failures.push("/diagrams/player/: a Set-Cookie");
  if (response.headers.get("x-content-type-options") !== "nosniff")
    failures.push("/diagrams/player/: no nosniff");
  const ask = await fetch(`${origin}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (ask.status !== 400) failures.push(`/api/ask answered ${ask.status} to an empty question`);
  if (ask.headers.get("cache-control") !== "no-store")
    failures.push("/api/ask: no Cache-Control no-store");
  return failures;
};

/** Search in English finds the Stories page and no Spanish page; empty, it shows and fetches nothing. */
const search: Check = async (browser, origin) => {
  const failures: string[] = [];
  const watched = await open(browser, origin, "/diagrams/player/");
  const { page } = watched;
  await page.click("site-search button[data-open-modal]");
  await page.waitForSelector("#starlight__search input", { timeout: 10_000 });
  await page.waitForTimeout(500);
  const before = watched.requests.length;
  const empty = await page.locator("#starlight__search .pagefind-ui__result").count();
  if (empty) failures.push(`an empty search shows ${empty} results`);
  const fetched = watched.requests.slice(before).filter((r) => /fragment|\.pf_index/.test(r));
  if (fetched.length) failures.push(`an empty search fetched ${fetched.join(", ")}`);
  await page.fill("#starlight__search input", "purchase");
  await page
    .waitForSelector("#starlight__search .pagefind-ui__result-link", { timeout: 10_000 })
    .catch(() => undefined);
  const links = await page.$$eval("#starlight__search .pagefind-ui__result-link", (as) =>
    as.map((a) => (a as HTMLAnchorElement).pathname),
  );
  if (!links.includes("/diagrams/language/stories/"))
    failures.push(`"purchase" found ${JSON.stringify(links)}, not the Stories page`);
  if (links.some((l) => l.startsWith("/es/")))
    failures.push(`"purchase" found a Spanish page: ${links.join(", ")}`);
  failures.push(...watched.problems);
  await watched.context.close();
  return failures;
};

/** Ask the fixture question: the answer with its [1] linked to the Stories page, and the source. */
const ask: Check = async (browser, origin) => {
  const failures: string[] = [];
  for (const [url, question, source] of [
    ["/diagrams/player/", "How do I export a story as a video?", "/diagrams/language/stories/"],
    [
      "/es/diagrams/player/",
      "¿Cómo exporto una historia como video?",
      "/es/diagrams/language/stories/",
    ],
  ] as const) {
    const watched = await open(browser, origin, url);
    const { page } = watched;
    await page.click(".ask-open");
    await page.fill("#ask-question", question);
    await page.waitForFunction(
      () => !document.querySelector<HTMLButtonElement>(".ask-submit")!.disabled,
    );
    await page.keyboard.press("Enter");
    await page
      .waitForSelector(".ask-answer:not([hidden])", { timeout: 10_000 })
      .catch(() => undefined);
    const seen = await page.evaluate(() => ({
      answer: document.querySelector(".ask-answer")?.textContent ?? "",
      cite:
        (document.querySelector(".ask-answer a.ask-cite") as HTMLAnchorElement | null)?.pathname ??
        "",
      sources: [...document.querySelectorAll(".ask-sources li a")].map(
        (a) => (a as HTMLAnchorElement).pathname,
      ),
      html: document.querySelector(".ask-answer")?.innerHTML ?? "",
    }));
    if (!seen.answer.includes("[1]"))
      failures.push(`${url}: the answer has no [1]: ${seen.answer}`);
    if (seen.cite !== source) failures.push(`${url}: [1] links ${seen.cite}, not ${source}`);
    if (seen.sources[0] !== source)
      failures.push(`${url}: the first source is ${seen.sources[0]}, not ${source}`);
    if (/<(?!\/?(p|a)\b)/.test(seen.html))
      failures.push(`${url}: the answer holds markup beyond paragraphs and links`);
    failures.push(...watched.problems.map((p) => `${url}: ${p}`));
    await watched.context.close();
  }
  return failures;
};

/** A spent allowance: the dialog says so and its button opens the search. */
const allowance: Check = async (browser, origin) => {
  const failures: string[] = [];
  const watched = await open(browser, origin, "/diagrams/player/");
  const { page } = watched;
  await page.route("**/api/ask", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ reason: "allowance" }),
    }),
  );
  await page.click(".ask-open");
  await page.fill("#ask-question", "How do I export a story as a video?");
  await page.click(".ask-submit");
  await page
    .waitForSelector(".ask-problem:not([hidden])", { timeout: 10_000 })
    .catch(() => undefined);
  const said = (await page.textContent(".ask-problem p")) ?? "";
  if (!said.includes("Answers are paused for today"))
    failures.push(`the allowance sentence is missing: ${JSON.stringify(said)}`);
  await page.click("[data-search]");
  await page.waitForTimeout(300);
  const searching = await page.evaluate(() =>
    document.querySelector("site-search dialog")?.hasAttribute("open"),
  );
  if (!searching) failures.push("the search button did not open the search");
  // The browser logs the 503 itself; it is the answer this check asked for.
  failures.push(...watched.problems.filter((p) => !p.includes("status of 503")));
  await watched.context.close();
  return failures;
};

/** An operator's off switch is visible only when Ask opens, and reopening reads its new state. */
const disabled: Check = async (browser, origin) => {
  const failures: string[] = [];
  for (const [url, phrase] of [
    ["/diagrams/player/", "AI answers are turned off"],
    ["/es/diagrams/player/", "Las respuestas de IA están desactivadas"],
  ] as const) {
    const watched = await open(browser, origin, url);
    const { page } = watched;
    let enabled = false;
    let statusReads = 0;
    let asks = 0;
    await page.route("**/api/ask/status", (route) => {
      statusReads++;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ enabled }) });
    });
    await page.route("**/api/ask", (route) => {
      asks++;
      return route.continue();
    });
    if (watched.requests.some((request) => new URL(request).pathname === "/api/ask/status")) {
      failures.push(`${url}: a guide view checked AI status before Ask opened`);
    }
    await page.click(".ask-open");
    await page.waitForSelector('.ask-problem[data-kind="disabled"]:not([hidden])');
    if (!(await page.textContent(".ask-problem p"))?.includes(phrase)) {
      failures.push(`${url}: the disabled explanation is missing`);
    }
    if (!(await page.isDisabled(".ask-submit")))
      failures.push(`${url}: Ask remains enabled while off`);
    const question = "How do I export a story as a video?";
    await page.fill("#ask-question", question);
    await page.keyboard.press("Enter");
    await page.evaluate(() => Promise.resolve());
    if (asks) failures.push(`${url}: Enter sent a question while AI was off`);
    await page.click("[data-search]");
    await page.waitForSelector("site-search dialog[open]");
    await page.keyboard.press("Escape");
    enabled = true;
    await page.click(".ask-open");
    await page.waitForFunction(
      () => !document.querySelector<HTMLButtonElement>(".ask-submit")!.disabled,
    );
    if (statusReads !== 2)
      failures.push(`${url}: reopening made ${statusReads} status reads, expected 2`);
    if ((await page.inputValue("#ask-question")) !== question)
      failures.push(`${url}: the pending question was lost`);
    await page.click(".ask-submit");
    await page.waitForSelector(".ask-answer:not([hidden])");
    if (asks !== 1) failures.push(`${url}: enabled Ask sent ${asks} questions, expected 1`);
    failures.push(...watched.problems.map((p) => `${url}: ${p}`));
    await watched.context.close();
  }
  return failures;
};

/** Status failures and a switch changed after opening both stop questions without a quota claim. */
const control: Check = async (browser, origin) => {
  const failures: string[] = [];
  for (const [url, disabledPhrase, controlPhrase] of [
    ["/diagrams/player/", "AI answers are turned off", "AI answers are unavailable right now"],
    [
      "/es/diagrams/player/",
      "Las respuestas de IA están desactivadas",
      "Las respuestas de IA no están disponibles ahora",
    ],
  ] as const) {
    for (const reason of ["status", "disabled", "control"] as const) {
      const watched = await open(browser, origin, url);
      const { page } = watched;
      let asks = 0;
      await page.route("**/api/ask/status", (route) =>
        route.fulfill({
          status: reason === "status" ? 503 : 200,
          contentType: "application/json",
          body: JSON.stringify(
            reason === "status" ? { enabled: false, reason: "control" } : { enabled: true },
          ),
        }),
      );
      await page.route("**/api/ask", (route) => {
        asks++;
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ reason }),
        });
      });
      await page.click(".ask-open");
      if (reason !== "status") {
        await page.fill("#ask-question", "How do I export a story as a video?");
        await page.click(".ask-submit");
      }
      await page.waitForSelector(
        `.ask-problem[data-kind="${reason === "status" ? "control" : reason}"]:not([hidden])`,
      );
      const said = (await page.textContent(".ask-problem p")) ?? "";
      if (!said.includes(reason === "disabled" ? disabledPhrase : controlPhrase)) {
        failures.push(`${url}/${reason}: the distinct unavailable explanation is missing: ${said}`);
      }
      if (!(await page.isDisabled(".ask-submit")))
        failures.push(`${url}/${reason}: Ask remains enabled`);
      if (asks !== (reason === "status" ? 0 : 1))
        failures.push(`${url}/${reason}: unexpected question count ${asks}`);
      await page.click("[data-search]");
      await page.waitForSelector("site-search dialog[open]");
      failures.push(
        ...watched.problems
          .filter((p) => !p.includes("status of 503"))
          .map((p) => `${url}/${reason}: ${p}`),
      );
      await watched.context.close();
    }
  }
  return failures;
};

/** Closing an outstanding availability check must not override the next open's fresh answer. */
const staleStatus: Check = async (browser, origin) => {
  const failures: string[] = [];
  const watched = await open(browser, origin, "/diagrams/player/");
  const { page } = watched;
  let finishFirst: (() => void) | undefined;
  const first = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  let reads = 0;
  const firstRequested = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/ask/status",
  );
  await page.route("**/api/ask/status", async (route) => {
    reads++;
    if (reads === 1) {
      await first;
      await route
        .fulfill({ contentType: "application/json", body: JSON.stringify({ enabled: false }) })
        .catch(() => undefined);
    } else {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ enabled: true }),
      });
    }
  });
  await page.click(".ask-open");
  await firstRequested;
  await page.waitForFunction(
    () => document.querySelector(".ask-result")?.getAttribute("aria-busy") === "true",
  );
  await page.click("[data-close]");
  await page.click(".ask-open");
  await page.waitForFunction(
    () => !document.querySelector<HTMLButtonElement>(".ask-submit")!.disabled,
  );
  finishFirst!();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  if (await page.isDisabled(".ask-submit"))
    failures.push("a stale status response disabled the fresh Ask form");
  failures.push(...watched.problems.filter((p) => !p.includes("ERR_FAILED")));
  await watched.context.close();
  return failures;
};

/** Reduced motion: the dialog opens with no transition; otherwise it moves over the motion token. */
const motion: Check = async (browser, origin) => {
  const failures: string[] = [];
  for (const reducedMotion of [false, true]) {
    const watched = await open(browser, origin, "/diagrams/player/", { reducedMotion });
    const { page } = watched;
    await page.click(".ask-open");
    const durations = await page.evaluate(
      () => getComputedStyle(document.querySelector(".ask-dialog")!).transitionDuration,
    );
    const moving = durations.split(",").some((d) => parseFloat(d) > 0);
    if (reducedMotion && moving)
      failures.push(`reduced motion: the dialog's transition lasts ${durations}`);
    if (!reducedMotion && !moving) failures.push("the dialog opens with no transition");
    failures.push(...watched.problems);
    await watched.context.close();
  }
  return failures;
};

/** Light and dark follow the system, and the theme switch overrides it. */
const schemes: Check = async (browser, origin) => {
  const failures: string[] = [];
  const background = (page: Page) =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lockup = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll(".portal-lockup")]
        .find((img) => getComputedStyle(img).display !== "none")
        ?.getAttribute("src"),
    );
  const light = await open(browser, origin, "/diagrams/player/", { scheme: "light" });
  const dark = await open(browser, origin, "/diagrams/player/", { scheme: "dark" });
  const [lightBg, darkBg] = [await background(light.page), await background(dark.page)];
  if (lightBg !== "rgb(248, 250, 252)")
    failures.push(`light background is ${lightBg}, not the --bg token`);
  if (darkBg !== "rgb(11, 18, 32)")
    failures.push(`dark background is ${darkBg}, not the --bg token`);
  if ((await lockup(light.page)) !== "/media/meltemi-lockup-light.svg")
    failures.push("the light scheme shows the dark lockup");
  if ((await lockup(dark.page)) !== "/media/meltemi-lockup-dark.svg")
    failures.push("the dark scheme shows the light lockup");
  await dark.page.selectOption("starlight-theme-select select", "light");
  await dark.page.waitForTimeout(150);
  if ((await background(dark.page)) !== lightBg)
    failures.push("choosing light under a dark system kept the dark background");
  failures.push(...light.problems, ...dark.problems);
  await light.context.close();
  await dark.context.close();
  return failures;
};

/** A phone's width: no sideways scroll, the Ask button a touch target, the dialog filling the screen. */
const phone: Check = async (browser, origin) => {
  const failures: string[] = [];
  for (const url of ["/", "/diagrams/language/stories/", "/es/ide/quickstart/"]) {
    const watched = await open(browser, origin, url, { width: 375 });
    const { page } = watched;
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    if (wide > 1) failures.push(`${url}: ${wide} px wider than a 375 px screen`);
    const button = await page.locator(".ask-open").boundingBox();
    if (!button || button.width < 44 || button.height < 44)
      failures.push(`${url}: the Ask button is ${button?.width}×${button?.height}`);
    await page.click(".ask-open");
    await page.waitForTimeout(400);
    const frame = await page.locator(".ask-dialog").boundingBox();
    if (!frame || frame.width < 370)
      failures.push(`${url}: the dialog is ${frame?.width} px wide on a phone`);
    failures.push(...watched.problems.map((p) => `${url}: ${p}`));
    await watched.context.close();
  }
  return failures;
};

/** Without JavaScript: the words are there, the picker is a link, the Ask button stays hidden. */
const withoutScript: Check = async (browser, origin) => {
  const failures: string[] = [];
  for (const url of ["/", "/diagrams/language/stories/", "/ide/quickstart/"]) {
    const watched = await open(browser, origin, url, { javaScript: false });
    const { page } = watched;
    const seen = await page.evaluate(() => ({
      h1: document.querySelector("h1")?.textContent?.trim() ?? "",
      lang: (document.querySelector(".portal-lang") as HTMLAnchorElement | null)?.getAttribute(
        "href",
      ),
      ask: document.querySelector(".ask-open")
        ? getComputedStyle(document.querySelector(".ask-open")!).display
        : "none",
      figure: document.querySelectorAll(".meltemi-picture svg").length,
    }));
    if (!seen.h1) failures.push(`${url}: no heading`);
    if (!seen.lang) failures.push(`${url}: no link to the other language`);
    if (seen.ask !== "none") failures.push(`${url}: the Ask button shows without a script`);
    if (url === "/diagrams/language/stories/" && seen.figure !== 1)
      failures.push(`${url}: ${seen.figure} pictures`);
    failures.push(...watched.problems.map((p) => `${url}: ${p}`));
    await watched.context.close();
  }
  return failures;
};

const CHECKS: readonly [string, Check][] = [
  ["every page is quiet: no error, no policy violation, nothing beyond localhost", quiet],
  ["the headers: the policy, no cookie, and the route's own", headers],
  ["search finds purchase on the Stories page, in English only; empty, it shows nothing", search],
  ["ask the docs answers the fixture question with its source, in both languages", ask],
  ["a spent allowance says so and offers the search", allowance],
  [
    "disabled AI preserves guides, search and the question, and reopening reads current status in both languages",
    disabled,
  ],
  [
    "control failures and a mid-dialog switch disable AI distinctly from its allowance in both languages",
    control,
  ],
  ["a stale status check cannot override a reopened Ask dialog", staleStatus],
  ["the dialog moves over the motion token, and not at all under reduced motion", motion],
  ["light and dark schemes follow the system and the switch", schemes],
  ["a phone's width: no sideways scroll, touch targets, a full-screen dialog", phone],
  ["without JavaScript, every page reads", withoutScript],
];

async function main(): Promise<number> {
  const only = process.argv.slice(2);
  const chosen = CHECKS.filter(
    ([name]) => !only.length || only.some((word) => name.includes(word)),
  );
  if (!chosen.length) throw new Error(`no check is named by ${only.join(", ")}`);
  await buildPortal({ mode: "fixture", embedder: "fake", log: (line) => console.log(line) });
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
