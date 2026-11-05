// @ts-check
// The portal's Starlight site (design decision 1). Its pages are written by `scripts/build.ts`
// into `src/content/docs/`, with the sidebar it reads from the sections' own indexes into
// `src/generated/sidebar.json`; run the build, not `astro build` alone.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import starlight from "@astrojs/starlight";
import { defineConfig, passthroughImageService } from "astro/config";

const generated = fileURLToPath(new URL("./src/generated/sidebar.json", import.meta.url));
if (!existsSync(generated)) {
  throw new Error(
    "src/generated/sidebar.json is missing: build the portal with `pnpm --filter @meltemi/docs build`",
  );
}
const sidebar = JSON.parse(readFileSync(generated, "utf8"));

export default defineConfig({
  site: "https://docs.meltemi.dev",
  trailingSlash: "always",
  // No native dependency and no transformation: the pictures and media are served as written.
  image: { service: passthroughImageService() },
  devToolbar: { enabled: false },
  vite: {
    // Every script a page runs is a file of the portal: none is inlined into a page.
    build: { assetsInlineLimit: 0 },
  },
  integrations: [
    starlight({
      title: { en: "Meltemi docs", es: "Documentación de Meltemi" },
      description:
        "The documentation of the Meltemi family: Meltemi Diagrams, Meltemi IDE and Meltemi Web, in English and Spanish.",
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        es: { label: "Español", lang: "es" },
      },
      favicon: "/media/meltemi-mark-gradient.svg",
      sidebar,
      pagefind: true,
      lastUpdated: false,
      credits: false,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      customCss: ["./src/styles/tokens.css", "./src/styles/portal.css"],
      expressiveCode: {
        useStarlightUiThemeColors: true,
        styleOverrides: {
          borderRadius: "var(--radius-panel)",
          codeFontFamily: "var(--font-mono)",
          uiFontFamily: "var(--font-ui)",
        },
      },
      components: {
        Footer: "./src/components/Footer.astro",
        LanguageSelect: "./src/components/LanguageSelect.astro",
        Search: "./src/components/Search.astro",
        SiteTitle: "./src/components/SiteTitle.astro",
      },
      routeMiddleware: "./src/route-data.ts",
    }),
  ],
});
