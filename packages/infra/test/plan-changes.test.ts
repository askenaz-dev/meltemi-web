// The drift check's reading of a plan: an update that only turns computed values unknown is no
// difference, anything else is, and nothing it prints is a value.

import { describe, expect, it } from "vitest";
import { knownDifferences, realChanges } from "../scripts/plan-changes.mjs";

const change = (address: string, actions: string[], before: unknown, after: unknown) => ({
  address,
  change: { actions, before, after },
});

describe("plan-changes", () => {
  it("ignores the D1 update whose known values all equal the state's", () => {
    // `terraform show -json` leaves unknown values out of `after`.
    const d1 = change(
      "cloudflare_d1_database.identity",
      ["update"],
      {
        id: "5d2c",
        name: "meltemi-identity",
        file_size: 73728,
        num_tables: 5,
        version: "production",
      },
      { id: "5d2c", name: "meltemi-identity" },
    );
    expect(realChanges({ resource_changes: [d1] })).toEqual([]);
  });

  it("reports an update with a known difference by attribute name, never its value", () => {
    const site = change(
      'cloudflare_web_analytics_site.zone["dev"]',
      ["update"],
      { auto_install: false, enabled: true, site_token: "secret-token" },
      { auto_install: true, enabled: false, site_token: "secret-token" },
    );
    const [line] = realChanges({ resource_changes: [site] });
    expect(line).toBe('cloudflare_web_analytics_site.zone["dev"]: update (auto_install, enabled)');
    expect(line).not.toContain("secret-token");
  });

  it("reports creations, deletions and replacements, and skips no-ops and reads", () => {
    const plan = {
      resource_changes: [
        change("a", ["create"], null, { name: "a" }),
        change("b", ["delete"], { name: "b" }, null),
        change("c", ["delete", "create"], { name: "c" }, { name: "c2" }),
        change("d", ["no-op"], { name: "d" }, { name: "d" }),
        change("e", ["read"], null, { name: "e" }),
      ],
    };
    expect(realChanges(plan)).toEqual(["a: create", "b: delete", "c: delete, create"]);
    expect(realChanges({})).toEqual([]);
  });

  it("compares nested values whole and treats a missing prior value as null", () => {
    expect(knownDifferences({ s: { enabled: false } }, { s: { enabled: false } })).toEqual([]);
    expect(knownDifferences({ s: { enabled: false } }, { s: { enabled: true } })).toEqual(["s"]);
    expect(knownDifferences({}, { comment: null })).toEqual([]);
    expect(knownDifferences(null, { name: "x" })).toEqual(["name"]);
  });
});
