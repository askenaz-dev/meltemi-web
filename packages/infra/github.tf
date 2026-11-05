# The family's repositories on GitHub, their `production` environments (and Diagrams' `staging`,
# change diagrams-staging) and what the pipelines read there. `meltemi-web` holds this root and
# existed before it (its `infrastructure` environment and that environment's secrets are the
# bootstrap, set by hand); it is imported.
# The IDE repository (askenaz-dev/meltemi) is not managed here as a repository: only what its
# release path relies on is declared, at the end of this file (change ide-releases).

locals {
  repositories = {
    "meltemi-web" = {
      description = "The web of the Meltemi family: the product site at meltemi.dev, the shared identity service at id.meltemi.dev, and the family's infrastructure as code."
      homepage    = "https://meltemi.dev"
      topics      = ["meltemi", "cloudflare-workers", "identity", "terraform"]
      token       = "web"
    }
    "meltemi-diagrams" = {
      description = "Meltemi Diagrams: diagrams as code, canvas editing and animated exports."
      homepage    = "https://diagrams.meltemi.dev"
      topics      = ["meltemi", "diagrams-as-code", "architecture", "c4", "vscode-extension"]
      token       = "diagrams"
    }
  }
}

import {
  to = github_repository.family["meltemi-web"]
  id = "meltemi-web"
}

resource "github_repository" "family" {
  for_each = local.repositories

  name         = each.key
  description  = each.value.description
  homepage_url = each.value.homepage
  topics       = each.value.topics
  visibility   = "public"

  has_issues             = true
  has_wiki               = false
  has_projects           = false
  has_discussions        = false
  allow_merge_commit     = false
  allow_rebase_merge     = false
  allow_squash_merge     = true
  delete_branch_on_merge = true
  archive_on_destroy     = true
}

resource "github_repository_vulnerability_alerts" "family" {
  for_each = local.repositories

  repository = github_repository.family[each.key].name
  enabled    = true
}

resource "github_repository_environment" "production" {
  for_each = local.repositories

  repository  = github_repository.family[each.key].name
  environment = "production"

  deployment_branch_policy {
    protected_branches     = true
    custom_branch_policies = false
  }
}

# Diagrams' staging twin (change diagrams-staging): the environment from which its deploy uploads
# the staging Workers before production's, deployable from `main` only.
resource "github_repository_environment" "diagrams_staging" {
  repository  = github_repository.family["meltemi-diagrams"].name
  environment = "staging"

  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }
}

resource "github_repository_environment_deployment_policy" "diagrams_staging_main" {
  repository     = github_repository.family["meltemi-diagrams"].name
  environment    = github_repository_environment.diagrams_staging.environment
  branch_pattern = "main"
}

# What the deploy workflows read, per environment: the token as a secret; the ids and names, which
# are not secret, as variables that the workflow writes into the Workers' configurations at deploy
# time. Staging reads the names production reads, with its own values, and SECRETS_SUFFIX, the
# suffix of the Store secrets it binds where production binds them bare. Production's suffix is
# empty and is not set: GitHub reads a variable that is not set as an empty string, and its
# documentation does not say that it accepts an empty value.
locals {
  deploy_environments = {
    "meltemi-web/production" = {
      repository  = "meltemi-web"
      environment = github_repository_environment.production["meltemi-web"].environment
      variables = {
        D1_DATABASE_ID = cloudflare_d1_database.identity.id
      }
    }
    "meltemi-diagrams/production" = {
      repository  = "meltemi-diagrams"
      environment = github_repository_environment.production["meltemi-diagrams"].environment
      variables = {
        D1_DATABASE_ID = cloudflare_d1_database.diagrams.id
        R2_BUCKET_NAME = cloudflare_r2_bucket.diagrams_blobs.name
        OAUTH_KV_ID    = cloudflare_workers_kv_namespace.diagrams_oauth.id
      }
    }
    "meltemi-diagrams/staging" = {
      repository  = "meltemi-diagrams"
      environment = github_repository_environment.diagrams_staging.environment
      variables = {
        D1_DATABASE_ID = cloudflare_d1_database.diagrams_staging.id
        R2_BUCKET_NAME = cloudflare_r2_bucket.diagrams_staging_blobs.name
        OAUTH_KV_ID    = cloudflare_workers_kv_namespace.diagrams_oauth_staging.id
        SECRETS_SUFFIX = "_STAGING"
      }
    }
  }
}

resource "github_actions_environment_secret" "cloudflare_api_token" {
  for_each = local.deploy_environments

  repository  = github_repository.family[each.value.repository].name
  environment = each.value.environment
  secret_name = "CLOUDFLARE_API_TOKEN"
  value       = cloudflare_api_token.deploy[local.repositories[each.value.repository].token].value
}

locals {
  deploy_variables = merge([
    for key, settings in local.deploy_environments : {
      for name, value in merge(settings.variables, {
        CLOUDFLARE_ACCOUNT_ID = var.cloudflare_account_id
        SECRETS_STORE_ID      = cloudflare_secrets_store.family.id
      }) : "${key}/${name}" => { repository = settings.repository, environment = settings.environment, name = name, value = value }
    }
  ]...)
}

resource "github_actions_environment_variable" "deploy" {
  for_each = local.deploy_variables

  repository    = github_repository.family[each.value.repository].name
  environment   = each.value.environment
  variable_name = each.value.name
  value         = each.value.value
}

# The production environments' token and ids were keyed by repository alone before staging.
moved {
  from = github_actions_environment_secret.cloudflare_api_token["meltemi-web"]
  to   = github_actions_environment_secret.cloudflare_api_token["meltemi-web/production"]
}

moved {
  from = github_actions_environment_secret.cloudflare_api_token["meltemi-diagrams"]
  to   = github_actions_environment_secret.cloudflare_api_token["meltemi-diagrams/production"]
}

moved {
  from = github_actions_environment_variable.deploy["meltemi-web/CLOUDFLARE_ACCOUNT_ID"]
  to   = github_actions_environment_variable.deploy["meltemi-web/production/CLOUDFLARE_ACCOUNT_ID"]
}

moved {
  from = github_actions_environment_variable.deploy["meltemi-web/D1_DATABASE_ID"]
  to   = github_actions_environment_variable.deploy["meltemi-web/production/D1_DATABASE_ID"]
}

moved {
  from = github_actions_environment_variable.deploy["meltemi-web/SECRETS_STORE_ID"]
  to   = github_actions_environment_variable.deploy["meltemi-web/production/SECRETS_STORE_ID"]
}

moved {
  from = github_actions_environment_variable.deploy["meltemi-diagrams/CLOUDFLARE_ACCOUNT_ID"]
  to   = github_actions_environment_variable.deploy["meltemi-diagrams/production/CLOUDFLARE_ACCOUNT_ID"]
}

moved {
  from = github_actions_environment_variable.deploy["meltemi-diagrams/D1_DATABASE_ID"]
  to   = github_actions_environment_variable.deploy["meltemi-diagrams/production/D1_DATABASE_ID"]
}

moved {
  from = github_actions_environment_variable.deploy["meltemi-diagrams/SECRETS_STORE_ID"]
  to   = github_actions_environment_variable.deploy["meltemi-diagrams/production/SECRETS_STORE_ID"]
}

# The acceptance suite's tokens (Diagrams' change agent-mcp): two test accounts' `mdg_` tokens per
# environment, as MELTEMI_TOKEN and MELTEMI_TOKEN_2 of that environment, each present only once the
# owner has it. The map below holds names only, never a value.
locals {
  mcp_test_secrets = nonsensitive({
    for secret in flatten([
      for environment, tokens in var.mcp_test_tokens : [
        for field, name in { token = "MELTEMI_TOKEN", token_2 = "MELTEMI_TOKEN_2" } : {
          key                      = "meltemi-diagrams/${environment}/${name}"
          environment              = environment
          field                    = field
          name                     = name
        } if tokens[field] != null && tokens[field] != ""
      ]
    ]) : secret.key => secret
  })
}

resource "github_actions_environment_secret" "mcp_test_token" {
  for_each = local.mcp_test_secrets

  repository  = github_repository.family["meltemi-diagrams"].name
  environment = local.deploy_environments["meltemi-diagrams/${each.value.environment}"].environment
  secret_name = each.value.name
  value       = var.mcp_test_tokens[each.value.environment][each.value.field]
}

# The release workflows' tokens, as repository secrets, present only once the owner has them.
locals {
  release_secrets = {
    "meltemi-web/NPM_TOKEN"      = { repository = "meltemi-web", name = "NPM_TOKEN", present = nonsensitive(var.npm_token != "") }
    "meltemi-diagrams/NPM_TOKEN" = { repository = "meltemi-diagrams", name = "NPM_TOKEN", present = nonsensitive(var.npm_token != "") }
    "meltemi-diagrams/VSCE_PAT"  = { repository = "meltemi-diagrams", name = "VSCE_PAT", present = nonsensitive(var.vsce_pat != "") }
    "meltemi-diagrams/OVSX_PAT"  = { repository = "meltemi-diagrams", name = "OVSX_PAT", present = nonsensitive(var.ovsx_pat != "") }
    # Diagrams' release workflow tells this repository's deploy a release is out (change docs-portal),
    # with the narrow notice token only: a repository secret, where the admin fallback never goes.
    "meltemi-diagrams/WEB_DISPATCH_TOKEN" = { repository = "meltemi-diagrams", name = "WEB_DISPATCH_TOKEN", present = nonsensitive(var.narrow_web_dispatch_token != "") }
  }
  release_values = {
    NPM_TOKEN          = var.npm_token
    VSCE_PAT           = var.vsce_pat
    OVSX_PAT           = var.ovsx_pat
    WEB_DISPATCH_TOKEN = var.narrow_web_dispatch_token
  }
}

resource "github_actions_secret" "release" {
  for_each = { for key, secret in local.release_secrets : key => secret if secret.present }

  repository  = github_repository.family[each.value.repository].name
  secret_name = each.value.name
  value       = local.release_values[each.value.name]
}

# `main` of each repository: never deleted, never rewritten.
resource "github_repository_ruleset" "main" {
  for_each = local.repositories

  repository  = github_repository.family[each.key].name
  name        = "main"
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  rules {
    deletion         = true
    non_fast_forward = true
  }
}

# Version reservations are permanent. Creation is permitted to the release workflow's token;
# neither a retry nor a person can move/delete a reserved source tag.
resource "github_repository_ruleset" "family_version_tags" {
  for_each = local.repositories

  repository  = github_repository.family[each.key].name
  name        = "version tags"
  target      = "tag"
  enforcement = "active"

  conditions {
    ref_name {
      include = each.key == "meltemi-web" ? ["refs/tags/v*", "refs/tags/ocean-v*"] : ["refs/tags/v*"]
      exclude = []
    }
  }

  rules {
    update   = true
    deletion = true
  }
}

# The IDE's release path (change ide-releases; the IDE's change release-con-el-push). A commit that
# carries a new version on the IDE's `main` publishes a release with nobody in between, so the
# doors next to that one are closed here, as loose resources that name the repository. The
# repository itself is not imported: that resource reconciles its description, topics, Pages and
# features, none of which this path needs.
locals {
  ide_repository = "meltemi"
}

# `main`: never deleted, never rewritten.
resource "github_repository_ruleset" "ide_main" {
  repository  = local.ide_repository
  name        = "main"
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  rules {
    deletion         = true
    non_fast_forward = true
  }
}

# Version tags: never moved, never deleted. Creation stays open: restricting it would need GitHub
# Actions as a bypass actor, which is unverified, and no IDE workflow listens to tags, so a tag
# pushed by hand publishes nothing; immutable releases already lock every published tag.
resource "github_repository_ruleset" "ide_version_tags" {
  repository  = local.ide_repository
  name        = "version tags"
  target      = "tag"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["refs/tags/v*"]
      exclude = []
    }
  }

  rules {
    update   = true
    deletion = true
  }
}

# The environment of the jobs that publish and notify: deployable from `main` only, with no
# reviewers (the owner chose a release with no human step; a reviewer here is the way back).
resource "github_repository_environment" "ide_release" {
  repository  = local.ide_repository
  environment = "release"

  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }
}

resource "github_repository_environment_deployment_policy" "ide_release_main" {
  repository     = local.ide_repository
  environment    = github_repository_environment.ide_release.environment
  branch_pattern = "main"
}

# The notice token, once the owner has it: it can start meltemi-web's workflows and nothing else.
resource "github_actions_environment_secret" "ide_web_dispatch" {
  count = nonsensitive(var.web_dispatch_token != "") ? 1 : 0

  repository  = local.ide_repository
  environment = github_repository_environment.ide_release.environment
  secret_name = "WEB_DISPATCH_TOKEN"
  value       = var.web_dispatch_token
}

# Every IDE workflow starts read-only; the jobs that publish raise their own permissions.
resource "github_workflow_repository_permissions" "ide" {
  repository                       = local.ide_repository
  default_workflow_permissions     = "read"
  can_approve_pull_request_reviews = false
}
