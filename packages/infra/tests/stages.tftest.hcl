# The stages of the family's infrastructure, planned against mocked providers: nothing here
# reaches Cloudflare or GitHub. `terraform test` runs it (pnpm infra:test).

mock_provider "cloudflare" {}

mock_provider "github" {}

# meltemi-web is imported, and a mocked provider cannot import: its state is given instead.
override_resource {
  target = github_repository.family["meltemi-web"]
  values = { name = "meltemi-web", visibility = "public" }
}
mock_provider "random" {}

variables {
  cloudflare_account_id = "0123456789abcdef0123456789abcdef"
  session_private_key   = "{\"kty\":\"EC\"}"
  github_client_secret  = "github-secret"
  google_client_secret  = "google-secret"
  permission_group_ids = {
    "Workers Scripts Write"   = "workers-scripts-write"
    "D1 Write"                = "d1-write"
    "Workers R2 Storage Read" = "r2-read"
    "Secrets Store Read"      = "secrets-store-read"
    "Zone Write"              = "zone-write"
  }
}

# The first apply: zones, records, Workers, storage, secrets and repositories, no domain.
run "first_apply" {
  command = plan

  assert {
    condition     = length(cloudflare_dns_record.dev_apex_github_pages) == 4
    error_message = "meltemi.dev keeps its four GitHub Pages records before the swap."
  }
  assert {
    condition     = alltrue([for record in cloudflare_dns_record.dev_apex_github_pages : record.proxied == false && record.type == "A"])
    error_message = "The GitHub Pages records are unproxied A records."
  }
  assert {
    condition     = length(cloudflare_workers_custom_domain.family) == 0
    error_message = "No Custom Domain exists before attach_domains."
  }
  assert {
    condition     = toset([for worker in cloudflare_worker.family : worker.name]) == toset(["meltemi-identity", "meltemi-site", "meltemi-diagrams-cloud", "meltemi-diagrams-publish"])
    error_message = "The four Workers of the family are declared."
  }
  assert {
    condition     = alltrue([for worker in cloudflare_worker.family : worker.subdomain.enabled == false && worker.subdomain.previews_enabled == false])
    error_message = "No Worker has a workers.dev address or preview addresses."
  }
  assert {
    condition     = toset(keys(cloudflare_secrets_store_secret.family)) == toset(["SESSION_PRIVATE_KEY", "STATE_SECRET", "GITHUB_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET", "EVENTS_SECRET_DIAGRAMS", "FORMS_SECRET", "IDENTITY_EVENTS_SECRET", "ADMIN_SUBS"])
    error_message = "The Store holds the eight secrets of the two products."
  }
  assert {
    condition     = alltrue([for secret in cloudflare_secrets_store_secret.family : secret.scopes == tolist(["workers"])])
    error_message = "Every secret is scoped to Workers."
  }
  assert {
    condition     = length(cloudflare_account_token.deploy) == 2
    error_message = "One deploy token per product repository."
  }
  assert {
    condition     = length(github_actions_environment_secret.cloudflare_api_token) == 2 && length(github_actions_environment_variable.deploy) == 6
    error_message = "Each repository's production environment gets its token and its three ids."
  }
  assert {
    condition     = length(github_actions_secret.release) == 0
    error_message = "No release secret exists before the owner has the tokens."
  }
  assert {
    condition     = alltrue([for repository in github_repository.family : repository.visibility == "public"])
    error_message = "The family's repositories are public."
  }
}

# The deploy tokens can upload Workers and migrate D1, and nothing else.
run "deploy_tokens" {
  command = plan

  assert {
    condition     = toset([for group in cloudflare_account_token.deploy["web"].policies[0].permission_groups : group.id]) == toset(["workers-scripts-write", "d1-write", "secrets-store-read"])
    error_message = "The web token uploads Workers, migrates D1 and reads the Store's bindings."
  }
  assert {
    condition     = toset([for group in cloudflare_account_token.deploy["diagrams"].policies[0].permission_groups : group.id]) == toset(["workers-scripts-write", "d1-write", "r2-read", "secrets-store-read"])
    error_message = "The diagrams token also reads its R2 binding."
  }
}

# The domains attach once the Workers have versions, the apex excepted.
run "domains_attach" {
  command = plan

  variables {
    attach_domains = true
  }

  assert {
    condition     = toset([for domain in cloudflare_workers_custom_domain.family : domain.hostname]) == toset(["id.meltemi.dev", "diagrams.meltemi.dev", "meltemi.page"])
    error_message = "Three domains attach while GitHub Pages still holds the apex."
  }
  assert {
    condition     = length(cloudflare_dns_record.dev_apex_github_pages) == 4
    error_message = "The apex stays on GitHub Pages."
  }
}

# The swap hands the apex to the family site.
run "apex_swap" {
  command = plan

  variables {
    attach_domains       = true
    apex_on_github_pages = false
  }

  assert {
    condition     = length(cloudflare_dns_record.dev_apex_github_pages) == 0
    error_message = "The GitHub Pages records go."
  }
  assert {
    condition     = cloudflare_workers_custom_domain.family["site"].hostname == "meltemi.dev" && cloudflare_workers_custom_domain.family["site"].service == "meltemi-site"
    error_message = "The family site takes the apex."
  }
  assert {
    condition     = length(cloudflare_workers_custom_domain.family) == 4
    error_message = "All four domains are attached."
  }
}

# The release tokens reach the repositories once the owner has them.
run "release_tokens" {
  command = plan

  variables {
    npm_token = "npm-token"
    vsce_pat  = "vsce-token"
  }

  assert {
    condition     = toset(keys(github_actions_secret.release)) == toset(["meltemi-web/NPM_TOKEN", "meltemi-diagrams/NPM_TOKEN", "meltemi-diagrams/VSCE_PAT"])
    error_message = "NPM_TOKEN goes to both repositories and VSCE_PAT to Diagrams; OVSX_PAT waits."
  }
}

# A token whose permission group the account does not list is refused before anything is made.
run "missing_permission_group" {
  command = plan

  variables {
    permission_group_ids = {
      "Workers Scripts Write" = "workers-scripts-write"
    }
  }

  expect_failures = [cloudflare_account_token.deploy]
}

# An account id that is not one is refused.
run "bad_account_id" {
  command = plan

  variables {
    cloudflare_account_id = "not-an-account"
  }

  expect_failures = [var.cloudflare_account_id]
}

# Rotating a generated secret is a change of `rotations`, which replaces only that secret.
run "rotation" {
  command = plan

  variables {
    rotations = { STATE_SECRET = "2027-01-15" }
  }

  assert {
    condition     = random_password.state_secret.keepers.rotation == "2027-01-15" && random_password.forms_secret.keepers.rotation == ""
    error_message = "Only the named secret's keeper changes."
  }
}
