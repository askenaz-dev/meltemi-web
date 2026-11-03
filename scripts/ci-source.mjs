// Validate the CI authority before any source checkout or delivery credential is used.
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { githubApi } from "./github-api.mjs";

export function validateRun(run, repository, workflowId) {
  if (
    run?.repository?.full_name !== repository ||
    run?.head_repository?.full_name !== repository ||
    run?.workflow_id !== workflowId ||
    run?.path !== ".github/workflows/ci.yml" ||
    run?.event !== "push" ||
    run?.head_branch !== "main" ||
    run?.status !== "completed" ||
    run?.conclusion !== "success" ||
    !/^[0-9a-f]{40}$/.test(run?.head_sha ?? "")
  ) {
    throw new Error("CI run is not successful push/main CI from this repository");
  }
  return run.head_sha;
}

export async function resolveSource(api, repository, runId, allowCurrent = false) {
  const workflow = await api("/actions/workflows/ci.yml");
  const main = await api("/git/ref/heads/main");
  if (!runId) {
    if (!allowCurrent) throw new Error("ci_run_id is required");
    const runs = await api(
      `/actions/workflows/${workflow.id}/runs?event=push&branch=main&status=success&head_sha=${main.object.sha}&per_page=100`,
    );
    runId = runs.workflow_runs.find((run) => run.head_sha === main.object.sha)?.id;
    if (!runId) throw new Error("Current main has no successful push CI run; retry after CI");
  }
  if (!/^[1-9]\d*$/.test(String(runId))) throw new Error("Invalid ci_run_id");
  const run = await api(`/actions/runs/${runId}`);
  const sha = validateRun(run, repository, workflow.id);
  const comparison = await api(`/compare/${sha}...${main.object.sha}`);
  if (!["ahead", "identical"].includes(comparison.status)) {
    throw new Error("CI source is not an ancestor of main");
  }
  return { sha, ci_run_id: String(runId), current: String(sha === main.object.sha) };
}

export async function currentSource(api, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) throw new Error("Invalid source SHA");
  const main = await api("/git/ref/heads/main");
  return { current: String(main.object.sha === sha) };
}

export function output(values, path = process.env.GITHUB_OUTPUT) {
  if (!path) throw new Error("GITHUB_OUTPUT is required");
  appendFileSync(
    path,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const api = githubApi(process.env.GITHUB_REPOSITORY, process.env.GH_TOKEN);
  const mode = process.argv[2];
  try {
    if (mode === "current") {
      output(await currentSource(api, process.env.SOURCE_SHA));
    } else if (mode === "resolve") {
      output(
        await resolveSource(
          api,
          process.env.GITHUB_REPOSITORY,
          process.env.CI_RUN_ID,
          process.env.ALLOW_CURRENT === "true",
        ),
      );
    } else throw new Error("usage: ci-source.mjs resolve|current");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
