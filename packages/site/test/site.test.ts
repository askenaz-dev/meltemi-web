// The checks of the specification `product-site`. Each one reads the files of `public/` and
// reports every offender by page and address, so a failure says what to fix. No network.

import type { Metafile } from "esbuild";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import {
  MARK_GRADIENT,
  MARK_HULL,
  MARK_M,
  STATES,
  fleetSize,
  type SeaState,
} from "../../ocean/src/index.js";
import { definitionOf } from "../../ocean/src/states.js";
import { BUILT, SITE, buildSite, stillColours } from "../scripts/build.js";
import {
  ALL_HTML,
  FILES,
  PAGES,
  PUBLIC,
  anchors,
  externalLinks,
  fileOfUrl,
  fileSet,
  headersFor,
  isSpanish,
  pageUrl,
  parseJsonc,
  read,
  redirects,
  tags,
  target,
  twinUrl,
} from "./support.js";

/** The pages the specification lists, in English; each has its twin under `/es/`. */
const REQUIRED = [
  "/",
  "/ide/",
  "/ide/method/",
  "/ide/agents/",
  "/ide/downloads/",
  "/diagrams/",
  "/privacy/",
  "/terms/",
];

const indexUrls = PAGES.map(pageUrl);

// ---------------------------------------------------------------------------------------------

describe("the family's site in two languages", () => {
  it("holds every page of the specification, in both languages", () => {
    const missing = REQUIRED.flatMap((url) => [url, twinUrl(url)]).filter(
      (url) => !fileSet.has(fileOfUrl(url)),
    );
    expect(missing, "pages missing from public/").toEqual([]);
  });

  it("gives every page a twin in the other language", () => {
    const problems: string[] = [];
    for (const url of indexUrls) {
      if (!fileSet.has(fileOfUrl(twinUrl(url)))) {
        const base = isSpanish(url) ? url : twinUrl(url);
        problems.push(
          `${url} has no twin ${twinUrl(url)} (the pair of ${isSpanish(url) ? twinUrl(base) : url})`,
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it("declares the language of every page", () => {
    const problems: string[] = [];
    for (const file of ALL_HTML) {
      const url = pageUrl(file);
      const html = tags(read(file)).find((t) => t.name === "html");
      const expected = isSpanish(url) ? "es" : "en";
      if (html?.attrs["lang"] !== expected) {
        problems.push(
          `${url}: <html lang> is ${JSON.stringify(html?.attrs["lang"])}, expected ${expected}`,
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it("declares the three alternates of every page, pointing at its pair", () => {
    const problems: string[] = [];
    for (const file of PAGES) {
      const url = pageUrl(file);
      const english = isSpanish(url) ? twinUrl(url) : url;
      const expected: Record<string, string> = {
        en: english,
        es: twinUrl(english),
        "x-default": english,
      };
      const found: Record<string, string> = {};
      for (const tag of tags(read(file))) {
        if (tag.name === "link" && tag.attrs["rel"] === "alternate" && tag.attrs["hreflang"]) {
          found[tag.attrs["hreflang"]] = tag.attrs["href"] ?? "";
        }
      }
      for (const [lang, href] of Object.entries(expected)) {
        if (found[lang] !== href) {
          problems.push(
            `${url}: alternate ${lang} is ${JSON.stringify(found[lang])}, expected ${href}`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("links a Spanish page to Spanish pages and an English page to English ones", () => {
    const problems: string[] = [];
    for (const file of ALL_HTML) {
      const url = pageUrl(file);
      for (const tag of tags(read(file))) {
        const href = tag.name === "a" ? tag.attrs["href"] : undefined;
        if (href === undefined) continue;
        const t = target(href, url);
        if (t.kind !== "internal" || !t.pathname.endsWith("/")) continue;
        const toSpanish = isSpanish(t.pathname);
        const switchesLanguage = tag.attrs["hreflang"] !== undefined;
        if (toSpanish !== isSpanish(url) && !switchesLanguage) {
          problems.push(`${url}: ${href} is in the other language and is not marked hreflang`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("presents both products on the home page, with a link to each", () => {
    for (const [file, ide, diagrams] of [
      ["index.html", "/ide/", "/diagrams/"],
      ["es/index.html", "/es/ide/", "/es/diagrams/"],
    ] as const) {
      const hrefs = tags(read(file)).flatMap((t) => (t.name === "a" ? [t.attrs["href"]] : []));
      expect(hrefs, `${file} links the IDE page`).toContain(ide);
      expect(hrefs, `${file} links the Diagrams page`).toContain(diagrams);
    }
  });

  it("keeps the IDE's media and the brand marks the pages use", () => {
    for (const file of [
      "media/desktop-sessions.png",
      "media/tui-sessions.svg",
      "media/meltemi-mark-gradient.svg",
      "media/meltemi-lockup-dark.svg",
      "media/meltemi-lockup-light.svg",
    ]) {
      expect(fileSet.has(file), `public/${file}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------

/**
 * What a page may not carry (specification `product-site`, "Self-hosted scripts and no external
 * resource"): a script that is inline or not one of the site's own modules under `/assets/`, an
 * inline event handler, a `javascript:` address, a `<style>` element or attribute, and a form,
 * base or frame. Each problem names the page and the element.
 */
export function pageProblems(html: string, url: string): string[] {
  const problems: string[] = [];
  const source = html.replace(/<!--[\s\S]*?-->/g, "");
  if (/<style/i.test(source)) problems.push(`${url}: a <style> element`);
  for (const m of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const [script] = tags(`<script${m[1] ?? ""}>`);
    const src = script?.attrs["src"];
    if ((m[2] ?? "").trim() !== "") problems.push(`${url}: an inline <script>`);
    else if (src === undefined) problems.push(`${url}: a <script> with no src`);
    else if (!/^\/assets\/[\w.-]+\.js$/.test(src)) problems.push(`${url}: a <script> from ${src}`);
    else if (script?.attrs["type"] !== "module")
      problems.push(`${url}: the <script> ${src} is not a module`);
  }
  for (const tag of tags(source)) {
    for (const name of Object.keys(tag.attrs)) {
      if (/^on[a-z]+$/.test(name))
        problems.push(`${url}: the event handler ${name} on <${tag.name}>`);
    }
    if (tag.attrs["style"] !== undefined)
      problems.push(`${url}: a style attribute on <${tag.name}>`);
    if (tag.name === "form" || tag.name === "base" || tag.name === "iframe") {
      problems.push(`${url}: a <${tag.name}> element`);
    }
    for (const attr of ["href", "src"]) {
      if (/^\s*javascript:/i.test(tag.attrs[attr] ?? ""))
        problems.push(`${url}: a javascript: ${attr}`);
    }
  }
  return problems;
}

describe("self-hosted scripts and no external resource", () => {
  it("loads only the site's own modules: no inline script, handler, form or javascript: address", () => {
    const problems = ALL_HTML.flatMap((file) => pageProblems(read(file), pageUrl(file)));
    expect(problems).toEqual([]);
  });

  it("lets a page load the site's own module", () => {
    const html = '<body><script type="module" src="/assets/site.js"></script></body>';
    expect(pageProblems(html, "/fixture/")).toEqual([]);
  });

  it.each([
    ["an inline script", "<script>alert(1)</script>", "/fixture/: an inline <script>"],
    [
      "an inline handler",
      '<button onclick="go()">Go</button>',
      "/fixture/: the event handler onclick on <button>",
    ],
    [
      "a script from a CDN",
      '<script type="module" src="https://cdn.jsdelivr.net/npm/motion"></script>',
      "/fixture/: a <script> from https://cdn.jsdelivr.net/npm/motion",
    ],
    [
      "a classic script of the site",
      '<script src="/assets/site.js"></script>',
      "/fixture/: the <script> /assets/site.js is not a module",
    ],
  ])("refuses %s, naming the page", (_, html, problem) => {
    expect(pageProblems(html, "/fixture/")).toEqual([problem]);
  });

  it("loads nothing from another origin: no stylesheet, image, font or media", () => {
    const problems: string[] = [];
    for (const file of ALL_HTML) {
      const url = pageUrl(file);
      for (const tag of tags(read(file))) {
        const fetches =
          (tag.name === "link" && tag.attrs["rel"] !== "alternate") ||
          [
            "img",
            "script",
            "source",
            "video",
            "audio",
            "embed",
            "object",
            "track",
            "input",
          ].includes(tag.name);
        if (!fetches) continue;
        for (const attr of ["href", "src", "srcset", "poster", "data"]) {
          const value = tag.attrs[attr];
          if (value === undefined) continue;
          const t = target(value.split(/\s+/)[0]!, url);
          if (t.kind === "external") problems.push(`${url}: <${tag.name}> loads ${t.url}`);
        }
      }
    }
    for (const file of FILES.filter((f) => f.endsWith(".css"))) {
      const css = read(file);
      if (/@import/i.test(css)) problems.push(`/${file}: an @import`);
      for (const m of css.matchAll(/url\(\s*['"]?\s*(https?:)?\/\/([^'")\s]*)/gi)) {
        problems.push(`/${file}: url() of ${m[0]}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("sets the policy headers on every path", () => {
    expect(headersFor("/*")).toEqual({
      "content-security-policy":
        "default-src 'none'; script-src 'self'; img-src 'self'; style-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types 'none'",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "strict-transport-security": "max-age=31536000",
    });
  });

  it("caches the hashed chunks for a year and the stable assets for five minutes", () => {
    expect(headersFor("/assets/chunk-*")).toEqual({
      "cache-control": "public, max-age=31536000, immutable",
    });
    for (const path of ["/assets/site.js", "/assets/sea-*"]) {
      expect(headersFor(path), path).toEqual({ "cache-control": "public, max-age=300" });
    }
  });

  it("is a Worker of static assets only, on the port the identity service names", () => {
    const wrangler = parseJsonc(read("../wrangler.jsonc")) as Record<string, unknown>;
    expect(wrangler["assets"]).toEqual({
      directory: "./public",
      html_handling: "auto-trailing-slash",
      not_found_handling: "404-page",
    });
    expect(wrangler["dev"]).toEqual({ port: 8789 });
    expect(wrangler, "no Worker code").not.toHaveProperty("main");
  });

  it("has no address but the Custom Domain Terraform attaches, and no binding", () => {
    const wrangler = parseJsonc(read("../wrangler.jsonc")) as Record<string, unknown>;
    expect(wrangler["name"]).toBe("meltemi-site");
    expect(wrangler).not.toHaveProperty("routes");
    expect(wrangler).not.toHaveProperty("route");
    expect(wrangler).not.toHaveProperty("account_id");
    expect(wrangler["workers_dev"]).toBe(false);
    expect(wrangler["preview_urls"]).toBe(false);
    const bindings = Object.keys(wrangler).filter((key) =>
      /^(d1_databases|r2_buckets|kv_namespaces|durable_objects|secrets_store_secrets|services|vars)$/.test(
        key,
      ),
    );
    expect(bindings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the old addresses keep answering", () => {
  const OLD: Record<string, string> = {
    "/index.html": "/ide/",
    "/method.html": "/ide/method/",
    "/agents.html": "/ide/agents/",
    "/downloads.html": "/ide/downloads/",
    "/es/index.html": "/es/ide/",
    "/es/method.html": "/es/ide/method/",
    "/es/agents.html": "/es/ide/agents/",
    "/es/downloads.html": "/es/ide/downloads/",
  };

  it("redirects every address GitHub Pages served to its new address with a 301", () => {
    const rules = new Map(redirects().map(([from, to, status]) => [from, { to, status }]));
    const problems: string[] = [];
    for (const [from, to] of Object.entries(OLD)) {
      const rule = rules.get(from);
      if (!rule) problems.push(`${from} has no rule`);
      else if (rule.to !== to || rule.status !== "301") {
        problems.push(`${from} goes to ${rule.to} with ${rule.status}, expected ${to} with 301`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("redirects to pages that exist", () => {
    const missing = redirects()
      .map(([, to]) => to)
      .filter((to) => !fileSet.has(fileOfUrl(to)));
    expect(missing).toEqual([]);
  });

  it("resolves every internal link of every page to a file or a folder with an index.html", () => {
    const problems: string[] = [];
    const idsOf = new Map<string, Set<string>>();
    for (const file of ALL_HTML) {
      const url = pageUrl(file);
      for (const tag of tags(read(file))) {
        for (const attr of ["href", "src"]) {
          const value = tag.attrs[attr];
          if (value === undefined) continue;
          const t = target(value, url);
          if (t.kind !== "internal") continue;
          if (
            t.pathname !== "/" &&
            !t.pathname.endsWith("/") &&
            !/\.[a-z0-9]+$/i.test(t.pathname)
          ) {
            problems.push(`${url}: ${value} lacks the trailing slash of a page`);
            continue;
          }
          const target_ = fileOfUrl(t.pathname);
          if (!fileSet.has(target_)) {
            problems.push(`${url}: ${value} leads nowhere (no public/${target_})`);
            continue;
          }
          if (t.hash && target_.endsWith(".html")) {
            if (!idsOf.has(target_)) idsOf.set(target_, anchors(read(target_)));
            if (!idsOf.get(target_)!.has(t.hash))
              problems.push(`${url}: ${value} points at a missing anchor`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

/** Each language's own readme counts as one link: the Spanish pages link LEEME.md, not README.md. */
function normalise(link: string): string {
  const repo = "https://github.com/askenaz-dev/meltemi";
  if (
    [`${repo}#readme`, `${repo}/blob/main/README.md`, `${repo}/blob/main/LEEME.md`].includes(link)
  ) {
    return "<the readme of the IDE repository>";
  }
  return link;
}

describe("the twins link the same places", () => {
  it("carries the same set of external links in both languages", () => {
    const problems: string[] = [];
    for (const url of indexUrls.filter((u) => !isSpanish(u))) {
      const en = new Set(externalLinks(read(fileOfUrl(url)), url).map(normalise));
      const es = new Set(externalLinks(read(fileOfUrl(twinUrl(url))), twinUrl(url)).map(normalise));
      for (const link of en)
        if (!es.has(link)) problems.push(`${twinUrl(url)} lacks ${link}, which ${url} links`);
      for (const link of es)
        if (!en.has(link)) problems.push(`${url} lacks ${link}, which ${twinUrl(url)} links`);
    }
    expect(problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the Diagrams page", () => {
  for (const [file, url] of [
    ["diagrams/index.html", "/diagrams/"],
    ["es/diagrams/index.html", "/es/diagrams/"],
  ] as const) {
    it(`${url} opens the app and says how to install`, () => {
      const html = read(file);
      expect(externalLinks(html, url), "Open the app").toContain("https://diagrams.meltemi.dev/");
      expect(html).toContain("npm install --global @meltemi/diagrams-cli");
    });
  }

  it("names no command that does not exist", () => {
    for (const file of ["diagrams/index.html", "es/diagrams/index.html"]) {
      expect(read(file), file).not.toContain("npm install -g meltemi-diagrams");
    }
  });
});

describe("the privacy notice and the terms", () => {
  const PRIVACY: Record<string, RegExp[]> = {
    "privacy/index.html": [
      /cookie/i,
      /analytics/i,
      /\busers\b/i,
      /\bidentities\b/i,
      /\bsessions\b/i,
      /deletion events|events/i,
      /password/i,
      /provider token|access token/i,
      /seven days|7 days/i,
    ],
    "es/privacy/index.html": [
      /cookie/i,
      /anal[ií]tica/i,
      /\busuarios\b/i,
      /\bidentidades\b/i,
      /\bsesiones\b/i,
      /eventos/i,
      /contrase[ñn]a/i,
      /token del proveedor|token de acceso/i,
      /siete d[ií]as|7 d[ií]as/i,
    ],
  };

  for (const [file, patterns] of Object.entries(PRIVACY)) {
    it(`/${file.replace("index.html", "")} states the inventory of the identity service and the deletion`, () => {
      const text = read(file).replace(/<[^>]+>/g, " ");
      const missing = patterns.filter((p) => !p.test(text)).map(String);
      expect(missing, "statements the notice must make").toEqual([]);
    });
  }

  it("names what the Diagrams service holds for signed-in people", () => {
    expect(read("privacy/index.html")).toMatch(/projects/i);
    expect(read("es/privacy/index.html")).toMatch(/proyectos/i);
  });

  it("leaves no placeholder for the owner's contact address", () => {
    const offenders = ALL_HTML.filter((f) => /OWNER-(CONTACT|COUNTRY)/.test(read(f))).map(pageUrl);
    expect(
      offenders,
      "the pages that still say OWNER-CONTACT: replace it with the contact address (task 4.2)",
    ).toEqual([]);
  });
});

describe("the tokens file", () => {
  it("names the commit of the IDE repository it was copied from", () => {
    expect(read("tokens.css")).toMatch(/commit[\s*]+[0-9a-f]{40}\b/);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the downloads page stays version-free", () => {
  const RELEASES = "https://github.com/askenaz-dev/meltemi/releases";
  const LITERALS = ["/v0.", "/v1.", "meltemi-v", "version=v"];

  for (const [file, url] of [
    ["ide/downloads/index.html", "/ide/downloads/"],
    ["es/ide/downloads/index.html", "/es/ide/downloads/"],
  ] as const) {
    it(`${url} names no version and links only the latest-release form`, () => {
      const html = read(file);
      const problems = LITERALS.filter((literal) => html.includes(literal)).map(
        (literal) => `${url} contains ${literal}`,
      );
      for (const link of externalLinks(html, url)) {
        if (link.includes("/releases/") && !link.startsWith(RELEASES)) {
          problems.push(`${url} links ${link}, which is not under ${RELEASES}`);
        }
      }
      expect(problems).toEqual([]);
    });
  }
});

describe("the IDE's pages tell its release as it is", () => {
  const BEGIN = "<!-- ide-release -->";
  const END = "<!-- /ide-release -->";

  for (const [file, url] of [
    ["ide/index.html", "/ide/"],
    ["es/ide/index.html", "/es/ide/"],
  ] as const) {
    it(`${url} carries the release block once, at rest: version-free, linking the latest release`, () => {
      const html = read(file);
      expect(html.split(BEGIN).length - 1, `${url}: ${BEGIN}`).toBe(1);
      expect(html.split(END).length - 1, `${url}: ${END}`).toBe(1);
      expect(html.indexOf(BEGIN), `${url}: the markers are in order`).toBeLessThan(
        html.indexOf(END),
      );
      const block = html.slice(html.indexOf(BEGIN) + BEGIN.length, html.indexOf(END));
      expect(block).toContain('href="https://github.com/askenaz-dev/meltemi/releases/latest"');
      expect(block).not.toMatch(/v\d+\.\d+\.\d+/);
    });
  }
});

describe("the downloads page tells verification as it is", () => {
  for (const [file, url] of [
    ["ide/downloads/index.html", "/ide/downloads/"],
    ["es/ide/downloads/index.html", "/es/ide/downloads/"],
  ] as const) {
    it(`${url} names the two checks, pinned to the IDE's release workflow, and no maintainer's key`, () => {
      const html = read(file);
      expect(html).toContain("sha256sum --check");
      expect(html).toContain("gh attestation verify");
      expect(html).toContain("--signer-workflow askenaz-dev/meltemi/.github/workflows/release.yml");
      const lower = html.toLowerCase();
      for (const stale of ["minisign", "maintainer's key", "clave del mantenedor"]) {
        expect(lower, `${url} still names ${stale}`).not.toContain(stale);
      }
    });
  }
});

describe("the agents pages point to the guide for a model of your own, honestly", () => {
  const GUIDE = "https://github.com/askenaz-dev/meltemi/blob/main/docs/local-models.md";
  const SECTION = '<section aria-labelledby="model"';
  // The IDE's old lint refused the first eleven in its copy. The guide itself names the last three:
  // it may, as interoperability data, and a section that links it may not.
  const THIRD_PARTY = [
    "Claude",
    "Codex",
    "Copilot",
    "Gemini",
    "Cursor",
    "OpenAI",
    "Anthropic",
    "VS Code",
    "JetBrains",
    "Aider",
    "OpenCode",
    "Ollama",
    "LiteLLM",
    "OpenRouter",
  ];

  /** Whether `text` names `name` as a whole word, ignoring case. */
  function names(text: string, name: string): boolean {
    const lower = text.toLowerCase();
    const needle = name.toLowerCase();
    const edge = (c: string | undefined): boolean => c === undefined || !/[a-z0-9]/i.test(c);
    for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + 1)) {
      if (edge(lower[at - 1]) && edge(lower[at + needle.length])) return true;
    }
    return false;
  }

  for (const [file, url, notYet] of [
    ["ide/agents/index.html", "/ide/agents/", "has no engine of its own yet"],
    ["es/ide/agents/index.html", "/es/ide/agents/", "todavía no tiene motor propio"],
  ] as const) {
    it(`${url} has the section once, links the guide, says the engine is not there yet and names no vendor`, () => {
      const html = read(file);
      expect(html.split(SECTION).length - 1, `${url}: ${SECTION}`).toBe(1);
      const from = html.indexOf(SECTION);
      const section = html.slice(from, html.indexOf("</section>", from));
      expect(section, `${url}: the link to the guide`).toContain(`href="${GUIDE}"`);
      const text = section.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      expect(text, `${url}: the engine of its own is not there yet`).toContain(notYet);
      for (const name of THIRD_PARTY) {
        expect(names(text, name), `${url}: the section names ${name}`).toBe(false);
      }
    });
  }
});

describe("the privacy notice states what the IDE does not do and where it keeps its data", () => {
  const SECTION = '<section aria-labelledby="ide">';
  const BS = String.fromCharCode(92);
  // The folders the IDE resolves for the project name `meltemi`, as the notice writes them.
  const FOLDERS = [
    `%APPDATA%${BS}meltemi${BS}data`,
    `%APPDATA%${BS}meltemi${BS}config`,
    "~/Library/Application Support/meltemi",
    "~/.local/share/meltemi",
    "~/.config/meltemi",
    ".meltemi",
  ];
  const MONTHS_EN =
    "january february march april may june july august september october november december";
  const MONTHS_ES =
    "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre";

  const PAGES_OF_THE_NOTICE = [
    {
      file: "privacy/index.html",
      url: "/privacy/",
      // The claim of each statement, not the whole sentence: the rest can be reworded.
      statements: [
        "has no account",
        "sends no telemetry",
        "opens no network port",
        "does not read, store or reuse the credentials",
        "stays on your computer",
      ],
      date: /Last updated: (\d{1,2}) ([a-z]+) (\d{4})/i,
      months: MONTHS_EN.split(" "),
    },
    {
      file: "es/privacy/index.html",
      url: "/es/privacy/",
      statements: [
        "no tiene cuenta",
        "no envía telemetría",
        "no abre ningún puerto de red",
        "no lee, no guarda ni reutiliza las credenciales",
        "se queda en tu equipo",
      ],
      date: /Última actualización: (\d{1,2}) de ([a-z]+) de (\d{4})/i,
      months: MONTHS_ES.split(" "),
    },
  ];

  /** The text of the IDE section of `html`, tags dropped and spaces collapsed. */
  function ideSection(html: string, url: string): string {
    expect(html.split(SECTION).length - 1, `${url}: ${SECTION}`).toBe(1);
    const from = html.indexOf(SECTION);
    return html
      .slice(from, html.indexOf("</section>", from))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
  }

  for (const page of PAGES_OF_THE_NOTICE) {
    it(`${page.url} makes the five statements about the IDE and names its folders`, () => {
      const text = ideSection(read(page.file), page.url);
      const lower = text.toLowerCase();
      for (const statement of page.statements) {
        expect(lower, `${page.url}: the statement "${statement}"`).toContain(statement);
      }
      for (const folder of FOLDERS) {
        expect(text, `${page.url}: the folder ${folder}`).toContain(folder);
      }
    });
  }

  it("carries the same date of the last update in both languages", () => {
    const dates = PAGES_OF_THE_NOTICE.map((page) => {
      const found = read(page.file).match(page.date);
      expect(found, `${page.url}: the "last updated" date`).not.toBeNull();
      const [, day, month, year] = found as RegExpMatchArray;
      const n = page.months.indexOf((month as string).toLowerCase()) + 1;
      expect(n, `${page.url}: the month "${month}"`).toBeGreaterThan(0);
      return `${year}-${String(n).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    });
    expect(dates[1], `/privacy/ says ${dates[0]}, /es/privacy/ says ${dates[1]}`).toBe(dates[0]);
  });
});

describe("the figures are real captures, declared as such", () => {
  const FIGURE = /<figure\b[\s\S]*?<\/figure>/g;
  // What a caption must state, in its own language: the surface, the temporary fixture, the
  // simulated agent, the state of the product and the platform. The rest can be reworded.
  const CAPTION: Record<"en" | "es", [string, RegExp][]> = {
    en: [
      ["the surface", /\b(terminal|desktop) surface\b/i],
      ["the temporary fixture", /\btemporary fixture\b/i],
      ["the simulated agent", /\bsimulated agent\b/i],
      ["the state of the product", /\bMeltemi (pre-1\.0|v?\d+\.\d+(\.\d+)?)/i],
      ["the platform", /\b(Windows|macOS|Linux)\b/],
    ],
    es: [
      ["the surface", /\bsuperficie de (terminal|escritorio)\b/i],
      ["the temporary fixture", /\bfixture temporal\b/i],
      ["the simulated agent", /\bagente simulado\b/i],
      ["the state of the product", /\bMeltemi (previo a 1\.0|v?\d+\.\d+(\.\d+)?)/i],
      ["the platform", /\b(Windows|macOS|Linux)\b/],
    ],
  };

  const withoutComments = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, "");
  const figuresOf = (file: string): string[] =>
    [...withoutComments(read(file)).matchAll(FIGURE)].map((m) => m[0]);
  const imageOf = (figure: string): string =>
    tags(figure).find((t) => t.name === "img")?.attrs["src"] ?? "";

  it("gives every figure an alt text, a file that exists and a caption with its provenance", () => {
    const offenders: string[] = [];
    for (const file of ALL_HTML) {
      const url = pageUrl(file);
      const patterns = CAPTION[isSpanish(url) ? "es" : "en"];
      for (const [i, figure] of figuresOf(file).entries()) {
        const where = `${url} figure ${i + 1}`;
        const img = tags(figure).find((t) => t.name === "img");
        if (!img) {
          offenders.push(`${where}: no <img>`);
          continue;
        }
        if ((img.attrs["alt"] ?? "").trim().length < 40) {
          offenders.push(`${where}: alt text shorter than 40 characters`);
        }
        const src = img.attrs["src"] ?? "";
        if (!src.startsWith("/") || !fileSet.has(src.slice(1))) {
          offenders.push(`${where}: ${src || "no src"} is not a file of the site`);
        }
        const caption = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/.exec(figure);
        if (!caption) {
          offenders.push(`${where}: no <figcaption>`);
          continue;
        }
        const text = caption[1]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
        for (const [what, pattern] of patterns) {
          if (!pattern.test(text)) offenders.push(`${where}: the caption does not state ${what}`);
        }
      }
    }
    expect(offenders, "figures that break the rule").toEqual([]);
  });

  it("keeps a picture that says something inside a figure", () => {
    const offenders = ALL_HTML.flatMap((file) =>
      tags(withoutComments(read(file)).replace(FIGURE, ""))
        .filter((t) => t.name === "img" && (t.attrs["alt"] ?? "") !== "")
        .map((t) => `${pageUrl(file)}: ${t.attrs["src"] ?? "no src"}`),
    );
    expect(
      offenders,
      'images with an alt text outside a figure (a decorative one has alt="")',
    ).toEqual([]);
  });

  it("shows the same figures in both languages", () => {
    const offenders: string[] = [];
    for (const file of ALL_HTML) {
      const twin = `es/${file}`;
      if (file.startsWith("es/") || !fileSet.has(twin)) continue;
      const english = figuresOf(file).map(imageOf);
      const spanish = figuresOf(twin).map(imageOf);
      if (english.join(",") !== spanish.join(",")) {
        offenders.push(
          `${pageUrl(file)} shows [${english}] and ${pageUrl(twin)} shows [${spanish}]`,
        );
      }
    }
    expect(offenders, "pages whose twins show other figures").toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

/** The rules of a stylesheet as `selector -> declarations`, comments and keyframes removed. */
export function cssRules(css: string): { selector: string; body: string }[] {
  const clean = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1]!.trim().replace(/\s+/g, " "),
    body: m[2]!,
  }));
}

const LITERAL_COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i;

/** The sea's and the hero's rules that name a colour that is not a token. */
export function literalColours(css: string): string[] {
  return cssRules(css)
    .filter(({ selector }) => /sea|hero/.test(selector))
    .filter(({ body }) => LITERAL_COLOUR.test(body))
    .map(({ selector }) => selector);
}

/** The rules that hide a section without the script's marker, `html.motion`. */
export function hiddenOutsideMotion(css: string): string[] {
  return cssRules(css)
    .filter(({ body }) => /opacity:\s*0\b|visibility:\s*hidden|display:\s*none/.test(body))
    .flatMap(({ selector }) => selector.split(",").map((s) => s.trim()))
    .filter((s) => s.includes("[data-reveal]") && !s.startsWith("html.motion "));
}

describe("the sea's styles", () => {
  it("colour the hero and the sea with tokens only", () => {
    expect(literalColours(read("site.css"))).toEqual([]);
  });

  it("name the rule that colours the sea with a literal", () => {
    expect(literalColours(".sea-pause { color: #ffffff; }\n.card { color: #000; }")).toEqual([
      ".sea-pause",
    ]);
  });

  it("define the four --sea-* properties from tokens, in both schemes", () => {
    const rules = cssRules(read("site.css")).filter(({ selector }) => selector === ":root");
    const declared = rules.map(({ body }) => body).join("\n");
    for (const name of ["--sea-point", "--sea-crest", "--sea-wind", "--sea-bg"]) {
      expect(declared, name).toMatch(new RegExp(`${name}:\\s*var\\(--[a-z-]+\\)`));
    }
  });

  it("hide a section only after the script marked the document", () => {
    expect(hiddenOutsideMotion(read("site.css"))).toEqual([]);
  });

  it("name a rule that hides a section without the marker", () => {
    expect(hiddenOutsideMotion("[data-reveal] { opacity: 0; }")).toEqual(["[data-reveal]"]);
  });
});

// ---------------------------------------------------------------------------------------------

/** The pages whose hero moves, and the state each one draws; every other page is still. */
const ANIMATED: Readonly<Record<string, SeaState>> = {
  "/": "home",
  "/ide/": "ide",
  "/ide/method/": "ide",
  "/ide/agents/": "ide",
  "/ide/downloads/": "ide",
  "/diagrams/": "diagrams",
};

const PAUSE_LABELS = {
  en: { pause: "Pause animation", play: "Play animation" },
  es: { pause: "Pausar animación", play: "Reanudar animación" },
};

/** The state a page declares on its `<body>`, or undefined. */
export function seaState(html: string): string | undefined {
  return tags(html).find((t) => t.name === "body")?.attrs["data-sea"];
}

/** The markup of a page's hero: from its opening to the first `</div>` at its indentation. */
function heroOf(html: string): string {
  const open = html.search(/<div class="hero[ "]/);
  if (open < 0) return "";
  const indent = html.slice(html.lastIndexOf("\n", open) + 1, open);
  const close = html.indexOf(`\n${indent}</div>`, open);
  return html.slice(open, close < 0 ? undefined : close);
}

/** What a page's hero lacks for the state it declares, in words that say what to fix. */
export function heroProblems(html: string, url: string): string[] {
  const state = seaState(html);
  if (state === undefined) return ["no data-sea on <body>"];
  if (!(STATES as readonly string[]).includes(state)) {
    return [`data-sea="${state}" is not one of ${STATES.join(", ")}`];
  }
  const expected = ANIMATED[isSpanish(url) ? twinUrl(url) : url] ?? "still";
  const problems: string[] = [];
  if (state !== expected) problems.push(`data-sea="${state}" where the page draws "${expected}"`);
  const hero = tags(heroOf(html));
  const has = (name: string, attr: string, value: string) =>
    hero.some((t) => t.name === name && t.attrs[attr] === value);
  if (!hero.length) return [...problems, "no hero"];
  if (!has("img", "src", `/assets/sea-${state}-light.svg`)) {
    problems.push(`no still picture /assets/sea-${state}-light.svg`);
  }
  if (!has("source", "srcset", `/assets/sea-${state}-dark.svg`)) {
    problems.push(`no still picture /assets/sea-${state}-dark.svg`);
  }
  const page = tags(html);
  const script = page.some((t) => t.name === "script" && t.attrs["src"] === "/assets/site.js");
  const windCanvas = page.some((t) => t.name === "canvas" && t.attrs["class"] === "wind");
  if (state === "still") {
    if (has("canvas", "class", "sea-canvas")) problems.push("a canvas on a still page");
    if (windCanvas) problems.push("a wind canvas on a still page");
    if (script) problems.push("a script on a still page");
    return problems;
  }
  if (!has("canvas", "class", "sea-canvas")) problems.push("no hero canvas");
  if (!windCanvas) problems.push("no wind canvas");
  if (!has("div", "class", "sea-mark")) problems.push("no mark");
  const boats = hero.filter((t) => t.name === "div" && t.attrs["class"] === "sea-boat").length;
  if (boats !== fleetSize(state as SeaState) - 1) {
    problems.push(`${boats} boats for a fleet of ${fleetSize(state as SeaState)}`);
  }
  const uses = (id: string) =>
    hero.filter((t) => t.name === "use" && t.attrs["href"] === `#${id}`).length;
  if (uses("sea-mark-m") !== boats || uses("sea-mark-hull") !== boats) {
    problems.push("a boat that is not a use of the lead mark's paths");
  }
  if (!has("button", "class", "sea-pause")) problems.push("no pause button");
  if (!script) problems.push("no /assets/site.js");
  return problems;
}

/** A mark's drawing: its paths' data, its gradient's stops, and any filter it carries. */
function markOf(svg: string): { paths: string[]; stops: string[]; filters: number } {
  const found = tags(svg);
  return {
    paths: found.filter((t) => t.name === "path").map((t) => t.attrs["d"] ?? ""),
    stops: found
      .filter((t) => t.name === "stop")
      .map((t) => `${t.attrs["offset"]} ${(t.attrs["stop-color"] ?? "").toLowerCase()}`),
    filters: found.filter((t) => t.name === "filter" || "filter" in t.attrs).length,
  };
}

/** How a page's mark differs from the brand file's: paths, stops or a filter. */
export function markDifferences(html: string, brand: string): string[] {
  const hero = heroOf(html);
  const at = hero.indexOf(`<div class="sea-mark">`);
  if (at < 0) return [];
  const mine = markOf(hero.slice(at, hero.indexOf("</svg>", at)));
  const theirs = markOf(brand);
  const differences: string[] = [];
  if (mine.paths.join("|") !== theirs.paths.join("|")) differences.push("its paths");
  if (mine.stops.join("|") !== theirs.stops.join("|")) differences.push("its gradient stops");
  if (mine.filters) differences.push("a filter");
  return differences;
}

/** The pause button's accessible name and glyph against the page's language. */
export function labelProblems(html: string, url: string): string[] {
  const button = tags(heroOf(html)).find((t) => t.name === "button");
  if (!button) return [];
  const want = PAUSE_LABELS[isSpanish(url) ? "es" : "en"];
  const inside = /<button[^>]*>([\s\S]*?)<\/button>/.exec(heroOf(html))?.[1] ?? "";
  const words = inside.replace(/<svg[\s\S]*?<\/svg>/, "").trim();
  const problems: string[] = [];
  if (button.attrs["aria-label"] !== want.pause) problems.push("its label");
  if (button.attrs["title"] !== want.pause) problems.push("its title");
  if (button.attrs["data-label-pause"] !== want.pause) problems.push("its pause label");
  if (button.attrs["data-label-play"] !== want.play) problems.push("its play label");
  if (words !== "") problems.push(`words inside: ${JSON.stringify(words)}`);
  if (!/<svg[^>]*aria-hidden="true"[^>]*>[\s\S]*<path[^>]*class="sea-pause-glyph"/.test(inside)) {
    problems.push("no glyph");
  }
  if (button.attrs["aria-pressed"] !== "false") problems.push("aria-pressed");
  if (button.attrs["type"] !== "button") problems.push("its type");
  return problems;
}

/** Whether a text is one SVG element whose tags all close, with nothing after it. */
export function wellFormedSvg(text: string): boolean {
  const body = text.trim().replace(/<\?xml[^>]*\?>\s*/, "");
  if (!body.startsWith("<svg")) return false;
  const open: string[] = [];
  let rest = body;
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w:-]*)(?:\s[^<>]*?)?(\/?)>|[<>]/g)) {
    if (m[0] === "<" || m[0] === ">") return false;
    if (m[3]) {
      if (!open.length) return false;
    } else if (m[1]) {
      if (open.pop() !== m[2]) return false;
    } else {
      open.push(m[2]!);
    }
    rest = body.slice(m.index + m[0].length);
    if (!open.length) break;
  }
  return open.length === 0 && rest.trim() === "";
}

describe("a sea in every hero", () => {
  const brand = read("media/meltemi-mark-gradient.svg");
  const heroPages = PAGES.concat("404.html");

  it("puts the hero every page's state asks for", () => {
    const offenders = heroPages.flatMap((file) =>
      heroProblems(read(file), pageUrl(file)).map((p) => `${pageUrl(file)}: ${p}`),
    );
    expect(offenders, "pages without their sea").toEqual([]);
  });

  it("gives the six product pages and their twins a moving sea", () => {
    const moving = PAGES.filter((f) => seaState(read(f)) !== "still")
      .map(pageUrl)
      .sort();
    const expected = Object.keys(ANIMATED)
      .flatMap((u) => [u, twinUrl(u)])
      .sort();
    expect(moving).toEqual(expected);
  });

  it("declares the same state on both twins", () => {
    const offenders = PAGES.filter((file) => {
      const twin = fileOfUrl(twinUrl(pageUrl(file)));
      return fileSet.has(twin) && seaState(read(file)) !== seaState(read(twin));
    }).map(pageUrl);
    expect(offenders, "pages whose twins draw another sea").toEqual([]);
  });

  it("keeps the mark the brand's: the same paths and stops, no filter", () => {
    const offenders = heroPages.flatMap((file) =>
      markDifferences(read(file), brand).map((d) => `${pageUrl(file)}: ${d}`),
    );
    expect(offenders, "marks that drift from media/meltemi-mark-gradient.svg").toEqual([]);
  });

  it("labels the pause button in the page's language", () => {
    const offenders = PAGES.flatMap((file) =>
      labelProblems(read(file), pageUrl(file)).map((p) => `${pageUrl(file)}: ${p}`),
    );
    expect(offenders, "pause buttons labelled in another language").toEqual([]);
  });

  const home = read("index.html");

  it("names the page and what is missing", () => {
    const withoutCanvas = home.replace(`<canvas class="sea-canvas"></canvas>`, "");
    expect(heroProblems(withoutCanvas, "/")).toEqual(["no hero canvas"]);
    const withoutStill = home.replace(/<img class="sea-still"[^>]*>/, "");
    expect(heroProblems(withoutStill, "/")).toEqual([
      "no still picture /assets/sea-home-light.svg",
    ]);
  });

  it("refuses a state outside the four, and a state that is not the page's", () => {
    expect(heroProblems(home.replace(`data-sea="home"`, `data-sea="storm"`), "/")).toEqual([
      `data-sea="storm" is not one of ${STATES.join(", ")}`,
    ]);
    expect(heroProblems(home.replace(`data-sea="home"`, `data-sea="ide"`), "/")[0]).toBe(
      `data-sea="ide" where the page draws "home"`,
    );
  });

  it("names a mark that drifts from the brand", () => {
    const drifted = home
      .replace(`stop-color="#22D3EE"`, `stop-color="#ff00ff"`)
      .replace(`<path id="sea-mark-hull"`, `<path filter="url(#glow)" id="sea-mark-hull"`);
    expect(markDifferences(drifted, brand)).toEqual(["its gradient stops", "a filter"]);
    expect(markDifferences(home.replace("M45 199C87", "M45 199C88"), brand)).toEqual(["its paths"]);
  });

  it("rests the mark where its state rests, so the still picture leaves it room", () => {
    const css = cssRules(read("site.css"));
    const offenders = (["home", "ide", "diagrams"] as const).flatMap((state) => {
      const { markFrom, markTo, rest } = definitionOf(state);
      const want = Math.round((markFrom + rest * (markTo - markFrom)) * 1000) / 10;
      const rule = css.find(({ selector }) => selector === `[data-sea="${state}"] .sea-mark`);
      const declared = /--mark-at:\s*([\d.]+)%/.exec(rule?.body ?? "")?.[1];
      return Number(declared) === want ? [] : [`${state}: --mark-at ${declared}% for ${want}%`];
    });
    expect(offenders, "marks resting off their state's place").toEqual([]);
  });

  it("names a button labelled in another language, or with words", () => {
    const spanish = read("es/index.html");
    expect(labelProblems(spanish, "/")).toEqual([
      "its label",
      "its title",
      "its pause label",
      "its play label",
    ]);
    const wordy = home.replace("</svg></button>", "</svg>Pause</button>");
    expect(labelProblems(wordy, "/")).toEqual(['words inside: "Pause"']);
  });

  it("names a short fleet, and a boat that is not the mark", () => {
    const short = home.replace(/<div class="sea-boat"[\s\S]*?<\/div>\n/, "");
    expect(heroProblems(short, "/")).toEqual(["2 boats for a fleet of 4"]);
    const other = home.replace('<use href="#sea-mark-hull" />', '<use href="#other" />');
    expect(heroProblems(other, "/")).toEqual(["a boat that is not a use of the lead mark's paths"]);
    expect(heroProblems(home.replace(/<canvas class="wind"[^>]*><\/canvas>\n/, ""), "/")).toEqual([
      "no wind canvas",
    ]);
  });

  it("keeps the package's mark the brand file's", () => {
    const theirs = markOf(brand);
    expect(theirs.paths).toEqual([MARK_M, MARK_HULL]);
    expect(theirs.stops).toEqual([`0 ${MARK_GRADIENT.from}`, `1 ${MARK_GRADIENT.to}`]);
  });

  it("blows the wind across the page: a fixed layer behind it, shown once the sea draws", () => {
    const rules = cssRules(read("site.css"));
    const wind = rules.find(({ selector }) => selector === ".wind");
    expect(wind?.body).toMatch(/position:\s*fixed/);
    expect(wind?.body).toMatch(/pointer-events:\s*none/);
    expect(wind?.body).toMatch(/visibility:\s*hidden/);
    expect(rules.find(({ selector }) => selector === "html.sea .wind")?.body).toMatch(
      /visibility:\s*visible/,
    );
    const above = rules.find(({ selector }) => selector === ".top, .hero, main, .foot");
    expect(above?.body).toMatch(/z-index:\s*1/);
  });
});

// What the build writes, built once into a temporary folder: the checks measure what would be
// served without a build having run first.
const built = mkdtempSync(join(tmpdir(), "meltemi-site-"));
const ready = buildSite(PUBLIC, built);
afterAll(() => rmSync(built, { recursive: true, force: true }));

describe("the still pictures the build writes", () => {
  it("writes every state's picture in both schemes, well formed", async () => {
    await ready;
    const stills = BUILT.filter((f) => f.endsWith(".svg"));
    expect(stills).toHaveLength(STATES.length * 2);
    const offenders = stills.filter((file) => {
      const text = readFileSync(join(built, file), "utf8");
      return text.length === 0 || !wellFormedSvg(text);
    });
    expect(offenders, "still pictures missing, empty or not well-formed SVG").toEqual([]);
  });

  it("colours them with the tokens of each scheme", async () => {
    await ready;
    expect(stillColours(PUBLIC, "light")).toEqual({
      point: "#2563eb",
      crest: "#22d3ee",
      wind: "#2563eb",
    });
    const dark = readFileSync(join(built, "assets/sea-home-dark.svg"), "utf8");
    const { point, crest } = stillColours(PUBLIC, "dark");
    expect(dark).toContain(`fill="${point}"`);
    expect(dark).toContain(`fill="${crest}"`);
  });

  it("tells a picture that is not well-formed SVG", () => {
    expect(wellFormedSvg(`<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>`)).toBe(
      true,
    );
    expect(wellFormedSvg("")).toBe(false);
    expect(wellFormedSvg(`<svg><g></svg>`)).toBe(false);
    expect(wellFormedSvg(`<svg></svg><svg></svg>`)).toBe(false);
    expect(wellFormedSvg(`<html></html>`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------

/** The gzipped scripts a page may load, in bytes. */
const SCRIPT_BUDGET = 45 * 1024;

/** The weight of each still picture, in bytes. */
const STILL_BUDGET = 30 * 1024;

export interface Script {
  /** Its gzipped size, in bytes. */
  readonly gzip: number;
  /** The scripts it imports, statically or dynamically, as paths in `public/`. */
  readonly imports: readonly string[];
}

/** Every built script, as a path in `public/`, with its gzipped size and what it imports. */
export function scriptsOf(metafile: Metafile, outRoot: string): Map<string, Script> {
  const inPublic = (path: string) => relative(outRoot, resolve(SITE, path)).split(sep).join("/");
  const scripts = new Map<string, Script>();
  for (const [path, output] of Object.entries(metafile.outputs)) {
    if (!path.endsWith(".js")) continue;
    scripts.set(inPublic(path), {
      gzip: gzipSync(readFileSync(resolve(SITE, path))).length,
      imports: output.imports.filter((i) => !i.external).map((i) => inPublic(i.path)),
    });
  }
  return scripts;
}

/** What a page loads: the scripts it links and every script they import, each once. */
export function loads(linked: readonly string[], scripts: Map<string, Script>): string[] {
  const seen = new Set<string>();
  const visit = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    for (const next of scripts.get(path)?.imports ?? []) visit(next);
  };
  linked.forEach(visit);
  return [...seen];
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

/** The pages whose scripts weigh more than the budget, gzipped, naming each page and its weight. */
export function budgetProblems(
  pages: readonly { url: string; scripts: readonly string[] }[],
  scripts: Map<string, Script>,
  budget = SCRIPT_BUDGET,
): string[] {
  return pages.flatMap(({ url, scripts: linked }) => {
    const total = loads(linked, scripts).reduce((sum, p) => sum + (scripts.get(p)?.gzip ?? 0), 0);
    return total > budget ? [`${url}: ${kb(total)} gzipped, over ${kb(budget)}`] : [];
  });
}

/** The scripts a page links, as paths in `public/`. */
const linkedScripts = (html: string) =>
  tags(html)
    .filter((t) => t.name === "script" && t.attrs["src"])
    .map((t) => t.attrs["src"]!.replace(/^\//, ""));

describe("the weight a page loads", () => {
  it("keeps every page's scripts within 45 KB gzipped, chunks included", async () => {
    const { metafile } = await ready;
    const scripts = scriptsOf(metafile, built);
    expect([...scripts.keys()], "the entry the pages link").toContain("assets/site.js");
    const pages = PAGES.concat("404.html").map((file) => ({
      url: pageUrl(file),
      scripts: linkedScripts(read(file)),
    }));
    for (const { url, scripts: linked } of pages) {
      for (const path of linked) expect(scripts.has(path), `${url} links ${path}`).toBe(true);
    }
    expect(budgetProblems(pages, scripts), "pages over their budget").toEqual([]);
    // The entry imports the sea, so a page that loads one loads both.
    expect(loads(["assets/site.js"], scripts).length).toBeGreaterThan(1);
  });

  it("keeps every still picture within 30 KB", async () => {
    await ready;
    const offenders = BUILT.filter((f) => f.endsWith(".svg"))
      .map((file) => [file, statSync(join(built, file)).size] as const)
      .filter(([, bytes]) => bytes > STILL_BUDGET)
      .map(([file, bytes]) => `${file}: ${kb(bytes)}, over ${kb(STILL_BUDGET)}`);
    expect(offenders, "still pictures over their budget").toEqual([]);
  });

  it("names the page and its weight when the scripts are too heavy", () => {
    const scripts = new Map<string, Script>([
      ["assets/site.js", { gzip: 30_000, imports: ["assets/chunk-SEA.js"] }],
      ["assets/chunk-SEA.js", { gzip: 20_000, imports: ["assets/site.js"] }],
    ]);
    expect(
      budgetProblems(
        [
          { url: "/", scripts: ["assets/site.js"] },
          { url: "/privacy/", scripts: [] },
        ],
        scripts,
      ),
    ).toEqual(["/: 48.8 KB gzipped, over 45.0 KB"]);
  });
});

// ---------------------------------------------------------------------------------------------

/** The rows of a page's table inside a section: each row's cells as text, glyphs and tags off. */
export function rowsOf(html: string, sectionId: string): string[][] {
  const start = html.indexOf(`aria-labelledby="${sectionId}"`);
  const section = html.slice(start, html.indexOf("</section>", start));
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(section)?.[1] ?? "";
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((row) =>
    [...row[1]!.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((cell) =>
      cell[1]!
        .replace(/<[^>]+>/g, "")
        .replace(/[●◔○]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    ),
  );
}

/**
 * The state of every part, as verified on 2026-10-28: the identity service answers
 * https://id.meltemi.dev/login with GitHub and Google and its GitHub start redirects to
 * github.com with the production callback; https://diagrams.meltemi.dev/api/session answers
 * with the sign-in address, and the Diagrams repository has archived cloud-accounts,
 * cloud-projects, sharing-and-permissions, live-collaboration, live-sessions, cli-cloud and
 * account-panel (2026-10-15 to 23); the IDE's plan still has the signing of MSI and DMG pending.
 * The next verification updates this table and the pages together.
 */
const STATE_AS_IT_IS = {
  "index.html": [
    ["Daemon, terminal client, spec engine", "Published"],
    ["Desktop client", "In development"],
    ["Language, command line, VS Code extension, app in the browser", "Built"],
    ["Account, projects kept between devices, sharing, live collaboration", "Live"],
    ["Sign-in with GitHub or Google", "Live"],
  ],
  "es/index.html": [
    ["Daemon, cliente de terminal, motor de specs", "Publicado"],
    ["Cliente de escritorio", "En desarrollo"],
    ["Lenguaje, línea de comandos, extensión de VS Code, aplicación en el navegador", "Construido"],
    [
      "Cuenta, proyectos guardados entre dispositivos, uso compartido, colaboración en vivo",
      "En producción",
    ],
    ["Inicio de sesión con GitHub o Google", "En producción"],
  ],
  "diagrams/index.html": [
    ["Draw, edit, import and export in the app", "Available"],
    ["Projects kept between devices, with versions", "Available"],
    ["Sharing by link and with named people", "Available"],
    ["Editing together", "Available"],
    ["Publishing a catalog", "Available"],
    ["Push and pull from the command line", "Available"],
  ],
  "es/diagrams/index.html": [
    ["Dibujar, editar, importar y exportar en la app", "Disponible"],
    ["Proyectos guardados entre dispositivos, con versiones", "Disponible"],
    ["Compartir por enlace y con personas concretas", "Disponible"],
    ["Edición en conjunto", "Disponible"],
    ["Publicar un catálogo", "Disponible"],
    ["Push y pull desde la línea de comandos", "Disponible"],
  ],
} as const;

describe("the family's state, as the products ship it", () => {
  for (const [file, rows] of Object.entries(STATE_AS_IT_IS)) {
    const section = file.includes("diagrams") ? "account" : "state";
    it(`${pageUrl(file)} says what is live, row by row`, () => {
      const found = rowsOf(read(file), section).map((cells) =>
        section === "state" ? [cells[1], cells[2]] : [cells[0], cells[1]],
      );
      expect(found).toEqual(rows.map((row) => [...row]));
    });
  }

  it("says nothing is specified but not built", () => {
    for (const file of Object.keys(STATE_AS_IT_IS)) {
      const html = read(file);
      expect(html, file).not.toMatch(
        /Not yet|Todavía no|not built|no construido|not released|sin publicar/,
      );
    }
  });

  it("names the row that contradicts the record", () => {
    const stale = read("index.html").replace(
      /(Sign-in with GitHub or Google<\/td>\s*<td>\s*<span class="state )ok("><span class="sym" aria-hidden="true">)●(<\/span> )Live/,
      "$1pending$2◔$3In development",
    );
    const rows = rowsOf(stale, "state");
    expect(rows[4]).toEqual([
      "The family",
      "Sign-in with GitHub or Google",
      "In development",
      "One account for the online services, at id.meltemi.dev. Meltemi IDE does not use it.",
    ]);
  });
});
