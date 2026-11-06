import { describe, expect, it } from "vitest";
import { scopeForId } from "../src/search-scope.js";

describe("route-default documentation scope", () => {
  it.each(["", "index", "es", "es/index", "404", "diagrams-other/page"])(
    "uses all products on %s",
    (id) => {
      expect(scopeForId(id)).toBe("all");
    },
  );
  it.each(["diagrams", "ide", "web"] as const)(
    "uses %s for both locales and nested pages",
    (product) => {
      for (const id of [
        product,
        `${product}/guide`,
        `es/${product}/guide`,
        `/es/${product}/guide`,
      ]) {
        expect(scopeForId(id)).toBe(product);
      }
    },
  );
});
