// How the service reads its environment (`readConfig`), the cookie attributes that follow from it,
// and the two files that declare the environment: `wrangler.jsonc` (never a secret, never `DEV`)
// and `.dev.vars.example` (every name of `Env`).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConfigError, readConfig } from "../src/config.js";
import type { Env } from "../src/env.js";
import { clearSessionCookie, sessionCookie } from "../src/session.js";
import { testEnv } from "./support/index.js";
import { namesIn, readJsonc } from "./support/jsonc.js";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const ROOT = join(PACKAGE, "..", "..");
const read = (...path: string[]) => readFileSync(join(...path), "utf8");

const events = (name: string) => `https://${name}.meltemi.dev/_identity/events`;
const products = (...entries: unknown[]) => JSON.stringify(entries);

/** Reads the config of an environment that sets only what a test names. */
const config = (overrides: Partial<Env> = {}) => readConfig(testEnv(overrides));

function configError(overrides: Partial<Env>): string {
  try {
    config(overrides);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).message;
  }
  throw new Error("readConfig accepted an environment it should have refused");
}

// ---------------------------------------------------------------------------------------------

describe("readConfig", () => {
  describe("the production environment", () => {
    it("reads the addresses, the domain and the products", () => {
      expect(config()).toEqual({
        issuer: "https://id.meltemi.dev",
        cookieDomain: "meltemi.dev",
        siteUrl: "https://meltemi.dev",
        dev: false,
        devOrigins: [],
        products: [
          {
            name: "diagrams",
            events: "https://diagrams.meltemi.dev/_identity/events",
            secretName: "EVENTS_SECRET_DIAGRAMS",
          },
        ],
        secureCookies: true,
        cookieDomainAttribute: "meltemi.dev",
      });
    });

    it("does not change the environment it reads, and reads a frozen one", () => {
      const env = Object.freeze(testEnv({ ISSUER: "https://id.meltemi.dev/" }));
      expect(config()).toEqual(readConfig(env));
      expect(env.ISSUER).toBe("https://id.meltemi.dev/");
    });
  });

  describe("the development flag", () => {
    it("is on only for the exact text true", () => {
      expect(config({ DEV: "true" }).dev).toBe(true);
      for (const DEV of ["TRUE", "True", "1", "yes", "on", "false", "", " true", "true "]) {
        expect(config({ DEV }).dev, JSON.stringify(DEV)).toBe(false);
      }
      expect(config({}).dev).toBe(false);
    });
  });

  describe("the addresses", () => {
    it("trims every trailing slash of ISSUER and SITE_URL, and only those", () => {
      const read = config({
        ISSUER: "https://id.meltemi.dev///",
        SITE_URL: "https://meltemi.dev/",
      });
      expect(read.issuer).toBe("https://id.meltemi.dev");
      expect(read.siteUrl).toBe("https://meltemi.dev");
      expect(config({ SITE_URL: "https://meltemi.dev/site/" }).siteUrl).toBe(
        "https://meltemi.dev/site",
      );
      expect(config({ SITE_URL: "https://meltemi.dev/a/b" }).siteUrl).toBe(
        "https://meltemi.dev/a/b",
      );
    });

    it("takes the cookie domain as it is", () => {
      expect(config({ COOKIE_DOMAIN: "family.example" }).cookieDomain).toBe("family.example");
    });

    it.each(["", "id.meltemi.dev", "ftp://id.meltemi.dev", "/relative", "javascript:alert(1)"])(
      "refuses an ISSUER of %j",
      (ISSUER) => {
        expect(configError({ ISSUER })).toMatch(/ISSUER/);
      },
    );

    it.each(["", "meltemi.dev", "ftp://meltemi.dev", "//meltemi.dev"])(
      "refuses a SITE_URL of %j",
      (SITE_URL) => {
        expect(configError({ SITE_URL })).toMatch(/SITE_URL/);
      },
    );

    it("refuses a missing cookie domain", () => {
      expect(configError({ COOKIE_DOMAIN: "" })).toMatch(/COOKIE_DOMAIN/);
    });

    it("accepts http addresses (the development ones) for ISSUER and SITE_URL in development mode", () => {
      const read = config({
        DEV: "true",
        ISSUER: "http://localhost:8787",
        SITE_URL: "http://localhost:8789",
      });
      expect(read.issuer).toBe("http://localhost:8787");
      expect(read.siteUrl).toBe("http://localhost:8789");
    });

    it("refuses http addresses outside development mode", () => {
      expect(configError({ ISSUER: "http://id.meltemi.dev" })).toMatch(/ISSUER must be https/);
      expect(configError({ SITE_URL: "http://meltemi.dev" })).toMatch(/SITE_URL must be https/);
      expect(configError({ DEV: "1", ISSUER: "http://localhost:8787" })).toMatch(
        /ISSUER must be https/,
      );
    });

    it.each(["https://", "http://", "https:// id.meltemi.dev"])(
      "refuses an address that is not one: %j",
      (ISSUER) => {
        expect(configError({ ISSUER, DEV: "true" })).toMatch(/ISSUER is not an address/);
      },
    );
  });

  describe("DEV_ORIGINS", () => {
    const DEV_ORIGINS = "http://localhost:8788,http://localhost:8789";

    it("is parsed in development mode into origins", () => {
      expect(config({ DEV: "true", DEV_ORIGINS }).devOrigins).toEqual([
        "http://localhost:8788",
        "http://localhost:8789",
      ]);
    });

    it("tolerates spaces, empty items, paths and trailing slashes, and keeps only origins", () => {
      const origins = config({
        DEV: "true",
        DEV_ORIGINS:
          " http://localhost:8788/ ,, http://localhost:8789/path?q=1#h , https://dev.example.test:8443 ,",
      }).devOrigins;
      expect(origins).toEqual([
        "http://localhost:8788",
        "http://localhost:8789",
        "https://dev.example.test:8443",
      ]);
    });

    it("is empty when it is missing or blank", () => {
      expect(config({ DEV: "true" }).devOrigins).toEqual([]);
      expect(config({ DEV: "true", DEV_ORIGINS: "" }).devOrigins).toEqual([]);
      expect(config({ DEV: "true", DEV_ORIGINS: " , ," }).devOrigins).toEqual([]);
    });

    it("is ignored when DEV is not true, however it is written", () => {
      expect(config({ DEV_ORIGINS }).devOrigins).toEqual([]);
      expect(config({ DEV: "false", DEV_ORIGINS }).devOrigins).toEqual([]);
      expect(config({ DEV: "TRUE", DEV_ORIGINS }).devOrigins).toEqual([]);
      // Not even parsed: a mistake in a variable that must not exist in production is not an outage.
      expect(config({ DEV_ORIGINS: "not a url" }).devOrigins).toEqual([]);
    });

    it("refuses an item that is not an address when development mode is on", () => {
      expect(configError({ DEV: "true", DEV_ORIGINS: "http://localhost:8788,not a url" })).toMatch(
        /DEV_ORIGINS/,
      );
    });
  });

  describe("PRODUCTS", () => {
    it("is read as a list of products with their events address", () => {
      const read = config({
        PRODUCTS: products(
          { name: "diagrams", events: events("diagrams") },
          { name: "ide", events: events("ide") },
        ),
      });
      expect(read.products.map((p) => [p.name, p.events])).toEqual([
        ["diagrams", events("diagrams")],
        ["ide", events("ide")],
      ]);
    });

    it("may be empty or blank: nobody receives events", () => {
      expect(config({ PRODUCTS: "[]" }).products).toEqual([]);
      expect(config({ PRODUCTS: "" }).products).toEqual([]);
    });

    it("keeps the address as the URL parser writes it", () => {
      const read = config({
        PRODUCTS: products({
          name: "diagrams",
          events: "https://Diagrams.Meltemi.dev/_identity/events",
        }),
      });
      expect(read.products[0]?.events).toBe("https://diagrams.meltemi.dev/_identity/events");
    });

    describe("a list that cannot be read", () => {
      it.each(["not json", "{", "[", "[{]", "undefined", "'[]'"])(
        "refuses %j as JSON",
        (PRODUCTS) => {
          expect(configError({ PRODUCTS })).toMatch(/PRODUCTS is not JSON/);
        },
      );

      it.each(["{}", "null", "5", '"diagrams"', "true", '{"name":"diagrams"}'])(
        "refuses %s: not an array",
        (PRODUCTS) => {
          expect(configError({ PRODUCTS })).toMatch(/PRODUCTS is not an array/);
        },
      );
    });

    it("refuses a product listed twice (it would be told twice, with the same secret)", () => {
      expect(
        configError({
          PRODUCTS: products(
            { name: "diagrams", events: events("a") },
            { name: "diagrams", events: events("b") },
          ),
        }),
      ).toMatch(/diagrams: the product is listed twice/);
    });

    describe("an entry that cannot be used", () => {
      it.each<[string, unknown]>([
        ["null", null],
        ["a number", 5],
        ["a string", "diagrams"],
        ["an array", ["diagrams"]],
        ["an empty object", {}],
        ["a name that is a number", { name: 5, events: events("x") }],
        ["a name that is null", { name: null, events: events("x") }],
      ])("refuses %s", (_name, entry) => {
        expect(configError({ PRODUCTS: products(entry) })).toMatch(/name/);
      });

      it.each([
        "",
        "Diagrams",
        "DIAGRAMS",
        "1diagrams",
        "-diagrams",
        "dia grams",
        "dia_grams",
        "dia.grams",
        "dia/grams",
        "dïagrams",
        "a".repeat(32),
        "diagrams\n",
        " diagrams",
      ])("refuses the name %j", (name) => {
        expect(configError({ PRODUCTS: products({ name, events: events("x") }) })).toMatch(/name/);
      });

      it.each(["a", "d1", "my-app", "a-", "a".repeat(31), "a0-b1-c2"])(
        "accepts the name %j",
        (name) => {
          expect(
            config({ PRODUCTS: products({ name, events: events("x") }) }).products[0]?.name,
          ).toBe(name);
        },
      );

      it.each<[string, unknown]>([
        ["missing", undefined],
        ["a number", 5],
        ["null", null],
        ["an object", { url: events("x") }],
      ])("refuses events that are %s", (_name, value) => {
        const entry: Record<string, unknown> = { name: "diagrams" };
        if (value !== undefined) entry["events"] = value;
        expect(configError({ PRODUCTS: products(entry) })).toMatch(/diagrams: events is missing/);
      });

      it.each(["not a url", "/_identity/events", "diagrams.meltemi.dev/_identity/events", ""])(
        "refuses events %j: not an address",
        (address) => {
          expect(
            configError({ PRODUCTS: products({ name: "diagrams", events: address }) }),
          ).toMatch(/diagrams: events is not a URL/);
        },
      );

      it.each([
        "http://diagrams.meltemi.dev/_identity/events",
        "ftp://diagrams.meltemi.dev/x",
        "javascript:alert(1)",
      ])("refuses events %j outside development mode", (address) => {
        expect(configError({ PRODUCTS: products({ name: "diagrams", events: address }) })).toMatch(
          /events must be https/,
        );
      });

      it("allows http for events in development mode, and still refuses other schemes", () => {
        const dev = (address: string) =>
          config({ DEV: "true", PRODUCTS: products({ name: "diagrams", events: address }) });
        expect(dev("http://localhost:8788/_identity/events").products[0]?.events).toBe(
          "http://localhost:8788/_identity/events",
        );
        expect(dev("https://diagrams.meltemi.dev/_identity/events").products).toHaveLength(1);
        expect(() => dev("ftp://localhost/x")).toThrow(/events must be https/);
        expect(() => dev("javascript:alert(1)")).toThrow(ConfigError);
      });

      it("names the product that has the problem, not only the first one", () => {
        const message = configError({
          PRODUCTS: products(
            { name: "diagrams", events: events("diagrams") },
            { name: "ide", events: "http://ide.meltemi.dev/events" },
          ),
        });
        expect(message).toMatch(/ide: events must be https/);
      });
    });

    describe("the name of its secret", () => {
      it.each([
        ["diagrams", "EVENTS_SECRET_DIAGRAMS"],
        ["ide", "EVENTS_SECRET_IDE"],
        ["my-app", "EVENTS_SECRET_MY_APP"],
        ["a1-b2-c3", "EVENTS_SECRET_A1_B2_C3"],
        ["x", "EVENTS_SECRET_X"],
        ["a-", "EVENTS_SECRET_A_"],
      ])("is derived from %s as %s", (name, secretName) => {
        const read = config({ PRODUCTS: products({ name, events: events("x") }) });
        expect(read.products[0]?.secretName).toBe(secretName);
      });

      it("is different for different names, and in the order of the list", () => {
        const read = config({
          PRODUCTS: products(
            { name: "b-b", events: events("b") },
            { name: "bb", events: events("bb") },
            { name: "a", events: events("a") },
          ),
        });
        expect(read.products.map((p) => p.secretName)).toEqual([
          "EVENTS_SECRET_B_B",
          "EVENTS_SECRET_BB",
          "EVENTS_SECRET_A",
        ]);
      });
    });
  });

  describe("the cookie attributes", () => {
    const cases: [string, Partial<Env>, boolean, string | undefined][] = [
      ["production", {}, true, "meltemi.dev"],
      [
        "production with another cookie domain",
        { COOKIE_DOMAIN: "family.example" },
        true,
        "family.example",
      ],
      ["development on http", { DEV: "true", ISSUER: "http://localhost:8787" }, false, undefined],
      [
        "development on https",
        { DEV: "true", ISSUER: "https://dev.example.test" },
        true,
        undefined,
      ],
      ["development on the production issuer", { DEV: "true" }, true, undefined],
      ["DEV that is not true", { DEV: "1" }, true, "meltemi.dev"],
    ];

    it.each(cases)("%s", (_name, overrides, secure, domain) => {
      const read = config(overrides);
      expect(read.secureCookies).toBe(secure);
      expect(read.cookieDomainAttribute).toBe(domain);
    });

    it.each(cases)(
      "%s: the session cookie and the one that clears it",
      (_name, overrides, secure, domain) => {
        const read = config(overrides);
        for (const cookie of [sessionCookie(read, "token"), clearSessionCookie(read)]) {
          const attributes = cookie.split("; ").slice(1);
          expect(attributes.includes("Secure")).toBe(secure);
          expect(attributes.find((a) => a.startsWith("Domain="))).toBe(
            domain && `Domain=${domain}`,
          );
          expect(attributes).toContain("HttpOnly");
          expect(attributes).toContain("SameSite=Lax");
          expect(attributes).toContain("Path=/");
        }
        expect(sessionCookie(read, "token").split("; ")).toContain("Max-Age=2592000");
        expect(clearSessionCookie(read).split("; ")).toContain("Max-Age=0");
      },
    );
  });
});

// ---------------------------------------------------------------------------------------------

describe("wrangler.jsonc", () => {
  const { value, hadComments } = readJsonc(read(PACKAGE, "wrangler.jsonc"));
  const wrangler = value as Record<string, unknown>;
  const vars = (wrangler["vars"] ?? {}) as Record<string, unknown>;

  /** What must come from `.dev.vars` or from the Worker's secrets, never from this file. */
  const NEVER_HERE =
    /^(DEV|DEV_ORIGINS|SESSION_PRIVATE_KEY|STATE_SECRET|\w*_CLIENT_SECRET|EVENTS_SECRET_\w*)$/;

  it("is a JSON document with no comments", () => {
    expect(hadComments).toBe(false);
    expect(typeof value).toBe("object");
  });

  /** The Secrets Store bindings: the one place a secret's name may appear, as `secret_name`. */
  const stored = (wrangler["secrets_store_secrets"] ?? []) as Record<string, unknown>[];

  it("defines no DEV, no DEV_ORIGINS and no secret, anywhere in the file", () => {
    const { secrets_store_secrets: _bindings, ...rest } = wrangler;
    const forbidden = namesIn(rest).filter((name) => NEVER_HERE.test(name));
    expect(forbidden).toEqual([]);
    const inBindings = stored.flatMap((binding) =>
      Object.entries(binding)
        // The name of the secret and the binding's own name (`<NAME>_STORE`, checked below).
        .filter(([key]) => key !== "secret_name" && key !== "binding")
        .flatMap(([key, value]) => [key, ...namesIn(value)]),
    );
    expect(inBindings.filter((name) => NEVER_HERE.test(name))).toEqual([]);
  });

  it("binds every secret from the family's Secrets Store as <NAME>_STORE", () => {
    expect(stored.map((binding) => binding["secret_name"]).sort()).toEqual([
      "EVENTS_SECRET_DIAGRAMS",
      "GITHUB_CLIENT_SECRET",
      "GOOGLE_CLIENT_SECRET",
      "SESSION_PRIVATE_KEY",
      "STATE_SECRET",
    ]);
    for (const binding of stored) {
      expect(binding["binding"]).toBe(`${String(binding["secret_name"])}_STORE`);
      expect(binding["store_id"]).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(new Set(stored.map((binding) => binding["store_id"])).size).toBe(1);
  });

  it("has no address but the Custom Domain Terraform attaches: no route, no workers.dev, no previews", () => {
    expect(wrangler).not.toHaveProperty("routes");
    expect(wrangler).not.toHaveProperty("route");
    expect(wrangler["workers_dev"]).toBe(false);
    expect(wrangler["preview_urls"]).toBe(false);
  });

  it("names the account nowhere: the deploy workflow gives it", () => {
    expect(wrangler).not.toHaveProperty("account_id");
  });

  it("publishes, once set, a key set of P-256 signing keys with kids", () => {
    const keys = JSON.parse(vars["SESSION_PUBLIC_KEYS"] as string) as Record<string, unknown>[];
    for (const key of keys) {
      expect(key).toMatchObject({ kty: "EC", crv: "P-256" });
      expect(typeof key["kid"]).toBe("string");
      expect(key).not.toHaveProperty("d");
    }
  });

  it("holds no private key, token or PEM block", () => {
    const text = read(PACKAGE, "wrangler.jsonc");
    expect(text).not.toMatch(/-----BEGIN|"d"\s*:|\\"d\\"\s*:|ghp_|gho_|github_pat_|GOCSPX|sk-/);
  });

  it("binds the D1 database as DB", () => {
    const databases = wrangler["d1_databases"] as { binding: string }[];
    expect(databases).toHaveLength(1);
    expect(databases[0]?.binding).toBe("DB");
  });

  it("runs the scheduled handler every fifteen minutes", () => {
    expect((wrangler["triggers"] as { crons: string[] }).crons).toEqual(["*/15 * * * *"]);
  });

  it("starts from src/worker.ts", () => {
    expect(wrangler["main"]).toBe("src/worker.ts");
  });

  it("sets the public variables of the service, as text", () => {
    expect(Object.keys(vars).sort()).toEqual([
      "COOKIE_DOMAIN",
      "GITHUB_CLIENT_ID",
      "GOOGLE_CLIENT_ID",
      "ISSUER",
      "PRODUCTS",
      "SESSION_PUBLIC_KEYS",
      "SITE_URL",
    ]);
    for (const [name, text] of Object.entries(vars)) expect(typeof text, name).toBe("string");
    expect(vars["ISSUER"]).toBe("https://id.meltemi.dev");
    expect(vars["COOKIE_DOMAIN"]).toBe("meltemi.dev");
    expect(vars["SITE_URL"]).toBe("https://meltemi.dev");
  });

  it("holds variables the service accepts as a production environment", () => {
    const read = readConfig(testEnv(vars as Partial<Env>));
    expect(read.dev).toBe(false);
    expect(read.devOrigins).toEqual([]);
    expect(read.secureCookies).toBe(true);
    expect(read.cookieDomainAttribute).toBe("meltemi.dev");
    expect(read.products).toEqual([
      {
        name: "diagrams",
        events: "https://diagrams.meltemi.dev/_identity/events",
        secretName: "EVENTS_SECRET_DIAGRAMS",
      },
    ]);
    expect(JSON.parse(vars["SESSION_PUBLIC_KEYS"] as string)).toBeInstanceOf(Array);
  });

  it("names only variables that Env declares", () => {
    const declared = envNames().variables;
    for (const name of Object.keys(vars)) expect(declared, name).toContain(name);
  });
});

// ---------------------------------------------------------------------------------------------

/** The names of `Env`, read from `src/env.ts` as text: variables, secrets and the D1 binding. */
function envNames() {
  const source = read(PACKAGE, "src", "env.ts");
  const names = [...source.matchAll(/^\s*readonly ([A-Z][A-Z0-9_]*)\??:/gm)].map((m) => m[1]!);
  return {
    all: names,
    binding: names.filter((name) => name === "DB"),
    variables: names.filter((name) => name !== "DB"),
    perProductSecrets: /\[\w+: `EVENTS_SECRET_\$\{string\}`\]/.test(source),
  };
}

/** A `.dev.vars` file as Wrangler reads it: `NAME=value` lines, `#` comments, optional quotes. */
function parseDevVars(text: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 0) continue;
    let value = line.slice(index + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    vars.set(line.slice(0, index).trim(), value);
  }
  return vars;
}

describe(".dev.vars.example", () => {
  const text = read(PACKAGE, ".dev.vars.example");
  const example = parseDevVars(text);
  const env = envNames();

  it("reads the names of Env from src/env.ts (so the checks below are not empty)", () => {
    expect(env.variables).toEqual(
      expect.arrayContaining([
        "ISSUER",
        "COOKIE_DOMAIN",
        "SITE_URL",
        "SESSION_PUBLIC_KEYS",
        "PRODUCTS",
        "GITHUB_CLIENT_ID",
        "GOOGLE_CLIENT_ID",
        "DEV",
        "DEV_ORIGINS",
        "GITHUB_CLIENT_SECRET",
        "GOOGLE_CLIENT_SECRET",
        "SESSION_PRIVATE_KEY",
        "STATE_SECRET",
      ]),
    );
    expect(env.binding).toEqual(["DB"]);
    expect(env.perProductSecrets).toBe(true);
  });

  it("names every variable and secret of Env", () => {
    for (const name of env.variables) expect([...example.keys()], name).toContain(name);
  });

  it("does not name the D1 binding: Wrangler provides it", () => {
    expect([...example.keys()]).not.toContain("DB");
  });

  it("names the events secret of every product it configures", () => {
    expect(env.perProductSecrets).toBe(true);
    const names = [...example.keys()].filter((name) => name.startsWith("EVENTS_SECRET_"));
    expect(names.length).toBeGreaterThan(0);
    const configured = readConfig(
      testEnv({ DEV: "true", ...(Object.fromEntries(example) as Partial<Env>) }),
    );
    expect(configured.products.map((p) => p.secretName).sort()).toEqual(names.sort());
  });

  it("names nothing that Env does not declare", () => {
    for (const name of example.keys()) {
      const known = env.variables.includes(name) || /^EVENTS_SECRET_[A-Z0-9_]+$/.test(name);
      expect(known, name).toBe(true);
    }
  });

  it("holds the development values", () => {
    expect(example.get("DEV")).toBe("true");
    expect(example.get("ISSUER")).toBe("http://localhost:8787");
    expect(example.get("SITE_URL")).toBe("http://localhost:8789");
    expect(example.get("DEV_ORIGINS")).toBe("http://localhost:8788,http://localhost:8789");
    expect(example.get("SESSION_PUBLIC_KEYS")).toBe("[]");
    expect(JSON.parse(example.get("PRODUCTS")!)).toEqual([
      { name: "diagrams", events: "http://localhost:8788/_identity/events" },
    ]);
  });

  it("is a development environment the service accepts, with every secret still empty", () => {
    const read = readConfig(testEnv(Object.fromEntries(example) as Partial<Env>));
    expect(read).toMatchObject({
      dev: true,
      issuer: "http://localhost:8787",
      siteUrl: "http://localhost:8789",
      devOrigins: ["http://localhost:8788", "http://localhost:8789"],
      secureCookies: false,
      cookieDomainAttribute: undefined,
    });
    expect(read.products).toEqual([
      {
        name: "diagrams",
        events: "http://localhost:8788/_identity/events",
        secretName: "EVENTS_SECRET_DIAGRAMS",
      },
    ]);
  });

  it("holds no secret: every secret and client id is empty for the owner to fill", () => {
    for (const [name, value] of example) {
      if (/SECRET|PRIVATE_KEY|CLIENT_ID/.test(name)) expect(value, name).toBe("");
    }
    expect(text).not.toMatch(/-----BEGIN|"d"\s*:|ghp_|gho_|github_pat_|GOCSPX/);
  });

  it("is kept out of Git as .dev.vars", () => {
    const ignored = read(ROOT, ".gitignore")
      .split(/\r?\n/)
      .map((line) => line.trim());
    expect(ignored).toContain(".dev.vars*");
    expect(ignored).toContain("!.dev.vars.example");
  });
});
