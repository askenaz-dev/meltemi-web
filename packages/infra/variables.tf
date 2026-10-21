# The settings of the family's infrastructure. The three switches below are code: the commit that
# changes a default is the change, and its plan is reviewed on the pull request. The account and
# the secret values come from the pipeline's environment as TF_VAR_<name>.

variable "cloudflare_account_id" {
  description = "The Cloudflare account that holds the zones, the Workers and their storage."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.cloudflare_account_id))
    error_message = "cloudflare_account_id must be the account's 32-character hexadecimal id."
  }
}

variable "github_owner" {
  description = "The GitHub organisation of the family's repositories."
  type        = string
  default     = "askenaz-dev"
}

variable "apex_on_github_pages" {
  description = "Whether meltemi.dev still answers from the IDE's GitHub Pages site (its four A records and www). Turned false in the commit before the one that hands the apex to the family site's Worker (site_on_apex), on 2026-10-21."
  type        = bool
  default     = false
}

variable "attach_domains" {
  description = "Whether the Workers' Custom Domains exist. False for the first apply, before any Worker has a version (a Custom Domain needs one); true from the product pipelines' first deploys on (2026-10-21)."
  type        = bool
  default     = true
}

variable "site_on_apex" {
  description = "Whether the family site's Custom Domains, meltemi.dev and www.meltemi.dev, exist. Turned true in the commit after the one that turns apex_on_github_pages false: Cloudflare refuses a Custom Domain on a hostname that still has records, and one apply cannot order the records' removal before the domains' creation."
  type        = bool
  default     = false

  validation {
    condition     = !var.site_on_apex || !var.apex_on_github_pages
    error_message = "site_on_apex needs apex_on_github_pages false first: the GitHub Pages records must be gone."
  }
}

variable "existing_zone_ids" {
  description = "Zones the account already has, by name (\"meltemi.dev\", \"meltemi.page\"), added in the dashboard before Terraform: imported instead of created. `pnpm infra:bootstrap` finds them."
  type        = map(string)
  default     = {}
}

variable "existing_apex_record_ids" {
  description = "The GitHub Pages A records an existing meltemi.dev zone already holds, by address, to import. `pnpm infra:bootstrap` finds them."
  type        = map(string)
  default     = {}

  validation {
    condition     = length(var.existing_apex_record_ids) == 0 || contains(keys(var.existing_zone_ids), "meltemi.dev")
    error_message = "existing_apex_record_ids needs the zone of meltemi.dev in existing_zone_ids."
  }
}

variable "existing_secrets_store_id" {
  description = "The id of a Secrets Store the account already has (an account holds one), to import instead of creating one. Empty when there is none."
  type        = string
  default     = ""
}

variable "rotations" {
  description = "Generated secrets to rotate, by name: changing an entry (a date is a good value) replaces STATE_SECRET, FORMS_SECRET or EVENTS_SECRET_DIAGRAMS (with IDENTITY_EVENTS_SECRET) in the next apply."
  type        = map(string)
  default     = {}
}

variable "permission_group_ids" {
  description = "The account's API token permission groups, name to id. Null (the default) reads them from Cloudflare; the tests give them, since a mocked provider cannot."
  type        = map(string)
  default     = null
}

# --- Values only people can obtain: the providers' consoles, the key script, the registries. ---

variable "session_private_key" {
  description = "The identity service's signing key: the private JWK `pnpm identity:keys` prints."
  type        = string
  sensitive   = true
}

variable "github_client_secret" {
  description = "The secret of the production GitHub OAuth App (callback https://id.meltemi.dev/callback/github); empty until the app exists, which leaves that sign-in unavailable."
  type        = string
  sensitive   = true
  default     = ""
}

variable "google_client_secret" {
  description = "The secret of the production Google OAuth client (redirect https://id.meltemi.dev/callback/google); empty until the app exists, which leaves that sign-in unavailable."
  type        = string
  sensitive   = true
  default     = ""
}

variable "admin_subs" {
  description = "The `sub`s of Meltemi Diagrams' administrators, comma separated; empty until the owner's first sign-in."
  type        = string
  sensitive   = true
  default     = ""
}

variable "npm_token" {
  description = "A granular npm token that publishes the `meltemi` organisation's packages; empty until it exists, and again once trusted publishing replaces it."
  type        = string
  sensitive   = true
  default     = ""
}

variable "vsce_pat" {
  description = "The Visual Studio Marketplace token of the `meltemi` publisher; empty until it exists."
  type        = string
  sensitive   = true
  default     = ""
}

variable "ovsx_pat" {
  description = "The Open VSX token of the `meltemi` namespace; empty until it exists."
  type        = string
  sensitive   = true
  default     = ""
}
