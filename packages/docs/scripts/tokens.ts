// The portal's copy of the family's tokens (design decision 8): `src/styles/tokens.css` is the
// site's `public/tokens.css`, token for token, with one change of selectors so Starlight's theme
// switch works: the dark values apply under the system's dark scheme unless the reader chose light,
// and under the reader's choice of dark whatever the system says. Names and values stay the site's;
// test/tokens.test.ts fails when the committed file is not what this script writes.
//
//   pnpm --filter @meltemi/docs tokens        (writes src/styles/tokens.css)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SITE_TOKENS = fileURLToPath(new URL("../../site/public/tokens.css", import.meta.url));
export const PORTAL_TOKENS = fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url));

const HEADER = `/* The portal's tokens — DERIVED from packages/site/public/tokens.css by
 * scripts/tokens.ts (pnpm --filter @meltemi/docs tokens). Do not edit: change the
 * site's copy, which follows the IDE's design system, and run the script. Only
 * the selectors of the dark scheme differ, so Starlight's theme switch can pick
 * a scheme against the system's. */
`;

/** The portal's tokens from the site's. */
export function portalTokens(siteCss: string): string {
  const darkOpen = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{/;
  const match = darkOpen.exec(siteCss);
  if (!match) throw new Error("the site's tokens have no dark block");
  const bodyStart = match.index + match[0].length;
  const bodyEnd = siteCss.indexOf("}", bodyStart);
  const darkBody = siteCss.slice(bodyStart, bodyEnd).replace(/^\n/, "").replace(/\s+$/, "");
  const withSelectors =
    siteCss.slice(0, match.index) +
    `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {` +
    siteCss.slice(bodyStart);
  const explicit = darkBody
    .split("\n")
    .map((line) => line.replace(/^ {4}/, "  "))
    .join("\n");
  return `${HEADER}\n${withSelectors.trimEnd()}\n\n:root[data-theme="dark"] {\n${explicit}\n}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(PORTAL_TOKENS, portalTokens(readFileSync(SITE_TOKENS, "utf8")));
  console.log(`Wrote ${PORTAL_TOKENS} from ${SITE_TOKENS}`);
}
