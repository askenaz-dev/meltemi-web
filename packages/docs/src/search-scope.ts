import type { Section } from "./messages/index.js";

export const PRODUCTS: readonly Section[] = ["diagrams", "ide", "web"];
export type SearchScope = Section | "all";

export const isProduct = (value: unknown): value is Section =>
  typeof value === "string" && (PRODUCTS as readonly string[]).includes(value);

/** The current route selects a product; the family home and unknown routes use all guides. */
export function scopeForId(id: string): SearchScope {
  const first = id
    .replace(/^\/+/, "")
    .replace(/^es(?:\/|$)/, "")
    .split("/")[0];
  return isProduct(first) ? first : "all";
}
