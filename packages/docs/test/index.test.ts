// `scripts/index.ts` and the layout of `src/ask-index.ts` (specification `docs-ask`, "The index in
// the assets"): passages, the binary layout's round trip, the batches sent to Cloudflare's API (to
// a stub), the cache, and the build without a token. No network.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DIMENSIONS,
  EMBEDDING_MODEL,
  FAKE_MODEL,
  decodeIndex,
  encodeIndex,
  fakeEmbed,
  int8Of,
  signBits,
} from "../src/ask-index.js";
import { convertSection } from "../scripts/convert.js";
import {
  buildIndex,
  cachedEmbedder,
  cloudflareEmbedder,
  embedderFor,
  fakeEmbedder,
  passagesOf,
  type Embedder,
} from "../scripts/index.js";
import { fixtureSources } from "../scripts/sources.js";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const pages = fixtureSources().flatMap((tree) => convertSection(tree).pages);

describe("the passages", () => {
  it("cuts a page at its headings, each passage a heading and its paragraphs", () => {
    const stories = pages.find((p) => p.lang === "en" && p.id === "language/stories")!;
    const passages = passagesOf(stories.title, stories.body);
    expect(passages.map((p) => p.heading)).toEqual(["Stories", "Actions", "Exports"]);
    expect(passages[2]!.text).toContain("To export a story as a video");
    expect(passages.every((p) => p.text.length <= 1500)).toBe(true);
  });

  it("keeps a passage under 1,500 characters, the next one starting with the last paragraph", () => {
    const paragraph = (n: number) => `Paragraph ${n} ${"word ".repeat(120)}`.trim();
    const body = Array.from({ length: 6 }, (_, i) => paragraph(i + 1)).join("\n\n");
    const passages = passagesOf("Long", body);
    expect(passages.length).toBeGreaterThan(1);
    expect(passages.every((p) => p.text.length <= 1500)).toBe(true);
    const first = passages[0]!.text.split("\n\n");
    expect(passages[1]!.text.startsWith(first.at(-1)!)).toBe(true);
  });

  it("reads no picture, HTML or link address into a passage", () => {
    const [passage] = passagesOf(
      "T",
      `See [the player](/diagrams/player/) <a href="/x/">here</a>.\n\n<figure class="meltemi-picture" data-pagefind-ignore>\n<svg><text>client</text></svg>\n</figure>\n`,
    );
    expect(passage!.text).toBe("See the player here.");
  });
});

describe("the file", () => {
  it("round-trips the header, the texts and both forms of every vector", () => {
    const vectors = [fakeEmbed("export a story as a video"), fakeEmbed("install the command line")];
    const bytes = encodeIndex({
      model: FAKE_MODEL,
      dimensions: DIMENSIONS,
      pages: [
        { section: "diagrams", title: "Stories", url: "/diagrams/language/stories/", lang: "en" },
      ],
      passages: [
        { page: 0, text: "Stories\nTo export a story… ñ", vector: vectors[0]! },
        { page: 0, text: "Install", vector: vectors[1]! },
      ],
    });
    const index = decodeIndex(bytes);
    expect(index).toMatchObject({
      model: FAKE_MODEL,
      dimensions: 1024,
      count: 2,
      passagePages: [0, 0],
    });
    expect(index.pages[0]!.url).toBe("/diagrams/language/stories/");
    expect(index.text(0)).toBe("Stories\nTo export a story… ñ");
    expect(index.text(1)).toBe("Install");
    expect([...index.signs.subarray(32, 64)]).toEqual([...signBits(vectors[1]!)]);
    expect([...index.vectors.subarray(0, 1024)]).toEqual([...int8Of(vectors[0]!)]);
    expect(Math.max(...index.vectors.subarray(0, 1024).map(Math.abs))).toBe(127);
  });

  it("reads a file that does not start at a word boundary of its buffer", () => {
    const bytes = encodeIndex({
      model: FAKE_MODEL,
      dimensions: 32,
      pages: [],
      passages: [{ page: 0, text: "x", vector: new Float32Array(32).fill(1) }],
    });
    const shifted = new Uint8Array(bytes.length + 1);
    shifted.set(bytes, 1);
    expect(decodeIndex(shifted.subarray(1)).text(0)).toBe("x");
    expect(() => decodeIndex(new Uint8Array(16))).toThrow(/not an index/);
  });
});

describe("the embeddings", () => {
  it("asks Cloudflare's API in batches of fifty, with the token, for the multilingual model", async () => {
    const calls: { url: string; auth: string | null; count: number }[] = [];
    const stub = (async (url: string, init: RequestInit) => {
      const texts = (JSON.parse(String(init.body)) as { text: string[] }).text;
      calls.push({
        url,
        auth: new Headers(init.headers).get("authorization"),
        count: texts.length,
      });
      const data = texts.map((t) => Array.from(fakeEmbed(t)));
      return new Response(
        JSON.stringify({ success: true, result: { shape: [texts.length, 1024], data } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const embedder = cloudflareEmbedder({
      account: "0123456789abcdef0123456789abcdef",
      token: "test-token",
      fetch: stub,
    });
    const texts = Array.from({ length: 120 }, (_, i) => `text ${i}`);
    const vectors = await embedder.embed(texts);
    expect(vectors).toHaveLength(120);
    expect(calls.map((c) => c.count)).toEqual([50, 50, 20]);
    expect(calls[0]!.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/run/@cf/baai/bge-m3",
    );
    expect(calls[0]!.auth).toBe("Bearer test-token");
  });

  it("fails naming Workers AI's answer when a batch is refused", async () => {
    const stub = (async () =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 4006, message: "daily free allocation used" }],
        }),
        { status: 429 },
      )) as unknown as typeof fetch;
    const embedder = cloudflareEmbedder({ account: "a", token: "t", fetch: stub });
    await expect(embedder.embed(["x"])).rejects.toThrow(/429.*4006 daily free allocation used/);
  });

  it("keeps every vector in the cache and asks only for the passages that changed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "meltemi-embeddings-"));
    dirs.push(dir);
    let asked = 0;
    const counting: Embedder = {
      model: "counting",
      embed: async (texts) => ((asked += texts.length), texts.map((t) => fakeEmbed(t))),
    };
    const first = cachedEmbedder(counting, dir);
    await first.embed(["a b", "c d"]);
    const second = cachedEmbedder(counting, dir);
    const vectors = await second.embed(["a b", "c d", "e f"]);
    expect(asked).toBe(3);
    expect([...vectors[0]!]).toEqual([...fakeEmbed("a b")]);
  });

  it("points texts that share words the same way, deterministically", () => {
    const dot = (a: Float32Array, b: Float32Array) => a.reduce((sum, v, i) => sum + v * b[i]!, 0);
    const question = fakeEmbed("How do I export a story as a video?");
    expect([...question]).toEqual([...fakeEmbed("How do I export a story as a video?")]);
    expect(
      dot(question, fakeEmbed("To export a story as a video, give the story")),
    ).toBeGreaterThan(dot(question, fakeEmbed("Install the command line and draw a diagram")));
  });
});

describe("the index of a build", () => {
  it("embeds every page but the notice pages, with the fixture's offline embedder", async () => {
    const report = await buildIndex(pages, fakeEmbedder());
    const index = decodeIndex(report.bytes);
    expect(index.model).toBe(FAKE_MODEL);
    expect(index.pages.some((p) => p.url === "/diagrams/language/stories/")).toBe(true);
    expect(
      index.pages.some((p) => p.url === "/ide/quickstart/"),
      "a notice page",
    ).toBe(false);
    expect(index.count).toBe(report.passages);
    expect(index.count).toBeGreaterThan(index.pages.length);
  });

  it("writes a header with no passage when the build has no token, naming the production model", async () => {
    expect(embedderFor(undefined, "release", {})).toBeUndefined();
    expect(embedderFor(undefined, "local", { CLOUDFLARE_API_TOKEN: "t" })).toBeUndefined();
    expect(
      embedderFor(undefined, "release", { CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" })
        ?.model,
    ).toBe(EMBEDDING_MODEL);
    expect(embedderFor(undefined, "fixture", {})?.model).toBe(FAKE_MODEL);
    const report = await buildIndex(pages, undefined);
    const index = decodeIndex(report.bytes);
    expect(index).toMatchObject({ model: EMBEDDING_MODEL, count: 0, pages: [] });
  });
});
