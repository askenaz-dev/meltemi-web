import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";
import {
  MAX_RETURN_TO_LENGTH,
  isFamilyOrigin,
  isFamilyUrl,
  resolveReturnTo,
} from "../src/return-to.js";
import { harness, testEnv } from "./support/index.js";
import { DEV_ENV, NOT_DEV_ENV } from "./support/signin.js";

const production = readConfig(testEnv());
const development = readConfig(testEnv(DEV_ENV));

/** The accepted address, or "refused". */
function verdict(raw: string | null | undefined, config = production): string {
  const result = resolveReturnTo(raw, config);
  return result.ok ? result.url : "refused";
}

describe("resolveReturnTo: what is accepted", () => {
  it("falls back to the site when there is no address", () => {
    expect(verdict(undefined)).toBe("https://meltemi.dev");
    expect(verdict(null)).toBe("https://meltemi.dev");
    expect(verdict("")).toBe("https://meltemi.dev");
  });

  it("falls back to the configured site, without a trailing slash", () => {
    const config = readConfig(testEnv({ SITE_URL: "https://www.meltemi.dev/" }));
    expect(verdict(undefined, config)).toBe("https://www.meltemi.dev");
  });

  it("accepts the family's registrable domain and its subdomains, path and query intact", () => {
    expect(verdict("https://meltemi.dev/")).toBe("https://meltemi.dev/");
    expect(verdict("https://diagrams.meltemi.dev/p/abc?x=1")).toBe(
      "https://diagrams.meltemi.dev/p/abc?x=1",
    );
    expect(verdict("https://a.b.meltemi.dev/deep/path/?q=a%20b&r=2#frag")).toBe(
      "https://a.b.meltemi.dev/deep/path/?q=a%20b&r=2#frag",
    );
  });

  it("hands back the parsed address: what the browser will follow is what was checked", () => {
    expect(verdict("https://DIAGRAMS.Meltemi.DEV/Path")).toBe("https://diagrams.meltemi.dev/Path");
    expect(verdict("https://meltemi.dev:443/x")).toBe("https://meltemi.dev/x");
    expect(verdict("  https://meltemi.dev/x")).toBe("https://meltemi.dev/x");
    expect(verdict("https://meltemi.dev/ñ")).toBe("https://meltemi.dev/%C3%B1");
    // Full-width letters are the same host once parsed.
    expect(verdict("https://ｍｅｌｔｅｍｉ.dev/")).toBe("https://meltemi.dev/");
  });

  it("keeps percent-encoded line breaks encoded: no header can be split by an accepted address", () => {
    const result = verdict("https://meltemi.dev/%0d%0aSet-Cookie:x=y");
    expect(result).toBe("https://meltemi.dev/%0d%0aSet-Cookie:x=y");
    expect(result).not.toMatch(/[\r\n]/);
  });

  it("uses the configured cookie domain", () => {
    const config = readConfig(testEnv({ COOKIE_DOMAIN: "example.test" }));
    expect(verdict("https://app.example.test/", config)).toBe("https://app.example.test/");
    expect(verdict("https://meltemi.dev/", config)).toBe("refused");
  });
});

describe("resolveReturnTo: size", () => {
  it("accepts an address of exactly 2048 characters and refuses one more", () => {
    const base = "https://diagrams.meltemi.dev/p?x=";
    const ok = base + "a".repeat(MAX_RETURN_TO_LENGTH - base.length);
    expect(ok).toHaveLength(MAX_RETURN_TO_LENGTH);
    expect(verdict(ok)).toBe(ok);
    expect(verdict(`${ok}a`)).toBe("refused");
  });

  it("keeps the signed cookie that carries the longest accepted address under 4 KiB", async () => {
    const h = await harness();
    const base = "https://diagrams.meltemi.dev/p?x=";
    const longest = base + "a".repeat(MAX_RETURN_TO_LENGTH - base.length);
    const response = await h.request(
      `/login?provider=github&return_to=${encodeURIComponent(longest)}`,
    );
    expect(response.status).toBe(302);
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith("meltemi_oauth="));
    expect(cookie).toBeDefined();
    expect(cookie!.length).toBeLessThan(4096);
  });
});

describe("resolveReturnTo: what is refused", () => {
  const refused: [string, string][] = [
    ["a foreign host", "https://evil.example/"],
    ["the family's name inside a foreign host", "https://meltemi.dev.evil.example/"],
    ["the family's name as a prefix", "https://evilmeltemi.dev/"],
    ["the family's name as a suffix of a word", "https://notmeltemi.dev/"],
    ["a trailing dot", "https://meltemi.dev./"],
    ["the family's name in the path", "https://evil.example/meltemi.dev"],
    ["the family's name in the query", "https://evil.example/?next=https://meltemi.dev/"],
    ["a user name", "https://user@meltemi.dev/"],
    ["a user name and password", "https://user:secret@meltemi.dev/"],
    ["the family's host as a user name", "https://meltemi.dev@evil.example/"],
    ["an empty user name with a password", "https://:secret@meltemi.dev/"],
    ["the http scheme", "http://meltemi.dev/"],
    ["the http scheme on a subdomain", "http://diagrams.meltemi.dev/"],
    ["a port", "https://meltemi.dev:8443/"],
    ["a port on a subdomain", "https://diagrams.meltemi.dev:444/"],
    ["a script address", "javascript:alert(1)"],
    ["a data address", "data:text/html,<script>alert(1)</script>"],
    ["a protocol-relative address", "//meltemi.dev/"],
    ["a relative path", "/account"],
    ["a bare host", "meltemi.dev"],
    ["a file address", "file:///etc/passwd"],
    ["not an address at all", "not a url"],
    ["a backslash instead of a slash", "https:\\\\meltemi.dev\\"],
    ["a backslash that hides another host", "https://evil.example\\@meltemi.dev/"],
    ["a backslash before the family's name", "https://evil.example\\.meltemi.dev/"],
    ["a backslash in the path", "https://meltemi.dev/a\\b"],
    ["a percent-encoded backslash in the host", "https://evil.example%5C.meltemi.dev/"],
    ["a percent-encoded dot that makes a foreign host", "https://meltemi.dev%2eevil.example/"],
    ["an ideographic full stop that makes a foreign host", "https://meltemi.dev。evil.example/"],
    ["a tab inside the address", "https://meltemi.dev/\t@evil.example"],
    ["a tab inside the host", "https://melt\temi.dev/"],
    ["a line feed", "https://meltemi.dev/\n"],
    ["a carriage return", "https://meltemi.dev/\rx"],
    ["a line break that splits a header", "https://meltemi.dev/\r\nSet-Cookie: x=y"],
    ["a null character", "https://meltemi.dev/\u0000"],
    ["a delete character", "https://meltemi.dev/\u007f"],
    ["a script address hidden by a tab", "java\tscript:alert(1)"],
  ];

  it.each(refused)("%s", (_name, raw) => {
    expect(verdict(raw)).toBe("refused");
  });
});

describe("isFamilyUrl", () => {
  const family = (raw: string, config = production) => isFamilyUrl(new URL(raw), config);

  it("judges the parsed address: scheme, credentials, port and host", () => {
    expect(family("https://meltemi.dev/")).toBe(true);
    expect(family("https://diagrams.meltemi.dev/x")).toBe(true);
    expect(family("http://meltemi.dev/")).toBe(false);
    expect(family("https://user@meltemi.dev/")).toBe(false);
    expect(family("https://:secret@meltemi.dev/")).toBe(false);
    expect(family("https://meltemi.dev:8443/")).toBe(false);
    expect(family("https://meltemi.dev.evil.example/")).toBe(false);
    expect(family("https://evilmeltemi.dev/")).toBe(false);
    expect(family("https://evil.example/meltemi.dev")).toBe(false);
  });

  it("does not look at the raw text, which is resolveReturnTo's job: a backslash is a slash once parsed", () => {
    // `new URL` reads the backslashes as slashes; only the raw text still shows the trick.
    expect(family("https:\\meltemi.dev\\")).toBe(true);
    expect(verdict("https:\\meltemi.dev\\")).toBe("refused");
  });
});

describe("resolveReturnTo: development", () => {
  it("accepts the development origins and the service's own in development mode", () => {
    expect(verdict("http://localhost:8788/", development)).toBe("http://localhost:8788/");
    expect(verdict("http://localhost:8789/a?b=1", development)).toBe("http://localhost:8789/a?b=1");
    // The account page returns to the service itself.
    expect(verdict("http://localhost:8787/account", development)).toBe(
      "http://localhost:8787/account",
    );
  });

  it("refuses them outside development mode, even when DEV_ORIGINS is set", () => {
    const notDev = readConfig(
      testEnv({ DEV_ORIGINS: "http://localhost:8788,http://localhost:8789" }),
    );
    expect(notDev.devOrigins).toEqual([]);
    expect(verdict("http://localhost:8788/", notDev)).toBe("refused");
    expect(verdict("http://localhost:8789/", notDev)).toBe("refused");
    for (const flag of ["false", "1", "TRUE", ""]) {
      const config = readConfig(testEnv({ ...NOT_DEV_ENV, DEV: flag }));
      expect(verdict("http://localhost:8788/", config), flag).toBe("refused");
    }
  });

  it("is exact about the origin: another port, another scheme or a lookalike host is refused", () => {
    for (const raw of [
      "http://localhost:8790/",
      "http://localhost/",
      "https://localhost:8788/",
      "http://localhost:8788.evil.example/",
      "http://localhost.evil.example:8788/",
      "http://127.0.0.1:8788/",
      "http://user@localhost:8788/",
      "http://localhost:8788\\@evil.example/",
    ]) {
      expect(verdict(raw, development), raw).toBe("refused");
    }
  });

  it("still accepts the family's own https hosts in development mode", () => {
    expect(verdict("https://diagrams.meltemi.dev/", development)).toBe(
      "https://diagrams.meltemi.dev/",
    );
  });

  it("falls back to the development site", () => {
    expect(verdict(undefined, development)).toBe("http://localhost:8789");
  });
});

describe("isFamilyOrigin", () => {
  it("accepts the family's origins, with or without a path", () => {
    expect(isFamilyOrigin("https://diagrams.meltemi.dev", production)).toBe(true);
    expect(isFamilyOrigin("https://meltemi.dev", production)).toBe(true);
    expect(isFamilyOrigin("https://id.meltemi.dev", production)).toBe(true);
  });

  it("refuses everything else, including a missing origin", () => {
    expect(isFamilyOrigin(undefined, production)).toBe(false);
    expect(isFamilyOrigin("", production)).toBe(false);
    expect(isFamilyOrigin("null", production)).toBe(false);
    expect(isFamilyOrigin("https://evil.example", production)).toBe(false);
    expect(isFamilyOrigin("https://meltemi.dev.evil.example", production)).toBe(false);
    expect(isFamilyOrigin("http://diagrams.meltemi.dev", production)).toBe(false);
    expect(isFamilyOrigin("https://diagrams.meltemi.dev:8443", production)).toBe(false);
    expect(isFamilyOrigin("not an origin", production)).toBe(false);
  });

  it("accepts the development origins only in development mode", () => {
    expect(isFamilyOrigin("http://localhost:8788", development)).toBe(true);
    expect(isFamilyOrigin("http://localhost:8788", production)).toBe(false);
    expect(isFamilyOrigin("http://localhost:9999", development)).toBe(false);
  });
});
