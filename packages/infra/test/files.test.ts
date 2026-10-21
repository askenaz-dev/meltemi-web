// The invariants of the Terraform root that a plan cannot show and a reviewer could miss: where the
// state lives and how it is locked, that every provider is pinned and locked, that no secret value
// is written in a file, that no Worker gets a public address of its own, and that the IDE
// repository stays outside. The behaviour of the plan itself is `terraform test` (tests/).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (name: string) => readFileSync(join(ROOT, name), "utf8");
const files = readdirSync(ROOT).filter((name) => name.endsWith(".tf"));
const all = files.map(read).join("\n");

/** The text of the first block that starts with `head` (e.g. `backend "s3"`), braces balanced. */
function block(text: string, head: string): string {
  const start = text.indexOf(head);
  if (start < 0) throw new Error(`no block ${head}`);
  let depth = 0;
  for (let i = text.indexOf("{", start); i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unbalanced block ${head}`);
}

describe("the Terraform root", () => {
  it("holds the files the README describes", () => {
    expect(files.sort()).toEqual([
      "backend.tf",
      "github.tf",
      "outputs.tf",
      "providers.tf",
      "secrets.tf",
      "tokens.tf",
      "variables.tf",
      "versions.tf",
      "workers.tf",
      "zones.tf",
    ]);
  });

  it("keeps its state in the R2 bucket, locked by the backend's lock file", () => {
    const backend = block(read("backend.tf"), 'backend "s3"');
    expect(backend).toMatch(/bucket\s*=\s*"meltemi-terraform-state"/);
    expect(backend).toMatch(/key\s*=\s*"family\.tfstate"/);
    expect(backend).toMatch(/use_lockfile\s*=\s*true/);
    // No endpoint, account or credential in the file: the pipeline's environment gives them.
    expect(backend).not.toMatch(/endpoint|access_key|secret_key|r2\.cloudflarestorage\.com/);
  });

  it("pins Terraform and every provider to a minor version", () => {
    expect(read("versions.tf")).toMatch(/required_version\s*=\s*"~> 1\.\d+"/);
    const providers = block(read("versions.tf"), "required_providers");
    for (const name of ["cloudflare", "github", "random"]) {
      const entry = block(providers, `${name} = {`);
      expect(entry, name).toMatch(/version\s*=\s*"~> \d+\.\d+"/);
    }
  });

  it("commits the providers' lock file, with hashes for every platform", () => {
    const lock = read(".terraform.lock.hcl");
    for (const source of ["cloudflare/cloudflare", "integrations/github", "hashicorp/random"]) {
      expect(lock).toContain(`provider "registry.terraform.io/${source}"`);
    }
    // The registry's zh: hashes cover every platform, so Linux runners verify what Windows locked.
    expect((lock.match(/"zh:/g) ?? []).length).toBeGreaterThan(20);
  });

  it("names no credential in the providers: the pipeline's environment gives them", () => {
    expect(read("providers.tf")).not.toMatch(/api_token|token\s*=|api_key/);
  });

  it("writes no secret value: every sensitive variable is empty or required", () => {
    const variables = read("variables.tf");
    for (const match of variables.matchAll(
      /variable "(\w+)" \{[^}]*?sensitive\s*=\s*true[^}]*\}/g,
    )) {
      const body = match[0];
      const fallback = /default\s*=\s*(.+)/.exec(body)?.[1]?.trim();
      expect([undefined, '""'], match[1]).toContain(fallback);
    }
  });

  it("gives every stored secret a variable or a generated value, never a literal", () => {
    const secrets = block(read("secrets.tf"), "secrets = {");
    const entries = [...secrets.matchAll(/^\s*([A-Z_]+)\s*=\s*(.+)$/gm)];
    expect(entries.map((entry) => entry[1]).sort()).toEqual([
      "ADMIN_SUBS",
      "EVENTS_SECRET_DIAGRAMS",
      "FORMS_SECRET",
      "GITHUB_CLIENT_SECRET",
      "GOOGLE_CLIENT_SECRET",
      "IDENTITY_EVENTS_SECRET",
      "SESSION_PRIVATE_KEY",
      "STATE_SECRET",
    ]);
    for (const [, name, value] of entries) {
      expect(value!.trim(), name).toMatch(/^(var\.[a-z_]+|random_password\.[a-z_]+\.result)$/);
    }
  });

  it("gives no Worker a workers.dev address or preview addresses", () => {
    const subdomain = block(read("workers.tf"), "subdomain = {");
    expect(subdomain).toMatch(/enabled\s*=\s*false/);
    expect(subdomain).toMatch(/previews_enabled\s*=\s*false/);
    expect(all).not.toMatch(
      /cloudflare_workers_script_subdomain|enabled\s*=\s*true\s*\n\s*previews/,
    );
  });

  it("serves the four hosts of the family, two zones and nothing under another domain", () => {
    for (const host of ["id.meltemi.dev", "meltemi.dev", "diagrams.meltemi.dev", "meltemi.page"]) {
      expect(read("workers.tf")).toContain(`hostname = "${host}"`);
    }
    expect([...read("zones.tf").matchAll(/name\s*=\s*"([a-z.]+)"/g)].map((m) => m[1])).toEqual(
      expect.arrayContaining(["meltemi.dev", "meltemi.page"]),
    );
  });

  it("does not manage the IDE repository", () => {
    expect(all).not.toMatch(/"meltemi"\s*=|repository\s*=\s*"meltemi"|askenaz-dev\/meltemi"/);
    const repositories = block(read("github.tf"), "repositories = {");
    expect([...repositories.matchAll(/^\s{4}"([\w-]+)" = \{/gm)].map((m) => m[1])).toEqual([
      "meltemi-web",
      "meltemi-diagrams",
    ]);
  });

  it("gives each product repository a deploy token that cannot touch DNS, zones or tokens", () => {
    const groups = block(read("tokens.tf"), "deploy_groups = {");
    expect(groups).not.toMatch(/Zone|DNS|Token|Account Settings Write|Secrets Store Write/);
  });
});
