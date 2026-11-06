// The portal as a reader gets it (specification `docs-portal`): the fixture built once, by the
// build itself in a child process, into a temporary folder, and every check read from its files.
// The fixture build draws its picture with the installed command line and embeds with the offline
// embedder: nothing reaches the network.

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { constants, setPriority } from "node:os";
import { join, relative, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PACKAGE } from "../scripts/sources.js";
import { PORTAL_TOKENS, SITE_TOKENS, portalTokens } from "../scripts/tokens.js";
import { collectTokens } from "../../site/scripts/tokens.mjs";
import { decodeIndex } from "../src/ask-index.js";

let dist: string;
let output: string;

beforeAll(async () => {
  // Inside the package, not the system's temporary folder: Astro moves its files into the output
  // with a rename, which fails across drives (a Windows runner checks out on D: and keeps its
  // temporary folder on C:).
  const builds = join(PACKAGE, ".test-builds");
  mkdirSync(builds, { recursive: true });
  dist = mkdtempSync(join(builds, "portal-"));
  // A previously public internal route must disappear when the portal is rebuilt.
  const retired = join(dist, "diagrams", "decisions", "stale");
  mkdirSync(retired, { recursive: true });
  writeFileSync(join(retired, "index.html"), "Old internal decision");
  // The build runs beside the other test files: at a low priority, so their timings stay theirs.
  const child = spawn(
    process.execPath,
    ["--import", "tsx", join(PACKAGE, "scripts", "build.ts"), "--from", "fixture", "--out", dist],
    {
      cwd: PACKAGE,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CLOUDFLARE_API_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "" },
    },
  );
  try {
    if (child.pid) setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // A platform that refuses keeps the normal priority.
  }
  const chunks: string[] = [];
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
  const status = await new Promise<number | null>((resolve) => child.on("close", resolve));
  output = chunks.join("");
  if (status !== 0) throw new Error(`the fixture build failed (${status}): ${output}`);
}, 300_000);
afterAll(() => {
  if (dist) rmSync(dist, { recursive: true, force: true });
});

/** Every file of the build, by its path with `/`. */
function files(dir = dist): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [relative(dist, full).split(sep).join("/")];
  });
}
const pages = () => files().filter((f) => f.endsWith(".html"));
const html = (url: string) =>
  readFileSync(join(dist, url === "/404.html" ? "404.html" : `${url.slice(1)}index.html`), "utf8");
const text = (markup: string) =>
  markup
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const urlOf = (file: string) =>
  file === "404.html" ? "/404.html" : `/${file.replace(/index\.html$/, "")}`;
const twinOf = (url: string) =>
  url.startsWith("/es/") || url === "/es/" ? url.replace(/^\/es/, "") || "/" : `/es${url}`;

/** The labels and addresses of a page's sidebar, in order. */
function sidebar(markup: string): { label: string; href: string }[] {
  const nav =
    /<sl-sidebar-state-persist[\s\S]*?<\/sl-sidebar-state-persist>/.exec(markup)?.[0] ?? "";
  return [...nav.matchAll(/<a href="([^"]+)"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/g)].map((m) => ({
    href: m[1]!,
    label: m[2]!.trim(),
  }));
}

/**
 * What a page loads from another host: a script, stylesheet, image, font or media whose address is
 * absolute, and `url()`s of inline styles. Each problem names the page and the address.
 */
export function externalResources(markup: string, url: string): string[] {
  const problems: string[] = [];
  for (const m of markup.matchAll(
    /<(script|link|img|source|video|audio|iframe|embed|object|track|image|use)\b([^>]*)>/gi,
  )) {
    const tag = m[1]!.toLowerCase();
    const attrs = m[2]!;
    if (tag === "link" && /\brel="(alternate|canonical|sitemap)"/.test(attrs)) continue;
    for (const a of attrs.matchAll(/\b(src|href|srcset|poster|data|xlink:href)="([^"]*)"/g)) {
      if (tag === "a") continue;
      const value = a[2]!.trim().split(/\s+/)[0]!;
      if (/^(https?:)?\/\//i.test(value)) problems.push(`${url}: <${tag}> loads ${value}`);
    }
  }
  for (const m of markup.matchAll(/url\(\s*['"]?((?:https?:)?\/\/[^'")\s]+)/gi))
    problems.push(`${url}: url() of ${m[1]}`);
  return problems;
}

describe("the build", () => {
  it("prints the mode it builds from", () => {
    expect(output).toContain("Building the portal from fixture (as asked)");
    expect(output).toMatch(/pictures: 1 drawn from 4 text fences/);
  });
});

describe("one portal, three sections, two languages", () => {
  it("serves the home and the three sections in both languages", () => {
    for (const url of ["/", "/diagrams/", "/ide/", "/web/"]) {
      expect(existsSync(join(dist, url.slice(1), "index.html")), url).toBe(true);
      expect(existsSync(join(dist, twinOf(url).slice(1), "index.html")), twinOf(url)).toBe(true);
    }
  });

  it("gives every page a title, its language, a twin and a link to the twin", () => {
    const problems: string[] = [];
    for (const file of pages().filter((f) => f !== "404.html")) {
      const url = urlOf(file);
      const markup = html(url);
      const lang = url.startsWith("/es/") || url === "/es/" ? "es" : "en";
      if (!/<title>[^<]+<\/title>/.test(markup)) problems.push(`${url}: no <title>`);
      if (!markup.includes(`<html lang="${lang}"`))
        problems.push(`${url}: not <html lang="${lang}">`);
      if (!existsSync(join(dist, twinOf(url).slice(1), "index.html")))
        problems.push(`${url}: no twin ${twinOf(url)}`);
      if (!markup.includes(`class="portal-lang" href="${twinOf(url)}"`))
        problems.push(`${url}: no link to ${twinOf(url)}`);
      const h1 = markup.match(/<h1\b/g)?.length ?? 0;
      if (h1 !== 1) problems.push(`${url}: ${h1} <h1>`);
    }
    expect(problems).toEqual([]);
  });

  it("names the three products on the home and links their sections, in each language", () => {
    for (const [url, prefix] of [
      ["/", ""],
      ["/es/", "/es"],
    ] as const) {
      const markup = html(url);
      for (const [section, name] of [
        ["diagrams", "Meltemi Diagrams"],
        ["ide", "Meltemi IDE"],
        ["web", "Meltemi Web"],
      ]) {
        expect(text(markup), `${url} names ${name}`).toContain(name);
        expect(markup, `${url} links ${prefix}/${section}/`).toContain(
          `href="${prefix}/${section}/"`,
        );
      }
    }
  });

  it("serves a guide in both languages, each naming its section's release in the footer", () => {
    const en = html("/diagrams/player/");
    const es = html("/es/diagrams/player/");
    expect(text(en)).toContain("The HTML player");
    expect(text(es)).toContain("El reproductor HTML");
    expect(en).toContain('class="portal-lang" href="/es/diagrams/player/" hreflang="es"');
    expect(es).toContain('class="portal-lang" href="/diagrams/player/" hreflang="en"');
    expect(text(en)).toContain("From Meltemi Diagrams v1.11.0");
    expect(text(es)).toContain("Desde Meltemi Diagrams v1.11.0");
    expect(en).toContain(
      'href="https://github.com/askenaz-dev/meltemi-diagrams/releases/tag/v1.11.0"',
    );
    expect(en).toContain(
      'href="https://github.com/askenaz-dev/meltemi-diagrams/blob/v1.11.0/docs/player.md"',
    );
    expect(text(html("/ide/quickstart/"))).toContain("From Meltemi IDE v0.2.29");
  });

  it("writes the guide in Spanish only and, in English, its title, the sentence and a link", () => {
    const spanish = text(html("/es/ide/quickstart/"));
    expect(spanish).toContain("Inicio rápido");
    expect(spanish).toContain("De los instaladores de la release");
    const english = html("/ide/quickstart/");
    expect(text(english)).toContain("Inicio rápido");
    expect(text(english)).toContain("This guide exists in Spanish only.");
    expect(english).toContain('href="/es/ide/quickstart/"');
    expect(text(english)).not.toContain("De los instaladores");
  });

  it("links pages to portal routes, files outside docs/ to GitHub, and carries the media", () => {
    const player = html("/diagrams/player/");
    expect(player).toContain('href="/diagrams/language/stories/#exports"');
    expect(player).toContain(
      'href="https://github.com/askenaz-dev/meltemi-diagrams/blob/v1.11.0/CHANGELOG.md"',
    );
    expect(player).toContain('src="/diagrams/media/editing-demo.gif"');
    expect(existsSync(join(dist, "diagrams", "media", "editing-demo.gif"))).toBe(true);
    expect(html("/diagrams/language/stories/")).toMatch(/<h2 id="exports"/);
  });
});

describe("the sidebar follows the index", () => {
  it("reads Getting started, Features, Stories, then The command line, and holds only the section", () => {
    const labels = sidebar(html("/diagrams/player/")).map((l) => l.label);
    expect(labels).toEqual([
      "Overview",
      "Getting started",
      "Features",
      "Stories",
      "The command line",
      "The HTML player",
    ]);
    const spanish = sidebar(html("/es/diagrams/player/"));
    expect(spanish.map((l) => l.label)).toEqual([
      "Resumen",
      "Primeros pasos",
      "Funciones",
      "Historias",
      "The command line",
      "El reproductor HTML",
    ]);
    expect(spanish.every((l) => l.href.startsWith("/es/diagrams/"))).toBe(true);
    expect(sidebar(html("/ide/")).map((l) => l.href)).toEqual([
      "/ide/",
      "/ide/quickstart/",
      "/ide/local-models/",
    ]);
  });

  it("does not repeat a page's heading in its body", () => {
    const markup = html("/diagrams/player/");
    expect(markup.match(/The HTML player<\/h1>/g)).toHaveLength(1);
    expect(markup).not.toMatch(/<h2[^>]*>The HTML player/);
  });
});

describe("pictures from the code", () => {
  it("shows the purchase story's fence and, under it, a figure with an svg of the client and api boxes", () => {
    const markup = html("/diagrams/language/stories/");
    const figures = [
      ...markup.matchAll(/<figure class="meltemi-picture"[^>]*>([\s\S]*?)<\/figure>/g),
    ];
    expect(figures).toHaveLength(1);
    const svg = figures[0]![1]!;
    expect(svg).toMatch(/^\s*<svg role="img" aria-label="Checkout, a diagram of Stories"/);
    expect(svg).toContain('data-id="client"');
    expect(svg).toContain('data-id="api"');
    expect(markup.indexOf("story purchase for checkout")).toBeLessThan(
      markup.indexOf('<figure class="meltemi-picture"'),
    );
    expect(markup).toContain("reveal client, api over 800ms");
    expect(html("/es/diagrams/language/stories/")).not.toContain("meltemi-picture");
  });
});

describe("search in the reader's browser", () => {
  it("publishes no internal source page or passage in either language", () => {
    expect(pages().some((p) => /\/(?:decisions|qa)\//.test(`/${p}`))).toBe(false);
    const index = decodeIndex(readFileSync(join(dist, "ask", "index.bin")));
    expect(index.pages.some((p) => /\/(?:decisions|qa)\//.test(p.url))).toBe(false);
    for (let i = 0; i < index.count; i++) {
      expect(index.text(i)).not.toMatch(/parser-architecture-only|internal-qa-only/);
    }
    expect(html("/web/account/")).toContain(
      'href="https://github.com/askenaz-dev/meltemi-web/blob/main/docs/decisions/0001-family-repositories.md"',
    );
  });

  it("ships Pagefind's index in both languages, made at build", () => {
    for (const file of [
      "pagefind/pagefind.js",
      "pagefind/pagefind-ui.js",
      "pagefind/pagefind-entry.json",
    ]) {
      expect(existsSync(join(dist, file)), file).toBe(true);
    }
    const entry = JSON.parse(
      readFileSync(join(dist, "pagefind", "pagefind-entry.json"), "utf8"),
    ) as { languages: Record<string, unknown> };
    expect(Object.keys(entry.languages).sort()).toEqual(["en", "es"]);
  });

  it("indexes the guides and leaves the notice pages and the home out", () => {
    expect(html("/diagrams/language/stories/")).toContain("data-pagefind-body");
    expect(html("/ide/quickstart/")).not.toContain("data-pagefind-body");
    expect(html("/")).not.toContain("data-pagefind-body");
  });
});

describe("headers, no tracking and no external resource", () => {
  const headers = () => readFileSync(join(dist, "_headers"), "utf8");
  const policy = () => /Content-Security-Policy: (.+)/.exec(headers())![1]!;

  it("allows only the portal's own origin, WebAssembly and data images, and no framing", () => {
    expect(policy()).toMatch(
      /^default-src 'none'; script-src 'self' 'wasm-unsafe-eval'( 'sha256-[A-Za-z0-9+/=]+')*; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'$/,
    );
    for (const header of [
      "Referrer-Policy: strict-origin-when-cross-origin",
      "X-Content-Type-Options: nosniff",
      "Permissions-Policy: camera=(), microphone=(), geolocation=()",
      "Strict-Transport-Security: max-age=31536000",
    ]) {
      expect(headers()).toContain(header);
    }
    expect(headers()).not.toMatch(/set-cookie/i);
  });

  it("lists the hash of every inline script any page runs", () => {
    const missing: string[] = [];
    for (const file of pages()) {
      const markup = readFileSync(join(dist, file), "utf8");
      for (const m of markup.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
        const hash = `'sha256-${createHash("sha256").update(m[1]!, "utf8").digest("base64")}'`;
        if (!policy().includes(hash)) missing.push(`${urlOf(file)}: ${m[1]!.slice(0, 60)}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("loads nothing from another host, sets no cookie and carries no analytics", () => {
    const problems = files()
      .filter((f) => f.endsWith(".html") || f.endsWith(".css"))
      .flatMap((f) => externalResources(readFileSync(join(dist, f), "utf8"), `/${f}`));
    expect(problems).toEqual([]);
    for (const file of pages()) {
      const markup = readFileSync(join(dist, file), "utf8");
      expect(markup, file).not.toMatch(
        /document\.cookie|googletagmanager|plausible|analytics\.js|gtag\(/,
      );
      for (const m of markup.matchAll(/<script[^>]*\bsrc="([^"]+)"/g))
        expect(m[1], file).toMatch(/^\/(_astro|pagefind)\//);
    }
  });

  it("names the page and the address of an external script", () => {
    expect(
      externalResources(
        '<script type="module" src="https://example.com/x.js"></script>',
        "/diagrams/player/",
      ),
    ).toEqual(["/diagrams/player/: <script> loads https://example.com/x.js"]);
  });
});

describe("the family's looks and motion", () => {
  it("keeps the tokens equal, name and value, to the site's, as the script writes them", () => {
    const site = readFileSync(SITE_TOKENS, "utf8");
    expect(readFileSync(PORTAL_TOKENS, "utf8"), "run pnpm --filter @meltemi/docs tokens").toBe(
      portalTokens(site),
    );
    const mine = collectTokens(readFileSync(PORTAL_TOKENS, "utf8")) as Map<string, string[]>;
    const theirs = collectTokens(site) as Map<string, string[]>;
    expect([...mine.keys()].sort()).toEqual([...theirs.keys()].sort());
    for (const [name, values] of theirs)
      expect(new Set(mine.get(name)), name).toEqual(new Set(values));
    expect(theirs.size).toBeGreaterThanOrEqual(41);
  });

  it("builds the tokens and the family's brand into the portal", () => {
    const css = files()
      .filter((f) => f.startsWith("_astro/") && f.endsWith(".css"))
      .map((f) => readFileSync(join(dist, f), "utf8"))
      .join("\n");
    expect(css).toContain("--mel-aegean:#2563eb");
    expect(css).toContain("--sl-color-accent:var(--accent)");
    for (const file of [
      "media/meltemi-lockup-light.svg",
      "media/meltemi-lockup-dark.svg",
      "media/meltemi-mark-gradient.svg",
      "media/sea-home-light.svg",
      "media/sea-home-dark.svg",
    ]) {
      expect(existsSync(join(dist, file)), file).toBe(true);
    }
    expect(readFileSync(join(dist, "media", "meltemi-lockup-light.svg"))).toEqual(
      readFileSync(join(PACKAGE, "..", "site", "public", "media", "meltemi-lockup-light.svg")),
    );
  });

  it("stops every transition and animation under reduced motion", () => {
    const css = readFileSync(join(PACKAGE, "src", "styles", "portal.css"), "utf8");
    const reduced =
      /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*)\}\s*$/.exec(css)?.[1] ?? "";
    expect(reduced).toContain(".ask-dialog");
    expect(reduced).toMatch(/transition-duration: 0s !important/);
    expect(reduced).toMatch(/animation-duration: 0s !important/);
  });

  it("offers Ask the docs beside the search, hidden until its script runs", () => {
    const markup = html("/diagrams/player/");
    expect(markup).toContain("<meltemi-ask");
    expect(markup).toMatch(/<button type="button" class="ask-open" data-open hidden/);
    expect(existsSync(join(dist, "ask", "index.bin"))).toBe(true);
  });

  it("keeps public account markup generic and owner navigation hidden until private discovery", () => {
    for (const [url, lang] of [
      ["/diagrams/player/", "en"],
      ["/es/diagrams/player/", "es"],
    ]) {
      const markup = html(url!);
      expect(markup).toContain("<meltemi-account");
      expect(markup).toMatch(/<a[^>]*data-account-admin[^>]*hidden/);
      expect(markup).toMatch(/<details[^>]*data-account-details[^>]*hidden/);
      for (const path of ["/admin/", "/account/profile", "/account/preferences", "/account"]) {
        expect(markup).toContain(`https://id.meltemi.dev${path}?lang=${lang}`);
      }
      expect(markup).toContain(`return_to=${encodeURIComponent(`https://docs.meltemi.dev${url}`)}`);
      expect(markup).not.toMatch(/(?:authenticated|owner)(?:&quot;|")\s*:\s*true/);
    }
  });
});
