// `src/ask.ts` and `src/worker.ts` (specification `docs-ask`): the route in Node, on the fixture's
// index, with a fake embedder, a fake model and a fake limiter; the Worker with fake bindings and a
// `fetch` that fails the test if anything reaches for the network.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DIMENSIONS,
  EMBEDDING_MODEL,
  FAKE_MODEL,
  decodeIndex,
  encodeIndex,
  fakeEmbed,
  rank,
  signBits,
  type AskIndex,
} from "../src/ask-index.js";
import {
  ask,
  ASK_MODEL,
  cleanAnswer,
  fakeAnswer,
  QUESTION_LIMIT,
  type AskDeps,
  type Prompt,
} from "../src/ask.js";
import { forgetIndex, type Env } from "../src/bindings.js";
import worker from "../src/worker.js";
import { convertSection } from "../scripts/convert.js";
import { buildIndex, fakeEmbedder, type Embedder } from "../scripts/index.js";
import { fixtureSources } from "../scripts/sources.js";

const pages = fixtureSources().flatMap((tree) => convertSection(tree).pages);
let fixtureIndex: AskIndex;
let productionBytes: Uint8Array;

beforeAll(async () => {
  fixtureIndex = decodeIndex((await buildIndex(pages, fakeEmbedder())).bytes);
  // The same passages, labelled with the production model, for the Worker with fake bindings.
  const asProduction: Embedder = { model: EMBEDDING_MODEL, embed: fakeEmbedder().embed };
  productionBytes = (await buildIndex(pages, asProduction)).bytes;
});

afterEach(() => {
  vi.restoreAllMocks();
  forgetIndex();
});

interface Calls {
  embed: string[];
  answer: Prompt[];
  limit: string[];
}

function deps(overrides: Partial<AskDeps> = {}): { deps: AskDeps; calls: Calls } {
  const calls: Calls = { embed: [], answer: [], limit: [] };
  return {
    calls,
    deps: {
      model: FAKE_MODEL,
      embed: async (text) => (calls.embed.push(text), fakeEmbed(text)),
      answer: async (prompt) => (calls.answer.push(prompt), fakeAnswer(prompt)),
      limit: async (key) => (calls.limit.push(key), true),
      index: async () => fixtureIndex,
      ...overrides,
    },
  };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://docs.meltemi.dev/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const QUESTION = "How do I export a story as a video?";

describe("a question answered from the pages", () => {
  it("answers with [1] and the Stories page as the first source, at its portal address", async () => {
    const { deps: d, calls } = deps();
    const response = await ask(post({ question: QUESTION, lang: "en" }), d);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as {
      answer: string;
      sources: { n: number; title: string; url: string; lang: string }[];
    };
    expect(body.answer).toContain("[1]");
    expect(body.sources[0]).toEqual({
      n: 1,
      title: "Stories",
      url: "/diagrams/language/stories/",
      lang: "en",
    });
    expect(calls.embed).toEqual([QUESTION]);
    expect(calls.answer).toHaveLength(1);
    expect(calls.answer[0]!.system).toContain("[n]");
    expect(calls.answer[0]!.system).toContain("The documentation does not cover this.");
    expect(calls.answer[0]!.user).toContain("Question: How do I export a story as a video?");
    expect(calls.answer[0]!.user).toContain("[1]\nStories: Exports\nTo export a story as a video");
  });

  it("asks in Spanish and is told the Spanish sentence for what is not covered", async () => {
    const { deps: d, calls } = deps();
    const response = await ask(
      post({ question: "¿Cómo exporto una historia como video?", lang: "es" }),
      d,
    );
    expect(response.status).toBe(200);
    expect(calls.answer[0]!.system).toContain("La documentación no cubre esto.");
    const body = (await response.json()) as { sources: { url: string }[] };
    expect(body.sources[0]!.url).toBe("/es/diagrams/language/stories/");
  });

  it("says the documentation does not cover a question its passages do not speak of, with no source and no model", async () => {
    const { deps: d, calls } = deps();
    const response = await ask(
      post({ question: "Which bakery sells sourdough bread on Tuesdays?", lang: "en" }),
      d,
    );
    expect(await response.json()).toEqual({
      answer: "The documentation does not cover this.",
      sources: [],
    });
    expect(calls.answer).toHaveLength(0);
  });

  it("drops a model's answer that is the not-covered sentence to no source, and citations that do not exist", async () => {
    const { deps: d } = deps({ answer: async () => "La documentación no cubre esto." });
    expect(await (await ask(post({ question: QUESTION, lang: "es" }), d)).json()).toEqual({
      answer: "La documentación no cubre esto.",
      sources: [],
    });
    expect(cleanAnswer("<think>x</think>See [2] and [9].", 2)).toEqual({
      answer: "See [2] and .",
      cited: new Set([2]),
    });
  });
});

describe("what the route refuses", () => {
  it("refuses a question of 501 characters with 400 naming the limit, calling neither the embedder nor the model", async () => {
    const { deps: d, calls } = deps();
    const response = await ask(post({ question: "x".repeat(QUESTION_LIMIT + 1), lang: "en" }), d);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { reason: string; message: string };
    expect(body.reason).toBe("question");
    expect(body.message).toContain("the limit is 500");
    expect(calls.embed).toEqual([]);
    expect(calls.answer).toEqual([]);
  });

  it.each([
    ["an empty question", { question: "   ", lang: "en" }, "question"],
    ["another language", { question: "Hi", lang: "fr" }, "lang"],
    ["a field more", { question: "Hi", lang: "en", user: "me" }, "fields"],
    ["a list", "[1]", "json"],
    ["not JSON", "question=hi", "json"],
  ])("refuses %s with 400 and its reason", async (_, body, reason) => {
    const { deps: d, calls } = deps();
    const response = await ask(post(body), d);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { reason: string }).reason).toBe(reason);
    expect(calls.embed).toEqual([]);
  });

  it("refuses another method, another origin and a body that is not JSON", async () => {
    const { deps: d } = deps();
    const get = await ask(new Request("https://docs.meltemi.dev/api/ask"), d);
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    expect(
      (await ask(post({ question: "Hi", lang: "en" }, { Origin: "https://evil.example" }), d))
        .status,
    ).toBe(403);
    expect(
      (await ask(post({ question: "Hi", lang: "en" }, { "Content-Type": "text/plain" }), d)).status,
    ).toBe(400);
    expect(
      (await ask(post({ question: "Hi", lang: "en" }, { Origin: "https://docs.meltemi.dev" }), d))
        .status,
    ).toBe(200);
  });
});

describe("the limits and the allowance", () => {
  it("answers 429 when the address is over its limit, calling neither the embedder nor the model", async () => {
    const { deps: d, calls } = deps({ limit: async () => false });
    const response = await ask(post({ question: QUESTION, lang: "en" }), d);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(calls.embed).toEqual([]);
    expect(calls.answer).toEqual([]);
  });

  it("keys the limiter by a hash of the address, never the address", async () => {
    const { deps: d, calls } = deps();
    await ask(post({ question: QUESTION, lang: "en" }), d);
    expect(calls.limit[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(calls.limit[0]).not.toContain("203.0.113.7");
  });

  it("answers 503 allowance when the model refuses, or the embedder", async () => {
    for (const override of [
      { answer: async () => Promise.reject(new Error("4006: daily free allocation used")) },
      { embed: async () => Promise.reject(new Error("4006")) },
    ] satisfies Partial<AskDeps>[]) {
      const response = await ask(post({ question: QUESTION, lang: "en" }), deps(override).deps);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ reason: "allowance" });
    }
  });

  it("answers 503 allowance for an index with no passage, the build that had no Workers AI", async () => {
    const empty = decodeIndex(
      encodeIndex({ model: FAKE_MODEL, dimensions: DIMENSIONS, pages: [], passages: [] }),
    );
    const { deps: d, calls } = deps({ index: async () => empty });
    const response = await ask(post({ question: QUESTION, lang: "en" }), d);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ reason: "allowance" });
    expect(calls.embed).toEqual([]);
  });

  it("answers 503 index for an index of a model that is not the Worker's", async () => {
    const other = decodeIndex(
      encodeIndex({
        model: "other/model",
        dimensions: DIMENSIONS,
        pages: [],
        passages: [{ page: 0, text: "x", vector: fakeEmbed("x") }],
      }),
    );
    const response = await ask(
      post({ question: QUESTION, lang: "en" }),
      deps({ index: async () => other }).deps,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ reason: "index" });
  });
});

describe("nothing of a question is kept", () => {
  it("logs nothing that carries the question's text, on any path", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => {}),
    );
    const secret = "What is the passphrase of the owner's kayak?";
    await ask(post({ question: secret, lang: "en" }), deps().deps);
    await ask(
      post({ question: secret, lang: "en" }),
      deps({ answer: async () => Promise.reject(new Error(secret)) }).deps,
    );
    const env: Env = {
      ASSETS: { fetch: async () => Promise.reject(new Error(secret)) },
      AI: { run: async () => Promise.reject(new Error(secret)) },
    };
    const broken = await worker.fetch(post({ question: secret, lang: "en" }), env);
    expect(broken.status).toBe(503);
    const text = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join("\n");
    expect(text).not.toContain("passphrase");
  });

  it("calls the AI binding twice, one embedding and one answer, and fetches no other host", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("the route reached for the network");
    });
    const runs: { model: string; input: unknown }[] = [];
    const env: Env = {
      ASSETS: {
        fetch: async (request) =>
          new URL(request.url).pathname === "/ask/index.bin"
            ? new Response(productionBytes.slice())
            : new Response("nope", { status: 404 }),
      },
      AI: {
        async run(model, input) {
          runs.push({ model, input });
          if (model === EMBEDDING_MODEL)
            return {
              shape: [1, 1024],
              data: [Array.from(fakeEmbed((input as { text: string[] }).text[0]!))],
            };
          return { response: "Give the story and a video format [1]." };
        },
      },
      ASK_LIMIT: { limit: async () => ({ success: true }) },
    };
    const response = await worker.fetch(post({ question: QUESTION, lang: "en" }), env);
    expect(response.status).toBe(200);
    expect(runs.map((r) => r.model)).toEqual([EMBEDDING_MODEL, ASK_MODEL]);
    expect(runs[0]!.input).toEqual({ text: [QUESTION] });
    expect(runs[1]!.input).toMatchObject({
      max_completion_tokens: 400,
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(runs[1]!.input).not.toHaveProperty("max_tokens");
    expect(network).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      answer: "Give the story and a video format [1].",
      sources: [{ n: 1, title: "Stories" }],
    });
  });

  it("reads an empty answer, as a thinking model cut at its limit gives, as no answer", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const env: Env = {
      ASSETS: {
        fetch: async (request) =>
          new URL(request.url).pathname === "/ask/index.bin"
            ? new Response(productionBytes.slice())
            : new Response("nope", { status: 404 }),
      },
      AI: {
        async run(model, input) {
          if (model === EMBEDDING_MODEL)
            return {
              shape: [1, 1024],
              data: [Array.from(fakeEmbed((input as { text: string[] }).text[0]!))],
            };
          return { choices: [{ message: { content: null }, finish_reason: "length" }] };
        },
      },
      ASK_LIMIT: { limit: async () => ({ success: true }) },
    };
    const response = await worker.fetch(post({ question: QUESTION, lang: "en" }), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ reason: "allowance" });
    expect(errors.mock.calls.flat().map(String)).toEqual(["ask: Workers AI gave no answer"]);
    errors.mockRestore();
  });

  it("serves every other address from the assets", async () => {
    const env: Env = {
      ASSETS: { fetch: async (request) => new Response(new URL(request.url).pathname) },
    };
    expect(
      await (
        await worker.fetch(new Request("https://docs.meltemi.dev/diagrams/player/"), env)
      ).text(),
    ).toBe("/diagrams/player/");
  });

  it("answers with the offline stubs in wrangler dev's stub mode", async () => {
    const fixtureBytes = (await buildIndex(pages, fakeEmbedder())).bytes;
    const env: Env = {
      ASSETS: { fetch: async () => new Response(fixtureBytes.slice()) },
      ASK_STUB: "fixture",
    };
    const response = await worker.fetch(post({ question: QUESTION, lang: "en" }), env);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { sources: { title: string }[] }).sources[0]!.title).toBe(
      "Stories",
    );
  });
});

describe("the ranking", () => {
  /** A seeded generator, so the ten thousand passages are the same on every run. */
  function random(seed: number) {
    return () => {
      seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) | 0;
      return ((seed >>> 0) / 4294967296) * 2 - 1;
    };
  }

  it("returns the eight best int8 scores among the fifty best by sign bits, ten thousand passages in under 5 ms", () => {
    const next = random(7);
    const count = 10_000;
    const vectors = Array.from({ length: count }, () =>
      Float32Array.from({ length: DIMENSIONS }, next),
    );
    const index = decodeIndex(
      encodeIndex({
        model: FAKE_MODEL,
        dimensions: DIMENSIONS,
        pages: [],
        passages: vectors.map((vector) => ({ page: 0, text: "", vector })),
      }),
    );
    const query = Float32Array.from({ length: DIMENSIONS }, next);

    // The reference: every distance, the fifty smallest (ties by position), rescored in full.
    const q = signBits(query);
    const popcount = (x: number) => x.toString(2).replace(/0/g, "").length;
    const distance = (i: number) => {
      let d = 0;
      for (let w = 0; w < 32; w++) d += popcount((index.signs[i * 32 + w]! ^ q[w]!) >>> 0);
      return d;
    };
    const fifty = Array.from({ length: count }, (_, i) => ({ i, d: distance(i) }))
      .sort((a, b) => a.d - b.d || a.i - b.i)
      .slice(0, 50)
      .map(({ i }) => i);
    const cosine = (i: number) => {
      let dot = 0;
      let qq = 0;
      let vv = 0;
      for (let k = 0; k < DIMENSIONS; k++) {
        const v = index.vectors[i * DIMENSIONS + k]!;
        dot += query[k]! * v;
        qq += query[k]! * query[k]!;
        vv += v * v;
      }
      return dot / Math.sqrt(qq * vv);
    };
    const expected = fifty
      .map((i) => ({ i, s: cosine(i) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .slice(0, 8)
      .map(({ i }) => i);

    for (let warm = 0; warm < 3; warm++) rank(index, query);
    const times: number[] = [];
    let result = rank(index, query);
    for (let run = 0; run < 7; run++) {
      const start = performance.now();
      result = rank(index, query);
      times.push(performance.now() - start);
    }
    expect(result.map((r) => r.passage)).toEqual(expected);
    expect(
      Math.min(...times),
      `the fastest of seven rankings, in ms (all: ${times.map((t) => t.toFixed(2))})`,
    ).toBeLessThan(5);
  });
});
