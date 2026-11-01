# Temporary override for this targeted operation only. The repository resource's for_each
# includes D1 metadata, which adds both databases to the dependency graph even though this
# secret needs only the repository's already-known name. The local release_secrets entries
# contain exactly that name. Keep the managed address, secret_name and value unchanged.
resource "github_actions_secret" "release" {
  repository = each.value.repository
}
