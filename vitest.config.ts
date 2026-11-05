import { defineConfig } from "vitest/config";

// One root configuration runs the tests of every workspace package, in Node, with no network.
// The portal's checks that time a ranking or start processes (the command line, Astro's build)
// run after the rest, each group on its own, so no test's timing depends on another's load.
const TIMED = ["packages/docs/test/ask.test.ts"];
const PROCESSES = [
  "packages/docs/test/pictures.test.ts",
  "packages/docs/test/sources.test.ts",
  "packages/docs/test/portal.test.ts",
];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "workspace",
          include: ["packages/*/test/**/*.test.ts", "test/**/*.test.ts"],
          exclude: [...TIMED, ...PROCESSES, "**/node_modules/**"],
          environment: "node",
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: "portal-timed",
          include: TIMED,
          environment: "node",
          sequence: { groupOrder: 1 },
        },
      },
      {
        test: {
          name: "portal-processes",
          include: PROCESSES,
          environment: "node",
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});
