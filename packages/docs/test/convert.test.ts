// `scripts/convert.ts` (specification `docs-sources`, "Conversion of a page"; `docs-portal`, "One
// portal, three sections, two languages" and "The sidebar follows the index"): one case per rule,
// on the fixture's trees and on pages written here. No network, no disk beyond the fixture.

import { describe, expect, it } from "vitest";
import {
  convertSection,
  detectLanguage,
  dropTwinLink,
  linkContext,
  readDescription,
  readTitle,
  renderPage,
  resolveLink,
  rewriteLinks,
  sidebarOrder,
  sourcePages,
  type PortalPage,
} from "../scripts/convert.js";
import { fixtureSources, type SourceTree } from "../scripts/sources.js";

const trees = fixtureSources();
const tree = (section: string) => trees.find((t) => t.section === section)!;
const diagrams = convertSection(tree("diagrams"));
const ide = convertSection(tree("ide"));
const web = convertSection(tree("web"));
const page = (pages: readonly PortalPage[], lang: string, id: string) => {
  const found = pages.find((p) => p.lang === lang && p.id === id);
  if (!found) throw new Error(`no ${lang} page ${id}`);
  return found;
};

/** A tree of the Diagrams fixture with some files replaced. */
function withFiles(files: Record<string, string>): SourceTree {
  const base = tree("diagrams");
  const copy = new Map(base.files);
  for (const [path, text] of Object.entries(files)) copy.set(path, Buffer.from(text));
  return { ...base, files: copy };
}

describe("the title and the description", () => {
  it("takes the first # heading as the title, after comments, and removes it from the body", () => {
    const { title, body } = readTitle(
      "<!-- SPDX-License-Identifier: Apache-2.0 -->\n# The `harness`\n\nText.\n",
      "docs/x.md",
    );
    expect(title).toBe("The harness");
    expect(body).toBe("Text.\n");
    expect(page(diagrams.pages, "en", "player").title).toBe("The HTML player");
    expect(page(diagrams.pages, "en", "player").body).not.toMatch(/^# /m);
  });

  it("fails naming a page without a heading, and saying a title could not be read", () => {
    expect(() => readTitle("Just text.\n\n## Not a title\n", "docs/untitled.md")).toThrow(
      /docs\/untitled\.md: no title could be read/,
    );
    const broken = withFiles({ "docs/untitled.md": "No heading here.\n" });
    expect(() => convertSection(broken)).toThrow(/docs\/untitled\.md: no title could be read/);
  });

  it("takes the first paragraph, as plain text, as the description, past badges", () => {
    expect(page(diagrams.pages, "en", "player").description).toBe(
      "The player plays a story in any browser, from one HTML file, with pause, progress and a static view. Its pictures are the same as the exports of a story.",
    );
    expect(page(ide.pages, "en", "index").description).toBe(
      "The spec-driven control plane for agentic development. It orchestrates the coding agents you already use, under a discipline where no line is written without a reviewed specification.",
    );
    const long = readDescription(`${"word ".repeat(100)}\n`)!;
    expect(long.length).toBeLessThanOrEqual(300);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("the twin link", () => {
  it("drops a first-line link to the other language's twin", () => {
    expect(dropTwinLink("[Español](es/player.md)\n\nThe player.\n")).toBe("The player.\n");
    expect(dropTwinLink("[English](../player.md)\n\nEl reproductor.\n")).toBe("El reproductor.\n");
    expect(dropTwinLink("The player links [Español](es/player.md) later.\n")).toContain("Español");
    expect(page(diagrams.pages, "en", "player").body).not.toContain("Español");
    expect(page(diagrams.pages, "es", "player").body).not.toContain("[English]");
  });
});

describe("the links", () => {
  const player = page(diagrams.pages, "en", "player").body;

  it("turns links to pages inside docs/ into portal routes, with their anchors", () => {
    expect(player).toContain("[exports of a story](/diagrams/language/stories/#exports)");
    expect(page(diagrams.pages, "es", "player").body).toContain(
      "(/es/diagrams/language/stories/#exportaciones)",
    );
  });

  it("turns links to files outside docs/ into GitHub links at the source's ref", () => {
    expect(player).toContain(
      "[changelog](https://github.com/askenaz-dev/meltemi-diagrams/blob/v1.11.0/CHANGELOG.md)",
    );
    expect(page(ide.pages, "en", "index").body).toContain(
      "[LICENSE](https://github.com/askenaz-dev/meltemi/blob/v0.2.29/LICENSE)",
    );
    expect(page(web.pages, "en", "repositories").body).toContain(
      "[decisions](https://github.com/askenaz-dev/meltemi-web/tree/",
    );
  });

  it("points media links at the copied files and carries the files into the build", () => {
    expect(player).toContain(
      "![The editor, the canvas and the player](/diagrams/media/editing-demo.gif)",
    );
    expect(page(diagrams.pages, "es", "player").body).toContain(
      "(/diagrams/media/editing-demo.gif)",
    );
    expect([...diagrams.media.keys()]).toEqual(["diagrams/media/editing-demo.gif"]);
    expect(diagrams.media.get("diagrams/media/editing-demo.gif")!.length).toBe(43);
  });

  it("rewrites reference definitions and HTML links, and leaves code as written", () => {
    expect(player).toContain("[cli]: /diagrams/cli/");
    expect(player).toContain('<a href="/diagrams/cli/">');
    expect(player).toContain("`[stories](language/stories.md)`");
    expect(player).toContain("[not a link](nowhere.md)");
  });

  it("writes a picture from another host as its words, so nothing loads from elsewhere", () => {
    expect(player).toContain("[npm](https://www.npmjs.com/package/@meltemi/diagrams-cli)");
    expect(player).not.toContain("img.shields.io");
    expect(page(ide.pages, "en", "index").body).not.toContain("badge.svg");
    const ctx = linkContext(tree("diagrams"), sourcePages(tree("diagrams")));
    expect(
      rewriteLinks(
        "[![](https://img.example/b.svg)](https://example.com/) Text.",
        "docs/x.md",
        ctx,
      ),
    ).toBe(" Text.");
  });

  it("reaches the readmes that index a section, and the notice page of a missing twin", () => {
    expect(page(ide.pages, "en", "index").body).toContain("[LEEME.md](/es/ide/)");
    expect(page(diagrams.pages, "es", "getting-started").body).toContain("(/diagrams/cli/)");
    const ctx = linkContext(tree("diagrams"), sourcePages(tree("diagrams")));
    expect(resolveLink("cli.md", "docs/es/README.md", ctx)).toMatchObject({
      kind: "page",
      url: "/es/diagrams/cli/",
    });
  });

  it("fails naming the page and the link that leads nowhere", () => {
    const ctx = linkContext(tree("diagrams"), sourcePages(tree("diagrams")));
    expect(() => rewriteLinks("See [it](nowhere.md).", "docs/player.md", ctx)).toThrow(
      /docs\/player\.md: the link nowhere\.md leads to no page/,
    );
    const index = tree("diagrams").files.get("docs/README.md")!.toString();
    const broken = withFiles({ "docs/README.md": `${index}\n- [Missing](missing.md)\n` });
    expect(() => convertSection(broken)).toThrow(/docs\/README\.md: the link missing\.md/);
  });

  it("names the GitHub source of every page at its ref", () => {
    expect(page(diagrams.pages, "en", "player").editUrl).toBe(
      "https://github.com/askenaz-dev/meltemi-diagrams/blob/v1.11.0/docs/player.md",
    );
    expect(page(diagrams.pages, "es", "player").editUrl).toBe(
      "https://github.com/askenaz-dev/meltemi-diagrams/blob/v1.11.0/docs/es/player.md",
    );
  });
});

describe("the sidebar", () => {
  it("follows the index's order, then the pages it does not link in path order", () => {
    expect(sidebarOrder(diagrams.sidebar)).toEqual([
      "diagrams",
      "diagrams/getting-started",
      "diagrams/features",
      "diagrams/language/stories",
      "diagrams/cli",
      "diagrams/player",
    ]);
    expect(page(diagrams.pages, "en", "language/stories").order).toBe(3);
    expect(page(diagrams.pages, "es", "language/stories").order).toBe(3);
  });

  it("groups the pages under the index's headings, named in both languages", () => {
    const start = diagrams.sidebar.find((node) => "label" in node && node.label === "Start");
    expect(start).toMatchObject({ label: "Start", translations: { es: "Para empezar" } });
    const other = diagrams.sidebar.at(-1)!;
    expect(other).toMatchObject({ label: "Other pages", translations: { es: "Otras páginas" } });
  });

  it("takes the repository's readme as the index when docs/ has none, and folds folders", () => {
    expect(sidebarOrder(ide.sidebar)).toEqual(["ide", "ide/quickstart", "ide/local-models"]);
    expect(sidebarOrder(web.sidebar)).toEqual([
      "web",
      "web/repositories",
      "web/decisions/0001-family-repositories",
    ]);
    expect(web.sidebar.at(-1)).toMatchObject({ label: "Decisions", collapsed: true });
  });
});

describe("one language only", () => {
  it("reads a page's language from its words when the repository has no docs/es/", () => {
    expect(
      detectLanguage("De los instaladores de la release a una sesión con el agente que ya tienes."),
    ).toBe("es");
    expect(
      detectLanguage("From the release assets to a governed session with the agent you have."),
    ).toBe("en");
    expect(detectLanguage("```\nthe the the the\n```\nUna guía de la sesión y el agente.")).toBe(
      "es",
    );
  });

  it("writes a notice page in the other locale with the title, the sentence and a link", () => {
    const spanish = page(ide.pages, "es", "quickstart");
    expect(spanish.notice).toBe(false);
    expect(spanish.url).toBe("/es/ide/quickstart/");
    const english = page(ide.pages, "en", "quickstart");
    expect(english.notice).toBe(true);
    expect(english.url).toBe("/ide/quickstart/");
    expect(english.title).toBe(spanish.title);
    expect(english.body).toContain("This guide exists in Spanish only.");
    expect(english.body).toContain('href="/es/ide/quickstart/"');
    const cli = page(diagrams.pages, "es", "cli");
    expect(cli.notice).toBe(true);
    expect(cli.body).toContain("Esta guía sólo existe en inglés.");
    expect(cli.body).toContain('href="/diagrams/cli/"');
  });

  it("gives every section both locales of every page", () => {
    for (const section of [diagrams, ide, web]) {
      const ids = new Set(section.pages.map((p) => p.id));
      for (const id of ids) {
        expect(
          section.pages
            .filter((p) => p.id === id)
            .map((p) => p.lang)
            .sort(),
          `${section.section}/${id}`,
        ).toEqual(["en", "es"]);
      }
    }
  });
});

describe("the page file", () => {
  it("writes Starlight's frontmatter: title, description, slug, source, order, and keeps notices out of search", () => {
    const text = renderPage(page(diagrams.pages, "en", "player"));
    expect(text).toMatch(/^---\ntitle: "The HTML player"\ndescription: "The player plays/);
    expect(text).toContain('slug: "diagrams/player"');
    expect(text).toContain(
      'editUrl: "https://github.com/askenaz-dev/meltemi-diagrams/blob/v1.11.0/docs/player.md"',
    );
    expect(text).toContain("sidebar:\n  order: 5");
    expect(text).not.toContain("pagefind: false");
    expect(renderPage(page(ide.pages, "en", "quickstart"))).toContain("pagefind: false");
  });
});
