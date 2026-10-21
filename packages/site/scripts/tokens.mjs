// Compares the design tokens of the site with the IDE client's.
//
// The site's `public/tokens.css` is a copy of the tokens of the desktop client of the Meltemi IDE
// (`desktop/ui/src/app.css` in that repository), whose normative source is its `design-system/`.
// The IDE repository kept the two equal with a Rust test (`core/meltemid/tests/site.rs`) that
// leaves with `site/`; this script is its replacement. Run it when the IDE's tokens change:
//
//   pnpm site:tokens --ide <path to the IDE repository>
//
// `--site <file>` compares another stylesheet than `public/tokens.css` (the tests use it).
//
// Every `--name: value;` declaration is compared, not only the two `--mel-*` ones: the design
// tokens are `--bg`, `--surface`, `--text` and the rest. The client declares each name once per
// theme (light, dark, and its explicit `data-theme` overrides), so what is compared is, per name,
// the ordered list of its values. A site token fails when the client lacks the name, or when one of
// the site's values for it is not among the client's.
//
// Exit codes: 0 every token passes; 1 a divergence (each one is named); 2 the arguments or a file
// cannot be used.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The fewest tokens a copy may hold: fewer means the file was truncated or not the tokens'. */
export const TOKEN_FLOOR = 30;

/**
 * Every `--name: value;` declaration of a stylesheet as `name -> values in order`, comments
 * removed and white space collapsed.
 */
export function collectTokens(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = new Map();
  for (const match of withoutComments.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+);/g)) {
    const name = match[1];
    const value = match[2].replace(/\s+/g, " ").trim();
    if (!tokens.has(name)) tokens.set(name, []);
    tokens.get(name).push(value);
  }
  return tokens;
}

/**
 * The divergences between the site's tokens and the client's, as sentences that name the token;
 * empty when every token passes.
 */
export function compareTokens(siteCss, clientCss) {
  const site = collectTokens(siteCss);
  const client = collectTokens(clientCss);
  const problems = [];
  if (site.size < TOKEN_FLOOR) {
    problems.push(`only ${site.size} tokens found in tokens.css; the floor is ${TOKEN_FLOOR}`);
  }
  for (const [name, values] of site) {
    const known = client.get(name);
    if (!known) {
      problems.push(`${name}: missing in the client`);
      continue;
    }
    for (const value of new Set(values)) {
      if (!known.includes(value)) {
        problems.push(
          `${name}: the site has "${value}", which is not among the client's ${JSON.stringify(known)}`,
        );
      }
    }
  }
  return { tokens: site.size, problems };
}

function main(argv) {
  const at = argv.indexOf("--ide");
  const ide = at >= 0 ? argv[at + 1] : undefined;
  if (!ide) {
    console.error("Usage: pnpm site:tokens --ide <path to the IDE repository>");
    return 2;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const siteAt = argv.indexOf("--site");
  const sitePath =
    siteAt >= 0 && argv[siteAt + 1]
      ? resolve(argv[siteAt + 1])
      : resolve(here, "..", "public", "tokens.css");
  const clientPath = join(resolve(ide), "desktop", "ui", "src", "app.css");
  let siteCss;
  let clientCss;
  try {
    siteCss = readFileSync(sitePath, "utf8");
    clientCss = readFileSync(clientPath, "utf8");
  } catch (error) {
    console.error(`Cannot read ${error.path ?? "a file"}: ${error.code ?? error.message}`);
    return 2;
  }
  const { tokens, problems } = compareTokens(siteCss, clientCss);
  if (problems.length > 0) {
    console.error(`The tokens of tokens.css diverge from ${clientPath}:`);
    for (const problem of problems) console.error(`  ${problem}`);
    return 1;
  }
  console.log(`Compared ${tokens} tokens of tokens.css with ${clientPath}: every one matches.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
