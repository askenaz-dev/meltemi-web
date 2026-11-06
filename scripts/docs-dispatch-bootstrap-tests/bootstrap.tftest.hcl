# Run only with mocked providers and the operation override staged in the Terraform root.
mock_provider "cloudflare" {}
mock_provider "github" {}
mock_provider "random" {}

variables {
  cloudflare_account_id     = "0123456789abcdef0123456789abcdef"
  session_private_key       = "{\"kty\":\"EC\"}"
  narrow_web_dispatch_token = "mock-notice-token"
}

run "only_documentation_notice_secret" {
  command = plan

  plan_options {
    target = [github_actions_secret.release["meltemi-diagrams/WEB_DISPATCH_TOKEN"]]
  }

  assert {
    condition     = github_actions_secret.release["meltemi-diagrams/WEB_DISPATCH_TOKEN"].repository == "meltemi-diagrams"
    error_message = "The operation retains the destination repository."
  }
  assert {
    condition     = github_actions_secret.release["meltemi-diagrams/WEB_DISPATCH_TOKEN"].secret_name == "WEB_DISPATCH_TOKEN"
    error_message = "The operation retains the destination secret name."
  }
  assert {
    condition     = github_actions_secret.release["meltemi-diagrams/WEB_DISPATCH_TOKEN"].value == "mock-notice-token"
    error_message = "The existing declaration distributes the explicit narrow notice value."
  }
}
