# Run with mocked providers only, after staging the operation override in the Terraform root.
mock_provider "cloudflare" {}
mock_provider "github" {}
mock_provider "random" {}

variables {
  cloudflare_account_id = "0123456789abcdef0123456789abcdef"
  session_private_key   = "{\"kty\":\"EC\"}"
  mcp_test_tokens = {
    staging = {
      token   = "dummy-staging-primary"
      token_2 = "dummy-staging-secondary"
    }
    production = {
      token   = "dummy-production-primary"
      token_2 = "dummy-production-secondary"
    }
  }
}

run "only_four_mcp_credentials" {
  command = plan

  plan_options {
    target = [
      github_actions_environment_secret.mcp_test_token["meltemi-diagrams/staging/MELTEMI_TOKEN"],
      github_actions_environment_secret.mcp_test_token["meltemi-diagrams/staging/MELTEMI_TOKEN_2"],
      github_actions_environment_secret.mcp_test_token["meltemi-diagrams/production/MELTEMI_TOKEN"],
      github_actions_environment_secret.mcp_test_token["meltemi-diagrams/production/MELTEMI_TOKEN_2"],
    ]
  }

  assert {
    condition     = length(github_actions_environment_secret.mcp_test_token) == 4
    error_message = "Exactly four existing MCP credential declarations must be selected."
  }
  assert {
    condition = alltrue([
      for key, secret in github_actions_environment_secret.mcp_test_token :
      secret.repository == "meltemi-diagrams" &&
      secret.environment == split("/", key)[1] &&
      secret.secret_name == split("/", key)[2]
    ])
    error_message = "The operation retains each destination repository, environment and secret name."
  }
  assert {
    condition = alltrue([
      for key, secret in github_actions_environment_secret.mcp_test_token :
      secret.value == var.mcp_test_tokens[split("/", key)[1]][endswith(key, "TOKEN_2") ? "token_2" : "token"]
    ])
    error_message = "Each secret must retain its explicit canonical source value."
  }
}
