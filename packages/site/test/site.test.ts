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
