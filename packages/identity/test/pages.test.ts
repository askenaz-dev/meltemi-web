import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";
import type { Ctx } from "../src/context.js";
import { en } from "../src/messages/en.js";
import { es } from "../src/messages/es.js";
import { messages, resolveLang } from "../src/messages/index.js";
import { errorPage, esc, legalLinks, policy, renderPage } from "../src/pages/layout.js";
import type { Lang } from "../src/types.js";
import { harness, signedInPerson, testEnv, textOf, type Harness } from "./support/index.js";
import { DEV_ENV, hrefsOf, langOf } from "./support/signin.js";

const PRODUCTION_POLICY =
  "default-src 'none'; style-src 'self'; " +
  "img-src 'self' https://avatars.githubusercontent.com https://*.googleusercontent.com; " +
  "form-action 'self' https://meltemi.dev https://*.meltemi.dev; " +
  "base-uri 'none'; frame-ancestors 'none'";

/** A request context for the page functions, built the way the handler builds it. */
function contextOf(h: Harness, lang: Lang = "en"): Ctx {
  const request = new Request(`${h.env.ISSUER}/login`);
  return {
    request,
    url: new URL(request.url),
    env: h.env,
    deps: h.deps,
    config: readConfig(h.env),
    lang,
    params: {},
  };
}

describe("esc", () => {
  it("escapes every character that can start markup or leave an attribute", () => {
    expect(esc("<b>x</b>")).toBe("&lt;b&gt;x&lt;/b&gt;");
    expect(esc(`"quoted" and 'single'`)).toBe("&quot;quoted&quot; and &#39;single&#39;");
    expect(esc("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });

  it("escapes the ampersand first, so an entity in the text stays visible text", () => {
    expect(esc("&lt;")).toBe("&amp;lt;");
  });

  it("keeps a value from leaving its attribute", () => {
    const hostile = `" onmouseover="alert(1)`;
    const html = `<a href="${esc(hostile)}">x</a>`;
    expect(html).toBe(`<a href="&quot; onmouseover=&quot;alert(1)">x</a>`);
    expect(html.match(/"/g)).toHaveLength(2);
  });

  it("turns other values into their text", () => {
    expect(esc(42)).toBe("42");
    expect(esc("")).toBe("");
  });
});

describe("the language of a page", () => {
  const lang = (query: string, acceptLanguage: string | null) =>
    resolveLang(new URL(`https://id.meltemi.dev/login${query}`), acceptLanguage);

  it("is English without any hint", () => {
    expect(lang("", null)).toBe("en");
    expect(lang("", "")).toBe("en");
  });

  it("follows ?lang before the Accept-Language header", () => {
    expect(lang("?lang=es", "en-US,en;q=0.9")).toBe("es");
    expect(lang("?lang=en", "es-CL,es;q=0.9")).toBe("en");
  });

  it("takes Spanish from Accept-Language, regional variants included", () => {
    expect(lang("", "es-CL,es;q=0.9,en;q=0.8")).toBe("es");
    expect(lang("", "es")).toBe("es");
    expect(lang("", "ES-mx")).toBe("es");
    expect(lang("", "en-GB")).toBe("en");
  });

  it("honours q-values: the best of English and Spanish wins, not the first listed", () => {
    expect(lang("", "en;q=0.5,es;q=0.9")).toBe("es");
    expect(lang("", "es;q=0.2, en;q=0.8")).toBe("en");
    expect(lang("", "fr,es;q=0.1,en;q=0.05")).toBe("es");
  });

  it("prefers the first on a tie", () => {
    expect(lang("", "es,en")).toBe("es");
    expect(lang("", "en,es")).toBe("en");
  });

  it("ignores a language the person refuses (q=0)", () => {
    expect(lang("", "es;q=0,en;q=0.1")).toBe("en");
    expect(lang("", "es;q=0")).toBe("en");
  });

  it("falls back to English for languages the service does not speak", () => {
    expect(lang("?lang=fr", null)).toBe("en");
    expect(lang("", "fr-FR,de;q=0.8")).toBe("en");
    expect(lang("", "*")).toBe("en");
    expect(lang("?lang=", null)).toBe("en");
  });

  it("falls through an unsupported ?lang to the header, and treats a spelled-out ?lang strictly", () => {
    expect(lang("?lang=fr", "es")).toBe("es");
    expect(lang("?lang=ES", null)).toBe("en");
  });
});

describe("the policy", () => {
  it("is exactly the family's in production", () => {
    expect(policy(readConfig(testEnv()))).toBe(PRODUCTION_POLICY);
  });

  it("lists the development origins in form-action only in development mode", () => {
    const origins = "http://localhost:8788 http://localhost:8789";
    expect(policy(readConfig(testEnv(DEV_ENV)))).toContain(
      `form-action 'self' https://meltemi.dev https://*.meltemi.dev ${origins};`,
    );
    for (const env of [{}, { DEV: "false" }, { DEV: "1" }, { DEV: "TRUE" }]) {
      const production = policy(
        readConfig(testEnv({ DEV_ORIGINS: "http://localhost:8788,http://localhost:8789", ...env })),
      );
      expect(production).toBe(PRODUCTION_POLICY);
    }
  });

  it("follows the cookie domain of the configuration", () => {
    const config = readConfig(testEnv({ COOKIE_DOMAIN: "example.test" }));
    expect(policy(config)).toContain(
      "form-action 'self' https://example.test https://*.example.test;",
    );
  });
});

describe("the legal links", () => {
  it("point at the site, in the language of the page", () => {
    const config = readConfig(testEnv());
    expect(legalLinks(config, "en")).toEqual({
      privacy: "https://meltemi.dev/privacy/",
      terms: "https://meltemi.dev/terms/",
    });
    expect(legalLinks(config, "es")).toEqual({
      privacy: "https://meltemi.dev/es/privacy/",
      terms: "https://meltemi.dev/es/terms/",
    });
  });

  it("do not double the slash of a SITE_URL that ends with one", () => {
    const config = readConfig(testEnv({ SITE_URL: "https://meltemi.dev/" }));
    expect(legalLinks(config, "en").privacy).toBe("https://meltemi.dev/privacy/");
    expect(legalLinks(config, "es").terms).toBe("https://meltemi.dev/es/terms/");
  });

  it("follow a development SITE_URL", () => {
    const config = readConfig(testEnv(DEV_ENV));
    expect(legalLinks(config, "en").privacy).toBe("http://localhost:8789/privacy/");
  });
});

describe("a page", () => {
  it("carries the policy headers and no cache header unless it shows personal data", async () => {
    const h = await harness();
    const response = renderPage(contextOf(h), { title: "T", body: "<p>x</p>" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Content-Security-Policy")).toBe(PRODUCTION_POLICY);
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBeNull();
  });

  it("is never cached when it shows personal data", async () => {
    const h = await harness();
    const response = renderPage(contextOf(h), { title: "T", body: "<p>x</p>", personal: true });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("escapes its title and declares its language", async () => {
    const h = await harness();
    const html = await textOf(
      renderPage(contextOf(h, "es"), { title: `<script>alert(1)</script>`, body: "" }),
    );
    expect(html).toContain("<title>&lt;script&gt;alert(1)&lt;/script&gt; · Meltemi</title>");
    expect(html).not.toContain("<script>");
    expect(langOf(html)).toBe("es");
  });

  it("links the stylesheet from the same origin and uses no inline style, script or form of its own", async () => {
    const h = await harness();
    const html = await textOf(renderPage(contextOf(h), { title: "T", body: "" }));
    expect(html).toContain('<link rel="stylesheet" href="/identity.css">');
    expect(html).not.toMatch(/<script|<style|style=|<form/i);
  });

  it("an error page escapes its code, words and links, and shows the code", async () => {
    const h = await harness();
    const html = await textOf(
      errorPage(contextOf(h), {
        code: "<code>",
        status: 400,
        title: "<h1>t</h1>",
        message: `"><img src=x>`,
        actions: [{ href: `/x?a=1&b="2"`, label: "<b>go</b>", primary: true }],
      }),
    );
    expect(html).toContain("&lt;code&gt;");
    expect(html).toContain("&lt;h1&gt;t&lt;/h1&gt;");
    expect(html).toContain("&quot;&gt;&lt;img src=x&gt;");
    expect(html).toContain('href="/x?a=1&amp;b=&quot;2&quot;"');
    expect(html).toContain("&lt;b&gt;go&lt;/b&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>go");
  });

  it("looks its words up per request, so one language never leaks into the next", async () => {
    const h = await harness();
    const spanish = await textOf(await h.request("/login?lang=es"));
    const english = await textOf(await h.request("/login?lang=en"));
    const spanishAgain = await textOf(await h.request("/login?lang=es"));
    expect(langOf(spanish)).toBe("es");
    expect(langOf(english)).toBe("en");
    expect(english).toContain(en.signin.chooserTitle);
    expect(english).not.toContain(es.signin.chooserTitle);
    expect(spanishAgain).toBe(spanish);
  });
});

describe("the headers of every kind of page", () => {
  const pages: [string, string, number][] = [
    ["the chooser", "/login", 200],
    ["the chooser with a return address", "/login?return_to=https://diagrams.meltemi.dev/", 200],
    ["a refused return address", "/login?return_to=https://evil.example/", 400],
    ["an unknown provider", "/login?provider=facebook", 400],
    ["a callback without its cookie", "/callback/github?code=x&state=y", 400],
    ["a callback the provider refused", "/callback/google?error=access_denied", 400],
    ["the sign-out confirmation", "/logout", 200],
    [
      "the sign-out confirmation with a return address",
      "/logout?return_to=https://meltemi.dev/",
      200,
    ],
    ["an unknown route", "/nothing-here", 404],
  ];

  it.each(pages)("%s: the policy, Referrer-Policy and nosniff", async (_name, path, status) => {
    const h = await harness();
    const response = await h.request(path);
    expect(response.status).toBe(status);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Content-Security-Policy")).toBe(PRODUCTION_POLICY);
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it.each(pages)(
    "%s: development origins reach form-action only in development",
    async (_n, path) => {
      const production = await harness({
        env: { DEV_ORIGINS: "http://localhost:8788,http://localhost:8789" },
      });
      const prodPolicy = (await production.request(path)).headers.get("Content-Security-Policy")!;
      expect(prodPolicy).not.toContain("localhost");

      const dev = await harness({ env: { ...DEV_ENV, ISSUER: "https://id.meltemi.dev" } });
      const devPolicy = (await dev.request(path)).headers.get("Content-Security-Policy")!;
      expect(devPolicy).toContain(
        "form-action 'self' https://meltemi.dev https://*.meltemi.dev http://localhost:8788 http://localhost:8789;",
      );
    },
  );

  it("the chooser is not personal and is not marked no-store", async () => {
    const h = await harness();
    expect((await h.request("/login")).headers.get("Cache-Control")).toBeNull();
  });
});

/** The directive of a policy, as written. */
function directive(policyText: string, name: string): string | undefined {
  return policyText.split("; ").find((part) => part.startsWith(`${name} `));
}

describe("pages that hold forms", () => {
  const FAMILY_FORM_ACTION = "form-action 'self' https://meltemi.dev https://*.meltemi.dev";

  it("the account page of a signed-in person: same-origin referrer, the family in form-action, never cached", async () => {
    const h = await harness();
    const person = await signedInPerson(h);
    const response = await h.request("/account", { headers: { Cookie: person.cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(directive(response.headers.get("Content-Security-Policy")!, "form-action")).toBe(
      FAMILY_FORM_ACTION,
    );
    expect(response.headers.get("Content-Security-Policy")).toBe(PRODUCTION_POLICY);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("the sign-out confirmation lists the development origins in form-action only in development mode", async () => {
    const dev = await harness({
      env: {
        DEV: "true",
        DEV_ORIGINS: "http://localhost:8788,http://localhost:8789",
        PRODUCTS: '[{"name":"diagrams","events":"http://localhost:8788/_identity/events"}]',
      },
    });
    expect(
      directive(
        (await dev.request("/logout")).headers.get("Content-Security-Policy")!,
        "form-action",
      ),
    ).toBe(`${FAMILY_FORM_ACTION} http://localhost:8788 http://localhost:8789`);

    const production = await harness({
      env: { DEV_ORIGINS: "http://localhost:8788,http://localhost:8789" },
    });
    expect(
      directive(
        (await production.request("/logout")).headers.get("Content-Security-Policy")!,
        "form-action",
      ),
    ).toBe(FAMILY_FORM_ACTION);
  });

  it("a name is text, never markup: the account page escapes it and keeps the policy headers", async () => {
    const h = await harness();
    const person = await signedInPerson(h, { name: "<b>x</b>" });
    const response = await h.request("/account", { headers: { Cookie: person.cookie } });
    expect(response.status).toBe(200);
    const html = await textOf(response);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
    expect(response.headers.get("Content-Security-Policy")).toBe(PRODUCTION_POLICY);
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
  });
});

describe("the chooser in both languages", () => {
  it("is in English by default, with the legal links of the site", async () => {
    const h = await harness();
    const html = await textOf(await h.request("/login"));
    expect(langOf(html)).toBe("en");
    expect(html).toContain(`<h1>${en.signin.chooserTitle}</h1>`);
    expect(html).toContain(en.signin.continueWith("GitHub"));
    expect(html).toContain(en.signin.continueWith("Google"));
    expect(hrefsOf(html)).toEqual(
      expect.arrayContaining(["https://meltemi.dev/privacy/", "https://meltemi.dev/terms/"]),
    );
    expect(hrefsOf(html)).not.toContain("https://meltemi.dev/es/privacy/");
  });

  it("is in Spanish for Accept-Language es-CL, with the Spanish legal links", async () => {
    const h = await harness();
    const html = await textOf(
      await h.request("/login", { headers: { "Accept-Language": "es-CL,es;q=0.9,en;q=0.8" } }),
    );
    expect(langOf(html)).toBe("es");
    expect(html).toContain(`<h1>${es.signin.chooserTitle}</h1>`);
    expect(html).toContain(es.signin.continueWith("GitHub"));
    expect(hrefsOf(html)).toEqual(
      expect.arrayContaining(["https://meltemi.dev/es/privacy/", "https://meltemi.dev/es/terms/"]),
    );
    expect(html).toContain(es.common.privacy);
    expect(html).toContain(es.common.terms);
  });

  it("?lang=es wins over an English Accept-Language, and ?lang=fr falls back to English", async () => {
    const h = await harness();
    const spanish = await textOf(
      await h.request("/login?lang=es", { headers: { "Accept-Language": "en-US,en;q=0.9" } }),
    );
    expect(langOf(spanish)).toBe("es");
    const french = await textOf(await h.request("/login?lang=fr"));
    expect(langOf(french)).toBe("en");
    expect(french).toContain(en.signin.chooserTitle);
  });

  it("follows a SITE_URL of another address for the legal pages", async () => {
    const h = await harness({ env: { SITE_URL: "https://www.meltemi.dev/" } });
    const html = await textOf(await h.request("/login?lang=es"));
    expect(hrefsOf(html)).toEqual(
      expect.arrayContaining([
        "https://www.meltemi.dev/es/privacy/",
        "https://www.meltemi.dev/es/terms/",
      ]),
    );
  });

  it("answers the refusals of /login in the language of the request", async () => {
    const h = await harness();
    const html = await textOf(
      await h.request("/login?provider=facebook", { headers: { "Accept-Language": "es" } }),
    );
    expect(langOf(html)).toBe("es");
    expect(html).toContain(es.signin.unknownProviderTitle);
    expect(html).toContain("provider.unknown");
  });
});

/** Every leaf of a catalog section, by its path. */
function leaves(value: unknown, path = ""): Map<string, unknown> {
  const found = new Map<string, unknown>();
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      for (const [p, v] of leaves(child, path ? `${path}.${key}` : key)) found.set(p, v);
    }
  } else {
    found.set(path, value);
  }
  return found;
}

describe("the catalogs", () => {
  // Words that are the same in both languages: names, not sentences.
  const SAME = new Set(["common.brand", "signin.providers.github", "signin.providers.google"]);
  const SAMPLE = ["Alpha", "Beta", "gamma@example.com", 90] as const;

  /** A leaf as text: a string as it is, a function as the sentence it gives for sample values. */
  const textOfLeaf = (leaf: unknown): string => {
    if (typeof leaf === "function")
      return String((leaf as (...args: unknown[]) => unknown)(...SAMPLE));
    return String(leaf);
  };

  it("have the same words in both languages: same paths, same kinds", () => {
    const english = leaves(en);
    const spanish = leaves(es);
    expect([...spanish.keys()].sort()).toEqual([...english.keys()].sort());
    for (const [path, leaf] of english) expect(typeof spanish.get(path), path).toBe(typeof leaf);
  });

  for (const section of ["common", "signin"] as const) {
    it(`${section}: no word is empty and every Spanish word is its own`, () => {
      const english = leaves(en[section], section);
      const spanish = leaves(es[section], section);
      for (const [path, leaf] of english) {
        const inEnglish = textOfLeaf(leaf);
        const inSpanish = textOfLeaf(spanish.get(path));
        expect(inEnglish.length, path).toBeGreaterThan(0);
        expect(inSpanish.length, path).toBeGreaterThan(0);
        if (!SAME.has(path)) expect(inSpanish, path).not.toBe(inEnglish);
      }
    });
  }

  it("signin: a sentence with names uses every name it is given", () => {
    for (const catalog of [en.signin, es.signin]) {
      expect(catalog.deniedBody("Alpha")).toContain("Alpha");
      expect(catalog.unavailableTitle("Alpha")).toContain("Alpha");
      expect(catalog.unavailableBody("Alpha")).toContain("Alpha");
      expect(catalog.takenBody("Alpha")).toContain("Alpha");
      expect(catalog.continueWith("Alpha")).toContain("Alpha");
      expect(catalog.tryProviderAgain("Alpha")).toContain("Alpha");
      expect(catalog.signInWith("Alpha")).toContain("Alpha");
      const intro = catalog.existsIntro("Alpha", "Beta", "gamma@example.com", 90);
      for (const part of ["Alpha", "Beta", "gamma@example.com", "90"])
        expect(intro).toContain(part);
      const options = catalog.existsOptions("Beta", "Alpha");
      expect(options).toContain("Alpha");
      expect(options).toContain("Beta");
    }
  });

  it("are chosen by language", () => {
    expect(messages("en")).toBe(en);
    expect(messages("es")).toBe(es);
  });
});
