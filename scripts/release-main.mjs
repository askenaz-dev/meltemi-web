// All mutation commands run only in the serialized release workflow, after CI validation.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { githubApi } from "./github-api.mjs";

export const PACKAGES = [
  { key: "identity", name: "@meltemi/identity", prefix: "v", directory: "packages/identity" },
  { key: "ocean", name: "@meltemi/ocean", prefix: "ocean-v", directory: "packages/ocean" },
];
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const isVersion = (value) => typeof value === "string" && SEMVER.test(value);
export function compareVersions(a, b) {
  if (!isVersion(a) || !isVersion(b)) throw new Error("Expected stable x.y.z version");
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
function patchAfter(version, distance) {
  const parts = version.split(".").map(Number);
  parts[2] += distance;
  if (!parts.every(Number.isSafeInteger)) throw new Error("Version exceeds safe integer range");
  return parts.join(".");
}
export function allocateVersion(history, tags, prefix) {
  const floor = history[0]?.version;
  if (!isVersion(floor)) throw new Error("Package version floor is not stable x.y.z");
  let introduced = 0;
  while (history[introduced + 1]?.version === floor) introduced += 1;
  const declared = patchAfter(floor, introduced);
  for (let distance = 0; distance < history.length; distance++) {
    const source = history[distance];
    const versions = tags
      .filter(
        (tag) =>
          tag.sha === source.sha &&
          tag.name.startsWith(prefix) &&
          isVersion(tag.name.slice(prefix.length)),
      )
      .map((tag) => tag.name.slice(prefix.length));
    if (versions.length > 1)
      throw new Error(`Multiple ${prefix} version tags name an ancestor SHA`);
    if (versions.length === 1) {
      if (distance === 0) return versions[0];
      const derived = patchAfter(versions[0], distance);
      if (distance <= introduced && compareVersions(versions[0], floor) >= 0) return derived;
      return compareVersions(derived, declared) > 0 ? derived : declared;
    }
  }
  return declared;
}
export async function registryPackage(name, ask = fetch) {
  const response = await ask(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return { versions: {}, "dist-tags": {} };
  if (!response.ok) throw new Error(`npm registry ${response.status} for ${name}`);
  return response.json();
}
const command = (bin, args, options = {}) =>
  execFileSync(bin, args, { encoding: "utf8", ...options })?.trim() ?? "";
function tagsOfSource() {
  return command("git", [
    "for-each-ref",
    "--format=%(refname:strip=2) %(objectname) %(*objectname)",
    "refs/tags",
  ])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, object, peeled] = line.split(" ");
      return { name, sha: peeled || object };
    });
}
export function checkPublished(metadata, sourceSha, expectedIntegrity) {
  if (
    metadata?.meltemiRelease?.sourceSha !== sourceSha ||
    metadata?.dist?.integrity !== expectedIntegrity
  ) {
    throw new Error("Published version differs from the reserved source or package artifact");
  }
}
export function npmTag(version, latest) {
  if (latest && !isVersion(latest)) throw new Error("npm latest is not a stable version");
  return !latest || compareVersions(version, latest) > 0 ? "latest" : `release-${version}`;
}
async function reserve() {
  const sourceSha = process.env.SOURCE_SHA;
  if (
    !/^[0-9a-f]{40}$/.test(sourceSha ?? "") ||
    command("git", ["rev-parse", "HEAD"]) !== sourceSha
  ) {
    throw new Error("Checkout does not match approved source");
  }
  const plan = { sourceSha, ciRunId: process.env.CI_RUN_ID, packages: [] };
  const tags = tagsOfSource();
  const commits = command("git", ["rev-list", "--first-parent", sourceSha]).split("\n");
  const automatic = readFileSync(".github/workflows/release.yml", "utf8").includes(
    "automatic-main-releases",
  );
  for (const pkg of PACKAGES) {
    const path = join(pkg.directory, "package.json");
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    const exact = tags.some(
      (tag) =>
        tag.sha === sourceSha &&
        tag.name.startsWith(pkg.prefix) &&
        isVersion(tag.name.slice(pkg.prefix.length)),
    );
    if (!automatic && !exact)
      throw new Error(
        "Untagged source predates automatic-main-releases; use its historical release path",
      );
    const history = [];
    let crossedFloor = false;
    for (const sha of commits) {
      let previous;
      try {
        previous = JSON.parse(command("git", ["show", `${sha}:${path.replaceAll("\\", "/")}`]));
      } catch {
        break;
      }
      history.push({ sha, version: previous.version });
      crossedFloor ||= previous.version !== manifest.version;
      const anchor = tags.find(
        (tag) =>
          tag.sha === sha &&
          tag.name.startsWith(pkg.prefix) &&
          isVersion(tag.name.slice(pkg.prefix.length)),
      );
      if (
        anchor &&
        (crossedFloor ||
          compareVersions(anchor.name.slice(pkg.prefix.length), manifest.version) >= 0)
      )
        break;
    }
    const version = allocateVersion(history, tags, pkg.prefix);
    const tag = `${pkg.prefix}${version}`;
    if (!tags.some((known) => known.name === tag && known.sha === sourceSha)) {
      // Creating a ref cannot move an existing tag. A racing or conflicting writer fails closed.
      const api = githubApi(process.env.GITHUB_REPOSITORY, process.env.GH_TOKEN);
      await api("/git/refs", { method: "POST", body: { ref: `refs/tags/${tag}`, sha: sourceSha } });
    }
    manifest.version = version;
    if (automatic) manifest.meltemiRelease = { sourceSha };
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
    const previousTag = commits
      .slice(1)
      .flatMap((sha) =>
        tags.filter(
          (known) =>
            known.sha === sha &&
            known.name.startsWith(pkg.prefix) &&
            isVersion(known.name.slice(pkg.prefix.length)),
        ),
      )[0]?.name;
    plan.packages.push({ ...pkg, version, tag, previousTag });
  }
  mkdirSync("release", { recursive: true });
  writeFileSync("release/plan.json", `${JSON.stringify(plan, null, 2)}\n`);
}
function pack() {
  const plan = JSON.parse(readFileSync("release/plan.json", "utf8"));
  for (const pkg of plan.packages) {
    const packed = JSON.parse(
      command("npm", ["pack", "--json", "--pack-destination", resolve("release")], {
        cwd: pkg.directory,
      }),
    );
    if (packed.length !== 1) throw new Error(`Expected one package for ${pkg.name}`);
    pkg.archive = packed[0].filename;
    pkg.integrity = `sha512-${createHash("sha512")
      .update(readFileSync(join("release", pkg.archive)))
      .digest("base64")}`;
  }
  writeFileSync("release/plan.json", `${JSON.stringify(plan, null, 2)}\n`);
}
export async function publishNpm(plan, pkg, dependencies = {}) {
  const lookup = dependencies.registry ?? registryPackage;
  const run = dependencies.command ?? command;
  const metadata = await lookup(pkg.name);
  const published = metadata.versions[pkg.version];
  const tag = npmTag(pkg.version, metadata["dist-tags"].latest);
  if (published) {
    checkPublished(published, plan.sourceSha, pkg.integrity);
    if (tag === "latest") run("npm", ["dist-tag", "add", `${pkg.name}@${pkg.version}`, "latest"]);
  } else {
    run(
      "npm",
      [
        "publish",
        resolve("release", pkg.archive),
        "--access",
        "public",
        "--provenance",
        "--tag",
        tag,
      ],
      {
        stdio: "inherit",
        // npm's provenance reads these source coordinates. The builder workflow identity remains
        // the authentic workflow_run context (GITHUB_WORKFLOW_REF and the OIDC token are untouched).
        env: { ...process.env, GITHUB_SHA: plan.sourceSha, GITHUB_REF: `refs/tags/${pkg.tag}` },
      },
    );
  }
}
export async function publishGithub(plan, pkg, dependencies = {}) {
  const api = dependencies.api ?? githubApi(process.env.GITHUB_REPOSITORY, process.env.GH_TOKEN);
  const run = dependencies.command ?? command;
  const directory = dependencies.directory ?? "release";
  const ref = await api(`/git/ref/tags/${pkg.tag}`);
  // Reservations are lightweight tags. Historical annotated tags require explicit repair.
  if (ref.object.type !== "commit" || ref.object.sha !== plan.sourceSha)
    throw new Error("Release tag does not name approved source");
  let release = await api(`/releases/tags/${pkg.tag}`, { allowMissing: true });
  if (!release) {
    const notes = pkg.previousTag
      ? await api("/releases/generate-notes", {
          method: "POST",
          body: {
            tag_name: pkg.tag,
            target_commitish: plan.sourceSha,
            previous_tag_name: pkg.previousTag,
          },
        })
      : { body: `First automated release of ${pkg.name}.\n\nSource commit: ${plan.sourceSha}` };
    release = await api("/releases", {
      method: "POST",
      body: {
        tag_name: pkg.tag,
        target_commitish: plan.sourceSha,
        name: `${pkg.name} ${pkg.version}`,
        body: `${notes.body}\n\nSource: ${plan.sourceSha}\nCI: https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${plan.ciRunId}\n`,
        make_latest: "false",
        draft: true,
      },
    });
  }
  // Publish drafts only after both artifacts exist. Published releases are verified, never
  // reopened or amended; an incomplete historical release needs its historical recovery path.
  const manifestName = `${pkg.key}-release.json`;
  writeFileSync(
    join(directory, manifestName),
    `${JSON.stringify(
      {
        sourceSha: plan.sourceSha,
        package: pkg.name,
        version: pkg.version,
        tag: pkg.tag,
        archive: pkg.archive,
        integrity: pkg.integrity,
      },
      null,
      2,
    )}\n`,
  );
  const assets = await api(`/releases/${release.id}/assets`);
  for (const name of [pkg.archive, manifestName]) {
    const path = resolve(directory, name);
    const content = readFileSync(path);
    const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    const asset = assets.find((value) => value.name === name);
    if (asset) {
      if (asset.size !== content.length || asset.digest !== digest)
        throw new Error(`GitHub asset differs: ${name}`);
    } else if (release.draft) {
      run("gh", ["release", "upload", pkg.tag, path, "--repo", process.env.GITHUB_REPOSITORY], {
        stdio: "inherit",
      });
    } else throw new Error(`Published release lacks ${name}; it will not be modified`);
  }
  if (release.draft) {
    release = await api(`/releases/${release.id}`, {
      method: "PATCH",
      body: { draft: false, make_latest: "false" },
    });
  }
  if (pkg.key === "identity") {
    const latest = await api("/releases/latest", { allowMissing: true });
    const current = latest?.tag_name?.startsWith("v") ? latest.tag_name.slice(1) : undefined;
    if (current && !isVersion(current)) throw new Error("GitHub latest is not an identity version");
    if (!current || compareVersions(pkg.version, current) > 0) {
      await api(`/releases/${release.id}`, { method: "PATCH", body: { make_latest: "true" } });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, key] = process.argv.slice(2);
    if (mode === "reserve") await reserve();
    else if (mode === "pack") pack();
    else {
      const plan = JSON.parse(readFileSync("release/plan.json", "utf8"));
      const pkg = plan.packages.find((value) => value.key === key);
      if (!pkg) throw new Error("Unknown release package");
      if (mode === "npm") await publishNpm(plan, pkg);
      else if (mode === "github") await publishGithub(plan, pkg);
      else throw new Error("usage: release-main.mjs reserve|pack|npm|github [identity|ocean]");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
