import { isAbsolute } from "node:path";
import { join } from "node:path";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { currentSource, resolveSource, validateRun } from "../scripts/ci-source.mjs";
import { githubApi } from "../scripts/github-api.mjs";
import {
  allocateVersion,
  assertAutomaticSource,
  checkPublished,
  npmTag,
  publishGithub,
  publishNpm,
  registryPackage,
} from "../scripts/release-main.mjs";

const repo = "example/meltemi-web";
const sha = "a".repeat(40);
const newer = "b".repeat(40);
const run = {
  repository: { full_name: repo },
  head_repository: { full_name: repo },
  workflow_id: 42,
  path: ".github/workflows/ci.yml",
  event: "push",
  head_branch: "main",
  status: "completed",
  conclusion: "success",
  head_sha: sha,
};

describe("CI source authority", () => {
  it("accepts only completed push/main CI from the same repository", () => {
    expect(validateRun(run, repo, 42)).toBe(sha);
    for (const wrong of [
      { event: "pull_request" },
      { head_branch: "feature" },
      { status: "in_progress" },
      { conclusion: "failure" },
      { workflow_id: 99 },
      { path: ".github/workflows/other.yml" },
      { head_repository: { full_name: "fork/meltemi-web" } },
      { repository: { full_name: "other/repo" } },
      { head_sha: "not-a-sha" },
    ])
      expect(() => validateRun({ ...run, ...wrong }, repo, 42)).toThrow(/not successful/);
  });

  const apiFor = (head = sha, status = "identical") =>
    vi.fn(async (path: string) => {
      if (path === "/actions/workflows/ci.yml") return { id: 42 };
      if (path === "/git/ref/heads/main") return { object: { sha: head } };
      if (path === "/actions/runs/123") return run;
      if (path.startsWith("/compare/")) return { status };
      if (path.startsWith("/actions/workflows/42/runs?"))
        return { workflow_runs: [{ id: 123, head_sha: sha }] };
      throw new Error(`Unexpected path ${path}`);
    });
  it("resolves the API run and marks an older ancestor as superseded", async () => {
    expect(await resolveSource(apiFor(newer, "ahead"), repo, "123")).toEqual({
      sha,
      ci_run_id: "123",
      current: "false",
    });
  });
  it("rejects divergent source and invalid recovery ids", async () => {
    await expect(resolveSource(apiFor(newer, "diverged"), repo, "123")).rejects.toThrow(/ancestor/);
    await expect(resolveSource(apiFor(), repo, "../other")).rejects.toThrow(/Invalid/);
    await expect(resolveSource(apiFor(), repo, "")).rejects.toThrow(/required/);
  });
  it("an IDE notice uses only successful CI for current main, never older success", async () => {
    expect((await resolveSource(apiFor(), repo, "", true)).sha).toBe(sha);
    await expect(resolveSource(apiFor(newer), repo, "", true)).rejects.toThrow(/Current main/);
  });
  it("checks main again immediately before mutation", async () => {
    expect(await currentSource(apiFor(newer), sha)).toEqual({ current: "false" });
  });
  it("fails closed on API and registry errors without including response bodies", async () => {
    const secretBody = "not-for-logs";
    const ask = vi.fn(async () => new Response(secretBody, { status: 403 }));
    await expect(githubApi(repo, "fixture", ask)("/actions/runs/1")).rejects.toThrow("GitHub 403");
    await expect(registryPackage("@meltemi/identity", ask)).rejects.toThrow("npm registry 403");
  });
});

describe("GitHub channel recovery", () => {
  it("resumes draft uploads then publishes, bounds notes to this package and keeps newer latest", async () => {
    const directory = mkdtempSync(join(tmpdir(), "meltemi-web-release-"));
    try {
      writeFileSync(join(directory, "identity.tgz"), "packed artifact");
      const pkg = {
        key: "identity",
        name: "@meltemi/identity",
        version: "0.2.3",
        tag: "v0.2.3",
        archive: "identity.tgz",
        integrity: "sha512-fixture",
        previousTag: "v0.2.2",
      };
      let release: { id: number; draft: boolean } | undefined;
      const assets: { name: string; size: number; digest: string }[] = [];
      const api = vi.fn(async (path: string, options?: { body?: Record<string, unknown> }) => {
        if (path === "/git/ref/tags/v0.2.3") return { object: { type: "commit", sha } };
        if (path === "/releases/tags/v0.2.3") return release;
        if (path === "/releases/generate-notes") {
          expect(options?.body?.previous_tag_name).toBe("v0.2.2");
          return { body: "Generated changes" };
        }
        if (path === "/releases") {
          expect(options?.body?.draft).toBe(true);
          release = { id: 7, draft: true };
          return release;
        }
        if (path === "/releases/7/assets") return assets;
        if (path === "/releases/7") {
          expect(assets).toHaveLength(2);
          expect(options?.body).toEqual({ draft: false, make_latest: "false" });
          release = { id: 7, draft: false };
          return release;
        }
        if (path === "/releases/latest") return { tag_name: "v0.2.4" };
        throw new Error(`Unexpected API ${path}`);
      });
      const command = vi.fn((_binary: string, args: string[]) => {
        const path = args[3]!;
        const content = readFileSync(path);
        assets.push({
          name: path.split(/[\\/]/).at(-1)!,
          size: content.length,
          digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
        });
      });
      await publishGithub({ sourceSha: sha, ciRunId: "123" }, pkg, { api, command, directory });
      expect(command).toHaveBeenCalledTimes(2);
      command.mockClear();
      await publishGithub({ sourceSha: sha, ciRunId: "456" }, pkg, { api, command, directory });
      expect(command).not.toHaveBeenCalled();
      assets.pop();
      await expect(
        publishGithub({ sourceSha: sha }, pkg, { api, command, directory }),
      ).rejects.toThrow(/will not be modified/);
      expect(command).not.toHaveBeenCalled();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("deterministic source versions", () => {
  it("refuses legacy source even if its SHA already has a historical version tag", () => {
    expect(() => assertAutomaticSource("name: Release\non:\n  push:\n    tags: ['v*']\n")).toThrow(
      /historical release path/,
    );
    expect(() => assertAutomaticSource("# automatic-main-releases\nname: Release\n")).not.toThrow();
  });
  const history = [
    { sha, version: "0.2.0" },
    { sha: "parent", version: "0.2.0" },
    { sha: "anchor", version: "0.2.0" },
    { sha: "before", version: "0.1.0" },
  ];
  it("adds first-parent distance to its own ancestor tag", () => {
    expect(allocateVersion(history, [{ name: "v0.2.8", sha: "anchor" }], "v")).toBe("0.2.10");
  });
  it("later tags never increase an old source version", () => {
    expect(
      allocateVersion(
        history,
        [
          { name: "v0.2.99", sha: newer },
          { name: "v0.2.8", sha: "anchor" },
        ],
        "v",
      ),
    ).toBe("0.2.10");
  });
  it("reuses an exact source tag, including after a partial reservation", () => {
    expect(allocateVersion(history, [{ name: "v0.2.10", sha }], "v")).toBe("0.2.10");
    expect(allocateVersion(history, [{ name: "v0.2.10", sha }], "ocean-v")).toBe("0.2.2");
  });
  it("a greater manifest floor starts at the commit introducing it", () => {
    expect(
      allocateVersion(
        [{ sha, version: "1.0.0" }, ...history],
        [{ name: "v0.2.8", sha: "anchor" }],
        "v",
      ),
    ).toBe("1.0.0");
  });
  it("a small manual bump cannot regress a larger automatic ancestor version", () => {
    expect(
      allocateVersion(
        [{ sha, version: "0.2.1" }, ...history],
        [{ name: "v0.2.50", sha: "anchor" }],
        "v",
      ),
    ).toBe("0.2.53");
  });
  it("refuses conflicting tags instead of choosing a source identity", () => {
    expect(() =>
      allocateVersion(
        history,
        [
          { name: "v0.2.8", sha },
          { name: "v0.2.9", sha },
        ],
        "v",
      ),
    ).toThrow(/Multiple/);
  });
});

describe("npm recovery and provenance", () => {
  const pkg = {
    name: "@meltemi/identity",
    version: "0.2.3",
    tag: "v0.2.3",
    archive: "identity.tgz",
    integrity: "sha512-fixture",
  };
  const metadata = { meltemiRelease: { sourceSha: sha }, dist: { integrity: pkg.integrity } };
  it("does not move latest backwards", () => {
    expect(npmTag("0.2.3", "0.2.4")).toBe("release-0.2.3");
    expect(npmTag("0.2.5", "0.2.4")).toBe("latest");
    expect(() => npmTag("0.2.5", "next")).toThrow(/stable/);
  });
  it("verifies source and exact archive before skipping a published version", () => {
    expect(() => checkPublished(metadata, sha, pkg.integrity)).not.toThrow();
    expect(() => checkPublished(metadata, newer, pkg.integrity)).toThrow(/differs/);
    expect(() => checkPublished(metadata, sha, "other")).toThrow(/differs/);
  });
  it.each([sha, newer])(
    "preserves authenticated provenance when the runner SHA is %s",
    async (runnerSha) => {
      const command = vi.fn();
      const registry = async () => ({ versions: {}, "dist-tags": { latest: "0.2.4" } });
      vi.stubEnv("GITHUB_SHA", runnerSha);
      vi.stubEnv("GITHUB_REF", "refs/heads/main");
      vi.stubEnv("GITHUB_WORKFLOW_REF", `${repo}/.github/workflows/release.yml@refs/heads/main`);
      try {
        await publishNpm({ sourceSha: sha }, pkg, { command, registry });
        const [, args, options] = command.mock.calls[0]!;
        expect(isAbsolute(args[1])).toBe(true);
        expect(args).toContain("release-0.2.3");
        expect(args).toContain("--provenance");
        expect(options.env.GITHUB_SHA).toBe(runnerSha);
        expect(options.env.GITHUB_REF).toBe("refs/heads/main");
        expect(options.env.GITHUB_WORKFLOW_REF).toBe(process.env.GITHUB_WORKFLOW_REF);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
  it("an older identical retry does not publish or promote anything", async () => {
    const command = vi.fn();
    const registry = async () => ({
      versions: { "0.2.3": metadata },
      "dist-tags": { latest: "0.2.4" },
    });
    await publishNpm({ sourceSha: sha }, pkg, { command, registry });
    expect(command).not.toHaveBeenCalled();
  });
});
