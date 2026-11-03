// The repository's pipelines, read as text: what starts each one, where it runs, the order of its
// steps, and which secrets it may name. The code's workflows hold one deploy token and one npm
// token at most; only the infrastructure's workflows, in the `infrastructure` environment, see the
// values Terraform hands to the Workers.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIR = join(ROOT, ".github", "workflows");
const read = (name: string) => readFileSync(join(DIR, name), "utf8");

/** The names of the secrets a workflow reads: every `secrets.NAME` inside a `${{ }}` expression. */
const secretsOf = (text: string) =>
  [
    ...new Set(
      [...text.matchAll(/\$\{\{([^}]*)\}\}/g)].flatMap((expression) =>
        [...expression[1]!.matchAll(/\bsecrets\.([A-Z0-9_]+)/g)].map((m) => m[1]!),
      ),
    ),
  ].sort();

/** The position of `needle` in `text`, failing the test when it is absent. */
function at(text: string, needle: string): number {
  const index = text.indexOf(needle);
  expect(index, needle).toBeGreaterThanOrEqual(0);
  return index;
}

const WORKER_SECRETS = [
  "SESSION_PRIVATE_KEY",
  "STATE_SECRET",
  "GITHUB_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "EVENTS_SECRET_DIAGRAMS",
];

describe("the workflows", () => {
  it("are the seven the delivery describes", () => {
    expect(readdirSync(DIR).sort()).toEqual([
      "ci.yml",
      "deploy.yml",
      "infra-apply.yml",
      "infra-drift.yml",
      "infra-plan.yml",
      "registrar.yml",
      "release.yml",
    ]);
  });

  it("read every secret as ${{ secrets.NAME }} and nowhere print one", () => {
    for (const name of readdirSync(DIR)) {
      const text = read(name);
      expect(text, name).not.toMatch(/echo[^\n]*\$\{\{\s*secrets\./);
      expect(text, name).not.toMatch(/\bwrangler secret\b/);
    }
  });

  it("start from read-only permissions", () => {
    for (const name of readdirSync(DIR)) {
      expect(read(name), name).toMatch(/^permissions:\n {2}contents: read/m);
    }
  });
});

describe("ci.yml", () => {
  const text = read("ci.yml");

  it("runs on pushes to main and pull requests, retaining queued main runs", () => {
    expect(text).toMatch(/push:\n\s+branches: \[main\]\n\s+pull_request:/);
    expect(text).toMatch(/cancel-in-progress: false\n\s+queue: max/);
  });

  it("checks the workspace on Node 22 and 24, on Linux and Windows", () => {
    expect(text).toMatch(/os: \[ubuntu-latest, windows-latest\]/);
    expect(text).toMatch(/node: \[22, 24\]/);
    for (const step of [
      "pnpm install --frozen-lockfile",
      "pnpm typecheck",
      "pnpm lint",
      "pnpm build",
      "pnpm test",
    ]) {
      at(text, `run: ${step}`);
    }
  });

  it("drives the site in the runner's Chrome, after a clean install", () => {
    const job = text.slice(at(text, "\n  browser:"), at(text, "\n  infrastructure:"));
    expect(job).toMatch(/runs-on: ubuntu-latest/);
    expect(job).not.toMatch(/matrix:/);
    expect(at(job, "run: pnpm install --frozen-lockfile")).toBeLessThan(
      at(job, "run: pnpm site:browser"),
    );
  });

  it("checks the infrastructure without credentials: formatting, validity, the mocked stages", () => {
    at(text, "terraform fmt -check -recursive");
    at(text, "terraform init -backend=false");
    at(text, "terraform validate");
    at(text, "terraform test");
  });

  it("names no secret and no environment", () => {
    expect(secretsOf(text)).toEqual([]);
    expect(text).not.toMatch(/environment:/);
  });
});

describe("deploy.yml", () => {
  const text = read("deploy.yml");

  it("deploys only current CI-approved main, retaining queued runs", () => {
    expect(text).toContain("needs: source");
    expect(text).toContain("if: needs.source.outputs.current == 'true'");
    expect(text).toContain("node ../.automation/scripts/ci-source.mjs current");
  });

  it("deploys from the production environment with the deploy token only", () => {
    expect(text).toMatch(/environment: production/);
    expect(secretsOf(text)).toEqual(["CLOUDFLARE_API_TOKEN"]);
    for (const name of WORKER_SECRETS) expect(text, name).not.toContain(name);
  });

  it("writes the IDE's latest release into its pages after identity and before the site", () => {
    const identity = at(text, "wrangler deploy -c wrangler.deploy.json");
    const release = at(text, "run: node scripts/ide-release.mjs public");
    const upload = text.indexOf("pnpm exec wrangler deploy", identity + 1);
    expect(identity).toBeLessThan(release);
    expect(release).toBeLessThan(upload);
    expect(text).toContain("GH_TOKEN: ${{ github.token }}");
    expect(text).toMatch(/workflow_dispatch:/);
  });

  it("writes Terraform's ids, migrates, then uploads identity and then the site", () => {
    const config = at(text, "node scripts/deploy-config.mjs packages/identity/wrangler.jsonc");
    const migrate = at(text, "wrangler d1 migrations apply DB --remote -c wrangler.deploy.json");
    const identity = at(text, "wrangler deploy -c wrangler.deploy.json");
    const site = at(text, "working-directory: source/packages/site");
    expect(config).toBeLessThan(migrate);
    expect(migrate).toBeLessThan(identity);
    expect(identity).toBeLessThan(site);
  });
});

describe("approved delivery workflows", () => {
  it("holds one retained production queue across Wrangler deploy and Terraform plan/apply", () => {
    for (const name of ["deploy.yml", "infra-apply.yml"]) {
      expect(read(name), name).toMatch(
        /^concurrency:\n(?: {2}#[^\n]*\n)* {2}group: production-reconciliation\n {2}cancel-in-progress: false\n {2}queue: max$/m,
      );
    }
    expect(read("release.yml")).not.toContain("group: production-reconciliation");
  });

  for (const name of ["release.yml", "deploy.yml", "infra-apply.yml"]) {
    it(`${name} validates CI before checking out exact source`, () => {
      const text = read(name);
      expect(text).toContain("workflow_run:");
      expect(text).toContain("workflows: [CI]");
      expect(text).toContain("types: [completed]");
      expect(text).toContain("github.event.workflow_run.conclusion == 'success'");
      expect(text).toContain("github.event.workflow_run.event == 'push'");
      expect(text).toContain("github.event.workflow_run.head_branch == 'main'");
      expect(text).toContain(
        "github.event.workflow_run.head_repository.full_name == github.repository",
      );
      expect(text).toContain("github.ref == 'refs/heads/main'");
      expect(text).toContain("ref: ${{ github.workflow_sha }}");
      expect(at(text, "ci-source.mjs resolve")).toBeLessThan(
        at(text, "ref: ${{ needs.source.outputs.sha }}"),
      );
      expect(text).toContain("ci_run_id:");
      expect(text).not.toMatch(/^ {2}push:/m);
      expect(text).not.toContain("paths:");
      expect(text).toContain("queue: max");
    });
  }
  it("publishes npm and GitHub independently from the prepared artifact", () => {
    const text = read("release.yml");
    expect(text).toContain("group: release-main");
    expect(text).toContain("id-token: write");
    expect(text.match(/needs: \[source, prepare\]/g)).toHaveLength(2);
    expect(text.match(/fail-fast: false/g)).toHaveLength(2);
    expect(text).toContain('release-main.mjs npm "$PACKAGE"');
    expect(text).toContain('release-main.mjs github "$PACKAGE"');
    expect(text).toContain("name: ${{ needs.prepare.outputs.artifact }}");
    expect(text).toContain("$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT");
    expect(secretsOf(text)).toEqual(["NPM_TOKEN"]);
  });
});

describe("the infrastructure's workflows", () => {
  const infra = ["infra-plan.yml", "infra-apply.yml", "infra-drift.yml"];

  it("run in the infrastructure environment, the only place the bootstrap secrets are", () => {
    for (const name of [...infra, "registrar.yml"]) {
      expect(read(name), name).toMatch(/environment: infrastructure/);
    }
    for (const name of ["ci.yml", "deploy.yml", "release.yml"]) {
      expect(read(name), name).not.toMatch(/environment: infrastructure/);
      expect(secretsOf(read(name)), name).not.toContain("GH_ADMIN_TOKEN");
    }
  });

  it("give Terraform the state, the providers and every variable", () => {
    for (const name of infra) {
      const text = read(name);
      expect(secretsOf(text), name).toEqual(
        [
          "ADMIN_SUBS",
          "CLOUDFLARE_API_TOKEN",
          "GH_ADMIN_TOKEN",
          "NPM_TOKEN",
          "OAUTH_GITHUB_CLIENT_SECRET",
          "OAUTH_GOOGLE_CLIENT_SECRET",
          "OVSX_PAT",
          "SESSION_PRIVATE_KEY",
          "VSCE_PAT",
          "WEB_DISPATCH_TOKEN",
        ].sort(),
      );
      for (const variable of [
        "cloudflare_account_id",
        "session_private_key",
        "github_client_secret",
        "google_client_secret",
        "web_dispatch_token",
      ]) {
        expect(text, `${name}: ${variable}`).toContain(`TF_VAR_${variable}:`);
      }
    }
  });

  it("hand the IDE's notice the narrow token when it exists, and the admin token until then", () => {
    for (const name of infra) {
      expect(read(name), name).toContain(
        "TF_VAR_web_dispatch_token: ${{ secrets.WEB_DISPATCH_TOKEN || secrets.GH_ADMIN_TOKEN }}",
      );
    }
  });

  it("plan pull requests and write the plan as one comment, updated in place", () => {
    const text = read("infra-plan.yml");
    expect(text).toMatch(/on:\n {2}pull_request:\n {4}paths:\n {6}- "packages\/infra\/\*\*"/);
    at(text, "<!-- infrastructure-plan -->");
    at(text, "updateComment");
    expect(text).not.toMatch(/terraform apply/);
  });

  it("apply only current approved main, using the saved plan", () => {
    const text = read("infra-apply.yml");
    expect(text).toContain("if: needs.source.outputs.current == 'true'");
    expect(text).toContain("if: steps.current.outputs.current == 'true'");
    expect(at(text, "-out=apply.tfplan")).toBeLessThan(
      at(text, "terraform apply -no-color -lock-timeout=5m apply.tfplan"),
    );
  });

  it("look for drift weekly and keep one issue about it", () => {
    const text = read("infra-drift.yml");
    expect(text).toMatch(/schedule:\n\s+- cron: "0 6 \* \* 1"/);
    at(text, "-detailed-exitcode");
    // The provider's noise is filtered from the JSON plan, which is removed before anything else.
    expect(at(text, "node scripts/plan-changes.mjs drift.json")).toBeLessThan(
      at(text, "rm -f drift.json"),
    );
    at(text, 'const title = "Infrastructure drift"');
    expect(text).not.toMatch(/terraform apply/);
  });

  it("move the nameservers only when asked, with the registrar's key and the state's token", () => {
    const text = read("registrar.yml");
    expect(text).toMatch(/^on:\n {2}workflow_dispatch:/m);
    expect(text).not.toMatch(/^\s+(push|pull_request|schedule):/m);
    expect(secretsOf(text)).toEqual(["CLOUDFLARE_API_TOKEN", "DYNADOT_API_KEY"]);
    at(text, "terraform output -json nameservers");
    at(text, "packages/infra/scripts/dynadot-nameservers.mjs");
  });
});
