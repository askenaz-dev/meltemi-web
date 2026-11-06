# Temporary operation-only override. The repository resource's for_each includes D1 metadata,
# bringing unrelated databases into this secret's dependency graph. The existing release_secrets
# entry already contains the exact repository name. Keep address, secret name and value unchanged.
resource "github_actions_secret" "release" {
  repository = each.value.repository
}
