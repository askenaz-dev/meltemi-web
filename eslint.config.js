// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.wrangler/**",
      "coverage/**",
      "openspec/**",
      ".claude/**",
      ".codex/**",
      "packages/site/public/**",
      "packages/docs/.astro/**",
      "packages/docs/.cache/**",
      "packages/docs/.test-builds/**",
      "packages/docs/public/**",
      "packages/docs/src/content/**",
      "packages/docs/src/generated/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
