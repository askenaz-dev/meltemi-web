// Writes the IDE's latest release into the IDE's pages, at deploy time (change ide-releases).
//
// The IDE releases with no hand on it: a version commit on its `main` publishes a release, and its
// release workflow then starts this repository's deploy. Before the site is uploaded, this script
// asks GitHub for the newest published release of `askenaz-dev/meltemi` and replaces what stands
// between `<!-- ide-release -->` and `<!-- /ide-release -->` in `/ide/` and `/es/ide/` with its
// version, date and link:
//
//   node scripts/ide-release.mjs public          (from packages/site; GH_TOKEN may name a token)
//
// The committed pages carry a version-free sentence. It stays whenever GitHub does not answer, or
// answers something that is not a published version, and the deploy goes on: a page late by one
// release is better than a deploy that fails for it. The link is built from the tag, never taken
// from GitHub's answer, and every value is escaped.
//
// Exit codes: 0 the pages were written, or kept as committed; 1 a page lacks its markers, which is
// a mistake in this repository and stops the deploy before anything is uploaded; 2 the arguments
// cannot be used.

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The IDE's repository on GitHub. */
export const REPOSITORY = "askenaz-dev/meltemi";

/** Where GitHub answers the newest published release: never a draft, never a pre-release. */
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;

/** The markers around the block, in each of the two pages. */
export const BEGIN = "<!-- ide-release -->";
export const END = "<!-- /ide-release -->";

/** The pages that carry the block, relative to `public/`, with their language. */
export const PAGES = [
  { file: join("ide", "index.html"), lang: "en" },
  { file: join("es", "ide", "index.html"), lang: "es" },
];

const WORDS = {
  en: { latest: "Latest release", published: "published" },
  es: { latest: "Última release", published: "publicada el" },
};

/**
 * @typedef {{ tag: string, date: string }} Release
 */

/** Escapes text for HTML. */
function escape(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * The release worth naming from GitHub's answer for the latest release, or `undefined` when it is
 * a draft, a pre-release, a tag that is not `v<x.y.z>`, or carries no ISO 8601 publication date.
 *
 * @param {unknown} json
 * @returns {Release | undefined}
 */
export function releaseOf(json) {
  if (!json || typeof json !== "object") return undefined;
  const answer = /** @type {Record<string, unknown>} */ (json);
  if (answer.draft === true || answer.prerelease === true) return undefined;
  const tag = answer.tag_name;
  if (typeof tag !== "string" || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
    return undefined;
  }
  const published = answer.published_at;
  if (typeof published !== "string") return undefined;
  const date = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.exec(published)?.[1];
  if (!date) return undefined;
  return { tag, date };
}

/**
 * The sentence that names a release, in English or Spanish, with the link built from its tag.
 *
 * @param {Release} release
 * @param {"en" | "es"} lang
 */
export function renderBlock(release, lang) {
  const words = WORDS[lang];
  const href = `https://github.com/${REPOSITORY}/releases/tag/${encodeURIComponent(release.tag)}`;
  return (
    `<p class="release-note">${words.latest}: ` +
    `<a href="${escape(href)}">${escape(release.tag)}</a>, ` +
    `${words.published} ${escape(release.date)}.</p>`
  );
}

/**
 * `html` with what stands between the markers replaced by `block`, or `undefined` when the page
 * does not carry each marker exactly once, in order.
 *
 * @param {string} html
 * @param {string} block
 */
export function inject(html, block) {
  const begin = html.indexOf(BEGIN);
  const end = html.indexOf(END);
  const once =
    begin !== -1 &&
    end > begin &&
    html.indexOf(BEGIN, begin + 1) === -1 &&
    html.indexOf(END, end + 1) === -1;
  if (!once) return undefined;
  return `${html.slice(0, begin + BEGIN.length)}\n        ${block}\n        ${html.slice(end)}`;
}

/**
 * Asks GitHub for the IDE's latest release and writes it into the pages under `publicDir`.
 *
 * @param {string} publicDir
 * @param {{ fetch?: typeof fetch, token?: string, log?: (line: string) => void }} [options]
 * @returns {Promise<number>} the exit code
 */
export async function main(publicDir, options = {}) {
  const ask = options.fetch ?? fetch;
  const log = options.log ?? ((line) => console.log(line));
  const pages = PAGES.map(({ file, lang }) => {
    const path = join(publicDir, file);
    return { path, lang, html: readFileSync(path, "utf8") };
  });
  const unmarked = pages.filter(({ html }) => inject(html, "") === undefined);
  if (unmarked.length > 0) {
    for (const { path } of unmarked) log(`${path} does not carry ${BEGIN} … ${END} once`);
    return 1;
  }

  let release;
  try {
    const headers = {
      accept: "application/vnd.github+json",
      "user-agent": "meltemi-web-deploy",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    };
    const answer = await ask(LATEST_RELEASE_API, { headers, signal: AbortSignal.timeout(10_000) });
    if (!answer.ok) {
      log(`GitHub answered ${answer.status}: the IDE's pages keep their own sentence`);
      return 0;
    }
    release = releaseOf(await answer.json());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(`GitHub did not answer (${reason}): the IDE's pages keep their own sentence`);
    return 0;
  }
  if (!release) {
    log("The latest release is not a published version: the IDE's pages keep their own sentence");
    return 0;
  }
  for (const { path, lang, html } of pages) {
    writeFileSync(path, /** @type {string} */ (inject(html, renderBlock(release, lang))));
  }
  log(`The IDE's pages name ${release.tag}, published ${release.date}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [publicDir, ...rest] = process.argv.slice(2);
  if (!publicDir || rest.length > 0) {
    console.error("usage: node scripts/ide-release.mjs <public directory>");
    process.exitCode = 2;
  } else {
    main(resolve(publicDir), { token: process.env.GH_TOKEN || undefined }).then((code) => {
      process.exitCode = code;
    });
  }
}
