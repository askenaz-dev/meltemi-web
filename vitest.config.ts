import { defineConfig } from "vitest/config";

// One root configuration runs the tests of every workspace package, in Node, with no network.
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
  },
});
