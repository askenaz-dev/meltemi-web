// The index of "Ask the docs", built at deploy (design decision 6). Every page of the portal is
// split into passages (a heading and its paragraphs, at most 1,500 characters, overlapping by one
// paragraph), each passage is embedded with Workers AI through Cloudflare's API in batches of fifty,
// and `ask/index.bin` is written in the layout of `src/ask-index.ts`.
//
// The embeddings are cached in `.cache/embeddings/` by model and text, so a deploy embeds only the
// passages that changed. Each live batch first reads the central AI control. When disabled or
// unavailable, the index retains reusable cached passages and omits those without vectors. The
// portal and its search still build. The tests and fixture build use the offline embedder.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readAiControl } from "../src/ai-control.js";
import {
  DIMENSIONS,
  EMBEDDING_MODEL,
  FAKE_MODEL,
  encodeIndex,
  fakeEmbed,
  normalise,
  type IndexPage,
  type IndexPassage,
} from "../src/ask-index.js";
import { fencedLines, type PortalPage } from "./convert.js";

export const PASSAGE_LIMIT = 1500;
export const BATCH = 50;

export interface Embedder {
  readonly model: string;
  /** Missing vectors leave their passages out of the index without discarding the others. */
  embed(texts: readonly string[]): Promise<(Float32Array | undefined)[]>;
}

export const fakeEmbedder = (): Embedder => ({
  model: FAKE_MODEL,
  async embed(texts) {
    return texts.map((text) => fakeEmbed(text));
  },
});

export class EmbeddingError extends Error {
  override name = "EmbeddingError";
}

/** Workers AI through Cloudflare's REST API, with the deploy job's token, fifty texts a call. */
export function cloudflareEmbedder({
  account,
  token,
  fetch: fetcher = fetch,
  model = EMBEDDING_MODEL,
}: {
  account: string;
  token: string;
  fetch?: typeof fetch;
  model?: string;
}): Embedder {
  return {
    model,
    async embed(texts) {
      const out: Float32Array[] = [];
      for (let at = 0; at < texts.length; at += BATCH) {
        const control = await readAiControl((request) => fetcher(request));
        if (control !== "enabled") throw new EmbeddingError(`the central AI control is ${control}`);
        const batch = texts.slice(at, at + BATCH);
        let response: Response;
        try {
          response = await fetcher(
            `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ text: batch }),
            },
          );
        } catch {
          throw new EmbeddingError("Workers AI could not be reached");
        }
        const body: unknown = await response.json().catch(() => undefined);
        const json = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as {
          success?: boolean;
          result?: { data?: number[][] };
          errors?: { code?: number; message?: string }[];
        };
        const data = json.result?.data;
        if (
          !response.ok ||
          json.success !== true ||
          !Array.isArray(data) ||
          data.length !== batch.length
        ) {
          const reason = Array.isArray(json.errors)
            ? json.errors.map((e) => `${e.code ?? ""} ${e.message ?? ""}`.trim()).join("; ")
            : "";
          throw new EmbeddingError(
            `Workers AI answered ${response.status} to a batch of ${batch.length}${reason ? `: ${reason}` : ""}`,
          );
        }
        for (const vector of data) {
          if (
            !Array.isArray(vector) ||
            vector.length !== DIMENSIONS ||
            !vector.every((value) => typeof value === "number" && Number.isFinite(value))
          )
            throw new EmbeddingError(`Workers AI gave an invalid ${DIMENSIONS}-dimension vector`);
          out.push(normalise(vector));
        }
      }
      return out;
    },
  };
}

/** Persists each successful batch, and retains cached vectors when later live batches are refused. */
export function cachedEmbedder(
  embedder: Embedder,
  dir: string,
  onError?: (error: EmbeddingError) => void,
): Embedder & { readonly asked: () => number } {
  let asked = 0;
  const fileOf = (text: string) =>
    join(
      dir,
      `${createHash("sha256").update(embedder.model).update("\n").update(text).digest("hex")}.f32`,
    );
  const read = (text: string): Float32Array | undefined => {
    const file = fileOf(text);
    if (!existsSync(file)) return undefined;
    const bytes = readFileSync(file);
    if (bytes.length !== DIMENSIONS * Float32Array.BYTES_PER_ELEMENT) return undefined;
    const vector = new Float32Array(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    return vector.every(Number.isFinite) ? vector : undefined;
  };
  return {
    model: embedder.model,
    asked: () => asked,
    async embed(texts) {
      const vectors = new Map([...new Set(texts)].map((text) => [text, read(text)]));
      const missing = [...vectors.keys()].filter((text) => !vectors.get(text));
      for (let at = 0; at < missing.length; at += BATCH) {
        const batch = missing.slice(at, at + BATCH);
        asked += batch.length;
        let embedded: (Float32Array | undefined)[];
        try {
          embedded = await embedder.embed(batch);
        } catch (error) {
          if (!(error instanceof EmbeddingError)) throw error;
          onError?.(error);
          break;
        }
        mkdirSync(dir, { recursive: true });
        for (let i = 0; i < batch.length; i++) {
          const vector = embedded[i];
          if (!vector) continue;
          const text = batch[i]!;
          writeFileSync(
            fileOf(text),
            Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength),
          );
          vectors.set(text, vector);
        }
      }
      return texts.map((text) => vectors.get(text));
    },
  };
}

/**
 * The embedder a build uses: the offline one for the fixture, Workers AI where the token and the
 * account are in the environment, none otherwise (an index with no passage).
 */
export function embedderFor(
  choice: "fake" | "cloudflare" | "none" | undefined,
  mode: string,
  env: NodeJS.ProcessEnv,
  fetcher?: typeof fetch,
): Embedder | undefined {
  const pick = choice ?? (mode === "fixture" ? "fake" : "cloudflare");
  if (pick === "none") return undefined;
  if (pick === "fake") return fakeEmbedder();
  const token = env["CLOUDFLARE_API_TOKEN"];
  const account = env["CLOUDFLARE_ACCOUNT_ID"];
  if (!token || !account) return undefined;
  return cloudflareEmbedder({ account, token, ...(fetcher ? { fetch: fetcher } : {}) });
}

// ---------------------------------------------------------------------------------------------
// Passages.

/** A page's body as the passages read it: no pictures, no HTML, links reduced to their words. */
export function proseOf(body: string): string {
  return body
    .replace(/<figure class="meltemi-picture"[\s\S]*?<\/figure>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[((?:[^\][]|\[[^\]]*\])*)\]\([^)]*\)/g, "$1")
    .replace(/^ {0,3}\[[^\]]+\]:\s*\S+.*$/gm, "")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "");
}

export interface Passage {
  readonly heading: string;
  readonly text: string;
}

/** The blocks of a text: paragraphs and fences, each whole. */
function blocksOf(markdown: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  for (const { line, code } of fencedLines(markdown)) {
    if (code !== inFence && current.length) {
      blocks.push(current.join("\n"));
      current = [];
    }
    inFence = code;
    if (!code && line.trim() === "") {
      if (current.length) blocks.push(current.join("\n"));
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks.filter((b) => b.trim() !== "");
}

/**
 * A page's passages: each heading with its paragraphs, cut at `limit` characters between
 * paragraphs, the next passage starting again with the last paragraph of the one before.
 */
export function passagesOf(title: string, body: string, limit = PASSAGE_LIMIT): Passage[] {
  const sections: { heading: string; blocks: string[] }[] = [{ heading: title, blocks: [] }];
  for (const block of blocksOf(proseOf(body))) {
    const heading = /^#{1,6}\s+(.+?)\s*#*$/.exec(block.trim());
    if (heading && !block.includes("\n"))
      sections.push({ heading: heading[1]!.replace(/`/g, ""), blocks: [] });
    else sections.at(-1)!.blocks.push(block);
  }
  const passages: Passage[] = [];
  for (const { heading, blocks } of sections) {
    const pieces = blocks.flatMap((block) =>
      block.length <= limit
        ? [block]
        : Array.from({ length: Math.ceil(block.length / limit) }, (_, i) =>
            block.slice(i * limit, (i + 1) * limit),
          ),
    );
    if (!pieces.length) continue;
    let chunk: string[] = [];
    let length = 0;
    for (const piece of pieces) {
      if (chunk.length && length + piece.length + 2 > limit) {
        passages.push({ heading, text: chunk.join("\n\n") });
        const last = chunk.at(-1)!;
        chunk = last.length + piece.length + 2 <= limit ? [last] : [];
        length = chunk.reduce((sum, c) => sum + c.length + 2, 0);
      }
      chunk.push(piece);
      length += piece.length + 2;
    }
    if (chunk.length) passages.push({ heading, text: chunk.join("\n\n") });
  }
  return passages;
}

export interface IndexReport {
  readonly model: string;
  readonly pages: number;
  readonly passages: number;
  readonly bytes: Uint8Array;
}

/**
 * The index of the pages a reader can ask about (no notice page), embedded by `embedder`, or an
 * index with no passage when there is none.
 */
export async function buildIndex(
  pages: readonly PortalPage[],
  embedder: Embedder | undefined,
): Promise<IndexReport> {
  const indexPages: IndexPage[] = [];
  const entries: { page: number; passage: Passage }[] = [];
  for (const page of pages) {
    if (page.notice) continue;
    const at =
      indexPages.push({
        section: page.section,
        title: page.title,
        url: page.url,
        lang: page.lang,
      }) - 1;
    for (const passage of passagesOf(page.title, page.body)) entries.push({ page: at, passage });
  }
  if (!embedder) {
    const bytes = encodeIndex({
      model: EMBEDDING_MODEL,
      dimensions: DIMENSIONS,
      pages: [],
      passages: [],
    });
    return { model: EMBEDDING_MODEL, pages: 0, passages: 0, bytes };
  }
  const texts = entries.map(({ page, passage }) => {
    const title = indexPages[page]!.title;
    return passage.heading === title
      ? `${title}\n${passage.text}`
      : `${title}: ${passage.heading}\n${passage.text}`;
  });
  const vectors = await embedder.embed(texts);
  const availablePages: IndexPage[] = [];
  const pagePositions = new Map<number, number>();
  const passages: IndexPassage[] = [];
  for (let i = 0; i < entries.length; i++) {
    const vector = vectors[i];
    if (!vector) continue;
    const original = entries[i]!.page;
    let page = pagePositions.get(original);
    if (page === undefined) {
      page = availablePages.push(indexPages[original]!) - 1;
      pagePositions.set(original, page);
    }
    passages.push({ page, text: texts[i]!, vector });
  }
  const bytes = encodeIndex({
    model: embedder.model,
    dimensions: DIMENSIONS,
    pages: availablePages,
    passages,
  });
  return { model: embedder.model, pages: availablePages.length, passages: passages.length, bytes };
}
