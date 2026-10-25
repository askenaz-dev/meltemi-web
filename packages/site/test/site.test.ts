// The checks of the specification `product-site`. Each one reads the files of `public/` and
// reports every offender by page and address, so a failure says what to fix. No network.

import { describe, expect, it } from "vitest";
import {
  ALL_HTML,
  FILES,
  PAGES,
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

describe("static assets with no script and no external resource", () => {
  it("contains no script, event handler, form, inline style or javascript: address", () => {
    const problems: string[] = [];
    for (const file of ALL_HTML) {
      const url = pageUrl(file);
      const html = read(file).replace(/<!--[\s\S]*?-->/g, "");
      if (/<script/i.test(html)) problems.push(`${url}: a <script> element`);
      if (/<style/i.test(html)) problems.push(`${url}: a <style> element`);
      for (const tag of tags(html)) {
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
    }
    expect(problems).toEqual([]);
  });

  it("loads nothing from another origin: no stylesheet, image, font or media", () => {
    const problems: string[] = [];
    for (const file of ALL_HTML) {
      const url = pageUrl(file);
      for (const tag of tags(read(file))) {
        const fetches =
          (tag.name === "link" && tag.attrs["rel"] !== "alternate") ||
          ["img", "source", "video", "audio", "embed", "object", "track", "input"].includes(
            tag.name,
          );
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
        "default-src 'none'; img-src 'self'; style-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "strict-transport-security": "max-age=31536000",
    });
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
  const SECTION = '<section aria-labelledby="model">';
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
