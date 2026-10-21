// Points domains registered at Dynadot at the nameservers Terraform gave their Cloudflare zones.
// There is no Terraform provider for Dynadot, so the `registrar` workflow runs this once, with the
// zones' nameservers from `terraform output -json nameservers` and the account's API key in
// DYNADOT_API_KEY. It is idempotent: a domain already pointing at its nameservers is left alone.
// It prints what it did and never the key.
//
//   node packages/infra/scripts/dynadot-nameservers.mjs <nameservers.json> [--dry-run]
//
// The file is `{ "meltemi.dev": ["a.ns.cloudflare.com", "b.ns.cloudflare.com"], ... }`.

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";

export const API = "https://api.dynadot.com/api3.json";

/** A host name as Dynadot and Cloudflare may spell it: lower case, no trailing dot. */
export function hostName(name) {
  return String(name).trim().toLowerCase().replace(/\.$/, "");
}

/** The failure of a call, with a message that never contains the key. */
export class RegistrarError extends Error {}

/**
 * One call of the api3 JSON API: `command` and its parameters. Fails on a transport error, a body
 * that is not JSON, or a response whose status is not `success`.
 */
async function call(doFetch, key, command, parameters = {}) {
  const url = new URL(API);
  url.searchParams.set("key", key);
  url.searchParams.set("command", command);
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
  let response;
  try {
    response = await doFetch(url.href, { headers: { Accept: "application/json" } });
  } catch {
    throw new RegistrarError(`${command}: Dynadot could not be reached`);
  }
  if (!response.ok)
    throw new RegistrarError(`${command}: Dynadot answered HTTP ${response.status}`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new RegistrarError(`${command}: Dynadot's answer is not JSON`);
  }
  const content = body && typeof body === "object" ? Object.values(body)[0] : undefined;
  const status = content && typeof content === "object" ? content.Status : undefined;
  if (status !== "success") {
    const reason = content && typeof content.Error === "string" ? `: ${content.Error}` : "";
    throw new RegistrarError(`${command}: Dynadot refused${reason}`.replaceAll(key, "<key>"));
  }
  return content;
}

/** The nameservers a domain points at now. */
async function currentNameservers(doFetch, key, domain) {
  const content = await call(doFetch, key, "get_ns", { domain });
  const hosts = content.NsContent && typeof content.NsContent === "object" ? content.NsContent : {};
  return Object.keys(hosts)
    .filter((name) => /^Host\d+$/.test(name) && hosts[name])
    .map((name) => hostName(hosts[name]));
}

/** The nameserver hosts the account knows; `set_ns` accepts only those. */
async function accountNameservers(doFetch, key) {
  const content = await call(doFetch, key, "server_list");
  const list = Array.isArray(content.ServerList) ? content.ServerList : [];
  return new Set(list.map((server) => hostName(server.ServerName ?? "")));
}

/**
 * Points every domain of `desired` (domain → nameservers) at its nameservers. Returns what it did
 * per domain: `unchanged`, `changed` or, with `dryRun`, `would change`.
 */
export async function pointNameservers({
  desired,
  key,
  fetch: doFetch = fetch,
  log = console.log,
  dryRun = false,
}) {
  if (!key) throw new RegistrarError("DYNADOT_API_KEY is not set");
  const results = {};
  let known;
  for (const [domain, servers] of Object.entries(desired)) {
    const wanted = servers.map(hostName);
    if (wanted.length < 2) throw new RegistrarError(`${domain}: expected at least two nameservers`);
    const now = await currentNameservers(doFetch, key, domain);
    const same = now.length === wanted.length && wanted.every((host) => now.includes(host));
    if (same) {
      log(`${domain}: already points at ${wanted.join(", ")}`);
      results[domain] = "unchanged";
      continue;
    }
    if (dryRun) {
      log(`${domain}: would point at ${wanted.join(", ")} (now ${now.join(", ") || "none"})`);
      results[domain] = "would change";
      continue;
    }
    known ??= await accountNameservers(doFetch, key);
    for (const host of wanted) {
      if (known.has(host)) continue;
      await call(doFetch, key, "add_ns", { host });
      known.add(host);
      log(`${domain}: added ${host} to the account's nameservers`);
    }
    const parameters = { domain };
    wanted.forEach((host, index) => (parameters[`ns${index}`] = host));
    await call(doFetch, key, "set_ns", parameters);
    log(`${domain}: now points at ${wanted.join(", ")} (was ${now.join(", ") || "none"})`);
    results[domain] = "changed";
  }
  return results;
}

/** The domains and nameservers of `terraform output -json nameservers`, checked. */
export function readDesired(text) {
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RegistrarError("the nameservers file is not an object of domain to nameservers");
  }
  for (const [domain, servers] of Object.entries(value)) {
    if (!Array.isArray(servers) || !servers.every((server) => typeof server === "string")) {
      throw new RegistrarError(`${domain}: the nameservers are not a list of host names`);
    }
  }
  return value;
}

/** The key typed in the terminal, echoing nothing. */
async function askKey() {
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!output.muted) process.stdout.write(chunk, encoding);
      done();
    },
  });
  output.muted = false;
  const terminal = createInterface({ input: process.stdin, output, terminal: true });
  const answer = await new Promise((resolve) => {
    terminal.question("Dynadot API key: ", resolve);
    output.muted = true;
  });
  terminal.close();
  process.stdout.write("\n");
  return answer.trim();
}

async function main(argv) {
  const file = argv.find((arg) => !arg.startsWith("--"));
  if (!file)
    throw new RegistrarError("usage: dynadot-nameservers.mjs <nameservers.json> [--dry-run]");
  const desired = readDesired(readFileSync(file, "utf8"));
  // Dynadot answers only the IP addresses whitelisted on its API page, so this runs from the
  // owner's machine; in a terminal the key is asked for instead of read from the environment.
  let key = process.env.DYNADOT_API_KEY ?? "";
  if (!key && process.stdin.isTTY) key = await askKey();
  await pointNameservers({ desired, key, dryRun: argv.includes("--dry-run") });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof RegistrarError ? error.message : "the registrar step failed");
    process.exitCode = 1;
  });
}
