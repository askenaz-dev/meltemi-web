# The secrets of the family's Workers, in the account's one Secrets Store. Terraform generates the
# ones nobody needs to know and receives the rest as sensitive variables; a Worker binds each as
# `<NAME>_STORE` and its entry reads it into `<NAME>`. Nobody runs `wrangler secret put`.
# Rotation is a commit: a new entry in `rotations` replaces a generated secret, a new environment
# secret replaces a received one.

resource "cloudflare_secrets_store" "family" {
  account_id = var.cloudflare_account_id
  name       = "meltemi"
}

# An account holds one store: if it already has one, its id in `existing_secrets_store_id` imports
# it instead of creating a second.
import {
  for_each = var.existing_secrets_store_id == "" ? toset([]) : toset([var.existing_secrets_store_id])
  to       = cloudflare_secrets_store.family
  id       = "${var.cloudflare_account_id}/${each.value}"
}

resource "random_password" "state_secret" {
  length  = 64
  special = false
  keepers = { rotation = lookup(var.rotations, "STATE_SECRET", "") }
}

resource "random_password" "forms_secret" {
  length  = 64
  special = false
  keepers = { rotation = lookup(var.rotations, "FORMS_SECRET", "") }
}

# One value, two names: the identity service signs the deletion events of Meltemi Diagrams with
# EVENTS_SECRET_DIAGRAMS and Diagrams verifies them with IDENTITY_EVENTS_SECRET, so they agree by
# construction.
resource "random_password" "diagrams_events_secret" {
  length  = 64
  special = false
  keepers = { rotation = lookup(var.rotations, "EVENTS_SECRET_DIAGRAMS", "") }
}

locals {
  secrets = {
    # The identity service (meltemi-web, packages/identity).
    SESSION_PRIVATE_KEY    = var.session_private_key
    STATE_SECRET           = random_password.state_secret.result
    GITHUB_CLIENT_SECRET   = var.github_client_secret
    GOOGLE_CLIENT_SECRET   = var.google_client_secret
    EVENTS_SECRET_DIAGRAMS = random_password.diagrams_events_secret.result
    # Meltemi Diagrams' main Worker (meltemi-diagrams, packages/cloud).
    FORMS_SECRET           = random_password.forms_secret.result
    IDENTITY_EVENTS_SECRET = random_password.diagrams_events_secret.result
    ADMIN_SUBS             = var.admin_subs
  }
}

resource "cloudflare_secrets_store_secret" "family" {
  # The names are not secret; the values are.
  for_each = nonsensitive(toset(keys(local.secrets)))

  account_id = var.cloudflare_account_id
  store_id   = cloudflare_secrets_store.family.id
  name       = each.value
  # A Store secret cannot be empty: an unset administrator list is stored as a single space, which
  # the Worker reads as nobody.
  value  = local.secrets[each.value] == "" ? " " : local.secrets[each.value]
  scopes = ["workers"]
}
