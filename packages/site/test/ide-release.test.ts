// `scripts/ide-release.mjs`: the IDE's latest release written into the IDE's pages at deploy time
// (specification `product-site`, "The IDE's pages tell its release as it is"; `delivery-pipeline`,
// "Deployment on every push to main"). Pure functions on fixtures, and `main` on a temporary
// folder with a stub `fetch`: nothing reaches the network.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BEGIN,
  END,
  LATEST_RELEASE_API,
  inject,
  main,
  releaseOf,
  renderBlock,
} from "../scripts/ide-release.mjs";

const PUBLISHED = {
  tag_name: "v0.2.0",
  published_at: "2026-10-24T13:05:00Z",
  draft: false,
  prerelease: false,
  html_url: "https://example.invalid/not-this",
};

const AT_REST = `<p class="release-note">Every release is on GitHub.</p>`;
const page = (body: string) =>
  `<main>\n        ${BEGIN}\n        ${body}\n        ${END}\n</main>\n`;

let folder: string | undefined;
afterEach(() => {
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = undefined;
});

/** A `public/` with both IDE pages at rest, or with `english` instead of the English page. */
function publicDir(english = page(AT_REST)) {
  folder = mkdtempSync(join(tmpdir(), "ide-release-"));
  mkdirSync(join(folder, "ide"), { recursive: true });
  mkdirSync(join(folder, "es", "ide"), { recursive: true });
  writeFileSync(join(folder, "ide", "index.html"), english);
  writeFileSync(join(folder, "es", "ide", "index.html"), page(AT_REST));
  return folder;
}

const read = (dir: string, ...path: string[]) => readFileSync(join(dir, ...path), "utf8");

/** A `fetch` that answers `body` with `status`, remembering what it was asked. */
function answering(body: unknown, status = 200) {
  const asked: { url: string; init: RequestInit | undefined }[] = [];
  const stub = (async (url: string, init?: RequestInit) => {
    asked.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { stub, asked };
}

describe("the release worth naming", () => {
  it("is a published version with its date", () => {
    expect(releaseOf(PUBLISHED)).toEqual({ tag: "v0.2.0", date: "2026-10-24" });
  });

  it("is nothing for a tag that is not a version, a draft, a pre-release or a date that is not ISO", () => {
    for (const answer of [
      { ...PUBLISHED, tag_name: "nightly" },
      { ...PUBLISHED, tag_name: "v0.2" },
      { ...PUBLISHED, tag_name: "v0.02.0" },
      { ...PUBLISHED, draft: true },
      { ...PUBLISHED, prerelease: true },
      { ...PUBLISHED, published_at: "24/10/2026" },
      { ...PUBLISHED, published_at: null },
      null,
      "v0.2.0",
    ]) {
      expect(releaseOf(answer), JSON.stringify(answer)).toBeUndefined();
    }
  });
});

describe("a published release", () => {
  it("is named in English with its version, its date and the link to its tag", () => {
    const block = renderBlock({ tag: "v0.2.0", date: "2026-10-24" }, "en");
    expect(block).toContain(
      '<a href="https://github.com/askenaz-dev/meltemi/releases/tag/v0.2.0">v0.2.0</a>',
    );
    expect(block).toContain("published 2026-10-24");
    expect(block).toContain("signed by the workflow that published it");
  });

  it("is named in Spanish the same way", () => {
    const block = renderBlock({ tag: "v0.2.0", date: "2026-10-24" }, "es");
    expect(block).toContain("Última release:");
    expect(block).toContain("publicada el 2026-10-24");
    expect(block).toContain("firmada por el workflow que la publicó");
    expect(block).toContain("https://github.com/askenaz-dev/meltemi/releases/tag/v0.2.0");
  });

  it("escapes every value it writes", () => {
    const block = renderBlock({ tag: 'v1"><script>', date: "<b>" }, "en");
    expect(block).not.toMatch(/<script>|<b>/);
    expect(block).toContain("v1&quot;&gt;&lt;script&gt;");
    expect(block).toContain("%22%3E%3Cscript%3E");
  });
});

describe("the block between the markers", () => {
  it("is replaced, and only it", () => {
    const html = page(AT_REST);
    const next = inject(html, "<p>new</p>")!;
    expect(next).toContain(`${BEGIN}\n        <p>new</p>\n        ${END}`);
    expect(next).not.toContain(AT_REST);
    expect(next.startsWith("<main>")).toBe(true);
    expect(next.endsWith("</main>\n")).toBe(true);
  });

  it("is refused when a marker is missing, repeated or out of order", () => {
    expect(inject("<main></main>", "x")).toBeUndefined();
    expect(inject(`${BEGIN}${END}${BEGIN}${END}`, "x")).toBeUndefined();
    expect(inject(`${END}${BEGIN}`, "x")).toBeUndefined();
  });
});

describe("main", () => {
  it("writes the latest release into both pages, asking GitHub with the token it is given", async () => {
    const dir = publicDir();
    const { stub, asked } = answering(PUBLISHED);
    const lines: string[] = [];
    const code = await main(dir, { fetch: stub, token: "t0ken", log: (line) => lines.push(line) });
    expect(code).toBe(0);
    expect(read(dir, "ide", "index.html")).toContain("Latest release:");
    expect(read(dir, "ide", "index.html")).toContain("releases/tag/v0.2.0");
    expect(read(dir, "es", "ide", "index.html")).toContain("Última release:");
    expect(asked).toHaveLength(1);
    expect(asked[0]!.url).toBe(LATEST_RELEASE_API);
    const headers = asked[0]!.init!.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer t0ken");
    expect(lines.join("\n")).not.toContain("t0ken");
  });

  it("keeps the pages' own sentence when GitHub does not answer, and does not fail", async () => {
    const dir = publicDir();
    const failing = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const lines: string[] = [];
    expect(await main(dir, { fetch: failing, log: (line) => lines.push(line) })).toBe(0);
    expect(read(dir, "ide", "index.html")).toBe(page(AT_REST));
    expect(lines.join("\n")).toContain("did not answer");
  });

  it("keeps the pages' own sentence when GitHub answers an error or something that is not a version", async () => {
    for (const { body, status } of [
      { body: { message: "Not Found" }, status: 404 },
      { body: { ...PUBLISHED, draft: true }, status: 200 },
      { body: { ...PUBLISHED, tag_name: "nightly" }, status: 200 },
    ]) {
      const dir = publicDir();
      const code = await main(dir, { fetch: answering(body, status).stub, log: () => {} });
      expect(code).toBe(0);
      expect(read(dir, "ide", "index.html")).toBe(page(AT_REST));
      expect(read(dir, "es", "ide", "index.html")).toBe(page(AT_REST));
      rmSync(dir, { recursive: true, force: true });
      folder = undefined;
    }
  });

  it("fails naming the page when its markers are missing, before asking GitHub or writing anything", async () => {
    const dir = publicDir("<main>no markers</main>\n");
    const { stub, asked } = answering(PUBLISHED);
    const lines: string[] = [];
    expect(await main(dir, { fetch: stub, log: (line) => lines.push(line) })).toBe(1);
    expect(asked).toHaveLength(0);
    expect(lines.join("\n")).toContain(join("ide", "index.html"));
    expect(read(dir, "es", "ide", "index.html")).toBe(page(AT_REST));
  });
});
