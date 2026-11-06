// Sensitive input/plan JSON stays in memory. Diagnostics must never include caught errors.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MCP_CREDENTIAL_TARGETS = Object.freeze(
  Object.fromEntries(
    ["staging", "production"].flatMap((environment) =>
      ["MELTEMI_TOKEN", "MELTEMI_TOKEN_2"].map((secret_name) => [
        `github_actions_environment_secret.mcp_test_token["meltemi-diagrams/${environment}/${secret_name}"]`,
        Object.freeze({ repository: "meltemi-diagrams", environment, secret_name }),
      ]),
    ),
  ),
);

function reject() {
  throw new Error("The MCP credential operation boundary was not satisfied.");
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

/** Syntax/separation only. Account identity and host assignment require separate verification. */
export function validateMcpCredentialInputs(inputs) {
  if (!exactKeys(inputs, ["staging", "production"])) reject();
  const values = [];
  for (const environment of ["staging", "production"]) {
    if (!exactKeys(inputs[environment], ["token", "token_2"])) reject();
    for (const field of ["token", "token_2"]) {
      const token = inputs[environment][field];
      if (typeof token !== "string" || !/^mdg_[A-Za-z0-9_-]{43}$/.test(token)) reject();
      values.push(token);
    }
  }
  if (new Set(values).size !== 4) reject();
}

function correctIdentity(value, expected) {
  return Object.entries(expected).every(([key, entry]) => value?.[key] === entry);
}

/** Accept precisely the four known secrets and unchanged managed dependencies/data reads. */
export function validateMcpCredentialPlan(plan, verify = false) {
  if (
    !plan ||
    !/^1\.\d+$/.test(plan.format_version ?? "") ||
    plan.errored !== false ||
    !Array.isArray(plan.resource_changes) ||
    (plan.deferred_changes !== undefined &&
      (!Array.isArray(plan.deferred_changes) || plan.deferred_changes.length !== 0))
  ) {
    reject();
  }
  // Targeted plans intentionally have complete:false. Deferred work is still forbidden.
  let targets = 0;
  let mutations = 0;
  const addresses = new Set();
  for (const resource of plan.resource_changes) {
    if (
      !resource ||
      typeof resource.address !== "string" ||
      addresses.has(resource.address) ||
      resource.previous_address !== undefined ||
      resource.deposed !== undefined ||
      !resource.change ||
      resource.change.importing != null ||
      !Array.isArray(resource.change.actions) ||
      resource.change.actions.length !== 1
    ) {
      reject();
    }
    addresses.add(resource.address);
    const action = resource.change.actions[0];
    const expected = Object.hasOwn(MCP_CREDENTIAL_TARGETS, resource.address)
      ? MCP_CREDENTIAL_TARGETS[resource.address]
      : undefined;
    if (expected) {
      targets += 1;
      const unknown = resource.change.after_unknown;
      if (
        resource.mode !== "managed" ||
        resource.type !== "github_actions_environment_secret" ||
        !correctIdentity(resource.change.after, expected) ||
        !["no-op", "create", "update"].includes(action) ||
        (action === "create" && resource.change.before !== null) ||
        (action !== "create" && !correctIdentity(resource.change.before, expected)) ||
        (unknown !== undefined &&
          (unknown === null || typeof unknown !== "object" || Array.isArray(unknown))) ||
        Object.keys(expected).some(
          (key) => unknown?.[key] !== undefined && unknown[key] !== false,
        ) ||
        (verify && action !== "no-op")
      ) {
        reject();
      }
      if (action !== "no-op") mutations += 1;
    } else if (
      !["managed", "data"].includes(resource.mode) ||
      (action !== "no-op" && !(action === "read" && resource.mode === "data"))
    ) {
      reject();
    }
  }
  if (targets !== 4 || mutations > 4) reject();
  return mutations;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const mode = process.argv[2];
    if (process.argv.length > 3 || (mode && !["--verify", "--inputs"].includes(mode))) reject();
    if (mode === "--inputs") {
      validateMcpCredentialInputs(JSON.parse(process.env.TF_VAR_mcp_test_tokens ?? ""));
      console.log("Four distinct MCP credential inputs validated; no values were logged.");
    } else {
      const count = validateMcpCredentialPlan(
        JSON.parse(readFileSync(0, "utf8")),
        mode === "--verify",
      );
      console.log(`MCP credential plan validated: ${count} permitted resource mutation(s).`);
    }
  } catch {
    // JSON parse errors can include credential fragments. Never print the caught exception.
    console.error(
      "MCP credential operation rejected; no values were logged. Review its scope and inputs.",
    );
    process.exitCode = 1;
  }
}
