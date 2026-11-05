// This repository's reader of gzipped tar archives (design decision 2): GitHub's release archives
// are ustar files with pax headers, inflated with `node:zlib` and read entry by entry, keeping only
// the paths asked for. No dependency: the format is fixed and small.
//
// GitHub puts every file under one top folder (`askenaz-dev-meltemi-1a2b3c4/`), which the reader
// strips, so callers ask for `docs/x.md`. An entry whose path leaves that folder, or whose header
// is malformed, fails the whole archive, naming the entry.

import { createGunzip } from "node:zlib";

const BLOCK = 512;

export interface TarArchive {
  /** The regular files kept, by their path below the top folder (`docs/x.md`). */
  readonly files: Map<string, Uint8Array>;
  /** The latest modification time of any entry, in seconds since 1970: GitHub's commit time. */
  readonly mtime: number;
  /** The pax global header's `comment`, where GitHub writes the commit's SHA. */
  readonly comment?: string;
}

export class TarError extends Error {
  override name = "TarError";
}

/** The text of a NUL-terminated field. */
function text(block: Uint8Array, start: number, length: number): string {
  const field = block.subarray(start, start + length);
  const end = field.indexOf(0);
  return Buffer.from(end < 0 ? field : field.subarray(0, end)).toString("utf8");
}

/** A numeric field: octal digits, or base-256 when the first byte's high bit is set. */
function number(block: Uint8Array, start: number, length: number): number {
  if ((block[start]! & 0x80) !== 0) {
    let value = block[start]! & 0x7f;
    for (let i = start + 1; i < start + length; i++) value = value * 256 + block[i]!;
    return value;
  }
  const digits = text(block, start, length).trim();
  if (digits === "") return 0;
  if (!/^[0-7]+$/.test(digits)) return Number.NaN;
  return parseInt(digits, 8);
}

/** Whether the header's checksum is right: its bytes summed with the checksum field as spaces. */
function checksumOk(block: Uint8Array): boolean {
  const expected = number(block, 148, 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i]!;
  return sum === expected;
}

/** The records of a pax header: `<length> <key>=<value>\n`, repeated. */
function paxRecords(data: Uint8Array): Map<string, string> {
  const records = new Map<string, string>();
  const bytes = Buffer.from(data);
  let at = 0;
  while (at < bytes.length) {
    const space = bytes.indexOf(0x20, at);
    if (space < 0) break;
    const length = Number(bytes.subarray(at, space).toString("ascii"));
    if (!Number.isInteger(length) || length <= space - at || at + length > bytes.length) {
      throw new TarError("a pax header is malformed");
    }
    const record = bytes.subarray(space + 1, at + length - 1).toString("utf8");
    const eq = record.indexOf("=");
    if (eq > 0) records.set(record.slice(0, eq), record.slice(eq + 1));
    at += length;
  }
  return records;
}

/**
 * The path of an entry below the archive's top folder, or `undefined` for the top folder itself;
 * throws when the path is absolute or leaves the folder.
 */
export function innerPath(name: string): string | undefined {
  if (name.startsWith("/") || name.includes("\\") || /^[A-Za-z]:/.test(name)) {
    throw new TarError(`the entry ${JSON.stringify(name)} has an absolute path`);
  }
  const segments = name.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.includes("..")) {
    throw new TarError(`the entry ${JSON.stringify(name)} leaves its folder`);
  }
  const inner = segments.slice(1).join("/");
  return inner === "" ? undefined : inner;
}

type State =
  | { kind: "header" }
  | { kind: "body"; remaining: number; keep: boolean; chunks: Uint8Array[]; run: () => void }
  | { kind: "padding"; remaining: number }
  | { kind: "end" };

/**
 * A tar parser fed with chunks of the inflated archive. `keep` decides, from the inner path,
 * which regular files are held in memory; every other entry is skipped as it streams by.
 */
export class TarReader {
  readonly files = new Map<string, Uint8Array>();
  mtime = 0;
  comment: string | undefined;
  #state: State = { kind: "header" };
  #pending: Uint8Array = new Uint8Array(0);
  #pax = new Map<string, string>();
  #longName: string | undefined;
  #zeroBlocks = 0;

  constructor(private readonly keep: (path: string) => boolean) {}

  push(chunk: Uint8Array): void {
    let data = this.#pending.length ? Buffer.concat([this.#pending, chunk]) : chunk;
    this.#pending = new Uint8Array(0);
    while (data.length > 0) {
      const state = this.#state;
      if (state.kind === "end") return;
      if (state.kind === "header") {
        if (data.length < BLOCK) {
          this.#pending = Uint8Array.from(data);
          return;
        }
        this.#header(data.subarray(0, BLOCK));
        data = data.subarray(BLOCK);
        continue;
      }
      const take = Math.min(state.remaining, data.length);
      if (state.kind === "body") {
        if (state.keep) state.chunks.push(Uint8Array.from(data.subarray(0, take)));
        state.remaining -= take;
        data = data.subarray(take);
        if (state.remaining === 0) state.run();
      } else {
        state.remaining -= take;
        data = data.subarray(take);
        if (state.remaining === 0) this.#state = { kind: "header" };
      }
    }
  }

  /** Throws unless the archive ended with its two zero blocks, or at least a whole entry. */
  finish(): void {
    if (this.#state.kind === "end") return;
    if (this.#state.kind !== "header" || this.#pending.length > 0) {
      throw new TarError("the archive ends in the middle of an entry");
    }
    if (this.#zeroBlocks === 0) throw new TarError("the archive has no end-of-archive blocks");
  }

  #header(block: Uint8Array): void {
    if (block.every((b) => b === 0)) {
      this.#zeroBlocks += 1;
      if (this.#zeroBlocks === 2) this.#state = { kind: "end" };
      return;
    }
    this.#zeroBlocks = 0;
    if (!checksumOk(block)) {
      throw new TarError(
        `a header is malformed (bad checksum) near ${JSON.stringify(text(block, 0, 100))}`,
      );
    }
    const size = number(block, 124, 12);
    const mtime = number(block, 136, 12);
    if (!Number.isFinite(size) || size < 0 || !Number.isFinite(mtime)) {
      throw new TarError(
        `a header is malformed (size or time) near ${JSON.stringify(text(block, 0, 100))}`,
      );
    }
    const type = String.fromCharCode(block[156]!);
    const magic = text(block, 257, 6);
    const prefix = magic.startsWith("ustar") ? text(block, 345, 155) : "";
    const raw = text(block, 0, 100);
    const name = this.#pax.get("path") ?? this.#longName ?? (prefix ? `${prefix}/${raw}` : raw);
    const paxSize = this.#pax.get("size");
    const length = paxSize !== undefined ? Number(paxSize) : size;
    const padding = (BLOCK - (length % BLOCK)) % BLOCK;

    const special = type === "x" || type === "g" || type === "L";
    if (!special) {
      this.#pax = new Map();
      this.#longName = undefined;
      if (Number.isFinite(mtime)) this.mtime = Math.max(this.mtime, mtime);
    }
    const inner = special ? undefined : innerPath(name);
    const regular = type === "0" || type === "\0" || type === "7";
    const keep = !special && regular && inner !== undefined && this.keep(inner);
    const after = () => {
      this.#state = padding ? { kind: "padding", remaining: padding } : { kind: "header" };
    };
    const chunks: Uint8Array[] = [];
    const run = () => {
      const data = Buffer.concat(chunks);
      if (type === "x") for (const [k, v] of paxRecords(data)) this.#pax.set(k, v);
      else if (type === "g") this.comment = paxRecords(data).get("comment") ?? this.comment;
      else if (type === "L") this.#longName = text(data, 0, data.length);
      else if (keep && inner !== undefined) this.files.set(inner, new Uint8Array(data));
      after();
    };
    if (length === 0) {
      run();
      return;
    }
    this.#state = { kind: "body", remaining: length, keep: keep || special, chunks, run };
  }
}

/** Reads a gzipped tar archive, keeping the regular files whose inner path `keep` accepts. */
export async function readTarGz(
  source: Uint8Array | AsyncIterable<Uint8Array>,
  keep: (path: string) => boolean,
): Promise<TarArchive> {
  const reader = new TarReader(keep);
  const gunzip = createGunzip();
  const done = new Promise<void>((resolve, reject) => {
    gunzip.on("data", (chunk: Buffer) => {
      try {
        reader.push(chunk);
      } catch (error) {
        gunzip.destroy();
        reject(error);
      }
    });
    gunzip.on("end", resolve);
    gunzip.on("error", (error) =>
      reject(
        error instanceof TarError
          ? error
          : new TarError(`the archive cannot be inflated (${error.message})`),
      ),
    );
  });
  if (source instanceof Uint8Array) gunzip.end(source);
  else {
    (async () => {
      try {
        for await (const chunk of source) {
          if (!gunzip.write(chunk)) await new Promise((r) => gunzip.once("drain", r));
        }
        gunzip.end();
      } catch (error) {
        gunzip.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  }
  await done;
  reader.finish();
  return {
    files: reader.files,
    mtime: reader.mtime,
    ...(reader.comment ? { comment: reader.comment } : {}),
  };
}
