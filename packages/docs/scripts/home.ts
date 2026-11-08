// The portal's home in each language (specification `docs-portal`, "One portal, three sections,
// two languages"): the three products, each with its words and a link to its section, the family's
// sea (its still picture, set in motion by `HomeSea.astro` where the reader allows motion,
// "The home's sea in motion"), and the release each section is shown from. Written by the build from the typed
// catalogs, as MDX so it can use Starlight's cards.

import { messages, type Lang, type Section } from "../src/messages/index.js";
import type { Release } from "./sources.js";

const SECTIONS: readonly Section[] = ["diagrams", "ide", "web"];

/** A string as a JSX expression: a JSON literal, so no word can open a tag or an expression. */
const js = (text: string) => `{${JSON.stringify(text)}}`;

export function homePage(
  lang: Lang,
  releases: Partial<Record<Section, Release>>,
  askEnabled: boolean,
): { file: string; text: string } {
  const words = messages[lang];
  const prefix = lang === "es" ? "/es" : "";
  const shown = SECTIONS.flatMap((section) => {
    const release = releases[section];
    return release ? [`${words.sections[section].name} ${release.version} (${release.date})`] : [];
  });
  const frontmatter = [
    "---",
    `title: ${JSON.stringify(words.home.title)}`,
    `description: ${JSON.stringify(words.portal.description)}`,
    `template: splash`,
    `pagefind: false`,
    `editUrl: false`,
    `hero:`,
    `  title: ${JSON.stringify(words.home.title)}`,
    `  tagline: ${JSON.stringify(words.home.tagline)}`,
    `  image:`,
    `    html: ${JSON.stringify('<img class="portal-hero-mark" src="/media/meltemi-mark-gradient.svg" alt="" width="256" height="256" />')}`,
    `  actions:`,
    ...SECTIONS.flatMap((section, i) => [
      `    - text: ${JSON.stringify(words.sections[section].name)}`,
      `      link: ${JSON.stringify(`${prefix}/${section}/`)}`,
      `      icon: right-arrow`,
      `      variant: ${i === 0 ? "primary" : "secondary"}`,
    ]),
    "---",
    "",
  ];
  const cards = SECTIONS.map(
    (section) =>
      `  <LinkCard title=${js(words.sections[section].name)} description=${js(words.sections[section].blurb)} href=${js(`${prefix}/${section}/`)} />`,
  );
  // The home sits at `src/content/docs/index.mdx` or `es/index.mdx`; the component is under `src`.
  const components = lang === "es" ? "../../../components" : "../../components";
  const body = [
    `import { CardGrid, LinkCard } from "@astrojs/starlight/components";`,
    `import HomeSea from ${JSON.stringify(`${components}/HomeSea.astro`)};`,
    "",
    `<HomeSea lang=${js(lang)} />`,
    "",
    "<CardGrid>",
    ...cards,
    "</CardGrid>",
    "",
    `<p class="portal-hints">${js(words.home.searchHint)} <kbd>Ctrl</kbd> <kbd>K</kbd>${askEnabled ? ` ${js(words.home.askHint)}` : js(".")}</p>`,
    "",
    ...(shown.length
      ? [`<p class="portal-releases">${js(`${words.home.released}: ${shown.join(" · ")}`)}</p>`, ""]
      : []),
  ];
  return {
    file: lang === "es" ? "es/index.mdx" : "index.mdx",
    text: `${frontmatter.join("\n")}${body.join("\n")}`,
  };
}
