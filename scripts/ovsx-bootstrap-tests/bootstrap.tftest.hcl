# Run only against mocked providers, with the operation override staged in the Terraform root.
mock_provider "cloudflare" {}
mock_provider "github" {}
mock_provider "random" {}

variables {
  cloudflare_account_id = "0123456789abcdef0123456789abcdef"
  session_private_key   = "{\"kty\":\"EC\"}"
  npm_token             = "mock-npm-token"
  ovsx_pat              = "mock-open-vsx-token"
}

run "only_open_vsx_secret" {
  command = plan

  plan_options {
    target = [github_actions_secret.release["meltemi-diagrams/OVSX_PAT"]]
  }

  assert {
    condition     = github_actions_secret.release["meltemi-diagrams/OVSX_PAT"].repository == "meltemi-diagrams"
    error_message = "The operation retains the destination repository."
  }
  assert {
    condition     = github_actions_secret.release["meltemi-diagrams/OVSX_PAT"].secret_name == "OVSX_PAT"
    error_message = "The operation retains the destination secret name."
  }
}
