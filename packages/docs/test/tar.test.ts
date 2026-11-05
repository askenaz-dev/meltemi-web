// `scripts/tar.ts`, the archive reader (specification `docs-sources`, "The archive reader"): on
// archives the test writes with Node, never downloaded.

import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { innerPath, readTarGz } from "../scripts/tar.js";
import { archive, entry, paxRecord, tar } from "./support/tar.js";

const docs = (path: string) => path.startsWith("docs/");

/** The archive's bytes in chunks of `size`, as a stream gives them. */
async function* chunks(bytes: Uint8Array, size: number) {
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
}

describe("the archive reader", () => {
  it("returns docs/a.md alone from an archive with docs/a.md and src/x.ts", async () => {
    const bytes = gzipSync(
      tar([
        { name: "repo-1.0/", type: "5" },
        { name: "repo-1.0/docs/a.md", data: "# A\n" },
        { name: "repo-1.0/src/x.ts", data: "x" },
      ]),
    );
    const read = await readTarGz(bytes, docs);
    expect([...read.files.keys()]).toEqual(["docs/a.md"]);
    expect(Buffer.from(read.files.get("docs/a.md")!).toString()).toBe("# A\n");
  });

  it("refuses an entry whose path leaves its folder, naming it", async () => {
    const bytes = gzipSync(tar([{ name: "repo-1.0/docs/../../etc/passwd", data: "root" }]));
    await expect(readTarGz(bytes, docs)).rejects.toThrow("repo-1.0/docs/../../etc/passwd");
    expect(() => innerPath("/etc/passwd")).toThrow(/absolute/);
    expect(() => innerPath("repo/docs/../../x")).toThrow(/leaves its folder/);
  });

  it("refuses a malformed header", async () => {
    const block = Buffer.from(entry({ name: "repo-1.0/docs/a.md", data: "# A\n" }));
    block[150] = 0x31; // the checksum no longer matches
    const bytes = gzipSync(Buffer.concat([block, Buffer.alloc(1024, 0)]));
    await expect(readTarGz(bytes, docs)).rejects.toThrow(/malformed/);
  });

  it("refuses an archive cut short", async () => {
    const whole = archive({ "docs/a.md": "# A\n".repeat(400) });
    await expect(readTarGz(whole.subarray(0, Math.floor(whole.length / 2)), docs)).rejects.toThrow(
      /archive/,
    );
    const unzipped = tar([{ name: "repo/docs/a.md", data: "x".repeat(2000) }]).subarray(0, 1200);
    await expect(readTarGz(gzipSync(unzipped), docs)).rejects.toThrow(/middle of an entry/);
  });

  it("reads GitHub's global header, the latest time and pax paths, from a stream in small chunks", async () => {
    const long = `repo-1.0/docs/${"deep/".repeat(30)}page.md`;
    const bytes = gzipSync(
      tar([
        { name: "pax_global_header", type: "g", data: paxRecord("comment", "abc123") },
        { name: "repo-1.0/", type: "5", mtime: 1_790_000_000 },
        { name: "PaxHeader", type: "x", data: paxRecord("path", long) },
        { name: "repo-1.0/docs/truncated-name.md", data: "# Deep\n", mtime: 1_791_000_000 },
        { name: "repo-1.0/README.md", data: "# Readme\n", mtime: 1_790_500_000 },
      ]),
    );
    const read = await readTarGz(chunks(bytes, 7), (path) => docs(path) || path === "README.md");
    expect([...read.files.keys()].sort()).toEqual(["README.md", long.slice("repo-1.0/".length)]);
    expect(read.comment).toBe("abc123");
    expect(read.mtime).toBe(1_791_000_000);
  });

  it("keeps a file of any size intact, across block boundaries", async () => {
    const data = Buffer.from(Array.from({ length: 70_001 }, (_, i) => i % 251));
    const read = await readTarGz(chunks(archive({ "docs/media/demo.gif": data }), 4096), docs);
    expect(Buffer.from(read.files.get("docs/media/demo.gif")!).equals(data)).toBe(true);
  });
});
