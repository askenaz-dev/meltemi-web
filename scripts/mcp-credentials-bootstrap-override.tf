# Operation-only: remove the repository/environment maps' incidental D1/R2 dependencies.
# Keep the existing resource's for_each, address, secret_name and sensitive value unchanged.
resource "github_actions_environment_secret" "mcp_test_token" {
  repository  = "meltemi-diagrams"
  environment = each.value.environment
}
