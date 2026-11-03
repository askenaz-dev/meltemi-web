// Small fail-closed API client. Diagnostics contain status and path, never response bodies/tokens.
export function githubApi(repository, token, ask = fetch) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid repository");
  return async (path, options = {}) => {
    const response = await ask(`https://api.github.com/repos/${repository}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404 && options.allowMissing) return undefined;
    if (!response.ok) throw new Error(`GitHub ${response.status} at ${path}`);
    return response.status === 204 ? undefined : response.json();
  };
}
