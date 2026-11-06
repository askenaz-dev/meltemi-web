import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DOCS_DISPATCH_RESOURCE,
  validateDocsDispatchPlan,
} from "../scripts/docs-dispatch-bootstrap-plan.mjs";

const script = fileURLToPath(
  new URL("../scripts/docs-dispatch-bootstrap-plan.mjs", import.meta.url),
);
const identity = { repository: "meltemi-diagrams", secret_name: "WEB_DISPATCH_TOKEN" };
const target = (action = "create") => ({
  address: DOCS_DISPATCH_RESOURCE,
  mode: "managed",
  type: "github_actions_secret",
  change: {
    actions: [action],
    before: action === "create" ? null : { ...identity, value: "dummy-old-notice-value" },
    after: { ...identity, value: "dummy-new-notice-value" },
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

describe("the documentation notice secret boundary", () => {
  it.each(["create", "update", "no-op"])("accepts only target %s", (action) => {
    expect(validateDocsDispatchPlan(plan(action))).toBe(action === "no-op" ? 0 : 1);
  });

  it("allows unchanged managed dependencies and data reads", () => {
    const source = plan();
    source.resource_changes.push({
      address: "data.github_repository.destination",
      mode: "data",
      change: { actions: ["read"] },
    });
    expect(validateDocsDispatchPlan(source)).toBe(1);
  });

  it.each(["create", "update", "delete", "read"])("rejects dependency %s", (action) => {
    const source = plan();
    source.resource_changes[1] = dependency(action);
    expect(() => validateDocsDispatchPlan(source)).toThrow();
  });

  it.each([["delete"], ["read"], ["create", "delete"], ["delete", "create"], []])(
    "rejects disallowed target actions %j",
    (...actions) => {
      const resource = target();
      resource.change.actions = actions;
      expect(() => validateDocsDispatchPlan({ ...plan(), resource_changes: [resource] })).toThrow();
    },
  );

  it.each([
    { previous_address: "another.resource" },
    { deposed: "deadbeef" },
    { change: { ...target().change, importing: { id: "some-secret" } } },
    { mode: "data" },
    { type: "github_repository" },
    { address: 'github_actions_secret.release["meltemi-diagrams/NPM_TOKEN"]' },
    { change: { ...target().change, after: { ...identity, repository: "meltemi-web" } } },
    { change: { ...target().change, after: { ...identity, secret_name: "NPM_TOKEN" } } },
    { change: { ...target().change, after_unknown: { repository: true } } },
    { change: { ...target().change, after_unknown: { secret_name: true } } },
  ])("rejects wrong identity, imports, moves and unknown destination %j", (patch) => {
    expect(() =>
      validateDocsDispatchPlan({ ...plan(), resource_changes: [{ ...target(), ...patch }] }),
    ).toThrow();
  });

  it("rejects an update/no-op whose old destination differs", () => {
    for (const action of ["update", "no-op"]) {
      const resource = target(action);
      resource.change.before = { ...identity, repository: "meltemi-web", value: "dummy-old" };
      expect(() => validateDocsDispatchPlan({ ...plan(), resource_changes: [resource] })).toThrow();
    }
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
    expect(() => validateDocsDispatchPlan(source)).toThrow();
  });

  it("verification accepts only a no-op target", () => {
    expect(validateDocsDispatchPlan(plan("no-op"), true)).toBe(0);
    expect(() => validateDocsDispatchPlan(plan("create"), true)).toThrow();
    expect(() => validateDocsDispatchPlan(plan("update"), true)).toThrow();
  });

  it("the CLI logs counts, never plan values", () => {
    const result = spawnSync(process.execPath, [script], {
      input: JSON.stringify(plan()),
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 permitted resource mutation");
    expect(result.stdout + result.stderr).not.toContain("dummy-new-notice-value");
  });

  it("the CLI hides JSON errors and rejects unreviewed options", () => {
    for (const args of [[], ["--unknown"], ["--verify", "--extra"]]) {
      const result = spawnSync(process.execPath, [script, ...args], {
        input: '{"value":"dummy-never-print-this",invalid-json}',
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).not.toContain("dummy-never-print-this");
      expect(result.stderr).toContain("Documentation notice plan rejected");
    }
  });
});

describe("the isolated bootstrap operation", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/infra-apply.yml", import.meta.url),
    "utf8",
  );
  const at = (text: string) => {
    const index = workflow.indexOf(text);
    expect(index, text).toBeGreaterThanOrEqual(0);
    return index;
  };

  it("is manual-only and restricted to its repository and operation branch", () => {
    expect(workflow).toContain("on:\n  workflow_dispatch:");
    expect(workflow).not.toMatch(/^ {2}(?:push|pull_request|workflow_run|schedule):/m);
    expect(workflow).toContain("github.repository == 'askenaz-dev/meltemi-web'");
    expect(workflow).toContain("github.ref == 'refs/heads/codex/docs-dispatch-bootstrap-only'");
    expect(workflow).toContain("environment: infrastructure");
  });

  it("retains main's complete production reconciliation queue", () => {
    for (const source of [
      workflow,
      readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
    ]) {
      expect(source).toMatch(
        /group: production-reconciliation\n {2}cancel-in-progress: false\n {2}queue: max/,
      );
    }
  });

  it("uses only the explicit notice input and rejects missing/admin-equal values", () => {
    expect(workflow).toContain(
      "TF_VAR_narrow_web_dispatch_token: ${{ secrets.WEB_DISPATCH_TOKEN }}",
    );
    expect(workflow).not.toContain("WEB_DISPATCH_TOKEN ||");
    expect(workflow).not.toContain("TF_VAR_web_dispatch_token:");
    expect(at('if [ -z "$TF_VAR_narrow_web_dispatch_token" ]')).toBeLessThan(at("terraform init"));
    expect(at('if [ "$TF_VAR_narrow_web_dispatch_token" = "$GITHUB_TOKEN" ]')).toBeLessThan(
      at("terraform init"),
    );
  });

  it("pins the reviewed declarations and verifies their successful/current main CI", () => {
    expect(workflow).toContain("ref: 8169b0c60e8ff503e721266fcfc2b6ecde8f752b");
    expect(workflow).toContain('"42128386923"');
    expect(at("await resolveSource(")).toBeLessThan(
      at("ref: 8169b0c60e8ff503e721266fcfc2b6ecde8f752b"),
    );
    expect(workflow).toContain('source.current !== "true"');
    expect(at("gh api repos/askenaz-dev/meltemi-web/git/ref/heads/main")).toBeLessThan(
      at("terraform apply"),
    );
  });

  it("only overrides the known repository-name lookup before planning", () => {
    const override = readFileSync(
      new URL("../scripts/docs-dispatch-bootstrap-override.tf", import.meta.url),
      "utf8",
    );
    expect(override.replace(/^#.*$/gm, "").trim()).toMatch(
      /^resource "github_actions_secret" "release" \{\s+repository = each\.value\.repository\s+\}$/,
    );
    expect(
      at('cp "$GITHUB_WORKSPACE/operation/scripts/docs-dispatch-bootstrap-override.tf"'),
    ).toBeLessThan(at("terraform plan"));
  });

  it("checks the original provider versions without upgrading", () => {
    for (const version of ['"5.28.0"', '"3.9.1"', '"6.13.0"']) expect(workflow).toContain(version);
    expect(workflow).not.toContain("-upgrade");
    expect(workflow).not.toContain("-lockfile=readonly");
  });

  it("validates the saved target plan and applies exactly that plan", () => {
    expect(
      workflow.match(
        /-target='github_actions_secret\.release\["meltemi-diagrams\/WEB_DISPATCH_TOKEN"\]'/g,
      ),
    ).toHaveLength(2);
    expect(at("terraform show -json docs-dispatch.tfplan | node")).toBeLessThan(
      at("terraform apply -no-color -lock-timeout=5m docs-dispatch.tfplan"),
    );
    expect(workflow).not.toMatch(/terraform apply[^\n]*-(?:target|auto-approve)/);
    expect(workflow).toContain('if [ "$code" != 0 ]');
    expect(workflow).toContain('docs-dispatch-bootstrap-plan.mjs" --verify');
  });

  it("returns only secret metadata and cleans sensitive local files even after failure", () => {
    expect(workflow).toContain("actions/secrets/WEB_DISPATCH_TOKEN --jq '{name, updated_at}'");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain(
      "rm -f source/packages/infra/docs-dispatch.tfplan source/packages/infra/docs-dispatch-verify.tfplan source/packages/infra/docs_dispatch_bootstrap_override.tf",
    );
    expect(workflow).not.toContain("actions/upload-artifact");
    expect(workflow).not.toContain("terraform output");
    expect(workflow).not.toContain("set -x");
  });
});
