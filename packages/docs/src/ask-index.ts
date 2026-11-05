// The index of "Ask the docs" (design decision 6; specification `docs-ask`, "The index in the
// assets"): one file, `ask/index.bin`, written by the build and read by the Worker once per
// isolate. It holds every passage's page, its text, and its embedding twice: as sign bits for a
// fast first pass and as int8 for the rescoring. Shared by `scripts/index.ts` and `src/ask.ts`, so
// both sides of the file are one module.
//
//   0      "MDX1"
//   4      u32 the header's length in bytes (a multiple of 4)
//   8      the header: JSON `{ model, dimensions, count, pages, passages }`, padded with spaces
//   H      count × dimensions/8 bytes: the sign bits (bit i of a vector set when component i > 0)
//          count × dimensions bytes: the int8 vectors
//          (count + 1) × u32: where each passage's text starts in the text block, and its end
//          the passages' texts, UTF-8
//
// Little-endian throughout. The header names the embedding model; a Worker refuses an index of a
// model that is not its own.

/** Workers AI's multilingual embedding model, the one production indexes are made with. */
export const EMBEDDING_MODEL = "@cf/baai/bge-m3";
/** The dimensions of its vectors. */
export const DIMENSIONS = 1024;
/** The offline embedder of the tests, the fixture build and the Worker's stub mode. */
export const FAKE_MODEL = "meltemi/hashed-words-1024";

const MAGIC = "MDX1";

export interface IndexPage {
  readonly section: string;
  readonly title: string;
  readonly url: string;
  readonly lang: string;
}

export interface IndexPassage {
  /** Its page, by position in `pages`. */
  readonly page: number;
  readonly text: string;
  readonly vector: ArrayLike<number>;
}

export interface AskIndex {
  readonly model: string;
  readonly dimensions: number;
  readonly count: number;
  readonly pages: readonly IndexPage[];
  /** Each passage's page, by position. */
  readonly passagePages: readonly number[];
  readonly signs: Uint32Array;
  readonly vectors: Int8Array;
  /** A passage's text, decoded when asked for. */
  text(passage: number): string;
}

/** A vector scaled to length 1. */
export function normalise(vector: ArrayLike<number>): Float32Array {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) sum += vector[i]! * vector[i]!;
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = vector[i]! / norm;
  return out;
}

/** A vector's sign bits, 32 to a word. */
export function signBits(vector: ArrayLike<number>, dimensions = vector.length): Uint32Array {
  const words = new Uint32Array(dimensions / 32);
  for (let i = 0; i < dimensions; i++) if (vector[i]! > 0) words[i >>> 5]! |= 1 << (i & 31);
  return words;
}

/** A vector in int8, scaled so its largest component is ±127. */
export function int8Of(vector: ArrayLike<number>): Int8Array {
  let max = 0;
  for (let i = 0; i < vector.length; i++) max = Math.max(max, Math.abs(vector[i]!));
  const out = new Int8Array(vector.length);
  if (max === 0) return out;
  for (let i = 0; i < vector.length; i++) out[i] = Math.round((vector[i]! / max) * 127);
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The file's bytes. */
export function encodeIndex({
  model,
  dimensions,
  pages,
  passages,
}: {
  model: string;
  dimensions: number;
  pages: readonly IndexPage[];
  passages: readonly IndexPassage[];
}): Uint8Array {
  if (dimensions % 32 !== 0)
    throw new Error(`dimensions must be a multiple of 32, not ${dimensions}`);
  const count = passages.length;
  const headerJson = JSON.stringify({
    model,
    dimensions,
    count,
    pages,
    passages: passages.map((p) => p.page),
  });
  const headerBytes = encoder.encode(headerJson);
  const headerLength = Math.ceil(headerBytes.length / 4) * 4;
  const texts = passages.map((p) => encoder.encode(p.text));
  const textLength = texts.reduce((sum, t) => sum + t.length, 0);
  const signBytes = (count * dimensions) / 8;
  const total = 8 + headerLength + signBytes + count * dimensions + (count + 1) * 4 + textLength;
  const buffer = new ArrayBuffer(total);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  bytes.set(encoder.encode(MAGIC), 0);
  view.setUint32(4, headerLength, true);
  bytes.fill(0x20, 8, 8 + headerLength);
  bytes.set(headerBytes, 8);
  let at = 8 + headerLength;
  const words = dimensions / 32;
  const signs = new Uint32Array(buffer, at, count * words);
  passages.forEach((p, i) => {
    if (p.vector.length !== dimensions)
      throw new Error(`passage ${i} has ${p.vector.length} dimensions, not ${dimensions}`);
    signs.set(signBits(p.vector, dimensions), i * words);
  });
  at += signBytes;
  const vectors = new Int8Array(buffer, at, count * dimensions);
  passages.forEach((p, i) => vectors.set(int8Of(p.vector), i * dimensions));
  at += count * dimensions;
  let offset = 0;
  for (let i = 0; i <= count; i++) {
    view.setUint32(at + i * 4, offset, true);
    if (i < count) offset += texts[i]!.length;
  }
  at += (count + 1) * 4;
  for (const text of texts) {
    bytes.set(text, at);
    at += text.length;
  }
  return bytes;
}

export class IndexError extends Error {
  override name = "IndexError";
}

/** Reads the file's bytes; texts are decoded only when asked for. */
export function decodeIndex(input: ArrayBuffer | Uint8Array): AskIndex {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  // The views below need an offset that is a multiple of 4 from their buffer's start.
  const own = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
  const view = new DataView(own.buffer, own.byteOffset, own.byteLength);
  if (own.byteLength < 8 || decoder.decode(own.subarray(0, 4)) !== MAGIC)
    throw new IndexError("not an index file");
  const headerLength = view.getUint32(4, true);
  const header = JSON.parse(decoder.decode(own.subarray(8, 8 + headerLength))) as {
    model: string;
    dimensions: number;
    count: number;
    pages: IndexPage[];
    passages: number[];
  };
  const { model, dimensions, count, pages, passages } = header;
  const words = dimensions / 32;
  let at = 8 + headerLength;
  const signs = new Uint32Array(own.buffer, own.byteOffset + at, count * words);
  at += count * words * 4;
  const vectors = new Int8Array(own.buffer, own.byteOffset + at, count * dimensions);
  at += count * dimensions;
  const offsetsAt = at;
  const textsAt = offsetsAt + (count + 1) * 4;
  if (textsAt > own.byteLength) throw new IndexError("the index file is truncated");
  return {
    model,
    dimensions,
    count,
    pages,
    passagePages: passages,
    signs,
    vectors,
    text(passage) {
      const start = view.getUint32(offsetsAt + passage * 4, true);
      const end = view.getUint32(offsetsAt + (passage + 1) * 4, true);
      return decoder.decode(own.subarray(textsAt + start, textsAt + end));
    },
  };
}

/** The set bits of a 32-bit word. */
function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

export interface Ranked {
  readonly passage: number;
  /** The cosine of the question and the passage's int8 vector. */
  readonly score: number;
}

/**
 * The passages closest to a question: every passage ranked by the Hamming distance of its sign
 * bits (ties by position), the best `candidates` rescored by the cosine of their int8 vector, and
 * the `top` of those by score (ties by position).
 */
export function rank(
  index: AskIndex,
  query: ArrayLike<number>,
  { candidates = 50, top = 8 } = {},
): Ranked[] {
  const { count, dimensions, signs, vectors } = index;
  if (count === 0) return [];
  const words = dimensions / 32;
  const q = signBits(query, dimensions);
  const distances = new Uint16Array(count);
  const histogram = new Uint32Array(dimensions + 1);
  for (let i = 0; i < count; i++) {
    let d = 0;
    const base = i * words;
    for (let w = 0; w < words; w++) d += popcount(signs[base + w]! ^ q[w]!);
    distances[i] = d;
    histogram[d]!++;
  }
  const want = Math.min(candidates, count);
  let cutoff = 0;
  let below = 0;
  while (below + histogram[cutoff]! < want) below += histogram[cutoff++]!;
  let atCutoff = want - below;
  const chosen: number[] = [];
  for (let i = 0; i < count; i++) {
    const d = distances[i]!;
    if (d < cutoff) chosen.push(i);
    else if (d === cutoff && atCutoff > 0) {
      chosen.push(i);
      atCutoff--;
    }
  }
  let queryNorm = 0;
  for (let k = 0; k < dimensions; k++) queryNorm += query[k]! * query[k]!;
  queryNorm = Math.sqrt(queryNorm) || 1;
  const scored = chosen.map((passage) => {
    let dot = 0;
    let norm = 0;
    const base = passage * dimensions;
    for (let k = 0; k < dimensions; k++) {
      const v = vectors[base + k]!;
      dot += query[k]! * v;
      norm += v * v;
    }
    return { passage, score: norm ? dot / (queryNorm * Math.sqrt(norm)) : 0 };
  });
  scored.sort((a, b) => b.score - a.score || a.passage - b.passage);
  return scored.slice(0, top);
}

// ---------------------------------------------------------------------------------------------
// The offline embedder.

const STOPWORDS = new Set(
  (
    "a an the and or of to in on at by for with as is are be it its this that do does i how what when " +
    "where which who can you your my me we our not no from into than then there here so if " +
    "el la los las un una unos unas y o de del al en con por para como es son ser se su sus que qué " +
    "cómo cuándo dónde mi tu yo lo le les no si"
  ).split(" "),
);

/** FNV-1a, 32 bits. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A deterministic stand-in for an embedding: each word that is not a stopword adds ±1 to one of
 * the dimensions its hash picks, and the sum is normalised. Texts that share words point the same
 * way, which is all the tests and the fixture build need of it.
 */
export function fakeEmbed(text: string, dimensions = DIMENSIONS): Float32Array {
  const vector = new Float32Array(dimensions);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (STOPWORDS.has(word) || word.length < 2) continue;
    const stem = word.length > 4 ? word.replace(/(es|s)$/, "") : word;
    const h = hash(stem);
    vector[h % dimensions]! += (h >>> 16) & 1 ? 1 : -1;
  }
  return normalise(vector);
}
