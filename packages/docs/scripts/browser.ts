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
import { mkdir } from "node:fs/promises";
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
  /** A script run before the page's own, to take something away from the browser. */
  readonly init?: string;
  readonly navigation?: () =>
    { body: unknown; status?: number } | Promise<{ body: unknown; status?: number }>;
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
  if (visit.navigation) {
    await context.route("**/api/account-menu", async (route) => {
      requests.push(route.request().url());
      const reply = await visit.navigation!();
      await route
        .fulfill({
          status: reply.status ?? 200,
          contentType: "application/json",
          headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
          body: JSON.stringify(reply.body),
        })
        .catch(() => undefined);
    });
  }
  await context.addInitScript({ content: "globalThis.__name = (f) => f;" });
  if (visit.init) await context.addInitScript({ content: visit.init });
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

/** Owner discovery is private and progressive; its navigation stays visible at narrow widths. */
const accountOwners: Check = async (browser, origin) => {
  const failures: string[] = [];
  const evidence = process.env["MELTEMI_DOCS_SCREENSHOTS"];
  if (evidence) await mkdir(evidence, { recursive: true });
  for (const [url, lang, label] of [
    ["/diagrams/player/", "en", "Administration"],
    ["/es/diagrams/player/", "es", "Administración"],
  ] as const) {
    for (const width of [320, 375, 800, 1280]) {
      let release: ((value: { body: unknown }) => void) | undefined;
      const pending = new Promise<{ body: unknown }>((resolve) => {
        release = resolve;
      });
      const displayName = "Ada <img src=x onerror=alert(1)> Lovelace · a very long account name";
      const watched = await open(browser, origin, url, {
        width,
        scheme: width === 375 ? "dark" : "light",
        navigation: () => pending,
      });
      const { page } = watched;
      if (await page.isVisible("[data-account-admin]"))
        failures.push(`${url}/${width}: owner link flashed before confirmation`);
      const response = { body: { authenticated: true, name: displayName, owner: true } };
      release!(response);
      await page.waitForSelector("[data-account-admin]:not([hidden])");
      if ((await page.textContent("[data-account-admin]")) !== label)
        failures.push(`${url}/${width}: missing administration label`);
      if (
        (await page.getAttribute("[data-account-admin]", "href")) !==
        `https://id.meltemi.dev/admin/?lang=${lang}`
      )
        failures.push(`${url}/${width}: wrong central administration destination`);
      const admin = await page.locator("[data-account-admin]").boundingBox();
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (wide > 1) failures.push(`${url}/${width}: header overflows by ${wide}px`);
      if (
        !admin ||
        admin.x < 0 ||
        admin.x + admin.width > width ||
        admin.y < 0 ||
        (width === 375 && admin.height < 44)
      )
        failures.push(`${url}/${width}: administration is not a usable header target`);
      if (evidence)
        await page.screenshot({ path: join(evidence, `docs-account-${lang}-${width}-closed.png`) });
      // Native details dispatches toggle after the click: the prior idle/name state can still
      // match before its refresh starts. Observe that new response before checking the result.
      const refreshed = page.waitForResponse(
        (answer) =>
          new URL(answer.url()).pathname === "/api/account-menu" &&
          answer.request().method() === "GET",
      );
      await page.click(".portal-account-summary");
      await refreshed;
      await page.waitForFunction(
        (expected) =>
          document.querySelector("meltemi-account")?.getAttribute("aria-busy") === "false" &&
          document.querySelector("[data-account-name]")?.textContent === expected,
        displayName,
      );
      if ((await page.textContent("[data-account-name]")) !== displayName)
        failures.push(`${url}/${width}: display name was not shown as text`);
      if (await page.locator(".portal-account-panel img, .portal-account-panel script").count())
        failures.push(`${url}/${width}: display name created markup`);
      const links = await page
        .locator(".portal-account-panel a")
        .evaluateAll((elements) => elements.map((element) => (element as HTMLAnchorElement).href));
      for (const path of ["/account/profile", "/account/preferences", "/account"])
        if (!links.includes(`https://id.meltemi.dev${path}?lang=${lang}`))
          failures.push(`${url}/${width}: missing personal destination ${path}`);
      const logout = new URL(links[3]!);
      if (
        logout.origin !== "https://id.meltemi.dev" ||
        logout.pathname !== "/logout" ||
        logout.searchParams.get("return_to") !== `https://docs.meltemi.dev${url}`
      )
        failures.push(`${url}/${width}: unsafe logout destination`);
      await page.locator(".portal-account-panel").evaluate(async (element) => {
        await Promise.all(
          element.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
        );
      });
      const panel = await page.locator(".portal-account-panel").boundingBox();
      if (!panel || panel.x < 0 || panel.x + panel.width > width)
        failures.push(`${url}/${width}: account menu extends beyond the viewport`);
      if (evidence)
        await page.screenshot({ path: join(evidence, `docs-account-${lang}-${width}.png`) });
      await page.keyboard.press("Escape");
      const focus = await page.evaluate(() => ({
        open: document.querySelector<HTMLDetailsElement>("[data-account-details]")?.open,
        summary: document.activeElement?.matches(".portal-account-summary"),
      }));
      if (focus.open || !focus.summary)
        failures.push(`${url}/${width}: Escape did not close and return focus`);
      failures.push(...watched.problems.map((problem) => `${url}/${width}: ${problem}`));
      await watched.context.close();
    }
  }
  return failures;
};

/** Every signed-in account gets personal links; anonymous/malformed/outage state gets no owner UI. */
const accountVisitors: Check = async (browser, origin) => {
  const failures: string[] = [];
  for (const [url, lang] of [
    ["/diagrams/player/", "en"],
    ["/es/diagrams/player/", "es"],
  ] as const) {
    for (const reply of [
      { body: { authenticated: true, name: "Regular reader", owner: false } },
      { body: { authenticated: false } },
      { body: { authenticated: true, name: "Malformed owner", owner: "true" } },
      { body: { reason: "unavailable" }, status: 503 },
    ]) {
      const watched = await open(browser, origin, url, { navigation: () => reply });
      const { page } = watched;
      await page.waitForFunction(
        () => document.querySelector("meltemi-account")?.getAttribute("aria-busy") === "false",
      );
      if (await page.isVisible("[data-account-admin]"))
        failures.push(`${url}: an ordinary/invalid visitor sees administration`);
      if (reply.body.authenticated === true && reply.body.owner === false) {
        await page.click(".portal-account-summary");
        await page.waitForSelector(".portal-account-details[open]");
        if ((await page.locator(".portal-account-panel a").count()) !== 4)
          failures.push(`${url}: ordinary account navigation is incomplete`);
      } else if (
        !(await page.isVisible("[data-account-fallback]")) ||
        (await page.getAttribute("[data-account-fallback]", "href")) !==
          `https://id.meltemi.dev/account?lang=${lang}`
      )
        failures.push(`${url}: generic account fallback is unavailable`);
      if (
        !(await page.isVisible("h1")) ||
        !(await page.isVisible("site-search button[data-open-modal]"))
      )
        failures.push(`${url}: account failure obscured guides or search`);
      failures.push(
        ...watched.problems
          .filter((problem) => !problem.includes("status of 503"))
          .map((problem) => `${url}: ${problem}`),
      );
      await watched.context.close();
    }
  }
  return failures;
};

/** A current owner is hidden immediately when refreshing; late replies cannot restore revoked access. */
const accountRevocation: Check = async (browser, origin) => {
  const failures: string[] = [];
  const owner = { body: { authenticated: true, name: "Service owner", owner: true } };
  let reply: () =>
    { body: unknown; status?: number } | Promise<{ body: unknown; status?: number }> = () => owner;
  const watched = await open(browser, origin, "/diagrams/player/", { navigation: () => reply() });
  const { page } = watched;
  await page.waitForSelector("[data-account-admin]:not([hidden])");
  let release: ((value: { body: unknown }) => void) | undefined;
  const late = new Promise<{ body: unknown }>((resolve) => {
    release = resolve;
  });
  reply = () => late;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(
    () => document.querySelector("meltemi-account")?.getAttribute("aria-busy") === "true",
  );
  if (await page.isVisible("[data-account-admin]"))
    failures.push("a pending authorization refresh retained the owner link");
  if ((await page.textContent("[data-account-name]")) !== "")
    failures.push("a pending authorization refresh retained a personal name");
  reply = () => ({ body: { authenticated: false } });
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
  );
  await page.waitForFunction(
    () => document.querySelector("meltemi-account")?.getAttribute("aria-busy") === "false",
  );
  release!(owner);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  if (await page.isVisible("[data-account-admin]"))
    failures.push("a stale response restored revoked administration");
  if (!(await page.isVisible("[data-account-fallback]")))
    failures.push("revocation removed generic account access");
  reply = () => owner;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForSelector("[data-account-admin]:not([hidden])");
  reply = () => ({ status: 503, body: { reason: "unavailable" } });
  await page.click(".portal-account-summary");
  await page.waitForSelector("[data-account-fallback]:not([hidden])");
  if (await page.isVisible("[data-account-admin]"))
    failures.push("an outage retained prior owner access");
  if (!(await page.isVisible("[data-account-fallback]")))
    failures.push("an outage removed generic account access");
  failures.push(
    ...watched.problems.filter(
      (problem) => !problem.includes("status of 503") && !problem.includes("ERR_FAILED"),
    ),
  );
  await watched.context.close();
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

/** The same word exists in all three products, so this checks filtering rather than ranking. */
const productSearch: Check = async (browser, origin) => {
  const failures: string[] = [];
  const paths = (page: Page) =>
    page.$$eval("#starlight__search .pagefind-ui__result-link", (links) =>
      links.map((link) => (link as HTMLAnchorElement).pathname),
    );
  const settled = async (page: Page) => {
    // Pagefind debounces input for 300 ms. Then wait for the index and result fragments too.
    await page.waitForTimeout(400);
    await page.waitForFunction(() => {
      const message = document.querySelector("#starlight__search .pagefind-ui__message");
      return (
        message?.textContent?.trim() &&
        !/^(searching|buscando)\b/i.test(message.textContent.trim()) &&
        !document.querySelector("#starlight__search .pagefind-ui__loading")
      );
    });
  };
  for (const [prefix, term] of [
    ["/", "session"],
    ["/es/", "sesión"],
  ] as const) {
    for (const product of ["all", "diagrams", "ide", "web"] as const) {
      const url = product === "all" ? prefix : `${prefix}${product}/`;
      const watched = await open(browser, origin, url, {
        width: product === "web" ? 375 : 1280,
        scheme: product === "ide" ? "dark" : "light",
      });
      const { page } = watched;
      await page.keyboard.press("Control+k");
      await page.waitForSelector("#starlight__search input");
      if ((await page.inputValue("#docs-search-scope")) !== product)
        failures.push(`${url}: wrong default search scope`);
      await page.fill("#starlight__search input", term);
      await settled(page);
      const found = await paths(page);
      if (!found.length) failures.push(`${url}: ${term} has no result`);
      if (
        found.some(
          (path) => !path.startsWith(prefix) || (prefix === "/" && path.startsWith("/es/")),
        )
      )
        failures.push(`${url}: search mixed languages: ${found}`);
      if (product === "all") {
        for (const wanted of ["diagrams", "ide", "web"])
          if (!found.some((path) => path.startsWith(`${prefix}${wanted}/`)))
            failures.push(`${url}: the general search omitted ${wanted}: ${found}`);
      } else if (found.some((path) => !path.startsWith(`${prefix}${product}/`))) {
        failures.push(`${url}: product search leaked results: ${found}`);
      }
      await page.selectOption("#docs-search-scope", "web");
      await settled(page);
      if ((await page.inputValue("#starlight__search input")) !== term)
        failures.push(`${url}: changing product lost the query`);
      const scopeLabels = await page.evaluate(() => ({
        button: document.querySelector("site-search [data-open-modal]")?.getAttribute("aria-label"),
        visible: document.querySelector("site-search .search-label")?.textContent,
        placeholder: document.querySelector<HTMLInputElement>("#starlight__search input")
          ?.placeholder,
        title: document.querySelector<HTMLInputElement>("#starlight__search input")?.title,
      }));
      if (
        !scopeLabels.button?.includes("Meltemi Web") ||
        scopeLabels.visible !== scopeLabels.button ||
        scopeLabels.title !== scopeLabels.placeholder
      )
        failures.push(
          `${url}: search labels retained the old product: ${JSON.stringify(scopeLabels)}`,
        );
      const web = await paths(page);
      if (!web.length || web.some((path) => !path.startsWith(`${prefix}web/`)))
        failures.push(`${url}: selecting Web found ${web}`);
      await page.selectOption("#docs-search-scope", "all");
      await settled(page);
      const all = await paths(page);
      if (!all.some((path) => path.startsWith(`${prefix}diagrams/`)))
        failures.push(`${url}: widening the search did not restore Diagrams`);
      await page.selectOption("#docs-search-scope", "diagrams");
      await settled(page);
      await page.click(".pagefind-ui__search-clear");
      await page.waitForFunction(
        () => !document.querySelector("#starlight__search .pagefind-ui__result"),
      );
      await page.selectOption("#docs-search-scope", "ide");
      await page.fill("#starlight__search input", "purchase");
      await settled(page);
      if ((await paths(page)).length)
        failures.push(`${url}: an unmatched IDE query silently widened to another product`);
      await page.keyboard.press("Escape");
      await page.waitForFunction(() =>
        document.activeElement?.matches("site-search [data-open-modal]"),
      );
      await page.click("site-search [data-open-modal]");
      if ((await page.inputValue("#docs-search-scope")) !== "ide")
        failures.push(`${url}: reopening forgot the selected scope`);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (wide > 1) failures.push(`${url}: search overflows horizontally by ${wide}px`);
      const selector = await page.locator("#docs-search-scope").boundingBox();
      if (!selector || selector.height < 44)
        failures.push(`${url}: the scope selector is not a touch target`);
      if (product === "web") {
        const frame = await page.locator(".search-dialog").boundingBox();
        if (!frame || frame.width < 370)
          failures.push(`${url}: search is not full width on a phone`);
      }
      failures.push(...watched.problems.map((problem) => `${url}: ${problem}`));
      await watched.context.close();
    }
  }
  return failures;
};

/** The submitted scope, answer reset and search fallback all follow the visible selection. */
const productAsk: Check = async (browser, origin) => {
  const failures: string[] = [];
  for (const prefix of ["/", "/es/"]) {
    for (const product of ["all", "diagrams", "ide", "web"] as const) {
      const url = product === "all" ? prefix : `${prefix}${product}/`;
      const watched = await open(browser, origin, url);
      const { page } = watched;
      const bodies: Record<string, unknown>[] = [];
      let release: (() => void) | undefined;
      let pending = false;
      let received: () => void;
      const pendingReceived = new Promise<void>((resolve) => {
        received = resolve;
      });
      await page.route("**/api/ask", async (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        bodies.push(body);
        if (pending) {
          received!();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        const section = body["section"] ?? "diagrams";
        await route
          .fulfill({
            contentType: "application/json",
            body: JSON.stringify({
              answer: "An answer from the chosen guides. [1]",
              sources: [
                {
                  n: 1,
                  title: "Guide",
                  url: `${prefix}${section}/`,
                  lang: prefix === "/" ? "en" : "es",
                  section,
                },
              ],
            }),
          })
          .catch(() => undefined);
      });
      await page.click(".ask-open");
      await page.waitForFunction(
        () => !document.querySelector<HTMLButtonElement>(".ask-submit")!.disabled,
      );
      if ((await page.inputValue("#ask-scope")) !== product)
        failures.push(`${url}: wrong default Ask scope`);
      const question = "How do I use a session?";
      await page.fill("#ask-question", question);
      await page.click(".ask-submit");
      await page.waitForSelector(".ask-answer:not([hidden])");
      if (bodies[0]?.["section"] !== (product === "all" ? undefined : product))
        failures.push(`${url}: Ask sent the wrong scope: ${JSON.stringify(bodies[0])}`);
      await page.selectOption("#ask-scope", "web");
      if ((await page.inputValue("#ask-question")) !== question)
        failures.push(`${url}: changing Ask scope lost the question`);
      if (await page.isVisible(".ask-answer"))
        failures.push(`${url}: an old product's answer stayed visible`);
      pending = true;
      await page.click(".ask-submit");
      await page.waitForFunction(
        () => document.querySelector(".ask-result")?.getAttribute("aria-busy") === "true",
      );
      await pendingReceived;
      await page.selectOption("#ask-scope", "ide");
      release?.();
      await page.waitForTimeout(100);
      if (await page.isVisible(".ask-answer"))
        failures.push(`${url}: an aborted answer restored stale content`);
      if (await page.isDisabled(".ask-submit"))
        failures.push(`${url}: switching scope left Ask busy`);
      pending = false;
      await page.selectOption("#ask-scope", "all");
      await page.click(".ask-submit");
      await page.waitForSelector(".ask-answer:not([hidden])");
      if (bodies.at(-1)?.["section"] !== undefined)
        failures.push(`${url}: all guides still sent a product filter`);
      await page.selectOption("#ask-scope", "ide");
      await page.unroute("**/api/ask");
      await page.route("**/api/ask", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ reason: "allowance" }),
        }),
      );
      await page.click(".ask-submit");
      await page.waitForSelector(".ask-problem:not([hidden])");
      await page.click("meltemi-ask [data-search]");
      await page.waitForSelector("site-search dialog[open]");
      if ((await page.inputValue("#docs-search-scope")) !== "ide")
        failures.push(`${url}: Ask's search fallback used another product`);
      failures.push(
        ...watched.problems
          .filter(
            (problem) => !problem.includes("status of 503") && !problem.includes("ERR_FAILED"),
          )
          .map((problem) => `${url}: ${problem}`),
      );
      await watched.context.close();
    }
  }
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

/** Filtered sources keep their numbers aligned with answer links, even across gaps. */
const citationNumbers: Check = async (browser, origin) => {
  const failures: string[] = [];
  for (const lang of ["en", "es"] as const) {
    const prefix = lang === "es" ? "/es" : "";
    const paths = [
      "/diagrams/language/stories/",
      "/diagrams/player/",
      "/diagrams/getting-started/",
      "/diagrams/features/",
      "/diagrams/",
      "/web/",
    ];
    const sources = [1, 2, 3, 4, 6, 7].map((n, i) => ({
      n,
      title: `Guide ${n}`,
      url: prefix + paths[i],
      lang,
    }));
    const watched = await open(browser, origin, `${prefix}/diagrams/player/`);
    const { page } = watched;
    await page.route("**/api/ask", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ answer: "[1] [2] [3] [4] [6] [7]", sources }),
      }),
    );
    await page.click(".ask-open");
    await page.waitForFunction(
      () => !document.querySelector<HTMLButtonElement>(".ask-submit")!.disabled,
    );
    await page.selectOption("#ask-scope", "all");
    await page.fill("#ask-question", "Where can I read these guides?");
    await page.click(".ask-submit");
    await page.waitForSelector(".ask-answer:not([hidden])");
    const seen = await page.evaluate(() => ({
      rows: [...document.querySelectorAll<HTMLLIElement>(".ask-sources li")].map((item) => ({
        n: item.value,
        href: item.querySelector("a")?.getAttribute("href"),
      })),
      citations: [...document.querySelectorAll<HTMLAnchorElement>(".ask-cite")].map((link) => ({
        n: Number(link.textContent?.slice(1, -1)),
        href: link.getAttribute("href"),
      })),
    }));
    const expected = sources.map((source) => ({ n: source.n, href: source.url }));
    if (JSON.stringify(seen.rows) !== JSON.stringify(expected))
      failures.push(`${lang}: source list renumbered the citations: ${JSON.stringify(seen.rows)}`);
    if (JSON.stringify(seen.citations) !== JSON.stringify(expected))
      failures.push(`${lang}: answer citations do not match their source destinations`);
    failures.push(...watched.problems.map((problem) => `${lang}: ${problem}`));
    await watched.context.close();
  }
  return failures;
};

/** A provider failure offers search without guessing the account's billing state. */
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
  if (!said.includes("AI answers are temporarily unavailable"))
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

/** What `home-sea.ts` reports of the moving sea, or undefined where it never played. */
interface SeaSeen {
  readonly renderer: string;
  readonly frames: number;
  readonly paused: boolean;
  readonly windFrames: number;
}

/** The home's block as the reader sees it, and the sea's report. */
const seaOf = (page: Page) =>
  page.evaluate(() => {
    const shown = (selector: string) =>
      [...document.querySelectorAll<HTMLElement>(selector)].filter(
        (el) =>
          getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden",
      ).length;
    const button = document.querySelector<HTMLButtonElement>(".portal-sea-pause");
    const report = (window as unknown as { meltemiDocsSea?: SeaSeen }).meltemiDocsSea;
    return {
      sea: report
        ? {
            renderer: report.renderer,
            frames: report.frames,
            paused: report.paused,
            windFrames: report.windFrames,
          }
        : undefined,
      stills: shown(".portal-sea-still"),
      canvases: shown(".portal-sea-canvas"),
      boats: shown(".portal-sea-boat"),
      placed: [...document.querySelectorAll<HTMLElement>(".portal-sea-boat")].filter(
        (boat) => boat.style.transform !== "",
      ).length,
      button: button && !button.hidden ? button.getAttribute("aria-label") : null,
      pressed: button?.getAttribute("aria-pressed") ?? null,
      point: getComputedStyle(document.querySelector(".portal-sea-canvas")!)
        .getPropertyValue("--sea-point")
        .trim(),
    };
  });

/** Frames the sea draws over `ms`, read from its report. */
async function framesOver(page: Page, ms: number): Promise<number> {
  const before = (await seaOf(page)).sea?.frames ?? 0;
  await page.waitForTimeout(ms);
  return ((await seaOf(page)).sea?.frames ?? 0) - before;
}

/** The scripts a page fetched from the portal's `/_astro/`. */
const scriptsOf = (requests: readonly string[]) =>
  new Set(
    requests.filter((url) => /\/_astro\/[^/]+\.js$/.test(url)).map((url) => new URL(url).pathname),
  );

/**
 * The home's sea (specification `docs-portal`, docs-home-sea): it plays over the still picture
 * with its six marks, stops on the button and out of view, follows the theme picker, fits a
 * phone, and stays the still picture under reduced motion, without a script and without a drawing
 * surface. With `MELTEMI_DOCS_SHOTS=<folder>` it saves what it saw there.
 */
const homeSea: Check = async (browser, origin) => {
  const failures: string[] = [];
  const shots = process.env["MELTEMI_DOCS_SHOTS"];
  if (shots) await mkdir(shots, { recursive: true });
  const shoot = async (page: Page, name: string) => {
    if (!shots) return;
    await page.screenshot({ path: join(shots, `${name}.png`) });
    await page.locator(".portal-sea").screenshot({ path: join(shots, `${name}-sea.png`) });
  };
  const playing = async (page: Page, where: string) => {
    await page
      .waitForFunction(
        () => ((window as unknown as { meltemiDocsSea?: SeaSeen }).meltemiDocsSea?.frames ?? 0) > 3,
        undefined,
        { timeout: 10_000 },
      )
      .catch(() => failures.push(`${where}: the sea drew no frames`));
    return seaOf(page);
  };

  // At 1280 px, light: the sea plays, the still picture steps aside, six marks sail.
  const desk = await open(browser, origin, "/");
  const seen = await playing(desk.page, "/");
  if (seen.sea && !["webgl2", "2d"].includes(seen.sea.renderer))
    failures.push(`/: the sea draws with ${seen.sea.renderer}`);
  if (seen.stills !== 0) failures.push(`/: ${seen.stills} still pictures shown over the sea`);
  if (seen.canvases !== 1) failures.push(`/: ${seen.canvases} sea canvases shown`);
  if (seen.boats !== 6 || seen.placed !== 6)
    failures.push(`/: ${seen.boats} marks shown, ${seen.placed} placed, not 6`);
  if (seen.button !== "Pause animation") failures.push(`/: the button is named ${seen.button}`);
  if (seen.point !== "#2563eb") failures.push(`/: the light sea's points are ${seen.point}`);
  if (!seen.sea || seen.sea.windFrames < 1) failures.push("/: the wind drew no frame");
  await desk.page.waitForTimeout(1200);
  await shoot(desk.page, "home-light-1280");

  // The button stops the sea and starts it again.
  await desk.page.click(".portal-sea-pause");
  await desk.page.waitForTimeout(100);
  const paused = await seaOf(desk.page);
  if (paused.pressed !== "true" || paused.button !== "Play animation" || !paused.sea?.paused)
    failures.push(`/: after a press the button is ${paused.pressed}, ${paused.button}`);
  const stillFrames = await framesOver(desk.page, 600);
  if (stillFrames !== 0) failures.push(`/: the paused sea drew ${stillFrames} frames`);
  await desk.page.click(".portal-sea-pause");
  const resumed = await framesOver(desk.page, 600);
  if (resumed < 3) failures.push(`/: the resumed sea drew ${resumed} frames in 600 ms`);

  // Out of view, no frame; back in view, frames again.
  await desk.page.setViewportSize({ width: 1280, height: 320 });
  await desk.page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await desk.page.waitForTimeout(200);
  const away = await framesOver(desk.page, 600);
  if (away !== 0) failures.push(`/: the sea drew ${away} frames out of view`);
  await desk.page.evaluate(() => scrollTo(0, 0));
  await desk.page.setViewportSize({ width: 1280, height: 860 });
  const back = await framesOver(desk.page, 600);
  if (back < 3) failures.push(`/: back in view the sea drew ${back} frames in 600 ms`);

  // The theme picker recolours the moving sea.
  await desk.page.selectOption("starlight-theme-select select", "dark");
  await desk.page.waitForTimeout(300);
  const dark = await seaOf(desk.page);
  if (dark.point !== "#60a5fa") failures.push(`/: the dark sea's points are ${dark.point}`);
  if (dark.stills !== 0) failures.push("/: the dark scheme brought the still picture back");
  await shoot(desk.page, "home-dark-1280");
  const withSea = scriptsOf(desk.requests);
  failures.push(...desk.problems.map((p) => `/: ${p}`));
  await desk.context.close();

  // A phone, in Spanish and dark: within the screen, the button in Spanish.
  const phoneVisit = await open(browser, origin, "/es/", { width: 375, scheme: "dark" });
  const onPhone = await playing(phoneVisit.page, "/es/ at 375 px");
  const wide = await phoneVisit.page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  if (wide > 1) failures.push(`/es/: ${wide} px wider than a 375 px screen`);
  if (onPhone.button !== "Pausar animación")
    failures.push(`/es/: the button is named ${onPhone.button}`);
  const target = await phoneVisit.page.locator(".portal-sea-pause").boundingBox();
  if (!target || target.width < 44 || target.height < 44)
    failures.push(`/es/: the pause button is ${target?.width}×${target?.height} on a phone`);
  await phoneVisit.page.waitForTimeout(1200);
  await shoot(phoneVisit.page, "home-es-dark-375");
  failures.push(...phoneVisit.problems.map((p) => `/es/ at 375 px: ${p}`));
  await phoneVisit.context.close();

  // Reduced motion: the still picture, no button, none of the sea's code.
  const calm = await open(browser, origin, "/", { reducedMotion: true });
  await calm.page.waitForTimeout(800);
  await shoot(calm.page, "home-still-light-1280");
  const rest = await seaOf(calm.page);
  if (rest.sea) failures.push("/ under reduced motion: the sea plays");
  if (rest.stills !== 1)
    failures.push(`/ under reduced motion: ${rest.stills} still pictures shown`);
  if (rest.boats !== 0) failures.push(`/ under reduced motion: ${rest.boats} marks shown`);
  if (rest.button !== null) failures.push("/ under reduced motion: the pause button shows");
  const without = scriptsOf(calm.requests);
  const seaCode = [...withSea].filter((path) => !without.has(path));
  if (!seaCode.length)
    failures.push("/ under reduced motion: it fetched every script the moving sea did");
  failures.push(...calm.problems.map((p) => `/ under reduced motion: ${p}`));
  await calm.context.close();

  // No drawing surface, and no script: the still picture stays and the marks stay hidden.
  for (const visit of [
    { name: "no drawing surface", init: "HTMLCanvasElement.prototype.getContext = () => null;" },
    { name: "no script", javaScript: false },
  ]) {
    const bare = await open(browser, origin, "/", visit);
    await bare.page.waitForTimeout(800);
    const still = await seaOf(bare.page);
    if (still.stills !== 1) failures.push(`/ with ${visit.name}: ${still.stills} still pictures`);
    if (still.boats !== 0 || still.canvases !== 0)
      failures.push(`/ with ${visit.name}: ${still.boats} marks, ${still.canvases} canvases shown`);
    failures.push(...bare.problems.map((p) => `/ with ${visit.name}: ${p}`));
    await bare.context.close();
  }
  return failures;
};

const CHECKS: readonly [string, Check][] = [
  ["every page is quiet: no error, no policy violation, nothing beyond localhost", quiet],
  ["the headers: the policy, no cookie, and the route's own", headers],
  [
    "owner account navigation is private, escaped, labelled and usable in EN/ES on desktop and phones",
    accountOwners,
  ],
  [
    "ordinary accounts, anonymous visitors and outages keep the correct account access without admin",
    accountVisitors,
  ],
  ["revocation, stale navigation and outages clear prior owner access", accountRevocation],
  ["search finds purchase on the Stories page, in English only; empty, it shows nothing", search],
  [
    "product search defaults, overrides, empty results, keyboard and mobile work in both languages",
    productSearch,
  ],
  [
    "product Ask defaults, overrides, stale answers and search fallback work in both languages",
    productAsk,
  ],
  ["ask the docs answers the fixture question with its source, in both languages", ask],
  ["citation numbers preserve gaps and source destinations in both languages", citationNumbers],
  ["a provider failure offers the search without a billing claim", allowance],
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
  [
    "the home's sea plays, pauses, rests out of view and follows the scheme; still under reduced motion",
    homeSea,
  ],
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
