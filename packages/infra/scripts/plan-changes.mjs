// What a plan would change, without the provider's noise. The drift workflow runs it on
// `terraform show -json` of its plan: provider 5.28 plans an in-place update of every
// `cloudflare_d1_database` on every run, its `file_size`, `num_tables` and `version` turned
// unknown while every value it knows equals the state's. Such an update changes nothing; any other
// action, or an update with a known value that differs, is a difference. It prints addresses and
// attribute names only, never a value: the plan's JSON holds the secrets in clear.
//
//   node packages/infra/scripts/plan-changes.mjs <plan.json>
//
// Exit code 0: no difference; 2: a difference (as `terraform plan -detailed-exitcode`).

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The top-level attributes whose known planned value differs from the prior state's. */
export function knownDifferences(before, after) {
  const prior = before ?? {};
  return Object.keys(after ?? {}).filter(
    (key) => JSON.stringify(prior[key] ?? null) !== JSON.stringify(after[key] ?? null),
  );
}

/** Each resource the plan really changes, as "address: actions (attributes)". */
export function realChanges(plan) {
  const changes = [];
  for (const resource of plan.resource_changes ?? []) {
    const { actions, before, after } = resource.change;
    if (actions.length === 1 && (actions[0] === "no-op" || actions[0] === "read")) continue;
    if (actions.length === 1 && actions[0] === "update") {
      const differ = knownDifferences(before, after);
      if (differ.length === 0) continue;
      changes.push(`${resource.address}: update (${differ.join(", ")})`);
      continue;
    }
    changes.push(`${resource.address}: ${actions.join(", ")}`);
  }
  return changes;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: plan-changes.mjs <plan.json>");
    process.exit(1);
  }
  const changes = realChanges(JSON.parse(readFileSync(file, "utf8")));
  if (changes.length === 0) {
    console.log("No difference (updates whose known values all equal the state's are ignored).");
    process.exit(0);
  }
  console.log(`${changes.length} difference(s):`);
  for (const change of changes) console.log(`  ${change}`);
  process.exit(2);
}
