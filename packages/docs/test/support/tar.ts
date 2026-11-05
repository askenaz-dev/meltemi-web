// Writes small gzipped tar archives the way GitHub's codeload does (a pax global header with the
// commit, one top folder, ustar entries), so the reader and the sources are tested on archives the
// tests make: nothing is downloaded.

import { gzipSync } from "node:zlib";

export interface Entry {
  readonly name: string;
  readonly data?: string | Uint8Array;
  /** `0` a file (the default), `5` a folder, `x` a pax header, `g` a pax global header. */
  readonly type?: "0" | "5" | "x" | "g" | "2";
  readonly mtime?: number;
}

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, "0") + "\0";
}

/** One ustar header and its data, padded to 512 bytes. */
export function entry({ name, data = "", type = "0", mtime = 1_793_000_000 }: Entry): Uint8Array {
  const body = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  const header = Buffer.alloc(512, 0);
  header.write(name.slice(0, 100), 0, "utf8");
  header.write(octal(0o644, 8), 100, "ascii");
  header.write(octal(0, 8), 108, "ascii");
  header.write(octal(0, 8), 116, "ascii");
  header.write(octal(body.length, 12), 124, "ascii");
  header.write(octal(mtime, 12), 136, "ascii");
  header.write("        ", 148, "ascii");
  header.write(type, 156, "ascii");
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(octal(sum, 7) + " ", 148, "ascii");
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512, 0);
  return Buffer.concat([header, body, padding]);
}

/** A pax record: `<length> <key>=<value>\n`, the length counting itself. */
export function paxRecord(key: string, value: string): string {
  const rest = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(rest) + 1;
  while (String(length).length + Buffer.byteLength(rest) !== length) length += 1;
  return `${length}${rest}`;
}

/** The tar bytes of the entries, ended by two zero blocks, uncompressed. */
export function tar(entries: readonly Entry[]): Uint8Array {
  return Buffer.concat([...entries.map(entry), Buffer.alloc(1024, 0)]);
}

/** A gzipped archive of `files` under `top/`, with GitHub's global header naming `commit`. */
export function archive(
  files: Record<string, string | Uint8Array>,
  {
    top = "askenaz-dev-repo-1a2b3c4",
    commit = "1a2b3c4d5e6f",
    mtime,
  }: { top?: string; commit?: string; mtime?: number } = {},
): Uint8Array {
  const entries: Entry[] = [
    { name: "pax_global_header", type: "g", data: paxRecord("comment", commit) },
    { name: `${top}/`, type: "5", ...(mtime ? { mtime } : {}) },
    ...Object.entries(files).map(([path, data]) => ({
      name: `${top}/${path}`,
      data,
      ...(mtime ? { mtime } : {}),
    })),
  ];
  return gzipSync(tar(entries));
}
