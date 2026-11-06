// Read Terraform's sensitive JSON only from stdin. Diagnostics must never expose its values.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const DOCS_DISPATCH_RESOURCE =
  'github_actions_secret.release["meltemi-diagrams/WEB_DISPATCH_TOKEN"]';

function reject() {
  throw new Error(
    "The plan exceeds the documentation notice secret operation or has deferred changes.",
  );
}

function correctIdentity(value) {
  return value?.repository === "meltemi-diagrams" && value?.secret_name === "WEB_DISPATCH_TOKEN";
}

/** Accept only this secret's create/update/no-op and unchanged dependencies. */
export function validateDocsDispatchPlan(plan, verify = false) {
  if (
    !plan ||
    !/^1\.\d+$/.test(plan.format_version ?? "") ||
    plan.errored !== false ||
    !Array.isArray(plan.resource_changes) ||
    (plan.deferred_changes?.length ?? 0) !== 0
  ) {
    reject();
  }
  // Targeted plans intentionally have complete:false; deferred changes remain forbidden.
  let targetCount = 0;
  let mutationCount = 0;
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
    if (resource.address === DOCS_DISPATCH_RESOURCE) {
      targetCount += 1;
      if (
        resource.mode !== "managed" ||
        resource.type !== "github_actions_secret" ||
        !correctIdentity(resource.change.after) ||
        !["no-op", "create", "update"].includes(action) ||
        (action !== "create" && !correctIdentity(resource.change.before)) ||
        resource.change.after_unknown?.repository === true ||
        resource.change.after_unknown?.secret_name === true ||
        (verify && action !== "no-op")
      ) {
        reject();
      }
      if (action !== "no-op") mutationCount += 1;
    } else if (
      !["managed", "data"].includes(resource.mode) ||
      (action !== "no-op" && !(action === "read" && resource.mode === "data"))
    ) {
      reject();
    }
  }
  if (targetCount !== 1 || mutationCount > 1) reject();
  return mutationCount;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "--verify")) reject();
    const count = validateDocsDispatchPlan(
      JSON.parse(readFileSync(0, "utf8")),
      process.argv[2] === "--verify",
    );
    console.log(`Documentation notice plan validated: ${count} permitted resource mutation(s).`);
  } catch {
    // Even JSON parse errors may contain token fragments. Never print caught errors.
    console.error(
      "Documentation notice plan rejected; no values were logged. Review the operation's scope.",
    );
    process.exitCode = 1;
  }
}
