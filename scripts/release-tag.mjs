// The release workflow's first check: the tag that started it must name the version of the
// package it publishes, or nothing is published. Each package has its own prefix: `v` for
// @meltemi/identity (`v0.1.0`), `ocean-v` for @meltemi/ocean (`ocean-v0.1.0`).
//
//   node scripts/release-tag.mjs <tag> <package.json> [prefix]     (the prefix defaults to v)

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Undefined when `tag` is `<prefix><version>` of the manifest; otherwise the reason, naming both. */
export function tagMismatch(tag, manifestText, prefix = "v") {
  const version = JSON.parse(manifestText).version;
  if (!/^\d+\.\d+\.\d+$/.test(String(version)))
    return `the package's version "${version}" is not x.y.z`;
  if (tag !== `${prefix}${version}`)
    return `the tag ${tag} does not name the package's version ${version} (expected ${prefix}${version})`;
  return undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [tag, manifest, prefix = "v"] = process.argv.slice(2);
  if (!tag || !manifest) {
    console.error("usage: release-tag.mjs <tag> <package.json> [prefix]");
    process.exit(1);
  }
  const problem = tagMismatch(tag, readFileSync(manifest, "utf8"), prefix);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  console.log(`${tag} names the package's version`);
}
