// The bootstrap of the family's infrastructure, run once by the owner in their own terminal: the
// few values only a person can obtain go from the keyboard straight into the `infrastructure`
// environment of askenaz-dev/meltemi-web, and nothing is printed, logged or written but their
// names. From then on every change runs as a pipeline (packages/infra/README.md).
//
//   gh auth login            (the personal account that owns askenaz-dev)
//   node scripts/bootstrap.mjs [--repo askenaz-dev/meltemi-web] [--dry-run]
//
// What it does, each step skipped when it is done already, so it can be run again:
//  1. checks that `gh` is signed in and the repository exists;
//  2. asks for the Cloudflare API token Terraform uses, verifies it, finds the account, creates
//     the R2 bucket `meltemi-terraform-state`, and derives the bucket's S3 credentials from the
//     token (id, and SHA-256 of the value), so no second token is needed;
//  3. notes an existing Secrets Store (an account holds one) so Terraform imports it;
//  4. generates the identity service's signing key, keeps its private half as a secret and writes
//     its public half into packages/identity/wrangler.jsonc, with the two OAuth client ids;
//  5. asks for the GitHub token Terraform uses, the OAuth secrets and the
//     optional release tokens;
//  6. creates the environment and sets its variables and secrets with `gh`.

import { spawnSync } from "node:child_process";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const IDENTITY_CONFIG = join(ROOT, "packages", "identity", "wrangler.jsonc");
const CLOUDFLARE = "https://api.cloudflare.com/client/v4";
export const STATE_BUCKET = "meltemi-terraform-state";
export const ENVIRONMENT = "infrastructure";
export const ZONES = ["meltemi.dev", "meltemi.page"];
/** The apex records of meltemi.dev that Terraform declares while GitHub Pages serves it (zones.tf). */
export const GITHUB_PAGES = [
  "185.199.108.153",
  "185.199.109.153",
  "185.199.110.153",
  "185.199.111.153",
];

/**
 * The records of a zone added in the dashboard: the GitHub Pages A records of meltemi.dev's apex,
 * by address, which Terraform imports; and every other record, which Terraform does not declare
 * (Cloudflare's scan copies whatever the registrar served, such as Dynadot's parking record) and
 * which the owner should delete or have declared. NS and SOA records are Cloudflare's own.
 */
export function sortRecords(zone, records) {
  const imported = {};
  const foreign = [];
  for (const record of records) {
    if (record.type === "NS" || record.type === "SOA") continue;
    const apexPages =
      zone === "meltemi.dev" &&
      record.type === "A" &&
      record.name === zone &&
      GITHUB_PAGES.includes(record.content);
    if (apexPages) imported[record.content] = record.id;
    else foreign.push(record);
  }
  return { imported, foreign };
}

/** The S3 credentials of R2 that an API token with R2 permissions stands for. */
export function r2Credentials(tokenId, tokenValue) {
  return {
    accessKeyId: tokenId,
    secretAccessKey: createHash("sha256").update(tokenValue).digest("hex"),
  };
}

/** A new ES256 signing pair, as `pnpm identity:keys` makes it (the kid is the RFC 7638 thumbprint). */
export async function newSigningPair() {
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const { x, y, d } = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
  const kid = createHash("sha256")
    .update(JSON.stringify({ crv: "P-256", kty: "EC", x, y }))
    .digest("base64url");
  const publicJwk = { kty: "EC", crv: "P-256", x, y, use: "sig", alg: "ES256", kid };
  return { publicJwk, privateJwk: { ...publicJwk, d } };
}

/** Replaces the string value of one variable of a `wrangler.jsonc` text, keeping the rest as written. */
function setVar(text, name, value) {
  const pattern = new RegExp(`("${name}":\\s*)"(?:[^"\\\\]|\\\\.)*"`);
  if (!pattern.test(text)) throw new Error(`wrangler.jsonc has no variable ${name}`);
  return text.replace(pattern, (_, head) => `${head}${JSON.stringify(value)}`);
}

/**
 * The identity Worker's configuration with the production settings people obtain: the published
 * key set (the current key first, the previous ones kept) and the two OAuth client ids. Client
 * ids are public by design; the public key is what the key set publishes anyway.
 */
export function withIdentitySettings(text, { publicJwk, githubClientId, googleClientId }) {
  let out = text;
  if (publicJwk) {
    const current = /"SESSION_PUBLIC_KEYS":\s*("(?:[^"\\]|\\.)*")/.exec(out);
    const keys = current ? JSON.parse(JSON.parse(current[1])) : [];
    const kept = keys.filter((key) => key.kid !== publicJwk.kid);
    out = setVar(out, "SESSION_PUBLIC_KEYS", JSON.stringify([publicJwk, ...kept]));
  }
  if (githubClientId) out = setVar(out, "GITHUB_CLIENT_ID", githubClientId);
  if (googleClientId) out = setVar(out, "GOOGLE_CLIENT_ID", googleClientId);
  return out;
}

/** The current values of the identity configuration's public settings. */
export function identitySettings(text) {
  const read = (name) => {
    const match = new RegExp(`"${name}":\\s*("(?:[^"\\\\]|\\\\.)*")`).exec(text);
    return match ? JSON.parse(match[1]) : "";
  };
  return {
    publicKeys: JSON.parse(read("SESSION_PUBLIC_KEYS") || "[]"),
    githubClientId: read("GITHUB_CLIENT_ID"),
    googleClientId: read("GOOGLE_CLIENT_ID"),
  };
}

// ----------------------------------------------------------------------------------------------
// The terminal, `gh` and Cloudflare: everything below talks to the owner or to a service.

/** A line typed by the owner; `hidden` echoes nothing (secrets). Enter alone gives "". */
async function ask(question, { hidden = false } = {}) {
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!output.muted) process.stdout.write(chunk, encoding);
      done();
    },
  });
  output.muted = false;
  const terminal = createInterface({
    input: process.stdin,
    output,
    terminal: Boolean(process.stdin.isTTY),
  });
  const answer = await new Promise((resolve) => {
    terminal.question(question, resolve);
    output.muted = hidden;
  });
  terminal.close();
  if (hidden) process.stdout.write("\n");
  return answer.trim();
}

/** `gh` with arguments, the input on its standard input; fails naming the command, never the input. */
function gh(args, { input, dryRun = false, quiet = false } = {}) {
  if (dryRun) {
    console.log(`  (dry run) gh ${args.join(" ")}`);
    return "";
  }
  const result = spawnSync("gh", args, { input, encoding: "utf8" });
  if (result.error) throw new Error(`gh could not run: ${result.error.message}`);
  if (result.status !== 0) {
    if (quiet) return undefined;
    throw new Error(`gh ${args.slice(0, 3).join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/** A call of Cloudflare's API with the token; the token never reaches a message. */
async function cloudflare(token, method, path, body) {
  const response = await fetch(`${CLOUDFLARE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json;
  try {
    json = await response.json();
  } catch {
    json = {};
  }
  return { status: response.status, ok: response.ok && json.success !== false, json };
}

async function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const repoAt = argv.indexOf("--repo");
  const repo = repoAt >= 0 ? argv[repoAt + 1] : "askenaz-dev/meltemi-web";
  const step = (n, text) => console.log(`\n${n}. ${text}`);

  step(1, "GitHub");
  const login = gh(["api", "user", "--jq", ".login"], { quiet: true })?.trim();
  if (!login)
    throw new Error("gh is not signed in: run `gh auth login` with your personal account first");
  if (gh(["api", `repos/${repo}`, "--jq", ".full_name"], { quiet: true }) === undefined) {
    throw new Error(`${repo} does not exist yet, or ${login} cannot see it`);
  }
  console.log(`  signed in as ${login}; ${repo} exists`);
  const existing = new Set(
    (
      gh(
        [
          "secret",
          "list",
          "--env",
          ENVIRONMENT,
          "--repo",
          repo,
          "--json",
          "name",
          "--jq",
          ".[].name",
        ],
        {
          quiet: true,
        },
      ) ?? ""
    )
      .split(/\r?\n/)
      .filter(Boolean),
  );
  const keep = (name) => (existing.has(name) ? " (already set; Enter keeps it)" : "");

  step(2, "Cloudflare: Terraform's API token, the account and the state bucket");
  const cfToken = await ask(
    `  Cloudflare API token for Terraform${keep("CLOUDFLARE_API_TOKEN")}: `,
    {
      hidden: true,
    },
  );
  const secrets = {};
  const variables = {};
  if (cfToken) {
    const verify = await cloudflare(cfToken, "GET", "/user/tokens/verify");
    if (!verify.ok || verify.json.result?.status !== "active") {
      throw new Error(
        "Cloudflare does not accept that token (it must be an active user API token)",
      );
    }
    const accounts = await cloudflare(cfToken, "GET", "/accounts?per_page=50");
    const list = accounts.json.result ?? [];
    if (list.length === 0) throw new Error("the token reaches no Cloudflare account");
    let account = list[0];
    if (list.length > 1) {
      list.forEach((a, i) => console.log(`  ${i + 1}. ${a.name} (${a.id})`));
      account = list[Number(await ask("  Which account? ")) - 1];
      if (!account) throw new Error("no such account");
    }
    console.log(`  account: ${account.name}`);
    variables.CLOUDFLARE_ACCOUNT_ID = account.id;

    const bucket = await cloudflare(
      cfToken,
      "GET",
      `/accounts/${account.id}/r2/buckets/${STATE_BUCKET}`,
    );
    if (bucket.ok) {
      console.log(`  the bucket ${STATE_BUCKET} exists`);
    } else if (dryRun) {
      console.log(`  (dry run) would create the bucket ${STATE_BUCKET}`);
    } else {
      const made = await cloudflare(cfToken, "POST", `/accounts/${account.id}/r2/buckets`, {
        name: STATE_BUCKET,
      });
      if (!made.ok)
        throw new Error(
          `the bucket ${STATE_BUCKET} could not be created (the token needs R2 edit)`,
        );
      console.log(`  created the bucket ${STATE_BUCKET}`);
    }
    const r2 = r2Credentials(verify.json.result.id, cfToken);
    secrets.CLOUDFLARE_API_TOKEN = cfToken;
    secrets.R2_ACCESS_KEY_ID = r2.accessKeyId;
    secrets.R2_SECRET_ACCESS_KEY = r2.secretAccessKey;

    step(3, "Cloudflare: the account's Secrets Store");
    const stores = await cloudflare(cfToken, "GET", `/accounts/${account.id}/secrets_store/stores`);
    const store = (stores.json.result ?? [])[0];
    if (store) {
      variables.EXISTING_SECRETS_STORE_ID = store.id;
      console.log(`  the account has the store "${store.name}": Terraform will import it`);
    } else {
      console.log("  none yet: Terraform will create it");
    }

    step("3b", "Cloudflare: the zones, if they were added in the dashboard");
    const zoneIds = {};
    const apexRecordIds = {};
    for (const name of ZONES) {
      const found = await cloudflare(
        cfToken,
        "GET",
        `/zones?name=${name}&account.id=${account.id}`,
      );
      const zone = (found.json.result ?? [])[0];
      if (!zone) {
        console.log(`  ${name}: not on the account yet; Terraform will create it`);
        continue;
      }
      zoneIds[name] = zone.id;
      console.log(`  ${name}: on the account already (${zone.status}); Terraform will import it`);
      const records = await cloudflare(
        cfToken,
        "GET",
        `/zones/${zone.id}/dns_records?per_page=100`,
      );
      const { imported, foreign } = sortRecords(name, records.json.result ?? []);
      Object.assign(apexRecordIds, imported);
      for (const record of foreign) {
        console.log(
          `  ! ${record.type} ${record.name} -> ${record.content} is not declared in packages/infra: ` +
            "delete it in the dashboard (a Custom Domain needs its hostname free) or ask for it to be declared",
        );
      }
    }
    if (Object.keys(zoneIds).length > 0) variables.EXISTING_ZONE_IDS = JSON.stringify(zoneIds);
    if (Object.keys(apexRecordIds).length > 0) {
      variables.EXISTING_APEX_RECORD_IDS = JSON.stringify(apexRecordIds);
    }
  }

  step(4, "The identity service: its signing key and its OAuth apps' client ids");
  const config = readFileSync(IDENTITY_CONFIG, "utf8");
  const current = identitySettings(config);
  let publicJwk;
  if (!existing.has("SESSION_PRIVATE_KEY") || current.publicKeys.length === 0) {
    const pair = await newSigningPair();
    publicJwk = pair.publicJwk;
    secrets.SESSION_PRIVATE_KEY = JSON.stringify(pair.privateJwk);
    console.log(
      `  generated a signing key (kid ${publicJwk.kid}); its private half goes to the environment only`,
    );
  } else {
    console.log("  the signing key exists: kept");
  }
  const githubClientId =
    (await ask(
      `  GitHub OAuth App client id${current.githubClientId ? ` (Enter keeps ${current.githubClientId})` : ""}: `,
    )) || undefined;
  const googleClientId =
    (await ask(
      `  Google OAuth client id${current.googleClientId ? " (Enter keeps the current one)" : ""}: `,
    )) || undefined;
  const updated = withIdentitySettings(config, { publicJwk, githubClientId, googleClientId });
  if (updated !== config) {
    if (dryRun) console.log("  (dry run) would update packages/identity/wrangler.jsonc");
    else {
      writeFileSync(IDENTITY_CONFIG, updated);
      console.log(
        "  wrote the public key and the client ids into packages/identity/wrangler.jsonc: commit it",
      );
    }
  }

  step(5, "The other values only you can obtain");
  const prompts = [
    ["GH_ADMIN_TOKEN", "GitHub fine-grained token for Terraform (askenaz-dev)"],
    ["OAUTH_GITHUB_CLIENT_SECRET", "GitHub OAuth App client secret"],
    ["OAUTH_GOOGLE_CLIENT_SECRET", "Google OAuth client secret"],
    ["NPM_TOKEN", "npm granular token of the meltemi organisation (Enter to skip for now)"],
    ["VSCE_PAT", "Visual Studio Marketplace token (Enter to skip for now)"],
    ["OVSX_PAT", "Open VSX token (Enter to skip for now)"],
  ];
  for (const [name, label] of prompts) {
    const value = await ask(`  ${label}${keep(name)}: `, { hidden: true });
    if (value) secrets[name] = value;
  }

  step(6, `The environment "${ENVIRONMENT}" of ${repo}`);
  gh(["api", "--method", "PUT", `repos/${repo}/environments/${ENVIRONMENT}`, "--silent"], {
    dryRun,
  });
  for (const [name, value] of Object.entries(variables)) {
    gh(["variable", "set", name, "--env", ENVIRONMENT, "--repo", repo, "--body", value], {
      dryRun,
    });
    console.log(`  variable ${name}`);
  }
  for (const [name, value] of Object.entries(secrets)) {
    gh(["secret", "set", name, "--env", ENVIRONMENT, "--repo", repo], { input: value, dryRun });
    console.log(`  secret ${name}`);
  }
  const missing = [
    "CLOUDFLARE_API_TOKEN",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "GH_ADMIN_TOKEN",
    "SESSION_PRIVATE_KEY",
    "OAUTH_GITHUB_CLIENT_SECRET",
    "OAUTH_GOOGLE_CLIENT_SECRET",
  ].filter((name) => !secrets[name] && !existing.has(name));
  console.log(
    missing.length === 0
      ? "\nDone: the first apply can run (push to main, or dispatch infra-apply.yml)."
      : `\nStill missing: ${missing.join(", ")}. Run this again to add them.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`\n${error instanceof Error ? error.message : "the bootstrap failed"}`);
    process.exitCode = 1;
  });
}
