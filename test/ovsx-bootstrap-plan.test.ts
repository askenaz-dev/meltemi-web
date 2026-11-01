import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OVSX_RESOURCE, validateOvsxPlan } from "../scripts/ovsx-bootstrap-plan.mjs";

const script = fileURLToPath(new URL("../scripts/ovsx-bootstrap-plan.mjs", import.meta.url));
const target = (action = "create") => ({
  address: OVSX_RESOURCE,
  mode: "managed",
  type: "github_actions_secret",
  change: {
    actions: [action],
    after: { repository: "meltemi-diagrams", secret_name: "OVSX_PAT", value: "dummy-not-a-token" },
  },
});
const dependency = (action = "no-op") => ({
  address: 'github_repository.family["meltemi-diagrams"]',
  mode: "managed",
  change: { actions: [action] },
});
const plan = (action = "create") => ({
  format_version: "1.2",
  complete: false,
  errored: false,
  resource_changes: [target(action), dependency()],
});

describe("the Open VSX bootstrap boundary", () => {
  it("the temporary override changes only the repository-name lookup", () => {
    const override = readFileSync(
      new URL("../scripts/ovsx-bootstrap-override.tf", import.meta.url),
      "utf8",
    );
    expect(override.replace(/^#.*$/gm, "").trim()).toMatch(
      /^resource "github_actions_secret" "release" \{\s+repository = each\.value\.repository\s+\}$/,
    );
  });

  it.each(["create", "update", "no-op"])(
    "accepts only %s of the existing secret address",
    (action) => {
      expect(validateOvsxPlan(plan(action))).toBe(action === "no-op" ? 0 : 1);
    },
  );

  it("accepts a data read without expanding mutation scope", () => {
    const source = plan();
    source.resource_changes.push({
      address: "data.github_repository.family",
      mode: "data",
      change: { actions: ["read"] },
    });
    expect(validateOvsxPlan(source)).toBe(1);
  });

  it.each(["create", "update", "delete", "read"])("rejects a dependency %s", (action) => {
    const source = plan();
    source.resource_changes[1] = dependency(action);
    expect(() => validateOvsxPlan(source)).toThrow();
  });

  it.each([["delete"], ["read"], ["create", "delete"], ["delete", "create"], []])(
    "rejects disallowed target actions %j",
    (...actions) => {
      const resource = target();
      resource.change.actions = actions;
      expect(() => validateOvsxPlan({ ...plan(), resource_changes: [resource] })).toThrow();
    },
  );

  it.each([
    { previous_address: "another.resource" },
    { deposed: "deadbeef" },
    { change: { ...target().change, importing: { id: "existing-secret" } } },
    { type: "github_repository" },
    { mode: "data" },
    {
      change: { ...target().change, after: { repository: "meltemi-web", secret_name: "OVSX_PAT" } },
    },
    {
      change: {
        ...target().change,
        after: { repository: "meltemi-diagrams", secret_name: "NPM_TOKEN" },
      },
    },
  ])("rejects unexpected target identity or state operations %j", (patch) => {
    expect(() =>
      validateOvsxPlan({ ...plan(), resource_changes: [{ ...target(), ...patch }] }),
    ).toThrow();
  });

  it.each([
    null,
    {},
    { ...plan(), format_version: "2.0" },
    { ...plan(), errored: true },
    { ...plan(), errored: undefined },
    { ...plan(), deferred_changes: [{}] },
    { ...plan(), resource_changes: [] },
    { ...plan(), resource_changes: [dependency()] },
    { ...plan(), resource_changes: [target(), target()] },
    { ...plan(), resource_changes: [null] },
  ])("rejects an invalid, deferred or ambiguous plan %j", (source) => {
    expect(() => validateOvsxPlan(source)).toThrow();
  });

  it("verification accepts only an unchanged target", () => {
    expect(validateOvsxPlan(plan("no-op"), true)).toBe(0);
    expect(() => validateOvsxPlan(plan("create"), true)).toThrow();
    expect(() => validateOvsxPlan(plan("update"), true)).toThrow();
  });

  it("the CLI accepts stdin without printing its values", () => {
    const result = spawnSync(process.execPath, [script], {
      input: JSON.stringify(plan()),
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 permitted resource mutation");
    expect(result.stdout + result.stderr).not.toContain("dummy-not-a-token");
  });

  it("the CLI hides parse errors and rejects unknown options", () => {
    for (const args of [[], ["--unknown"]]) {
      const result = spawnSync(process.execPath, [script, ...args], {
        input: '{"value":"dummy-not-a-token",invalid-json}',
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).not.toContain("dummy-not-a-token");
      expect(result.stderr).toContain("Open VSX plan rejected");
    }
  });
});
