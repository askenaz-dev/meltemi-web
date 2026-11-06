import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MCP_CREDENTIAL_TARGETS,
  validateMcpCredentialInputs,
  validateMcpCredentialPlan,
} from "../scripts/mcp-credentials-bootstrap-plan.mjs";

const script = fileURLToPath(
  new URL("../scripts/mcp-credentials-bootstrap-plan.mjs", import.meta.url),
);
const entries = Object.entries(MCP_CREDENTIAL_TARGETS);
const dummyInputs = () => ({
  staging: { token: `mdg_${"a".repeat(43)}`, token_2: `mdg_${"b".repeat(43)}` },
  production: { token: `mdg_${"c".repeat(43)}`, token_2: `mdg_${"d".repeat(43)}` },
});
const target = (action = "create", index = 0) => {
  const [address, identity] = entries[index];
  return {
    address,
    mode: "managed",
    type: "github_actions_environment_secret",
    change: {
      actions: [action],
      before: action === "create" ? null : { ...identity, value: "dummy-private-old-value" },
      after: { ...identity, value: "dummy-private-new-value" },
      after_unknown: {} as Record<string, boolean>,
    },
  };
};
const plan = (action = "create") => ({
  format_version: "1.2",
  complete: false,
  errored: false,
  resource_changes: entries.map((_, index) => target(action, index)),
});

describe("the four explicit credential inputs", () => {
  it("accepts four distinct base64url test inputs", () => {
    expect(() => validateMcpCredentialInputs(dummyInputs())).not.toThrow();
  });

  it.each([null, {}, [], { staging: dummyInputs().staging }, { ...dummyInputs(), other: {} }])(
    "rejects missing or additional environments %j",
    (inputs) => expect(() => validateMcpCredentialInputs(inputs)).toThrow(),
  );

  it.each(["staging", "production"] as const)("requires both fields in %s", (environment) => {
    for (const fields of [
      {},
      { token: dummyInputs().staging.token },
      { ...dummyInputs().staging, extra: "x" },
    ]) {
      expect(() =>
        validateMcpCredentialInputs({ ...dummyInputs(), [environment]: fields }),
      ).toThrow();
    }
  });

  it.each([
    "",
    "admin-token",
    "mdg_short",
    `mdg_${"a".repeat(44)}`,
    `mdg_${"!".repeat(43)}`,
    1,
    null,
  ])("rejects malformed values without a provider fallback %j", (value) => {
    const inputs = { ...dummyInputs(), staging: { ...dummyInputs().staging, token: value } };
    expect(() => validateMcpCredentialInputs(inputs)).toThrow();
  });

  it("rejects reuse within an environment and across hosts", () => {
    const pair = dummyInputs();
    pair.staging.token_2 = pair.staging.token;
    expect(() => validateMcpCredentialInputs(pair)).toThrow();
    const hosts = dummyInputs();
    hosts.production.token = hosts.staging.token;
    expect(() => validateMcpCredentialInputs(hosts)).toThrow();
  });
});

describe("the four-resource plan boundary", () => {
  it.each(["create", "update", "no-op"])("accepts four exact targets with %s", (action) => {
    expect(validateMcpCredentialPlan(plan(action))).toBe(action === "no-op" ? 0 : 4);
  });

  it("accepts mixed permitted actions and counts only mutations", () => {
    const source = plan("no-op");
    source.resource_changes[0] = target("create");
    source.resource_changes[1] = target("update", 1);
    expect(validateMcpCredentialPlan(source)).toBe(2);
  });

  it("allows only unchanged managed dependencies and data reads", () => {
    const source = {
      ...plan(),
      resource_changes: [
        ...plan().resource_changes,
        { address: "github_repository.unchanged", mode: "managed", change: { actions: ["no-op"] } },
        { address: "data.github_repository.read", mode: "data", change: { actions: ["read"] } },
      ],
    };
    expect(validateMcpCredentialPlan(source)).toBe(4);
  });

  it.each(["create", "update", "delete", "read"])(
    "rejects another managed resource's %s",
    (action) => {
      const source = {
        ...plan(),
        resource_changes: [
          ...plan().resource_changes,
          {
            address: "cloudflare_d1_database.other",
            mode: "managed",
            change: { actions: [action] },
          },
        ],
      };
      expect(() => validateMcpCredentialPlan(source)).toThrow();
    },
  );

  it.each([["delete"], ["read"], ["create", "delete"], ["delete", "create"], []])(
    "rejects disallowed target actions %j",
    (...actions) => {
      const source = plan();
      source.resource_changes[0].change.actions = actions;
      expect(() => validateMcpCredentialPlan(source)).toThrow();
    },
  );

  it.each(["repository", "environment", "secret_name"])("rejects wrong or unknown %s", (field) => {
    const wrong = plan();
    Object.assign(wrong.resource_changes[0].change.after, { [field]: "another-destination" });
    expect(() => validateMcpCredentialPlan(wrong)).toThrow();
    const unknown = plan();
    unknown.resource_changes[0].change.after_unknown[field] = true;
    expect(() => validateMcpCredentialPlan(unknown)).toThrow();
    for (const action of ["update", "no-op"]) {
      const old = plan(action);
      Object.assign(old.resource_changes[0].change.before!, { [field]: "another-old-destination" });
      expect(() => validateMcpCredentialPlan(old)).toThrow();
    }
  });

  it.each([
    { previous_address: "another.resource" },
    { deposed: "deadbeef" },
    { mode: "data" },
    { type: "github_actions_secret" },
    {
      address:
        'github_actions_environment_secret.mcp_test_token["meltemi-diagrams/staging/NPM_TOKEN"]',
    },
    { change: { ...target().change, importing: { id: "private-id" } } },
    { change: { ...target().change, before: { repository: "another-repository" } } },
    { change: { ...target().change, after_unknown: true } },
    { change: { ...target().change, after_unknown: { environment: "unknown" } } },
  ])("rejects imports, moves, malformed targets and unknown identity %j", (patch) => {
    const source = {
      ...plan(),
      resource_changes: [{ ...target(), ...patch }, ...plan().resource_changes.slice(1)],
    };
    expect(() => validateMcpCredentialPlan(source)).toThrow();
  });

  it.each([
    null,
    {},
    { ...plan(), format_version: "2.0" },
    { ...plan(), errored: true },
    { ...plan(), errored: undefined },
    { ...plan(), deferred_changes: [{}] },
    { ...plan(), deferred_changes: {} },
    { ...plan(), resource_changes: [] },
    { ...plan(), resource_changes: plan().resource_changes.slice(1) },
    { ...plan(), resource_changes: [...plan().resource_changes, target()] },
    { ...plan(), resource_changes: [null, ...plan().resource_changes.slice(1)] },
  ])("rejects incomplete, deferred or ambiguous plans %j", (source) => {
    expect(() => validateMcpCredentialPlan(source)).toThrow();
  });

  it("requires all four no-op targets for verification", () => {
    expect(validateMcpCredentialPlan(plan("no-op"), true)).toBe(0);
    for (const action of ["create", "update"]) {
      const source = plan("no-op");
      source.resource_changes[2] = target(action, 2);
      expect(() => validateMcpCredentialPlan(source, true)).toThrow();
    }
  });

  it("the CLI emits only counts for plans and no values for inputs", () => {
    for (const args of [[], ["--inputs"]]) {
      const result = spawnSync(process.execPath, [script, ...args], {
        input: JSON.stringify(plan()),
        env: { ...process.env, TF_VAR_mcp_test_tokens: JSON.stringify(dummyInputs()) },
        encoding: "utf8",
      });
      expect(result.status).toBe(0);
      expect(result.stdout + result.stderr).not.toContain("dummy-private-new-value");
      expect(result.stdout + result.stderr).not.toContain(dummyInputs().staging.token);
    }
  });

  it("hides parse errors and rejects unreviewed CLI modes", () => {
    for (const args of [[], ["--inputs"], ["--other"], ["--verify", "--extra"]]) {
      const malformed = '{"value":"dummy-never-print-this",invalid-json}';
      const result = spawnSync(process.execPath, [script, ...args], {
        input: malformed,
        env: { ...process.env, TF_VAR_mcp_test_tokens: malformed },
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).not.toContain("dummy-never-print-this");
      expect(result.stderr).toContain("MCP credential operation rejected");
    }
  });
});

describe("the isolated operation workflow", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/infra-apply.yml", import.meta.url),
    "utf8",
  );
  const at = (text: string) => {
    const index = workflow.indexOf(text);
    expect(index, text).toBeGreaterThanOrEqual(0);
    return index;
  };

  it("is manual-only and restricted to this repository and operation branch", () => {
    expect(workflow).toContain("on:\n  workflow_dispatch:");
    expect(workflow).not.toMatch(/^ {2}(?:push|pull_request|workflow_run|schedule):/m);
    expect(workflow).toContain("github.repository == 'askenaz-dev/meltemi-web'");
    expect(workflow).toContain("github.ref == 'refs/heads/codex/mcp-credentials-bootstrap-only'");
    expect(workflow).toContain("environment: infrastructure");
    expect(workflow).toContain("timeout-minutes: 15");
  });

  it("retains the complete shared production queue", () => {
    for (const source of [
      workflow,
      readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
    ]) {
      expect(source).toMatch(
        /group: production-reconciliation\n {2}cancel-in-progress: false\n {2}queue: max/,
      );
    }
  });

  it("uses exactly the four canonical inputs without admin fallback before backend access", () => {
    expect(workflow.match(/secrets\.MCP_TEST_TOKEN(?:_2)?_(?:STAGING|PRODUCTION)/g)).toHaveLength(
      4,
    );
    for (const name of [
      "MCP_TEST_TOKEN_STAGING",
      "MCP_TEST_TOKEN_2_STAGING",
      "MCP_TEST_TOKEN_PRODUCTION",
      "MCP_TEST_TOKEN_2_PRODUCTION",
    ]) {
      expect(workflow).toContain(`secrets.${name} }}`);
    }
    expect(workflow).not.toMatch(/secrets\.MCP_TEST_TOKEN[^}\n]*\|\|/);
    expect(at("node scripts/mcp-credentials-bootstrap-plan.mjs --inputs")).toBeLessThan(
      at("terraform init"),
    );
  });

  it("pins successful/current CI and guards again before both plan and apply", () => {
    expect(workflow).toContain('"42252346648"');
    expect(workflow).toContain("ref: f2b1af34fb448f497a6dc741beae74dd94266661");
    expect(at("await resolveSource(")).toBeLessThan(
      at("ref: f2b1af34fb448f497a6dc741beae74dd94266661"),
    );
    expect(workflow).toContain('source.current !== "true"');
    expect(at("Refuse to plan after main changes")).toBeLessThan(at("terraform plan"));
    expect(at("Refuse to apply after main changes")).toBeGreaterThan(
      at("terraform show -json mcp-credentials.tfplan"),
    );
    expect(at("Refuse to apply after main changes")).toBeLessThan(at("terraform apply"));
    expect(
      workflow.match(/gh api repos\/askenaz-dev\/meltemi-web\/git\/ref\/heads\/main/g),
    ).toHaveLength(2);
  });

  it("overrides only the two incidental dependency attributes", () => {
    const override = readFileSync(
      new URL("../scripts/mcp-credentials-bootstrap-override.tf", import.meta.url),
      "utf8",
    );
    expect(override.replace(/^#.*$/gm, "").trim()).toMatch(
      /^resource "github_actions_environment_secret" "mcp_test_token" \{\s+repository\s*= "meltemi-diagrams"\s+environment = each\.value\.environment\s+\}$/,
    );
    expect(
      at('cp "$GITHUB_WORKSPACE/operation/scripts/mcp-credentials-bootstrap-override.tf"'),
    ).toBeLessThan(at("terraform plan"));
  });

  it("keeps provider versions and validates the exact saved plan before apply", () => {
    for (const version of ['"5.28.0"', '"3.9.1"', '"6.13.0"']) expect(workflow).toContain(version);
    expect(workflow).not.toContain("-upgrade");
    for (const [address] of entries) expect(workflow.split(`-target='${address}'`)).toHaveLength(3);
    expect(at("terraform show -json mcp-credentials.tfplan | node")).toBeLessThan(
      at("terraform apply -no-color -lock-timeout=5m mcp-credentials.tfplan"),
    );
    expect(workflow).not.toMatch(/terraform apply[^\n]*-(?:target|auto-approve)/);
    expect(workflow).toContain('if [ "$code" != 0 ]');
    expect(workflow).toContain('mcp-credentials-bootstrap-plan.mjs" --verify');
    expect(workflow.match(/umask 077/g)).toHaveLength(2);
  });

  it("emits only destination metadata and always removes private files without artifacts", () => {
    expect(workflow).toContain(
      "environments/$environment/secrets/$name\" --jq '{name, updated_at}'",
    );
    expect(workflow).toContain("for environment in staging production;");
    expect(workflow).toContain("for name in MELTEMI_TOKEN MELTEMI_TOKEN_2;");
    expect(workflow).toContain("if: always()");
    for (const file of [
      "mcp-credentials.tfplan",
      "mcp-credentials-verify.tfplan",
      "mcp_credentials_bootstrap_override.tf",
    ]) {
      expect(workflow).toContain(`source/packages/infra/${file}`);
    }
    for (const forbidden of ["actions/upload-artifact", "terraform output", "set -x"])
      expect(workflow).not.toContain(forbidden);
  });
});
