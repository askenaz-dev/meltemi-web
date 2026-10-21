# One deploy token per product repository, allowed to upload Workers, bind their Secrets Store
# secrets and apply D1 migrations, and nothing else: a product's pipeline cannot touch a zone, a
# record or another token. Terraform puts each in its repository's `production` environment
# (github.tf). They are the owner's user tokens, not account-owned ones: on 2026-10-21 the Secrets
# Store (open beta) refused an account-owned token's bindings at upload (10021) and accepted a user
# token's, so creating them needs the user permission API Tokens Edit on Terraform's own token.

data "cloudflare_account_api_token_permission_groups_list" "all" {
  count      = var.permission_group_ids == null ? 1 : 0
  account_id = var.cloudflare_account_id
}

locals {
  # Account tokens take account-scoped groups. Some names exist for both the account and its zones
  # ("Access: Apps and Policies Read"), so the list is narrowed to the account's and grouped by name.
  account_groups = var.permission_group_ids != null ? {} : {
    for group in data.cloudflare_account_api_token_permission_groups_list.all[0].result :
    group.name => group.id... if contains(group.scopes, "com.cloudflare.api.account")
  }
  permission_groups = var.permission_group_ids != null ? var.permission_group_ids : {
    for name, ids in local.account_groups : name => ids[0]
  }

  # What `wrangler deploy` and `wrangler d1 migrations apply --remote` need. Binding a Secrets Store
  # secret to a Worker needs the store's write group (read alone fails the upload with 10021); it is
  # taken when the account lists it.
  deploy_groups = {
    web      = ["Workers Scripts Write", "D1 Write"]
    diagrams = ["Workers Scripts Write", "D1 Write", "Workers R2 Storage Read"]
  }
  optional_groups = [for name in ["Secrets Store Write"] : name if contains(keys(local.permission_groups), name)]

  account_resources = jsonencode({ "com.cloudflare.api.account.${var.cloudflare_account_id}" = "*" })
}

resource "cloudflare_api_token" "deploy" {
  for_each = local.deploy_groups

  name = "deploy: ${each.key == "web" ? "meltemi-web" : "meltemi-diagrams"} (GitHub Actions)"

  policies = [{
    effect = "allow"
    permission_groups = [
      for name in concat(each.value, local.optional_groups) : { id = local.permission_groups[name] }
    ]
    resources = local.account_resources
  }]

  lifecycle {
    precondition {
      condition     = alltrue([for name in each.value : contains(keys(local.permission_groups), name)])
      error_message = "The account lists no permission group named one of: ${join(", ", each.value)}."
    }
  }
}
